import type { ActivityStatus } from '@hey/db';

import { daysBetween, meaningfulEvents, type ScoredEvent } from './activity';
import {
  MARKET_BANDS,
  MARKET_CONTEXT_WEIGHTS,
  RECENCY,
  STILL_BUILDING,
  UNDER_THE_RADAR,
} from './config';
import { clampScore, percentileRank, renormalizeWeights } from './math';
import { SCORING_VERSION } from './version';

/**
 * Discovery Gap and Still Building (PRD V4 section 13).
 *
 * These express one factual observation: a project is shipping more actively than
 * its current market footprint would suggest. They are never a prediction, a
 * valuation, or a recommendation, and no user-facing string here may imply one.
 */
export type MarketBand = 'MICRO' | 'SMALL' | 'MID' | 'LARGE' | 'UNKNOWN';

export type MarketContextValues = {
  marketCapOrFdvUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
};

/** Cohort of comparable projects, used for percentile placement. */
export type MarketCohort = {
  marketCapOrFdvUsd: number[];
  liquidityUsd: number[];
  volume24hUsd: number[];
};

export function marketBand(marketCapOrFdvUsd: number | undefined): MarketBand {
  if (marketCapOrFdvUsd === undefined) return 'UNKNOWN';
  if (marketCapOrFdvUsd < MARKET_BANDS.MICRO) return 'MICRO';
  if (marketCapOrFdvUsd < MARKET_BANDS.SMALL) return 'SMALL';
  if (marketCapOrFdvUsd < MARKET_BANDS.MID) return 'MID';
  return 'LARGE';
}

const log1p = (value: number): number => Math.log1p(Math.max(0, value));

/**
 * Cheap market-attention percentile (PRD V4 section 13.1).
 *
 * Log-scaled so a handful of large projects do not flatten everything else.
 * Missing metrics renormalise the remaining weights rather than counting as zero,
 * which would falsely depress a project that simply lacks coverage.
 */
export function marketContextPercentile(
  values: MarketContextValues,
  cohort: MarketCohort,
): number | undefined {
  const parts: { weight: number; percentile: number }[] = [];

  if (values.marketCapOrFdvUsd !== undefined && cohort.marketCapOrFdvUsd.length > 0) {
    parts.push({
      weight: MARKET_CONTEXT_WEIGHTS.marketCapOrFdv,
      percentile: percentileRank(
        log1p(values.marketCapOrFdvUsd),
        cohort.marketCapOrFdvUsd.map(log1p),
      ),
    });
  }
  if (values.liquidityUsd !== undefined && cohort.liquidityUsd.length > 0) {
    parts.push({
      weight: MARKET_CONTEXT_WEIGHTS.liquidity,
      percentile: percentileRank(log1p(values.liquidityUsd), cohort.liquidityUsd.map(log1p)),
    });
  }
  if (values.volume24hUsd !== undefined && cohort.volume24hUsd.length > 0) {
    parts.push({
      weight: MARKET_CONTEXT_WEIGHTS.volume24h,
      percentile: percentileRank(log1p(values.volume24hUsd), cohort.volume24hUsd.map(log1p)),
    });
  }

  if (parts.length === 0) return undefined;

  const weights = renormalizeWeights(parts.map((part) => part.weight));
  return clampScore(
    parts.reduce((total, part, index) => total + part.percentile * (weights[index] ?? 0), 0),
  );
}

/**
 * DGS = HBM percentile − market-context percentile (PRD V4 section 13.1).
 *
 * A high positive value means only that a project is shipping more actively than
 * its current relative market footprint. It does not mean undervalued.
 */
export function discoveryGapScore(
  hbmPercentile: number,
  marketPercentile: number | undefined,
): number | undefined {
  if (marketPercentile === undefined) return undefined;
  return Math.round((hbmPercentile - marketPercentile) * 10) / 10;
}

/**
 * Why a project has no Discovery Gap (hbm-v18, 2026-09-30; which markets are
 * measured is the market side's rule, `discoveryGapMarketMeasurable` in
 * `token-market.ts`), persisted beside
 * the gap as `components.discoveryGapWithheld` and sent by the API as
 * `discoveryGapWithheld`: a missing gap is "not measured, because …", never
 * a zero. In the order the rebuild tests them.
 */
/*
 * `active_pool_not_read` (hbm-v21, founder ruling F1, 2026-10-01): the market
 * is active only because another pool of the same token holds it, and HEY
 * holds no current reading of that pool to measure on — the thin pool's own
 * reading is never used instead.
 */
