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

/**
 * A release burst is one ship (hbm-v23, 2026-10-03, founder delegation,
 * outsider audit). A repository's full GitHub releases of one UTC day count
 * once — the newest corroborated one stands for the day — in activity status,
 * Build Momentum and every SQL count of building (`buildingEvidenceSql`).
 * Prereleases keep their weekly collapse (hbm-v11); different repositories
 * on one day still count apart; a release with no known repository is never
 * collapsed (unknown is no ground to demote). The ships stay on the record.
 */
export const RELEASE_BURST = {
  eventType: 'GITHUB_RELEASE',
  /** One counted full release per repository per this period. */
  period: 'utc_day',
  /** The repository is the `owner/repo` of `github-release:<owner>/<repo>:<id>`. */
  externalIdPrefix: 'github-release:',
} as const;

/** PRD V4 section 13.2. */
export const UNDER_THE_RADAR = {
  /** 45 until hbm-v5 (2026-09-13): on the honest published cohort only 16 projects cleared 45 with a live market; 30 admits 29 and still demands verified building. */
  minHbm: 30,
  minMeaningfulEvents30d: 2,
  /**
   * At least one of those meaningful events must be a ship, not a commit
   * summary (hbm-v6, 2026-09-17). Two days of commits scored 30.9 and cleared
   * the floor while one feature release scored 29.3 and did not, so the
   * discovery surface ranked a project that had committed above one that had
   * shipped. Commits still count toward the two; they no longer suffice alone.
   */
  requireShipBeyondCommits: true,
  /**
   * The stored flag holds only beside a positive Discovery Gap (hbm-v21,
   * founder ruling F6, 2026-10-01). The flag used to store eligibility alone
   * and every surface added the gap test on read; one project with a gap of
   * −1.5 carried the flag. The read-side predicate stays as a guard.
   */
  requirePositiveGap: true,
} as const;

/** PRD V4 section 13.3. All thresholds are configuration and versioned. */
export const STILL_BUILDING = {
  minMeaningfulEvents30d: 2,
  /** Current market value must be at or below this share of the tracked high. */
  maxShareOfTrackedHigh: 0.5,
  trackedHighWindowDays: 90,
  /**
   * A high younger than this is a wick, not a drawdown (2026-09-17): 13 of
   * 23 badges rested on a candle high from the day before, with the token at
   * the top of everything HEY itself had ever observed.
   */
  minDrawdownAgeDays: 7,
  /**
   * At least one meaningful event in the window must be more than a commit
   * summary (hbm-v16, founder ruling G2, 2026-09-27), the rule Under the
   * Radar has kept since hbm-v6. Seven of thirteen badges on the day of the
   * ruling rested on commit summaries alone: work, not yet a ship.
   */
  requireShipBeyondCommits: true,
  /**
   * The drawdown is measured only on the markets a Discovery Gap is measured
   * on (hbm-v19, founder delegation, 2026-09-30): an active market that is
   * more than a launch curve (`DISCOVERY_GAP`). A LOW_LIQUIDITY,
   * TRADING_INACTIVE or INSUFFICIENT_DATA reading, or a launch curve, is the
   * same unreliable market the gap was withdrawn from, so a "decline" on it
   * is not a drawdown HEY can stand behind. Such a project is not Still
   * Building and the badge reads "not measured — market too thin", never "not
   * met". The market status only withholds the badge; it never awards it.
   */
  requireMeasuredMarket: true,
  /**
   * Not measured is not "not met" (hbm-v21, founder ruling F2, 2026-10-01):
   * a project with no tracked token, with no current reading of its market,
   * or whose building HEY cannot read (activity UNKNOWN) is not measured, and
   * the scorer persists why (`no_token`, `no_market_reading`,
   * `activity_unknown`). The badge stays false; only its state changes.
   */
  withholdUnmeasured: true,
} as const;

/** PRD V4 section 12.1. Thresholds are configuration, never hardcoded in UI. */
export const MARKET_BANDS = {
  MICRO: 100_000,
  SMALL: 1_000_000,
  MID: 10_000_000,
} as const;

/**
 * Which markets a Discovery Gap is measured on (hbm-v18, founder decision,
 * 2026-09-30). Only an active market: a token whose status is LOW_LIQUIDITY,
 * TRADING_INACTIVE or INSUFFICIENT_DATA, or whose only market is its launch
 * curve, sits near the floor of the market-attention percentile, so its gap
 * measured the thinness of the market rather than the building — 4 Under the
 * Radar projects and 7 gaps sat on such markets on 2026-09-30, and one gap
 * rested on a launch-curve valuation. Such a project gets no gap and no Under
 * the Radar ("not measured — market too thin"), never a zero. The population
 * the others are compared against is unchanged.
 */
export const DISCOVERY_GAP = {
  measuredMarketStatuses: ['ACTIVE_MARKET'],
  unmeasuredLaunchStages: ['CURVE'],
  /**
   * A launch pool is not a market (hbm-v22, founder delegation 2026-10-02):
   * a token ACTIVE_MARKET only as `launch_pool_trading` — its "liquidity" is
   * its own supply sitting in the pool that launched it, at its last price —
   * gets no gap, no Under the Radar and no Still Building, exactly as a launch
   * curve does. 690 published projects held such a market on 2026-10-02, with
   * 40 gaps, 15 of the 26 Under the Radar badges and 4 Still Building; the
   * first Under the Radar card read "Active market … (launch pool inventory,
   * not a market)". Every surface names it "Launch pool only".
   */
  unmeasuredReasonPrefixes: ['launch_pool'],
  /**
   * A market active only because another pool of the same token holds it is
   * measured on that pool's reading (hbm-v21, founder ruling F1, 2026-10-01):
   * the gap, Under the Radar, Still Building and the valuation gate read the
   * reading of the pool the market classifier chose, never the token's own
   * thin pool; with no reading of that pool they are not measured
   * (`active_pool_not_read`).
   */
  rescuedMarketOnActivePool: true,
} as const;

/** Discovery Gap component weights (PRD V4 section 13.1). */
export const MARKET_CONTEXT_WEIGHTS = {
  marketCapOrFdv: 0.5,
  liquidity: 0.3,
  volume24h: 0.2,
} as const;
