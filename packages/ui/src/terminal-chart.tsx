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
  const lows = priced.map((d) => d.low ?? d.close!).filter((v) => v > 0);
  const highs = priced.map((d) => d.high ?? d.close!);
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  const span = hi - lo || hi || 1;

  /*
   * No text lives inside this drawing (2026-09-21).
   *
   * Every label used to be an SVG `<text>` sized in the 1000-unit coordinate
   * space. On a 390px phone the chart gets about 310 real pixels, a scale of
   * roughly 0.31, so 11-unit type rendered at about 3.4 real pixels and the
   * axis, the ticks and the price tag were all illegible. The rest of this
   * package solved that long ago — `market-charts.tsx` contains zero `<text>`
   * nodes and puts every label in ordinary page text — and this is that same
   * treatment. HTML labels scale with the reader's own font size, so they are
   * legible at any width and respect a browser zoom.
   *
   * The geometry follows: the SVG is the plot and nothing else, with no gutter
   * reserved for prices and no strip reserved for an axis.
   */
  const W = 1000;
  const H = 340;
  const padL = 4;
  const padR = 4;
  const padT = 46;
  const volH = 46;
  const gap = 8;
  const plotH = H - padT - volH - gap;
  const plotW = W - padL - padR;
  const cw = plotW / range.length;
  const y = (v: number) => padT + plotH - ((v - lo) / span) * plotH;
  const cx = (i: number) => padL + cw * i + cw / 2;
  /** Where a value sits as a share of the drawing's height, for an HTML label. */
  const yPct = (v: number) => `${(y(v) / H) * 100}%`;

  const maxVol = Math.max(...range.map((d) => d.volume ?? 0), 1);
  const { indexed, gaps: gapDays } = dayCoverage(days);
  const last = priced[priced.length - 1]!;
  const indexOf = new Map(range.map((d, i) => [d.day, i]));

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + span * f);
  const ticks = [0, Math.floor((range.length - 1) / 2), range.length - 1];

  /* Stack markers that land on the same day so none is hidden behind another. */
  const placed = new Map<string, number>();

  return (
    <figure className={cn('m-0', className)}>
      <div className="flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block h-[220px] w-full sm:h-[300px] lg:h-[340px]"
            role="img"
            aria-label={`Daily candles over ${range.length} days, ${gapDays} without a reading, with ${events.length} builder events`}
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
                    x={padL + cw * i}
                    y={padT}
                    width={cw}
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
              const vh = ((d.volume ?? 0) / maxVol) * volH;
              /*
               * Candles are drawn as strokes, not fills, so `non-scaling-stroke`
               * can hold their width in real pixels (2026-09-21). A filled
               * rectangle shrinks with the drawing: at ninety days on a phone a
               * body came out around 1.9 real pixels, and across the whole range
               * around 0.6. A stroke's width is set by CSS instead, which is how
               * `hey-candle` can be thinner on a phone and thicker on a desktop
               * with no client JavaScript and no second render.
               */
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
                  <line
                    className="hey-candle"
                    x1={cx(i)}
                    x2={cx(i)}
                    y1={top}
                    y2={Math.max(top + 0.5, bottom)}
                    stroke={tone}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="butt"
                  >
                    <title>{`${d.day} — open ${money(open)}, high ${money(high)}, low ${money(low)}, close ${money(d.close)} · ${d.readings} reading${d.readings === 1 ? '' : 's'}`}</title>
                  </line>
                  {vh > 0 ? (
                    <line
                      className="hey-candle"
                      x1={cx(i)}
                      x2={cx(i)}
                      y1={padT + plotH + gap + volH}
                      y2={padT + plotH + gap + volH - vh}
                      stroke="var(--hey-ink)"
                      opacity={0.12}
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="butt"
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
                    x={padL + cw * from}
                    y={padT}
                    width={width}
                    height={plotH}
                    fill={LAYER_TONE.code}
                    opacity={0.08}
                  >
                    <title>{`${e.title} — ${e.timeLabel} · ${e.precisionLabel}`}</title>
                  </rect>
                );
              })}

            {events
              .filter((e) => e.precision !== 'week' && indexOf.has(e.day))
              .map((e) => {
                const i = indexOf.get(e.day)!;
                const stack = placed.get(e.day) ?? 0;
                placed.set(e.day, stack + 1);
                const anchorY = padT + 14 + stack * 15;
                const tone = LAYER_TONE[e.layer] ?? 'var(--hey-muted)';
                const hollow = e.precision === 'day';
                return (
                  <g key={e.id}>
                    <line
                      x1={cx(i)}
                      x2={cx(i)}
                      y1={anchorY}
                      y2={padT + plotH}
                      stroke={tone}
                      strokeWidth={1}
                      opacity={0.32}
                      vectorEffect="non-scaling-stroke"
                    />
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

        {/* The price scale, as text that scales with the reader rather than the drawing. */}
        <div
          aria-hidden="true"
          className="relative w-[3.4rem] shrink-0 text-[11px] tabular-nums text-hey-muted"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {grid.map((v) => (
            <span key={v} className="absolute left-0 -translate-y-1/2" style={{ top: yPct(v) }}>
              {money(v)}
            </span>
          ))}
        </div>
      </div>

      {/* The date axis, likewise. */}
      <div
        aria-hidden="true"
        className="mt-1.5 flex justify-between pr-[5.4rem] text-[11px] tabular-nums text-hey-muted"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {ticks.map((i) => (
          <span key={i}>{shortDay(range[i]!.day)}</span>
        ))}
      </div>
      <figcaption className="hey-telemetry mt-2 normal-case tracking-normal">
        {`HEY index · 1D · ${indexed} days indexed · ${gapDays} without a reading`}
        {source ? ` · ${source}` : ''}
        {' · nothing here is a buy signal'}
      </figcaption>
    </figure>
  );
}
