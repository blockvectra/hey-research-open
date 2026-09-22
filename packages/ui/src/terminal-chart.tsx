import { ChartNote } from './market-charts';
import { cn } from './cn';

/**
 * The Terminal's market chart (2026-09-21).
 *
 * Daily candles from HEY's own index, with builder events drawn over them. The
 * same recipe as every other chart in this package — server-rendered SVG, a
 * `<title>` per element, a `role="img"` summary, an honest empty state, no
 * client bundle and no charting dependency.
 *
 * Three things make it different from a trading chart, and all three are the
 * point of the surface:
 *
 * 1. **Direction is not coloured.** Up and down are two neutral tones. Green
 *    belongs to builder state, and a brand colour that also paints the up
 *    candle would make the brand read "bullish" — the trap Signal Gold has
 *    always been kept out of.
 * 2. **A day HEY did not read is drawn as a day HEY did not read.** The x-axis
 *    is a real date range, not a row index, so a gap opens where a gap exists
 *    instead of the series silently closing over it. Every other daily chart in
 *    the product indexes by position and compresses its gaps; this one does not.
 * 3. **A marker is never more precise than its source.** Week-level events get a
 *    band across their week and no point; date-only events sit hollow in the
 *    middle of their day; an event HEY only observed is drawn dashed at the time
 *    HEY observed it.
 */
export type CandleDay = {
  day: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  /** How many readings made the day. Zero or absent means HEY did not read it. */
  readings?: number;
  source?: string;
};

export type ChartEvent = {
  id: string;
  day: string;
  title: string;
  /*
   * A string rather than a closed union (audit, 2026-09-21). This package
   * cannot import the domain's `EventLayer`, and restating it here meant the
   * two drifted the moment a layer was added — the chart refused to compile
   * against the very layer that had just been created to stop six building
   * event types being drawn as "other". The tone comes from the caller's map
   * either way, so the chart never needed to know the names.
   */
  layer: string;
  /** The word the reader sees: exact, date precision, week precision, seen by HEY. */
  precisionLabel: string;
  precision: 'exact' | 'day' | 'week' | 'unknown';
  timeLabel: string;
};

/**
 * Tones by layer name, with a neutral fallback.
 *
 * This restates the app's own `LAYER_META` because a package cannot import
 * from the app, and on 2026-09-21 that duplication did exactly what
 * duplication does: a new `supporting` layer existed in the domain and in the
 * legend, and the chart drew nothing for it. The fallback means an unmapped
 * layer is drawn quietly rather than not at all — a marker in the wrong grey
 * is a small bug, a missing marker is the chart lying.
 */
const LAYER_TONE: Readonly<Record<string, string>> = {
  ship: 'var(--hey-ink)',
  release: 'var(--hey-accent-ui)',
  integration: 'var(--color-narrative-trading)',
  deployment: 'var(--color-narrative-infra)',
  supporting: 'var(--color-narrative-ai)',
  code: 'var(--color-narrative-rwa)',
  other: 'var(--hey-muted)',
};

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
 * did not. Exported because the rail reports the same three numbers: counting
 * gaps from the returned rows instead of the range gives zero every time,
 * since a day HEY never read has no row to return.
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

const money = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(3)}`);
const shortDay = (day: string) => day.slice(5).replace('-', '/');
const compact = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(0)}M`
    : v >= 1_000
      ? `${(v / 1_000).toFixed(0)}K`
      : `${Math.round(v)}`;

/**
 * How many events get a written label, and how far apart they must sit.
 *
 * The reference labels three out of a chart holding dozens. That restraint is
 * the design: a callout on every marker is a wall of cards, and the dots carry
 * the rest with their titles. Selection is newest-first and deterministic —
 * never a sample — and a candidate too close to one already kept is skipped so
 * two cards cannot overlap at any width.
 */
/**
 * The widest a candle body may be drawn, in viewBox units.
 *
 * 1000 units span the plot, so this is a hair over one per cent of it — the
 * proportion a candle occupies on a chart showing a quarter's worth of days,
 * which is what a reader recognises as a candle.
 */
const MAX_BODY_W = 12;

const LABEL_LIMIT = 3;

