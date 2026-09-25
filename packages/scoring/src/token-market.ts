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
  /** … and today's liquidity must sit at or below this share of that peak … */
  removedShareOfPeak: 0.1,
  /**
   * … and under this in absolute terms (2026-09-18): five times the low
   * threshold. The share test alone called a $500K pool with $2M of daily
   * volume "liquidity removed" because it had once held $6M — a smaller
   * market, not a drained one. Below the low-liquidity line the share test
   * still applies on its own; between the line and this ceiling it applies
   * too, since $20K left of a $500K pool is what a removal looks like; above
   * it, what remains is a market in its own right whatever the peak was.
   */
  removedMaxAbsoluteUsd: 25_000,
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
  /**
   * The deepest liquidity HEY saw in the last day in a pool *other* than the
   * one the latest reading describes, or across all pools in HEY's own chain
   * pool index (truthfulness audit, 2026-09-25). A provider that follows a
   * dead pool reads dust while the token's real pool holds $14K; judged on
   * that one reading, eleven tokens were publicly "liquidity no longer
   * detected" with a market still trading. A drain is only a drain when no
   * pool HEY can see still holds the market.
   */
  otherPools?: { observedAt: Date; liquidityUsd: number; volume24hUsd?: number };
  /**
   * The deepest such reading in the last seven days (2026-09-25). When the
   * current reading's pool is empty and no other pool was read today, but one
   * held a market within the week, HEY holds two readings that disagree and
   * says so, instead of either claim.
   */
  recentOtherPools?: { observedAt: Date; liquidityUsd: number };
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

  /*
   * The day's volume from every reading that has one (2026-09-25): the pool
   * reading's own figure, and a fresh decoded trade record, which counts
   * trades in every pool. The larger wins — "no trades" on a page that shows
   * $54 of volume beside it was the pool reading's zero overruling the chain.
   * Unknown stays unknown: neither reading reports volume → undefined.
   */
  const freshTrades = evidence.trades && now.getTime() - evidence.trades.observedAt.getTime() <= DAY_MS ? evidence.trades.volume24hUsd : undefined;
  const volume = latest.volume24hUsd === undefined ? freshTrades : freshTrades === undefined ? latest.volume24hUsd : Math.max(latest.volume24hUsd, freshTrades);

  if (latest.fdvUsd !== undefined && latest.fdvUsd > 0 && latest.liquidityUsd >= latest.fdvUsd * TOKEN_MARKET.ownSupplyShareOfFdv) {
    // A launch pool still holding the supply: trades are the only market fact it carries.
    if (volume !== undefined && volume > TOKEN_MARKET.inactiveVolumeUsd) {
      return { status: 'ACTIVE_MARKET', reason: 'launch_pool_trading' };
    }
    // No volume figure from any reading is not "no trades" (reconciliation row 1, 2026-09-25):
    // it was the dead-market reason, applied to ~650 launch pools HEY never saw a volume for.
    if (volume === undefined) return { status: 'INSUFFICIENT_DATA', reason: 'launch_pool_volume_unknown' };
    return { status: 'TRADING_INACTIVE', reason: 'launch_pool_no_trades' };
  }

  /*
   * Another pool's figure is a market only if it is not the token's own supply
   * valued at its last price (adversarial review, 2026-09-25): a single-sided
   * launch pool beside a dead one "rescued" the dead one.
   */
  const ownSupply = (liquidityUsd: number) =>
    latest.fdvUsd !== undefined && latest.fdvUsd > 0 && liquidityUsd >= latest.fdvUsd * TOKEN_MARKET.ownSupplyShareOfFdv;
  const other =
    evidence.otherPools && now.getTime() - evidence.otherPools.observedAt.getTime() <= DAY_MS && !ownSupply(evidence.otherPools.liquidityUsd)
      ? evidence.otherPools.liquidityUsd
      : undefined;
  const heldElsewhere = other !== undefined && other > latest.liquidityUsd;
  const liquidity = heldElsewhere ? other : latest.liquidityUsd;
  if (heldElsewhere && latest.liquidityUsd < TOKEN_MARKET.lowLiquidityUsd && liquidity >= TOKEN_MARKET.lowLiquidityUsd) {
    // The reading's own pool is thin or empty; another pool holds the market, and its volume counts too.
    const otherVolume = evidence.otherPools?.volume24hUsd;
    const pooled = otherVolume === undefined ? volume : volume === undefined ? otherVolume : Math.max(volume, otherVolume);
    if (pooled !== undefined && pooled <= TOKEN_MARKET.inactiveVolumeUsd) return { status: 'TRADING_INACTIVE', reason: 'no_volume_24h' };
    return { status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' };
  }
  const recent = evidence.recentOtherPools && !ownSupply(evidence.recentOtherPools.liquidityUsd) ? evidence.recentOtherPools : undefined;
  if (
    !heldElsewhere &&
    recent &&
    now.getTime() - recent.observedAt.getTime() <= 7 * DAY_MS &&
    recent.liquidityUsd >= TOKEN_MARKET.lowLiquidityUsd &&
    latest.liquidityUsd < TOKEN_MARKET.lowLiquidityUsd &&
    hadMarket
  ) {
    return { status: 'INSUFFICIENT_DATA', reason: 'pool_readings_disagree' };
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
  if (
    hadMarket &&
    liquidity <= TOKEN_MARKET.removedMaxAbsoluteUsd &&
    liquidity <= peakLiquidityUsd * TOKEN_MARKET.removedShareOfPeak
  ) {
    return { status: 'LIQUIDITY_REMOVED', reason: 'liquidity_far_below_peak' };
  }
  if (volume !== undefined && volume <= TOKEN_MARKET.inactiveVolumeUsd) {
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
  // A launch pool nobody reports volume for is not yet a market either (2026-09-25): its
  // "liquidity" is the token's own supply, so no drawdown can be measured against it.
  if (reason === 'launch_pool_volume_unknown') return false;
  return true;
}

/** The SQL-side twin of `marketIsLive`, for listing filters. */
export const DEAD_MARKET_STATUSES = ['NO_LIQUIDITY', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED'] as const;
export const DEAD_MARKET_REASONS = ['launch_pool_no_trades', 'launch_pool_volume_unknown'] as const;
