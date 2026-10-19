import { describe, expect, it } from 'vitest';

import { marketStatusWords, TOKEN_MARKET_REASON_WORDS, tokenMarketReasonSentence, UNCONFIRMED_MARKET_REASONS } from './market-status-words';
import {
  classifyTokenMarket,
  DEAD_MARKET_REASONS,
  discoveryGapMarketMeasurable,
  marketIsLive,
  RESCUED_MARKET_REASON,
  TOKEN_MARKET,
  TOKEN_MARKET_REASONS,
  tokenMarketDecidedVolume,
  tokenMarketVolume,
  VOLUME_UNKNOWN_REASON,
  type TokenMarketEvidence,
} from './token-market';

const now = new Date('2026-10-12T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

describe('the volume a market status is decided on is the one HEY stores (2026-10-12, audit DI-3)', () => {
  // kairune: GeckoTerminal's pool reading said $0, HEY's decoded trades $669.07 within the day.
  const kairune: TokenMarketEvidence = {
    now,
    latest: { observedAt: hoursAgo(2), liquidityUsd: 12_000, volume24hUsd: 0 },
    trades: { observedAt: hoursAgo(1), volume24hUsd: 669.07 },
  };

  it('stores the fresh trades, not the pool reading’s zero, beside the Active market they made', () => {
    const classification = classifyTokenMarket(kairune);
    expect(classification).toEqual({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
    expect(tokenMarketVolume(kairune)).toBe(669.07);
    expect(tokenMarketDecidedVolume(kairune, classification)).toBe(669.07);
  });

  it('does the same for a launch pool that traded (vanterra: $0 read, $4.10 traded)', () => {
    const vanterra: TokenMarketEvidence = {
      now,
      latest: { observedAt: hoursAgo(2), liquidityUsd: 40_000, volume24hUsd: 0, fdvUsd: 41_000 },
      trades: { observedAt: hoursAgo(3), volume24hUsd: 4.1 },
    };
    const classification = classifyTokenMarket(vanterra);
    expect(classification).toEqual({ status: 'ACTIVE_MARKET', reason: 'launch_pool_trading' });
    expect(tokenMarketDecidedVolume(vanterra, classification)).toBe(4.1);
  });

  it('counts the rescuing pool’s volume for a market another pool holds', () => {
    const rescued: TokenMarketEvidence = {
      now,
      latest: { observedAt: hoursAgo(2), liquidityUsd: 170, volume24hUsd: 0 },
      otherPools: { observedAt: hoursAgo(1), liquidityUsd: 6_700, volume24hUsd: 950, series: 'pool:0x00000000000000000000000000000000000000aa' },
    };
    const classification = classifyTokenMarket(rescued);
    expect(classification.reason).toBe(RESCUED_MARKET_REASON);
    expect(tokenMarketDecidedVolume(rescued, classification)).toBe(950);
  });

  it('ignores a trade record older than a day, as the classifier does', () => {
    const evidence: TokenMarketEvidence = {
      now,
      latest: { observedAt: hoursAgo(2), liquidityUsd: 12_000, volume24hUsd: 0 },
      trades: { observedAt: hoursAgo(30), volume24hUsd: 669.07 },
    };
    expect(tokenMarketVolume(evidence)).toBe(0);
    expect(classifyTokenMarket(evidence)).toEqual({ status: 'TRADING_INACTIVE', reason: 'no_volume_24h' });
  });
});

describe('an unknown 24h volume is never an active market (2026-10-12, audit DI-4)', () => {
  // mandate: virtuals every three hours with no volume field; GeckoTerminal once a day with $0 and 0 buys.
  const virtualsReading = { observedAt: hoursAgo(1), liquidityUsd: 9_000 };

  it('falls back to the newest volume measured in the current-reading window', () => {
    const mandate: TokenMarketEvidence = { now, latest: virtualsReading, recentVolume: { observedAt: hoursAgo(20), volume24hUsd: 0 } };
    expect(tokenMarketVolume(mandate)).toBe(0);
    expect(classifyTokenMarket(mandate)).toEqual({ status: 'TRADING_INACTIVE', reason: 'no_volume_24h' });
    // …so the reading with no volume field between two that measured $0 no longer flips it.
    const traded: TokenMarketEvidence = { now, latest: virtualsReading, recentVolume: { observedAt: hoursAgo(20), volume24hUsd: 340 } };
    expect(classifyTokenMarket(traded)).toEqual({ status: 'ACTIVE_MARKET', reason: 'liquidity_and_volume' });
  });

  it('is volume_unknown when no reading of the window measured one', () => {
    expect(classifyTokenMarket({ now, latest: virtualsReading })).toEqual({ status: 'INSUFFICIENT_DATA', reason: VOLUME_UNKNOWN_REASON });
    const tooOld = { observedAt: hoursAgo(TOKEN_MARKET.currentReadingMaxHours + 1), volume24hUsd: 340 };
    expect(tokenMarketVolume({ now, latest: virtualsReading, recentVolume: tooOld })).toBeUndefined();
    expect(classifyTokenMarket({ now, latest: virtualsReading, recentVolume: tooOld })).toEqual({ status: 'INSUFFICIENT_DATA', reason: VOLUME_UNKNOWN_REASON });
  });

  it('never lets the fallback overrule a volume the current reading or fresh trades carry', () => {
    const evidence: TokenMarketEvidence = {
      now,
      latest: { ...virtualsReading, volume24hUsd: 0 },
      recentVolume: { observedAt: hoursAgo(5), volume24hUsd: 5_000 },
    };
    expect(tokenMarketVolume(evidence)).toBe(0);
    expect(classifyTokenMarket(evidence).status).toBe('TRADING_INACTIVE');
  });

  it('is not dead and not measured: no Discovery Gap, no valuation hidden as a dead market', () => {
    expect((TOKEN_MARKET_REASONS as readonly string[]).includes(VOLUME_UNKNOWN_REASON)).toBe(true);
    expect((DEAD_MARKET_REASONS as readonly string[]).includes(VOLUME_UNKNOWN_REASON)).toBe(false);
    expect(marketIsLive('INSUFFICIENT_DATA', VOLUME_UNKNOWN_REASON)).toBe(true);
    expect(discoveryGapMarketMeasurable('INSUFFICIENT_DATA', 'DEX', VOLUME_UNKNOWN_REASON)).toBe(false);
  });

  it('says what is missing, in the one vocabulary', () => {
    expect((UNCONFIRMED_MARKET_REASONS as readonly string[]).includes(VOLUME_UNKNOWN_REASON)).toBe(true);
    expect(marketStatusWords('INSUFFICIENT_DATA', { hasCurrentReading: true, pricedDays: 30, reason: VOLUME_UNKNOWN_REASON })).toBe('Readings not confirmed');
    expect(TOKEN_MARKET_REASON_WORDS[VOLUME_UNKNOWN_REASON]).toMatch(/no reading from the last 36 hours/);
    expect(tokenMarketReasonSentence('INSUFFICIENT_DATA', VOLUME_UNKNOWN_REASON)).toBe(
      'Market data insufficient: the pool holds liquidity, but no reading from the last 36 hours reports how much traded.',
    );
  });
});

describe('a market rescued by another pool is held to the volume rules (2026-10-19 audit)', () => {
  it('is volume_unknown, not Active market, when no reading measured a volume', () => {
    expect(
      classifyTokenMarket({
        now,
        latest: { observedAt: hoursAgo(1), liquidityUsd: 50 },
        peakLiquidityUsd: 7_000,
        otherPools: { observedAt: hoursAgo(1), liquidityUsd: 10_000 },
      }),
    ).toEqual({ status: 'INSUFFICIENT_DATA', reason: VOLUME_UNKNOWN_REASON });
  });

  it('is still Active market when the other pool measured a volume', () => {
    expect(
      classifyTokenMarket({
        now,
        latest: { observedAt: hoursAgo(1), liquidityUsd: 50 },
        peakLiquidityUsd: 7_000,
        otherPools: { observedAt: hoursAgo(1), liquidityUsd: 10_000, volume24hUsd: 2_500 },
      }).status,
    ).toBe('ACTIVE_MARKET');
  });
});