export const DISCOVERY_GAP_WITHHELD_REASONS = [
  'no_token',
  'market_not_live',
  'token_not_the_projects',
  'market_too_thin',
  'active_pool_not_read',
  'no_market_reading',
  'no_build_momentum',
] as const;
export type DiscoveryGapWithheldReason = (typeof DISCOVERY_GAP_WITHHELD_REASONS)[number];

/** Each reason in words, for every surface that prints a missing gap (the Terminal, the MCP, the explain engine). */
export const DISCOVERY_GAP_WITHHELD_WORDS: Readonly<Record<DiscoveryGapWithheldReason, string>> = {
  no_token: 'Not measured — no tracked token',
  market_not_live: 'Not measured — no live market',
  token_not_the_projects: 'Not measured — the token is not tied to the project',
  market_too_thin: 'Not measured — market too thin',
  active_pool_not_read: 'Not measured — no reading of the pool that makes the market active',
  no_market_reading: 'Not measured — no current market reading',
  no_build_momentum: 'Not measured — no building recorded',
};

/** A stored reason read back: one of the list, or undefined for anything else (a row scored before hbm-v18). */
export function discoveryGapWithheldReason(value: unknown): DiscoveryGapWithheldReason | undefined {
  return typeof value === 'string' && (DISCOVERY_GAP_WITHHELD_REASONS as readonly string[]).includes(value) ? (value as DiscoveryGapWithheldReason) : undefined;
}

/**
 * Why Still Building was not measured (hbm-v19, 2026-09-30): the market it
 * would be measured on is not one HEY measures a drawdown on. Persisted beside
 * the badge as `components.stillBuildingWithheld` and sent by the API as
 * `stillBuildingWithheld`, beside `stillBuilding: false`, so "not measured"
 * is never read as "not met". The words are the Discovery Gap's for the same
 * market: one sentence per market, whichever badge it withholds.
 */
/*
 * `valuation_not_plausible` (hbm-v20, 2026-09-30): the valuation gate withheld
 * the current valuation (`valuation-plausibility.ts`), so there is no current
 * value to measure a drawdown against — not measured, never "not met".
 */
/*
 * hbm-v21 (2026-10-01), appended so the list only grows:
 * - `active_pool_not_read` (founder ruling F1): a market active only because
 *   another pool holds it, with no current reading of that pool;
 * - `no_token`, `no_market_reading`, `activity_unknown` (founder ruling F2):
 *   no tracked token, no current reading of the market, or building HEY
 *   cannot read (activity UNKNOWN) — HEY never measured the badge;
 * - `not_scored` (F2): never persisted by the scorer; the readers send it for
 *   a project with no score under the current rules yet.
 */
export const STILL_BUILDING_WITHHELD_REASONS = [
  'market_not_live',
  'token_not_the_projects',
  'market_too_thin',
  'valuation_not_plausible',
  'no_token',
  'active_pool_not_read',
  'no_market_reading',
  'activity_unknown',
  'not_scored',
] as const;
export type StillBuildingWithheldReason = (typeof STILL_BUILDING_WITHHELD_REASONS)[number];

export const STILL_BUILDING_WITHHELD_WORDS: Readonly<Record<StillBuildingWithheldReason, string>> = {
  market_not_live: DISCOVERY_GAP_WITHHELD_WORDS.market_not_live,
  token_not_the_projects: DISCOVERY_GAP_WITHHELD_WORDS.token_not_the_projects,
  market_too_thin: DISCOVERY_GAP_WITHHELD_WORDS.market_too_thin,
  valuation_not_plausible: 'Not measured — valuation not plausible',
  no_token: DISCOVERY_GAP_WITHHELD_WORDS.no_token,
  active_pool_not_read: DISCOVERY_GAP_WITHHELD_WORDS.active_pool_not_read,
  no_market_reading: DISCOVERY_GAP_WITHHELD_WORDS.no_market_reading,
  activity_unknown: 'Not measured — activity unknown',
  not_scored: 'Not measured — not scored yet',
};

/** A stored reason read back: one of the list, or undefined for anything else (a row scored before hbm-v19). */
export function stillBuildingWithheldReason(value: unknown): StillBuildingWithheldReason | undefined {
  return typeof value === 'string' && (STILL_BUILDING_WITHHELD_REASONS as readonly string[]).includes(value) ? (value as StillBuildingWithheldReason) : undefined;
}

