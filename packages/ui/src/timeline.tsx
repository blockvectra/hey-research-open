import type { ReactNode } from 'react';

import { cn } from './cn';
import { formatRelativeTime, formatVerification, plainText, readableSummary, shipKindLabel, shortenHexInText, type ReadableSummary } from './format';

/**
 * Build Timeline (PRD V4 section 11 and the autonomous brief section 11).
 *
 * Answers one question: what did this project actually ship? Meaningful events
 * only — never a raw commit log.
 */
export type TimelineItem = {
  id: string;
  title: string;
  summary?: string;
  eventType: string;
  /** Where the evidence came from; it decides the kind's word for a verified contract (`shipKindLabel`). */
  sourceKind?: string;
  publishedAt: Date;
  verificationStatus: string;
  sourceUrl?: string;
  /**
   * One plain sentence about what a week of code activity changed
   * (2026-09-27): "Documentation or maintenance only — not counted as
   * building", or what HEY read. Worded by the domain, shown as text.
   */
  substanceNote?: string;
  /**
   * What a code week shipped (2026-10-02): up to three commits by the
   * subject the repository gave them, each linking to the commit. Chosen by
   * the domain (`codeWeekDetails`); the timeline only lists them.
   */
  highlights?: readonly { text: string; href?: string }[];
};

export function BuildTimeline({
  items,
  now,
  className,
  action,
}: {
  items: readonly TimelineItem[];
  now?: Date;
  className?: string;
  /**
   * One quiet control after an item's evidence link (2026-09-30): the
   * project page's Share. The page decides which items get one; the timeline
   * only places it, so this package holds no share semantics.
   */
  action?: (item: TimelineItem) => ReactNode;
}) {
  return (
    <ol className={cn('relative space-y-6', className)}>
      {items.map((item) => (
        <li
          key={item.id}
          id={`ship-${item.id}`}
          className="relative scroll-mt-24 pl-6 last:[&>span:nth-child(2)]:hidden"
        >
          <span
            aria-hidden="true"
            className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-hey-accent"
          />
          {/*
            `last:hidden` never matched (layout audit, 2026-09-22): `last:` is
            `&:last-child`, and this span is the second of five children of the
            <li>, so the final entry drew a connector hanging a full item's
            height below itself with nothing to connect to. The rule belongs on
            the <li>.
          */}
          <span
            aria-hidden="true"
            className="absolute left-[3px] top-5 h-full w-px bg-hey-border"
          />

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* Release notes arrive as Markdown; the timeline shows the words (QA sweep 2026-09-04). */}
            <h3 className="text-sm font-medium break-words">{shortenHexInText(plainText(item.title))}</h3>
            <time dateTime={item.publishedAt.toISOString()} className="text-xs text-hey-secondary">
              {formatRelativeTime(item.publishedAt, now)}
            </time>
          </div>

          <p className="mt-1 text-xs text-hey-secondary">
            {shipKindLabel(item)}
            <span aria-hidden="true"> · </span>
            {/* Evidence quality is always visible, never implied. */}
            <span>{formatVerification(item.verificationStatus)}</span>
          </p>

          <ShipSummary summary={readableSummary(item.summary)} className="mt-2 text-sm" />

          <CodeWeekHighlights highlights={item.highlights} className="mt-2" />

          {item.substanceNote ? (
            <p className="mt-1 text-xs text-hey-secondary [overflow-wrap:anywhere]">{item.substanceNote}</p>
          ) : null}

          {item.sourceUrl || action ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
              {item.sourceUrl ? (
                <a
                  href={item.sourceUrl}
                  rel="nofollow noopener noreferrer"
                  target="_blank"
                  className="inline-block text-sm text-hey-ink underline decoration-hey-border-strong underline-offset-4 transition-colors hover:decoration-hey-ink"
                >
                  View evidence
                </a>
              ) : null}
              {action?.(item)}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * What a code week changed, in the repository's own words (2026-10-02): up to
 * three commit subjects, each linking to its commit. The timeline and the
 * latest-ship card both draw it, so a code week reads the same in either.
 */
export function CodeWeekHighlights({
  highlights,
  className,
}: {
  highlights: readonly { text: string; href?: string }[] | undefined;
  className?: string;
}) {
  if (!highlights || highlights.length === 0) return null;
  return (
    <div className={className}>
      <p className="text-xs text-hey-secondary">What changed, in the repository&rsquo;s own words:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-hey-ink/80" data-testid="code-week-highlights">
        {highlights.map((highlight, index) => (
          <li key={index} className="[overflow-wrap:anywhere]">
            {highlight.href ? (
              <a href={highlight.href} rel="nofollow noopener noreferrer" target="_blank" className="underline decoration-hey-border-strong underline-offset-4 hover:decoration-hey-ink">
                {shortenHexInText(highlight.text)}
              </a>
            ) : (
              shortenHexInText(highlight.text)
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A ship's summary through the one sanitiser (`readableSummary`, public UX
 * review 2026-09-28): the short form first, cut at a word; the whole text, as
 * points, one tap away when anything was left out or it was a list. The
 * timeline and the latest-ship card both draw it, so a release reads the same
 * in either place.
 */
export function ShipSummary({ summary, className }: { summary: ReadableSummary | undefined; className?: string }) {
  if (!summary) return null;
  const expandable = summary.truncated || summary.items.length > 1;
  if (!expandable) {
    return <p className={cn('leading-relaxed text-hey-ink/80 break-words', className)} data-testid="ship-summary">{summary.short}</p>;
  }
  return (
    <details className={cn('group leading-relaxed text-hey-ink/80', className)} data-testid="ship-summary">
      <summary className="cursor-pointer list-none break-words marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">{summary.short}</span>{' '}
        <span className="whitespace-nowrap text-hey-secondary underline underline-offset-4 group-open:hidden">Show all</span>
        <span className="hidden text-hey-secondary underline underline-offset-4 group-open:inline">Show less</span>
      </summary>
      {summary.items.length > 1 ? (
        <ul className="mt-1 list-disc space-y-1 pl-5 break-words">
          {summary.items.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 break-words">{summary.items[0]}</p>
      )}
    </details>
  );
}
