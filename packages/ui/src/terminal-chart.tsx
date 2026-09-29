import {
  formatMonthTick,
  formatShortDate,
  formatTerminalPrice,
  formatTerminalPriceLong,
  formatUsdCompact,
} from './format';
/*
 * Types only: the island is a client module, and a value import here would put
 * it in every page that imports the `@hey/ui` barrel. The drawing is rendered
 * through `@hey/ui/terminal-chart-view`, which only the Market tab imports.
 */
import type {
  AheadEvent,
  ChartFamilyChip,
  ChartModel,
  ChartRow,
  LaneEvent,
  RowDirection,
} from './terminal-chart-client';

/**
 * The Terminal's market chart (2026-09-21; redesigned 2026-09-26; build ×
 * market correlation restored 2026-09-29, founder brief §21A).
 *
 * Daily candles from HEY's own index, with builder and research events in a
 * lane of their own under the volume band and, above the plot, callouts that
 * point down to that lane. This file is the server half: it decides every
 * candle's direction, the scale and every event's place on the time axis, and
 * hands a compact array to the client island (`terminal-chart-client.tsx`,
 * rendered by `DailyCandleChart` in `terminal-chart-view.tsx`), which draws
 * the SVG — server-rendered all the same — and adds the crosshair, the
 * readout, the callouts and the keyboard.
 *
 * Five rules make it a research chart rather than a trading screen:
 *
 * 1. **Direction is conventional and only ever measured** (CLAUDE.md UI rule
 *    13). Close above open is `--hey-market-up` green, below is
 *    `--hey-market-down` red. A doji, a day with no open, a day whose open and
 *    close come from different series, and today (still open) are never green
 *    or red: `candleDirection` decides, and it is the only place that does.
 * 2. **A day HEY did not read stays a day HEY did not read.** The x-axis is a
 *    real date range; a gap is an empty column with a hatched tick under the
 *    axis, never a grey bar and never a line drawn across it. An event on such
 *    a day keeps its place on the axis and gets no candle.
 * 3. **An event has no price.** Its x is its time; its callout's height is a
 *    layout band chosen by collision alone (`terminal-chart-annotations.ts`),
 *    and its stem ends at the event lane, never at a candle. No builder green
 *    and no market colour reaches an event.
 * 4. **Precision is drawn, not assumed.** EXACT sits at its hour inside the
 *    day; DATE mid-day, hollow; WEEK is a bracket over its ISO week; WINDOW a
 *    dashed bracket (or a dashed mark with no end); OBSERVED dashed at the day
 *    HEY saw it; SCHEDULED after today is never put on a day that has not
 *    happened — it is listed at the axis's end as "ahead".
 * 5. **Never colour alone.** The readout prints O/H/L/C with ▲/▼ and a sign,
 *    every event carries its family in words, and the figure carries a
 *    sentence that counts up, down and unchanged days and the events.
 */
export type CandleDay = {
  day: string;
  open?: number | undefined;
  high?: number | undefined;
  low?: number | undefined;
  close?: number | undefined;
  volume?: number | undefined;
  /** How many readings made the day. Zero or absent means HEY did not read it. */
  readings?: number | undefined;
  source?: string | undefined;
  /**
   * Which series the four prices came from. `mixed` (a close from trades beside
   * an open from the price series) is never given a direction.
   */
  ohlcSource?: 'price' | 'trade' | 'mixed' | undefined;
};

export type ChartEventShape = 'circle' | 'square' | 'diamond' | 'plus' | 'cross' | 'bar' | 'dash' | 'dot';

/** The one precision vocabulary (`terminal/precision.ts` in the domain), restated: this package cannot import it. */
export type ChartEventPrecision = 'EXACT' | 'DATE' | 'WEEK' | 'WINDOW' | 'OBSERVED' | 'SCHEDULED';

/**
 * One builder or research event, as the chart receives it (brief §21A,
 * 2026-09-29). The page maps its canonical records — the project timeline's
 * entries and the change ledger's method and site facts — into this shape
 * once; the lane, the callouts, the readout and the table all draw these same
 * objects, so no surface keeps event logic of its own.
 */
