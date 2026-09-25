import { cn } from './cn';
import { formatRelativeTime, formatUsdCompact } from './format';
import { activityLabel, type ActivityStatusValue } from './status';

/**
 * Charts are plain SVG, server-rendered.
 *
 * No charting library: the visualisations HEY needs are simple, and a library
 * would ship client JavaScript for something the server can draw once. Bubbles
 * are real links and tooltips are native `<title>`, so the chart works with
 * JavaScript disabled and is reachable by keyboard (UI/UX V2 sections 42, 49).
 */
export type ScatterDatum = {
  slug: string;
  name: string;
  symbol?: string;
  activityStatus: ActivityStatusValue;
  buildMomentum: number;
  marketAttention: number;
  marketCapUsd?: number;
  lastMeaningfulShipAt?: Date;
};

const STATUS_FILL: Record<string, string> = {
  SHIPPING: 'var(--color-status-shipping)',
  ACTIVE: 'var(--color-status-active)',
  QUIET: 'var(--color-status-quiet)',
  DORMANT: 'var(--color-status-dormant)',
  RESUMED: 'var(--color-status-resumed)',
  UNKNOWN: 'var(--color-status-unknown)',
};

/**
 * Build vs Market (UI/UX V2 section 15).
 *
 * Y is how much a project ships, X is how much the market currently notices, so
 * the top-left quadrant is the product's whole thesis made visible.
 */
export function BuildVsMarketChart({
  data,
  className,
}: {
  data: readonly ScatterDatum[];
  className?: string;
}) {
  const width = 960;
  const height = 520;
  const pad = { top: 28, right: 28, bottom: 52, left: 62 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const x = (value: number) => pad.left + (Math.min(100, Math.max(0, value)) / 100) * plotW;
  const y = (value: number) => pad.top + plotH - (Math.min(100, Math.max(0, value)) / 100) * plotH;

  // Bubble area tracks market cap, on a log scale so one large project does not
  // flatten everything else.
  const radius = (cap?: number) => {
    if (!cap || cap <= 0) return 6;
    return Math.min(26, 6 + Math.log10(cap) * 2.4);
  };

  if (data.length === 0) {
    return (
      <ChartEmpty
        className={className}
        message="No projects can be placed yet."
        hint="A project appears once HEY has both a build score and market context for it."
      />
    );
  }

  return (
    <figure className={cn('w-full', className)}>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[640px]"
          role="img"
          aria-label={`Build momentum against market attention for ${data.length} projects. The top-left quadrant holds projects building more than the market currently notices.`}
        >
          {/* Quadrant fill: only the thesis quadrant is tinted. */}
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW / 2}
            height={plotH / 2}
            fill="var(--color-hey-accent-soft)"
          />

          <line
            x1={pad.left}
            y1={pad.top + plotH / 2}
            x2={pad.left + plotW}
            y2={pad.top + plotH / 2}
            stroke="var(--color-hey-border)"
          />
          <line
            x1={pad.left + plotW / 2}
            y1={pad.top}
            x2={pad.left + plotW / 2}
            y2={pad.top + plotH}
            stroke="var(--color-hey-border)"
          />

          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            fill="none"
            stroke="var(--color-hey-border)"
          />

          <QuadrantLabel x={pad.left + 14} y={pad.top + 22} text="Under the radar" strong />
          <QuadrantLabel x={pad.left + plotW - 14} y={pad.top + 22} text="Leaders" anchor="end" />
          <QuadrantLabel x={pad.left + 14} y={pad.top + plotH - 12} text="Quiet" />
          <QuadrantLabel
            x={pad.left + plotW - 14}
            y={pad.top + plotH - 12}
            text="Market-led"
            anchor="end"
          />

          {data.map((point) => (
            <a key={point.slug} href={`/project/${point.slug}`}>
              <circle
                cx={x(point.marketAttention)}
                cy={y(point.buildMomentum)}
                r={radius(point.marketCapUsd)}
                fill={STATUS_FILL[point.activityStatus] ?? STATUS_FILL.UNKNOWN}
                fillOpacity={0.18}
                stroke={STATUS_FILL[point.activityStatus] ?? STATUS_FILL.UNKNOWN}
                strokeWidth={1.5}
                className="cursor-pointer hover:fill-opacity-40"
              >
                {/* Native tooltip: no JavaScript, and screen readers can reach it. */}
                <title>
                  {[
                    `${point.name}${point.symbol ? ` ($${point.symbol})` : ''}`,
                    activityLabel(point.activityStatus),
                    `Build Momentum ${Math.round(point.buildMomentum)}`,
                    `Market attention ${describeAttention(point.marketAttention)}`,
                    `Market cap ${formatUsdCompact(point.marketCapUsd) ?? 'not available'}`,
                    point.lastMeaningfulShipAt
                      ? `Last ship ${formatRelativeTime(point.lastMeaningfulShipAt)}`
                      : 'No ship recorded',
                  ].join('\n')}
                </title>
              </circle>
            </a>
          ))}

          <AxisLabel x={pad.left + plotW / 2} y={height - 14} text="Market attention →" />
          <AxisLabel
            x={-(pad.top + plotH / 2)}
            y={18}
            text="Build momentum →"
            transform="rotate(-90)"
          />
        </svg>
      </div>

      <figcaption className="mt-3 text-[13px] text-hey-secondary">
        Each bubble is a project; size reflects market cap and colour reflects activity status.
        Position describes what has happened, not what will.
      </figcaption>
    </figure>
  );
}

const describeAttention = (value: number): string =>
  value < 33 ? 'low' : value < 66 ? 'moderate' : 'high';

function QuadrantLabel({
  x,
  y,
  text,
  anchor = 'start',
  strong,
}: {
  x: number;
  y: number;
  text: string;
  anchor?: 'start' | 'end';
  strong?: boolean;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      className={cn('text-[11px] uppercase tracking-wider', strong ? 'font-semibold' : '')}
      fill={strong ? 'var(--color-hey-accent)' : 'var(--color-hey-muted)'}
    >
      {text}
    </text>
  );
}

function AxisLabel({
  x,
  y,
  text,
  transform,
}: {
  x: number;
  y: number;
  text: string;
  transform?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      transform={transform}
      className="text-[12px]"
      fill="var(--color-hey-secondary)"
    >
      {text}
    </text>
  );
}

function ChartEmpty({
  message,
  hint,
  className,
}: {
  message: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[6px] border border-dashed border-hey-border bg-hey-subtle p-12 text-center',
        className,
      )}
    >
      <p className="text-[15px] font-medium">{message}</p>
      {hint ? <p className="mt-1.5 text-[15px] text-hey-secondary">{hint}</p> : null}
    </div>
  );
}
