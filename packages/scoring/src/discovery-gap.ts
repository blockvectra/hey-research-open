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
  if (UNDER_THE_RADAR.requireShipBeyondCommits && !recent.some((event) => event.eventType !== 'CODE_ACTIVITY')) return false;
  return true;
}

export type StillBuildingInput = EligibilityInput & {
  /** Current market cap or FDV, whichever the provider reported. */
  currentMarketValueUsd?: number;
  /** Highest value HEY itself observed in the tracked window — not a canonical ATH. */
  trackedHighUsd?: number;
  trackedHighAt?: Date;
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
