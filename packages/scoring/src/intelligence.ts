import type { ShipEventType } from '@hey/db';

import { daysBetween, meaningfulEvents, type ScoredEvent } from './activity';
import { ACTIVITY } from './config';
import { shippingStreak } from './hbm';

/**
 * Derived builder intelligence (2026-09-24).
 *
 * Four questions about a project's own development record, each answered from
 * the same meaningful events that set its activity status and Build Momentum
 * (`meaningfulEvents`: corroborated, approved, not a bare deploy, code
 * activity collapsed to one per week — so commit volume cannot inflate any of
 * them). Nothing here reads a price. Every figure is either measured or
 * explicitly not: a window HEY was not watching, or a record too short to
 * compare, returns a state that says so and a null, never a zero.
 *
 * Versioned separately from Build Momentum: these are read-time derivations,
 * not persisted scores, but an API consumer comparing two answers needs to
 * know when the definitions moved.
 */
export const INTELLIGENCE_RULES_VERSION = 'intel-v1' as const;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The event types that are a release — something a user can pick up — rather
 * than work toward one. One list, read by the signal rules, the partner card,
 * the recent-activity strip and the cadence below.
 */
export const RELEASE_EVENT_TYPES = [
  'GITHUB_RELEASE',
  'APP_RELEASE',
  'PRODUCT_LAUNCH',
  'FEATURE_RELEASE',
  'API_RELEASE',
  'SDK_RELEASE',
  'GAME_RELEASE',
] as const satisfies readonly ShipEventType[];

const RELEASES: ReadonlySet<string> = new Set(RELEASE_EVENT_TYPES);

/* ------------------------------------------------------------------ velocity */

export const VELOCITY = {
  windowDays: 30,
  /** Ratio thresholds, both required with the absolute difference below. */
  acceleratingRatio: 1.5,
  slowingRatio: 2 / 3,
  /** 1 → 2 events is +100% and means nothing; a direction needs two events of difference. */
  minAbsoluteChange: 2,
} as const;

export type VelocityState = 'ACCELERATING' | 'STABLE' | 'SLOWING' | 'NEW' | 'NO_RECENT_ACTIVITY';

export type BuildVelocity = {
  windowDays: number;
  current: number;
  /** Null when HEY was not watching the whole previous window. */
  previous: number | null;
  /** Null for a zero or missing denominator — never an infinite or invented percentage. */
  changePct: number | null;
  state: VelocityState;
};

/**
 * Is meaningful development accelerating, stable or slowing: the last thirty
 * days against the thirty before, on the canonical meaningful events.
 *
 * `observedSince` is when HEY started watching the project. A previous window
 * that begins before it is partial — an empty stretch there is HEY not
 * looking, not the builder resting — so such a project is `NEW`.
 */
export function buildVelocity(events: readonly ScoredEvent[], now: Date, observedSince: Date): BuildVelocity {
  const window = VELOCITY.windowDays * DAY_MS;
  const meaningful = meaningfulEvents(events, now);
  const age = (event: ScoredEvent) => now.getTime() - event.publishedAt.getTime();
  const current = meaningful.filter((event) => age(event) < window).length;
  const previousCount = meaningful.filter((event) => age(event) >= window && age(event) < 2 * window).length;

  if (observedSince.getTime() > now.getTime() - 2 * window) {
    return { windowDays: VELOCITY.windowDays, current, previous: null, changePct: null, state: 'NEW' };
  }
  const base = { windowDays: VELOCITY.windowDays, current, previous: previousCount };
  if (current === 0 && previousCount === 0) return { ...base, changePct: null, state: 'NO_RECENT_ACTIVITY' };
  if (previousCount === 0) {
    return { ...base, changePct: null, state: current >= VELOCITY.minAbsoluteChange ? 'ACCELERATING' : 'STABLE' };
  }
  const ratio = current / previousCount;
  const changePct = Math.round((ratio - 1) * 100);
  const difference = current - previousCount;
  const state: VelocityState =
    ratio >= VELOCITY.acceleratingRatio && difference >= VELOCITY.minAbsoluteChange
      ? 'ACCELERATING'
      : ratio <= VELOCITY.slowingRatio && -difference >= VELOCITY.minAbsoluteChange
        ? 'SLOWING'
        : 'STABLE';
  return { ...base, changePct, state };
}

/* ------------------------------------------------------------------ cadence */

