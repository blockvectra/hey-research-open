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
  UNKNOWN: { label: 'Not measured — activity unknown', help: 'Not enough public sources to judge activity yet.' },
};

/*
 * One chip for UNKNOWN (2026-10-28 simplicity study, CON-8): six phrasings had grown for one state that is 62% of the
 * catalogue — "Activity unknown", "No builder source linked", "Builder source held, not counted", "Activity not
 * measurable", "Not researched yet", "Building not checked yet". Each is now a reason under one head, "Not measured",
 * with the one separator (CON-10): a line of text prints "Not measured — no builder source linked", and the chip
 * prints the head with the reason as its second line (`activityChipWords`). The reasons and their help are unchanged.
 */
export const ACTIVITY_NOT_MEASURED_HEAD = 'Not measured';
const notMeasured = (reason: string): string => `${ACTIVITY_NOT_MEASURED_HEAD} — ${reason}`;

/** A status label as the chip draws it: the head, and the reason a "Not measured" label carries, capitalised for its own line. */
export function activityChipWords(label: string): { head: string; reason?: string } {
  const prefix = `${ACTIVITY_NOT_MEASURED_HEAD} — `;
  if (!label.startsWith(prefix)) return { head: label };
  const reason = label.slice(prefix.length);
  return { head: ACTIVITY_NOT_MEASURED_HEAD, reason: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}` };
}

/**
 * UNKNOWN with nothing to read (2026-09-13). Most token projects HEY found
 * through trades hold no repository, changelog or feed, so "Activity unknown"
 * on them read as HEY not having looked. It looked; there is nothing to read
 * building from yet, and trading is not building.
 */
/*
 * "No builder source linked" since 2026-10-02 (outsider audit): "No builder
 * signal yet" beside $579M of TVL on Morpho Blue read as "nothing is being
 * built". What HEY knows is narrower — it has no repository, changelog or feed
 * linked to read building from — so the label says that, and a project with
 * no such source is never DORMANT ("we looked and saw nothing").
 */
export const NO_BUILDER_SIGNAL = {
  label: notMeasured('no builder source linked'),
  help: 'HEY has no repository, changelog or feed linked for this project, so whether it is building is not measured. It does not mean nothing is being built. Trading is not building.',
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
  label: notMeasured('activity not measurable'),
  help: 'HEY has a ship on record but no repository, changelog or feed it can keep reading, so whether this project is building now cannot be judged. The last ship is the newest evidence HEY holds.',
} as const;

/**
 * UNKNOWN beside a builder source HEY holds only as context (2026-10-18, persona audit PB-11): the page listed
 * a GitHub repository under "No builder source linked … HEY has no repository linked", and the builder fixed the
 * wrong thing. HEY holds it; nothing yet ties it to the project, so it is not read as this project's building.
 * What would make it count is written under the source itself (`sources/context-words.ts`).
 */
export const BUILDER_SOURCE_HELD = {
  label: notMeasured('builder source held, not counted'),
  help: 'HEY holds a repository, changelog or feed for this project only as context: nothing yet ties it to the project, so whether it is building is not measured. Each source says what would make it count. It does not mean nothing is being built.',
} as const;

/**
 * Why an UNKNOWN status is unknown, from facts every surface already
 * holds: the status, whether HEY reads a builder source (the scorer's
 * `observableBuilderSource`, selected as `hasBuilderSource`), whether it holds
 * one only as context (`heldBuilderSource`) and the last meaningful ship.
 *
 *   - `no_builder_signal` — nothing to read and nothing ever shipped;
 *   - `held_as_context` — nothing to read as the project's own, a builder source held as context, nothing shipped;
 *   - `no_readable_source` — a ship on record, and nothing HEY can keep reading;
 *   - `null` — not UNKNOWN, or UNKNOWN beside a source HEY reads ("Activity unknown").
 *
 * `hasBuilderSource` undefined means the caller does not know, and the words
 * stay the plain status word rather than guess; `heldBuilderSource` undefined
 * reads as no source held, the words before 2026-10-18.
 */
export type UnknownActivityReason = 'no_builder_signal' | 'held_as_context' | 'no_readable_source';

export function unknownActivityReason(project: {
  activityStatus: string;
  hasBuilderSource?: boolean | null | undefined;
  heldBuilderSource?: boolean | null | undefined;
  lastMeaningfulShipAt?: Date | string | null | undefined;
}): UnknownActivityReason | null {
  if (project.activityStatus !== 'UNKNOWN' || project.hasBuilderSource === undefined || project.hasBuilderSource === null) return null;
  /*
   * A ship on record beside UNKNOWN is the scorer's "not enough source coverage" whatever the source flag reads now
   * (2026-10-28 simplicity study, DATA-10): the scorer files a project with a ship as UNKNOWN only when it found no
   * source it could keep reading (`deriveActivityStatus`'s `hasSourceCoverage`). A source read since, or one another
   * page holds, made 38 pages print a bare "Activity unknown" beside their last ship date; the next score decides.
   */
  if (project.lastMeaningfulShipAt) return 'no_readable_source';
  if (project.hasBuilderSource !== false) return null;
  return project.heldBuilderSource === true ? 'held_as_context' : 'no_builder_signal';
}

/** The words for a status, with the reason an UNKNOWN is unknown: the one label map every surface reads. */
export function activityPresentation(status: string, unknownReason?: UnknownActivityReason | null): { label: string; help: string } {
  if (status === 'UNKNOWN' && unknownReason === 'no_builder_signal') return { label: NO_BUILDER_SIGNAL.label, help: NO_BUILDER_SIGNAL.help };
  if (status === 'UNKNOWN' && unknownReason === 'held_as_context') return { label: BUILDER_SOURCE_HELD.label, help: BUILDER_SOURCE_HELD.help };
  if (status === 'UNKNOWN' && unknownReason === 'no_readable_source') return { label: ACTIVITY_NOT_MEASURABLE.label, help: ACTIVITY_NOT_MEASURABLE.help };
  const words = ACTIVITY_STATUS_WORDS[status as ActivityStatusWordsKey] ?? ACTIVITY_STATUS_WORDS.UNKNOWN;
  return { label: words.label, help: words.help };
}

/** The plain status word, without a reason: for a status change ("Quiet → Shipping") or a facet, where the reason is not part of the claim — UNKNOWN is the chip's head, "Not measured". */
export const activityStatusLabel = (status: string): string => activityChipWords((ACTIVITY_STATUS_WORDS[status as ActivityStatusWordsKey] ?? ACTIVITY_STATUS_WORDS.UNKNOWN).label).head;

/** The words for one project's status, from the facts every surface holds. */
export function projectActivityWords(project: {
  activityStatus: string;
  hasBuilderSource?: boolean | null | undefined;
  heldBuilderSource?: boolean | null | undefined;
  lastMeaningfulShipAt?: Date | string | null | undefined;
}): { label: string; help: string } {
  return activityPresentation(project.activityStatus, unknownActivityReason(project));
}
