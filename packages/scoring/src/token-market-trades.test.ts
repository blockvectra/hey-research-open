import { describe, expect, it } from 'vitest';

import { classifyTokenMarket, marketIsLive } from './token-market';

const now = new Date('2026-09-12T12:00:00Z');
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

  it('never lets a trade reading override a depth reading', () => {
    const classified = classifyTokenMarket({
      now,
      latest: { observedAt: hoursAgo(1), liquidityUsd: 12_000, volume24hUsd: 0, fdvUsd: 900_000 },
      trades: { observedAt: hoursAgo(1), volume24hUsd: 9_999 },
    });
    expect(classified).toEqual({ status: 'TRADING_INACTIVE', reason: 'no_volume_24h' });
  });
});
