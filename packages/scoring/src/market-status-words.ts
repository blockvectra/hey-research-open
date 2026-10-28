import type { LIQUIDITY_NOT_CURRENT_REASON as LiquidityNotCurrent, NOT_FUNGIBLE_REASON as NotFungible, READING_NOT_CURRENT_REASON as ReadingNotCurrent, TOKEN_MARKET_REASONS, TokenMarketStatusValue } from './token-market';

/*
 * Types only from the classifier (2026-10-28 simplicity study, CON-9): this module imports nothing at run time, so the
 * MCP and the agent contract read the market words themselves (`word-modules.test.ts`). The three reason codes the
 * words name are typed by the classifier's own constants, so a code renamed there fails the type check here.
 */
const LIQUIDITY_NOT_CURRENT_REASON: typeof LiquidityNotCurrent = 'liquidity_not_current';
const NOT_FUNGIBLE_REASON: typeof NotFungible = 'not_a_fungible_token';
const READING_NOT_CURRENT_REASON: typeof ReadingNotCurrent = 'reading_not_current';

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

/**
 * Readings HEY holds that do not settle a status (2026-09-25), and the label
 * of a traded market whose depth reading is more than a week old (2026-10-16,
 * ruling #139, `liquidity_not_current`): never "Active market" over a depth
 * figure HEY read weeks ago.
 */
export const READINGS_NOT_CONFIRMED_LABEL = 'Readings not confirmed';

/**
 * The market label for a status and its reason: "Launch pool only" for an
 * active launch pool, "Readings not confirmed" for every unconfirmed reason
 * (`UNCONFIRMED_MARKET_REASONS`, the set `marketStatusWords` reads), else the
 * status's own label. 2026-10-28 simplicity study, CON-2: only
 * `liquidity_not_current` was mapped here, so 157 tokens' chip and API label
 * said "Market data insufficient" beside a summary saying "Readings not
 * confirmed" (hbm-v27, token-market-2026-10-16).
 */
export function tokenMarketStatusLabel(status: TokenMarketStatusValue, reason?: string | null): string {
  if (reason === NOT_FUNGIBLE_REASON) return NOT_FUNGIBLE_LABEL;
  if (reason === READING_NOT_CURRENT_REASON) return READING_NOT_CURRENT_LABEL;
  if (reason === LIQUIDITY_NOT_CURRENT_REASON) return READINGS_NOT_CONFIRMED_LABEL;
  if (status === 'INSUFFICIENT_DATA' && isUnconfirmedMarketReason(reason)) return READINGS_NOT_CONFIRMED_LABEL;
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
  // A liquid pool no reading measured a volume for (2026-10-12, audit DI-4): whether it trades is not settled.
  'volume_unknown',
  // A traded market whose depth reading is more than a week old (2026-10-16, ruling #139).
  'liquidity_not_current',
] as const;
export type UnconfirmedMarketReason = (typeof UNCONFIRMED_MARKET_REASONS)[number];

/** Whether a status reason is one whose readings exist but do not settle a status. */
export const isUnconfirmedMarketReason = (reason: string | null | undefined): reason is UnconfirmedMarketReason =>
  !!reason && (UNCONFIRMED_MARKET_REASONS as readonly string[]).includes(reason);

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
 * The four heads every "we do not know" is said under (2026-10-28 simplicity study, CON-10), one separator, " — ":
 *  - "Not measured — reason": a HEY rule did not measure it;
 *  - "Not read — reason": HEY did not read the source;
 *  - "Withheld — reason": HEY holds the figure and does not publish it;
 *  - "Unknown": activity only.
 * About 144 strings had grown under 18 openings ("Unavailable", "Not available", "Unconfirmed", "Not computed",
 * "Not tracked", "Not classified yet", "Daily history too short" …) and three separators.
 */
export const UNKNOWN_HEADS = { notMeasured: 'Not measured', notRead: 'Not read', withheld: 'Withheld', unknown: 'Unknown' } as const;
export type UnknownHead = (typeof UNKNOWN_HEADS)[keyof typeof UNKNOWN_HEADS];

