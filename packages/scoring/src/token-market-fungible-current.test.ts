import { describe, expect, it } from 'vitest';

import { marketStatusWords, NOT_FUNGIBLE_LABEL, READING_NOT_CURRENT_LABEL, TOKEN_MARKET_REASON_WORDS, tokenMarketReasonSentence, tokenMarketStatusLabel } from './market-status-words';
import {
  classifyTokenMarket,
  DEAD_MARKET_REASONS,
  discoveryGapMarketMeasurable,
  marketIsLive,
  NOT_FUNGIBLE_REASON,
  READING_NOT_CURRENT_REASON,
  TOKEN_MARKET,
  TOKEN_MARKET_REASONS,
  tokenIsFungible,
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
