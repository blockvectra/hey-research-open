/**
 * Token market status (2026-09-11).
 *
 * A project can be building while its token has no market, and a token can
 * trade while nobody builds. HEY keeps the two apart: activity status reads
 * ships and repositories, this reads HEY's own market snapshots, and neither
 * feeds the other. The thresholds are configuration, versioned with the rest
 * of scoring, and the words are observations: "liquidity no longer detected"
 * is a fact HEY saw, "rugged" is a verdict HEY does not make.
 */
export type TokenMarketStatusValue =
  | 'ACTIVE_MARKET'
  | 'LOW_LIQUIDITY'
  | 'NO_LIQUIDITY'
  | 'TRADING_INACTIVE'
  | 'LIQUIDITY_REMOVED'
  | 'MARKET_ABANDONED'
  | 'INSUFFICIENT_DATA';

export const TOKEN_MARKET = {
  /** Below this, liquidity is "low". */
  lowLiquidityUsd: 5_000,
  /** At or below this, liquidity is treated as none: dust left behind after a pool was drained. */
  dustLiquidityUsd: 100,
  /** "Removed" needs a real prior market: the tracked peak must have reached this. */
  removedMinPeakUsd: 5_000,
  /** … and today's liquidity must sit at or below this share of that peak. */
  removedShareOfPeak: 0.1,
  /** A 24h volume at or below this, on a reading that reports volume, is "trading inactive". */
  inactiveVolumeUsd: 1,
  /** A reading older than this no longer describes the market. */
  staleDays: 30,
  /**
   * A pool's reported liquidity that is at least this share of the token's
   * FDV is the token's own supply valued at its last price, not a market: a
   * single-sided launch pool nobody has traded reports its whole supply as
   * "reserve" (AgentOS on Clanker: $42M liquidity, $42M FDV, zero volume).
   */
  ownSupplyShareOfFdv: 0.5,
} as const;

export type TokenMarketEvidence = {
  /** The newest reading that carries liquidity, if any. */
  latest?: {
    observedAt: Date;
    liquidityUsd: number;
    /** Absent when the provider does not report volume. */
    volume24hUsd?: number;
    /** The token's FDV (or market cap) on the same reading, to catch own-supply "liquidity". */
    fdvUsd?: number;
  };
  /** The newest reading of any kind, to tell "stale" from "never read". */
  latestObservedAt?: Date;
  /** The highest liquidity HEY ever recorded for this token. */
  peakLiquidityUsd?: number;
  now: Date;
  /**
   * The newest trade reading (Market Lens, 2026-09-12): a decoded on-chain
   * trade record carries a day's volume but no pool depth, so it cannot
   * feed the liquidity rules above. It can still say whether anyone traded:
   * with no depth reading at all, trades in the last day make the market
   * active and none make it inactive. Never a substitute for a depth figure
   * when one exists.
   */
  trades?: { observedAt: Date; volume24hUsd: number };
};

export type TokenMarketClassification = {
  status: TokenMarketStatusValue;
  /** Machine key the page turns into a sentence. */
  reason: string;
};

const DAY_MS = 86_400_000;

export function classifyTokenMarket(evidence: TokenMarketEvidence): TokenMarketClassification {
  const { latest, peakLiquidityUsd = 0, now } = evidence;
  const hadMarket = peakLiquidityUsd >= TOKEN_MARKET.removedMinPeakUsd;
  const stale = (at: Date) => now.getTime() - at.getTime() > TOKEN_MARKET.staleDays * DAY_MS;

  if (!latest) {
    const trades = evidence.trades;
    if (trades && now.getTime() - trades.observedAt.getTime() <= DAY_MS) {
      return trades.volume24hUsd > TOKEN_MARKET.inactiveVolumeUsd
        ? { status: 'ACTIVE_MARKET', reason: 'trades_observed' }
        : { status: 'TRADING_INACTIVE', reason: 'no_trades_24h' };
    }
    if (evidence.latestObservedAt && !stale(evidence.latestObservedAt)) {
      return { status: 'INSUFFICIENT_DATA', reason: 'no_liquidity_reading' };
    }
    return hadMarket
      ? { status: 'MARKET_ABANDONED', reason: 'no_recent_reading_after_market' }
      : { status: 'INSUFFICIENT_DATA', reason: evidence.latestObservedAt ? 'readings_stale' : 'no_readings' };
  }

  if (stale(latest.observedAt)) {
    return hadMarket
      ? { status: 'MARKET_ABANDONED', reason: 'liquidity_reading_stale_after_market' }
      : { status: 'INSUFFICIENT_DATA', reason: 'readings_stale' };
  }

  const liquidity = latest.liquidityUsd;
  if (latest.fdvUsd !== undefined && latest.fdvUsd > 0 && liquidity >= latest.fdvUsd * TOKEN_MARKET.ownSupplyShareOfFdv) {
    // A launch pool still holding the supply: trades are the only market fact it carries.
    if (latest.volume24hUsd !== undefined && latest.volume24hUsd > TOKEN_MARKET.inactiveVolumeUsd) {
      return { status: 'ACTIVE_MARKET', reason: 'launch_pool_trading' };
    }
    return { status: 'TRADING_INACTIVE', reason: 'launch_pool_no_trades' };
  }
  if (liquidity <= TOKEN_MARKET.dustLiquidityUsd) {
    return hadMarket ? { status: 'LIQUIDITY_REMOVED', reason: 'liquidity_gone_after_market' } : { status: 'NO_LIQUIDITY', reason: 'no_liquidity' };
  }
  if (liquidity < TOKEN_MARKET.lowLiquidityUsd) {
    if (hadMarket && liquidity <= peakLiquidityUsd * TOKEN_MARKET.removedShareOfPeak) {
      return { status: 'LIQUIDITY_REMOVED', reason: 'liquidity_far_below_peak' };
    }
    return { status: 'LOW_LIQUIDITY', reason: 'liquidity_below_threshold' };
  }
  if (hadMarket && liquidity <= peakLiquidityUsd * TOKEN_MARKET.removedShareOfPeak) {
    return { status: 'LIQUIDITY_REMOVED', reason: 'liquidity_far_below_peak' };
  }
  if (latest.volume24hUsd !== undefined && latest.volume24hUsd <= TOKEN_MARKET.inactiveVolumeUsd) {
    return { status: 'TRADING_INACTIVE', reason: 'no_volume_24h' };
  }
  return { status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' };
}

/**
 * Whether a token's market is one a drawdown can be measured against
 * (2026-09-11). Still Building means verified activity through a market
 * decline; a token with no liquidity, a removed market, or a launch pool
 * nobody ever traded has no market to decline, so the badge would decorate
 * a dead token. Homepage rows use the same test to keep such projects off
 * the front door while their pages and Explore keep them, honestly labelled.
 */
export function marketIsLive(status: TokenMarketStatusValue | null | undefined, reason?: string | null): boolean {
  if (!status) return true; // no token: nothing to be dead
  if (status === 'NO_LIQUIDITY' || status === 'LIQUIDITY_REMOVED' || status === 'MARKET_ABANDONED') return false;
  if (status === 'TRADING_INACTIVE' && reason === 'launch_pool_no_trades') return false;
  return true;
}

/** The SQL-side twin of `marketIsLive`, for listing filters. */
export const DEAD_MARKET_STATUSES = ['NO_LIQUIDITY', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED'] as const;
export const DEAD_MARKET_REASONS = ['launch_pool_no_trades'] as const;
