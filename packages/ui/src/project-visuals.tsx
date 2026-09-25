import { cn } from './cn';
import { ShippingStreakBadge } from './status';
import { formatRelativeTime, formatUsdCompact } from './format';

/**
 * Project profile visualisations (UI/UX V2 sections 20, 31, 32, 33).
 *
 * All server-rendered SVG or CSS. Every one answers a question a reader would
 * actually ask about a builder, and none of them mixes in price except where the
 * drawdown is the entire point.
 */

/** Shipping streak (UI/UX V4 section 33). Vector flame, never the emoji. */
export function ShippingStreak({ weeks, className }: { weeks: number; className?: string }) {
  if (weeks <= 0) return null;

  return (
    <p className={cn('text-[15px] font-medium', className)}>
      <ShippingStreakBadge weeks={weeks} />
    </p>
  );
}

/**
 * Builder activity over twelve weeks (UI/UX V2 section 32).
 * Meaningful events only, with the week's headline ship as its label.
 */
export function BuilderActivityChart({
  weeks,
  className,
}: {
  weeks: readonly { week: string; ships: number; headline?: string }[];
  className?: string;
}) {
  const max = Math.max(...weeks.map((week) => week.ships), 1);

  return (
    <figure className={className}>
      <div
        className="flex h-36 items-end gap-1.5"
        role="img"
        aria-label={`Meaningful ships per week over the last ${weeks.length} weeks`}
      >
        {weeks.map((week) => (
          // `h-full` so the percentage height below resolves against the row
          // rather than against a content-sized column, which rendered every
          // bar as a hairline.
          <div
            key={week.week}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
          >
            <div
              className={cn(
                'w-full rounded-t-[3px]',
                week.ships > 0 ? 'bg-blue-500' : 'bg-hey-border',
              )}
              style={{ height: week.ships > 0 ? `${(week.ships / max) * 100}%` : '4px' }}
              title={
                week.headline
                  ? `Week of ${week.week}: ${week.ships} ships — ${week.headline}`
                  : `Week of ${week.week}: no meaningful ships`
              }
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-[13px] text-hey-secondary">
        Meaningful, source-backed updates per week. Commits are aggregated, not counted
        individually.
      </figcaption>
    </figure>
  );
}

/**
 * The measure a drawdown line is drawn in (2026-09-25). "Market
 * capitalisation" was the title whatever the readings were, and on this chain
 * they are nearly always fully diluted. Every day an FDV: say so; every day a
 * market cap: say that; a mix, or days HEY cannot tell: "Valuation", which
 * claims neither.
 */
export function drawdownMeasure(history: readonly { fullyDiluted?: boolean }[]): string {
  if (history.length > 0 && history.every((point) => point.fullyDiluted === true)) return 'Fully diluted valuation';
  if (history.length > 0 && history.every((point) => point.fullyDiluted === false)) return 'Market cap';
  return 'Valuation';
}

/**
 * Build Through the Drawdown (UI/UX V2 section 33).
 *
 * Shown only for projects already meeting the Still Building criteria. It states
 * what happened — the market fell, the team kept shipping — and nothing about
 * what happens next.
 */
export function DrawdownChart({
  history,
  ships,
  className,
}: {
  /** `fullyDiluted` marks a day whose valuation was an FDV (2026-09-25); the title names the measure the line is drawn in. */
  history: readonly { observedAt: Date; marketCapUsd: number; fullyDiluted?: boolean }[];
  ships: readonly { publishedAt: Date; title: string }[];
  className?: string;
}) {
  if (history.length < 2) return null;
  const measure = drawdownMeasure(history);

  const width = 720;
  const height = 200;
  const pad = { top: 16, right: 16, bottom: 24, left: 16 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const times = history.map((point) => point.observedAt.getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const maxValue = Math.max(...history.map((point) => point.marketCapUsd));

  const x = (time: number) =>
    pad.left + (maxTime === minTime ? 0 : ((time - minTime) / (maxTime - minTime)) * plotW);
  const y = (value: number) => pad.top + plotH - (value / maxValue) * plotH;

  const path = history
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${x(point.observedAt.getTime())} ${y(point.marketCapUsd)}`,
    )
    .join(' ');

  const markers = ships.filter(
    (ship) => ship.publishedAt.getTime() >= minTime && ship.publishedAt.getTime() <= maxTime,
  );

  return (
    <figure className={className}>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[420px]"
          role="img"
          aria-label={`${measure} over time, with meaningful ships marked`}
        >
          <path d={path} fill="none" stroke="var(--color-hey-border-strong)" strokeWidth={2} />

          {markers.map((ship) => (
            <circle
              key={`${ship.publishedAt.toISOString()}-${ship.title}`}
              cx={x(ship.publishedAt.getTime())}
              cy={pad.top + plotH - 6}
              r={5}
              fill="var(--color-status-shipping)"
            >
              <title>{`${ship.title} — ${formatRelativeTime(ship.publishedAt)}`}</title>
            </circle>
          ))}

          <text x={pad.left} y={pad.top + 4} className="text-[11px]" fill="var(--color-hey-muted)">
            {formatUsdCompact(maxValue)}
          </text>
        </svg>
      </div>
      <figcaption className="mt-2 text-[13px] text-hey-secondary">
        {measure} over time. Each marker is a meaningful ship.
      </figcaption>
    </figure>
  );
}

/**
 * Build Momentum as a research readout (UI/UX V5 section 24).
 *
 * The card version put the score in a bordered box with a number on top, which
 * is the KPI-tile grammar V5 rules out. Here the score is stated as a heading
 * and the components are a labelled bar chart, so the reader sees what the
 * number is made of rather than being handed a verdict.
 *
 * Research Blue carries the bars; Signal Gold marks the strongest component, so
 * the eye lands on what is driving the score.
 */
export function BuildMomentumPanel({
  score,
  components,
  className,
  heading = true,
}: {
  score: number;
  components: readonly { label: string; value: number }[];
  className?: string;
  /**
   * Whether the panel states the score itself.
   *
   * False where the surface around it already does (copy audit, 2026-09-22).
   * The Terminal Overview printed Build Momentum three times on one screen —
   * a figure tile, the card title, and this eyebrow — and two of them
   * disagreed, because the tile showed 65.7 and the eyebrow rounded to 66.
   */
  heading?: boolean;
}) {
  const strongest = components.reduce(
    (best, component, index) => (component.value > (components[best]?.value ?? -1) ? index : best),
    0,
  );

  return (
    <section className={className} aria-label="Build Momentum">
      {/*
        `aria-label`, not `aria-labelledby` pointing at the number
        (accessibility audit, 2026-09-22). A named <section> is a region
        landmark, and the id wrapped only `{score}` — so a screen reader's
        landmark list for this page contained a region called "64". The id was
        hardcoded too, so two panels on one document would have collided.
      */}
      {heading ? (
        <p className="hey-eyebrow text-hey-muted">
          Build Momentum <span className="text-hey-border-strong">/</span>{' '}
          <span className="tabular-nums text-hey-ink">{Math.round(score)}</span>
        </p>
      ) : null}

      {/*
        The bar lives inside the <dd>, not in a third sibling. A <div> inside a
        <dl> may hold only <dt> and <dd>, and putting the track beside them
        broke list traversal in some assistive technology.

        Its colours are the surface's own accent and border rather than
        `bg-gold-500` / `bg-blue-500`: those are the legacy brand pair, and V7
        replaced Research Blue with builder green, so on the Terminal the
        "strongest" mark measured 1.25:1 against its own track — colour-alone
        encoding that was also very nearly invisible. Weight carries it now,
        and the strongest component is named in text.
      */}
      <dl className={cn('space-y-3.5', heading && 'mt-5')}>
        {components.map((component, index) => (
          <div key={component.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
            <dt className="hey-telemetry col-start-1 row-start-1 text-hey-secondary">
              {component.label}
            </dt>
            <dd className="hey-telemetry relative col-start-2 row-start-1 tabular-nums text-hey-ink">
              {Math.round(component.value)}
              {index === strongest ? <span className="sr-only"> — strongest component</span> : null}
            </dd>
            <dd className="col-span-2 row-start-2 mt-1.5 h-1.5 bg-hey-subtle">
              <span
                className={cn('block h-full', index === strongest ? 'bg-hey-ink' : 'bg-hey-accent')}
                style={{ width: `${Math.min(100, Math.max(0, component.value))}%` }}
              />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