export type ChartEvent = {
  /** The record's typed public id (`ship:<uuid>`, `abi:<uuid>`, `lock:<id>`, `method:<uuid>`...). */
  id: string;
  /** The instant the event is placed at (ISO): the source's time, or HEY's observation for OBSERVED. */
  at: string;
  title: string;
  /*
   * A string rather than a closed union (audit, 2026-09-21): this package
   * cannot import the caller's taxonomy, which supplies the family, the shape,
   * the word and the tone.
   */
  family: string;
  precision: ChartEventPrecision;
  /** The end of a WINDOW (ISO), when the source gives one; `at` is then the window's start. */
  until?: string | undefined;
  /** Where the event's own record lives, opened. */
  href?: string | undefined;
  /** "Release", "Ship" — the kind, in words. */
  kindLabel?: string | undefined;
};

/**
 * A family the caller offers. The array's order orders the chips; `rank`
 * (lower first) is its research importance for the callouts — releases,
 * deployments and ships before the rest — and falls back to the array's order.
 */
export type ChartFamilyMeta = { key: string; label: string; shape: ChartEventShape; tone: string; rank?: number };

export type CandleDirection = 'up' | 'down' | 'flat' | 'unknown' | 'partial';

/** Relative tolerance for an unchanged day: float noise is not a move. */
const FLAT_EPSILON = 1e-9;

const positive = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * A candle's direction, decided once, from one series.
 *
 * - `partial`: the UTC day is today, so the close is only "so far".
 * - `unknown`: the day was read but its open, high, low or close is missing or
 *   not a positive price, or the prices came from two different series.
 * - `flat`: close equals open within 1e-9 of the price (a doji).
 * - `up` / `down`: close above / below open.
 *
 * A gap (no readings) is never passed here; it is drawn as nothing.
 */
export function candleDirection(d: CandleDay, todayUtc: string): CandleDirection {
  // Today is still open; a later day (a clock ahead of UTC wrote it) is not closed either.
  if (d.day >= todayUtc) return 'partial';
  if (d.ohlcSource === 'mixed') return 'unknown';
  if (!positive(d.open) || !positive(d.high) || !positive(d.low) || !positive(d.close))
    return 'unknown';
  if (Math.abs(d.close - d.open) <= FLAT_EPSILON * Math.max(Math.abs(d.open), Math.abs(d.close)))
    return 'flat';
  return d.close > d.open ? 'up' : 'down';
}

