import { describe, expect, it } from 'vitest';

import { marketStatusWords, NOT_FUNGIBLE_LABEL, READING_NOT_CURRENT_LABEL, TOKEN_MARKET_REASON_WORDS, tokenMarketReasonSentence, tokenMarketStatusLabel } from './market-status-words';
import {
  classifyTokenMarket,
  DEAD_MARKET_REASONS,
  discoveryGapMarketMeasurable,
  marketIsLive,
  NOT_FUNGIBLE_REASON,
  READING_NOT_CURRENT_REASON,
  rescuedMarketVolume,
  TOKEN_MARKET,
  TOKEN_MARKET_REASONS,
  tokenIsFungible,
  tokenMarketDecidedVolume,
} from './token-market';
import { valuationDisplay } from './valuation-display';

const now = new Date('2026-10-03T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

describe('a token that is not fungible has no fungible market (2026-10-03, full audit)', () => {
  // sinjoh's PIGGY: YieldBankNFT, decimals 0, Seaport fills read as trades, "$69K via DEX (Seaport V1.4)".
  const piggy = {
    now,
    decimals: 0,
    trades: { observedAt: hoursAgo(1), volume24hUsd: 221.44 },
    latestObservedAt: hoursAgo(1),
  };

  it('classifies decimals 0 as not a fungible token, whatever the readings say', () => {
    expect(classifyTokenMarket(piggy)).toEqual({ status: 'INSUFFICIENT_DATA', reason: NOT_FUNGIBLE_REASON });
    expect(
      classifyTokenMarket({ now, decimals: 0, latest: { observedAt: hoursAgo(1), liquidityUsd: 40_000, volume24hUsd: 9_000, fdvUsd: 68_734 } }),
    ).toEqual({ status: 'INSUFFICIENT_DATA', reason: NOT_FUNGIBLE_REASON });
  });

  it('is a dead reason: no valuation, no Discovery Gap, no Still Building, no Under the Radar', () => {
    expect((DEAD_MARKET_REASONS as readonly string[]).includes(NOT_FUNGIBLE_REASON)).toBe(true);
    expect(marketIsLive('INSUFFICIENT_DATA', NOT_FUNGIBLE_REASON)).toBe(false);
    expect(discoveryGapMarketMeasurable('INSUFFICIENT_DATA', 'DEX', NOT_FUNGIBLE_REASON)).toBe(false);
    const display = valuationDisplay({ valueUsd: 68_734.72, fdvUsd: 68_734.72, marketStatus: 'INSUFFICIENT_DATA', marketReason: NOT_FUNGIBLE_REASON });
    expect(display).toEqual({ shown: false, state: 'no_active_market', reason: NOT_FUNGIBLE_REASON });
  });

  it('never trips on unknown decimals or on a fungible token', () => {
    expect(tokenIsFungible(undefined)).toBe(true);
    expect(tokenIsFungible(null)).toBe(true);
    expect(tokenIsFungible(18)).toBe(true);
    expect(tokenIsFungible(6)).toBe(true);
    expect(tokenIsFungible(0)).toBe(false);
    const { decimals: _dropped, ...unread } = piggy;
    expect(classifyTokenMarket(unread)).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'trades_observed' });
    expect(classifyTokenMarket({ ...unread, decimals: 18 })).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'trades_observed' });
  });

  it('says what the token is, never "Market data insufficient"', () => {
    expect(tokenMarketStatusLabel('INSUFFICIENT_DATA', NOT_FUNGIBLE_REASON)).toBe(NOT_FUNGIBLE_LABEL);
    expect(marketStatusWords('INSUFFICIENT_DATA', { hasCurrentReading: true, pricedDays: 30, reason: NOT_FUNGIBLE_REASON })).toBe(NOT_FUNGIBLE_LABEL);
  });
});

