import type { ReactNode } from 'react';

import { cn } from './cn';
import { emailSafe } from './email-safe';
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
  /**
   * The repository the ship came from, `owner/repo` (2026-10-16, audit U3): set
   * by the page only when its ships come from more than one repository, so two
   * weeks of code from two repositories never read as the same week twice.
   */
  repo?: string;
  /**
   * HEY read the week as maintenance or automation only, so it does not count as building
   * (`codeSubstance.countsAsBuilding === false`). Consecutive such weeks fold to one line
   * (2026-10-24 full audit, UI-2); the week stays on the record, one tap away.
   */
  notCounted?: boolean;
};

/**
 * A run the page folded to one line (2026-10-19 audit): a deploy script's
 * contracts or a repository's releases of one day, which the score counts
 * once. `line` is the domain's own sentence (`foldTimelineRuns`); every ship
 * of the run stays listed, newest first, one tap away under it.
 */
export type TimelineRun = {
  kind: 'deploy_run' | 'release_burst';
  /** A stable key: the newest ship's id. */
  id: string;
  line: string;
  items: readonly TimelineItem[];
};

/** Consecutive weeks HEY read as maintenance or automation only, folded to one line (UI-2). */
export type TimelineQuiet = { kind: 'not_counted'; id: string; items: readonly TimelineItem[] };

type TimelineEntryShape = TimelineItem | TimelineRun | TimelineQuiet;

const isRun = (entry: TimelineEntryShape): entry is TimelineRun => 'line' in entry && 'items' in entry;
const isQuiet = (entry: TimelineEntryShape): entry is TimelineQuiet => 'kind' in entry && entry.kind === 'not_counted' && 'items' in entry;

/** How many entries the timeline shows before "Earlier ships" (2026-10-24 full audit, UI-2). */
export const TIMELINE_SHOWN = 8;

/**
 * The timeline's shape (2026-10-24 full audit, UI-2): runs of two or more consecutive not-counted
 * weeks fold to one line, then the newest `limit` entries are shown and the rest sit behind one
 * "Earlier ships" disclosure. Nothing is dropped: every item stays in exactly one place.
 */
export function shapeTimeline(
  items: readonly (TimelineItem | TimelineRun)[],
  limit: number = TIMELINE_SHOWN,
): { shown: TimelineEntryShape[]; earlier: TimelineEntryShape[]; earlierCount: number } {
  const folded: TimelineEntryShape[] = [];
  let quiet: TimelineItem[] = [];
  const flush = () => {
    if (quiet.length >= 2) folded.push({ kind: 'not_counted', id: quiet[0]!.id, items: quiet });
    else folded.push(...quiet);
    quiet = [];
  };
  for (const entry of items) {
    if (!isRun(entry) && entry.notCounted) {
      quiet.push(entry);
      continue;
    }
    flush();
    folded.push(entry);
  }
  flush();
  const shown = folded.slice(0, Math.max(0, limit));
  const earlier = folded.slice(shown.length);
  const earlierCount = earlier.reduce((sum, entry) => sum + (isRun(entry) || isQuiet(entry) ? entry.items.length : 1), 0);
  return { shown, earlier, earlierCount };
}

export function BuildTimeline({
  items,
  now,
  className,
  action,
  limit = TIMELINE_SHOWN,
}: {
  items: readonly (TimelineItem | TimelineRun)[];
  now?: Date;
  className?: string;
  /**
   * One quiet control after an item's evidence link (2026-09-30): the
   * project page's Share. The page decides which items get one; the timeline
   * only places it, so this package holds no share semantics.
   */
  action?: (item: TimelineItem) => ReactNode;
  /** Entries shown before the "Earlier ships" disclosure (UI-2). */
  limit?: number;
}) {
  const { shown, earlier, earlierCount } = shapeTimeline(items, limit);
  const draw = (entry: TimelineEntryShape) =>
    isQuiet(entry) ? (
      <TimelineQuietEntry key={`quiet-${entry.id}`} quiet={entry} now={now} action={action} />
    ) : isRun(entry) ? (
      <TimelineRunEntry key={`run-${entry.id}`} run={entry} now={now} action={action} />
    ) : (
      <TimelineEntry key={entry.id} item={entry} now={now} action={action} />
    );
  return (
    <div className={className}>
      <ol className="relative space-y-6">{shown.map(draw)}</ol>
      {earlier.length > 0 ? (
        <details className="group mt-6" data-testid="timeline-earlier">
          <summary className="inline-flex min-h-6 cursor-pointer list-none items-center text-sm text-hey-secondary underline decoration-hey-border-strong underline-offset-4 marker:hidden hover:text-hey-ink [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Earlier ships ({earlierCount})</span>
            <span className="hidden group-open:inline">Hide earlier ships</span>
          </summary>
          <ol className="relative mt-6 space-y-6">{earlier.map(draw)}</ol>
        </details>
      ) : null}
    </div>
  );
}

