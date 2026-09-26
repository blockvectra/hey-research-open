'use client';

import {
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
import { Glyph } from './glyph';
import { MarketChange, describeMarketChange } from './market-change';

/**
 * The market chart's interaction island (Terminal redesign, 2026-09-26).
 *
 * It receives data only — a compact array per day, already given its
 * direction by `candleDirection` on the server — and draws the SVG itself, so
 * the drawing is serialised once (as HTML) instead of twice (HTML plus the
 * server component tree). It is still server-rendered: without JavaScript the
 * reader gets the same chart and a readout of the latest complete day.
 *
 * What the JavaScript adds: a crosshair and readout for pointer and touch,
 * and ←/→/Home/End/Esc/Enter on the focused figure. Moves never allocate
 * React state per pixel: the day under the pointer is state only when it
 * changes, and the horizontal price line is written straight to the DOM in an
 * animation frame.
 *
 * Direction colours (CLAUDE.md UI rule 13) are read here only from the
 * direction code the server decided. Candle bodies are drawn as strokes with
 * `vector-effect: non-scaling-stroke`, so their width is in real pixels:
 * `--bw` is 70% of a column, clamped to 1–14px, from container query units —
 * right on a phone and on a desktop before any script runs.
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

export type LaneEvent = {
  /** Column index. */
  i: number;
  t: string;
  /** Kind in words: "Release". */
  k: string;
  g: string;
  s: string;
  p: 'exact' | 'day' | 'week' | 'unknown';
  /** Precision in words: "exact", "date precision", "week of 2026-09-14", "seen by HEY". */
  w: string;
  c: string;
  h?: string;
  n?: string;
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
};

const W = 1000;
const H = 400;
const PLOT = 326;
const VOL_TOP = 342;

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

/** The reference day every date label is written against: the model's, never the browser clock. */
const referenceDay = (model: ChartModel) => new Date(`${model.today}T12:00:00Z`);

