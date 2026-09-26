import { describe, expect, it } from 'vitest';

import { classifyTokenMarket, marketIsLive, TOKEN_MARKET } from './token-market';

const now = new Date('2026-09-12T12:00:00Z');

/** A market held and measured drained (2026-09-27): what every removal needs besides the current figure. */
const removed = (heldUsd: number) => ({
  peakLiquidityUsd: heldUsd,
  heldLiquidityUsd: heldUsd,
  drain: {
    series: 'chain',
    heldUsd,
    levelUsd: Math.max(TOKEN_MARKET.dustLiquidityUsd, Math.min(TOKEN_MARKET.removedMaxAbsoluteUsd, heldUsd * TOKEN_MARKET.removedShareOfPeak)),
    since: new Date(now.getTime() - 3 * 86_400_000),
    lastAt: now,
    days: 3,
  },
});
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

/**
 * Trade readings without pool depth (Market Lens, 2026-09-12): a decoded
 * trade record says whether anyone traded, not how deep the pool is.
 */
describe('token market: trade readings', () => {
  it('reads a day with trades and no depth reading as an active market', () => {
    expect(classifyTokenMarket({ now, trades: { observedAt: hoursAgo(2), volume24hUsd: 340 } })).toEqual({ status: 'ACTIVE_MARKET', reason: 'trades_observed' });
    expect(marketIsLive('ACTIVE_MARKET', 'trades_observed')).toBe(true);
  });

  it('reads a day without trades as trading inactive, which is still a market', () => {
    expect(classifyTokenMarket({ now, trades: { observedAt: hoursAgo(2), volume24hUsd: 0 }, latestObservedAt: hoursAgo(2) })).toEqual({ status: 'TRADING_INACTIVE', reason: 'no_trades_24h' });
    expect(marketIsLive('TRADING_INACTIVE', 'no_trades_24h')).toBe(true);
  });

  it('ignores a trade reading older than a day and falls back to the depth rules', () => {
    expect(classifyTokenMarket({ now, trades: { observedAt: hoursAgo(30), volume24hUsd: 340 } })).toEqual({ status: 'INSUFFICIENT_DATA', reason: 'no_readings' });
  });

  it('lets a trade reading say trades happened, never what depth is (2026-09-25)', () => {
    // Before: the pool reading's zero won, and the page said "no trades" beside
    // the $9,999 HEY had decoded. Volume is a count of trades; either reading may state it.
    const classified = classifyTokenMarket({
      now,
      latest: { observedAt: hoursAgo(1), liquidityUsd: 12_000, volume24hUsd: 0, fdvUsd: 900_000 },
      trades: { observedAt: hoursAgo(1), volume24hUsd: 9_999 },
    });
    expect(classified).toEqual({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
    // Depth still comes only from the depth reading: trades do not rescue a drained pool.
    expect(
      classifyTokenMarket({ now, latest: { observedAt: hoursAgo(1), liquidityUsd: 0, volume24hUsd: 0 }, ...removed(50_000), trades: { observedAt: hoursAgo(1), volume24hUsd: 9_999 } }).status,
    ).toBe('LIQUIDITY_REMOVED');
  });
});
