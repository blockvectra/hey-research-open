import { describe, expect, it } from 'vitest';

import { marketStatusWords, READINGS_NOT_CONFIRMED_LABEL, TOKEN_MARKET_REASON_WORDS, tokenMarketStatusLabel, UNCONFIRMED_MARKET_REASONS } from './market-status-words';
import {
  classifyTokenMarket,
  DEAD_MARKET_REASONS,
  discoveryGapMarketMeasurable,
  LIQUIDITY_NOT_CURRENT_REASON,
  marketIsLive,
  TOKEN_MARKET,
  TOKEN_MARKET_REASONS,
  TOKEN_MARKET_RULES_VERSION,
} from './token-market';

/*
 * The full audit's market rulings (2026-10-16, founder delegation "kau buat
 * semua sekali"): #17 graduated Pons pools, #139 old depth readings. #134
 * (frozen volumes) and #138 (the sustained peak) are read by the sweep's SQL
 * and tested in `@hey/domain`'s market-status-2026-10-16 integration test.
 */
const now = new Date('2026-10-16T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const daysAgo = (days: number) => hoursAgo(days * 24);

describe('token-market-2026-10-16', () => {
  it('is the rules version', () => {
    expect(TOKEN_MARKET_RULES_VERSION).toBe('token-market-2026-10-16');
    expect(TOKEN_MARKET.activeLiquidityMaxDays).toBe(7);
    expect(TOKEN_MARKET.repeatedVolumeMaxHours).toBe(36);
  });
});

describe('a Pons launch that graduated into a two-sided pool is judged as a pool (ruling #17)', () => {
  // factor: graduated 2026-10-14 18:02 UTC with 4.2 ETH seeded; $16.0K liquidity on $29.2K FDV (55%).
  const graduatedAt = new Date('2026-10-14T18:02:00Z');
  const factor = { observedAt: hoursAgo(2), liquidityUsd: 16_000, volume24hUsd: 420, fdvUsd: 29_200 };

  it('was "Launch pool only" under the old rule, and still is without a graduation read', () => {
    expect(classifyTokenMarket({ now, latest: factor })).toEqual({ status: 'ACTIVE_MARKET', reason: 'launch_pool_trading' });
  });

  it('reads the ordinary thresholds on a reading taken after the graduation', () => {
    expect(classifyTokenMarket({ now, latest: factor, graduatedTwoSidedPoolAt: graduatedAt })).toEqual({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
    // A thin graduated pool is a low-liquidity market, not launch inventory.
    expect(classifyTokenMarket({ now, latest: { ...factor, liquidityUsd: 3_000, fdvUsd: 5_000 }, graduatedTwoSidedPoolAt: graduatedAt })).toMatchObject({
      status: 'LOW_LIQUIDITY',
      reason: 'liquidity_below_threshold',
    });
    // Nothing traded: an inactive market, not an untraded launch pool.
    expect(classifyTokenMarket({ now, latest: { ...factor, volume24hUsd: 0 }, graduatedTwoSidedPoolAt: graduatedAt })).toEqual({ status: 'TRADING_INACTIVE', reason: 'no_volume_24h' });
    // No volume read: unknown, as for any liquid market.
    expect(classifyTokenMarket({ now, latest: { observedAt: factor.observedAt, liquidityUsd: 16_000, fdvUsd: 29_200 }, graduatedTwoSidedPoolAt: graduatedAt })).toEqual({
      status: 'INSUFFICIENT_DATA',
      reason: 'volume_unknown',
    });
  });

  it('keeps a reading from before the graduation on the launch-pool test', () => {
    const curveReading = { ...factor, observedAt: new Date(graduatedAt.getTime() - 3_600_000) };
    expect(classifyTokenMarket({ now: new Date(graduatedAt.getTime() + 3_600_000), latest: curveReading, graduatedTwoSidedPoolAt: graduatedAt })).toEqual({
      status: 'ACTIVE_MARKET',
      reason: 'launch_pool_trading',
    });
  });

  it('only withholds or relabels through the measured-market test it already passes', () => {
    const graduated = classifyTokenMarket({ now, latest: factor, graduatedTwoSidedPoolAt: graduatedAt });
    expect(discoveryGapMarketMeasurable(graduated.status, 'GRADUATED', graduated.reason)).toBe(true);
    expect(discoveryGapMarketMeasurable('ACTIVE_MARKET', 'GRADUATED', 'launch_pool_trading')).toBe(false);
  });
});

describe('a depth reading older than a week makes no market active (ruling #139)', () => {
  // volt-inu: $209,135 read by DEX Screener on 2026-09-19, "Active market" on 2026-10-16 on fresh trades.
  const trades = { observedAt: hoursAgo(1), volume24hUsd: 3_100 };

  it('is liquidity_not_current past seven days, whatever trades vouch for it', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: daysAgo(27), liquidityUsd: 209_135 }, trades })).toEqual({
      status: 'INSUFFICIENT_DATA',
      reason: LIQUIDITY_NOT_CURRENT_REASON,
    });
    expect(classifyTokenMarket({ now, latest: { observedAt: daysAgo(7.1), liquidityUsd: 209_135, volume24hUsd: 50 }, trades })).toEqual({
      status: 'INSUFFICIENT_DATA',
      reason: LIQUIDITY_NOT_CURRENT_REASON,
    });
  });

  it('still lets a fresh trade record vouch for a depth reading inside the week (token-market-2026-10-03)', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: daysAgo(6.9), liquidityUsd: 209_135 }, trades })).toEqual({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
  });

  it('applies to a launch pool that traded too', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: daysAgo(9), liquidityUsd: 40_000, fdvUsd: 60_000 }, trades })).toEqual({
      status: 'INSUFFICIENT_DATA',
      reason: LIQUIDITY_NOT_CURRENT_REASON,
    });
  });

  it('leaves the statuses that are not an active market alone', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: daysAgo(9), liquidityUsd: 900 }, trades })).toMatchObject({ status: 'LOW_LIQUIDITY' });
    expect(classifyTokenMarket({ now, latest: { observedAt: daysAgo(9), liquidityUsd: 40_000 }, trades: { ...trades, volume24hUsd: 0 } })).toEqual({
      status: 'TRADING_INACTIVE',
      reason: 'no_volume_24h',
    });
    // Past the 30-day line the dead-market rule still decides.
    expect(classifyTokenMarket({ now, latest: { observedAt: daysAgo(31), liquidityUsd: 40_000 }, trades, peakLiquidityUsd: 40_000 })).toEqual({
      status: 'MARKET_ABANDONED',
      reason: 'liquidity_reading_stale_after_market',
    });
  });

  it('is labelled "Readings not confirmed", live and not measured', () => {
    expect(TOKEN_MARKET_REASONS).toContain(LIQUIDITY_NOT_CURRENT_REASON);
    expect(UNCONFIRMED_MARKET_REASONS).toContain(LIQUIDITY_NOT_CURRENT_REASON);
    expect(DEAD_MARKET_REASONS as readonly string[]).not.toContain(LIQUIDITY_NOT_CURRENT_REASON);
    expect(tokenMarketStatusLabel('INSUFFICIENT_DATA', LIQUIDITY_NOT_CURRENT_REASON)).toBe(READINGS_NOT_CONFIRMED_LABEL);
    expect(READINGS_NOT_CONFIRMED_LABEL).toBe('Readings not confirmed');
    expect(marketStatusWords('INSUFFICIENT_DATA', { hasCurrentReading: true, pricedDays: 30, reason: LIQUIDITY_NOT_CURRENT_REASON })).toBe(READINGS_NOT_CONFIRMED_LABEL);
    expect(TOKEN_MARKET_REASON_WORDS[LIQUIDITY_NOT_CURRENT_REASON]).toMatch(/more than 7 days old/);
    expect(marketIsLive('INSUFFICIENT_DATA', LIQUIDITY_NOT_CURRENT_REASON)).toBe(true);
    expect(discoveryGapMarketMeasurable('INSUFFICIENT_DATA', 'DEX', LIQUIDITY_NOT_CURRENT_REASON)).toBe(false);
  });
});