describe('a market status never reads current over a stale reading (2026-10-03, full audit)', () => {
  // ten0r: liquidity and volume read 2026-09-29, "Active market" evaluated 2026-10-03.
  const old = hoursAgo(87);

  it('does not call a market active, or inactive, on a reading older than the limit', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 40_000, volume24hUsd: 9_000 }, peakLiquidityUsd: 40_000 })).toEqual({
      status: 'INSUFFICIENT_DATA',
      reason: READING_NOT_CURRENT_REASON,
    });
    expect(classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 40_000, volume24hUsd: 0 }, peakLiquidityUsd: 40_000 })).toEqual({
      status: 'INSUFFICIENT_DATA',
      reason: READING_NOT_CURRENT_REASON,
    });
    // A launch pool's "trading" is a last-day claim too.
    expect(classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 40_000, volume24hUsd: 50, fdvUsd: 60_000 } })).toEqual({
      status: 'INSUFFICIENT_DATA',
      reason: READING_NOT_CURRENT_REASON,
    });
  });

  it('keeps the status inside the limit, and lets a fresh trade record vouch for an older depth reading', () => {
    const inside = hoursAgo(TOKEN_MARKET.currentReadingMaxHours - 1);
    expect(classifyTokenMarket({ now, latest: { observedAt: inside, liquidityUsd: 40_000, volume24hUsd: 9_000 } })).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
    expect(
      classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 40_000, volume24hUsd: 9_000 }, trades: { observedAt: hoursAgo(2), volume24hUsd: 700 } }),
    ).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
    expect(
      classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 40_000 }, trades: { observedAt: hoursAgo(2), volume24hUsd: 0 } }),
    ).toMatchObject({ status: 'TRADING_INACTIVE', reason: 'no_volume_24h' });
  });

  it('leaves statuses that are not a last-day claim alone', () => {
    expect(classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 900, volume24hUsd: 5 }, peakLiquidityUsd: 1_000 })).toMatchObject({ status: 'LOW_LIQUIDITY' });
    expect(classifyTokenMarket({ now, latest: { observedAt: old, liquidityUsd: 40, volume24hUsd: 0 }, peakLiquidityUsd: 60 })).toMatchObject({ status: 'NO_LIQUIDITY' });
  });

  it('is not dead, and not measured', () => {
    expect(marketIsLive('INSUFFICIENT_DATA', READING_NOT_CURRENT_REASON)).toBe(true);
    expect(discoveryGapMarketMeasurable('INSUFFICIENT_DATA', 'DEX', READING_NOT_CURRENT_REASON)).toBe(false);
    expect(marketStatusWords('INSUFFICIENT_DATA', { hasCurrentReading: true, pricedDays: 30, reason: READING_NOT_CURRENT_REASON })).toBe(READING_NOT_CURRENT_LABEL);
  });
});

describe('a rescued market prints no valuation from the thin pool (2026-10-03, full audit)', () => {
  it('withholds it as unconfirmed, with the rescue as the reason', () => {
    // atlantis-coin: $365.9B (CoinGecko), then $3.08B (on chain), beside the thin pool's $1,286.
    expect(valuationDisplay({ valueUsd: 3_081_073_765, fdvUsd: 3_081_073_765, marketStatus: 'ACTIVE_MARKET', marketReason: 'liquidity_in_another_pool' })).toEqual({
      shown: false,
      state: 'unconfirmed',
      reason: 'liquidity_in_another_pool',
    });
    // An ordinary active market is untouched.
    expect(valuationDisplay({ valueUsd: 3_000_000, marketStatus: 'ACTIVE_MARKET', marketReason: 'liquidity_and_volume' })).toMatchObject({ shown: true, usd: 3_000_000 });
  });
});

