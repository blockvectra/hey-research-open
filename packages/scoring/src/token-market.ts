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
  /*
   * Readings HEY will not believe (2026-09-25).
   *
   * A second reading — another pool's, or HEY's own chain index — can overrule
   * the current one only if it describes the same token's market. One whose
   * price is more than `maxPriceRatio` away from the reference price (HEY's
   * decoded trade close when it has one, the current reading's price
   * otherwise) is another market: farmmi-inc was "Active market" on a
   * GeckoTerminal pool priced 31× DEX Screener's.
   */
  maxPriceRatio: 3,
  /**
   * A pool, or the index, cannot hold more than this many times the token's
   * whole valuation: both sides of a pool are worth about twice the token side
   * at most, and the price factor above is the slack. More than that is a
   * pool valued by what it is paired with (another launch at its own price).
   */
  maxLiquidityOfFdv: 6,
  /**
   * A second reading shaped like the token's own supply (liquidity at least
   * `ownSupplyShareOfFdv` of the valuation) is a market only if the day's
   * volume is at least this share of the liquidity it claims — a flat $1
   * let $16.75 of volume vouch for $394K.
   */
  minOwnSupplyTurnover: 0.001,
  /**
   * The current reading itself is implausible when it claims at least
   * `implausibleMinLiquidityUsd`, the day's volume is at most
   * `implausibleMaxTurnover` of it, and HEY's chain index — read in the last
   * `implausibleIndexMaxAgeDays` — holds at most `implausibleIndexShare` of it.
   * blorb: $22.4M "liquidity", $53 of volume, $5 in the index.
   */
  implausibleMinLiquidityUsd: 25_000,
  implausibleMaxTurnover: 0.0001,
  implausibleIndexShare: 0.001,
  implausibleIndexMaxAgeDays: 2,
  /**
   * Without an index reading, only a stronger contradiction: at least $1M
   * claimed and at most a thousandth of a per cent of it traded in a day
   * ($10 per $1M). The index under-reads some real markets (audit A10-04), so
   * it corroborates here and never decides alone.
   */
  implausibleUncorroboratedMinLiquidityUsd: 1_000_000,
  implausibleUncorroboratedMaxTurnover: 0.00001,
  /**
   * The chain's own depth contradicts the figure (2026-09-26, audit M1 G1).
   * A pool of both sides worth L can absorb a sale of roughly a quarter of a
   * per cent of L before the price moves one per cent; HEY's pool index
   * measures that sale across every pool as `depthOnePctUsd`. When the index
   * — read in the last `implausibleIndexMaxAgeDays` — finds at most this
   * share of the claimed liquidity sellable for a one per cent move, and the
   * day's volume is at most `implausibleMaxTurnover` of it, the figure is not
   * a market: blorb claimed $13.76M with $6.20 of depth and $368 of volume,
   * and the index's own liquidity agreed with the provider, so the index test
   * above could not see it. A thousandth of the expected depth, so a thin
   * concentrated pool is not caught; an unread depth decides nothing.
   */
  implausibleDepthShare: 0.00001,
  /** The depth reading's age limit: the index HEY's market-status sweep reads reaches back a week. */
  implausibleDepthMaxAgeDays: 7,
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
    /** The same reading's price: the reference a second reading's price is held to. */
    priceUsd?: number;
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
  otherPools?: SecondReading;
  /**
   * The deepest such reading in the last seven days (2026-09-25). When the
   * current reading's pool is empty and no other pool was read today, but one
   * held a market within the week, HEY holds two readings that disagree and
   * says so, instead of either claim.
   */
  recentOtherPools?: SecondReading;
  /**
   * HEY's own chain pool index, its newest day (2026-09-25): liquidity across
   * every pool the token has state in. It corroborates or contradicts a
   * provider's figure; a newer drained index reading also outranks an older
   * pool reading that still showed a market.
   */
  chainIndex?: ChainIndexReading;
  /** HEY's decoded trade close in the last two days: the preferred reference price. */
  chainPriceUsd?: number;
};

/**
 * HEY's chain pool index, its newest day: liquidity across every pool, and
 * — where the index measured it — how much of the token can be sold for a
 * one per cent price move, in USD (`token_pool_days.depth_one_pct_usd`).
 */
