'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import {
  formatShortDate,
  formatTerminalPrice,
  formatTerminalPriceLong,
  formatUsdCompact,
} from './format';
import { MarketChange, describeMarketChange } from './market-change';
import { AroundEventRows, type AroundPanel } from './around-event';
import { announceAroundEventOpened } from './around-event-beacon';
import {
  axisOf,
  bandsFor,
  calloutWidth,
  clusterLabel,
  coversColumn,
  layoutAnnotations,
  type AnnotationItem,
  type AnnotationLayout,
  type AnnotationPrecision,
} from './terminal-chart-annotations';

/**
 * The market chart's interaction island (Terminal redesign, 2026-09-26; build
 * × market correlation, founder brief §21A, 2026-09-29).
 *
 * It receives data only — a compact array per day, already given its
 * direction by `candleDirection` on the server, and the events already placed
 * on the time axis by `placeEvent` — and draws the SVG itself, so the drawing
 * is serialised once (as HTML) instead of twice. It is still server-rendered:
 * without JavaScript the reader gets the same candles, the event lane and a
 * readout of the latest complete day.
 *
 * What the JavaScript adds: the event filters and the market-only lens; the
 * callouts above the plot, laid out by `layoutAnnotations` once the plot's
 * width is measured (a width the server cannot know); a crosshair, a floating
 * readout and "around this time" for pointer and touch; ←/→/Home/End/Esc/
 * Enter on the focused figure; arrow keys inside the callouts and the lane;
 * and the evidence panel, a bottom sheet on a phone. Moves never allocate
 * React state per pixel: the day under the pointer is state only when it
 * changes, and the horizontal price line is written straight to the DOM.
 *
 * Direction colours (CLAUDE.md UI rule 13) are read here only from the
 * direction code the server decided, and only by candles and volume. An
 * event's colour is its family's research tone, never a market token.
 */

/** u up · d down · f flat (doji) · n close only · m mixed series · p today, still open · x read but no price. */
export type RowDirection = 'u' | 'd' | 'f' | 'n' | 'm' | 'p' | 'x';

/** `[day]` is a day HEY did not read. Otherwise day, open, high, low, close, volume, readings, direction. */
export type ChartRow =
  | [string]
  | [
      string,
      number | null,
      number | null,
      number | null,
      number | null,
      number | null,
      number,
      RowDirection,
    ];

/** One event on the time axis. Nothing here is a price. */
export type LaneEvent = {
  /** The record's typed public id. */
  id: string;
  /** Column index: the event's day, or the first day of its week or window. */
  i: number;
  /** The last column of a week or window. */
  j?: number;
  /** Where in its day an EXACT event falls, 0–1. */
  f?: number;
  /** Family key. */
  fam: string;
  t: string;
  /** Kind in words: "Release". */
  k: string;
  /** Marker shape. */
  s: string;
  p: AnnotationPrecision;
  /** Precision in words: "exact", "date precision", "week precision", "seen by HEY". */
  w: string;
  /** The callout's short date: "14 Sep", "wk of 8 Sep", "seen 14 Sep". */
  d: string;
  /** The date in full, for a screen reader. */
  dl: string;
  /** The family's tone. */
  c: string;
  h?: string;
};

/** A scheduled event after the last day on the axis: it has no column yet. */
export type AheadEvent = Omit<LaneEvent, 'i' | 'j' | 'f'> & { day: string };

export type ChartFamilyChip = {
  key: string;
  label: string;
  shape: string;
  tone: string;
  count: number;
  rank?: number;
  /** The chip also toggles the code lane. */
  codeLane?: boolean;
  /** Lane marks only, never a callout. */
  noCallout?: boolean;
};

/** One column of the code lane: commits, substantive, low-information, not read, and 1 when the count is a floor. */
export type CodeCell = [commits: number, substantive: number, lowInformation: number, unknown: number, floor: 0 | 1];

/**
 * The code lane (2026-09-29): commits per column in neutral ink with a
 * substance pattern — solid substantive, hatched low-information, dashed not
 * yet read — never a market colour. `null` is a column before the counts
 * start: absent, never zero. `prs` are merged pull requests, [column, place
 * in it]; `prsFrom` the first column the PR ticks cover.
 */
export type CodeLaneModel = {
  state: 'MEASURED' | 'NO_REPOSITORY' | 'NOT_READ';
  cells: (CodeCell | null)[];
  max: number;
  total: number;
  /** Some count in range is a floor (a page cut at a hundred commits, or a column read part-way). */
  floor: boolean;
  prs: [number, number][];
  prsFrom?: number;
};

export type ChartModel = {
  rows: ChartRow[];
  lo: number;
  hi: number;
  ticks: [number, string][];
  months: [number, string][];
  gapRuns: [number, number, string][];
  gapTicks: [number, number][];
  maxVol: number;
  volLabel: string;
  lane: LaneEvent[];
  ahead: AheadEvent[];
  /** The families present in range, in importance order, with their counts. */
  families: ChartFamilyChip[];
  /** The latest complete day with a price. */
  latest: number;
  /** The day the readout opens on. */
  initial: number;
  /**
   * The server's UTC day (`YYYY-MM-DD`) when it built the model. Dates are
   * formatted against it, never against the browser's clock, so the year a
   * label hides or prints is the same in the server's HTML and in the
   * hydrating render (remaining issues, 2026-09-26: React #418).
   */
  today: string;
  /**
   * An intraday timeframe (2026-09-29); absent is the daily chart. A row's
   * key is then its bar's start (`2026-09-29T14:00Z`), and every label says
   * "bar" where the daily chart says "day".
   */
  tf?: '15m' | '1h' | '4h';
  /** The code lane, when the caller read one. */
  code?: CodeLaneModel;
};

export type ChartLens = 'events' | 'market';

const W = 1000;
const H = 400;
const PLOT = 326;
const VOL_TOP = 342;

/* The callout band: rows above the plot, px. */
const ROW_H = 36;
const ROW_GAP = 6;
const STEM_SPACE = 10;
/* From the stage's bottom edge to the lane's middle: the month axis (20) and half the lane (10). */
const LANE_MID_FROM_BOTTOM = 30;

/* How close (px) an axis tick may sit to the crosshair's price label before it steps aside. */
const TICK_CLEARANCE = 14;

const bandHeight = (bands: number) => (bands === 0 ? 0 : bands * ROW_H + (bands - 1) * ROW_GAP + STEM_SPACE);
/**
 * A row's top inside the reserved band. The height is reserved for `bands`
 * rows before the width is known; the rows the layout used are packed toward
 * the plot, in order (`rank` 0 nearest it), so stems stay short and any spare
 * height falls between the readout and the callouts, never inside the plot.
 */
export const rowTop = (bands: number, rank: number) =>
  bandHeight(bands) - STEM_SPACE - ROW_H - rank * (ROW_H + ROW_GAP);

const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

const TONE: Readonly<Record<string, string>> = {
  u: 'var(--hey-market-up)',
  d: 'var(--hey-market-down)',
};
const VOL: Readonly<Record<string, string>> = {
  u: 'var(--hey-market-up-vol)',
  d: 'var(--hey-market-down-vol)',
};

const DIRECTION_WORD: Readonly<Record<RowDirection | 'g', string>> = {
  u: 'Up',
  d: 'Down',
  f: 'Unchanged',
  n: 'Close only',
  m: 'Mixed series',
  p: 'Today so far',
  x: 'No price',
  g: 'No reading',
};

type Paths = Record<
  | 'grid'
  | 'months'
  | 'uw'
  | 'ub'
  | 'dw'
  | 'db'
  | 'fw'
  | 'ft'
  | 'nt'
  | 'po'
  | 'pi'
  | 'vu'
  | 'vd'
  | 'vf',
  string
>;

function draw(model: ChartModel): { paths: Paths; y: (v: number) => number; cw: number } {
  const n = model.rows.length;
  const cw = W / n;
  const span = model.hi - model.lo || 1;
  const y = (v: number) => r2(PLOT - ((v - model.lo) / span) * PLOT);
  const x = (i: number) => r2(cw * (i + 0.5));
  const p: Paths = {
    grid: '',
    months: '',
    uw: '',
    ub: '',
    dw: '',
    db: '',
    fw: '',
    ft: '',
    nt: '',
    po: '',
    pi: '',
    vu: '',
    vd: '',
    vf: '',
  };
  for (const [v] of model.ticks) p.grid += `M0 ${y(v)}H${W}`;
  for (const [i] of model.months) if (i > 0) p.months += `M${r2(cw * i)} 0V${H}`;
  model.rows.forEach((row, i) => {
    if (row.length === 1) return;
    const [, o, h, l, c, v, , dir] = row;
    const cx = x(i);
    if (typeof v === 'number' && v > 0 && model.maxVol > 0) {
      const top = r2(H - Math.max(1, (v / model.maxVol) * (H - VOL_TOP)));
      const key = dir === 'u' ? 'vu' : dir === 'd' ? 'vd' : 'vf';
      p[key] += `M${cx} ${H}V${top}`;
    }
    if (c === null) return;
    const yc = y(c);
    if (dir === 'n' || dir === 'm') {
      p.nt += `M${cx} ${r2(yc - 0.6)}V${r2(yc + 0.6)}`;
      return;
    }
    if (o === null || h === null || l === null) return;
    const wick = `M${cx} ${y(h)}V${y(l)}`;
    const top = Math.min(y(o), yc);
    const bottom = Math.max(y(o), yc);
    if (dir === 'u' || dir === 'd') {
      const mid = (top + bottom) / 2;
      const [a, b] = bottom - top < 1.1 ? [r2(mid - 0.55), r2(mid + 0.55)] : [top, bottom];
      p[dir === 'u' ? 'uw' : 'dw'] += wick;
      p[dir === 'u' ? 'ub' : 'db'] += `M${cx} ${a}V${b}`;
    } else if (dir === 'f') {
      p.fw += wick;
      p.ft += `M${cx} ${r2(yc - 0.85)}V${r2(yc + 0.85)}`;
    } else if (dir === 'p') {
      p.fw += wick;
      const [a, b] = bottom - top < 1.7 ? [r2(top - 0.85), r2(bottom + 0.85)] : [top, bottom];
      p.po += `M${cx} ${a}V${b}`;
      if (b - a > 2.6) p.pi += `M${cx} ${r2(a + 1.1)}V${r2(b - 1.1)}`;
    }
  });
  return { paths: p, y, cw };
}

