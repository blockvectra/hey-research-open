import type { ActivityStatus, ShipEventType, ShipSourceKind, VerificationStatus } from '@hey/db';

import { ACTIVITY, DEPLOY_BATCH, RELEASE_BURST, RESUMED_COVERAGE } from './config';
import { isMeaningful } from './significance';

/**
 * Project Activity Status (PRD V4 section 10).
 *
 * Derived only from meaningful project activity. Price, market cap, volume,
 * holders, wallets and social engagement are structurally absent from the input
 * type, so they cannot influence the result even by accident.
 *
 * There is deliberately no DEAD, RUGGED or ABANDONED status: absence of public
 * evidence is not proof of abandonment.
 */
export type ScoredEvent = {
  eventType: ShipEventType;
  verificationStatus: VerificationStatus;
  publishedAt: Date;
  sourceKind: ShipSourceKind;
  moderationStatus?: string;
  /** A GitHub prerelease (hbm-v11): collapsed to one per UTC ISO week, like code activity. */
  prerelease?: boolean;
  /**
   * A code-activity week's substance (hbm-v16, G1): `LOW_INFORMATION` is not
   * meaningful; null, absent or `UNKNOWN` — not read yet — counts as before.
   */
  codeSubstance?: string | null;
  /**
   * A GitHub release's repository, `owner/repo` lowercased (hbm-v23): a
   * repository's full releases of one UTC day count once. Absent or null —
   * not known — the release is never collapsed. `releaseRepositoryOf` reads
   * it from the ship's external id.
   */
  repository?: string | null;
  /**
   * When HEY began reading the source this event was recorded from
   * (hbm-v25, `RESUMED_COVERAGE`): the earliest attachment
   * (`project_sources.created_at`) of the sources its evidence names. A
   * comeback is RESUMED only when every ship in it was covered from the start
   * of the gap. Null or absent — HEY cannot say when it began reading — and
   * the event never carries a comeback; it counts for everything else as
   * before.
   */
  coveredFrom?: Date | null;
};

/**
 * The repository a GitHub release ship names, from its external id
 * `github-release:<owner>/<repo>:<id>` (hbm-v23), lowercased like the
 * ship-id index. Undefined for any other event or shape: an unknown
 * repository is never grounds to collapse.
 */
export function releaseRepositoryOf(eventType: string, externalId: string | null | undefined): string | undefined {
  if (eventType !== RELEASE_BURST.eventType || !externalId) return undefined;
  const lower = externalId.toLowerCase();
  if (!lower.startsWith(RELEASE_BURST.externalIdPrefix)) return undefined;
  const repository = lower.split(':')[1];
  return repository && /^[^/\s]+\/[^/\s]+$/.test(repository) ? repository : undefined;
}

export type ActivityInput = {
  events: readonly ScoredEvent[];
  now: Date;
  /**
   * Whether HEY has enough registered sources to make a judgement at all.
   * Without coverage the honest answer is UNKNOWN, not DORMANT.
   */
  hasSourceCoverage: boolean;
};

/**
 * Why a comeback the dates alone would call RESUMED is not (hbm-v25):
 * `coverage_began_during_gap` — a comeback ship came from a source HEY began
 * reading after the gap began, so HEY did not observe the gap;
 * `coverage_unknown` — HEY cannot say when it began reading a comeback ship's
 * source. Never a judgement on the project: the gap is simply not one HEY saw.
 */
export type ResumedWithheldReason = 'coverage_began_during_gap' | 'coverage_unknown';

