import { cn } from './cn';
import { formatUsdCompact } from './format';

/**
 * Daily charts for HEY's own market index (2026-09-13): the same recipe as
 * every other chart in this package — server-rendered SVG or CSS bars, colours
 * from the theme tokens, a `<title>` per point, a `role="img"` summary, and
 * an honest empty state. No client bundle, no charting dependency.
 *
 * A chart never says "up" or "down" in words; it shows the figures and their
 * source, and the caption says what they are. Nothing here is a buy signal.
 */
export type DailyPoint = { day: string; value: number };

const shortDay = (day: string) => day.slice(5).replace('-', '/');

export function ChartNote({ message, hint, className }: { message: string; hint?: string; className?: string }) {
  return (
    <div className={cn('rounded-[6px] border border-dashed border-hey-border bg-hey-subtle p-8 text-center', className)}>
      <p className="text-[15px] font-medium">{message}</p>
      {hint ? <p className="mt-1.5 text-[14px] text-hey-secondary">{hint}</p> : null}
    </div>
  );
}

/** A line over days, with the highest and latest values labelled. */
export function DailyLineChart({
  points,
  label,
  format = formatUsdCompact,
  caption,
  className,
  testId,
}: {
  points: readonly DailyPoint[];
  label: string;
  format?: (value: number) => string | undefined;
  caption?: string;
  className?: string;
  testId?: string;
}) {
  if (points.length < 2) {
    return <ChartNote className={className} message={`Not enough days for ${label.toLowerCase()} yet.`} hint="HEY keeps one reading a day; the line appears after the second day." />;
  }
  const width = 720;
  const height = 180;
  const pad = { top: 18, right: 16, bottom: 26, left: 16 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  const span = max - min || max || 1;
  const x = (i: number) => pad.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - ((v - min) / span) * plotH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <figure className={className} data-testid={testId}>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[360px]" role="img" aria-label={`${label} by day: ${points.map((p) => `${p.day} ${format(p.value) ?? p.value}`).join('; ')}`}>
          <path d={path} fill="none" stroke="var(--color-hey-border-strong)" strokeWidth={2} />
          {points.map((p, i) => (
            <circle key={p.day} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 4 : 2.5} fill={i === points.length - 1 ? 'var(--color-hey-ink)' : 'var(--color-hey-border-strong)'}>
              <title>{`${p.day}: ${format(p.value) ?? p.value}`}</title>
            </circle>
          ))}
          <text x={pad.left} y={12} className="text-[11px]" fill="var(--color-hey-muted)">
            {`High ${format(max) ?? max}`}
          </text>
          <text x={width - pad.right} y={12} textAnchor="end" className="text-[11px]" fill="var(--color-hey-muted)">
            {`Latest ${format(last.value) ?? last.value}`}
          </text>
          <text x={pad.left} y={height - 8} className="text-[11px]" fill="var(--color-hey-muted)">
            {shortDay(points[0]!.day)}
          </text>
          <text x={width - pad.right} y={height - 8} textAnchor="end" className="text-[11px]" fill="var(--color-hey-muted)">
            {shortDay(last.day)}
          </text>
        </svg>
      </div>
      {caption ? <figcaption className="mt-2 text-[13px] text-hey-secondary">{caption}</figcaption> : null}
    </figure>
  );
}

/** Bars over days; an optional second series stacks under the first (sells under buys). */
export function DailyBarsChart({
  points,
  label,
  format = (value: number) => value.toLocaleString('en-US'),
  primaryLabel,
  secondaryLabel,
  caption,
  className,
  testId,
}: {
  points: readonly (DailyPoint & { secondary?: number })[];
  label: string;
  format?: (value: number) => string | undefined;
  /** What the first series is called when a second stacks under it ("buys" under "sells"). */
  primaryLabel?: string;
  secondaryLabel?: string;
  caption?: string;
  className?: string;
  testId?: string;
}) {
  if (points.length === 0) {
    return <ChartNote className={className} message={`No ${label.toLowerCase()} indexed yet.`} hint="HEY reads the chain daily; days fill in as they are indexed." />;
  }
  if (points.length === 1) {
    // One bar filling the row reads as a chart of nothing; say the one figure instead.
    const only = points[0]!;
    return (
      <ChartNote
        className={className}
        message={`One day indexed so far: ${only.day} · ${format(only.value) ?? only.value}${only.secondary !== undefined ? ` ${primaryLabel ?? label.toLowerCase()} / ${format(only.secondary) ?? only.secondary} ${secondaryLabel ?? ''}` : ''}`}
        hint="The bars appear from the second day."
      />
    );
  }
  const max = Math.max(...points.map((p) => p.value + (p.secondary ?? 0)), 1);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const lastLabel = `${shortDay(last.day)} · ${format(last.value) ?? last.value}${last.secondary !== undefined ? ` / ${format(last.secondary) ?? last.secondary} ${secondaryLabel ?? ''}` : ''}`;
  return (
    <figure className={className} data-testid={testId}>
      <div
        className="flex h-36 items-end gap-1.5"
        role="img"
        aria-label={`${label} by day: ${points.map((p) => `${p.day} ${format(p.value) ?? p.value}${p.secondary !== undefined ? ` and ${format(p.secondary) ?? p.secondary} ${secondaryLabel ?? ''}` : ''}`).join('; ')}`}
      >
        {points.map((p) => {
          const total = p.value + (p.secondary ?? 0);
          return (
            <div key={p.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="flex w-full flex-col justify-end" style={{ height: `${Math.max(3, (total / max) * 100)}%` }}>
                <div className="w-full rounded-t-[3px] bg-blue-500" style={{ height: total > 0 ? `${(p.value / total) * 100}%` : '100%' }}>
                  <title>{`${p.day}: ${format(p.value) ?? p.value}${secondaryLabel ? ` ${primaryLabel ?? label.toLowerCase()}` : ''}`}</title>
                </div>
                {p.secondary !== undefined && total > 0 ? (
                  <div className="w-full bg-hey-border-strong" style={{ height: `${(p.secondary / total) * 100}%` }}>
                    <title>{`${p.day}: ${format(p.secondary) ?? p.secondary} ${secondaryLabel ?? ''}`}</title>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Day labels sit outside the bar row so fourteen bars fit a phone: the first day, then the last day with its value. */}
      <div className="mt-1 flex justify-between gap-3 text-[10px] tabular-nums text-hey-muted">
        <span>{shortDay(first.day)}</span>
        <span className="truncate">{lastLabel}</span>
      </div>
      {caption ? <figcaption className="mt-2 text-[13px] text-hey-secondary">{caption}</figcaption> : null}
    </figure>
  );
}