const close = (row: ChartRow | undefined): number | null =>
  row && row.length > 1 ? (row[4] ?? null) : null;

/**
 * The last-close label on the price axis (full audit, 2026-09-30): the newest
 * row with a close, its direction, and the arrow that says it. UI rule 13 —
 * never colour alone, and no direction for a reading that is not the newest
 * row: when trailing rows are gaps, the close is older than the axis's end
 * and the label is flat, with no arrow.
 */
export function lastCloseMark(rows: readonly ChartRow[]): { index: number; close: number; direction: 'up' | 'down' | 'flat'; arrow: '' | '▲' | '▼' } | null {
  let index = rows.length - 1;
  while (index > 0 && close(rows[index]) === null) index -= 1;
  const row = rows[index];
  const value = close(row);
  if (value === null || !row || row.length < 2) return null;
  const code = index === rows.length - 1 ? row[7] : 'f';
  if (code === 'u') return { index, close: value, direction: 'up', arrow: '▲' };
  if (code === 'd') return { index, close: value, direction: 'down', arrow: '▼' };
  return { index, close: value, direction: 'flat', arrow: '' };
}

/** The reference day every date label is written against: the model's, never the browser clock. */
const referenceDay = (model: ChartModel) => new Date(`${model.today}T12:00:00Z`);

/** A row's time in words: "14 Sep" on 1D, "14 Sep 14:00" on an intraday bar (UTC). */
export const rowWhen = (model: Pick<ChartModel, 'today'>, key: string): string =>
  key.length > 10 ? `${formatShortDate(key.slice(0, 10), referenceDay(model as ChartModel))} ${key.slice(11, 16)}` : formatShortDate(key, referenceDay(model as ChartModel));

/** The label of the window one bar's own move covers: "1D", "1H", "15m", "4H". */
const barWindow = (model: ChartModel) => (model.tf === '15m' ? '15m' : model.tf === '1h' ? '1H' : model.tf === '4h' ? '4H' : '1D');

/** "daily", "hourly", "15-minute", "4-hour": the figure caption's word for the candles. */
const captionAdjective = (model: ChartModel) =>
  model.tf === '15m' ? '15-minute' : model.tf === '1h' ? 'hourly' : model.tf === '4h' ? '4-hour' : 'daily';

/** Where a label says "bar" intraday and "day" on the daily chart. */
const unitOf = (model: ChartModel) => (model.tf ? 'bar' : 'day');

/** The accessible name of one event: "Release: Agent SDK v0.4. 14 September 2026, 13:05 UTC. Evidence available." */
export const eventLabel = (e: Pick<LaneEvent, 'k' | 't' | 'dl' | 'h'>) =>
  `${e.k}: ${e.t}. ${e.dl}. ${e.h ? 'Evidence available.' : 'No evidence record to open.'}`;

/**
 * Research rank, never price impact: the family's place in the caller's
 * importance order first, then the newest, then the id.
 */