export type ActivityResult = {
  status: ActivityStatus;
  lastMeaningfulShipAt?: Date;
  meaningfulEventCount: number;
  /** Plain-language reason, shown in the methodology view. */
  reason: string;
  /** Set only when a comeback was not read as RESUMED because HEY was not covering the gap (hbm-v25). */
  resumedWithheld?: ResumedWithheldReason;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / DAY_MS;

/**
 * Meaningful events only, newest first, with a project's aggregated code
 * activity counted once per UTC ISO week.
 *
 * Ingestion used to write one `CODE_ACTIVITY` event per repository per day,
 * so a builder page with four repositories earned four weight-3 events for
 * four single commits where a one-repository page earned one (data-quality
 * audit F7, 2026-09-04). Commit volume is not shipping and repository count
 * is not either: a period's code activity is one fact about the project
 * however many repositories it is spread over. Collapsed here, so activity
 * status, Build Momentum and the streak all see the same events (hbm-v3).
 *
 * The period is the ISO week, not the day (hbm-v8, 2026-09-18). Ingestion
 * now writes one row per repository per ISO week, dated the repository's
 * last commit (`ships/normalize.ts`), so four repositories committing on
 * four days of one week were four rows on four different days — and the
 * per-day collapse let all four through. The same key ingestion writes under
 * is the key they are collapsed under.
 */
/**
 * How far ahead of the clock a publication date may sit before HEY stops
 * believing it (2026-09-06).
 *
 * A day, not zero: feeds and release notes carry the publisher's timezone and
 * a release stamped a few hours ahead of UTC is ordinary. Beyond that it is
 * not a date HEY can act on — an event dated 2030 made a project SHIPPING with
 * the reason "Shipped today", and would have held that status for four years.
 */
export const FUTURE_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Meaningful events, newest first, excluding any dated implausibly far ahead.
 *
 * The event keeps its row — a wrong date is a fact about the source worth
 * keeping — it simply cannot be evidence of shipping.
 */
export function meaningfulEvents(events: readonly ScoredEvent[], now?: Date): ScoredEvent[] {
  const horizon = now ? now.getTime() + FUTURE_DATE_TOLERANCE_MS : Number.POSITIVE_INFINITY;
  return collapseRepeatedEvidence(
    events
      .filter((event) => isMeaningful(event))
      .filter((event) => event.publishedAt.getTime() <= horizon)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
  );
}

/**
 * Whole UTC ISO weeks since the epoch: Monday 1970-01-05 is week 1;
 * 1970-01-01 was a Thursday. Shared by the consistency buckets (`hbm.ts`)
 * and the code-activity collapse below, so "the same week" means one thing.
 */
export function isoWeekIndex(date: Date): number {
  const day = Math.floor(date.getTime() / 86_400_000);
  return Math.floor((day + 3) / 7);
}

/**
 * One `CODE_ACTIVITY` per UTC ISO week, and — since hbm-v11 (2026-09-25) —
 * one GitHub prerelease per UTC ISO week, each kind on its own; the input is
 * newest first, so the newest of a week is kept. A nightly or release
 * candidate cut every day is one week of building, not seven releases: in
 * production one project carried sixty prereleases in thirty days.
 *
 * And — since hbm-v23 (2026-10-03, outsider audit) — one full GitHub release
 * per repository per UTC day (`RELEASE_BURST`): one repository cut 27
 * releases three seconds apart on 1 October, each a weight-5 ship. A day's
 * releases of one repository are one release day; two repositories on one
 * day are two. A release whose repository is not known is never collapsed.
 *
 * And — since hbm-v24 (founder ruling 2026-10-03, "kira sekali") — one
 * follow-up contract deployment per project per UTC second (`DEPLOY_BATCH`):
 * a deploy script put up four contracts in one second and the project read
 * ACTIVE on them. The input is one project's events, so the key is the second
 * alone; deploys a second apart count apart.
 *
 * The input is meaningful events (corroborated) newest first, so the kept
 * row is the newest corroborated one — the row `buildingEvidenceSql` keeps.
 */
export function collapseRepeatedEvidence(sorted: readonly ScoredEvent[]): ScoredEvent[] {
  const seen = new Set<string>();
  return sorted.filter((event) => {
    const key = collapseKey(event);
    if (key === undefined) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The period an event counts once in, or undefined when it always counts. */
function collapseKey(event: ScoredEvent): string | undefined {
  if (event.eventType === 'CODE_ACTIVITY') return `code:${isoWeekIndex(event.publishedAt)}`;
  if (event.prerelease === true) return `prerelease:${isoWeekIndex(event.publishedAt)}`;
  if (event.eventType === RELEASE_BURST.eventType && event.repository) {
    return `release-day:${event.repository.toLowerCase()}:${utcDayIndex(event.publishedAt)}`;
  }
  if (event.eventType === DEPLOY_BATCH.eventType) return `deploy-batch:${utcSecondIndex(event.publishedAt)}`;
  return undefined;
}

/** Whole UTC seconds since the epoch: the deploy-batch key (hbm-v24). */
export function utcSecondIndex(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Whole UTC days since the epoch: the release-day key (hbm-v23). */
export function utcDayIndex(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

/**
 * The hbm-v11 name, kept for its callers: it applies every collapse the
 * scorer applies, the release day (hbm-v23) and the deploy batch (hbm-v24)
 * included.
 */
export const collapseSameWeekCodeActivity = collapseRepeatedEvidence;

export function deriveActivityStatus(input: ActivityInput): ActivityResult {
  const meaningful = meaningfulEvents(input.events, input.now);
  const latest = meaningful[0];

  if (!latest) {
    // No meaningful activity observed. Whether that means "quiet" or "we cannot
    // tell" depends entirely on whether HEY has sources to observe.
    return {
      status: input.hasSourceCoverage ? 'DORMANT' : 'UNKNOWN',
      meaningfulEventCount: 0,
      reason: input.hasSourceCoverage
        ? 'No meaningful project activity observed from the sources HEY tracks.'
        : 'Not enough source coverage to determine activity.',
    };
  }

  const ageDays = daysBetween(latest.publishedAt, input.now);
  let resumedWithheld: ResumedWithheldReason | undefined;

  // Resumption is checked before recency so a comeback reads as RESUMED rather
  // than simply SHIPPING (PRD V4 section 10).
  if (ageDays <= ACTIVITY.resumedWithinDays) {
    /*
     * The gap is measured from the comeback *cluster* to the last event
     * before it (2026-09-18). Measured between the two newest events, a
     * comeback that shipped a release and a docs update on the same day read
     * as SHIPPING — two of the eight resumed projects in production were in
     * exactly that shape. Every event inside the comeback window belongs to
     * the comeback; the gap is to the first event older than that.
     */
    const comebackStart = latest.publishedAt.getTime() - ACTIVITY.resumedWithinDays * 86_400_000;
    const previous = meaningful.find((event) => event.publishedAt.getTime() < comebackStart);
    if (previous) {
      const gapDays = daysBetween(previous.publishedAt, latest.publishedAt);
      if (gapDays >= ACTIVITY.dormancyGapDays) {
        /*
         * Only a gap HEY watched is a gap (hbm-v25, 2026-10-07): every ship
         * of the comeback must come from a source HEY was reading when the
         * gap began. A repository attached during the gap read its first
         * commits as a "return" — 11 of 16 RESUMED projects in production
         * were exactly that. Read over the comeback's events before the
         * collapse, so a week kept from one repository cannot hide another
         * repository HEY began reading late.
         */
        const horizon = input.now.getTime() + FUTURE_DATE_TOLERANCE_MS;
        const comeback = input.events.filter(
          (event) => isMeaningful(event) && event.publishedAt.getTime() >= comebackStart && event.publishedAt.getTime() <= horizon,
        );
        resumedWithheld = comebackCoverageWithheld(comeback, previous.publishedAt);
        if (resumedWithheld === undefined) {
          return {
            lastMeaningfulShipAt: latest.publishedAt,
            meaningfulEventCount: meaningful.length,
            status: 'RESUMED',
            reason: `Resumed building after ${Math.floor(gapDays)} days without observed activity.`,
          };
        }
      }
    }
  }

  // A withheld comeback falls through to the ordinary recency rule and says why (hbm-v25).
  const base = {
    lastMeaningfulShipAt: latest.publishedAt,
    meaningfulEventCount: meaningful.length,
    ...(resumedWithheld === undefined ? {} : { resumedWithheld }),
  };

  if (ageDays <= ACTIVITY.shippingWithinDays) {
    return { ...base, status: 'SHIPPING', reason: `Shipped ${describeAge(ageDays)}.` };
  }

  if (ageDays <= ACTIVITY.activeWithinDays) {
    return { ...base, status: 'ACTIVE', reason: `Last shipped ${describeAge(ageDays)}.` };
  }

  // Or: consistent activity across a longer window still counts as active.
  const recentCount = meaningful.filter(
    (event) => daysBetween(event.publishedAt, input.now) <= ACTIVITY.activeEventWindowDays,
  ).length;
  if (recentCount >= ACTIVITY.activeEventCount) {
    return {
      ...base,
      status: 'ACTIVE',
      reason: `${recentCount} meaningful updates in the last ${ACTIVITY.activeEventWindowDays} days.`,
    };
  }

  // "No updates for N days" is a claim about having looked (2026-09-18): with
  // no observable source, the honest answer is UNKNOWN — the ruling the
  // DORMANT path already follows. The dated last ship still renders.
  if (!input.hasSourceCoverage) {
    return {
      ...base,
      status: 'UNKNOWN',
      reason: 'Not enough source coverage to confirm current activity.',
    };
  }

  if (ageDays <= ACTIVITY.quietWithinDays) {
    return {
      ...base,
      status: 'QUIET',
      reason: `No meaningful updates for ${Math.floor(ageDays)} days.`,
    };
  }

  return {
    ...base,
    status: 'DORMANT',
    // Never "dead" or "abandoned": HEY reports what it observed, nothing more.
    reason: `No meaningful updates observed for ${Math.floor(ageDays)} days.`,
  };
}

/**
 * Why HEY did not watch a comeback's gap, or undefined when it did (hbm-v25,
 * `RESUMED_COVERAGE`): every comeback ship must carry a `coveredFrom` at or
 * before `gapStart`, the last counted update before the gap. A source that
 * began during the gap is named before an unknown one — it is the stronger
 * fact. Deterministic: dates in, a reason out.
 */
export function comebackCoverageWithheld(comeback: readonly ScoredEvent[], gapStart: Date): ResumedWithheldReason | undefined {
  if (!RESUMED_COVERAGE.requireCoverageThroughGap) return undefined;
  let unknown = false;
  for (const event of comeback) {
    const from = event.coveredFrom;
    if (from === undefined || from === null || Number.isNaN(from.getTime())) {
      if (RESUMED_COVERAGE.unknownCoverageWithholds) unknown = true;
      continue;
    }
    if (from.getTime() > gapStart.getTime()) return 'coverage_began_during_gap';
  }
  return unknown ? 'coverage_unknown' : undefined;
}

function describeAge(days: number): string {
  if (days < 1) return 'today';
  const whole = Math.floor(days);
  return whole === 1 ? '1 day ago' : `${whole} days ago`;
}