export const CADENCE = {
  lookbackDays: 365,
  /** Two intervals — three releases on three days — before a cadence is claimed. One release is not a rhythm. */
  minIntervals: 2,
  /** A direction compares two halves, so it needs at least two intervals in each. */
  minIntervalsForDirection: 4,
  fasterRatio: 0.75,
  slowerRatio: 4 / 3,
} as const;

export type CadenceDirection = 'FASTER' | 'STEADY' | 'SLOWER';

export type ReleaseCadence =
  | { state: 'INSUFFICIENT_RELEASES'; releases: number; lookbackDays: number; daysSinceLastRelease: number | null }
  | {
      state: 'MEASURED';
      releases: number;
      lookbackDays: number;
      medianIntervalDays: number;
      /** The newer half of the intervals, and the older half; null until there are enough for both. */
      currentIntervalDays: number | null;
      previousIntervalDays: number | null;
      direction: CadenceDirection | null;
      daysSinceLastRelease: number;
    };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * The typical interval between meaningful releases over the last year.
 *
 * Releases on the same UTC day count once: a monorepo tagging five packages
 * at once shipped one release, not five, and counting them would make its
 * cadence read as zero days.
 */
export function releaseCadence(events: readonly ScoredEvent[], now: Date): ReleaseCadence {
  const since = now.getTime() - CADENCE.lookbackDays * DAY_MS;
  const days = [
    ...new Set(
      meaningfulEvents(events, now)
        .filter((event) => RELEASES.has(event.eventType) && event.publishedAt.getTime() >= since)
        .map((event) => Math.floor(event.publishedAt.getTime() / DAY_MS)),
    ),
  ].sort((a, b) => a - b);
  const last = days.at(-1);
  const daysSinceLastRelease = last === undefined ? null : Math.floor(now.getTime() / DAY_MS) - last;
  const intervals = days.slice(1).map((day, index) => day - days[index]!);
  if (intervals.length < CADENCE.minIntervals) {
    return { state: 'INSUFFICIENT_RELEASES', releases: days.length, lookbackDays: CADENCE.lookbackDays, daysSinceLastRelease };
  }
  let currentIntervalDays: number | null = null;
  let previousIntervalDays: number | null = null;
  let direction: CadenceDirection | null = null;
  if (intervals.length >= CADENCE.minIntervalsForDirection) {
    const half = Math.floor(intervals.length / 2);
    previousIntervalDays = oneDecimal(median(intervals.slice(0, half)));
    currentIntervalDays = oneDecimal(median(intervals.slice(half)));
    const ratio = currentIntervalDays / Math.max(previousIntervalDays, 1);
    direction = ratio <= CADENCE.fasterRatio ? 'FASTER' : ratio >= CADENCE.slowerRatio ? 'SLOWER' : 'STEADY';
  }
  return {
    state: 'MEASURED',
    releases: days.length,
    lookbackDays: CADENCE.lookbackDays,
    medianIntervalDays: oneDecimal(median(intervals)),
    currentIntervalDays,
    previousIntervalDays,
    direction,
    daysSinceLastRelease: daysSinceLastRelease!,
  };
}

/* -------------------------------------------------------------- consistency */

export const CONSISTENCY_WINDOW_WEEKS = 12;

export type BuilderConsistency = {
  /** Of the last twelve weeks HEY watched; null when it watched fewer. */
  activeWeeks: number | null;
  windowWeeks: number;
  /** The canonical streak (`shippingStreak`), in weeks. */
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  daysSinceMeaningfulShip: number | null;
  /** The longest stretch without a meaningful event, the current one included; null with no event at all. */
  longestSilenceDays: number | null;
  /** Comebacks after the gap that defines RESUMED (`ACTIVITY.dormancyGapDays`). */
  resumptions: number;
};

/**
 * How steadily a project builds. Weeks are the same seven-day buckets counted
 * back from now that the canonical streak uses, so "active week" means one
 * thing on every surface.
 */