export function rankEvents(events: readonly LaneEvent[], familyOrder: readonly string[]): LaneEvent[] {
  const order = new Map(familyOrder.map((key, index) => [key, index]));
  return [...events].sort(
    (a, b) =>
      (order.get(a.fam) ?? familyOrder.length) - (order.get(b.fam) ?? familyOrder.length) ||
      b.i + (b.f ?? 0.5) - (a.i + (a.f ?? 0.5)) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The family keys in research rank for the callouts: each family's `rank`, else its place among the chips. */
export function calloutRankOrder(families: readonly Pick<ChartFamilyChip, 'key' | 'rank'>[]): string[] {
  return families
    .map((family, index) => ({ key: family.key, rank: family.rank ?? families.length + index, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((family) => family.key);
}

/** The layout's input for the visible events: time on the axis, rank and width — no price reaches it. */
export function annotationItems(events: readonly LaneEvent[], familyOrder: readonly string[], columns: number): AnnotationItem[] {
  return rankEvents(events, familyOrder).map((e, rank) => {
    const { x, span } = axisOf(e, columns);
    return { id: e.id, x, ...(span ? { span } : {}), rank, width: calloutWidth(e.t, `${e.k} · ${e.d}`) };
  });
}

function Marker({ shape, precision, tone, className }: { shape: string; precision?: string; tone?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`hey-lane-glyph ${className ?? ''}`}
      data-shape={shape}
      data-precision={precision ?? 'EXACT'}
      style={tone ? { color: tone } : undefined}
    />
  );
}

/** "3 commits (2 substantive) · 1 PR merged · Release v0.7.1 14:02": the column's code facts, in words. */
export function codeFacts(model: Pick<ChartModel, 'code' | 'tf'>, at: number, events: readonly LaneEvent[]): string | undefined {
  const code = model.code;
  if (!code) return undefined;
  const unit = model.tf ? 'bar' : 'day';
  if (code.state === 'NO_REPOSITORY') return 'No repository HEY reads for this project';
  if (code.state === 'NOT_READ') return 'Repository not read yet';
  const cell = code.cells[at];
  const parts: string[] = [];
  if (cell === null || cell === undefined) parts.push(`Commits not collected for this ${unit}`);
  else {
    const [commits, substantive, low, , floor] = cell;
    const count = `${commits}${floor ? '+' : ''} commit${commits === 1 && !floor ? '' : 's'}`;
    const detail = [substantive ? `${substantive} substantive` : '', low ? `${low} low-information` : ''].filter(Boolean).join(', ');
    parts.push(commits > 0 && detail ? `${count} (${detail})` : count);
  }
  const prs = code.prs.filter(([column]) => column === at).length;
  if (prs > 0) parts.push(`${prs} PR${prs === 1 ? '' : 's'} merged`);
  for (const e of events) {
    if (e.p !== 'EXACT' || !/^(Release|Prerelease)$/.test(e.k)) continue;
    const time = /(\d{2}:\d{2}) UTC/.exec(e.dl)?.[1];
    parts.push(`${e.k} ${e.t}${time ? ` ${time}` : ''}`);
  }
  return parts.join(' · ');
}

function Readout({
  model,
  at,
  events,
  lens,
  codeOn = false,
}: {
  model: ChartModel;
  at: number;
  events: readonly LaneEvent[];
  lens: ChartLens;
  codeOn?: boolean;
}) {
  const row = model.rows[at]!;
  const date = rowWhen(model, row[0]);
  const money = (v: number | null) => (v === null ? '—' : formatTerminalPrice(v));
  let line1;
  if (row.length === 1) {
    line1 = (
      <span className="text-hey-secondary">
        {model.tf ? 'No bar · the source listed no trade here, or HEY did not read it' : 'No reading · HEY did not read this day'}
      </span>
    );
  } else {
    const [, o, h, l, c, v, , dir] = row;
    const vol = (
      <span className="text-hey-secondary">
        · {model.tf ? 'Vol per bar' : 'Vol'} {typeof v === 'number' ? (formatUsdCompact(v) ?? '—') : '—'}
      </span>
    );
    if (dir === 'x') line1 = <span className="text-hey-secondary">No price recorded</span>;
    else if (dir === 'n' || dir === 'm') {
      line1 = (
        <>
          <span>C {money(c)}</span>
          <span className="text-hey-secondary">
            ·{' '}
            {dir === 'm' ? 'Open and close from different series' : 'Close only · no open recorded'}
          </span>
          {vol}
        </>
      );
    } else {
      const change = o !== null && c !== null && o > 0 ? (c / o - 1) * 100 : undefined;
      line1 = (
        <>
          {dir === 'p' ? <span className="text-hey-secondary">{model.tf ? 'This bar so far ·' : 'Today so far ·'}</span> : null}
          {(
            [
              ['O', o],
              ['H', h],
              ['L', l],
              ['C', c],
            ] as const
          ).map(([k, v]) => (
            <span key={k} className="whitespace-nowrap">
              <span className="text-hey-secondary">{k}</span> {money(v)}
            </span>
          ))}
          {dir === 'p' ? (
            <span className="text-hey-unavailable" data-direction="partial">
              {describeMarketChange(change, barWindow(model)).text} so far
            </span>
          ) : (
            <MarketChange pct={change} window={barWindow(model)} showWindow={false} />
          )}
          {vol}
        </>
      );
    }
  }
  const latestClose = close(model.rows[model.latest]);
  const dayClose = close(row);
  const since =
    events.length > 0 &&
    at !== model.latest &&
    dayClose !== null &&
    latestClose !== null &&
    dayClose > 0
      ? (latestClose / dayClose - 1) * 100
      : undefined;
  return (
    <div
      className="hey-chart-readout grid gap-0.5 text-t-ui tabular-nums text-hey-ink"
      data-testid="chart-readout"
      data-day={row[0]}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 font-mono">
        <span className="hey-chart-kicker font-sans">Market</span>
        <span className="font-sans font-medium">{date}</span>
        {line1}
      </p>
      {lens === 'events' ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-t-meta text-hey-secondary" data-testid="chart-around">
          <span className="hey-chart-kicker">Around this time</span>
          {events.length === 0 ? (
            <span>No build event in view on this {unitOf(model)}.</span>
          ) : (
            <>
              {events.slice(0, 2).map((e) => (
                <span key={e.id} className="inline-flex min-w-0 items-baseline gap-1.5">
                  <Marker shape={e.s} precision={e.p} tone={e.c} />
                  <span className="text-hey-ink">{e.k}</span>·{' '}
                  <span className="max-w-[18rem] truncate text-hey-ink">{e.t}</span>· {spanWords(e)}
                  {e.h ? (
                    <a
                      href={e.h}
                      className="font-medium text-hey-ink underline-offset-2 hover:underline"
                      data-testid="chart-event-link"
                    >
                      Open evidence →
                    </a>
                  ) : null}
                </span>
              ))}
              {events.length > 2 ? <span>+{events.length - 2} more</span> : null}
              {since !== undefined ? (
                <span className="inline-flex items-baseline gap-1">
                  <MarketChange pct={since} window="since event" showWindow={false} size="meta" />{' '}
                  close since {date}, observed, not caused
                </span>
              ) : null}
            </>
          )}
        </p>
      ) : null}
      {lens === 'events' && codeOn && model.code ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-t-meta text-hey-secondary" data-testid="chart-code">
          <span className="hey-chart-kicker">Code</span>
          <span className="text-hey-ink">{codeFacts(model, at, events)}</span>
        </p>
      ) : null}
    </div>
  );
}

/** A week or a window names its span ("wk of 8 Sep"); anything else its precision in words — a date's day-wide span on an intraday axis included. */
const spanWords = (e: Pick<LaneEvent, 'j' | 'p' | 'd' | 'w'>) => (e.j !== undefined && e.p !== 'DATE' && e.p !== 'SCHEDULED' ? e.d : e.w);

/** What the evidence panel prints of an event, on the axis or ahead of it. */
type PanelEvent = Pick<LaneEvent, 'id' | 'k' | 'd' | 'w' | 't' | 'h' | 's' | 'p' | 'c'>;

/** The evidence list for one or more events: a popover on a desktop, a bottom sheet on a phone. */
function EventPanel({
  events,
  title,
  left,
  top,
  around,
  onClose,
}: {
  events: readonly PanelEvent[];
  title: string;
  left: number | null;
  /**
   * What HEY measured before and after the panel's first event that has a
   * reading (2026-10-01): the domain's canonical read, built on the server.
   */
  around?: AroundPanel | undefined;
  /** Opened from a callout: hangs under it. Otherwise it stands on the lane. */
  top?: number;
  onClose: (restore: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const aroundId = around?.eventId;
  useEffect(() => {
    // A reader selected an event whose before-and-after rows HEY holds: one `around_event.opened` per opening (round 2).
    if (aroundId) announceAroundEventOpened('terminal', aroundId);
  }, [aroundId]);
  useEffect(() => {
    // The first evidence link, else the close button.
    (ref.current?.querySelector<HTMLElement>('li a') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    const away = (event: globalThis.PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      data-testid="chart-event-panel"
      className="hey-chart-panel"
      data-anchor={top === undefined ? 'lane' : 'band'}
      {...(around ? { 'data-around': '' } : {})}
      style={
        {
          ...(left === null ? {} : { '--panel-left': `${left}px` }),
          ...(top === undefined ? {} : { '--panel-top': `${top}px` }),
        } as CSSProperties
      }
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose(true);
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="hey-chart-kicker">{title}</p>
        <button type="button" className="hey-chart-panel-close" onClick={() => onClose(true)} aria-label="Close">
          ×
        </button>
      </div>
      <ul className="mt-1.5 grid gap-2">
        {events.map((e) => (
          <li key={e.id} className="grid gap-0.5" data-event-id={e.id}>
            <p className="flex items-center gap-1.5 text-t-meta text-hey-secondary">
              <Marker shape={e.s} precision={e.p} tone={e.c} />
              <span className="font-medium text-hey-ink">{e.k}</span>
              <span>· {e.d}</span>
              {/* "seen 14 Aug", "due 18 Oct" and "wk of 8 Sep" already say their precision. */}
              {e.p === 'EXACT' || e.p === 'DATE' ? <span>· {e.w}</span> : null}
            </p>
            <p className="text-t-ui text-hey-ink">{e.t}</p>
            {e.h ? (
              <a href={e.h} className="text-t-meta font-medium text-hey-ink underline-offset-2 hover:underline" aria-label={`Open evidence: ${e.t}`}>
                Open evidence →
              </a>
            ) : (
              <span className="text-t-meta text-hey-muted">No record to open</span>
            )}
          </li>
        ))}
      </ul>
      {around ? (
        <section className="mt-3 border-t border-hey-border pt-2.5" aria-label={`${around.headings.before} and ${around.headings.after.toLowerCase()}: ${around.title}`} data-testid="chart-around-event" data-event-id={around.eventId}>
          <p className="hey-chart-kicker">{around.headings.around}</p>
          {events.length > 1 ? <p className="mt-0.5 text-t-micro text-hey-muted">{around.title} · {around.when}</p> : null}
          {around.answer ? (
            <p className="mt-1 text-t-meta text-hey-ink" data-testid="chart-around-answer">
              {around.answer}
            </p>
          ) : null}
          <AroundEventRows panel={around} className="mt-2" />
        </section>
      ) : (
        <p className="mt-2 text-t-micro text-hey-muted">Aligned by time. HEY does not infer that an event caused a price move.</p>
      )}
    </div>
  );
}

/**
 * Tells the page's own links (the range and series controls) the reader's
 * current families and lens, so they carry the choice instead of the one the
 * page opened with (review repair, 2026-09-29). A DOM event, so this package
 * names no app component; `hey-chart-choice` with `{ layers, lens }`.
 */
function announceChoice(families: readonly string[], lens: ChartLens) {
  window.dispatchEvent(new CustomEvent('hey-chart-choice', { detail: { layers: families.length ? families.join(',') : 'none', lens } }));
}

/** A lane mark's hit area reaches this far each side of its time, px: 24 px wide when there is room. */
export const LANE_HIT_HALF = 12;
/** A busy day shows its count beside its glyph only with this much room on each side, px. */
export const LANE_COUNT_ROOM = 22;

/**
 * The room beside each day mark on the lane, from the marks' times in px
 * (review repair, 2026-09-29). A mark's invisible hit area reaches
 * `LANE_HIT_HALF` each side — 24 px, the WCAG 2.2 target size — clamped to
 * half the distance to its neighbour, so two targets never take each other's
 * ground; and a busy day prints its count only when the count has room, so a
 * glyph never sits on a neighbour's count.
 */
export function laneRooms(centres: readonly number[]): { left: number; right: number; count: boolean }[] {
  const order = centres.map((x, k) => [x, k] as const).sort((a, b) => a[0] - b[0]);
  const out: { left: number; right: number; count: boolean }[] = centres.map(() => ({ left: LANE_HIT_HALF, right: LANE_HIT_HALF, count: true }));
  order.forEach(([x, k], rank) => {
    const before = rank > 0 ? x - order[rank - 1]![0] : Number.POSITIVE_INFINITY;
    const after = rank < order.length - 1 ? order[rank + 1]![0] - x : Number.POSITIVE_INFINITY;
    out[k] = {
      left: Math.round(Math.min(LANE_HIT_HALF, before / 2) * 100) / 100,
      right: Math.round(Math.min(LANE_HIT_HALF, after / 2) * 100) / 100,
      count: Math.min(before, after) >= LANE_COUNT_ROOM,
    };
  });
  return out;
}

/** Roving focus inside a group: one tab stop, arrow keys between items. */
function useRoving(count: number) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const index = Math.min(active, Math.max(0, count - 1));
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      let next: number | undefined;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(count - 1, index + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = count - 1;
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      setActive(next);
      refs.current[next]?.focus();
    },
    [count, index],
  );
  return { index, setActive, refs, onKeyDown };
}

/**
 * The code lane (2026-09-29): under the volume bars and over the event lane,
 * one column per bar. Bar height is the column's commits against the range's
 * busiest column; the fill says what they changed — solid substantive,
 * hatched low-information, dashed not yet read — in neutral ink, never a
 * market colour. A column before the counts start has no baseline at all
 * (absent is not zero); a measured column with no commit keeps the baseline.
 * Merged pull requests are ticks above, at their minute. Decorative for a
 * screen reader: the readout says the same facts in words for the column in
 * focus, and the keyboard moves it.
 */
const CODE_H = 24;

function CodeLane({ code, n, unit }: { code: CodeLaneModel; n: number; unit: string }) {
  if (code.state !== 'MEASURED') {
    return (
      <div className="hey-code-lane relative mt-1 flex h-6 items-center" data-testid="code-lane" data-state={code.state}>
        <span className="text-t-micro text-hey-muted">
          {code.state === 'NO_REPOSITORY' ? 'Code · no repository HEY reads for this project' : 'Code · repository not read yet'}
        </span>
      </div>
    );
  }
  const col = (i: number) => (i / n) * 100;
  /* Measured runs keep a baseline; the first unmeasured run is named when it is wide enough to carry words. */
  const runs: { from: number; to: number; measured: boolean }[] = [];
  code.cells.forEach((cell, i) => {
    const measured = cell !== null;
    const last = runs[runs.length - 1];
    if (last && last.measured === measured) last.to = i;
    else runs.push({ from: i, to: i, measured });
  });
  const max = Math.max(1, code.max);
  return (
    <div
      aria-hidden="true"
      className="hey-code-lane relative mt-1"
      style={{ height: CODE_H }}
      data-testid="code-lane"
      data-state={code.state}
      data-total={code.total}
    >
      {runs.map((run) =>
        run.measured ? (
          <span key={`b-${run.from}`} className="hey-code-base" style={{ left: `${col(run.from)}%`, width: `${col(run.to + 1) - col(run.from)}%` }} />
        ) : run.to - run.from + 1 >= n * 0.15 ? (
          <span key={`a-${run.from}`} className="hey-code-absent text-t-micro" style={{ left: `${col(run.from)}%`, width: `${col(run.to + 1) - col(run.from)}%` }}>
            Not collected before this {unit}
          </span>
        ) : null,
      )}
      {code.cells.map((cell, i) => {
        if (!cell || cell[0] === 0) return null;
        const [commits, substantive, low, unknown] = cell;
        const height = Math.max(3, Math.round((commits / max) * (CODE_H - 6)));
        const part = (value: number) => (commits === 0 ? 0 : (value / commits) * height);
        return (
          <span key={i} className="hey-code-col" style={{ left: `${col(i)}%`, width: `${100 / n}%`, height }} data-commits={commits} data-floor={cell[4] ? '' : undefined}>
            {substantive ? <span className="hey-code-part" data-kind="substantive" style={{ height: part(substantive) }} /> : null}
            {low ? <span className="hey-code-part" data-kind="low" style={{ height: part(low) }} /> : null}
            {unknown ? <span className="hey-code-part" data-kind="unknown" style={{ height: part(unknown) }} /> : null}
          </span>
        );
      })}
      {code.prs.map(([i, f], k) => (
        <span key={`p-${k}`} className="hey-code-pr" data-testid="code-lane-pr" style={{ left: `${((i + f) / n) * 100}%` }} />
      ))}
    </div>
  );
}

export function TerminalChartInteractive({
  model,
  summary,
  symbol,
  className,
  initialFamilies,
  initialLens = 'events',
  familiesFromUrl = false,
  lensFromUrl = false,
  familyParam = 'layers',
  choiceKey,
  aroundPanels,
}: {
  model: ChartModel;
  /** Before and after each build event, by its typed id (2026-10-01); absent draws the panel without it. */
  aroundPanels?: Readonly<Record<string, AroundPanel>> | undefined;
  summary: string;
  symbol?: string;
  /**
   * What this session's family choice is kept under: the project (its slug,
   * or its chain and contract), never the ticker, which two projects can
   * share (review repair, 2026-09-29).
   */
  choiceKey?: string;
  className?: string;
  /** The families on when the page opened (the URL's, else the defaults). */
  initialFamilies?: readonly string[];
  initialLens?: ChartLens;
  /** Whether the URL named them: if not, this session's last choice is restored after hydration. */
  familiesFromUrl?: boolean;
  lensFromUrl?: boolean;
  /** The query parameter the families live in. */
  familyParam?: string;
}) {
  const { paths, y, cw } = useMemo(() => draw(model), [model]);
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState(model.initial);
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [table, setTable] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialFamilies ?? model.families.map((f) => f.key)),
  );
  const [lens, setLens] = useState<ChartLens>(initialLens);
  const [width, setWidth] = useState<number | null>(null);
  const [wide, setWide] = useState(false);
  const [hi, setHi] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ ids: string[]; title: string; left: number | null; top?: number } | null>(null);
  const [overBand, setOverBand] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const frame = useRef(0);

  const n = model.rows.length;
  const at = hover ?? pin;
  const x = (i: number) => pct(cw * (i + 0.5), W);
  const lastMark = lastCloseMark(model.rows);
  const lastClose = lastMark?.close ?? null;
  const showCross = hover !== null || active;
  const familyOrder = useMemo(() => model.families.map((f) => f.key), [model.families]);
  /* The callouts' research rank: the families' own `rank`, else their chip order. */
  const rankOrder = useMemo(() => calloutRankOrder(model.families), [model.families]);
  const storageKey = `hey-chart-events:${choiceKey ?? symbol ?? ''}`;

  /* The code lane is on while its chip is, in the events lens (2026-09-29). */
  const laneKey = model.families.find((family) => family.codeLane)?.key;
  const codeOn = Boolean(model.code && laneKey && lens === 'events' && selected.has(laneKey));
  const noCallout = useMemo(() => new Set(model.families.filter((family) => family.noCallout).map((family) => family.key)), [model.families]);

  /* The events in view: the lens and the chips, over the one lane the server placed. */
  const visible = useMemo(
    () => (lens === 'events' ? model.lane.filter((e) => selected.has(e.fam)) : []),
    [lens, model.lane, selected],
  );
  const visibleAhead = useMemo(
    () => (lens === 'events' ? model.ahead.filter((e) => selected.has(e.fam)) : []),
    [lens, model.ahead, selected],
  );
  const byId = useMemo(() => new Map(visible.map((e) => [e.id, e])), [visible]);
  const around = (column: number) => visible.filter((e) => coversColumn(e, column));
  const atEvents = around(at);
  const nearIds = useMemo(
    () => new Set(showCross ? visible.filter((e) => coversColumn(e, at)).map((e) => e.id) : []),
    [showCross, visible, at],
  );

  /* The plot's width and whether the callouts are drawn at all (768px and up). */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const media = window.matchMedia('(min-width: 768px)');
    const measure = () => {
      setWidth(Math.round(stage.clientWidth));
      setWide(media.matches);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    media.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', measure);
    };
  }, []);

  /* This session's last choice, when the URL named none (after hydration, so the server's HTML still matches). */
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as { families?: string[]; lens?: ChartLens } | null;
      const families = saved && !familiesFromUrl && Array.isArray(saved.families) ? saved.families : undefined;
      const savedLens = saved && !lensFromUrl && (saved.lens === 'events' || saved.lens === 'market') ? saved.lens : undefined;
      if (families) setSelected(new Set(families));
      if (savedLens) setLens(savedLens);
      if (families || savedLens) {
        announceChoice(
          families ?? familyOrder.filter((key) => selected.has(key)),
          savedLens ?? lens,
        );
      }
    } catch {
      /* storage unavailable: the URL and the defaults still apply */
    }
    // Only on mount: later changes are the reader's own.
  }, []);

  /* The choice, kept for this session: in the URL (shareable, and read by the server) and in session storage. */
  const persist = (families: ReadonlySet<string>, nextLens: ChartLens) => {
    try {
      const url = new URL(window.location.href);
      const keys = familyOrder.filter((key) => families.has(key));
      url.searchParams.set(familyParam, keys.length ? keys.join(',') : 'none');
      if (nextLens === 'market') url.searchParams.set('lens', 'market');
      else url.searchParams.delete('lens');
      window.history.replaceState(window.history.state, '', url);
      announceChoice(keys, nextLens);
      sessionStorage.setItem(storageKey, JSON.stringify({ families: keys, lens: nextLens }));
    } catch {
      /* private mode: the choice lasts until the page is left */
    }
  };
  const toggleFamily = (key: string) => {
    const next = new Set(selected);
    if (next.has(key) && lens === 'events') next.delete(key);
    else next.add(key);
    setSelected(next);
    // Choosing a family asks to see events: it switches the lens back on.
    setLens('events');
    persist(next, 'events');
  };
  const chooseLens = (next: ChartLens) => {
    setLens(next);
    setPanel(null);
    persist(selected, next);
  };

  /* The callouts: laid out once the width is known, from time, rank and width only. */
  /* A steady rollup keeps its lane mark and takes no callout (the code family's weeks). */
  const calloutable = useMemo(() => visible.filter((e) => !noCallout.has(e.fam)), [visible, noCallout]);
  const bands = wide ? bandsFor(calloutable.length) : 0;
  const reservedBands = bandsFor(calloutable.length);
  const layout: AnnotationLayout | null = useMemo(() => {
    if (width === null || !wide || bands === 0) return null;
    return layoutAnnotations(annotationItems(calloutable, rankOrder, n), {
      plotWidth: width,
      bands,
      maxCallouts: width < 900 ? 7 : width < 1200 ? 10 : 12,
    });
  }, [width, wide, bands, calloutable, rankOrder, n]);
  const marks = useMemo(
    () =>
      layout
        ? [
            ...layout.callouts.map((c) => ({ ...c, ids: [c.id, ...c.more] })),
            ...layout.clusters,
          ].sort((a, b) => a.left - b.left || a.band - b.band)
        : [],
    [layout],
  );
  /* The bands the layout used, in order from the plot up: row ranks with no empty row between them. */
  const rankOf = useMemo(() => {
    const used = [...new Set(marks.map((mark) => mark.band))].sort((a, b) => a - b);
    return new Map(used.map((band, rank) => [band, rank]));
  }, [marks]);
  const topOf = (band: number) => rowTop(bands, rankOf.get(band) ?? band);
  const folded = marks.reduce((sum, mark) => sum + (mark.kind === 'cluster' ? mark.ids.length : mark.ids.length - 1), 0);
  /* One tab stop for the band; arrows walk every callout, its "+N" and every chip, left to right. */
  const calloutRoving = useRoving(marks.reduce((sum, mark) => sum + (mark.kind === 'callout' && mark.ids.length > 1 ? 2 : 1), 0));

  /* The lane: events that share a day are one mark; a week or a window is its own bracket. */
  const laneGroups = useMemo(() => {
    const points = new Map<number, LaneEvent[]>();
    const spans: LaneEvent[] = [];
    for (const e of visible) {
      if (e.j !== undefined) spans.push(e);
      else points.set(e.i, [...(points.get(e.i) ?? []), e]);
    }
    return [
      ...spans.map((e) => ({ key: `s-${e.id}`, i: e.i, j: e.j!, events: [e] })),
      ...[...points].map(([i, events]) => ({ key: `p-${i}`, i, j: i, events })),
    ].sort((a, b) => a.i - b.i || a.j - b.j);
  }, [visible]);
  const laneRoving = useRoving(laneGroups.length + (visibleAhead.length ? 1 : 0));
  /* Each day mark's time in px and the room beside it: its hit area and whether its count fits. */
  const laneRoom = useMemo(() => {
    const points = laneGroups.filter((group) => group.j === group.i);
    const centres = points.map((group) => {
      const e0 = group.events[0]!;
      return ((group.i + (group.events.length === 1 && e0.p === 'EXACT' && e0.f !== undefined ? e0.f : 0.5)) / n) * (width ?? 0);
    });
    const room = width === null ? [] : laneRooms(centres);
    return new Map(points.map((group, k) => [group.key, room[k]]));
  }, [laneGroups, n, width]);

  const indexAt = (clientX: number): number | undefined => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return undefined;
    return Math.min(n - 1, Math.max(0, Math.floor(((clientX - box.left) / box.width) * n)));
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event;
    const inBand = Boolean((event.target as HTMLElement).closest?.('[data-chart-band]'));
    if (inBand !== overBand) setOverBand(inBand);
    if (inBand) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const i = indexAt(clientX);
      if (i !== undefined) setHover(i);
      const box = plotRef.current?.getBoundingClientRect();
      const line = lineRef.current;
      const pill = pillRef.current;
      if (!box || !line || !pill) return;
      const offset = clientY - box.top;
      const plotPx = (PLOT / H) * box.height;
      const inside = offset >= 0 && offset <= plotPx;
      line.style.display = pill.style.display = inside ? '' : 'none';
      clearTicksUnder(inside ? offset : null, box.height);
      if (!inside) return;
      line.style.transform = `translateY(${offset}px)`;
      pill.style.top = `${offset}px`;
      pill.textContent = formatTerminalPrice(
        model.lo + ((plotPx - offset) / plotPx) * (model.hi - model.lo),
      );
    });
  };

  /*
   * The crosshair's price label sits in the scale's gutter: the axis tick it
   * would cover steps aside while it is there, so two prices never print over
   * each other (review repair, 2026-09-29). Written to the DOM, like the line.
   */
  const clearTicksUnder = (offset: number | null, height: number) => {
    for (const tick of scaleRef.current?.querySelectorAll<HTMLElement>('[data-tick-y]') ?? []) {
      const at = (Number(tick.dataset.tickY) / H) * height;
      tick.style.visibility = offset !== null && Math.abs(at - offset) < TICK_CLEARANCE ? 'hidden' : '';
    }
  };

  /*
   * Leaving the plot keeps the day the reader was on: the readout's "Open
   * evidence" sits above the plot, and reverting on the way to it would take
   * the link away before it could be clicked. Esc returns to the latest day.
   */
  const onLeave = () => {
    cancelAnimationFrame(frame.current);
    if (hover !== null) setPin(hover);
    setHover(null);
    setOverBand(false);
    if (lineRef.current) lineRef.current.style.display = 'none';
    if (pillRef.current) pillRef.current.style.display = 'none';
    clearTicksUnder(null, 0);
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest?.('[data-chart-band], [data-testid=lane-marker], [data-testid=chart-event-panel]')) return;
    const i = indexAt(event.clientX);
    if (i === undefined) return;
    setPin(i);
    setActive(true);
  };

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    // Keys inside the callouts, the lane, the filters or the panel are theirs.
    if (event.target !== event.currentTarget) return;
    const from = hover ?? pin;
    let next: number | undefined;
    if (event.key === 'ArrowLeft') next = Math.max(0, from - 1);
    else if (event.key === 'ArrowRight') next = Math.min(n - 1, from + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else if (event.key === 'Escape') next = model.latest;
    else if (event.key === 'Enter') {
      const href = around(from).find((e) => e.h)?.h;
      if (href) window.location.assign(href);
      return;
    } else return;
    event.preventDefault();
    setHover(null);
    setPin(next);
    setActive(event.key !== 'Escape');
  };

  const openPanel = (ids: string[], title: string, left: number | null, from: HTMLElement, top?: number) => {
    invoker.current = from;
    setPanel({ ids, title, left, ...(top === undefined ? {} : { top }) });
  };
  const closePanel = useCallback((restore: boolean) => {
    setPanel(null);
    if (restore) invoker.current?.focus();
  }, []);

  let prevMonth = -1;
  const months = model.months.filter(([i]) => {
    // An intraday label ("29 Sep", "18:00") is wider than a month word: it needs more room (2026-09-29).
    const keep = prevMonth < 0 || (i - prevMonth) / n > (model.tf ? 0.14 : 0.07);
    if (keep) prevMonth = i;
    return keep && i / n < 0.95;
  });
  /* The phone's list under the chart: the newest nine day-placed events in view, each with its evidence. */
  const numbered = visible.filter((e) => e.j === undefined || e.p === 'DATE' || e.p === 'SCHEDULED').slice(-9).reverse();
  const hiEvent = hi ? (byId.get(hi) ?? null) : null;
  const hoverRow = hover !== null ? model.rows[hover] : undefined;
  const hoverEvents = hover !== null ? around(hover) : [];
  const panelEvents: PanelEvent[] = panel
    ? panel.ids
        .map((id): PanelEvent | undefined => byId.get(id) ?? model.ahead.find((e) => e.id === id))
        .filter((e): e is PanelEvent => e !== undefined)
    : [];
  const hidden = model.lane.length + model.ahead.length - visible.length - visibleAhead.length;

  const tableRows = model.rows.slice(-30).reverse();
  const tableEvents = (column: number) => visible.filter((e) => e.i === column);

  return (
    <figure
      tabIndex={0}
      onKeyDown={onKey}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      data-testid="market-chart"
      data-lens={lens}
      className={`hey-chart m-0 rounded-card outline-none focus-visible:ring-2 focus-visible:ring-hey-ink focus-visible:ring-offset-2 focus-visible:ring-offset-hey-surface ${className ?? ''}`}
    >
      {model.families.length > 0 || model.lane.length > 0 ? (
        <div className="hey-chart-filters" data-testid="chart-event-filters">
          <div className="hey-chart-lens" role="group" aria-label="Chart lens">
            <button type="button" aria-pressed={lens === 'market'} onClick={() => chooseLens('market')} data-testid="lens-market">
              Market only
            </button>
            {/* One name at every width (review repair, 2026-09-29): the phone's short label is for the eye only. */}
            <button type="button" aria-pressed={lens === 'events'} onClick={() => chooseLens('events')} data-testid="lens-events">
              <span className="max-sm:sr-only">Market + build events</span>
              <span aria-hidden="true" className="sm:hidden">
                + Events
              </span>
            </button>
          </div>
          <div className="hey-chart-chips" data-scroll-cue="" role="group" aria-label="Event families on the chart">
            {model.families.map((family) => {
              const on = lens === 'events' && selected.has(family.key);
              return (
                <button
                  key={family.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleFamily(family.key)}
                  data-family={family.key}
                  data-testid="chart-family-chip"
                  className="hey-chart-chip"
                  aria-label={`${family.label}${family.count > 0 ? `, ${family.count} in range` : ''}${family.codeLane ? ', and the code lane' : ''}, ${on ? 'shown' : 'hidden'}`}
                >
                  <Marker shape={family.shape} tone={family.tone} />
                  <span>{family.label}</span>
                  {family.count > 0 ? <span className="hey-chart-chip-count">{family.count}</span> : null}
                </button>
              );
            })}
          </div>
          <details className="hey-chart-info" data-testid="chart-method-note">
            <summary aria-label="How events are placed">
              <span aria-hidden="true" className="hey-chart-info-mark">
                i
              </span>
              <span className="max-md:hidden">How events are placed</span>
            </summary>
            <div className="hey-chart-info-body">
              <p className="text-hey-ink">
                Events are aligned by time to market history. HEY does not infer that an event caused a price move.
              </p>
              <p className="mt-1.5">
                A callout&rsquo;s height is layout only; its stem ends at the event lane, never at a price.
                Dense periods fold into &ldquo;+N changes&rdquo;.
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <li className="flex items-center gap-2"><Marker shape="circle" precision="EXACT" />Exact time</li>
                <li className="flex items-center gap-2"><Marker shape="circle" precision="DATE" />Date only</li>
                <li className="flex items-center gap-2"><Marker shape="circle" precision="OBSERVED" />Seen by HEY</li>
                <li className="flex items-center gap-2"><Marker shape="circle" precision="SCHEDULED" />Scheduled</li>
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-[6px] w-5 border border-t-0 border-hey-ink" />A week
                </li>
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block h-[6px] w-5 border border-dashed border-t-0 border-hey-ink" />A window
                </li>
              </ul>
            </div>
          </details>
        </div>
      ) : null}

      <div aria-live={focused ? 'polite' : 'off'} className="mb-3 min-h-[4.5rem] sm:min-h-10">
        <Readout model={model} at={at} events={atEvents} lens={lens} codeOn={codeOn} />
      </div>

      {/*
        The price scale has its own gutter at every width (review repairs,
        2026-09-26). Below 1024px it used to sit inside the plot on a
        translucent chip, over the newest candles — the ones a reader looks at
        first — and the last-close tag hid the latest candle outright.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_52px] gap-x-1 lg:grid-cols-[minmax(0,1fr)_64px] lg:gap-x-2">
        <div
          ref={stageRef}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          onPointerDown={onDown}
          className="hey-chart-stage relative touch-pan-y select-none"
        >
          {/* The callout band: reserved at the same height on the server and in the browser, so nothing jumps. */}
          {reservedBands > 0 ? (
            <div
              data-chart-band=""
              className="relative max-md:hidden"
              style={{ height: bandHeight(reservedBands) }}
              onPointerLeave={() => setHi(null)}
            >
              {marks.length > 0 ? (
                <div
                  role="group"
                  aria-label={`Build events on the chart: ${layout!.callouts.length} labelled, ${folded} more counted beside them. Arrow keys move between them.`}
                  onKeyDown={calloutRoving.onKeyDown}
                  data-testid="chart-callouts"
                >
                  {(() => {
                    let slot = 0;
                    const focusable = () => {
                      const index = slot++;
                      return {
                        ref: (node: HTMLElement | null) => {
                          calloutRoving.refs.current[index] = node;
                        },
                        tabIndex: index === calloutRoving.index ? 0 : -1,
                        onFocus: () => calloutRoving.setActive(index),
                      };
                    };
                    return marks.map((mark) => {
                      const top = topOf(mark.band);
                      const box = { left: mark.left, top, width: mark.width, height: ROW_H } as CSSProperties;
                      const members = mark.ids.map((id) => byId.get(id)).filter((e): e is LaneEvent => Boolean(e));
                      /* In time order: a stretch of time is read left to right. */
                      const inTime = [...members].sort((a, b) => a.i + (a.f ?? 0.5) - (b.i + (b.f ?? 0.5)) || (a.id < b.id ? -1 : 1));
                      const first = inTime[0]!;
                      const lastM = inTime.reduce((a, b) => ((a.j ?? a.i) >= (b.j ?? b.i) ? a : b), first);
                      const range = first.d === lastM.d ? first.d : `${first.d} – ${lastM.d}`;
                      const open = (from: HTMLElement, title: string) =>
                        openPanel(
                          inTime.map((e) => e.id),
                          title,
                          Math.max(0, Math.min((width ?? 0) - 300, mark.left + mark.width / 2 - 150)),
                          from,
                          top + ROW_H + 6,
                        );
                      if (mark.kind === 'cluster') {
                        return (
                          <button
                            key={`c-${mark.ids[0]}`}
                            type="button"
                            {...focusable()}
                            style={box}
                            className="hey-chart-cluster"
                            data-testid="chart-cluster"
                            data-count={mark.ids.length}
                            aria-expanded={panel?.ids.join() === inTime.map((e) => e.id).join()}
                            aria-label={`${clusterLabel(mark.ids.length)} between ${first.dl} and ${lastM.dl}. Opens the list.`}
                            onPointerEnter={() => setHi(mark.ids[0]!)}
                            onClick={(event) => open(event.currentTarget, `${clusterLabel(mark.ids.length)} · ${range}`)}
                          >
                            <span className="font-medium">{clusterLabel(mark.ids.length)}</span>
                          </button>
                        );
                      }
                      const e = byId.get(mark.id)!;
                      const extra = mark.ids.length - 1;
                      return (
                        <div
                          key={e.id}
                          style={box}
                          className="hey-chart-callout"
                          data-testid="chart-callout"
                          data-family={e.fam}
                          data-precision={e.p}
                          data-event-id={e.id}
                          data-more={extra || undefined}
                          data-hi={mark.ids.includes(hi ?? '') ? '' : undefined}
                          data-near={mark.ids.some((id) => nearIds.has(id)) ? '' : undefined}
                          onPointerEnter={() => setHi(e.id)}
                        >
                          <a
                            href={e.h ?? '#'}
                            {...focusable()}
                            className="hey-chart-callout-link"
                            aria-label={eventLabel(e)}
                            onFocus={(event) => {
                              calloutRoving.setActive(calloutRoving.refs.current.indexOf(event.currentTarget));
                              setHi(e.id);
                            }}
                            onBlur={() => setHi(null)}
                          >
                            <span className="hey-chart-callout-meta">
                              <Marker shape={e.s} precision={e.p} tone={e.c} />
                              <span className="truncate">
                                {e.k} · {e.d}
                              </span>
                              {extra ? null : (
                                <span aria-hidden="true" className="ml-auto pl-1">
                                  →
                                </span>
                              )}
                            </span>
                            <span className="hey-chart-callout-title">{e.t}</span>
                          </a>
                          {extra ? (
                            <button
                              type="button"
                              {...focusable()}
                              className="hey-chart-callout-more"
                              data-testid="chart-callout-more"
                              data-count={extra}
                              aria-label={`${extra} more around this time, ${range}: ${inTime
                                .filter((m) => m.id !== e.id)
                                .map((m) => `${m.k}: ${m.t}`)
                                .join('; ')}. Opens the list.`}
                              onClick={(event) => open(event.currentTarget, `${mark.ids.length} events · ${range}`)}
                            >
                              +{extra}
                            </button>
                          ) : null}
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Stems: from each callout down to the event lane, at the event's time. Under the candles, never ending on one. */}
          {layout && marks.length > 0 ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 max-md:hidden" data-testid="chart-stems">
              {marks.map((mark) => {
                const bottom = topOf(mark.band) + ROW_H;
                const e = mark.kind === 'callout' ? byId.get(mark.ids[0]!) : undefined;
                const span = mark.kind === 'cluster' ? ([mark.from, mark.to] as const) : e ? (() => {
                  const axis = axisOf(e, n);
                  return axis.span ? ([axis.span[0] * (width ?? 0), axis.span[1] * (width ?? 0)] as const) : undefined;
                })() : undefined;
                const lit = mark.ids.some((id) => id === hi);
                const dashed = e ? e.p === 'OBSERVED' || e.p === 'WINDOW' || e.p === 'SCHEDULED' : false;
                const bracket = Boolean(span && span[1] - span[0] > 2);
                /* A chip — or a lone callout with no room over its time — set beside its time joins it by a dotted connector. */
                const centre = mark.left + mark.width / 2;
                const off = mark.anchor < mark.left || mark.anchor > mark.left + mark.width;
                const level = bottom + 3;
                return (
                  <span key={`s-${mark.ids[0]}`}>
                    {bracket ? (
                      <span
                        className="hey-chart-bracket"
                        data-dashed={e?.p === 'WINDOW' ? '' : undefined}
                        data-hi={lit ? '' : undefined}
                        style={{ left: span![0], width: span![1] - span![0], top: level - 3 }}
                      />
                    ) : null}
                    {off ? (
                      <>
                        <span className="hey-chart-stem" data-hi={lit ? '' : undefined} style={{ left: centre, top: bottom, height: 3 }} />
                        <span
                          className="hey-chart-connector"
                          data-hi={lit ? '' : undefined}
                          style={{ left: Math.min(centre, mark.anchor), width: Math.abs(mark.anchor - centre), top: level }}
                        />
                      </>
                    ) : null}
                    <span
                      className="hey-chart-stem"
                      data-dashed={dashed ? '' : undefined}
                      data-hi={lit ? '' : undefined}
                      data-anchor={mark.anchor}
                      style={{ left: mark.anchor, top: bracket || off ? level : bottom, bottom: LANE_MID_FROM_BOTTOM }}
                    />
                  </span>
                );
              })}
            </div>
          ) : null}

          <div
            ref={plotRef}
            className="@container relative h-[min(56vh,320px)] sm:h-[360px]"
            style={{ '--bw': `clamp(1px, calc(70cqw / ${n}), 14px)` } as CSSProperties}
          >
            {hiEvent ? (
              <div
                aria-hidden="true"
                className="hey-chart-colband pointer-events-none absolute inset-y-0"
                data-testid="chart-colband"
                style={{ left: pct(cw * hiEvent.i, W), width: pct(cw * ((hiEvent.j ?? hiEvent.i) - hiEvent.i + 1), W) }}
              />
            ) : null}
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              data-plot=""
              className="absolute inset-0 block h-full w-full"
            >
              <g fill="none">
                <path
                  d={paths.grid}
                  stroke="var(--hey-chart-grid)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={paths.months}
                  stroke="var(--hey-chart-grid)"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={paths.vu}
                  stroke={VOL.u}
                  style={{ strokeWidth: 'var(--bw)' }}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={paths.vd}
                  stroke={VOL.d}
                  style={{ strokeWidth: 'var(--bw)' }}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={paths.vf}
                  stroke="var(--hey-market-flat-vol)"
                  style={{ strokeWidth: 'var(--bw)' }}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={paths.uw}
                  stroke={TONE.u}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  data-dir="up"
                />
                <path
                  d={paths.ub}
                  stroke={TONE.u}
                  style={{ strokeWidth: 'var(--bw)' }}
                  vectorEffect="non-scaling-stroke"
                  data-dir="up"
                />
                <path
                  d={paths.dw}
                  stroke={TONE.d}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  data-dir="down"
                />
                <path
                  d={paths.db}
                  stroke={TONE.d}
                  style={{ strokeWidth: 'var(--bw)' }}
                  vectorEffect="non-scaling-stroke"
                  data-dir="down"
                />
                <path
                  d={paths.fw}
                  stroke="var(--hey-market-flat)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  data-dir="flat"
                />
                <path
                  d={paths.ft}
                  stroke="var(--hey-market-flat)"
                  style={{ strokeWidth: 'var(--bw)' }}
                  vectorEffect="non-scaling-stroke"
                  data-dir="flat"
                />
                <path
                  d={paths.nt}
                  stroke="var(--hey-market-flat)"
                  style={{ strokeWidth: 'calc(var(--bw) * 0.6)' }}
                  vectorEffect="non-scaling-stroke"
                  data-dir="unknown"
                />
                <path
                  d={paths.po}
                  stroke="var(--hey-market-flat)"
                  style={{ strokeWidth: 'var(--bw)' }}
                  vectorEffect="non-scaling-stroke"
                  data-dir="partial"
                />
                <path
                  d={paths.pi}
                  stroke="var(--hey-surface)"
                  style={{ strokeWidth: 'calc(var(--bw) - 2px)' }}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            </svg>

            {/* Price scale: in its own column beside the plot, 52px below 1024px and 64px from there. */}
            <div
              ref={scaleRef}
              aria-hidden="true"
              className="pointer-events-none font-mono text-t-micro tabular-nums text-hey-muted"
            >
              {model.ticks.map(([v, label]) =>
                y(v) > 8 &&
                y(v) < PLOT - 4 &&
                (lastClose === null || Math.abs(y(v) - y(lastClose)) > 16) ? (
                  <span
                    key={v}
                    data-tick-y={y(v)}
                    className="absolute left-[calc(100%+4px)] -translate-y-1/2 whitespace-nowrap lg:left-[calc(100%+8px)]"
                    style={{ top: pct(y(v), H) }}
                  >
                    {label}
                  </span>
                ) : null,
              )}
              {model.volLabel ? (
                <span
                  className="absolute left-[calc(100%+4px)] whitespace-nowrap lg:left-[calc(100%+8px)]"
                  style={{ top: pct(VOL_TOP + 2, H) }}
                >
                  {model.volLabel}
                </span>
              ) : null}
            </div>

            {model.gapRuns.map(([a, b, label]) => (
              <span
                key={a}
                className="pointer-events-none absolute top-1.5 -translate-x-1/2 whitespace-nowrap rounded-[3px] bg-hey-surface/85 px-1 text-t-micro text-hey-muted"
                style={{ left: pct(cw * ((a + b + 1) / 2), W) }}
              >
                {model.tf ? 'No bars' : 'No readings'} · {label}
              </span>
            ))}

            {atEvents.length > 0 ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 border-l border-dashed border-hey-border-strong"
                style={{ left: x(at) }}
              />
            ) : null}
            {showCross ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-[var(--hey-chart-crosshair)]"
                style={{ left: x(at) }}
              />
            ) : null}
            <div
              ref={lineRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--hey-chart-crosshair)]"
              style={{ display: 'none' }}
            />

            {/* The floating readout: the hovered day's market facts and what HEY holds around it. Pointer only; the readout above is the accessible one. */}
            {hover !== null && hoverRow && !overBand ? (
              <div
                aria-hidden="true"
                data-testid="chart-hover-card"
                className="hey-chart-hovercard"
                data-side={hover / n > 0.6 ? 'left' : 'right'}
                style={{ left: x(hover) }}
              >
                <p className="font-medium text-hey-ink">{rowWhen(model, hoverRow[0])}</p>
                <p className="hey-chart-kicker mt-1">Market</p>
                {hoverRow.length === 1 ? (
                  <p className="text-hey-secondary">{model.tf ? 'No bar · no candle drawn' : 'No reading · no candle drawn'}</p>
                ) : hoverRow[4] === null ? (
                  <p className="text-hey-secondary">No price recorded</p>
                ) : (
                  <p className="font-mono tabular-nums text-hey-ink">
                    {hoverRow[1] !== null ? `O ${formatTerminalPrice(hoverRow[1])} ` : ''}C {formatTerminalPrice(hoverRow[4])}
                    <span className="text-hey-secondary"> · {DIRECTION_WORD[hoverRow[7]]}</span>
                  </p>
                )}
                {lens === 'events' ? (
                  <>
                    <p className="hey-chart-kicker mt-1.5">Around this time</p>
                    {hoverEvents.length === 0 ? (
                      <p className="text-hey-secondary">No build event in view</p>
                    ) : (
                      <ul className="grid gap-0.5">
                        {hoverEvents.slice(0, 3).map((e) => (
                          <li key={e.id} className="flex min-w-0 items-center gap-1.5">
                            <Marker shape={e.s} precision={e.p} tone={e.c} />
                            <span className="truncate text-hey-ink">
                              {e.k}: {e.t}
                            </span>
                          </li>
                        ))}
                        {hoverEvents.length > 3 ? <li className="text-hey-secondary">+{hoverEvents.length - 3} more</li> : null}
                      </ul>
                    )}
                    {codeOn && model.code ? <p className="mt-1 text-hey-secondary">Code · {codeFacts(model, hover, hoverEvents)}</p> : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {lastMark ? (
              <span
                aria-hidden="true"
                data-testid="last-close"
                data-direction={lastMark.direction}
                className="pointer-events-none absolute left-[calc(100%+2px)] -translate-y-1/2 whitespace-nowrap rounded-[var(--hey-radius-tooltip)] px-1 py-0.5 font-mono text-t-micro font-medium tabular-nums lg:left-[calc(100%+4px)] lg:px-1.5"
                style={{
                  top: pct(y(lastMark.close), H),
                  background:
                    lastMark.direction === 'up' ? TONE.u : lastMark.direction === 'down' ? TONE.d : 'var(--hey-market-flat)',
                  color: 'var(--hey-on-market)',
                }}
              >
                {lastMark.arrow ? `${lastMark.arrow} ` : ''}
                {formatTerminalPrice(lastMark.close)}
              </span>
            ) : null}
            <span
              ref={pillRef}
              aria-hidden="true"
              className="pointer-events-none absolute left-[calc(100%+2px)] z-10 -translate-y-1/2 whitespace-nowrap rounded-[var(--hey-radius-tooltip)] bg-[var(--hey-tooltip-bg)] px-1 py-0.5 font-mono text-t-micro tabular-nums text-[var(--hey-tooltip-ink)] lg:left-[calc(100%+4px)] lg:px-1.5"
              style={{ display: 'none' }}
            />
          </div>

          {codeOn && model.code ? <CodeLane code={model.code} n={n} unit={unitOf(model)} /> : null}

          {/*
            The event lane: the canonical anchor every callout's stem ends on.
            No price coordinate, ink at rest, the family tone for the day in
            focus and the event under a hovered callout. Each mark is a button
            that opens its evidence; the lane is one tab stop, arrows move.
          */}
          <div
            className="hey-chart-lane relative mt-1.5 h-5"
            data-testid="event-lane"
            role={laneGroups.length || visibleAhead.length ? 'group' : undefined}
            aria-label={laneGroups.length || visibleAhead.length ? `Event lane: ${visible.length} event${visible.length === 1 ? '' : 's'} in view. Arrow keys move, Enter opens.` : undefined}
            onKeyDown={laneRoving.onKeyDown}
          >
            {laneGroups.map((group, k) => {
              const span = group.j > group.i;
              const e0 = group.events[0]!;
              const room = span ? undefined : laneRoom.get(group.key);
              const lit = group.events.some((e) => e.id === hi || nearIds.has(e.id)) || (group.i <= at && at <= group.j && (hover !== null || active));
              const title =
                group.events.length === 1
                  ? eventLabel(e0)
                  : `${group.events.length} events on ${e0.dl.replace(/, .*$/, '')}: ${group.events.map((e) => `${e.k}: ${e.t}`).join('; ')}. Opens the list.`;
              return (
                <button
                  key={group.key}
                  type="button"
                  data-testid="lane-marker"
                  data-span={span ? '' : undefined}
                  data-precision={e0.p}
                  data-hi={lit ? '' : undefined}
                  ref={(node) => {
                    laneRoving.refs.current[k] = node;
                  }}
                  tabIndex={k === laneRoving.index ? 0 : -1}
                  onFocus={() => {
                    laneRoving.setActive(k);
                    setHi(e0.id);
                  }}
                  onBlur={() => setHi(null)}
                  onPointerEnter={() => setHi(e0.id)}
                  onPointerLeave={() => setHi(null)}
                  aria-label={title}
                  className={span ? 'hey-chart-lane-span' : 'hey-chart-lane-mark'}
                  data-count={group.events.length > 1 ? group.events.length : undefined}
                  style={
                    span
                      ? { left: pct(cw * group.i, W), width: pct(cw * (group.j - group.i + 1), W), color: lit ? e0.c : undefined }
                      : ({
                          left: pct(cw * (group.i + (group.events.length === 1 && e0.p === 'EXACT' && e0.f !== undefined ? e0.f : 0.5)), W),
                          ...(room ? { '--hit-l': `${room.left}px`, '--hit-r': `${room.right}px` } : {}),
                        } as CSSProperties)
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    const box = stageRef.current?.getBoundingClientRect();
                    const px = box ? event.currentTarget.getBoundingClientRect().left - box.left : 0;
                    openPanel(
                      group.events.map((e) => e.id),
                      group.events.length === 1 ? `${e0.k} · ${e0.d}` : `${group.events.length} events · ${e0.d}`,
                      Math.max(0, Math.min((width ?? 0) - 300, px - 150)),
                      event.currentTarget,
                    );
                  }}
                >
                  {span ? (
                    <span aria-hidden="true" className="hey-chart-lane-bracket" data-dashed={e0.p === 'WINDOW' ? '' : undefined} />
                  ) : (
                    /*
                     * One glyph a day, and a busy day's count beside it only when the count
                     * has room (review repair, 2026-09-29): three glyphs and a "+N" ran into
                     * the next day's marks. The name says every event either way.
                     */
                    <span aria-hidden="true" className="hey-chart-lane-glyphs">
                      <Marker shape={e0.s} precision={e0.p} tone={lit ? e0.c : 'var(--hey-ink-soft)'} />
                      {group.events.length > 1 ? (
                        room && !room.count ? (
                          <span className="hey-chart-lane-stack" />
                        ) : (
                          <span className="hey-chart-lane-count">{group.events.length}</span>
                        )
                      ) : null}
                    </span>
                  )}
                </button>
              );
            })}
            {visibleAhead.length > 0 ? (
              <button
                type="button"
                data-testid="chart-ahead"
                ref={(node) => {
                  laneRoving.refs.current[laneGroups.length] = node;
                }}
                tabIndex={laneGroups.length === laneRoving.index ? 0 : -1}
                onFocus={() => laneRoving.setActive(laneGroups.length)}
                className="hey-chart-ahead"
                aria-label={`${visibleAhead.length} scheduled after today: ${visibleAhead.map((e) => `${e.k}: ${e.t}, ${e.dl}`).join('; ')}. Opens the list.`}
                onClick={(event) => {
                  event.stopPropagation();
                  openPanel(visibleAhead.map((e) => e.id), `Scheduled after today · ${visibleAhead.length}`, Math.max(0, (width ?? 0) - 300), event.currentTarget);
                }}
              >
                <Marker shape="circle" precision="SCHEDULED" />
                <span>{visibleAhead.length} ahead</span>
              </button>
            ) : null}
          </div>

          <div
            aria-hidden="true"
            className="relative h-5 font-mono text-t-micro tabular-nums text-hey-muted"
          >
            {model.gapTicks.map(([a, b]) => (
              <span
                key={a}
                className="hey-gap-tick absolute top-0"
                style={{ left: pct(cw * a, W), width: pct(cw * (b - a + 1), W) }}
              />
            ))}
            {months.map(([i, label], k) => (
              <span
                key={i}
                className={`absolute top-1 whitespace-nowrap ${months.length > 8 && k % 2 === 1 ? 'max-sm:hidden' : ''}`}
                style={{ left: pct(cw * i, W) }}
              >
                {label}
              </span>
            ))}
            {showCross ? (
              <span
                className="absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-[var(--hey-radius-tooltip)] bg-[var(--hey-tooltip-bg)] px-1.5 py-0.5 text-[var(--hey-tooltip-ink)]"
                style={{ left: x(at) }}
              >
                {rowWhen(model, model.rows[at]![0])}
              </span>
            ) : null}
          </div>

          {panel ? (
            <EventPanel
              events={panelEvents}
              around={aroundPanels ? panelEvents.map((e) => aroundPanels[e.id]).find((value): value is AroundPanel => value !== undefined) : undefined}
              title={panel.title}
              left={panel.left}
              {...(panel.top === undefined ? {} : { top: panel.top })}
              onClose={closePanel}
            />
          ) : null}
        </div>
      </div>

      {/* The candle key, visible (review repairs, 2026-09-26): it was only in a collapsed note and the screen-reader caption. */}
      <p
        className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-t-meta text-hey-muted"
        data-testid="candle-key"
      >
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-1.5 rounded-[1px]" style={{ background: TONE.u }} />
          Closed above its open
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-1.5 rounded-[1px]" style={{ background: TONE.d }} />
          Closed below
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-1.5 rounded-[1px] border border-[var(--hey-market-flat)]"
          />
          Outline: {unitOf(model)} still open
        </span>
        {model.tf ? <span data-testid="volume-per-bar">Bars under the candles: volume per bar</span> : null}
        {codeOn && model.code?.state === 'MEASURED' ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="code-lane-key">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="hey-code-swatch" data-kind="substantive" />
              Substantive commit
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="hey-code-swatch" data-kind="low" />
              Low-information
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="hey-code-swatch" data-kind="unknown" />
              Not yet read
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="hey-code-swatch" data-kind="pr" />
              PR merged
            </span>
            <span className="text-hey-secondary" data-testid="code-lane-total">
              · {model.code.total}
              {model.code.floor ? '+' : ''} commit{model.code.total === 1 && !model.code.floor ? '' : 's'} in range
            </span>
          </span>
        ) : null}
        {lens === 'events' && hidden > 0 ? (
          <span data-testid="chart-hidden-count">
            {hidden} event{hidden === 1 ? '' : 's'} in families switched off
          </span>
        ) : null}
      </p>

      {numbered.length > 0 ? (
        <ol
          className="mt-3 grid gap-2 border-t border-hey-border pt-3 text-t-meta text-hey-secondary sm:hidden"
          aria-label="Build events on the chart"
          data-testid="chart-event-list"
        >
          {numbered.map((e) => (
            <li key={e.id} className="flex min-w-0 items-baseline gap-1.5">
              <Marker shape={e.s} precision={e.p} tone={e.c} />
              <span className="min-w-0 flex-1 truncate text-hey-ink">
                {e.k}: {e.t}
              </span>
              <span className="whitespace-nowrap">· {e.d}</span>
              {e.h ? (
                <a href={e.h} className="whitespace-nowrap font-medium text-hey-ink" aria-label={`Open evidence: ${e.t}`}>
                  Open →
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      <details
        className="mt-3 text-t-meta text-hey-secondary"
        onToggle={(event) => setTable(event.currentTarget.open)}
      >
        <summary className="cursor-pointer select-none text-hey-secondary hover:text-hey-ink">
          Show as table
        </summary>
        {table ? (
          <div
            className="mt-2 overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={model.tf ? 'Last 30 bars as a table' : 'Last 30 days as a table'}
            data-testid="chart-table"
          >
            <table className="w-full min-w-[44rem] border-collapse text-left font-mono tabular-nums">
              <thead>
                <tr className="border-b border-hey-border font-sans text-hey-secondary">
                  {[model.tf ? 'Bar (UTC)' : 'Date', 'Open', 'High', 'Low', 'Close', 'Direction', model.tf ? 'Volume per bar' : 'Volume', model.tf ? 'Events around this bar' : 'Events around this day'].map((h) => (
                    <th key={h} className="py-1.5 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => {
                  const column = model.rows.indexOf(row);
                  const events = tableEvents(column);
                  return (
                    <tr
                      key={row[0]}
                      className="border-b border-hey-border align-top text-hey-ink last:border-0"
                    >
                      <td className="py-1.5 pr-3 font-sans">{rowWhen(model, row[0])}</td>
                      {row.length === 1 ? (
                        <td colSpan={6} className="py-1.5 pr-3 font-sans text-hey-secondary">
                          {model.tf ? 'No bar' : 'No reading'}
                        </td>
                      ) : (
                        <>
                          {[row[1], row[2], row[3], row[4]].map((v, k) => (
                            <td
                              key={k}
                              className="py-1.5 pr-3"
                              title={v === null ? undefined : formatTerminalPriceLong(v)}
                            >
                              {v === null ? '—' : formatTerminalPrice(v)}
                            </td>
                          ))}
                          <td className="py-1.5 pr-3 font-sans">{DIRECTION_WORD[row[7]]}</td>
                          <td className="py-1.5 pr-3">
                            {typeof row[5] === 'number' ? (formatUsdCompact(row[5]) ?? '—') : '—'}
                          </td>
                        </>
                      )}
                      <td className="py-1.5 pr-3 font-sans" data-testid="chart-table-events">
                        {events.length === 0 ? (
                          <span className="text-hey-muted">—</span>
                        ) : (
                          <ul className="grid gap-0.5">
                            {events.map((e) => (
                              <li key={e.id}>
                                {e.h ? (
                                  <a href={e.h} className="underline-offset-2 hover:underline">
                                    {e.k}: {e.t}
                                  </a>
                                ) : (
                                  `${e.k}: ${e.t}`
                                )}
                                <span className="text-hey-secondary"> · {spanWords(e)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </details>

      <figcaption className="hey-sr-only">
        {symbol ? `${symbol} ${captionAdjective(model)} candles. ` : `${captionAdjective(model).charAt(0).toUpperCase()}${captionAdjective(model).slice(1)} candles. `}
        {summary} Use the left and right arrow keys to move between {unitOf(model)}s.
      </figcaption>
    </figure>
  );
}
