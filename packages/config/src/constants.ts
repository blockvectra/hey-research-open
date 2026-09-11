/**
 * Chain-level and product-level constants that are not environment specific.
 */

/** Robinhood Chain. Token identity is always `(chainId, contractAddress)`. */
export const ROBINHOOD_CHAIN_ID = 4663;

/**
 * Product name (UI/UX V4 section 1). The repository, database schema, env
 * prefixes and package names deliberately keep their existing identifiers —
 * renaming those risks breaking deployments for no user-visible gain (§63).
 */
export const APP_NAME = 'HEY Research Lab';

/** Homepage hero line — PRD V4 section 16.0 E. */
export const APP_TAGLINE = "Find who's actually building on Robinhood Chain.";

/**
 * Source-refresh tiers (PRD V4 section 22.3). Declared here so scheduling logic
 * and admin tooling share one vocabulary; the schedules themselves land in M9.
 */
export const REFRESH_TIERS = ['HOT', 'WARM', 'COOL', 'COLD'] as const;
export type RefreshTier = (typeof REFRESH_TIERS)[number];
