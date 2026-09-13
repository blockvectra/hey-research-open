import type { ReactNode } from 'react';

import { cn } from './cn';
import { formatUsdCompact } from './format';

/**
 * Daily charts for HEY's own market index (2026-09-13): the same recipe as
 * every other chart in this package — server-rendered SVG or CSS bars, a
 * `<title>` per point, a `role="img"` summary, and an honest empty state. No
 * client bundle, no charting dependency.
 *
 * Small, and coloured by what the series *is* (second pass, 2026-09-13): one
 * hue per measure, drawn from the theme's data palette, so four panels can
 * sit side by side and still be told apart at a glance. Price and volume are
 * Research Blue, liquidity teal, buys green over sells amber, transfers
 * violet. Red is not used: it belongs to real errors, and a falling line is
 * not an error. A chart never says "up" or "down" in words, and nothing here
 * is a buy signal.
 */
export type DailyPoint = { day: string; value: number };

/** Which measure a chart is drawing; it picks the hue, nothing else. */
export type ChartTone = 'price' | 'liquidity' | 'volume' | 'trades' | 'transfers' | 'events' | 'tvl' | 'neutral';

const TONES: Record<ChartTone, { stroke: string; fill: string; bar: string; barTo: string }> = {
  price: { stroke: 'var(--color-blue-500)', fill: 'var(--color-blue-500)', bar: 'var(--color-blue-500)', barTo: 'var(--color-blue-400)' },
  liquidity: { stroke: 'var(--color-narrative-trading)', fill: 'var(--color-narrative-trading)', bar: 'var(--color-narrative-trading)', barTo: 'var(--color-narrative-trading)' },
  volume: { stroke: 'var(--color-blue-500)', fill: 'var(--color-blue-500)', bar: 'var(--color-blue-500)', barTo: 'var(--color-blue-400)' },
  trades: { stroke: 'var(--color-status-shipping)', fill: 'var(--color-status-shipping)', bar: 'var(--color-status-shipping)', barTo: 'var(--color-status-shipping)' },
  transfers: { stroke: 'var(--color-narrative-infra)', fill: 'var(--color-narrative-infra)', bar: 'var(--color-narrative-infra)', barTo: 'var(--color-narrative-infra)' },
  events: { stroke: 'var(--color-narrative-trading)', fill: 'var(--color-narrative-trading)', bar: 'var(--color-narrative-trading)', barTo: 'var(--color-narrative-trading)' },
  tvl: { stroke: 'var(--color-narrative-defi)', fill: 'var(--color-narrative-defi)', bar: 'var(--color-narrative-defi)', barTo: 'var(--color-narrative-defi)' },
  neutral: { stroke: 'var(--color-hey-border-strong)', fill: 'var(--color-hey-border-strong)', bar: 'var(--color-hey-border-strong)', barTo: 'var(--color-hey-border-strong)' },
};
/** The second series under the first: amber, never red — a sell is not an error. */
const SECONDARY = 'var(--color-status-quiet)';

const shortDay = (day: string) => day.slice(5).replace('-', '/');
let uid = 0;
const nextId = () => `hey-chart-${(uid += 1)}`;

export function ChartNote({ message, hint, className }: { message: string; hint?: string; className?: string }) {
  return (
    <div className={cn('rounded-[6px] border border-dashed border-hey-border px-4 py-5 text-center', className)}>
      <p className="text-[13.5px] text-hey-secondary">{message}</p>
      {hint ? <p className="mt-0.5 text-[12.5px] text-hey-muted">{hint}</p> : null}
    </div>
  );
}

