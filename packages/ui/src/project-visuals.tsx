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

/**
 * Active weeks (UI/UX V2 section 20).
 *
 * A filled block is a week containing at least one meaningful, verified build
 * event. Far easier to read than a score, and each block carries its own label.
 */
export function ActiveWeeks({
  weeks,
  className,
}: {
  weeks: readonly { week: string; ships: number }[];
  className?: string;
}) {
  const active = weeks.filter((week) => week.ships > 0).length;
  const lastActiveIndex = weeks.reduce((last, week, index) => (week.ships > 0 ? index : last), -1);

  return (
    <div className={className}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-hey-muted">
        Last {weeks.length} weeks
      </p>

      <div
        className="mt-2 flex gap-1"
        role="img"
        aria-label={`${active} of ${weeks.length} weeks contained a meaningful ship`}
      >
        {weeks.map((week, index) => (
          <span
            key={week.week}
            className={cn(
              'h-6 flex-1 rounded-[3px]',
              // Builder Activity Strip semantics (V4 section 30): Research Blue
              // for an active week, Signal Gold for the most recent one, so the
              // eye lands on recency rather than on a count of filled cells.
              week.ships > 0
                ? index === lastActiveIndex
                  ? 'bg-gold-500'
                  : 'bg-blue-500'
                : 'bg-ice-100 ring-1 ring-inset ring-hey-border',
            )}
            /* The attribute, not the element: `<title>` inside HTML is metadata React hoists
               into <head>, so this rendered no tooltip and polluted the document title. */
            title={
              week.ships > 0
                ? `Week of ${week.week}: ${week.ships} meaningful ${week.ships === 1 ? 'ship' : 'ships'}`
                : `Week of ${week.week}: no meaningful ships`
            }
          />
        ))}
      </div>

      <p className="mt-2 text-[15px]">
        <span className="font-semibold tabular-nums">
          {active} / {weeks.length}
        </span>
        <span className="text-hey-secondary"> active weeks</span>
      </p>
    </div>
  );
}

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
 * Build Momentum breakdown (UI/UX V2 section 31).
 *
 * Horizontal bars, never a radar chart, and always beneath the activity status —
 * the status is what a reader should take away, not the number.
 */
export function BuildMomentumCard({
  score,
  components,
  className,
}: {
  score: number;
  components: { label: string; value: number }[];
  className?: string;
}) {
  return (
    <div className={cn('rounded-[6px] border border-hey-border bg-hey-surface p-5', className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-hey-muted">
        Build Momentum
      </p>
      <p className="mt-1 text-[40px] font-semibold leading-none tabular-nums tracking-tight">
        {Math.round(score)}
      </p>

      <dl className="mt-5 space-y-3">
        {components.map((component) => (
          <div key={component.label}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <dt className="text-hey-secondary">{component.label}</dt>
              <dd className="tabular-nums">{Math.round(component.value)}</dd>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hey-border">
              <div
                className="h-full rounded-full bg-hey-accent"
                style={{ width: `${Math.min(100, Math.max(0, component.value))}%` }}
              />
            </div>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-[13px] text-hey-secondary">
        Measures how consistently this project ships. It never reflects price.
      </p>
    </div>
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
  history: readonly { observedAt: Date; marketCapUsd: number }[];
  ships: readonly { publishedAt: Date; title: string }[];
  className?: string;
}) {
  if (history.length < 2) return null;

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
          aria-label="Market capitalisation over time, with meaningful ships marked"
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
        Market capitalisation over time. Each marker is a meaningful ship.
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
}: {
  score: number;
  components: readonly { label: string; value: number }[];
  className?: string;
}) {
  const strongest = components.reduce(
    (best, component, index) => (component.value > (components[best]?.value ?? -1) ? index : best),
    0,
  );

  return (
    <section className={className} aria-labelledby="build-momentum">
      <p className="hey-eyebrow text-hey-muted">
        Build Momentum <span className="text-hey-border-strong">/</span>{' '}
        <span id="build-momentum" className="tabular-nums text-hey-ink">
          {Math.round(score)}
        </span>
      </p>

      <dl className="mt-5 space-y-3.5">
        {components.map((component, index) => (
          <div key={component.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
            <dt className="hey-telemetry text-hey-secondary">{component.label}</dt>
            <dd className="hey-telemetry tabular-nums text-hey-ink">
              {Math.round(component.value)}
            </dd>
            <div className="col-span-2 mt-1.5 h-1.5 bg-paper-deep">
              <div
                className={cn(
                  'h-full',
                  index === strongest ? 'bg-gold-500' : 'bg-blue-500',
                )}
                style={{ width: `${Math.min(100, Math.max(0, component.value))}%` }}
              />
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
