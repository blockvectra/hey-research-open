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
  return candidates.reduce<T | undefined>((best, candidate) => {
    if (!best) return candidate;
    return (candidate.liquidityUsd ?? 0) > (best.liquidityUsd ?? 0) ? candidate : best;
  }, undefined);
}

/** Parse a provider's numeric string without inventing a value. */
export function toNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