function Readout({ model, at }: { model: ChartModel; at: number }) {
  const row = model.rows[at]!;
  const date = formatShortDate(row[0], referenceDay(model));
  const events = model.lane.filter((e) => e.i === at);
  const money = (v: number | null) => (v === null ? '—' : formatTerminalPrice(v));
  let line1;
  if (row.length === 1) {
    line1 = <span className="text-hey-secondary">No reading</span>;
  } else {
    const [, o, h, l, c, v, , dir] = row;
    const vol = (
      <span className="text-hey-secondary">
        · Vol {typeof v === 'number' ? (formatUsdCompact(v) ?? '—') : '—'}
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
          {dir === 'p' ? <span className="text-hey-secondary">Today so far ·</span> : null}
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
              {describeMarketChange(change, '1D').text} so far
            </span>
          ) : (
            <MarketChange pct={change} window="1D" showWindow={false} />
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
      className="grid gap-0.5 text-t-ui tabular-nums text-hey-ink"
      data-testid="chart-readout"
      data-day={row[0]}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 font-mono">
        <span className="font-sans font-medium">{date}</span>
        {line1}
      </p>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-t-meta text-hey-secondary">
        {events.length === 0 ? (
          <span>No builder event on this day.</span>
        ) : (
          <>
            {events.slice(0, 2).map((e, n) => (
              <span key={n} className="inline-flex min-w-0 items-baseline gap-1.5">
                <Glyph glyph={e.g} />
                <span className="text-hey-ink">{e.k}</span>·{' '}
                <span className="max-w-[18rem] truncate text-hey-ink">{e.t}</span>· {e.w}
                {e.h ? (
                  <a
                    href={e.h}
                    className="font-medium text-hey-ink underline-offset-2 hover:underline"
                    data-testid="chart-event-link"
                  >
                    Open in timeline →
                  </a>
                ) : null}
              </span>
            ))}
            {events.length > 2 ? <span>+{events.length - 2} more</span> : null}
            {since !== undefined ? (
              <span className="inline-flex items-baseline gap-1">
                <MarketChange pct={since} window="since event" showWindow={false} size="meta" />{' '}
                since {date} close
              </span>
            ) : null}
          </>
        )}
      </p>
    </div>
  );
}

export function TerminalChartInteractive({
  model,
  summary,
  symbol,
  className,
}: {
  model: ChartModel;
  summary: string;
  symbol?: string;
  className?: string;
}) {
  const { paths, y, cw } = useMemo(() => draw(model), [model]);
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState(model.initial);
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const [table, setTable] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);

  const n = model.rows.length;
  const at = hover ?? pin;
  const x = (i: number) => pct(cw * (i + 0.5), W);
  let last = n - 1;
  while (last > 0 && close(model.rows[last]) === null) last -= 1;
  const lastRow = model.rows[last];
  const lastClose = close(lastRow);
  const lastDir = lastRow && lastRow.length > 1 ? lastRow[7] : 'f';
  const showCross = hover !== null || active;
  const atEvents = model.lane.filter((e) => e.i === at && e.p !== 'week');

  const indexAt = (clientX: number): number | undefined => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return undefined;
    return Math.min(n - 1, Math.max(0, Math.floor(((clientX - box.left) / box.width) * n)));
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event;
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
      if (!inside) return;
      line.style.transform = `translateY(${offset}px)`;
      pill.style.top = `${offset}px`;
      pill.textContent = formatTerminalPrice(
        model.lo + ((plotPx - offset) / plotPx) * (model.hi - model.lo),
      );
    });
  };

  /*
   * Leaving the plot keeps the day the reader was on: the readout's "Open in
   * timeline" sits above the plot, and reverting on the way to it would take
   * the link away before it could be clicked. Esc returns to the latest day.
   */
  const onLeave = () => {
    cancelAnimationFrame(frame.current);
    if (hover !== null) setPin(hover);
    setHover(null);
    if (lineRef.current) lineRef.current.style.display = 'none';
    if (pillRef.current) pillRef.current.style.display = 'none';
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    const i = indexAt(event.clientX);
    if (i === undefined) return;
    setPin(i);
    setActive(true);
  };

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    const from = hover ?? pin;
    let next: number | undefined;
    if (event.key === 'ArrowLeft') next = Math.max(0, from - 1);
    else if (event.key === 'ArrowRight') next = Math.min(n - 1, from + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else if (event.key === 'Escape') next = model.latest;
    else if (event.key === 'Enter') {
      const href = model.lane.find((e) => e.i === from && e.h)?.h;
      if (href && event.target === event.currentTarget) window.location.assign(href);
      return;
    } else return;
    event.preventDefault();
    setHover(null);
    setPin(next);
    setActive(event.key !== 'Escape');
  };

  /* Same-day events stack sideways, three at most, then "+n". */
  const groups = new Map<number, LaneEvent[]>();
  for (const e of model.lane) if (e.p !== 'week') groups.set(e.i, [...(groups.get(e.i) ?? []), e]);
  let prevMonth = -1;
  const months = model.months.filter(([i]) => {
    const keep = prevMonth < 0 || (i - prevMonth) / n > 0.07;
    if (keep) prevMonth = i;
    return keep && i / n < 0.95;
  });
  const numbered = model.lane.filter((e) => e.n).reverse();

  return (
    <figure
      tabIndex={0}
      onKeyDown={onKey}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      data-testid="market-chart"
      className={`m-0 rounded-card outline-none focus-visible:ring-2 focus-visible:ring-hey-ink focus-visible:ring-offset-2 focus-visible:ring-offset-hey-surface ${className ?? ''}`}
    >
      <div aria-live={focused ? 'polite' : 'off'} className="mb-3 min-h-[4.5rem] sm:min-h-10">
        <Readout model={model} at={at} />
      </div>

      {/*
        The price scale has its own gutter at every width (review repairs,
        2026-09-26). Below 1024px it used to sit inside the plot on a
        translucent chip, over the newest candles — the ones a reader looks at
        first — and the last-close tag hid the latest candle outright.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_52px] gap-x-1 lg:grid-cols-[minmax(0,1fr)_64px] lg:gap-x-2">
        <div
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          onPointerDown={onDown}
          className="touch-pan-y select-none"
        >
          <div
            ref={plotRef}
            className="@container relative h-[min(56vh,320px)] sm:h-[360px]"
            style={{ '--bw': `clamp(1px, calc(70cqw / ${n}), 14px)` } as CSSProperties}
          >
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
              aria-hidden="true"
              className="pointer-events-none font-mono text-t-micro tabular-nums text-hey-muted"
            >
              {model.ticks.map(([v, label]) =>
                y(v) > 8 &&
                y(v) < PLOT - 4 &&
                (lastClose === null || Math.abs(y(v) - y(lastClose)) > 16) ? (
                  <span
                    key={v}
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
                No readings · {label}
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

            {lastClose !== null ? (
              <span
                aria-hidden="true"
                data-testid="last-close"
                data-direction={lastDir === 'u' ? 'up' : lastDir === 'd' ? 'down' : 'flat'}
                className="pointer-events-none absolute left-[calc(100%+2px)] -translate-y-1/2 whitespace-nowrap rounded-[var(--hey-radius-tooltip)] px-1 py-0.5 font-mono text-t-micro font-medium tabular-nums lg:left-[calc(100%+4px)] lg:px-1.5"
                style={{
                  top: pct(y(lastClose), H),
                  background:
                    lastDir === 'u' || lastDir === 'd' ? TONE[lastDir] : 'var(--hey-market-flat)',
                  color: 'var(--hey-on-market)',
                }}
              >
                {formatTerminalPrice(lastClose)}
              </span>
            ) : null}
            <span
              ref={pillRef}
              aria-hidden="true"
              className="pointer-events-none absolute left-[calc(100%+2px)] z-10 -translate-y-1/2 whitespace-nowrap rounded-[var(--hey-radius-tooltip)] bg-[var(--hey-tooltip-bg)] px-1 py-0.5 font-mono text-t-micro tabular-nums text-[var(--hey-tooltip-ink)] lg:left-[calc(100%+4px)] lg:px-1.5"
              style={{ display: 'none' }}
            />
          </div>

          {/* The event lane: no price coordinate, ink at rest, the layer tone only for the selected day. */}
          <div aria-hidden="true" className="relative mt-1.5 h-[18px]" data-testid="event-lane">
            {model.lane
              .filter((e) => e.p === 'week')
              .map((e, k) => {
                const from = Math.max(0, e.i - 3);
                const to = Math.min(n - 1, e.i + 3);
                return (
                  <span
                    key={`w${k}`}
                    className="absolute top-[6px] h-[6px] border border-t-0"
                    style={{
                      left: pct(cw * from, W),
                      width: pct(cw * (to - from + 1), W),
                      borderColor: e.i === at ? e.c : 'var(--hey-ink-soft)',
                    }}
                  />
                );
              })}
            {[...groups].map(([i, list]) => (
              <span
                key={i}
                className="absolute top-[5px] flex -translate-x-1/2 items-center gap-[3px]"
                style={{ left: x(i) }}
              >
                {list.find((e) => e.n) ? (
                  <span className="text-t-meta leading-none text-hey-ink sm:hidden">
                    {list.find((e) => e.n)!.n}
                  </span>
                ) : null}
                <span
                  className={`items-center gap-[3px] ${list.some((e) => e.n) ? 'hidden sm:flex' : 'flex'}`}
                >
                  {list.slice(0, 3).map((e, k) => (
                    <span
                      key={k}
                      className="hey-lane-glyph"
                      data-shape={e.s}
                      data-precision={e.p}
                      style={{ color: i === at ? e.c : 'var(--hey-ink-soft)' }}
                    />
                  ))}
                  {list.length > 3 ? (
                    <span className="text-t-micro leading-none text-hey-secondary">
                      +{list.length - 3}
                    </span>
                  ) : null}
                </span>
              </span>
            ))}
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
                {formatShortDate(model.rows[at]![0], referenceDay(model))}
              </span>
            ) : null}
          </div>
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
          Outline: day still open
        </span>
      </p>

      {numbered.length > 0 ? (
        <ol
          className="mt-3 grid gap-2 border-t border-hey-border pt-3 text-t-meta text-hey-secondary sm:hidden"
          aria-label="Builder events on the chart"
        >
          {numbered.map((e, k) => (
            <li key={k} className="flex min-w-0 items-baseline gap-1.5">
              <span className="text-hey-ink">{e.n}</span>
              <Glyph glyph={e.g} />
              <span className="min-w-0 flex-1 truncate text-hey-ink">{e.t}</span>
              <span className="whitespace-nowrap">· {formatShortDate(model.rows[e.i]![0], referenceDay(model))}</span>
              {e.h ? (
                <a href={e.h} className="whitespace-nowrap font-medium text-hey-ink">
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
            aria-label="Last 30 days as a table"
          >
            <table className="w-full min-w-[34rem] border-collapse text-left font-mono tabular-nums">
              <thead>
                <tr className="border-b border-hey-border font-sans text-hey-secondary">
                  {['Date', 'Open', 'High', 'Low', 'Close', 'Direction', 'Volume'].map((h) => (
                    <th key={h} className="py-1.5 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.rows
                  .slice(-30)
                  .reverse()
                  .map((row) => (
                    <tr
                      key={row[0]}
                      className="border-b border-hey-border text-hey-ink last:border-0"
                    >
                      <td className="py-1.5 pr-3 font-sans">{formatShortDate(row[0], referenceDay(model))}</td>
                      {row.length === 1 ? (
                        <td colSpan={6} className="py-1.5 pr-3 font-sans text-hey-secondary">
                          No reading
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
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </details>

      <figcaption className="hey-sr-only">
        {symbol ? `${symbol} daily candles. ` : 'Daily candles. '}
        {summary} Use the left and right arrow keys to move between days.
      </figcaption>
    </figure>
  );
}
