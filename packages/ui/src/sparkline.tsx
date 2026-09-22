import { cn } from './cn';

/**
 * A small server-rendered bar sparkline (2026-09-21).
 *
 * The package had no compact series primitive: `DailyLineChart` is a full
 * chart with axis labels, and `CodeHeatmap` is a calendar. A repository row
 * wanting to show its own ninety days had nothing to reach for.
 *
 * It follows the rule the rest of the package's charts settled on, which the
 * candle chart had to be taught the hard way: **no text inside the drawing.**
 * Every label here is ordinary page text, so nothing becomes illegible when the
 * SVG is scaled into a narrow column. There is no client bundle and no
 * charting dependency.
 *
 * Days are drawn in the order given and a zero day keeps its slot, so a gap
 * reads as a gap rather than closing up.
 */
export type SparkDay = { day: string; value: number };

export function Sparkline({
  days,
  label,
  className,
  tone = 'var(--hey-accent-ui)',
  max: fixedMax,
}: {
  days: readonly SparkDay[];
  /** Read to a screen reader in place of the drawing. Say what it counts. */
  label: string;
  className?: string;
  tone?: string;
  /**
   * The top of the scale, where the series already has one (2026-09-22).
   *
   * Without it the drawing stretches to whatever the project itself reached,
   * so a Build Momentum moving 11.0 to 11.4 climbs the full height — beside a
   * figure reading "64 / 100". A count has no natural ceiling and keeps the
   * default; a score has one and should be drawn against it.
   */
  max?: number;
}) {
  if (days.length === 0) return null;

  const max = fixedMax ?? Math.max(...days.map((day) => day.value), 1);
  const W = 240;
  const H = 32;
  const gap = days.length > 60 ? 0.5 : 1;
  const width = Math.max(0.8, W / days.length - gap);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn('block h-8 w-full', className)}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {days.map((day, index) => {
        const height = day.value > 0 ? Math.max(1.5, (day.value / max) * H) : 0;
        return height === 0 ? null : (
          <rect
            key={day.day}
            x={(W / days.length) * index}
            y={H - height}
            width={width}
            height={height}
            fill={tone}
            opacity={0.85}
          >
            <title>{`${day.day}: ${day.value}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
