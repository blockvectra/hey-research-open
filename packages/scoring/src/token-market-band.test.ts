import { describe, expect, it } from 'vitest';

import { classifyTokenMarket, TOKEN_MARKET, type DrainEvidence, type TokenMarketStatusValue } from './token-market';

/*
 * The LOW_LIQUIDITY band (founder decision, 2026-09-30): enter below $5,000,
 * leave only at $6,000 or more. One threshold made a pool hovering at $5K
 * flap between LOW_LIQUIDITY and ACTIVE_MARKET, and every flap was a public
 * change event.
 */
const now = new Date('2026-09-30T00:00:00Z');
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
const reading = (liquidityUsd: number, volume24hUsd = 250) => ({ observedAt: at(0), liquidityUsd, volume24hUsd });
const classify = (liquidityUsd: number, previousStatus?: TokenMarketStatusValue, volume24hUsd?: number) =>
  classifyTokenMarket({ now, latest: reading(liquidityUsd, volume24hUsd), peakLiquidityUsd: 7_000, ...(previousStatus ? { previousStatus } : {}) });
const drainOf = (heldUsd: number): DrainEvidence => ({
  series: 'pool:0x0000000000000000000000000000000000000001',
  heldUsd,
  levelUsd: Math.min(TOKEN_MARKET.removedMaxAbsoluteUsd, heldUsd * TOKEN_MARKET.removedShareOfPeak),
  since: at(2),
  lastAt: at(0),
  days: 2,
});

describe('LOW_LIQUIDITY band', () => {
  it('enters below $5,000 and leaves only at $6,000 or more', () => {
    expect(TOKEN_MARKET.lowLiquidityUsd).toBe(5_000);
    expect(TOKEN_MARKET.lowLiquidityExitUsd).toBe(6_000);
    // Entering: the line is where it always was, whatever the status before.
    expect(classify(4_999, 'ACTIVE_MARKET')).toMatchObject({ status: 'LOW_LIQUIDITY', reason: 'liquidity_below_threshold' });
    expect(classify(5_000, 'ACTIVE_MARKET')).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
    expect(classify(5_500)).toMatchObject({ status: 'ACTIVE_MARKET' });
    // Leaving: a market already low stays low inside the band …
    expect(classify(5_000, 'LOW_LIQUIDITY')).toMatchObject({ status: 'LOW_LIQUIDITY', reason: 'liquidity_below_exit_threshold' });
    expect(classify(5_999.99, 'LOW_LIQUIDITY')).toMatchObject({ status: 'LOW_LIQUIDITY', reason: 'liquidity_below_exit_threshold' });
    expect(classify(4_200, 'LOW_LIQUIDITY')).toMatchObject({ status: 'LOW_LIQUIDITY', reason: 'liquidity_below_threshold' });
    // … and leaves at the exit line, to whatever the volume says.
    expect(classify(6_000, 'LOW_LIQUIDITY')).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
    expect(classify(6_000, 'LOW_LIQUIDITY', 0)).toMatchObject({ status: 'TRADING_INACTIVE', reason: 'no_volume_24h' });
  });

  it('does not flap on a pool hovering at the threshold', () => {
    const path = [4_900, 5_100, 4_950, 5_400, 5_900, 6_050, 5_800, 5_100, 4_800];
    let previous: TokenMarketStatusValue | undefined;
    const banded = path.map((liquidityUsd) => {
      previous = classify(liquidityUsd, previous).status;
      return previous;
    });
    expect(banded).toEqual(['LOW_LIQUIDITY', 'LOW_LIQUIDITY', 'LOW_LIQUIDITY', 'LOW_LIQUIDITY', 'LOW_LIQUIDITY', 'ACTIVE_MARKET', 'ACTIVE_MARKET', 'ACTIVE_MARKET', 'LOW_LIQUIDITY']);
    const moves = (list: readonly string[]) => list.filter((status, index) => index > 0 && status !== list[index - 1]).length;
    // The same path on the entry line alone changed status four times.
    expect(moves(path.map((liquidityUsd) => classify(liquidityUsd).status))).toBe(4);
    expect(moves(banded)).toBe(2);
  });

  it('holds a rescue by another pool to the exit line too', () => {
    const base = { now, latest: reading(3_000), peakLiquidityUsd: 7_000, otherPools: { observedAt: at(0), liquidityUsd: 5_500, volume24hUsd: 120 } };
    expect(classifyTokenMarket(base)).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' });
    expect(classifyTokenMarket({ ...base, previousStatus: 'LOW_LIQUIDITY' })).toMatchObject({ status: 'LOW_LIQUIDITY', reason: 'liquidity_below_exit_threshold' });
    expect(
      classifyTokenMarket({ ...base, otherPools: { ...base.otherPools, liquidityUsd: 6_500 }, previousStatus: 'LOW_LIQUIDITY' }),
    ).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' });
  });

  it('keeps every neighbouring status on its own rule', () => {
    // Dust, a measured drain, a launch pool and a stale reading are judged as before, whatever the status was.
    expect(classify(40, 'LOW_LIQUIDITY')).toMatchObject({ status: 'NO_LIQUIDITY', reason: 'no_liquidity' });
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 2_000, volume24hUsd: 3 }, peakLiquidityUsd: 48_000, heldLiquidityUsd: 48_000, drain: drainOf(48_000), previousStatus: 'LOW_LIQUIDITY' }),
    ).toMatchObject({ status: 'LIQUIDITY_REMOVED', reason: 'liquidity_far_below_peak' });
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(0), liquidityUsd: 5_500, volume24hUsd: 10, fdvUsd: 6_000 }, previousStatus: 'LOW_LIQUIDITY' }),
    ).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'launch_pool_trading' });
    expect(
      classifyTokenMarket({ now, latest: { observedAt: at(TOKEN_MARKET.staleDays + 1), liquidityUsd: 5_500 }, peakLiquidityUsd: 7_000, previousStatus: 'LOW_LIQUIDITY' }),
    ).toMatchObject({ status: 'MARKET_ABANDONED' });
    // The band applies only on the way out of LOW_LIQUIDITY: from any other status $5,500 is an active market.
    for (const previousStatus of ['ACTIVE_MARKET', 'TRADING_INACTIVE', 'NO_LIQUIDITY', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED', 'INSUFFICIENT_DATA'] as const) {
      expect(classify(5_500, previousStatus)).toMatchObject({ status: 'ACTIVE_MARKET' });
    }
  });
});