/** One chart in its frame: a label, the latest figure, the drawing, a short note. */
export function ChartPanel({
  label,
  value,
  note,
  tone = 'neutral',
  children,
  className,
  testId,
}: {
  label: string;
  value?: string | undefined;
  note?: string | undefined;
  tone?: ChartTone;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <figure className={cn('min-w-0', className)} data-testid={testId}>
      <figcaption className="flex items-baseline justify-between gap-3 border-b border-hey-border pb-1.5">
        <span className="hey-eyebrow flex items-center gap-1.5 text-hey-muted">
          <span aria-hidden="true" className="inline-block size-[7px] rounded-full" style={{ background: TONES[tone].stroke }} />
          {label}
        </span>
        {value ? <span className="text-[13px] font-medium tabular-nums">{value}</span> : null}
      </figcaption>
      <div className="mt-2.5">{children}</div>
      {note ? <p className="mt-1.5 text-[12px] text-hey-muted">{note}</p> : null}
    </figure>
  );
}

/** A line over days, with a soft area under it. The high and the first and last day are labelled; nothing else. */
export function DailyLineChart({
  points,
  label,
  tone = 'neutral',
  format = formatUsdCompact,
  className,
  testId,
}: {
  points: readonly DailyPoint[];
  label: string;
  tone?: ChartTone;
  format?: (value: number) => string | undefined;
  className?: string;
  testId?: string;
}) {
  if (points.length < 2) {
    return <ChartNote className={className} message={`Not enough days for ${label.toLowerCase()} yet.`} hint="One reading a day; the line appears from the second." />;
  }
  const width = 720;
  const height = 128;
  const pad = { top: 14, right: 8, bottom: 12, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  const span = max - min || max || 1;
  const x = (i: number) => pad.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => pad.top + plotH - ((v - min) / span) * plotH;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${height} L ${x(0).toFixed(1)} ${height} Z`;
  const last = points[points.length - 1]!;
  const colour = TONES[tone];
  const gradient = nextId();
  return (
    <div className={className} data-testid={testId}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" preserveAspectRatio="none" aria-label={`${label} by day: ${points.map((p) => `${p.day} ${format(p.value) ?? p.value}`).join('; ')}`}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour.fill} stopOpacity="0.22" />
            <stop offset="100%" stopColor={colour.fill} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradient})`} stroke="none" />
        <path d={line} fill="none" stroke={colour.stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3.5 : 1.5} fill={colour.stroke} opacity={i === points.length - 1 ? 1 : 0.55}>
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
  tone = 'neutral',
  format = (value: number) => value.toLocaleString('en-US'),
  primaryLabel,
  secondaryLabel,
  className,
  testId,
}: {
  points: readonly (DailyPoint & { secondary?: number })[];
  label: string;
  tone?: ChartTone;
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
  const colour = TONES[tone];
  return (
    <div className={className} data-testid={testId}>
      <div
        className="flex h-[92px] items-end gap-[3px] border-b border-hey-border"
        role="img"
        aria-label={`${label} by day: ${points.map((p) => `${p.day} ${format(p.value) ?? p.value}${p.secondary !== undefined ? ` and ${format(p.secondary) ?? p.secondary} ${secondaryLabel ?? ''}` : ''}`).join('; ')}`}
      >
        {points.map((p) => {
          const total = p.value + (p.secondary ?? 0);
          return (
            <div key={p.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-[3px]" style={{ height: `${Math.max(2, (total / max) * 100)}%` }}>
                <div
                  className="w-full"
                  style={{ height: total > 0 ? `${(p.value / total) * 100}%` : '100%', background: `linear-gradient(180deg, ${colour.barTo} 0%, ${colour.bar} 100%)` }}
                >
                  <title>{`${p.day}: ${format(p.value) ?? p.value}${secondaryLabel ? ` ${primaryLabel ?? label.toLowerCase()}` : ''}`}</title>
                </div>
                {p.secondary !== undefined && total > 0 ? (
                  <div className="w-full" style={{ height: `${(p.secondary / total) * 100}%`, background: SECONDARY, opacity: 0.85 }}>
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
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-[7px] rounded-[2px]" style={{ background: colour.bar }} />
            {primaryLabel ?? label.toLowerCase()}
            <span aria-hidden="true" className="ml-1 inline-block size-[7px] rounded-[2px]" style={{ background: SECONDARY }} />
            {secondaryLabel}
          </span>
        ) : null}
        <span>{shortDay(last.day)}</span>
      </p>
    </div>
  );
}
