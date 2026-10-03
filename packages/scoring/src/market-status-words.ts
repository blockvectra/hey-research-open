import { NOT_FUNGIBLE_REASON, READING_NOT_CURRENT_REASON, type TOKEN_MARKET_REASONS, type TokenMarketStatusValue } from './token-market';

/**
 * The token market statuses in words: one table for the card, the project
 * page, the Terminal header and chart, and the Research Summary (`@hey/ui`'s
 * `tokenMarketLabel` and the domain's `SUMMARY_MARKET_WORDS` read this).
 */
/**
 * A market that is only a launch pool (2026-10-02, outsider audit): the
 * classifier calls a launch pool that traded ACTIVE_MARKET
 * (`launch_pool_trading`), and every surface printed "Active market" beside
 * "(launch pool inventory, not a market)". The label names what it is; the
 * Discovery Gap, Under the Radar and Still Building do not measure it
 * (`DISCOVERY_GAP.unmeasuredReasonPrefixes`, hbm-v22).
 */
export const LAUNCH_POOL_ONLY_LABEL = 'Launch pool only';

/** Whether a status reason says the market is a launch pool's own inventory. */
export const isLaunchPoolReason = (reason: string | null | undefined): boolean => (reason ?? '').startsWith('launch_pool');

/**
 * A token that is not fungible (2026-10-03, full audit): decimals 0, an NFT
 * collection. Its label says what it is, never "Market data insufficient"
 * beside a figure some marketplace sale implied.
 */
export const NOT_FUNGIBLE_LABEL = 'Not a fungible token';

/**
 * The newest reading is too old to say whether the market traded in the last
 * day (2026-10-03, full audit): never "Active market" over a four-day-old
 * reading.
 */
export const READING_NOT_CURRENT_LABEL = 'No current reading';

/** The market label for a status and its reason: "Launch pool only" for an active launch pool, else the status's own label. */
export function tokenMarketStatusLabel(status: TokenMarketStatusValue, reason?: string | null): string {
  if (reason === NOT_FUNGIBLE_REASON) return NOT_FUNGIBLE_LABEL;
  if (reason === READING_NOT_CURRENT_REASON) return READING_NOT_CURRENT_LABEL;
  if (status === 'ACTIVE_MARKET' && isLaunchPoolReason(reason)) return LAUNCH_POOL_ONLY_LABEL;
  return TOKEN_MARKET_LABELS[status] ?? TOKEN_MARKET_LABELS.INSUFFICIENT_DATA;
}

export const TOKEN_MARKET_LABELS: Readonly<Record<TokenMarketStatusValue, string>> = {
  ACTIVE_MARKET: 'Active market',
  LOW_LIQUIDITY: 'Low liquidity',
  NO_LIQUIDITY: 'No liquidity',
  TRADING_INACTIVE: 'Trading inactive',
  LIQUIDITY_REMOVED: 'Liquidity no longer detected',
  MARKET_ABANDONED: 'Market not detected',
  INSUFFICIENT_DATA: 'Market data insufficient',
};

/**
 * Classifier reasons whose readings exist but do not settle a status (the
 * pool followed is nearly empty while another holds liquidity, readings that
 * disagree or cannot be believed, an unconfirmed drain, a launch pool with no
 * volume reading). `@hey/ui` keys its more exact help sentences by these.
 */
export const UNCONFIRMED_MARKET_REASONS = [
  'liquidity_in_another_pool',
  'pool_readings_disagree',
  'launch_pool_volume_unknown',
  'readings_implausible',
  'removal_unconfirmed',
] as const;
export type UnconfirmedMarketReason = (typeof UNCONFIRMED_MARKET_REASONS)[number];

/** What HEY holds beside the status, so the words can name which part is missing. */
export type MarketFacts = {
  /** A current reading exists (price, valuation or liquidity). */
  hasCurrentReading: boolean;
  /** Priced daily closes in the chart's window (`latestDailyClose().pricedDays`, 90 days); two or more draw candles. */
  pricedDays?: number | undefined;
  /** The status reason, when the classifier recorded one. */
  reason?: string | null | undefined;
};

