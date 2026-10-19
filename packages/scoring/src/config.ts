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

/**
 * A deploy batch is one ship (hbm-v24, founder ruling 2026-10-03, "kira
 * sekali" — count it once). A project's follow-up contract deployments of one
 * run count once — the newest corroborated one stands for the run — in
 * activity status, Build Momentum and every SQL count of building
 * (`buildingEvidenceSql`), as a release day does (`RELEASE_BURST`). An upgrade
 * is not a deploy and is never part of a run. Every deploy stays on the
 * timeline with its source.
 *
 * A run, not a second (hbm-v28, 2026-10-12, audit RD-2, ruling under the
 * founder's delegation): deploys of one project each at most `maxGapSeconds`
 * after the one before form one run. hbm-v24 keyed the batch on the UTC
 * second, which held only for a script that finished inside one second: one
 * script put up 40 contracts over 148 seconds in 20 distinct seconds, counted
 * as 20 ships and filled 20 of the 24 lines on /ships. On production the gaps
 * between a project's consecutive follow-up deploys break cleanly between 45
 * and 84 seconds (none in between), so 60 seconds joins a script's spill-over
 * and never two separate deployments.
 */
export const DEPLOY_BATCH = {
  eventType: 'CONTRACT_DEPLOY_FOLLOWUP',
  /** One counted follow-up deploy per run of the project's deploys (hbm-v28; `utc_second` in hbm-v24). */
  period: 'gap_run',
  /** A deploy at most this many seconds after the project's previous one is in the same run. */
  maxGapSeconds: 60,
} as const;

/**
 * Resumed only inside HEY's coverage (hbm-v25, 2026-10-07, founder
 * delegation, production audit). "Resumed after N days without observed
 * activity" is a claim that HEY was looking through those N days. A comeback
 * counts only when every ship in it was read from a source HEY was already
 * reading when the gap began — each ship's `coveredFrom` (the earliest
 * `project_sources.created_at` its evidence names) at or before the last
 * update before the gap. A source attached during the gap, or a ship whose
 * source HEY cannot name, makes the gap one HEY did not observe: the status
 * falls through to the ordinary recency rule and `resumedWithheld` says why.
 * Measured on production (2026-10-07): 11 of 16 RESUMED projects were the
 * first code HEY ever read, within 8 days of the repository being attached.
 */
