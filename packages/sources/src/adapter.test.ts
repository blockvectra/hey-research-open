import { describe, expect, it } from 'vitest';

import { hasData, shouldRetainPreviousData, type SourceResult } from './adapter';

const base = <T>(overrides: Partial<SourceResult<T>>): SourceResult<T> => ({
  fetchedAt: new Date('2026-09-01T00:00:00Z'),
  cacheTtlSeconds: 600,
  status: 'fresh',
  ...overrides,
});

describe('hasData', () => {
  it('is true only for a fresh result carrying a payload', () => {
    expect(hasData(base({ data: { priceUsd: 1 } }))).toBe(true);
  });

  it('is false for a fresh result with no payload', () => {
    expect(hasData(base<{ priceUsd: number }>({}))).toBe(false);
  });

  it('is false for not_modified results', () => {
    expect(hasData(base({ status: 'not_modified' }))).toBe(false);
  });
});

describe('shouldRetainPreviousData', () => {
  it.each(['not_modified', 'missing', 'rate_limited', 'error'] as const)(
    'retains cached data when a source returns %s',
    (status) => {
      expect(shouldRetainPreviousData(base({ status }))).toBe(true);
    },
  );

  it('does not retain stale data when the fetch succeeded', () => {
    expect(shouldRetainPreviousData(base({ status: 'fresh', data: 1 }))).toBe(false);
  });
});
