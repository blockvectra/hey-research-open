import { ChartNote } from './market-charts';
import { cn } from './cn';

/**
 * One daily series, drawn the way the candle chart draws its days (2026-09-22).
 *
 * The reference's chart carries a strip of series — price, builder events,
 * momentum — and two of those are not prices. This is the drawing for those
 * two, and it is deliberately the candle chart's twin rather than a second
 * charting idea: the same date range with real gaps, the same right-hand
 * scale, the same HTML labels so type stays legible on a phone, the same
 * `<title>` per element, no client bundle.
 *
 * It also answers the reference's no-market screen. Most projects on this
 * chain have no tracked market at all, and that screen replaces the candles
 * with build history rather than showing an empty frame — so the same
 * component is what a tokenless project sees first.
 *
 * `kind` changes only how a value is read back to the reader, never the
 * geometry: `count` prints whole numbers, `score` prints a figure out of 100.
 */
export type SeriesDay = {
  day: string;
  /** Absent means HEY has no reading for that day — drawn as a gap, never as zero. */
  value?: number;
};

const GAP = 'var(--hey-subtle)';

/** Every UTC day between the first and the last, so a missing one keeps its place. */
function fullRange(days: readonly SeriesDay[]): SeriesDay[] {
  if (days.length === 0) return [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const out: SeriesDay[] = [];
  const start = new Date(`${days[0]!.day}T00:00:00.000Z`);
  const end = new Date(`${days[days.length - 1]!.day}T00:00:00.000Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day });
  }
  return out;
}

const shortDay = (day: string) => day.slice(5).replace('-', '/');

export function DailySeriesChart({
  days,
  kind,
  label,
  caption,
  className,
}: {
  days: readonly SeriesDay[];
  kind: 'count' | 'score';
  /** What one bar means, read out in the accessible summary. */
  label: string;
  caption?: string;
  className?: string;
}) {
  const read = days.filter((d) => typeof d.value === 'number');
  if (read.length < 2) {
    return (
      <ChartNote
        message={`Not enough days recorded to draw ${label.toLowerCase()} yet.`}
        hint="HEY writes one value a day; the chart appears from the second."
        className={className}
      />
    );
  }

  const range = fullRange(days);
  const values = read.map((d) => d.value!);
  /*
   * A count chart is honest only from zero — a bar chart with a floating floor
   * turns "three ships" into "three times as much as two". A score is already
   * a position on a fixed 0-100 scale, so it keeps that scale rather than
   * stretching to whatever this project happened to reach.
   */
  const hi = kind === 'score' ? 100 : Math.max(...values, 1);
  const lo = 0;
  const span = hi - lo || 1;

  const W = 1000;
  const H = 260;
  const padL = 4;
  const padR = 4;
  const padT = 12;
  const padB = 10;
  const plotH = H - padT - padB;
  const plotW = W - padL - padR;
  const cw = plotW / range.length;
  /* Two decimals, for the reason the candle chart's `r2` records at length. */
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const barW = r2(Math.max(cw * 0.62, 0.6));
  const y = (v: number) => r2(padT + plotH - ((v - lo) / span) * plotH);
  const yPct = (v: number) => `${(y(v) / H) * 100}%`;

  const grid = kind === 'score' ? [0, 25, 50, 75, 100] : [0, 0.5, 1].map((f) => lo + span * f);
  const tickCount = Math.min(6, range.length);
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i * (range.length - 1)) / Math.max(1, tickCount - 1)),
  );
  const readable = (v: number) =>
    kind === 'score' ? `${Math.round(v)}` : `${Math.round(v).toLocaleString('en-US')}`;
  const gaps = range.filter((d) => typeof d.value !== 'number').length;

  return (
    <figure className={cn('m-0', className)}>
      <div className="flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block h-[200px] w-full sm:h-[260px] lg:h-[300px]"
            role="img"
            aria-label={`${label} from ${range[0]!.day} to ${range[range.length - 1]!.day}. Latest ${readable(read[read.length - 1]!.value!)}, highest ${readable(Math.max(...values))}. ${gaps} of ${range.length} days without a reading.`}
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
              const x = r2(padL + cw * i);
              if (typeof d.value !== 'number') {
                return (
                  <rect
                    key={d.day}
                    x={x}
                    y={padT}
                    width={r2(cw)}
                    height={plotH}
                    fill={GAP}
                    opacity={0.7}
                  >
                    <title>{`${d.day} — no reading`}</title>
                  </rect>
                );
              }
              const top = y(d.value);
              return (
                <rect
                  key={d.day}
                  x={r2(x + (cw - barW) / 2)}
                  y={top}
                  width={barW}
                  height={r2(Math.max(padT + plotH - top, d.value > 0 ? 1 : 0))}
                  fill="var(--hey-accent-ui)"
                  opacity={0.85}
                >
                  <title>{`${d.day} — ${readable(d.value)}`}</title>
                </rect>
              );
            })}
          </svg>
        </div>

        <div
          aria-hidden="true"
          className="relative w-[4.6rem] shrink-0 text-[11px] tabular-nums text-hey-muted"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {grid.map((v) => (
            <span key={v} className="absolute left-0 -translate-y-1/2" style={{ top: yPct(v) }}>
              {readable(v)}
            </span>
          ))}
        </div>
      </div>

      <div
        aria-hidden="true"
        className="mt-1.5 flex justify-between pr-[calc(4.6rem+0.5rem)] text-[11px] tabular-nums text-hey-muted"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        {ticks.map((i, n) => (
          <span key={`${i}-${n}`}>{shortDay(range[i]!.day)}</span>
        ))}
      </div>
      {caption ? (
        <figcaption
          className="mt-2 text-[11px] text-hey-muted"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