export function builderConsistency(events: readonly ScoredEvent[], now: Date, observedSince: Date): BuilderConsistency {
  const meaningful = meaningfulEvents(events, now).filter((event) => event.publishedAt.getTime() <= now.getTime());
  const buckets = new Set(meaningful.map((event) => Math.floor((now.getTime() - event.publishedAt.getTime()) / WEEK_MS)));
  const watchedWeeks = Math.floor((now.getTime() - observedSince.getTime()) / WEEK_MS);

  let activeWeeks: number | null = null;
  if (watchedWeeks >= CONSISTENCY_WINDOW_WEEKS) {
    activeWeeks = 0;
    for (let week = 0; week < CONSISTENCY_WINDOW_WEEKS; week += 1) if (buckets.has(week)) activeWeeks += 1;
  }

  let longestStreakWeeks = 0;
  for (const week of buckets) {
    if (buckets.has(week - 1)) continue; // not the newest week of a run
    let run = 1;
    while (buckets.has(week + run)) run += 1;
    longestStreakWeeks = Math.max(longestStreakWeeks, run);
  }

  const oldestFirst = [...meaningful].reverse();
  const newest = meaningful[0];
  let longestSilenceDays: number | null = null;
  let resumptions = 0;
  if (newest) {
    longestSilenceDays = Math.floor(daysBetween(newest.publishedAt, now));
    for (let index = 1; index < oldestFirst.length; index += 1) {
      const gap = daysBetween(oldestFirst[index - 1]!.publishedAt, oldestFirst[index]!.publishedAt);
      longestSilenceDays = Math.max(longestSilenceDays, Math.floor(gap));
      if (gap >= ACTIVITY.dormancyGapDays) resumptions += 1;
    }
  }

  return {
    activeWeeks,
    windowWeeks: CONSISTENCY_WINDOW_WEEKS,
    currentStreakWeeks: shippingStreak(events, now),
    longestStreakWeeks,
    daysSinceMeaningfulShip: newest ? Math.floor(daysBetween(newest.publishedAt, now)) : null,
    longestSilenceDays,
    resumptions,
  };
}

/* ------------------------------------------------------------ discovery lag */

export const DISCOVERY_LAG = { windowDays: 90, minSamples: 3 } as const;

export type LagEvent = ScoredEvent & { detectedAt: Date };

export type DiscoveryLag =
  | { state: 'INSUFFICIENT_SAMPLES'; samples: number; windowDays: number }
  | { state: 'MEASURED'; samples: number; windowDays: number; medianHours: number; maxHours: number };

/**
 * How long after a project published something HEY recorded it.
 *
 * Only events published after HEY began watching the project count: a
 * release from 2024 found by a 2026 backfill has a "lag" of two years that
 * describes the backfill, not HEY's reading of a live source. And an event
 * recorded before its own publication date (a feed stamped in a later
 * timezone) is left out rather than counted as zero.
 */
export function discoveryLag(events: readonly LagEvent[], now: Date, observedSince: Date): DiscoveryLag {
  const since = Math.max(observedSince.getTime(), now.getTime() - DISCOVERY_LAG.windowDays * DAY_MS);
  const meaningful = new Set(meaningfulEvents(events, now));
  const lags = events
    .filter((event) => meaningful.has(event))
    .filter((event) => event.publishedAt.getTime() >= since && event.detectedAt.getTime() >= event.publishedAt.getTime())
    .map((event) => (event.detectedAt.getTime() - event.publishedAt.getTime()) / 3_600_000);
  if (lags.length < DISCOVERY_LAG.minSamples) {
    return { state: 'INSUFFICIENT_SAMPLES', samples: lags.length, windowDays: DISCOVERY_LAG.windowDays };
  }
  return {
    state: 'MEASURED',
    samples: lags.length,
    windowDays: DISCOVERY_LAG.windowDays,
    medianHours: oneDecimal(median(lags)),
    maxHours: oneDecimal(Math.max(...lags)),
  };
}

/* --------------------------------------------------------- market attention */

export type MarketAttention = 'VERY_LOW' | 'LOW' | 'TYPICAL' | 'ELEVATED' | 'HIGH';

/**
 * The market-context percentile the Discovery Gap already computes (market
 * cap, liquidity and volume against the published cohort), named in five
 * bands. Context, never an input to anything a builder is judged by; null
 * when HEY has no live market to rank.
 */
export function marketAttention(marketContextPercentile: number | null | undefined): MarketAttention | null {
  if (marketContextPercentile === null || marketContextPercentile === undefined || !Number.isFinite(marketContextPercentile)) return null;
  if (marketContextPercentile < 20) return 'VERY_LOW';
  if (marketContextPercentile < 40) return 'LOW';
  if (marketContextPercentile < 60) return 'TYPICAL';
  if (marketContextPercentile < 80) return 'ELEVATED';
  return 'HIGH';
}