export type ChainIndexReading = { observedAt: Date; liquidityUsd: number; depthOnePctUsd?: number };

/** A reading other than the current one: another pool's, or the chain index's. */
export type SecondReading = { observedAt: Date; liquidityUsd: number; volume24hUsd?: number; priceUsd?: number };

/**
 * Whether a second reading describes this token's market at all (2026-09-25),
 * judged against the reference price and valuation. Three refusals: a price
 * more than `maxPriceRatio` off; liquidity beyond `maxLiquidityOfFdv` times
 * the valuation; and the token's own supply valued at its price, unless the
 * day's volume is a real share of it. What cannot be compared is not refused:
 * a reading with no price is held to the valuation rules alone.
 *
 * The SQL in `@hey/domain` (`tokens/market-status.ts`) filters each pool by
 * the same rules before choosing the deepest; this is the rule it mirrors.
 */
export function secondReadingBelievable(
  reading: Pick<SecondReading, 'liquidityUsd' | 'volume24hUsd' | 'priceUsd'>,
  reference: { priceUsd?: number | undefined; fdvUsd?: number | undefined },
): boolean {
  const { priceUsd } = reading;
  const refPrice = reference.priceUsd;
  if (priceUsd !== undefined && priceUsd > 0 && refPrice !== undefined && refPrice > 0) {
    const ratio = priceUsd > refPrice ? priceUsd / refPrice : refPrice / priceUsd;
    if (ratio > TOKEN_MARKET.maxPriceRatio) return false;
  }
  const fdv = reference.fdvUsd;
  if (fdv !== undefined && fdv > 0) {
    if (reading.liquidityUsd > fdv * TOKEN_MARKET.maxLiquidityOfFdv) return false;
    if (reading.liquidityUsd >= fdv * TOKEN_MARKET.ownSupplyShareOfFdv) {
      const needed = Math.max(TOKEN_MARKET.inactiveVolumeUsd, reading.liquidityUsd * TOKEN_MARKET.minOwnSupplyTurnover);
      if ((reading.volume24hUsd ?? 0) <= needed) return false;
    }
  }
  return true;
}

/**
 * Whether the current reading's liquidity is a figure HEY will not believe
 * (2026-09-25): a large pool the day's trading and HEY's own chain index both
 * contradict. Volume unknown decides nothing.
 */
export function liquidityImplausible(
  liquidityUsd: number,
  volume24hUsd: number | undefined,
  chainIndex: ChainIndexReading | undefined,
  now: Date,
): boolean {
  if (volume24hUsd === undefined || liquidityUsd < TOKEN_MARKET.implausibleMinLiquidityUsd) return false;
  const indexFresh = chainIndex !== undefined && now.getTime() - chainIndex.observedAt.getTime() <= TOKEN_MARKET.implausibleIndexMaxAgeDays * DAY_MS;
  const untraded = volume24hUsd <= liquidityUsd * TOKEN_MARKET.implausibleMaxTurnover;
  // The index may agree on liquidity and still measure almost none of it as sellable (blorb, 2026-09-26).
  const depth = chainIndex?.depthOnePctUsd;
  const depthRecent = chainIndex !== undefined && now.getTime() - chainIndex.observedAt.getTime() <= TOKEN_MARKET.implausibleDepthMaxAgeDays * DAY_MS;
  if (untraded && depthRecent && depth !== undefined && Number.isFinite(depth) && depth >= 0 && depth <= liquidityUsd * TOKEN_MARKET.implausibleDepthShare) {
    return true;
  }
  if (indexFresh) {
    return untraded && chainIndex.liquidityUsd <= liquidityUsd * TOKEN_MARKET.implausibleIndexShare;
  }
  return liquidityUsd >= TOKEN_MARKET.implausibleUncorroboratedMinLiquidityUsd && volume24hUsd <= liquidityUsd * TOKEN_MARKET.implausibleUncorroboratedMaxTurnover;
}

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
   * A large pool nobody trades and HEY's chain index cannot find (2026-09-25):
   * the figure is not believed, so it is neither a live market nor a drain.
   */
  if (liquidityImplausible(latest.liquidityUsd, volume, evidence.chainIndex, now)) {
    return { status: 'INSUFFICIENT_DATA', reason: 'readings_implausible' };
  }

  /*
   * Another pool's figure is a market only if it describes this token's market
   * (adversarial review, 2026-09-25): not the token's own supply valued at its
   * last price — a single-sided launch pool beside a dead one "rescued" the
   * dead one — and not a pool priced several times away from the reference.
   */
  const reference = { priceUsd: evidence.chainPriceUsd ?? latest.priceUsd, fdvUsd: latest.fdvUsd };
  const other =
    evidence.otherPools &&
    now.getTime() - evidence.otherPools.observedAt.getTime() <= DAY_MS &&
    secondReadingBelievable(evidence.otherPools, reference)
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
  /*
   * Disagreement claims nothing either way, but it still needs a reading of
   * this token's market to disagree with (the same test as a rescue), and it
   * ends when HEY's chain index read the pools drained after that reading did
   * (2026-09-25): cash-shaq held "readings disagree" on a pool reading from
   * before the drain while the index had since read $0.99.
   */
  const recent = evidence.recentOtherPools;
  const index = evidence.chainIndex;
  const drainedSince =
    recent !== undefined && index !== undefined && index.observedAt.getTime() > recent.observedAt.getTime() && index.liquidityUsd < TOKEN_MARKET.lowLiquidityUsd;
  if (
    !heldElsewhere &&
    recent &&
    !drainedSince &&
    secondReadingBelievable(recent, reference) &&
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
  if ((DEAD_MARKET_STATUSES as readonly string[]).includes(status)) return false;
  return !(reason && (DEAD_MARKET_REASONS as readonly string[]).includes(reason));
}