/**
 * The widest the callout card can be: `max-w-[9rem]` + `px-2` + its borders.
 * Kept beside the class that sets it, because the gap below is derived from it
 * and the two silently disagree otherwise.
 *
 * 9rem rather than the 13rem it shipped at: once the gap is honest about the
 * card's real width, a wider card costs the third callout. The reference shows
 * three, the dot and the timeline carry the full title, and three short
 * annotations read better than two long ones.
 */
const LABEL_CARD_PX = 144 + 16 + 2;

/**
 * The narrowest plot that ever draws a callout. Cards are `hidden sm:block`,
 * so the floor is the `sm` breakpoint: 640px viewport, less the shell's 24px
 * gutters, the card body's 20px padding, the 4.6rem price column and its 8px
 * gap — about 470px of drawing.
 */
const LABEL_MIN_PLOT_PX = 470;

/**
 * Two callouts may not sit closer than one card's width (geometry audit,
 * 2026-09-22).
 *
 * This was a flat `0.17`, and the comment above claimed that made overlap
 * impossible at any width. It did not: 0.17 is a fraction of the column span,
 * which is a fraction of the *plot's* pixel width, while the card's width is
 * fixed in pixels. At the narrowest plot that draws cards, 0.17 buys 83px of
 * separation for a card that can be 162px wide — so the guarantee failed
 * exactly where it mattered most, on the narrowest screen that shows cards.
 */
const LABEL_MIN_GAP = LABEL_CARD_PX / LABEL_MIN_PLOT_PX;

/**
 * The slivers at each end where a card cannot go: it would hang off the plot
 * on the left, and collide with the last-close badge on the right. An event in
 * either sliver keeps its dot and its row in the timeline; only its card goes.
 */
const LABEL_EDGE_LEFT = 0.06;
const LABEL_EDGE_RIGHT = 0.94;

/**
 * Which markers get a written callout.
 *
 * Exported because it shipped wrong once and nothing caught it: the loop ran
 * from the end of a newest-first list, so it labelled the three OLDEST events
 * while the timeline under the chart listed the five newest — two of the three
 * cards named events that appeared nowhere else on the page, inside a
 * container marked `aria-hidden`.
 *
 * The rules, in order: newest first; never two cards closer than
 * `LABEL_MIN_GAP` of the range, which is one card's width at the narrowest
 * plot that draws them; and nothing in either end sliver, where a card would
 * hang off the plot or land under the last-close badge.
 */
export function pickLabels(
  marked: readonly ChartEvent[],
  indexOf: ReadonlyMap<string, number>,
  columns: number,
): { event: ChartEvent; index: number }[] {
  const span = Math.max(1, columns - 1);
  const labelled: { event: ChartEvent; index: number }[] = [];
  for (let i = 0; i < marked.length && labelled.length < LABEL_LIMIT; i += 1) {
    const event = marked[i]!;
    const index = indexOf.get(event.day);
    if (index === undefined) continue;
    const clear = labelled.every((kept) => Math.abs(kept.index - index) / span >= LABEL_MIN_GAP);
    const fraction = index / span;
    if (clear && fraction > LABEL_EDGE_LEFT && fraction < LABEL_EDGE_RIGHT)
      labelled.push({ event, index });
  }
  return labelled;
}