/** Every UTC day between the first and the last, so a missing one keeps its place. */
function fullRange(days: readonly CandleDay[]): CandleDay[] {
  if (days.length === 0) return [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const out: CandleDay[] = [];
  const start = new Date(`${days[0]!.day}T00:00:00.000Z`);
  const end = new Date(`${days[days.length - 1]!.day}T00:00:00.000Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, readings: 0 });
  }
  return out;
}

/**
 * How many days the range covers, how many HEY actually read, and how many it
 * did not. Counted from the range, not the rows: a day HEY never read has no
 * row to return, so counting rows gives zero gaps every time.
 */
export function dayCoverage(days: readonly CandleDay[]): {
  span: number;
  indexed: number;
  gaps: number;
} {
  const range = fullRange(days);
  const gaps = range.filter((d) => !d.readings).length;
  return { span: range.length, indexed: range.length - gaps, gaps };
}

/**
 * "Nice" price ticks on 1-2-5 steps, four to six of them, inside `[lo, hi]`.
 * Exported for the unit tests; the grid and the axis labels both read it.
 */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const pick = (count: number) => {
    const raw = span / count;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / magnitude;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
    const out: number[] = [];
    for (let k = Math.ceil(lo / step); k * step <= hi + step * 1e-9; k += 1)
      out.push(Number((k * step).toPrecision(12)));
    return out;
  };
  let ticks = pick(target);
  if (ticks.length > 6) ticks = pick(target - 2);
  if (ticks.length < 4) ticks = pick(target + 2);
  return ticks;
}

const DIR_CODE: Readonly<Record<CandleDirection, RowDirection>> = {
  up: 'u',
  down: 'd',
  flat: 'f',
  unknown: 'n',
  partial: 'p',
};

/** Six significant digits carry every price a reader can see and halve the payload. */
const sig = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Number(value.toPrecision(6)) : null;

const DAY_MS = 86_400_000;
const MONTH_WORDS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** "14 September 2026": the long form a screen reader hears. */
const longDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTH_WORDS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** The Monday of a day's ISO week. */
export const isoMonday = (day: string) =>
  addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/** The precision in words, beside an event in the readout and the table. */
export function precisionWords(p: ChartEventPrecision): string {
  switch (p) {
    case 'EXACT':
      return 'exact';
    case 'DATE':
      return 'date precision';
    case 'WEEK':
      return 'week precision';
    case 'WINDOW':
      return 'within a window';
    case 'SCHEDULED':
      return 'scheduled';
    default:
      return 'seen by HEY';
  }
}

/**
 * One event on the axis: its column (and end column for a span), the part of
 * the day an exact time sits at, and its labels. Undefined when no day of it
 * falls inside the range. A pure function of the event and the range —
 * never of a price.
 */
export function placeEvent(
  event: ChartEvent,
  indexOf: ReadonlyMap<string, number>,
  now: Date,
  meta: ChartFamilyMeta | undefined,
): LaneEvent | undefined {
  const instant = new Date(event.at);
  if (Number.isNaN(instant.getTime())) return undefined;
  const day = instant.toISOString().slice(0, 10);
  const short = (d: string) => formatShortDate(d, now);
  let i: number | undefined;
  let j: number | undefined;
  let f: number | undefined;
  let d: string;
  let dl: string;
  const first = indexOf.size ? [...indexOf.keys()][0]! : '';
  const last = indexOf.size ? [...indexOf.keys()][indexOf.size - 1]! : '';
  if (event.precision === 'WEEK') {
    /* A week is its ISO week, Monday to Sunday, clipped to the range — never one day of it. */
    const monday = isoMonday(day);
    const sunday = addDays(monday, 6);
    if (sunday < first || monday > last) return undefined;
    i = indexOf.get(monday < first ? first : monday);
    j = indexOf.get(sunday > last ? last : sunday);
    d = `wk of ${short(monday)}`;
    dl = `week of ${longDay(monday)}`;
  } else if (event.precision === 'WINDOW' && event.until) {
    const end = new Date(event.until).toISOString().slice(0, 10);
    if (end < first || day > last) return undefined;
    i = indexOf.get(day < first ? first : day);
    j = indexOf.get(end > last ? last : end);
    d = `${short(day)}–${short(end)}`;
    dl = `somewhere between ${longDay(day)} and ${longDay(end)}`;
  } else {
    i = indexOf.get(day);
    if (event.precision === 'EXACT') {
      f = (instant.getTime() - Date.parse(`${day}T00:00:00Z`)) / DAY_MS;
      const hhmm = instant.toISOString().slice(11, 16);
      d = short(day);
      dl = `${longDay(day)}, ${hhmm} UTC`;
    } else if (event.precision === 'OBSERVED') {
      d = `seen ${short(day)}`;
      dl = `seen by HEY on ${longDay(day)}; it may have happened earlier`;
    } else if (event.precision === 'WINDOW') {
      // `at` is a window's start (the ledger's occurredAt, the timeline's at); with no end recorded, it is only that.
      d = `from ${short(day)}`;
      dl = `within a window starting ${longDay(day)}; its end is not recorded`;
    } else if (event.precision === 'SCHEDULED') {
      d = `due ${short(day)}`;
      dl = `scheduled for ${longDay(day)}`;
    } else {
      d = short(day);
      dl = `${longDay(day)}, date only`;
    }
  }
  if (i === undefined) return undefined;
  return {
    id: event.id,
    i,
    ...(j !== undefined && j !== i ? { j } : {}),
    ...(f !== undefined ? { f: Math.round(f * 1000) / 1000 } : {}),
    fam: event.family,
    t: event.title,
    k: event.kindLabel ?? meta?.label ?? event.family,
    s: meta?.shape ?? 'dot',
    p: event.precision,
    w: precisionWords(event.precision),
    d,
    dl,
    c: meta?.tone ?? 'var(--hey-ink-soft)',
    ...(event.href ? { h: event.href } : {}),
  };
}

export type ChartSummaryCounts = {
  up: number;
  down: number;
  flat: number;
  closeOnly: number;
  partial: number;
  gaps: number;
};

/**
 * Everything the island needs, computed once on the server: the rows with
 * their directions, the padded domain, the ticks and their labels, the month
 * labels, the gap runs, the lane, the families and the accessible summary.
 * Returns `undefined` when fewer than two days carry a price.
 */
export function buildChartModel(
  days: readonly CandleDay[],
  events: readonly ChartEvent[],
  options: {
    todayUtc: string;
    selectedDay?: string | undefined;
    now?: Date | undefined;
    families?: readonly ChartFamilyMeta[] | undefined;
  },
): { model: ChartModel; summary: string; counts: ChartSummaryCounts } | undefined {
  const priced = days.filter((d) => positive(d.close));
  if (priced.length < 2) return undefined;
  const now = options.now ?? new Date(`${options.todayUtc}T12:00:00Z`);
  const range = fullRange(days);
  const counts: ChartSummaryCounts = { up: 0, down: 0, flat: 0, closeOnly: 0, partial: 0, gaps: 0 };

  const rows: ChartRow[] = range.map((d) => {
    if (!d.readings) {
      counts.gaps += 1;
      return [d.day];
    }
    if (!positive(d.close)) return [d.day, null, null, null, null, sig(d.volume), d.readings, 'x'];
    const direction = candleDirection(d, options.todayUtc);
    if (direction === 'up') counts.up += 1;
    else if (direction === 'down') counts.down += 1;
    else if (direction === 'flat') counts.flat += 1;
    else if (direction === 'partial') counts.partial += 1;
    else counts.closeOnly += 1;
    const code: RowDirection =
      direction === 'unknown' && d.ohlcSource === 'mixed' ? 'm' : DIR_CODE[direction];
    /*
     * A close-only or mixed day carries its close and nothing else: an open
     * from another series would let the readout print a direction the plot
     * refuses to draw.
     */
    const ohlc = code === 'n' || code === 'm';
    return [
      d.day,
      ohlc ? null : sig(d.open),
      ohlc ? null : sig(d.high),
      ohlc ? null : sig(d.low),
      sig(d.close),
      sig(d.volume),
      d.readings,
      code,
    ];
  });

  /*
   * The domain is the lows and highs of the drawn days, padded 6% below and 8%
   * above, so the tallest wick never touches the frame. Lows and highs fall
   * back to the closes when a provider reported zero or nothing.
   */
  const closes = priced.map((d) => d.close!);
  const lows = priced.map((d) => (positive(d.low) ? d.low : d.close!));
  const highs = priced.map((d) => (positive(d.high) ? d.high : d.close!));
  let lo = Math.min(...lows, ...closes);
  let hi = Math.max(...highs, ...closes);
  if (hi === lo) {
    // A flat series sits mid-plot rather than on the floor.
    const pad = Math.abs(hi) * 0.02 || 1;
    lo -= pad;
    hi += pad;
  }
  const span = hi - lo;
  const domainLo = Math.max(lo - span * 0.06, lo > 0 ? lo * 0.5 : lo - span * 0.06);
  const domainHi = hi + span * 0.08;
  const ticks = niceTicks(domainLo, domainHi);

  const indexOf = new Map(range.map((d, i) => [d.day, i]));

  /* Month labels: the first day in full ("29 Jun"), then each month's first day ("Jul"). */
  const months: [number, string][] = [];
  if (range.length <= 45) {
    const every = Math.max(1, Math.ceil(range.length / 5));
    for (let i = 0; i < range.length; i += every)
      months.push([i, formatShortDate(range[i]!.day, now)]);
  } else {
    months.push([0, formatShortDate(range[0]!.day, now)]);
    range.forEach((d, i) => {
      if (i > 0 && d.day.endsWith('-01')) months.push([i, formatMonthTick(d.day)]);
    });
  }

  /* A run of five or more days without a reading is named on the plot. */
  const gapRuns: [number, number, string][] = [];
  for (let i = 0; i < range.length; i += 1) {
    if (range[i]!.readings) continue;
    let j = i;
    while (j + 1 < range.length && !range[j + 1]!.readings) j += 1;
    const from = formatShortDate(range[i]!.day, now);
    const to = formatShortDate(range[j]!.day, now);
    // "17–22 Aug" within a month, "29 Jul–3 Aug" across one.
    const same = from.split(' ').slice(1).join(' ') === to.split(' ').slice(1).join(' ');
    gapRuns.push([i, j, same ? `${from.split(' ')[0]}–${to}` : `${from}–${to}`]);
    i = j;
  }

  /*
   * The lane: every event with a day inside the range, placed by time. A
   * scheduled event after the range's last day has no column — it has not
   * happened — so it is kept apart as "ahead", never pinned to today.
   */
  const metaOf = new Map((options.families ?? []).map((meta) => [meta.key, meta]));
  const lastDay = range[range.length - 1]!.day;
  const lane: LaneEvent[] = [];
  const ahead: AheadEvent[] = [];
  for (const event of events) {
    const meta = metaOf.get(event.family);
    const eventDay = new Date(event.at).toISOString().slice(0, 10);
    if (event.precision === 'SCHEDULED' && eventDay > lastDay) {
      const placedAhead = placeEvent(event, new Map([[eventDay, 0]]), now, meta);
      if (placedAhead) {
        const { i: _i, j: _j, f: _f, ...rest } = placedAhead;
        ahead.push({ ...rest, day: eventDay });
      }
      continue;
    }
    const placed = placeEvent(event, indexOf, now, meta);
    if (placed) lane.push(placed);
  }
  lane.sort((a, b) => a.i - b.i || (a.f ?? 0.5) - (b.f ?? 0.5) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ahead.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  /* The families present in this range, in the caller's order, with their counts. */
  const familyCount = new Map<string, number>();
  for (const e of [...lane, ...ahead]) familyCount.set(e.fam, (familyCount.get(e.fam) ?? 0) + 1);
  const families: ChartFamilyChip[] = (options.families ?? [])
    .filter((meta) => (familyCount.get(meta.key) ?? 0) > 0)
    .map((meta) => ({ ...meta, count: familyCount.get(meta.key)! }));
  for (const [key, count] of familyCount) {
    if (!metaOf.has(key)) families.push({ key, label: key, shape: 'dot', tone: 'var(--hey-ink-soft)', count });
  }

  /* The day the readout opens on: the one asked for, else the latest complete day with a price. */
  const complete = (i: number) => {
    const code = rows[i]![7];
    return code === 'u' || code === 'd' || code === 'f' || code === 'n' || code === 'm';
  };
  let latest = rows.length - 1;
  while (latest > 0 && !complete(latest)) latest -= 1;
  const asked = options.selectedDay ? indexOf.get(options.selectedDay) : undefined;
  const maxVol = Math.max(
    0,
    ...range.map((d) => (typeof d.volume === 'number' && d.volume > 0 ? d.volume : 0)),
  );

  const model: ChartModel = {
    rows,
    lo: domainLo,
    hi: domainHi,
    ticks: ticks.map((v) => [v, formatTerminalPrice(v)] as [number, string]),
    months,
    gapRuns: gapRuns.filter(([a, b]) => b - a + 1 >= 5),
    gapTicks: gapRuns.map(([a, b]) => [a, b] as [number, number]),
    maxVol,
    volLabel: maxVol > 0 ? (formatUsdCompact(maxVol) ?? '') : '',
    lane,
    ahead,
    families,
    latest,
    initial: asked ?? latest,
    today: options.todayUtc,
  };

  /* The whole chart as one sentence, for the figure's caption. */
  const firstComplete = rows.findIndex((_, i) => complete(i));
  const first = rows[firstComplete]?.[4];
  const last = rows[latest]?.[4];
  const change =
    typeof first === 'number' && typeof last === 'number' && first > 0
      ? (last / first - 1) * 100
      : undefined;
  const movement =
    change === undefined
      ? 'Close change not measured'
      : `Close ${change >= 0.05 ? 'rose' : change <= -0.05 ? 'fell' : 'was unchanged'}${
          Math.abs(change) >= 0.05 ? ` ${Math.abs(change).toFixed(1)}%` : ''
        } over ${range.length} days, from ${formatTerminalPriceLong(first!)} to ${formatTerminalPriceLong(last!)}`;
  const eventCount = lane.length + ahead.length;
  const summary =
    `${movement}; ${counts.up} up day${counts.up === 1 ? '' : 's'}, ${counts.down} down, ${counts.flat} unchanged, ${counts.closeOnly} close-only` +
    `${counts.partial ? ', today still open' : ''}; ${counts.gaps} day${counts.gaps === 1 ? '' : 's'} without a reading; ` +
    `${eventCount} builder and research event${eventCount === 1 ? '' : 's'} in range, aligned by time only.`;
  return { model, summary, counts };
}
