import type { TokenMarketStatusValue } from './token-market';

/**
 * The token market statuses in words: one table for the card, the project
 * page, the Terminal header and chart, and the Research Summary (`@hey/ui`'s
 * `tokenMarketLabel` and the domain's `SUMMARY_MARKET_WORDS` read this).
 */
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
  if (status === 'INSUFFICIENT_DATA') {
    if (facts.reason && (UNCONFIRMED_MARKET_REASONS as readonly string[]).includes(facts.reason)) return 'Readings not confirmed';
    if ((facts.pricedDays ?? 0) >= 2) return 'Not classified yet';
    if (facts.hasCurrentReading) return 'Daily history too short; current reading available';
  }
  return TOKEN_MARKET_LABELS[status] ?? TOKEN_MARKET_LABELS.INSUFFICIENT_DATA;
}
