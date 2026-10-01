/**
 * Activity status in words: the one table every surface reads (2026-10-01).
 *
 * The chip on the card and the project page, the Research Summary's build
 * line, the token lookup (`GET /api/token/{chain}/{address}`) and the partner
 * card all print the same words for the same project. Until this table moved
 * here, the words lived in `@hey/ui` (the chip) and a copy lived in the domain
 * (the summary), and the copy did not know why an UNKNOWN was unknown: the
 * page said "Activity not measurable" while the API said "Activity unknown"
 * for the same project (outsider usability test, 2026-10-01).
 *
 * Pure: no React, no database. `@hey/ui` adds its icons and colours on top,
 * and the domain imports the words directly.
 */
export type ActivityStatusWordsKey = 'SHIPPING' | 'ACTIVE' | 'QUIET' | 'DORMANT' | 'RESUMED' | 'UNKNOWN';

export const ACTIVITY_STATUS_WORDS: Readonly<Record<ActivityStatusWordsKey, { label: string; help: string }>> = {
  SHIPPING: { label: 'Shipping', help: 'Shipped something meaningful in the last 7 days.' },
  ACTIVE: { label: 'Active', help: 'Meaningful updates in the last month.' },
  QUIET: { label: 'Quiet', help: 'No meaningful updates for over a month.' },
  DORMANT: { label: 'Dormant', help: 'No meaningful updates observed for a long time. Not the same as abandoned.' },
  RESUMED: { label: 'Resumed building', help: 'Started shipping again after a long gap.' },
  UNKNOWN: { label: 'Activity unknown', help: 'Not enough public sources to judge activity yet.' },
};

/**
 * UNKNOWN with nothing to read (2026-09-13). Most token projects HEY found
 * through trades hold no repository, changelog or feed, so "Activity unknown"
 * on them read as HEY not having looked. It looked; there is nothing to read
 * building from yet, and trading is not building.
 */
export const NO_BUILDER_SIGNAL = {
  label: 'No builder signal yet',
  help: 'No repository, changelog or feed for HEY to read building from. Trading is not building.',
} as const;

/**
 * UNKNOWN with a ship on record and nothing HEY can keep reading
 * (data-correctness pass, 2026-09-28). A Verified Builder whose ships came
 * from a deployment, an X post or a repository now gone printed
 * "VERIFIED BUILDER" directly above "Activity unknown · Last ship 2mo ago":
 * a verdict and its opposite, with nothing joining them. Both are true — the
 * badge says HEY verified what it shipped, the status says HEY cannot tell
 * whether it is shipping now — so the label says why.
 */
export const ACTIVITY_NOT_MEASURABLE = {
  label: 'Activity not measurable',
  help: 'HEY has a ship on record but no repository, changelog or feed it can keep reading, so whether this project is building now cannot be judged. The last ship is the newest evidence HEY holds.',
} as const;

/**
 * Why an UNKNOWN status is unknown, from three facts every surface already
 * holds: the status, whether HEY reads a builder source (the scorer's
 * `observableBuilderSource`, selected as `hasBuilderSource`) and the last
 * meaningful ship.
 *
 *   - `no_builder_signal` — nothing to read and nothing ever shipped;
 *   - `no_readable_source` — a ship on record, and nothing HEY can keep reading;
 *   - `null` — not UNKNOWN, or UNKNOWN beside a source HEY reads ("Activity unknown").
 *
 * `hasBuilderSource` undefined means the caller does not know, and the words
 * stay the plain status word rather than guess.
 */
export type UnknownActivityReason = 'no_builder_signal' | 'no_readable_source';

export function unknownActivityReason(project: {
  activityStatus: string;
  hasBuilderSource?: boolean | null | undefined;
  lastMeaningfulShipAt?: Date | string | null | undefined;
}): UnknownActivityReason | null {
  if (project.activityStatus !== 'UNKNOWN' || project.hasBuilderSource !== false) return null;
  return project.lastMeaningfulShipAt ? 'no_readable_source' : 'no_builder_signal';
}

/** The words for a status, with the reason an UNKNOWN is unknown: the one label map every surface reads. */
export function activityPresentation(status: string, unknownReason?: UnknownActivityReason | null): { label: string; help: string } {
  if (status === 'UNKNOWN' && unknownReason === 'no_builder_signal') return { label: NO_BUILDER_SIGNAL.label, help: NO_BUILDER_SIGNAL.help };
  if (status === 'UNKNOWN' && unknownReason === 'no_readable_source') return { label: ACTIVITY_NOT_MEASURABLE.label, help: ACTIVITY_NOT_MEASURABLE.help };
  const words = ACTIVITY_STATUS_WORDS[status as ActivityStatusWordsKey] ?? ACTIVITY_STATUS_WORDS.UNKNOWN;
  return { label: words.label, help: words.help };
}

/** The plain status word, without a reason: for a status change ("Quiet → Shipping"), where the reason is not part of the claim. */
export const activityStatusLabel = (status: string): string => (ACTIVITY_STATUS_WORDS[status as ActivityStatusWordsKey] ?? ACTIVITY_STATUS_WORDS.UNKNOWN).label;

/** The words for one project's status, from the facts every surface holds. */
export function projectActivityWords(project: {
  activityStatus: string;
  hasBuilderSource?: boolean | null | undefined;
  lastMeaningfulShipAt?: Date | string | null | undefined;
}): { label: string; help: string } {
  return activityPresentation(project.activityStatus, unknownActivityReason(project));
}
