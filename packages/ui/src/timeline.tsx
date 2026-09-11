import { cn } from './cn';
import { formatEventType, formatRelativeTime, formatVerification, plainText } from './format';

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
  publishedAt: Date;
  verificationStatus: string;
  sourceUrl?: string;
};

export function BuildTimeline({
  items,
  now,
  className,
}: {
  items: readonly TimelineItem[];
  now?: Date;
  className?: string;
}) {
  return (
    <ol className={cn('relative space-y-6', className)}>
      {items.map((item) => (
        <li key={item.id} className="relative pl-6">
          <span
            aria-hidden="true"
            className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-hey-accent"
          />
          <span
            aria-hidden="true"
            className="absolute left-[3px] top-5 h-full w-px bg-hey-border last:hidden"
          />

          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* Release notes arrive as Markdown; the timeline shows the words (QA sweep 2026-09-04). */}
            <h3 className="text-sm font-medium">{plainText(item.title)}</h3>
            <time dateTime={item.publishedAt.toISOString()} className="text-xs text-hey-secondary">
              {formatRelativeTime(item.publishedAt, now)}
            </time>
          </div>

          <p className="mt-1 text-xs text-hey-secondary">
            {formatEventType(item.eventType)}
            <span aria-hidden="true"> · </span>
            {/* Evidence quality is always visible, never implied. */}
            <span>{formatVerification(item.verificationStatus)}</span>
          </p>

          {plainText(item.summary) ? (
            <p className="mt-2 text-sm leading-relaxed text-hey-ink/80 [overflow-wrap:anywhere]">{plainText(item.summary)}</p>
          ) : null}

          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              rel="nofollow noopener noreferrer"
              target="_blank"
              className="mt-2 inline-block text-sm text-hey-accent underline underline-offset-4"
            >
              View evidence
            </a>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
