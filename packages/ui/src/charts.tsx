import { cn } from './cn';
import { formatBuildMomentum, formatRelativeTime, formatUsdCompact, valuationKindLabel, tickerLabel } from './format';
import { activityLabel, statusColorVar, type ActivityStatusValue } from './status';

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
  /** Null when HEY has not measured it (2026-10-09 red-team F4): such a point has no height and is not drawn. */
  buildMomentum: number | null;
  marketAttention: number;
  marketCapUsd?: number;
  /** Which measure `marketCapUsd` is (2026-09-25); the tooltip names it, and an FDV is never called a market cap. */
  valuationKind?: 'marketCap' | 'fdv';
  lastMeaningfulShipAt?: Date;
  /**
   * Held by HEY's Under the Radar rule (2026-10-14): the point is ringed where it sits, never moved.
   * The rule, not the top-left quadrant, decides membership.
   */
  underTheRadar?: boolean;
};

/**
 * Build vs Market (UI/UX V2 section 15).
 *
 * Y is how much a project ships, X is how much the market currently notices.
 *
 * Under the Radar is the rule's, not the quadrant's (2026-10-14). The
 * top-left quadrant was labelled "Under the radar" and tinted, so a reader
 * took every bubble in it for the badge: production stored 18 projects under
 * the rule, the list beside it showed 6, and the quadrant held about 3 — the
 * rule asks for more than position (verified building, two meaningful ships
 * in 30 days, a positive Discovery Gap), so a held project can sit anywhere
 * and an unheld one can sit top-left. Each quadrant now names its position
 * only, and a point the rule holds is ringed where it sits, never moved.
 */