/** "Not measured — not classified yet": a head and its reason, with the one separator. */
export const headed = (head: UnknownHead, reason: string): string => `${head} — ${reason}`;

/** The market label where HEY holds closes but has not classified the market yet. */
export const NOT_CLASSIFIED_YET_LABEL = headed(UNKNOWN_HEADS.notMeasured, 'not classified yet');
/** The market label where HEY holds a current reading but too few daily closes to classify it. */
export const DAILY_HISTORY_TOO_SHORT_LABEL = headed(UNKNOWN_HEADS.notMeasured, 'daily history too short');

/**
 * The market in words, once (2026-10-28 simplicity study, CON-2): the label and the sentence every market slot reads —
 * the chip, the API's display label, the Research Summary, the explain engine, the Terminal header and Market tab.
 * Other slots that would describe the market again (the valuation slot, the Discovery Gap's reason) point here with
 * "see market" instead of restating it: on /project/budgetpuff one market read six ways.
 *
 * The label never contradicts the figures beside it (Terminal redesign, 2026-09-26, spec §6 C4). `INSUFFICIENT_DATA`
 * means HEY has not classified the market — not that it holds no reading:
 *  - a specific reason (readings that disagree, a launch pool) says the readings are not confirmed;
 *  - with two priced daily closes the chart draws candles, so it is the classification that has not caught up
 *    ("Not measured — not classified yet");
 *  - with only a current reading, it is the daily history that is short ("Not measured — daily history too short");
 *  - with nothing at all, the plain label.
 * Without `facts` the label is the status and reason alone (`tokenMarketStatusLabel`). The sentence is the label and
 * the classifier's reason as a clause ("Active market: the pool holds liquidity and the token traded in the last day.").
 */
export function marketWords(status: TokenMarketStatusValue, reason?: string | null, facts?: Omit<MarketFacts, 'reason'>): { label: string; sentence: string } {
  const label = facts ? refinedMarketLabel(status, reason, facts) : tokenMarketStatusLabel(status, reason);
  const clause = reason ? (TOKEN_MARKET_REASON_WORDS as Readonly<Record<string, string>>)[reason] : undefined;
  return { label, sentence: clause ? `${label}: ${clause}.` : `${label}.` };
}

function refinedMarketLabel(status: TokenMarketStatusValue, reason: string | null | undefined, facts: Omit<MarketFacts, 'reason'>): string {
  if (reason === NOT_FUNGIBLE_REASON || reason === READING_NOT_CURRENT_REASON) return tokenMarketStatusLabel(status, reason);
  if (status === 'INSUFFICIENT_DATA' && !isUnconfirmedMarketReason(reason)) {
    if ((facts.pricedDays ?? 0) >= 2) return NOT_CLASSIFIED_YET_LABEL;
    if (facts.hasCurrentReading) return DAILY_HISTORY_TOO_SHORT_LABEL;
  }
  return tokenMarketStatusLabel(status, reason);
}

/** `marketWords`' label, from the facts with their reason: the Terminal's and the summary's call shape. */
export function marketStatusWords(status: TokenMarketStatusValue, facts: MarketFacts): string {
  return marketWords(status, facts.reason, facts).label;
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
  // Above $1 (2026-10-22, full audit BL-6): the classifier reads a decoded day of $1 or less as no trading, and the payload
  // beside this clause can show such a dust volume (cyberia: $0.10 on 2026-10-22).
  no_trades_24h: 'HEY decoded no trading above $1 of the token on chain in the last day',
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
  volume_unknown: 'the pool holds liquidity, but no reading from the last 36 hours reports how much traded',
  liquidity_not_current: 'the token traded in the last day, but the newest reading of its pool’s liquidity is more than 7 days old',
};

/** "Active market: the pool holds liquidity and the token traded in the last day." `marketWords`' sentence. */
export function tokenMarketReasonSentence(status: TokenMarketStatusValue, reason: string | null | undefined): string {
  return marketWords(status, reason).sentence;
}
