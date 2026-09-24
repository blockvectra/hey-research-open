import type { ActivityStatus, ShipEventType, ShipSourceKind, VerificationStatus } from '@hey/db';

import { ACTIVITY } from './config';
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
};

export type ActivityInput = {
  events: readonly ScoredEvent[];
  now: Date;
  /**
   * Whether HEY has enough registered sources to make a judgement at all.
   * Without coverage the honest answer is UNKNOWN, not DORMANT.
   */
  hasSourceCoverage: boolean;
};

export type ActivityResult = {
  status: ActivityStatus;
  lastMeaningfulShipAt?: Date;
  meaningfulEventCount: number;
  /** Plain-language reason, shown in the methodology view. */
  reason: string;
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
  return collapseSameWeekCodeActivity(
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
 * production one project carried sixty prereleases in thirty days. A full
 * release is never collapsed.
 */
export function collapseSameWeekCodeActivity(sorted: readonly ScoredEvent[]): ScoredEvent[] {
  const seen = new Set<string>();
  return sorted.filter((event) => {
    const kind = event.eventType === 'CODE_ACTIVITY' ? 'code' : event.prerelease === true ? 'prerelease' : undefined;
    if (!kind) return true;
    const key = `${kind}:${isoWeekIndex(event.publishedAt)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  const base = {
    lastMeaningfulShipAt: latest.publishedAt,
    meaningfulEventCount: meaningful.length,
  };

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
        return {
          ...base,
          status: 'RESUMED',
          reason: `Resumed building after ${Math.floor(gapDays)} days without observed activity.`,
        };
      }
    }
  }

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

function describeAge(days: number): string {
  if (days < 1) return 'today';
  const whole = Math.floor(days);
  return whole === 1 ? '1 day ago' : `${whole} days ago`;
}