export function BuildVsMarketChart({
  data: all,
  underTheRadarTotal,
  attentionNotMeasured,
  className,
}: {
  data: readonly ScatterDatum[];
  /** How many projects the Under the Radar rule holds in all, so the caption can say how many are drawn. */
  underTheRadarTotal?: number;
  /** How many ranked builders are left off because the Discovery Gap does not measure their market (2026-10-16). */
  attentionNotMeasured?: number;
  className?: string;
}) {
  /*
   * A point whose Build Momentum HEY has not measured has no place on the Y
   * axis (2026-10-09 red-team F4): drawn at the floor it read "Activity
   * unknown · Build Momentum 0". It is left out and counted in the caption.
   */
  const placed = all.filter((point): point is ScatterDatum & { buildMomentum: number } => point.buildMomentum !== null);
  const unplaced = all.length - placed.length;
  const width = 960;
  const height = 520;
  const pad = { top: 28, right: 28, bottom: 52, left: 62 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  /*
   * Bubble size (2026-10-14, Pulse tidy): area tracks valuation on a log scale, normalised across the
   * drawn projects, from 4 to 13 px. The old absolute scale (6 + 2.4·log10) put almost every project
   * between 18 and 26 px, so the sizes said nothing and the bubbles buried one another.
   */
  const R_MIN = 4;
  const R_MAX = 13;
  const logs = placed.flatMap((point) => (point.marketCapUsd && point.marketCapUsd > 0 ? [Math.log10(point.marketCapUsd)] : []));
  const lo = logs.length ? Math.min(...logs) : 0;
  const hi = logs.length ? Math.max(...logs) : 0;
  const radius = (cap?: number) => {
    if (!cap || cap <= 0) return R_MIN;
    const share = hi > lo ? (Math.log10(cap) - lo) / (hi - lo) : 0.5;
    return Math.sqrt(R_MIN ** 2 + share * (R_MAX ** 2 - R_MIN ** 2));
  };

  /*
   * The scale is inset by the largest bubble and its ring (2026-10-14): a project at 0 or 100 sat
   * centred on the frame and spilled outside it. Inset on both sides, so 50 is still the midline.
   */
  const insetX = R_MAX + 6;
  const insetY = R_MAX + 18;
  const x = (value: number) => pad.left + insetX + (Math.min(100, Math.max(0, value)) / 100) * (plotW - 2 * insetX);
  const y = (value: number) => pad.top + plotH - insetY - (Math.min(100, Math.max(0, value)) / 100) * (plotH - 2 * insetY);

  // Largest first so a small bubble is never hidden under a large one; ringed points last, so no
  // unringed bubble is drawn over a ring.
  const bySize = (a: ScatterDatum, b: ScatterDatum) => radius(b.marketCapUsd) - radius(a.marketCapUsd);
  const data = [
    ...placed.filter((point) => !point.underTheRadar).sort(bySize),
    ...placed.filter((point) => point.underTheRadar).sort(bySize),
  ];
  const ringed = data.filter((point) => point.underTheRadar).length;
  const held = underTheRadarTotal ?? ringed;

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
          // A group, not an image (full audit, 2026-10-03; axe nested-interactive): every bubble is a link a keyboard reaches.
          role="group"
          aria-label={`Build momentum against market attention for ${data.length} projects. ${ringed} ${ringed === 1 ? 'is' : 'are'} ringed: held by HEY's Under the Radar rule, wherever ${ringed === 1 ? 'it sits' : 'they sit'}.`}
        >
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

          {data.map((point) => (
            <a
              key={point.slug}
              href={`/project/${point.slug}`}
              data-under-the-radar={point.underTheRadar ? 'true' : undefined}
              aria-label={`${point.name}${point.symbol ? ` (${tickerLabel(point.symbol)})` : ''}: ${activityLabel(point.activityStatus)}, Build Momentum ${formatBuildMomentum(point.buildMomentum)}, market attention ${describeAttention(point.marketAttention)}${point.underTheRadar ? ", Under the Radar by HEY's rule" : ''}`}
            >
              {point.underTheRadar ? (
                <circle
                  cx={x(point.marketAttention)}
                  cy={y(point.buildMomentum)}
                  r={radius(point.marketCapUsd) + 3}
                  fill="none"
                  stroke="var(--color-hey-accent)"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              ) : null}
              <circle
                cx={x(point.marketAttention)}
                cy={y(point.buildMomentum)}
                r={radius(point.marketCapUsd)}
                fill={statusColorVar(point.activityStatus)}
                fillOpacity={0.22}
                stroke={statusColorVar(point.activityStatus)}
                strokeWidth={1.25}
                className="cursor-pointer hover:fill-opacity-40"
              >
                {/* Native tooltip: no JavaScript, and screen readers can reach it. */}
                <title>
                  {[
                    `${point.name}${point.symbol ? ` (${tickerLabel(point.symbol)})` : ''}`,
                    activityLabel(point.activityStatus),
                    `Build Momentum ${formatBuildMomentum(point.buildMomentum)}`,
                    `Market attention ${describeAttention(point.marketAttention)}`,
                    ...(point.underTheRadar ? ["Under the Radar by HEY's rule"] : []),
                    point.marketCapUsd === undefined
                      ? 'Valuation not available'
                      : `${valuationKindLabel(point.valuationKind)} ${formatUsdCompact(point.marketCapUsd)}`,
                    point.lastMeaningfulShipAt
                      ? `Last ship ${formatRelativeTime(point.lastMeaningfulShipAt)}`
                      : 'No ship recorded',
                  ].join('\n')}
                </title>
              </circle>
            </a>
          ))}

          {/* Position only (2026-10-14): Under the Radar is the ring, decided by the rule.
              Drawn after the bubbles, on a halo, so a bubble never covers a label. */}
          <QuadrantLabel x={pad.left + 14} y={pad.top + 22} text="More momentum than attention" />
          <QuadrantLabel x={pad.left + plotW - 14} y={pad.top + 22} text="Leaders" anchor="end" />
          <QuadrantLabel x={pad.left + 14} y={pad.top + plotH - 12} text="Quiet" />
          <QuadrantLabel
            x={pad.left + plotW - 14}
            y={pad.top + plotH - 12}
            text="Market-led"
            anchor="end"
          />

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
        <span className="flex items-center gap-2 text-hey-ink" data-testid="build-vs-market-radar-key">
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-hey-accent)" strokeWidth="2" />
          </svg>
          {held === 0
            ? "Ringed: Under the Radar by HEY's rule. No project meets it today."
            : ringed === held
              ? `Ringed: the ${held === 1 ? 'project' : `${held} projects`} HEY's Under the Radar rule holds today${held === 1 ? '' : ', all drawn'}.`
              : `Ringed: ${ringed} of the ${held} projects HEY's Under the Radar rule holds today; the rest lack a reading the chart needs to place them.`}
        </span>
        <span className="mt-1.5 block">
          The rule asks for more than a position — verified building, at least two meaningful ships in 30 days and a
          positive Discovery Gap — so a ringed bubble can sit outside the top-left, and an unringed one inside it.
        </span>
        <span className="mt-1.5 block">
        Each bubble is a project; size reflects its valuation against the others drawn (market cap,
        or fully diluted valuation where no circulating figure exists) and colour reflects activity status.
        Position describes what has happened, not what will.
        {unplaced > 0
          ? ` ${unplaced} ${unplaced === 1 ? 'project is' : 'projects are'} not placed: Build Momentum not measured.`
          : null}
        {attentionNotMeasured && attentionNotMeasured > 0
          ? ` ${attentionNotMeasured.toLocaleString('en-US')} ${attentionNotMeasured === 1 ? 'project is' : 'projects are'} left off: market attention not measured — market too thin, a launch pool or no live market.`
          : null}
        </span>
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
      // A halo in the page's own ground keeps the label readable over a bubble (2026-10-14).
      stroke="var(--color-hey-bg)"
      strokeWidth={4}
      strokeOpacity={0.85}
      strokeLinejoin="round"
      paintOrder="stroke"
      pointerEvents="none"
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
    <div className={cn('lg-panel p-12 text-center', className)} data-variant="empty">
      <p className="text-[15px] font-medium">{message}</p>
      {hint ? <p className="mt-1.5 text-[15px] text-hey-secondary">{hint}</p> : null}
    </div>
  );
}