export function DailyCandleChart({
  days,
  events = [],
  source,
  className,
}: {
  days: readonly CandleDay[];
  events?: readonly ChartEvent[];
  source?: string;
  className?: string;
}) {
  const priced = days.filter((d) => typeof d.close === 'number' && d.close > 0);
  if (priced.length < 2) {
    return (
      <ChartNote
        message="Not enough days indexed for a chart yet."
        hint="HEY reads the market daily; the chart appears from the second day."
        className={className}
      />
    );
  }

  const range = fullRange(days);
  /*
   * Both bounds are filtered, and both fall back to the closes (geometry
   * audit, 2026-09-22). `lows` was filtered for `v > 0` and `highs` was not,
   * and neither had a fallback: a provider that reported `low: 0` on every day
   * — the very case the filter exists for — left `lows` empty, and
   * `Math.min(...[])` is `Infinity`. That made `span` `-Infinity` and every
   * y-coordinate on the chart `NaN`: not a wrong scale, no scale at all.
   */
  const closes = priced.map((d) => d.close!).filter((v) => v > 0);
  const positive = (values: number[]) => (values.length > 0 ? values : closes);
  const lows = positive(priced.map((d) => d.low ?? d.close!).filter((v) => v > 0));
  const highs = positive(priced.map((d) => d.high ?? d.close!).filter((v) => v > 0));
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  /*
   * A symmetric pad when every close is identical, so a flat series sits in
   * the middle of the plot rather than glued to the bottom axis with the whole
   * height empty above it — `(v - lo)` is zero for every point, so no choice of
   * span alone can lift it.
   */
  const flat = hi === lo;
  const pad = flat ? Math.abs(hi) * 0.02 || 1 : 0;
  const lo2 = lo - pad;
  const hi2 = hi + pad;
  const span = hi2 - lo2 || 1;

  /*
   * No text lives inside this drawing.
   *
   * Every label used to be an SVG `<text>` sized in the 1000-unit coordinate
   * space. On a 390px phone the chart gets about 310 real pixels, a scale of
   * roughly 0.31, so 11-unit type rendered at about 3.4 real pixels and the
   * axis, the ticks and the price tag were all illegible. HTML labels scale
   * with the reader's own font size instead, so they stay legible at any width
   * and respect a browser zoom. The SVG is the plot and nothing else.
   *
   * The proportions are the reference's (2026-09-22): its chart card is 1010
   * wide by 410 tall with the price scale on the right, a volume band about a
   * sixth of the height under the candles, and the date row beneath that.
   */
  const W = 1000;
  const H = 400;
  const padL = 4;
  const padR = 4;
  const padT = 12;
  const volH = 64;
  const gap = 10;
  const plotH = H - padT - volH - gap;
  const plotW = W - padL - padR;
  const cw = plotW / range.length;
  /*
   * Coordinates are rounded to two decimals (perf review, 2026-09-22).
   *
   * Unrounded, every attribute renders at full float precision —
   * `x="6.951200000000001"` — and at the four-hundred-day range that is around
   * fifteen characters where five would do. Raw bytes barely move; the gzipped
   * payload drops by about forty per cent, because a stream of short repeating
   * decimals compresses and a stream of float noise does not. At a 1000x400
   * viewBox two decimals is far below a rendered pixel, so nothing moves.
   */
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const y = (v: number) => r2(padT + plotH - ((v - lo2) / span) * plotH);
  const cx = (i: number) => r2(padL + cw * i + cw / 2);
  /** Where a value sits as a share of the drawing, for an HTML label over it. */
  const yPct = (v: number) => `${(y(v) / H) * 100}%`;
  const xPct = (i: number) => `${(cx(i) / W) * 100}%`;

  /*
   * A candle body is a share of its column, not a fixed number of pixels.
   *
   * The previous cut held the body at a constant real-pixel width so it stayed
   * visible on a phone. That is right at ninety days and wrong at four hundred,
   * where a 6px body in a 2.5px column overlaps its neighbours into a solid
   * block. A proportional body is what the reference draws and what every
   * candle chart draws; the wick keeps a one-pixel non-scaling stroke, so even
   * where a body renders below a pixel the day is still on the chart.
   */
  /*
   * A candle has a maximum width (2026-09-22).
   *
   * `cw` is the plot divided by the number of days, and the body was 62% of
   * it with no ceiling — so a token HEY had read for fifteen days drew bodies
   * 41 units wide, a thumb's width each, and the chart read as a bar chart of
   * a fortnight rather than as a price. The founder's screenshot is that.
   *
   * The spacing still comes from the day count, so the candles stay on their
   * own dates; only the body stops stretching to fill the gap. Below the cap
   * nothing changes, which is every range from about seventy days up.
   */
  const bodyW = r2(Math.min(cw * 0.62, MAX_BODY_W));

  const maxVol = Math.max(...range.map((d) => d.volume ?? 0), 1);
  const { indexed, gaps: gapDays } = dayCoverage(days);
  const last = priced[priced.length - 1]!;
  const indexOf = new Map(range.map((d, i) => [d.day, i]));
  /*
   * Where a marker sits. A day HEY actually read anchors to its own high; a
   * day it did not read anchors to the middle of the plot, NOT to `hi` — that
   * fallback put a build event at the all-time peak directly above a grey "no
   * reading" column, which is the chart asserting a correlation with a price
   * it never observed.
   */
  const mid = lo2 + span / 2;
  const highOf = new Map(range.map((d) => [d.day, d.high ?? d.close ?? mid] as const));

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => lo2 + span * f);
  const tickCount = Math.min(6, range.length);
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i * (range.length - 1)) / Math.max(1, tickCount - 1)),
  );

  const marked = events.filter((e) => e.precision !== 'week' && indexOf.has(e.day));

  /*
   * Where every marker sits, resolved once (geometry audit, 2026-09-22).
   *
   * The stack index used to be counted inside the render loop and the callout
   * cards recomputed their own anchor without it, so a labelled event that was
   * not the first of its day got a card drawn thirteen units below its own
   * dot. The two could not be kept in step because only one of them was
   * counting. They now read the same map.
   *
   * `marked` is not guaranteed to be day-contiguous either: an event with
   * unknown precision is displayed on the day HEY detected it while the query
   * that produced the list sorted on the day it was published, so two events
   * from one day can arrive with a third between them. Keying the stack by
   * event id rather than by arrival order is what makes that harmless.
   */
  const stackOf = new Map<string, number>();
  const perDay = new Map<string, number>();
  for (const event of marked) {
    const seen = perDay.get(event.day) ?? 0;
    stackOf.set(event.id, seen);
    perDay.set(event.day, seen + 1);
  }

  /**
   * A marker's y, with the whole stack fitted above the plot's ceiling.
   *
   * The offset used to be a flat `stack * 13` clamped at `padT + 5`. On a day
   * whose high was already near the top — a busy day that is also a price high,
   * which is the most interesting case on the chart — every level of the stack
   * hit the clamp and drew on the identical pixel, so three ships rendered as
   * one dot. The offset now compresses to whatever room is left instead, so
   * the markers stay distinct however little of it there is.
   */
  const markerY = (event: ChartEvent, stack: number) => {
    const base = y(highOf.get(event.day) ?? mid) - 11;
    const ceiling = padT + 5;
    const count = perDay.get(event.day) ?? 1;
    if (stack === 0) return r2(Math.max(ceiling, base));
    const room = Math.max(0, base - ceiling);
    const step = Math.min(13, room / Math.max(1, count - 1));
    return r2(Math.max(ceiling, base - stack * step));
  };

  const labelled = pickLabels(marked, indexOf, range.length);

  return (
    <figure className={cn('m-0', className)}>
      <div className="flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block h-[240px] w-full sm:h-[320px] lg:h-[380px]"
            role="img"
            /*
             * `role="img"` makes the drawing a leaf, so every `<title>` inside
             * it is a mouse tooltip and nothing more, and the axis columns are
             * `aria-hidden` because they repeat the drawing. That leaves this
             * sentence as the whole of the chart for a screen reader, so it
             * carries the ranges rather than only the counts.
             */
            aria-label={`Daily candles from ${range[0]!.day} to ${range[range.length - 1]!.day}, ${money(lo)} to ${money(hi)}, last close ${money(last.close!)}. ${gapDays} of ${range.length} days without a reading. ${events.length} builder events marked; each is listed on the Build events tab.`}
          >
            {grid.map((v) => (
              <line
                key={v}
                x1={padL}
                x2={W - padR}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--hey-border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {range.map((d, i) => {
              if (!d.readings) {
                return (
                  <rect
                    key={d.day}
                    x={r2(padL + cw * i)}
                    y={padT}
                    width={r2(cw)}
                    height={plotH}
                    fill="var(--hey-subtle)"
                    opacity={0.7}
                  >
                    <title>{`${d.day} — no reading`}</title>
                  </rect>
                );
              }
              if (typeof d.close !== 'number' || d.close <= 0) return null;
              const open = d.open ?? d.close;
              const high = d.high ?? Math.max(open, d.close);
              const low = d.low ?? Math.min(open, d.close);
              const up = d.close >= open;
              /*
               * The SOURCE tokens, not the `@theme inline` aliases
               * (`--market-up`). An alias resolves against `:root`, so an
               * inline `var()` never picks up the `[data-surface='v7']`
               * override — it resolves to nothing. With a `fill` that fell
               * back to black, which looked right in light mode and was
               * invisible in dark; as a `stroke` it became `none` and the
               * candles disappeared outright, which is how this was finally
               * caught. Utility classes read the aliases safely; inline styles
               * and SVG attributes must read `--hey-*`.
               */
              const tone = up ? 'var(--hey-market-up)' : 'var(--hey-market-down)';
              const top = y(Math.max(open, d.close));
              const bottom = y(Math.min(open, d.close));
              const vh = r2(((d.volume ?? 0) / maxVol) * volH);
              return (
                <g key={d.day}>
                  <line
                    x1={cx(i)}
                    x2={cx(i)}
                    y1={y(high)}
                    y2={y(low)}
                    stroke={tone}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <rect
                    x={r2(cx(i) - bodyW / 2)}
                    y={top}
                    width={bodyW}
                    height={Math.max(bottom - top, 0.8)}
                    fill={tone}
                  >
                    <title>{`${d.day} — open ${money(open)}, high ${money(high)}, low ${money(low)}, close ${money(d.close)} · ${d.readings} reading${d.readings === 1 ? '' : 's'}`}</title>
                  </rect>
                  {vh > 0 ? (
                    <rect
                      x={r2(cx(i) - bodyW / 2)}
                      y={padT + plotH + gap + volH - vh}
                      width={bodyW}
                      height={vh}
                      fill="var(--hey-ink)"
                      opacity={0.14}
                    />
                  ) : null}
                </g>
              );
            })}

            {/* Week bands sit behind the markers so a week never reads as a point. */}
            {events
              .filter((e) => e.precision === 'week' && indexOf.has(e.day))
              .map((e) => {
                const i = indexOf.get(e.day)!;
                const from = Math.max(0, i - 3);
                const width = Math.min(range.length - from, 7) * cw;
                return (
                  <rect
                    key={`band-${e.id}`}
                    x={r2(padL + cw * from)}
                    y={padT}
                    width={r2(width)}
                    height={plotH}
                    fill={LAYER_TONE.code}
                    opacity={0.08}
                  >
                    <title>{`${e.title} — ${e.timeLabel} · ${e.precisionLabel}`}</title>
                  </rect>
                );
              })}

            {marked.map((e) => {
              const i = indexOf.get(e.day)!;
              const stack = stackOf.get(e.id) ?? 0;
              /*
               * The marker sits on the day's own high, the way the reference
               * puts it on the price action, rather than in a band reserved
               * across the top. Same-day events stack upward from there, and
               * the whole stack is fitted inside the plot.
               */
              const anchorY = markerY(e, stack);
              const tone = LAYER_TONE[e.layer] ?? 'var(--hey-muted)';
              const hollow = e.precision === 'day';
              return (
                <g key={e.id}>
                  {/*
                    A marker is a dot of stroke, not a circle, so its size is in
                    real pixels. A 5-unit radius came out near 1.5 real pixels on
                    a phone, which is not a marker. Date-precision events keep
                    their hollow centre: the outer dot is the layer's tone, and a
                    narrower dot of the surface colour sits on top of it.
                  */}
                  <line
                    className="hey-marker"
                    x1={cx(i)}
                    x2={cx(i)}
                    y1={anchorY}
                    y2={anchorY + 0.01}
                    stroke={tone}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={e.precision === 'unknown' ? '1 2' : undefined}
                  >
                    <title>{`${e.title} — ${e.timeLabel} · ${e.precisionLabel}`}</title>
                  </line>
                  {hollow ? (
                    <line
                      className="hey-marker-core"
                      x1={cx(i)}
                      x2={cx(i)}
                      y1={anchorY}
                      y2={anchorY + 0.01}
                      stroke="var(--hey-surface)"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>

          {/*
            Written callouts for a few markers, as page text over the drawing.
            This is the reference's one real legibility idea: a dot tells a
            reader something happened, a card tells them what. Hidden below
            `sm`, where three cards over a 310px plot would cover the candles
            they annotate — the phone reads them in the timeline underneath.
          */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden sm:block">
            {labelled.map(({ event, index }) => {
              const fraction = index / Math.max(1, range.length - 1);
              const anchorY = markerY(event, stackOf.get(event.id) ?? 0);
              const tone = LAYER_TONE[event.layer] ?? 'var(--hey-muted)';
              /*
               * A card above a marker near the top of the plot lands outside
               * the chart entirely. Past the top fifth it hangs below its
               * marker instead, so a callout is always inside the drawing it
               * annotates.
               */
              const below = anchorY < padT + plotH * 0.2;
              return (
                <span
                  key={event.id}
                  className="absolute border border-hey-border bg-hey-surface px-2 py-1.5 shadow-sm"
                  style={{
                    left: xPct(index),
                    top: `calc(${(anchorY / H) * 100}% ${below ? '+ 14px' : '- 8px'})`,
                    transform: `translate(${fraction > 0.78 ? '-100%' : '-12px'}, ${below ? '0' : '-100%'})`,
                    borderRadius: 'var(--hey-radius-control)',
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
                    <span className="hey-telemetry text-[9px] leading-none text-hey-ink">
                      {event.layer}
                    </span>
                  </span>
                  <span className="mt-1 block max-w-[9rem] truncate text-[11px] leading-none text-hey-secondary">
                    {event.title}
                  </span>
                </span>
              );
            })}
          </div>

          {/*
            The last close, positioned over the drawing as page text. It used
            to be an SVG box with SVG type inside it: an 18x6 real-pixel badge
            holding 3.4-pixel numerals on a phone.
          */}
          <span
            className="pointer-events-none absolute right-0 -translate-y-1/2 bg-hey-ink px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-hey-on-ink"
            style={{ top: yPct(last.close!), borderRadius: '4px', fontFamily: 'var(--font-mono)' }}
          >
            {money(last.close!)}
          </span>
        </div>

        {/*
          The scales, as text that scales with the reader rather than with the
          drawing: prices against the candles, then the volume band's own top
          and floor. The reference labels the volume band too, and without it a
          reader has no idea whether those bars mean thousands or millions.
        */}
        <div
          aria-hidden="true"
          className="relative w-[4.6rem] shrink-0 text-[11px] tabular-nums text-hey-muted"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {grid.map((v) => (
            <span key={v} className="absolute left-0 -translate-y-1/2" style={{ top: yPct(v) }}>
              {money(v)}
            </span>
          ))}
          {maxVol > 1 ? (
            <>
              {/* Offset a little below the band's top so it clears the last price tick. */}
              <span
                className="absolute left-0"
                style={{ top: `${((padT + plotH + gap + 6) / H) * 100}%` }}
              >
                {compact(maxVol)}
              </span>
              <span
                className="absolute left-0 -translate-y-full"
                style={{ top: `${((padT + plotH + gap + volH) / H) * 100}%` }}
              >
                0
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* The date axis, likewise. */}
      <div
        aria-hidden="true"
        className="mt-1.5 flex justify-between pr-[calc(4.6rem+0.5rem)] text-[11px] tabular-nums text-hey-muted"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {ticks.map((i, n) => (
          <span key={`${i}-${n}`}>{shortDay(range[i]!.day)}</span>
        ))}
      </div>
      {/*
        Not `.hey-telemetry` with `normal-case` on top: globals.css is imported
        after Tailwind, so the utility and the class tie on specificity and the
        class wins — the caption rendered as a whole sentence in 11px
        letterspaced uppercase. The same trap is documented for hex addresses
        in `views.tsx`.
      */}
      <figcaption
        className="mt-2 text-[11px] text-hey-muted"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {`HEY index · 1D · ${indexed} days indexed · ${gapDays} without a reading`}
        {source ? ` · ${source}` : ''}
        {' · nothing here is a buy signal'}
      </figcaption>
    </figure>
  );
}