describe('a market rescued by another pool is held to the current-reading rule too (2026-10-22 rule-twin audit)', () => {
  // The token's own pool read five days ago, thin; HEY's chain pool index holds $40K today.
  const stale = {
    now,
    latest: { observedAt: hoursAgo(5 * 24), liquidityUsd: 900, volume24hUsd: 2_400, fdvUsd: 400_000, priceUsd: 0.0004 },
    latestObservedAt: hoursAgo(5 * 24),
    otherPools: { observedAt: hoursAgo(2), liquidityUsd: 40_000, series: 'chain' },
  };

  it('is not current when its volume came only from a reading older than currentReadingMaxHours', () => {
    expect(classifyTokenMarket(stale)).toEqual({ status: 'INSUFFICIENT_DATA', reason: READING_NOT_CURRENT_REASON });
    // The same as on its own pool: a five-day-old reading says nothing about the last day.
    expect(classifyTokenMarket({ ...stale, otherPools: undefined, latest: { ...stale.latest, liquidityUsd: 40_000 } })).toEqual({
      status: 'INSUFFICIENT_DATA',
      reason: READING_NOT_CURRENT_REASON,
    });
    // A stale "no trades", or no volume at all, is not current either.
    expect(classifyTokenMarket({ ...stale, latest: { ...stale.latest, volume24hUsd: 0 } })).toEqual({ status: 'INSUFFICIENT_DATA', reason: READING_NOT_CURRENT_REASON });
    const { volume24hUsd: _dropped, ...noVolume } = stale.latest;
    expect(classifyTokenMarket({ ...stale, latest: noVolume })).toEqual({ status: 'INSUFFICIENT_DATA', reason: READING_NOT_CURRENT_REASON });
  });

  it('is active when something speaks for the last day: the other pool’s own volume, a fresh trade record or a current reading', () => {
    expect(classifyTokenMarket({ ...stale, otherPools: { ...stale.otherPools, volume24hUsd: 610 } })).toEqual({
      status: 'ACTIVE_MARKET',
      reason: 'liquidity_in_another_pool',
      activeSeries: 'chain',
    });
    expect(classifyTokenMarket({ ...stale, trades: { observedAt: hoursAgo(3), volume24hUsd: 610 } })).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' });
    const current = { ...stale, latest: { ...stale.latest, observedAt: hoursAgo(TOKEN_MARKET.currentReadingMaxHours - 1) } };
    expect(classifyTokenMarket(current)).toMatchObject({ status: 'ACTIVE_MARKET', reason: 'liquidity_in_another_pool' });
    // A current reading with no volume anywhere is still volume_unknown (2026-10-19 audit).
    const { volume24hUsd: _none, ...currentNoVolume } = current.latest;
    expect(classifyTokenMarket({ ...current, latest: currentNoVolume })).toEqual({ status: 'INSUFFICIENT_DATA', reason: 'volume_unknown' });
  });

  it('decides on, and stores, only a volume that speaks for the day', () => {
    // The stale reading's $2,400 is no input; the other pool's $0 measured today decides: no trades.
    const withOther = { ...stale, otherPools: { ...stale.otherPools, volume24hUsd: 0 } };
    expect(classifyTokenMarket(withOther)).toEqual({ status: 'TRADING_INACTIVE', reason: 'no_volume_24h' });
    expect(rescuedMarketVolume(withOther)).toBe(0);
    expect(rescuedMarketVolume(stale)).toBeUndefined();
    const traded = { ...stale, otherPools: { ...stale.otherPools, volume24hUsd: 610 } };
    expect(tokenMarketDecidedVolume(traded, classifyTokenMarket(traded))).toBe(610);
  });
});

describe('the market-status sentence (2026-10-03, full audit)', () => {
  it('has a clause for every classifier reason', () => {
    for (const reason of TOKEN_MARKET_REASONS) expect(TOKEN_MARKET_REASON_WORDS[reason]).toMatch(/\w/);
  });

  it('reads as English, never the machine key', () => {
    const sentence = tokenMarketReasonSentence('ACTIVE_MARKET', 'liquidity_and_volume');
    expect(sentence).toBe('Active market: the pool holds liquidity and the token traded in the last day.');
    expect(sentence).not.toMatch(/active market because|_/);
    expect(tokenMarketReasonSentence('LOW_LIQUIDITY', null)).toBe('Low liquidity.');
    expect(tokenMarketReasonSentence('ACTIVE_MARKET', 'launch_pool_trading')).toMatch(/^Launch pool only: /);
  });
});