/** The dot and the connector every entry draws. */
function TimelineMarks() {
  return (
    <>
      <span aria-hidden="true" className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-hey-accent" />
      {/*
        `last:hidden` never matched (layout audit, 2026-09-22): `last:` is
        `&:last-child`, and this span is the second of five children of the
        <li>, so the final entry drew a connector hanging a full item's
        height below itself with nothing to connect to. The rule belongs on
        the <li>.
      */}
      <span aria-hidden="true" className="absolute left-[3px] top-5 h-full w-px bg-hey-border" />
    </>
  );
}

/**
 * A folded run: the domain's line, the newest ship's time and kind, then
 * every ship of the run inside a disclosure (UI rule 6) — never 22 rows of
 * "Deployed a new contract".
 */
function TimelineRunEntry({ run, now, action }: { run: TimelineRun; now?: Date | undefined; action?: ((item: TimelineItem) => ReactNode) | undefined }) {
  const newest = run.items[0];
  if (!newest) return null;
  const noun = run.kind === 'deploy_run' ? 'contracts' : 'releases';
  return (
    <li className="relative pl-6 last:[&>span:nth-child(2)]:hidden" data-testid="timeline-run" data-run-kind={run.kind}>
      <TimelineMarks />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-medium break-words">{emailSafe(run.line)}</h3>
        <time dateTime={newest.publishedAt.toISOString()} className="text-xs text-hey-secondary">
          {formatRelativeTime(newest.publishedAt, now)}
        </time>
      </div>
      <p className="mt-1 text-xs text-hey-secondary">{shipKindLabel(newest)}</p>
      <details className="group mt-2" data-testid="timeline-run-details">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center text-sm text-hey-secondary underline decoration-hey-border-strong underline-offset-4 marker:hidden hover:text-hey-ink [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">
            Show all {run.items.length} {noun}
          </span>
          <span className="hidden group-open:inline">Hide the {noun}</span>
        </summary>
        <ol className="relative mt-4 space-y-5">
          {run.items.map((item) => (
            <TimelineEntry key={item.id} item={item} now={now} action={action} />
          ))}
        </ol>
      </details>
    </li>
  );
}

/**
 * Weeks HEY read as maintenance or automation only, as one line (UI-2): they never count as
 * building, so they do not take a card each; every week stays listed one tap away.
 */
function TimelineQuietEntry({ quiet, now, action }: { quiet: TimelineQuiet; now?: Date | undefined; action?: ((item: TimelineItem) => ReactNode) | undefined }) {
  const newest = quiet.items[0];
  if (!newest) return null;
  return (
    <li className="relative pl-6 last:[&>span:nth-child(2)]:hidden" data-testid="timeline-not-counted">
      <TimelineMarks />
      <p className="text-sm text-hey-secondary">
        {quiet.items.length} code weeks of maintenance or automation only — not counted as building
        <span aria-hidden="true"> · </span>
        <time dateTime={newest.publishedAt.toISOString()} className="text-xs">
          newest {formatRelativeTime(newest.publishedAt, now)}
        </time>
      </p>
      <details className="group mt-2">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center text-sm text-hey-secondary underline decoration-hey-border-strong underline-offset-4 marker:hidden hover:text-hey-ink [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show the {quiet.items.length} weeks</span>
          <span className="hidden group-open:inline">Hide the weeks</span>
        </summary>
        <ol className="relative mt-4 space-y-5">
          {quiet.items.map((item) => (
            <TimelineEntry key={item.id} item={item} now={now} action={action} />
          ))}
        </ol>
      </details>
    </li>
  );
}

function TimelineEntry({ item, now, action }: { item: TimelineItem; now?: Date | undefined; action?: ((item: TimelineItem) => ReactNode) | undefined }) {
  return (
    <li
      id={`ship-${item.id}`}
      className="relative pl-6 last:[&>span:nth-child(2)]:hidden"
    >
      <TimelineMarks />

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* Release notes arrive as Markdown; the timeline shows the words (QA sweep 2026-09-04). */}
        <h3 className="text-sm font-medium break-words">
          {emailSafe(shortenHexInText(plainText(item.title)))}
          {/* A space in the text, not only a margin (UI-15): "15 commitsowner/repo" read run together. */}
          {item.repo ? ' ' : null}
          {item.repo ? (
            <span className="font-mono text-[12px] font-normal text-hey-secondary [overflow-wrap:anywhere]" data-testid="timeline-repo">
              {item.repo}
            </span>
          ) : null}
        </h3>
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

      {/*
        A code week leads with what changed (2026-10-16, audit U1): the commit subjects first, the
        stored count and its caveat after them, quieter. Any other ship keeps its summary first.
      */}
      {item.highlights && item.highlights.length > 0 ? (
        <>
          <CodeWeekHighlights highlights={item.highlights} className="mt-2" />
          <ShipSummary summary={readableSummary(item.summary)} className="mt-1.5" tone="secondary" />
        </>
      ) : (
        <ShipSummary summary={readableSummary(item.summary)} className="mt-2 text-sm" />
      )}

      {/*
        How HEY read the week (UI-2): a counted week's reading sits behind one press — the timeline's
        heading says the rule once; a week that does not count keeps its sentence in view.
      */}
      {item.substanceNote ? (
        item.notCounted ? (
          <p className="mt-1 text-xs text-hey-secondary [overflow-wrap:anywhere]">{emailSafe(item.substanceNote)}</p>
        ) : (
          <details className="mt-1 text-xs text-hey-secondary" data-testid="timeline-substance">
            <summary className="inline-flex min-h-6 cursor-pointer list-none items-center underline decoration-hey-border-strong underline-offset-4 marker:hidden hover:text-hey-ink [&::-webkit-details-marker]:hidden">
              How HEY read this week
            </summary>
            <p className="mt-1 [overflow-wrap:anywhere]">{emailSafe(item.substanceNote)}</p>
          </details>
        )
      ) : null}

      {item.sourceUrl || action ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          {item.sourceUrl ? (
            <a
              href={item.sourceUrl}
              rel="nofollow noopener noreferrer"
              target="_blank"
              // Counted as an evidence open by the page's one listener (`ValueClicks`, 2026-10-05).
              data-evidence="ship"
              // At least 24px to press (WCAG 2.5.8; 2026-10-16, audit U13).
              className="inline-flex min-h-6 items-center text-sm text-hey-ink underline decoration-hey-border-strong underline-offset-4 transition-colors hover:decoration-hey-ink"
            >
              View evidence
              {/* Every row has this link: its accessible name says which ship, and that it leaves HEY (2026-10-19). */}
              <span className="sr-only">: {emailSafe(shortenHexInText(plainText(item.title)))} (opens in a new tab)</span>
            </a>
          ) : null}
          {action?.(item)}
        </div>
      ) : null}
    </li>
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
      {/* Stacked links 6 px apart (2026-10-16, audit #169): at 2 px their 24 px target circles overlapped (WCAG 2.5.8). */}
      <ul className="mt-1 list-disc space-y-1.5 pl-5 text-sm text-hey-ink/80" data-testid="code-week-highlights">
        {highlights.map((highlight, index) => (
          <li key={index} className="[overflow-wrap:anywhere]">
            {highlight.href ? (
              <a href={highlight.href} rel="nofollow noopener noreferrer" target="_blank" className="underline decoration-hey-border-strong underline-offset-4 hover:decoration-hey-ink">
                {emailSafe(shortenHexInText(highlight.text))}
              </a>
            ) : (
              emailSafe(shortenHexInText(highlight.text))
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
 *
 * Every piece goes through `emailSafe` (FE-1, 2026-10-12): release notes say
 * `npm install @scope/pkg@1.2.3`, which Cloudflare's e-mail obfuscation
 * rewrote in the HTML — #418 and "[email protected]" on seven project pages.
 */
export function ShipSummary({
  summary,
  className,
  tone = 'primary',
}: {
  summary: ReadableSummary | undefined;
  className?: string;
  /**
   * `secondary` (2026-10-16, audit U1): under a code week's commit subjects the
   * stored summary is the count and its caveat, so it reads quieter. The tone
   * is the component's, never a caller's colour class (`cn` does not merge).
   */
  tone?: 'primary' | 'secondary';
}) {
  if (!summary) return null;
  const toneClass = tone === 'secondary' ? 'text-[13px] leading-snug text-hey-secondary' : 'leading-relaxed text-hey-ink/80';
  const expandable = summary.truncated || summary.items.length > 1;
  if (!expandable) {
    return <p className={cn(toneClass, 'break-words', className)} data-testid="ship-summary" data-tone={tone}>{emailSafe(summary.short)}</p>;
  }
  return (
    <details className={cn('group', toneClass, className)} data-testid="ship-summary" data-tone={tone}>
      <summary className="cursor-pointer list-none break-words marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">{emailSafe(summary.short)}</span>{' '}
        <span className="whitespace-nowrap text-hey-secondary underline underline-offset-4 group-open:hidden">Show all</span>
        <span className="hidden text-hey-secondary underline underline-offset-4 group-open:inline">Show less</span>
      </summary>
      {summary.items.length > 1 ? (
        <ul className="mt-1 list-disc space-y-1 pl-5 break-words">
          {summary.items.map((point, index) => (
            <li key={index}>{emailSafe(point)}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 break-words">{emailSafe(summary.items[0])}</p>
      )}
    </details>
  );
}
