import type { ReactNode } from 'react';

import { cn } from './cn';
import { formatUsdCompact } from './format';

/**
 * Daily charts for HEY's own market index (2026-09-13): the same recipe as
 * every other chart in this package — server-rendered SVG or CSS bars,
 * colours from the theme tokens, a `<title>` per point, a `role="img"`
 * summary, and an honest empty state. No client bundle, no charting
 * dependency.
 *
 * Small by design (2026-09-13, second pass): each chart is a panel with its
 * own label and latest value on one line, sized so four of them fit a screen
 * instead of one filling it. A chart never says "up" or "down" in words, and
 * nothing here is a buy signal.
 */
export type DailyPoint = { day: string; value: number };

const shortDay = (day: string) => day.slice(5).replace('-', '/');

export function ChartNote({ message, hint, className }: { message: string; hint?: string; className?: string }) {
  return (
    <div className={cn('rounded-[6px] border border-dashed border-hey-border px-4 py-6 text-center', className)}>
      <p className="text-[13.5px] text-hey-secondary">{message}</p>
      {hint ? <p className="mt-0.5 text-[12.5px] text-hey-muted">{hint}</p> : null}
    </div>
  );
}

/** One chart in its frame: a label, the latest figure, the drawing, a short note. */
export function ChartPanel({ label, value, note, children, className, testId }: { label: string; value?: string | undefined; note?: string | undefined; children: ReactNode; className?: string; testId?: string }) {
  return (
    <figure className={cn('min-w-0', className)} data-testid={testId}>
      <figcaption className="flex items-baseline justify-between gap-3 border-b border-hey-border pb-1.5">
        <span className="hey-eyebrow text-hey-muted">{label}</span>
        {value ? <span className="text-[13px] font-medium tabular-nums">{value}</span> : null}
      </figcaption>
      <div className="mt-2.5">{children}</div>
      {note ? <p className="mt-1.5 text-[12px] text-hey-muted">{note}</p> : null}
    </figure>
  );
}

/** A line over days. The scale's high and the first and last day are labelled; nothing else. */
export function DailyLineChart({
  points,
  label,
  format = formatUsdCompact,
  className,
  testId,
}: {
  points: readonly DailyPoint[];
  label: string;
  format?: (value: number) => string | undefined;
  className?: string;
  testId?: string;
}) {
  if (points.length < 2) {
    return <ChartNote className={className} message={`Not enough days for ${label.toLowerCase()} yet.`} hint="One reading a day; the line appears from the second." />;
  }
  const width = 720;
  const height = 128;
  const pad = { top: 14, right: 8, bottom: 18, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  const span = max - min || max || 1;
  const x = (i: number) => pad.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => pad.top + plotH - ((v - min) / span) * plotH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <div className={className} data-testid={testId}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" preserveAspectRatio="none" aria-label={`${label} by day: ${points.map((p) => `${p.day} ${format(p.value) ?? p.value}`).join('; ')}`}>
        <path d={path} fill="none" stroke="var(--color-hey-border-strong)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3.5 : 1.6} fill={i === points.length - 1 ? 'var(--color-hey-ink)' : 'var(--color-hey-border-strong)'}>
            <title>{`${p.day}: ${format(p.value) ?? p.value}`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-1 flex justify-between text-[11px] tabular-nums text-hey-muted">
        <span>{shortDay(points[0]!.day)}</span>
        <span>high {format(max) ?? max}</span>
        <span>{shortDay(last.day)}</span>
      </p>
    </div>
  );
}

/** Bars over days; an optional second series stacks under the first (sells under buys). */
export function DailyBarsChart({
  points,
  label,
  format = (value: number) => value.toLocaleString('en-US'),
  primaryLabel,
  secondaryLabel,
  className,
  testId,
}: {
  points: readonly (DailyPoint & { secondary?: number })[];
  label: string;
  format?: (value: number) => string | undefined;
  /** What the first series is called when a second stacks under it ("buys" under "sells"). */
  primaryLabel?: string;
  secondaryLabel?: string;
  className?: string;
  testId?: string;
}) {
  if (points.length === 0) {
    return <ChartNote className={className} message={`No ${label.toLowerCase()} indexed yet.`} hint="HEY reads the chain daily; days fill in as they are indexed." />;
  }
  if (points.length === 1) {
    const only = points[0]!;
    return <ChartNote className={className} message={`One day indexed so far: ${only.day} · ${format(only.value) ?? only.value}`} hint="The bars appear from the second day." />;
  }
  const max = Math.max(...points.map((p) => p.value + (p.secondary ?? 0)), 1);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <div className={className} data-testid={testId}>
      <div
        className="flex h-[92px] items-end gap-[3px]"
        role="img"
        aria-label={`${label} by day: ${points.map((p) => `${p.day} ${format(p.value) ?? p.value}${p.secondary !== undefined ? ` and ${format(p.secondary) ?? p.secondary} ${secondaryLabel ?? ''}` : ''}`).join('; ')}`}
      >
        {points.map((p) => {
          const total = p.value + (p.secondary ?? 0);
          return (
            <div key={p.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="flex w-full flex-col justify-end" style={{ height: `${Math.max(2, (total / max) * 100)}%` }}>
                <div className="w-full rounded-t-[2px] bg-hey-ink/75" style={{ height: total > 0 ? `${(p.value / total) * 100}%` : '100%' }}>
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
      <p className="mt-1 flex justify-between gap-3 text-[11px] tabular-nums text-hey-muted">
        <span>{shortDay(first.day)}</span>
        {secondaryLabel ? (
          <span>
            {primaryLabel ?? label.toLowerCase()} above · {secondaryLabel} below
          </span>
        ) : null}
        <span>{shortDay(last.day)}</span>
      </p>
    </div>
  );
}
