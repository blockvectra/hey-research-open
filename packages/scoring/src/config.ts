import type { ShipEventType, VerificationStatus } from '@hey/db';

/**
 * Scoring configuration (PRD V4 sections 11, 13).
 *
 * Every weight and threshold lives here so scores stay deterministic, auditable
 * and versioned. `SCORING_VERSION` is persisted with each snapshot, so historical
 * scores remain explainable after the rules change.
 *
 * Nothing in this file may reference price return, holders, wallets or trading
 * volume as a positive input. Market data affects the Discovery Gap only, never
 * Build Momentum.
 */

/** PRD V4 section 11.1. */
export const HBM_WEIGHTS = {
  recency: 0.35,
  consistency: 0.25,
  significance: 0.2,
  verification: 0.15,
  sourceDiversity: 0.05,
} as const;

/** PRD V4 section 11.1 base event weights. */
export const EVENT_BASE_WEIGHTS: Record<ShipEventType, number> = {
  PRODUCT_LAUNCH: 10,
  APP_RELEASE: 9,
  CONTRACT_DEPLOY: 9,
  FEATURE_RELEASE: 8,
  INTEGRATION: 8,
  API_RELEASE: 8,
  SDK_RELEASE: 8,
  GITHUB_RELEASE: 7,
  CONTRACT_UPGRADE: 7,
  CONTRACT_DEPLOY_FOLLOWUP: 7,
  GAME_RELEASE: 7,
  ROADMAP_MILESTONE: 6,
  COMMUNITY_TOOL: 6,
  DOCS_UPDATE: 3,
  DEMO_RELEASE: 3,
  DESIGN_RELEASE: 3,
  CREATIVE_DROP: 3,
  COMMUNITY_EVENT: 2,
  FOUNDER_BUILD_UPDATE: 2,
  // Aggregated code activity is capped low on purpose: commit volume is not shipping.
  CODE_ACTIVITY: 3,
  ANNOUNCEMENT: 0,
  OTHER: 0,
};

/** PRD V4 section 11.1 verification weighting. */
export const VERIFICATION_WEIGHTS: Record<VerificationStatus, number> = {
  ADMIN_VERIFIED: 1,
  PUBLICLY_VERIFIED: 1,
  SOURCE_LINKED: 0.7,
  SELF_REPORTED: 0.35,
  DISPUTED: 0,
  RETRACTED: 0,
};

export const RECENCY = {
  /** Events older than this contribute nothing to recency. */
  windowDays: 30,
  /** weighted = base * exp(-ageDays / decayDays) — PRD V4 11.1. */
  decayDays: 14,
  /**
   * Ceiling on summed weighted events before normalisation, so a burst of
   * activity cannot produce an unbounded score.
   */
  saturation: 24,
} as const;

export const CONSISTENCY = { weeks: 6 } as const;

/** Significance dimensions (PRD V4 section 11.1). */
export const SIGNIFICANCE_DIMENSIONS = {
  PRODUCT: ['PRODUCT_LAUNCH', 'APP_RELEASE', 'FEATURE_RELEASE', 'DEMO_RELEASE'],
  PROTOCOL: ['CONTRACT_DEPLOY', 'CONTRACT_UPGRADE', 'CONTRACT_DEPLOY_FOLLOWUP'],
  INTEGRATION: ['INTEGRATION'],
  DEVTOOLING: ['SDK_RELEASE', 'API_RELEASE', 'GITHUB_RELEASE', 'DOCS_UPDATE', 'CODE_ACTIVITY'],
  MILESTONE: ['ROADMAP_MILESTONE'],
  COMMUNITY: [
    'GAME_RELEASE',
    'COMMUNITY_TOOL',
    'CREATIVE_DROP',
    'COMMUNITY_EVENT',
    'DESIGN_RELEASE',
  ],
} as const satisfies Record<string, readonly ShipEventType[]>;

export type SignificanceDimension = keyof typeof SIGNIFICANCE_DIMENSIONS;

/** Repeated updates in one dimension have diminishing returns (PRD V4 11.1). */
export const SIGNIFICANCE = { dimensionCap: 3, fullScoreDimensions: 4 } as const;

/** Independent source classes, capped so breadth is not required of every project. */
export const SOURCE_DIVERSITY = { fullScoreClasses: 3 } as const;

/** PRD V4 section 10 activity thresholds, in days. */
export const ACTIVITY = {
  shippingWithinDays: 7,
  activeWithinDays: 30,
  activeEventWindowDays: 45,
  activeEventCount: 2,
  quietWithinDays: 60,
  dormancyGapDays: 60,
  resumedWithinDays: 14,
} as const;

/** PRD V4 section 13.2. */
export const UNDER_THE_RADAR = {
  minHbm: 45,
  minMeaningfulEvents30d: 2,
} as const;

/** PRD V4 section 13.3. All thresholds are configuration and versioned. */
export const STILL_BUILDING = {
  minMeaningfulEvents30d: 2,
  /** Current market value must be at or below this share of the tracked high. */
  maxShareOfTrackedHigh: 0.5,
  trackedHighWindowDays: 90,
} as const;

/** PRD V4 section 12.1. Thresholds are configuration, never hardcoded in UI. */
export const MARKET_BANDS = {
  MICRO: 100_000,
  SMALL: 1_000_000,
  MID: 10_000_000,
} as const;

/** Discovery Gap component weights (PRD V4 section 13.1). */
export const MARKET_CONTEXT_WEIGHTS = {
  marketCapOrFdv: 0.5,
  liquidity: 0.3,
  volume24h: 0.2,
} as const;