export const RESUMED_COVERAGE = {
  /** Every comeback ship's source must have been read from the start of the gap. */
  requireCoverageThroughGap: true,
  /** A ship whose coverage start HEY does not know never carries a comeback. */
  unknownCoverageWithholds: true,
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
  /**
   * Building ahead of attention, never beside high attention (hbm-v30,
   * 2026-10-16, founder delegation "kau buat semua sekali", audit #103): the
   * flag holds only when the project's market attention — its market-context
   * percentile named in `marketAttention`'s five bands — is TYPICAL or lower
   * (below the 60th percentile), never ELEVATED or HIGH. Every one of the 18
   * Under the Radar projects on 2026-10-16 sat at or above the 57th percentile,
   * one at the 98.9th with a gap of 0.4, while the API rated it HIGH. The
   * population the percentiles rank against is unchanged (hbm-v18). Unknown
   * attention never holds the flag, since the flag needs a measured market.
   */
  maxMarketAttention: 'TYPICAL',
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
  /**
   * A token HEY cannot tell from a lookalike holds no drawdown either
   * (hbm-v31, 2026-10-18, founder delegation "repair semua sekali", persona
   * audit PA-17): when the Discovery Gap is withheld as
   * `token_not_the_projects` because the tracked token is UNVERIFIED and
   * another published project's token carries its ticker
   * (`DISCOVERY_GAP.withholdContestedUnverifiedTicker`), Still Building is
   * not measured for the same reason, never "not held". hbm-v30 withheld only
   * the gap, so zip-c00899 held Still Building on a market whose gap the same
   * row said was not the project's.
   */
  withholdContestedUnverifiedTicker: true,
  /**
   * Building HEY can no longer read holds no badge (hbm-v31, same ruling):
   * when every builder source of the project — each repository, changelog
   * and feed of its own that the refresh reads — is unavailable (a
   * repository answering 404, a feed gone), whether it kept building through
   * a decline is not something HEY can see, so the badge is not measured
   * (`builder_sources_unavailable`). zip-c00899 held Still Building while its
   * one repository answered 404. A source never read yet is not unavailable,
   * and a project with no builder source at all is decided by its activity
   * status as before. Activity status and Build Momentum are unchanged.
   */
  withholdUnavailableBuilderSources: true,
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
  /**
   * Building HEY cannot read gets no gap (hbm-v27, 2026-10-12, audit INV-4,
   * ruling under the founder's delegation): a project whose activity status
   * is UNKNOWN is not measured (`activity_unknown`), exactly as Still
   * Building already was (hbm-v21, F2). Its Build Momentum there comes only
   * from evidence quality and source breadth, so a gap read "building ahead of
   * attention" for a project HEY says it cannot read — chicken (HatchFi) held
   * a 94.6th-percentile momentum and a gap of 10.8 beside "Activity not
   * measurable". It stays in the population the others are ranked against;
   * only its own gap is withheld. The activity status only withholds, never
   * awards.
   */
  withholdUnknownActivity: true,
  /**
   * A token contested by its ticker is not measured (hbm-v30, 2026-10-16,
   * founder delegation "kau buat semua sekali", audit #26): when the tracked
   * token's verification is UNVERIFIED and another published project's tracked
   * token — a different contract — carries the same ticker (case-insensitive,
   * without a leading `$`), the gap is withheld as `token_not_the_projects`,
   * and so Under the Radar. TeraWallet was Under the Radar on a $TERA its own
   * page said HEY could not attribute. Only the gap: the market stays in the
   * population the others are ranked against and keeps its percentile. Still
   * Building was unchanged by this rule until hbm-v31, which withholds it too
   * (`STILL_BUILDING.withholdContestedUnverifiedTicker`).
   */
  withholdContestedUnverifiedTicker: true,
  /**
   * A gap needs a current reading (hbm-v30, 2026-10-16, founder delegation
   * "kau buat semua sekali", audit #147): the market reading the gap would use
   * must be no older than one day, the freshness Under the Radar and Still
   * Building already require; an older one (the market cohort keeps readings up
   * to seven days) withholds the gap as `no_market_reading`. The reading stays
   * in the population the others are ranked against.
   */
  requireFreshReading: true,
  /**
   * A market that barely trades is not a measured market (hbm-v31,
   * 2026-10-18, founder delegation "repair semua sekali", persona audit
   * PA-17): a fresh reading whose measured 24-hour volume is below this many
   * US dollars gets no gap, no Under the Radar and no Still Building — withheld
   * as `market_too_thin`, "Not measured — market too thin", exactly as a
   * market that is not ACTIVE_MARKET (hbm-v18, hbm-v19). Two of the three
   * Under the Radar projects on 2026-10-18 sat on graduated Pons pools that
   * were ACTIVE_MARKET on $27.51 and $162 of volume, their liquidity above
   * their valuation: the attention percentile and the drawdown there measured
   * an untraded pool, not attention. The volume is the one on the reading the
   * gap is taken from (`marketVolumeTooThin`); a reading with no volume figure
   * is unknown and never a trip wire, and a stale reading is withheld as
   * `no_market_reading` first. The market stays in the population the others
   * are ranked against and keeps its percentile. Only withholds, never awards,
   * and never reaches activity status or Build Momentum.
   */
  minVolume24hUsd: 1_000,
  /**
   * A frozen volume is no volume for the scorer either (hbm-v32, 2026-10-19,
   * founder delegation "ok buat semua yang belum repair tu", backend audit
   * P3-2): a 24h volume one source repeated beside the same price for more
   * than `TOKEN_MARKET.repeatedVolumeMaxHours` — the reading the market
   * classifier already refuses (token-market-2026-10-16, #134) — is unknown on
   * the reading the gap is taken from: it never trips `minVolume24hUsd`, never
   * counts as a measured volume in the market-context percentile and is no
   * input to the valuation gate. One SQL fragment decides it for both
   * (`frozenVolumeCtes` in `@hey/domain`). Only withholds, never awards.
   */
  frozenVolumeIsUnknown: true,
} as const;

/** Discovery Gap component weights (PRD V4 section 13.1). */
export const MARKET_CONTEXT_WEIGHTS = {
  marketCapOrFdv: 0.5,
  liquidity: 0.3,
  volume24h: 0.2,
} as const;