/**
 * The market status in words that never contradict the figures beside them
 * (Terminal redesign, 2026-09-26, spec §6 C4). ONE rule for the Terminal
 * header, the Market tab and the Research Summary (review repair,
 * 2026-09-29: the summary said "Market data insufficient" beside a header and
 * a chart drawing 29 daily candles).
 *
 * `INSUFFICIENT_DATA` means HEY has not classified the market — not that it
 * holds no reading:
 *  - a specific reason (readings that disagree, a launch pool) says the
 *    readings are not confirmed;
 *  - with two priced daily closes the chart draws candles, so it is the
 *    classification that has not caught up ("Not classified yet");
 *  - with only a current reading, it is the daily history that is short;
 *  - with nothing at all, the plain label.
 */
export function marketStatusWords(status: TokenMarketStatusValue, facts: MarketFacts): string {
  if (facts.reason === NOT_FUNGIBLE_REASON || facts.reason === READING_NOT_CURRENT_REASON) return tokenMarketStatusLabel(status, facts.reason);
  if (status === 'INSUFFICIENT_DATA') {
    if (facts.reason && (UNCONFIRMED_MARKET_REASONS as readonly string[]).includes(facts.reason)) return 'Readings not confirmed';
    if ((facts.pricedDays ?? 0) >= 2) return 'Not classified yet';
    if (facts.hasCurrentReading) return 'Daily history too short; current reading available';
  }
  return tokenMarketStatusLabel(status, facts.reason);
}

/**
 * Every classifier reason as a clause (2026-10-03, full audit): the one
 * vocabulary the explain engine's market-status sentence reads. It printed
 * the machine key with its underscores swapped for spaces — "The market is
 * active market because liquidity and volume." A reason added to
 * `TOKEN_MARKET_REASONS` without a clause here fails the type check.
 */
export const TOKEN_MARKET_REASON_WORDS: Readonly<Record<(typeof TOKEN_MARKET_REASONS)[number], string>> = {
  trades_observed: 'HEY decoded trades of the token on chain in the last day',
  no_trades_24h: 'HEY decoded no trades of the token on chain in the last day',
  no_liquidity_reading: 'HEY holds a recent reading, but none that reports liquidity',
  no_recent_reading_after_market: 'HEY recorded a market earlier and has read none for weeks',
  readings_stale: 'every reading HEY holds is more than 30 days old',
  no_readings: 'HEY holds no market reading for the token',
  liquidity_reading_stale_after_market: 'HEY recorded a market earlier and its newest liquidity reading is more than 30 days old',
  launch_pool_trading: 'the only pool is the launch pool holding the token’s own supply, and it traded in the last day',
  launch_pool_volume_unknown: 'the only pool is the launch pool holding the token’s own supply, and no reading reports its volume',
  launch_pool_no_trades: 'the only pool is the launch pool holding the token’s own supply, and nothing traded in it in the last day',
  readings_implausible: 'the newest reading claims a large pool that the day’s trading and HEY’s chain index both contradict',
  liquidity_in_another_pool: 'the pool the newest reading follows is nearly empty, but another pool read in the last day holds liquidity',
  no_volume_24h: 'the pool holds liquidity, but nothing traded in the last day',
  pool_readings_disagree: 'the newest reading finds a nearly empty pool while another pool held liquidity within the week',
  removal_unconfirmed: 'the newest reading finds almost no liquidity, but HEY has not measured a drain',
  liquidity_gone_after_market: 'HEY measured the pool that held the market drained to dust',
  no_liquidity: 'HEY found no meaningful liquidity',
  liquidity_far_below_peak: 'HEY measured the pool that held the market drained far below the level it held',
  liquidity_below_threshold: 'the pool holds less than $5,000 of liquidity',
  liquidity_below_exit_threshold: 'the pool holds less than $6,000 of liquidity, the level a low market must reach to leave that status',
  liquidity_and_volume: 'the pool holds liquidity and the token traded in the last day',
  not_a_fungible_token: 'the token reads 0 decimals (an NFT collection or another token that is not fungible), so no sale of it is a fungible market',
  reading_not_current: 'the newest reading is more than 36 hours old and no trade record from the last day speaks for the market',
};

/** "Active market: the pool holds liquidity and the token traded in the last day." One sentence per status and reason. */
export function tokenMarketReasonSentence(status: TokenMarketStatusValue, reason: string | null | undefined): string {
  const label = tokenMarketStatusLabel(status, reason);
  const clause = reason ? (TOKEN_MARKET_REASON_WORDS as Readonly<Record<string, string>>)[reason] : undefined;
  return clause ? `${label}: ${clause}.` : `${label}.`;
}