/**
 * Still Building as one of three states (founder decision, round 4,
 * 2026-09-30), sent beside the v1 boolean wherever it appears:
 *
 * - `HELD` — the badge is held (`stillBuilding: true`);
 * - `NOT_HELD` — HEY measured it and the badge is not held;
 * - `NOT_MEASURED` — HEY did not measure it: no score yet, a score from
 *   superseded rules waiting to be rescored, or the scorer persisted a reason
 *   (`stillBuildingWithheld`, hbm-v19) beside the false.
 *
 * `stillBuilding` keeps its v1 meaning (false whenever the badge is not held);
 * making it nullable is deferred to a future `/api/v2`.
 *
 * hbm-v21 (founder ruling F2, 2026-10-01): a project with no tracked token,
 * no current market reading or building HEY cannot read reads NOT_MEASURED,
 * never NOT_HELD — the scorer now persists a reason for each — and a score
 * written under superseded rules (its `scoringVersion` is not the current
 * one) is not measured until it is rescored: the cohort rebuild has already
 * withdrawn the badge it held, so its false is not a finding.
 */
export const STILL_BUILDING_STATES = ['HELD', 'NOT_HELD', 'NOT_MEASURED'] as const;
export type StillBuildingState = (typeof STILL_BUILDING_STATES)[number];

/**
 * The state from what the scorer persisted: the badge (`undefined`/`null`
 * when no score row exists), the score's components and, where the reader
 * has it, the score's `scoringVersion`.
 */
export function stillBuildingState(stillBuilding: boolean | null | undefined, components: unknown, scoringVersion?: string | null): StillBuildingState {
  if (stillBuilding === true) return 'HELD';
  if (stillBuilding === null || stillBuilding === undefined) return 'NOT_MEASURED';
  if (scoringVersionStale(scoringVersion)) return 'NOT_MEASURED';
  const record = typeof components === 'object' && components !== null ? (components as Record<string, unknown>) : {};
  return stillBuildingWithheldReason(record['stillBuildingWithheld']) ? 'NOT_MEASURED' : 'NOT_HELD';
}

/**
 * Why a Still Building that is not held was not measured, for the readers
 * (hbm-v21, F2): `not_scored` for no score or a score from superseded rules,
 * else the reason the scorer persisted, else nothing (measured, and not met).
 */
export function stillBuildingWithheldOf(
  stillBuilding: boolean | null | undefined,
  components: unknown,
  scoringVersion?: string | null,
): StillBuildingWithheldReason | undefined {
  if (stillBuilding === true) return undefined;
  if (stillBuilding === null || stillBuilding === undefined || scoringVersionStale(scoringVersion)) return 'not_scored';
  const record = typeof components === 'object' && components !== null ? (components as Record<string, unknown>) : {};
  return stillBuildingWithheldReason(record['stillBuildingWithheld']);
}

/** A version the reader holds that is not the current one; an unknown version decides nothing. */
const scoringVersionStale = (scoringVersion: string | null | undefined): boolean =>
  typeof scoringVersion === 'string' && scoringVersion !== '' && scoringVersion !== SCORING_VERSION;

const ACTIVE_STATUSES: readonly ActivityStatus[] = ['SHIPPING', 'ACTIVE', 'RESUMED'];

export type EligibilityInput = {
  activityStatus: ActivityStatus;
  hbm: number;
  events: readonly ScoredEvent[];
  now: Date;
  marketDataFresh: boolean;
  isHidden?: boolean;
};

const meaningfulIn30Days = (events: readonly ScoredEvent[], now: Date): ScoredEvent[] =>
  meaningfulEvents(events, now).filter(
    (event) => daysBetween(event.publishedAt, now) <= RECENCY.windowDays,
  );

/** PRD V4 section 13.2. */
export function isUnderTheRadarEligible(input: EligibilityInput): boolean {
  if (input.isHidden) return false;
  if (!ACTIVE_STATUSES.includes(input.activityStatus)) return false;
  if (input.hbm < UNDER_THE_RADAR.minHbm) return false;
  if (!input.marketDataFresh) return false;
  const recent = meaningfulIn30Days(input.events, input.now);
  if (recent.length < UNDER_THE_RADAR.minMeaningfulEvents30d) return false;
  // A commit summary is evidence of work, not of a ship (hbm-v6).
  if (UNDER_THE_RADAR.requireShipBeyondCommits && !hasShipBeyondCommits(recent)) return false;
  return true;
}

/** A meaningful event that is not a code-activity summary: a release, a deploy follow-up, a feature, a docs update. */
export const hasShipBeyondCommits = (events: readonly ScoredEvent[]): boolean =>
  events.some((event) => event.eventType !== 'CODE_ACTIVITY');

