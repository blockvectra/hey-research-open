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
});
