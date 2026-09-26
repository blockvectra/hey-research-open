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
import type { ChartModel, ChartRow, LaneEvent, RowDirection } from './terminal-chart-client';

/**
 * The Terminal's market chart (2026-09-21; redesigned 2026-09-26).
 *
 * Daily candles from HEY's own index, with builder events in a lane of their
 * own under the volume band. This file is the server half: it decides every
 * candle's direction and the scale, and hands a compact array to the client
 * island (`terminal-chart-client.tsx`, rendered by `DailyCandleChart` in
 * `terminal-chart-view.tsx`), which draws the SVG — server-rendered
 * all the same — and adds the crosshair, the readout and the keyboard.
 *
 * Four rules make it a research chart rather than a trading screen:
 *
 * 1. **Direction is conventional and only ever measured** (CLAUDE.md UI rule
 *    13). Close above open is `--hey-market-up` green, below is
 *    `--hey-market-down` red. A doji, a day with no open, a day whose open and
 *    close come from different series, and today (still open) are never green
 *    or red: `candleDirection` decides, and it is the only place that does.
 * 2. **A day HEY did not read stays a day HEY did not read.** The x-axis is a
 *    real date range; a gap is an empty column with a hatched tick under the
 *    axis, never a grey bar and never a line drawn across it.
 * 3. **An event has no price.** Builder events sit in their own lane, in ink,
 *    shaped by kind and drawn by precision, so a ship can never read as the
 *    cause of the candle above it. No builder green reaches the plot.
 * 4. **Never colour alone.** The readout prints O/H/L/C with ▲/▼ and a sign,
 *    and the figure carries a sentence that counts up, down and unchanged days.
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

export type ChartEventShape = 'circle' | 'square' | 'diamond' | 'plus' | 'bar' | 'dash' | 'dot';

export type ChartEvent = {
  id: string;
  day: string;
  title: string;
  /*
   * A string rather than a closed union (audit, 2026-09-21): this package
   * cannot import the domain's `EventLayer`, and the caller's taxonomy
   * (`EVENT_LAYERS`) supplies the shape, the word and the tone.
   */
  layer: string;
  /** The word the reader sees: exact, date precision, week precision, seen by HEY. */
  precisionLabel: string;
  precision: 'exact' | 'day' | 'week' | 'unknown';
  timeLabel: string;
  /** Where the event's own record lives, e.g. the timeline entry, opened. */
  href?: string | undefined;
  shape?: ChartEventShape | undefined;
  /** "Release", "Ship" — the kind, in words. */
  kindLabel?: string | undefined;
  glyph?: string | undefined;
  /** The layer's tone, shown only for the selected day's events. */
  tone?: string | undefined;
};

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

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

/** Event lane shapes by layer, for callers that pass none. The caller's taxonomy wins. */
const FALLBACK_SHAPE: Readonly<Record<string, ChartEventShape>> = {
  ship: 'circle',
  release: 'square',
  integration: 'diamond',
  deployment: 'plus',
  code: 'bar',
  supporting: 'dash',
};

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
 * labels, the gap runs, the lane and the accessible summary. Returns
 * `undefined` when fewer than two days carry a price.
 */
export function buildChartModel(
  days: readonly CandleDay[],
  events: readonly ChartEvent[],
  options: { todayUtc: string; selectedDay?: string | undefined; now?: Date | undefined },
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
   * The lane. Numbered (for the phone list) are the newest nine day-placed
   * events; a week-precision event is a bracket, not a point, and takes no
   * number.
   */
  const placed = events
    .filter((e) => indexOf.has(e.day))
    .slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const numbered = placed.filter((e) => e.precision !== 'week').slice(-CIRCLED.length);
  const numberOf = new Map(numbered.map((e, n) => [e.id, CIRCLED[n]!]));
  const lane: LaneEvent[] = placed.map((e) => ({
    i: indexOf.get(e.day)!,
    t: e.title,
    k: e.kindLabel ?? e.layer,
    g: e.glyph ?? '•',
    s: e.shape ?? FALLBACK_SHAPE[e.layer] ?? 'dot',
    p: e.precision,
    w: e.precision === 'exact' ? 'exact' : e.precision === 'week' ? e.timeLabel : e.precisionLabel,
    c: e.tone ?? 'var(--hey-ink-soft)',
    ...(e.href ? { h: e.href } : {}),
    ...(numberOf.has(e.id) ? { n: numberOf.get(e.id)! } : {}),
  }));

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
  const summary =
    `${movement}; ${counts.up} up day${counts.up === 1 ? '' : 's'}, ${counts.down} down, ${counts.flat} unchanged, ${counts.closeOnly} close-only` +
    `${counts.partial ? ', today still open' : ''}; ${counts.gaps} day${counts.gaps === 1 ? '' : 's'} without a reading; ` +
    `${lane.length} builder event${lane.length === 1 ? '' : 's'}.`;
  return { model, summary, counts };
}
