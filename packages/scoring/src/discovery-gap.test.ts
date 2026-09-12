import { describe, expect, it } from 'vitest';

import type { ScoredEvent } from './activity';
import {
  discoveryGapScore,
  evaluateStillBuilding,
  isUnderTheRadarEligible,
  marketBand,
  marketContextPercentile,
} from './discovery-gap';

const now = new Date('2026-09-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

const ship = (days: number, overrides: Partial<ScoredEvent> = {}): ScoredEvent => ({
  eventType: 'GITHUB_RELEASE',
  verificationStatus: 'PUBLICLY_VERIFIED',
  publishedAt: daysAgo(days),
  sourceKind: 'GITHUB',
  ...overrides,
});

const cohort = {
  marketCapOrFdvUsd: [10_000, 50_000, 250_000, 1_000_000, 10_000_000],
  liquidityUsd: [1_000, 8_000, 40_000, 200_000, 2_000_000],
  volume24hUsd: [500, 4_000, 30_000, 150_000, 1_500_000],
};

describe('market bands', () => {
  it('bands by market cap using configured thresholds', () => {
    expect(marketBand(24_000)).toBe('MICRO');
    expect(marketBand(500_000)).toBe('SMALL');
    expect(marketBand(5_000_000)).toBe('MID');
    expect(marketBand(50_000_000)).toBe('LARGE');
  });

  it('is UNKNOWN rather than zero when no value is available', () => {
    expect(marketBand(undefined)).toBe('UNKNOWN');
  });
});

describe('market context percentile', () => {
  it('places a small project low and a large one high', () => {
    const small = marketContextPercentile(
      { marketCapOrFdvUsd: 12_000, liquidityUsd: 1_200 },
      cohort,
    );
    const large = marketContextPercentile(
      { marketCapOrFdvUsd: 9_000_000, liquidityUsd: 1_800_000 },
      cohort,
    );

    expect(small!).toBeLessThan(large!);
  });

  it('renormalises weights when a metric is missing', () => {
    const partial = marketContextPercentile({ marketCapOrFdvUsd: 250_000 }, cohort);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThanOrEqual(100);
  });

  it('returns undefined when there is no market data at all', () => {
    expect(marketContextPercentile({}, cohort)).toBeUndefined();
  });
});

describe('discovery gap', () => {
  it('is positive when building outpaces market footprint', () => {
    expect(discoveryGapScore(90, 20)).toBe(70);
  });

  it('is negative when market attention outpaces building', () => {
    expect(discoveryGapScore(15, 80)).toBe(-65);
  });

  it('is undefined without market context rather than assuming zero', () => {
    expect(discoveryGapScore(90, undefined)).toBeUndefined();
  });
});

describe('under the radar eligibility', () => {
  const base = {
    activityStatus: 'ACTIVE' as const,
    hbm: 60,
    events: [ship(2), ship(10)],
    now,
    marketDataFresh: true,
  };

  it('accepts an active, well-evidenced project', () => {
    expect(isUnderTheRadarEligible(base)).toBe(true);
  });

  it('rejects quiet and dormant projects', () => {
    expect(isUnderTheRadarEligible({ ...base, activityStatus: 'QUIET' })).toBe(false);
    expect(isUnderTheRadarEligible({ ...base, activityStatus: 'DORMANT' })).toBe(false);
  });

  it('rejects a low Build Momentum score', () => {
    expect(isUnderTheRadarEligible({ ...base, hbm: 20 })).toBe(false);
    // hbm-v5 (2026-09-13): the floor is 30, not 45.
    expect(isUnderTheRadarEligible({ ...base, hbm: 35 })).toBe(true);
    expect(isUnderTheRadarEligible({ ...base, hbm: 29 })).toBe(false);
  });

  it('requires at least two meaningful updates in 30 days', () => {
    expect(isUnderTheRadarEligible({ ...base, events: [ship(2)] })).toBe(false);
  });

  it('requires fresh market data and excludes hidden projects', () => {
    expect(isUnderTheRadarEligible({ ...base, marketDataFresh: false })).toBe(false);
    expect(isUnderTheRadarEligible({ ...base, isHidden: true })).toBe(false);
  });
});

describe('still building', () => {
  const base = {
    activityStatus: 'SHIPPING' as const,
    hbm: 70,
    events: [ship(2), ship(12), ship(25)],
    now,
    marketDataFresh: true,
    currentMarketValueUsd: 24_000,
    trackedHighUsd: 100_000,
    trackedHighAt: daysAgo(40),
  };

  /** Backlog M5 test 4. */
  it('is eligible on a tracked drawdown with verified ships afterwards', () => {
    const result = evaluateStillBuilding(base);

    expect(result.eligible).toBe(true);
    expect(result.declinePercent).toBe(76);
    expect(result.shipsSinceDecline).toBe(3);
  });

  it('states the decline factually and never predicts recovery', () => {
    const result = evaluateStillBuilding(base);

    expect(result.reason).toContain('HEY-tracked high');
    for (const banned of ['undervalued', 'moon', 'recover', 'bullish', 'buy', '100x', 'cheap']) {
      expect(result.reason.toLowerCase()).not.toContain(banned);
    }
  });

  it('is not eligible without a large enough decline', () => {
    expect(evaluateStillBuilding({ ...base, currentMarketValueUsd: 90_000 }).eligible).toBe(false);
  });

  it('is not eligible without market context', () => {
    const result = evaluateStillBuilding({
      ...base,
      currentMarketValueUsd: undefined,
      trackedHighUsd: undefined,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('No market context');
  });

  it('is not eligible for an inactive project however far it fell', () => {
    expect(evaluateStillBuilding({ ...base, activityStatus: 'DORMANT' }).eligible).toBe(false);
  });

  it('requires meaningful updates after the decline began', () => {
    const result = evaluateStillBuilding({
      ...base,
      events: [ship(50), ship(55), ship(60)],
      trackedHighAt: daysAgo(10),
    });

    expect(result.eligible).toBe(false);
  });

  it('is not eligible on marketing alone', () => {
    const result = evaluateStillBuilding({
      ...base,
      events: [ship(1, { eventType: 'ANNOUNCEMENT' }), ship(2, { eventType: 'ANNOUNCEMENT' })],
    });

    expect(result.eligible).toBe(false);
  });

  it('excludes hidden projects', () => {
    expect(evaluateStillBuilding({ ...base, isHidden: true }).eligible).toBe(false);
  });
});