/**
 * The statuses and reasons `marketIsLive` refuses, and the only list of them
 * (2026-09-25). The SQL twin is `deadMarketSql` in `@hey/domain`, generated
 * from these two arrays; a parity test runs both over every status and
 * reason. The SQL filter on listings once kept its own copy and treated
 * `launch_pool_volume_unknown` as live while the badges did not (617 pages).
 */
export const DEAD_MARKET_STATUSES = ['NO_LIQUIDITY', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED'] as const;
/**
 * Reasons that are not a live market whatever the status beside them:
 * - `launch_pool_no_trades`, `launch_pool_volume_unknown` — a launch pool's
 *   "liquidity" is the token's own supply, so no drawdown can be measured
 *   against it (2026-09-11, 2026-09-25);
 * - `pool_readings_disagree` — HEY claims neither a live market nor a drain,
 *   so no badge may rest on it either (2026-09-25);
 * - `readings_implausible` — the reading is one HEY does not believe
 *   (`liquidityImplausible`, 2026-09-25).
 */
export const DEAD_MARKET_REASONS = ['launch_pool_no_trades', 'launch_pool_volume_unknown', 'pool_readings_disagree', 'readings_implausible'] as const;

/**
 * Every reason the classifier can write, for vocabularies and parity tests.
 * Adding a reason to `classifyTokenMarket` without adding it here fails
 * `token-market.test.ts`.
 */
export const TOKEN_MARKET_REASONS = [
  'trades_observed',
  'no_trades_24h',
  'no_liquidity_reading',
  'no_recent_reading_after_market',
  'readings_stale',
  'no_readings',
  'liquidity_reading_stale_after_market',
  'launch_pool_trading',
  'launch_pool_volume_unknown',
  'launch_pool_no_trades',
  'readings_implausible',
  'liquidity_in_another_pool',
  'no_volume_24h',
  'pool_readings_disagree',
  'liquidity_gone_after_market',
  'no_liquidity',
  'liquidity_far_below_peak',
  'liquidity_below_threshold',
  'liquidity_and_volume',
] as const;

/**
 * Whether the current reading's figures may be printed, sorted or filtered on
 * (2026-09-25). A reading HEY does not believe keeps its price and volume —
 * facts the provider reported — but not the liquidity and valuation it
 * contradicted.
 */
export function marketFiguresBelievable(reason: string | null | undefined): boolean {
  return reason !== IMPLAUSIBLE_READING_REASON;
}

/** The reason a reading HEY does not believe carries (`liquidityImplausible`). */
export const IMPLAUSIBLE_READING_REASON = 'readings_implausible' as const;
