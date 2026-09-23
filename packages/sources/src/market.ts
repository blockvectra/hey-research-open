/**
 * Normalized market context (PRD V4 section 29).
 *
 * Market data is cheap context, never a quality score and never an input to
 * activity status or HEY Build Momentum. Only the fields listed in PRD V4 12 are
 * carried; there are deliberately no holder, wallet or trader fields.
 */
export type MarketContext = {
  chainId?: number;
  tokenAddress: string;
  source: 'dexscreener' | 'geckoterminal';
  symbol?: string;
  name?: string;
  priceUsd?: number;
  /** Null-safe on purpose: market cap and FDV must stay distinguishable. */
  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  pairCreatedAt?: Date;
  /** Identifier of the pool/pair the figures came from. */
  pairAddress?: string;
  pairUrl?: string;
  /** The pool's protocol as the provider names it (`uniswap`, `uniswap-v4-robinhood-chain`); context, never identity. */
  venue?: string;
  /*
   * Trade counts and price moves the aggregators already report for the same
   * pool (2026-09-13): buys and sells in the last day, and the price change
   * over one, six and twenty-four hours in percent. Counts of trades, never
   * of the accounts behind them; context, never a ranking input.
   */
  buys24h?: number;
  sells24h?: number;
  priceChange1hPct?: number;
  priceChange6hPct?: number;
  priceChange24hPct?: number;
  /** Token artwork the provider serves — identity the project uploaded, never HEY's. */
  imageUrl?: string;
};

/**
 * When several pairs exist, use the one with the deepest trusted liquidity
 * (PRD V4 section 29). Never merge figures across pairs.
 */
export function pickDeepestLiquidity<T extends { liquidityUsd?: number }>(
  candidates: readonly T[],
): T | undefined {
  /*
   * A pool with no reported depth is not a deeper pool (2026-09-23).
   *
   * `(x ?? 0) > (best ?? 0)` with a strict comparison meant that when no pair
   * reported `liquidity.usd` — or when two tied, which a fresh launch does at
   * zero — the provider's array order decided the price. Measured against a
   * two-pair payload where neither reports depth, this returned the first
   * listed at $0.001 over the other at $0.9: a 900× error chosen by nothing.
   *
   * A pair that reports depth now always beats one that does not, and among
   * pairs that report none the answer is at least stable rather than
   * whatever order the provider happened to serialise.
   */
  return candidates.reduce<T | undefined>((best, candidate) => {
    if (!best) return candidate;
    const mine = candidate.liquidityUsd;
    const theirs = best.liquidityUsd;
    if (mine === undefined) return best;
    if (theirs === undefined) return candidate;
    return mine > theirs ? candidate : best;
  }, undefined);
}

/**
 * Add a figure up across every pool the provider listed for one token
 * (2026-09-14).
 *
 * HEY used to report only the deepest pool's liquidity and volume, labelled as
 * the token's. On PONS that read $5.87M against $24.53M across its pools, and
 * $2.91M of 24-hour volume against $64.86M — a reader who opened GeckoTerminal
 * saw a different product. Price, valuation and venue still come from the
 * deepest pool, which is the single most representative quote; depth and
 * volume are properties of the token's whole market and are summed.
 *
 * The sum is a floor, not a total: these endpoints cap the pools they list
 * (thirty, on DEX Screener), so a token with more pools than that is still
 * understated — by far less than one pool of many was.
 */
export function sumAcrossPools<T>(rows: readonly T[], pick: (row: T) => number | undefined): number | undefined {
  const values = rows.map(pick).filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined;
}

/** Parse a provider's numeric string without inventing a value. */
export function toNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
