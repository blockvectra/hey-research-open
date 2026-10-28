/**
 * Why a Discovery Gap or Still Building is withheld, and the words for each reason: the one table every surface reads
 * (2026-10-28 simplicity study, CON-9). Moved out of `discovery-gap.ts` so it imports nothing at run time: the MCP
 * (`@hey/mcp-core`, bundled into the published stdio server) and the agent contract (`@hey/agent-provider-core`) read
 * it directly instead of keeping literal copies held equal by parity tests. `word-modules.test.ts` keeps it import-free.
 */
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
  // hbm-v27 (2026-10-12, audit INV-4), appended so the list only grows: building HEY cannot read.
  'activity_unknown',
] as const;
export type DiscoveryGapWithheldReason = (typeof DISCOVERY_GAP_WITHHELD_REASONS)[number];

/** Each reason in words, for every surface that prints a missing gap (the Terminal, the MCP, the explain engine). */
export const DISCOVERY_GAP_WITHHELD_WORDS: Readonly<Record<DiscoveryGapWithheldReason, string>> = {
  no_token: 'Not measured — no tracked token',
  // The market's own label says what the market is (2026-10-28, CON-2): the gap's reason points at it, never restates it.
  market_not_live: 'Not measured — see market',
  token_not_the_projects: 'Not measured — the token is not tied to the project',
  market_too_thin: 'Not measured — market too thin',
  active_pool_not_read: 'Not measured — no reading of the pool that makes the market active',
  no_market_reading: 'Not measured — no current market reading',
  // "No building recorded" read beside a ship on record (2026-10-28, PROJ-5): what is missing is the score.
  no_build_momentum: 'Not measured — no Build Momentum',
  activity_unknown: 'Not measured — activity unknown',
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
 *
 * 2026-10-16 (audit #143, F2 enforced), appended the same way:
 * - `no_tracked_high`: a current, plausible reading of a measured market, but
 *   no plausible reading at least `minDrawdownAgeDays` old in the tracked-high
 *   window — a market HEY began reading under a week ago. There is no high to
 *   measure a drawdown from, so the badge is not measured; it used to read
 *   "No market context available." as measured and not met.
 *
 * hbm-v31 (2026-10-18, founder delegation "repair semua sekali", PA-17),
 * appended the same way:
 * - `builder_sources_unavailable`: every builder source of the project — each
 *   repository, changelog and feed of its own the refresh reads — is
 *   unavailable (a repository answering 404), so whether it kept building
 *   through a decline is not something HEY can see. The same ruling withholds
 *   the badge as `token_not_the_projects` on a token whose ticker another
 *   published project's token carries, and as `market_too_thin` on a market
 *   whose 24-hour volume is below `DISCOVERY_GAP.minVolume24hUsd` — reasons
 *   already on the list.
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
  'no_tracked_high',
  'builder_sources_unavailable',
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
  no_tracked_high: 'Not measured — no tracked high yet',
  builder_sources_unavailable: 'Not measured — builder sources unavailable',
};

/** A stored reason read back: one of the list, or undefined for anything else (a row scored before hbm-v19). */
export function stillBuildingWithheldReason(value: unknown): StillBuildingWithheldReason | undefined {
  return typeof value === 'string' && (STILL_BUILDING_WITHHELD_REASONS as readonly string[]).includes(value) ? (value as StillBuildingWithheldReason) : undefined;
}
