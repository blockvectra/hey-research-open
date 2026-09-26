import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  classifyTokenMarket,
  DEAD_MARKET_REASONS,
  DEAD_MARKET_STATUSES,
  liquidityImplausible,
  marketFiguresBelievable,
  marketIsLive,
  secondReadingBelievable,
  TOKEN_MARKET,
  TOKEN_MARKET_REASONS,
  type TokenMarketStatusValue,
} from './token-market';

const now = new Date('2026-09-25T08:00:00Z');

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
 * Readings HEY will not believe (adversarial audit, 2026-09-25). The figures
 * are production's, read the same morning.
 */
describe('token market: readings HEY will not believe', () => {
  // farmmi-inc: DEX Screener reads a dead pool at $0.002909; GeckoTerminal reads
  // another pool at 31× that price, whose $394K is the pool's own supply at that price.
  const farmmiLatest = { observedAt: hoursAgo(0.3), liquidityUsd: 89.85, volume24hUsd: 14.67, fdvUsd: 108_904, priceUsd: 0.002909 };
  const farmmiOther = { observedAt: hoursAgo(0.5), liquidityUsd: 394_284, volume24hUsd: 16.75, priceUsd: 0.0914 };

  it('does not let a pool priced 31× away rescue a drained market (A10-02)', () => {
    const farmmi = classifyTokenMarket({ now, latest: farmmiLatest, ...removed(1_980_555), otherPools: farmmiOther });
    expect(farmmi).toMatchObject({ status: 'LIQUIDITY_REMOVED', reason: 'liquidity_gone_after_market' });
    expect(marketIsLive(farmmi.status, farmmi.reason)).toBe(false);
  });

  it('asks a second reading shaped like the token\'s own supply for volume in proportion to it, not $1', () => {
    // No price on the other reading: the valuation rules still refuse $16.75 of volume vouching for $394K.
    const { priceUsd: _price, ...noPrice } = farmmiOther;
    expect(classifyTokenMarket({ now, latest: farmmiLatest, ...removed(1_980_555), otherPools: noPrice }).status).toBe('LIQUIDITY_REMOVED');
    // The same pool trading a real share of what it holds is a market.
    expect(
      classifyTokenMarket({ now, latest: farmmiLatest, ...removed(1_980_555), otherPools: { ...noPrice, volume24hUsd: 5_000 } }),
    ).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' });
    expect(secondReadingBelievable({ liquidityUsd: 394_284, volume24hUsd: 394.28 }, { fdvUsd: 108_904 })).toBe(false);
    expect(secondReadingBelievable({ liquidityUsd: 394_284, volume24hUsd: 395 }, { fdvUsd: 108_904 })).toBe(true);
  });

  it('holds a second reading\'s price within a bounded factor of the reference, preferring HEY\'s chain price', () => {
    const reference = { priceUsd: 1, fdvUsd: 1_000_000 };
    expect(secondReadingBelievable({ liquidityUsd: 20_000, priceUsd: 2.9 }, reference)).toBe(true);
    expect(secondReadingBelievable({ liquidityUsd: 20_000, priceUsd: 0.35 }, reference)).toBe(true);
    expect(secondReadingBelievable({ liquidityUsd: 20_000, priceUsd: 3.1 }, reference)).toBe(false);
    expect(secondReadingBelievable({ liquidityUsd: 20_000, priceUsd: 0.3 }, reference)).toBe(false);
    // Nothing to compare is not a refusal.
    expect(secondReadingBelievable({ liquidityUsd: 20_000 }, reference)).toBe(true);
    expect(secondReadingBelievable({ liquidityUsd: 20_000, priceUsd: 50 }, {})).toBe(true);

    // The current reading follows a dead pool priced 4× too low (Priviet); HEY's decoded
    // trade close agrees with the live pool, so the live pool rescues the market.
    const latest = { observedAt: hoursAgo(0.2), liquidityUsd: 1.04, volume24hUsd: 0.44, fdvUsd: 4_800, priceUsd: 0.0000048 };
    const live = { observedAt: hoursAgo(0.4), liquidityUsd: 14_344, volume24hUsd: 10_600, priceUsd: 0.0000192 };
    expect(classifyTokenMarket({ now, latest, ...removed(48_000), otherPools: live }).status).toBe('LIQUIDITY_REMOVED');
    expect(classifyTokenMarket({ now, latest, ...removed(48_000), otherPools: live, chainPriceUsd: 0.00002 })).toMatchObject({
      status: 'ACTIVE_MARKET',
      reason: 'liquidity_in_another_pool',
    });
  });

  it('does not let HEY\'s pool index rescue a market with liquidity several times the token\'s valuation (A3-10)', () => {
    // A pool paired with another launch is valued at that launch's price, not this token's.
    const latest = { observedAt: hoursAgo(0.2), liquidityUsd: 3, volume24hUsd: 0, fdvUsd: 40_000 };
    const inflated = { observedAt: hoursAgo(3), liquidityUsd: 400_000, volume24hUsd: 9_000 };
    expect(classifyTokenMarket({ now, latest, ...removed(48_000), otherPools: inflated }).status).toBe('LIQUIDITY_REMOVED');
    // Within the bound, and trading, the index still rescues (clan-tech, $36K beside a live pool).
    expect(
      classifyTokenMarket({ now, latest, ...removed(48_000), otherPools: { ...inflated, liquidityUsd: 36_000 } }),
    ).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' });
  });

  it('calls a large pool that nobody trades and the chain index cannot find implausible (A10-03)', () => {
    // blorb: $22.4M "liquidity" at a $224M FDV, $53 of volume, HEY's index $5.24 the day before.
    const blorb = { observedAt: hoursAgo(0.5), liquidityUsd: 22_387_333, volume24hUsd: 53, fdvUsd: 223_841_697 };
    const index = { observedAt: hoursAgo(20), liquidityUsd: 5.24 };
    const implausible = classifyTokenMarket({ now, latest: blorb, peakLiquidityUsd: 25_000_000, chainIndex: index });
    expect(implausible).toEqual({ status: 'INSUFFICIENT_DATA', reason: 'readings_implausible' });
    expect(marketIsLive(implausible.status, implausible.reason)).toBe(false);
    expect(marketFiguresBelievable(implausible.reason)).toBe(false);
    // The index agreeing is a market.
    expect(classifyTokenMarket({ now, latest: blorb, peakLiquidityUsd: 25_000_000, chainIndex: { ...index, liquidityUsd: 21_000_000 } }).status).toBe('ACTIVE_MARKET');
    // Trading a real share of it is a market, whatever the index says: the index under-reads some real markets.
    expect(classifyTokenMarket({ now, latest: { ...blorb, volume24hUsd: 28_000 }, peakLiquidityUsd: 25_000_000, chainIndex: index }).status).toBe('ACTIVE_MARKET');
    // Unknown volume decides nothing.
    expect(liquidityImplausible(22_387_333, undefined, index, now)).toBe(false);
  });

  it('calls liquidity the chain index agrees on implausible when almost none of it is sellable (M1 G1, 2026-09-26)', () => {
    // blorb, 2026-09-26: $13.76M claimed, the index agrees on liquidity, $6.20 of one-per-cent depth, $368 of volume.
    const blorb = { observedAt: hoursAgo(0.5), liquidityUsd: 13_763_338.81, volume24hUsd: 368.04, fdvUsd: 137_608_415 };
    const index = { observedAt: hoursAgo(5), liquidityUsd: 13_736_350, depthOnePctUsd: 6.199893 };
    const verdict = classifyTokenMarket({ now, latest: blorb, peakLiquidityUsd: 25_000_000, chainIndex: index });
    expect(verdict).toEqual({ status: 'INSUFFICIENT_DATA', reason: 'readings_implausible' });
    expect(marketFiguresBelievable(verdict.reason)).toBe(false);
    // A depth read in the last week still counts; one older does not decide.
    expect(liquidityImplausible(13_763_338.81, 368.04, { ...index, observedAt: hoursAgo(6 * 24) }, now)).toBe(true);
    expect(liquidityImplausible(13_763_338.81, 368.04, { ...index, observedAt: hoursAgo(8 * 24) }, now)).toBe(false);
    // Depth in proportion to the pool is a market: a constant-product pool sells about 0.25 % of its liquidity per 1 %.
    expect(classifyTokenMarket({ now, latest: blorb, peakLiquidityUsd: 25_000_000, chainIndex: { ...index, depthOnePctUsd: 30_000 } }).status).toBe('ACTIVE_MARKET');
    // Trading a real share of the pool is a market whatever the depth reads.
    expect(liquidityImplausible(13_763_338.81, 50_000, index, now)).toBe(false);
    // An unread depth decides nothing, and neither does unknown volume.
    const { depthOnePctUsd: _depth, ...noDepth } = index;
    expect(liquidityImplausible(13_763_338.81, 368.04, noDepth, now)).toBe(false);
    expect(liquidityImplausible(13_763_338.81, undefined, index, now)).toBe(false);
    // Under the $25K floor nothing is implausible.
    expect(liquidityImplausible(20_000, 0, { observedAt: hoursAgo(1), liquidityUsd: 20_000, depthOnePctUsd: 0 }, now)).toBe(false);
  });

  it('needs a stronger contradiction when the chain index has no fresh reading', () => {
    const stale = { observedAt: hoursAgo(72), liquidityUsd: 5 };
    // $22M with $53 of trading is past even the uncorroborated line ($10 per $1M).
    expect(liquidityImplausible(22_387_333, 53, stale, now)).toBe(true);
    expect(liquidityImplausible(22_387_333, 53, undefined, now)).toBe(true);
    // An untraded $19M pool under the own-supply line (ebess-4) is not a market either.
    expect(liquidityImplausible(19_270_971, 0, undefined, now)).toBe(true);
    // A quiet $1M pool with $500 of trading is left alone, and so is anything under $1M.
    expect(liquidityImplausible(1_000_000, 500, undefined, now)).toBe(false);
    expect(liquidityImplausible(900_000, 0, undefined, now)).toBe(false);
    // With the index: $25K is the floor.
    expect(liquidityImplausible(24_000, 0, { observedAt: hoursAgo(1), liquidityUsd: 1 }, now)).toBe(false);
    expect(liquidityImplausible(30_000, 2, { observedAt: hoursAgo(1), liquidityUsd: 5 }, now)).toBe(true);
  });

  it('lets a newer drained index reading end a disagreement an older pool reading started (A10-05)', () => {
    // cash-shaq: GeckoTerminal $100.76 today, DEX Screener $5,292 on 09-19 before the drain, the index $0.99 on 09-23.
    const latest = { observedAt: hoursAgo(1), liquidityUsd: 100.76, volume24hUsd: 0 };
    const before = { observedAt: hoursAgo(6 * 24), liquidityUsd: 5_291.67, volume24hUsd: 400 };
    const disagree = classifyTokenMarket({ now, latest, ...removed(5_291.67), recentOtherPools: before });
    expect(disagree).toMatchObject({ status: 'INSUFFICIENT_DATA', reason: 'pool_readings_disagree' });
    // "Claims neither", so no badge rests on it.
    expect(marketIsLive(disagree.status, disagree.reason)).toBe(false);

    const settled = classifyTokenMarket({ now, latest, ...removed(5_291.67), recentOtherPools: before, chainIndex: { observedAt: hoursAgo(2 * 24), liquidityUsd: 0.99 } });
    expect(settled).toMatchObject({ status: 'LIQUIDITY_REMOVED', reason: 'liquidity_far_below_peak' });
    // An index reading older than the pool reading settles nothing.
    expect(
      classifyTokenMarket({ now, latest, ...removed(5_291.67), recentOtherPools: before, chainIndex: { observedAt: hoursAgo(7 * 24), liquidityUsd: 0.99 } }).reason,
    ).toBe('pool_readings_disagree');
    // Nor does one that still sees a market.
    expect(
      classifyTokenMarket({ now, latest, ...removed(5_291.67), recentOtherPools: before, chainIndex: { observedAt: hoursAgo(2 * 24), liquidityUsd: 6_000 } }).reason,
    ).toBe('pool_readings_disagree');
  });
});

describe('token market: one vocabulary of reasons', () => {
  it('lists every reason the classifier can write', () => {
    const source = readFileSync(new URL('./token-market.ts', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('export function classifyTokenMarket'), source.indexOf('export function marketIsLive'));
    const written = new Set([...body.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]!).filter((word) => word.includes('_') && word === word.toLowerCase()));
    expect([...written].sort()).toEqual([...TOKEN_MARKET_REASONS].sort());
  });

  it('refuses exactly the listed statuses and reasons, whatever they are paired with', () => {
    const statuses: TokenMarketStatusValue[] = ['ACTIVE_MARKET', 'LOW_LIQUIDITY', 'NO_LIQUIDITY', 'TRADING_INACTIVE', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED', 'INSUFFICIENT_DATA'];
    for (const reason of DEAD_MARKET_REASONS) expect(TOKEN_MARKET_REASONS).toContain(reason);
    for (const status of statuses) {
      for (const reason of [...TOKEN_MARKET_REASONS, null]) {
        const dead = (DEAD_MARKET_STATUSES as readonly string[]).includes(status) || (reason !== null && (DEAD_MARKET_REASONS as readonly string[]).includes(reason));
        expect(marketIsLive(status, reason)).toBe(!dead);
      }
    }
  });
});
