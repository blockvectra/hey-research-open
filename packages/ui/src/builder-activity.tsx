import { cn } from './cn';

/**
 * Builder Activity Strip (UI/UX V4 section 30).
 *
 * HEY's proprietary visual primitive: six weeks of building at a glance, small
 * enough to sit inside a card and repeat across the product without becoming
 * decoration.
 *
 * Rendered as elements, never as Unicode block characters — those inherit the
 * reader's emoji font, break alignment across platforms, and are announced one
 * by one to a screen reader. The strip is one labelled image instead.
 *
 * Research Blue marks an active week; Signal Gold marks the most recent one, so
 * the eye lands on how recently the project was building rather than on how
 * many squares are filled.
 */
export type BuilderActivityStripProps = {
  /** Oldest week first. */
  weeks: readonly boolean[];
  size?: 'sm' | 'md';
  className?: string;
};

export function BuilderActivityStrip({ weeks, size = 'md', className }: BuilderActivityStripProps) {
  if (weeks.length === 0) return null;

  const lastActive = weeks.lastIndexOf(true);
  const active = weeks.filter(Boolean).length;
  const box = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';

  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      role="img"
      aria-label={`${active} of ${weeks.length} recent weeks with building activity`}
    >
      {weeks.map((isActive, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn(
            'inline-block rounded-[3px]',
            box,
            !isActive && 'bg-ice-100 ring-1 ring-inset ring-hey-border',
            isActive && index === lastActive ? 'bg-gold-500' : isActive ? 'bg-blue-500' : '',
          )}
        />
      ))}
    </span>
  );
}

/**
 * The strip with its own label, for card footers and sidebars.
 *
 * "5/6 active weeks" is the fact; the strip shows the shape of it. Both are
 * shown because the count alone loses the recency the colours carry.
 */
export function BuilderActivity({
  weeks,
  label = 'Last 6 weeks',
  className,
}: {
  weeks: readonly boolean[];
  label?: string;
  className?: string;
}) {
  if (weeks.length === 0) return null;
  const active = weeks.filter(Boolean).length;

  return (
    <div className={className}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-hey-muted">{label}</p>
      <div className="mt-1.5 flex items-center gap-2.5">
        <BuilderActivityStrip weeks={weeks} />
        <span className="text-[13px] text-hey-secondary">
          <span className="font-medium tabular-nums text-hey-ink">
            {active}/{weeks.length}
          </span>{' '}
          active weeks
        </span>
      </div>
    </div>
  );
}

/**
 * Labelled week columns for the project dossier (UI/UX V5 section 25).
 *
 * The compact strip is for cards, where space is the constraint. On a dossier
 * the reader is studying one project, so each week gets its own labelled
 * column and the shape of the last quarter becomes readable rather than
 * merely glanceable.
 *
 * Rendered as elements with a single accessible label, never as Unicode
 * blocks: those inherit the reader's emoji font, break alignment across
 * platforms, and get announced one square at a time.
 */
export function BuilderActivityWeeks({
  weeks,
  className,
}: {
  /** Oldest week first. */
  weeks: readonly boolean[];
  className?: string;
}) {
  if (weeks.length === 0) return null;

  const lastActive = weeks.lastIndexOf(true);
  const active = weeks.filter(Boolean).length;

  return (
    <div className={cn('hey-scroll-x', className)}>
      <div
        className="flex min-w-full items-end gap-1.5"
        role="img"
        aria-label={`${active} of ${weeks.length} recent weeks contained building activity`}
      >
        {weeks.map((isActive, index) => (
          <div key={index} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                'h-9 w-full rounded-[3px]',
                !isActive && 'bg-paper-deep ring-1 ring-inset ring-hey-border',
                isActive && index === lastActive ? 'bg-gold-500' : isActive ? 'bg-blue-500' : '',
              )}
            />
            <span aria-hidden="true" className="hey-telemetry text-hey-muted">
              W{String(index + 1).padStart(2, '0')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