export type StillBuildingInput = EligibilityInput & {
  /** Current market cap or FDV, whichever the provider reported. */
  currentMarketValueUsd?: number;
  /** Highest value HEY itself observed in the tracked window — not a canonical ATH. */
  trackedHighUsd?: number;
  trackedHighAt?: Date;
  /**
   * Overrides `STILL_BUILDING.requireShipBeyondCommits` for one call. Only the
   * substance impact report sets it, to replay the rules before hbm-v16; the
   * scorer never does.
   */
  requireShipBeyondCommits?: boolean;
};

export type StillBuildingResult = {
  eligible: boolean;
  /** Percentage decline from the HEY-tracked high, for factual display. */
  declinePercent?: number;
  shipsSinceDecline: number;
  reason: string;
};

/**
 * Still Building (PRD V4 section 13.3) — the flagship badge.
 *
 * Factual and historical: market attention fell, and verified building continued
 * afterwards. It says nothing about what the price will do next, and the copy it
 * feeds must never imply recovery.
 */
export function evaluateStillBuilding(input: StillBuildingInput): StillBuildingResult {
  if (input.isHidden)
    return { eligible: false, shipsSinceDecline: 0, reason: 'Project is hidden.' };

  if (!ACTIVE_STATUSES.includes(input.activityStatus)) {
    return { eligible: false, shipsSinceDecline: 0, reason: 'Project is not currently active.' };
  }

  const recent = meaningfulIn30Days(input.events, input.now);
  if (recent.length < STILL_BUILDING.minMeaningfulEvents30d) {
    return {
      eligible: false,
      shipsSinceDecline: 0,
      reason: `Fewer than ${STILL_BUILDING.minMeaningfulEvents30d} verified updates in the last 30 days.`,
    };
  }

  // Commits are work, not yet a ship (hbm-v16, founder ruling G2): the same rule as Under the Radar.
  if ((input.requireShipBeyondCommits ?? STILL_BUILDING.requireShipBeyondCommits) && !hasShipBeyondCommits(recent)) {
    return {
      eligible: false,
      shipsSinceDecline: 0,
      reason: 'No verified update beyond commit activity in the last 30 days.',
    };
  }

  /*
   * A drawdown is a claim about where the market is now (2026-09-18). Under
   * the Radar already refused a stale reading; Still Building read the
   * cohort's `marketDataFresh` into its input and never looked at it, so a
   * token whose last reading was days old could wear the badge against a
   * "current" value HEY no longer had.
   */
  if (!input.marketDataFresh) {
    return {
      eligible: false,
      shipsSinceDecline: recent.length,
      reason: 'No current market reading.',
    };
  }

  if (input.currentMarketValueUsd === undefined || input.trackedHighUsd === undefined) {
    // Without market context there is no drawdown to describe.
    return {
      eligible: false,
      shipsSinceDecline: recent.length,
      reason: 'No market context available.',
    };
  }

  if (input.trackedHighUsd <= 0) {
    return {
      eligible: false,
      shipsSinceDecline: recent.length,
      reason: 'No tracked high available.',
    };
  }

  if (
    input.trackedHighAt &&
    input.now.getTime() - input.trackedHighAt.getTime() < STILL_BUILDING.minDrawdownAgeDays * 86_400_000
  ) {
    // A drawdown is a state the market has been in, not a day it visited.
    return {
      eligible: false,
      shipsSinceDecline: recent.length,
      reason: `The tracked high is less than ${STILL_BUILDING.minDrawdownAgeDays} days old.`,
    };
  }

  const share = input.currentMarketValueUsd / input.trackedHighUsd;
  if (share > STILL_BUILDING.maxShareOfTrackedHigh) {
    return {
      eligible: false,
      shipsSinceDecline: recent.length,
      reason: 'Market value has not declined enough from the HEY-tracked high.',
    };
  }

  // At least one meaningful ship must have happened after the decline began.
  const shipsSinceDecline = input.trackedHighAt
    ? meaningfulEvents(input.events, input.now).filter(
        (event) => event.publishedAt.getTime() > (input.trackedHighAt as Date).getTime(),
      ).length
    : recent.length;

  if (shipsSinceDecline < 1) {
    return {
      eligible: false,
      shipsSinceDecline,
      reason: 'No meaningful updates observed since the decline began.',
    };
  }

  const declinePercent = Math.round((1 - share) * 1000) / 10;

  return {
    eligible: true,
    declinePercent,
    shipsSinceDecline,
    // Deliberately factual: an observation about the past, not a forecast.
    reason: `Down ${declinePercent}% from the HEY-tracked high, with ${shipsSinceDecline} verified update(s) since.`,
  };
}
