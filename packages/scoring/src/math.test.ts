import { describe, expect, it } from 'vitest';

import { clamp, clampScore, percentileRank, percentileRanker, renormalizeWeights } from './math';

describe('clamp', () => {
  it('bounds values into the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('degrades NaN to the minimum rather than propagating it', () => {
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
  });
});

describe('clampScore', () => {
  it('keeps every component inside 0..100', () => {
    expect(clampScore(120)).toBe(100);
    expect(clampScore(-20)).toBe(0);
    expect(clampScore(42.5)).toBe(42.5);
  });
});

describe('renormalizeWeights', () => {
  it('leaves a complete weight set summing to 1', () => {
    expect(renormalizeWeights([0.5, 0.3, 0.2])).toEqual([0.5, 0.3, 0.2]);
  });

  it('reweights when an input is missing', () => {
    const [a, b] = renormalizeWeights([0.5, 0.3]);
    expect(a).toBeCloseTo(0.625);
    expect(b).toBeCloseTo(0.375);
  });

  it('returns nothing when no weight remains', () => {
    expect(renormalizeWeights([0, 0])).toEqual([]);
  });
});

describe('percentileRanker', () => {
  it('matches percentileRank for every member of a cohort, ties included', () => {
    const cohort = [5, 0, 0, 12.5, 100, 42, 42, 42, 7, 0, 99.9, 3];
    const rank = percentileRanker(cohort);
    for (const value of [...cohort, -1, 1, 41.9, 42.1, 101]) {
      expect(rank(value)).toBe(percentileRank(value, cohort));
    }
  });

  it('is 0 for an empty cohort and 50 for a uniform one', () => {
    expect(percentileRanker([])(10)).toBe(0);
    expect(percentileRanker([4, 4, 4])(4)).toBe(50);
  });

  it('is deterministic regardless of cohort ordering', () => {
    const a = percentileRanker([1, 2, 3, 3, 9]);
    const b = percentileRanker([9, 3, 1, 3, 2]);
    expect(a(3)).toBe(b(3));
  });
});

describe('percentileRank', () => {
  it('returns 0 for an empty cohort', () => {
    expect(percentileRank(10, [])).toBe(0);
  });

  it('ranks the lowest and highest members', () => {
    const cohort = [1, 2, 3, 4];
    expect(percentileRank(1, cohort)).toBeLessThan(percentileRank(4, cohort));
  });

  it('scores a uniform cohort at the midpoint', () => {
    expect(percentileRank(7, [7, 7, 7, 7])).toBe(50);
  });

  it('is deterministic regardless of cohort ordering', () => {
    expect(percentileRank(3, [5, 1, 3, 9])).toBe(percentileRank(3, [9, 3, 1, 5]));
  });
});
