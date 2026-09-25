import { describe, expect, it } from 'vitest';

import { classifyTokenMarket, marketIsLive, TOKEN_MARKET } from './token-market';

const now = new Date('2026-09-11T00:00:00Z');
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);

describe('token market status', () => {
  it('reports nothing when nothing was read', () => {
    expect(classifyTokenMarket({ now })).toMatchObject({ status: 'INSUFFICIENT_DATA', reason: 'no_readings' });
  });

  it('is insufficient, not "no liquidity", when the only readings carry no liquidity figure', () => {
    expect(classifyTokenMarket({ now, latestObservedAt: at(1) })).toMatchObject({ status: 'INSUFFICIENT_DATA', reason: 'no_liquidity_reading' });
  });

  it('separates an active market from one with liquidity but no trades', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 6_200, volume24hUsd: 0 }, peakLiquidityUsd: 6_300 })).toMatchObject({ status: 'TRADING_INACTIVE' });
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 6_200, volume24hUsd: 340 }, peakLiquidityUsd: 6_300 })).toMatchObject({ status: 'ACTIVE_MARKET' });
    // A provider that does not report volume cannot say trading stopped.
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 6_200 }, peakLiquidityUsd: 6_300 })).toMatchObject({ status: 'ACTIVE_MARKET' });
  });

  it('calls a small pool low liquidity, and dust no liquidity', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 900, volume24hUsd: 5 }, peakLiquidityUsd: 1_000 })).toMatchObject({ status: 'LOW_LIQUIDITY' });
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 40, volume24hUsd: 0 }, peakLiquidityUsd: 60 })).toMatchObject({ status: 'NO_LIQUIDITY' });
  });

  it('says liquidity is no longer detected only when a real market existed before', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 0 }, peakLiquidityUsd: 48_000 })).toMatchObject({ status: 'LIQUIDITY_REMOVED', reason: 'liquidity_gone_after_market' });
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 2_000, volume24hUsd: 3 }, peakLiquidityUsd: 48_000 })).toMatchObject({ status: 'LIQUIDITY_REMOVED', reason: 'liquidity_far_below_peak' });
    // The same figures with no meaningful peak are just a small pool.
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 2_000, volume24hUsd: 3 }, peakLiquidityUsd: 2_500 })).toMatchObject({ status: 'LOW_LIQUIDITY' });
  });

  it('does not call a smaller market a removed one (2026-09-18)', () => {
    // $500K of depth with $2M traded that day is a market, whatever it once held.
    const smaller = classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 500_000, volume24hUsd: 2_000_000, fdvUsd: 50_000_000 }, peakLiquidityUsd: 6_000_000 });
    expect(smaller).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
    expect(marketIsLive(smaller.status, smaller.reason)).toBe(true);
    // Dust left of a real market is still a removal.
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 400, volume24hUsd: 0 }, peakLiquidityUsd: 50_000 })).toMatchObject({ status: 'LIQUIDITY_REMOVED', reason: 'liquidity_far_below_peak' });
    // $20K left of $500K sits under the ceiling: what a removal looks like.
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 20_000, volume24hUsd: 100 }, peakLiquidityUsd: 500_000 })).toMatchObject({ status: 'LIQUIDITY_REMOVED', reason: 'liquidity_far_below_peak' });
    expect(TOKEN_MARKET.removedMaxAbsoluteUsd).toBe(TOKEN_MARKET.lowLiquidityUsd * 5);
  });

  it('marks a market HEY can no longer read as abandoned only after it existed', () => {
    const old = at(TOKEN_MARKET.staleDays + 5);
    expect(classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 20_000, volume24hUsd: 10 }, latestObservedAt: old, peakLiquidityUsd: 20_000 })).toMatchObject({ status: 'MARKET_ABANDONED' });
    expect(classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 200, volume24hUsd: 0 }, latestObservedAt: old, peakLiquidityUsd: 200 })).toMatchObject({ status: 'INSUFFICIENT_DATA', reason: 'readings_stale' });
  });

  it('does not mistake a launch pool holding the token\'s own supply for a market', () => {
    // AgentOS on Clanker: reserve $42M, FDV $42M, no trades. That is the supply at its last price.
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 42_032_764, volume24hUsd: 0, fdvUsd: 41_998_844 }, peakLiquidityUsd: 42_032_764 })).toMatchObject({ status: 'TRADING_INACTIVE', reason: 'launch_pool_no_trades' });
    // The same pool with trades is a market, described by its trades rather than its "reserve".
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 42_032_764, volume24hUsd: 1_200, fdvUsd: 41_998_844 }, peakLiquidityUsd: 42_032_764 })).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'launch_pool_trading' });
    // A real pool is a small share of FDV.
    expect(classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 30_000, volume24hUsd: 500, fdvUsd: 1_000_000 }, peakLiquidityUsd: 30_000 })).toMatchObject({ status: 'ACTIVE_MARKET' });
  });

  it('never uses a word that judges the team', () => {
    const statuses = ['ACTIVE_MARKET', 'LOW_LIQUIDITY', 'NO_LIQUIDITY', 'TRADING_INACTIVE', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED', 'INSUFFICIENT_DATA'];
    for (const status of statuses) expect(status).not.toMatch(/RUG|SCAM|FRAUD|DEAD/);
  });

  it('knows which markets a drawdown can be measured against', () => {
    expect(marketIsLive(undefined)).toBe(true);
    expect(marketIsLive('ACTIVE_MARKET')).toBe(true);
    expect(marketIsLive('LOW_LIQUIDITY')).toBe(true);
    expect(marketIsLive('TRADING_INACTIVE', 'no_volume_24h')).toBe(true);
    expect(marketIsLive('TRADING_INACTIVE', 'launch_pool_no_trades')).toBe(false);
    expect(marketIsLive('NO_LIQUIDITY')).toBe(false);
    expect(marketIsLive('LIQUIDITY_REMOVED')).toBe(false);
    expect(marketIsLive('MARKET_ABANDONED')).toBe(false);
    expect(marketIsLive('INSUFFICIENT_DATA')).toBe(true);
  });

  it('judges a drain against every pool HEY can see, not one provider\'s pool (2026-09-25)', () => {
    // Priviet: the provider followed a dead v4 pool ($1.04) while the real pool held $14K.
    const priviet = classifyTokenMarket({
      now,
      latest: { observedAt: at(0), liquidityUsd: 1.04, volume24hUsd: 0.44 },
      peakLiquidityUsd: 48_000,
      otherPools: { observedAt: at(0.2), liquidityUsd: 14_344 },
      trades: { observedAt: at(0.2), volume24hUsd: 10_600 },
    });
    expect(priviet).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' });
    // A day-old other pool no longer speaks for today.
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 0 }, peakLiquidityUsd: 48_000, otherPools: { observedAt: at(2), liquidityUsd: 14_000 } }),
    ).toMatchObject({ status: 'LIQUIDITY_REMOVED' });
    // A live pool read three days ago and nothing since: the readings disagree, and HEY says so.
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 1 }, peakLiquidityUsd: 48_000, recentOtherPools: { observedAt: at(3), liquidityUsd: 14_000 } }),
    ).toMatchObject({ status: 'INSUFFICIENT_DATA', reason: 'pool_readings_disagree' });
    // A week and more: the drain stands.
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 1 }, peakLiquidityUsd: 48_000, recentOtherPools: { observedAt: at(8), liquidityUsd: 14_000 } }),
    ).toMatchObject({ status: 'LIQUIDITY_REMOVED' });
    // A small pool that trades is a market even when its liquidity is most of the FDV (Priviet: $14K beside a $19K valuation).
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 1, fdvUsd: 4_800 }, peakLiquidityUsd: 48_000, otherPools: { observedAt: at(0.3), liquidityUsd: 14_344, volume24hUsd: 10_600 } }),
    ).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' });
    // A launch pool's own supply beside the dead pool is not a market.
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 3, fdvUsd: 40_000 }, peakLiquidityUsd: 48_000, otherPools: { observedAt: at(0), liquidityUsd: 39_000 } }).status,
    ).toBe('LIQUIDITY_REMOVED');
    // Every pool drained: still a drain.
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 0 }, peakLiquidityUsd: 48_000, otherPools: { observedAt: at(0), liquidityUsd: 40 } }),
    ).toMatchObject({ status: 'LIQUIDITY_REMOVED' });
  });

  it('reads a launch pool with no volume figure as unknown, and counts the chain\'s trades (2026-09-25)', () => {
    const pool = { observedAt: at(0), liquidityUsd: 42_032_764, fdvUsd: 41_998_844 };
    const unknown = classifyTokenMarket({ now, latest: pool, peakLiquidityUsd: 42_032_764 });
    expect(unknown).toMatchObject({ status: 'INSUFFICIENT_DATA', reason: 'launch_pool_volume_unknown' });
    // Not a live market either: its reserve is its own supply (2026-09-25).
    expect(marketIsLive(unknown.status, unknown.reason)).toBe(false);
    // A pool reading of zero does not overrule $56 of decoded trades on the same day.
    expect(
      classifyTokenMarket({ now, latest: { ...pool, volume24hUsd: 0 }, peakLiquidityUsd: 42_032_764, trades: { observedAt: at(0.1), volume24hUsd: 56.26 } }),
    ).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'launch_pool_trading' });
  });
});
