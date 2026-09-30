import { describe, expect, it } from 'vitest';

import { stubFetch, testContext } from '../testing';
import { BITQUERY_POINTS, bitqueryDiscoveryPagePoints, createBitqueryDiscoveryAdapter, createBitqueryTradesAdapter, withBitqueryPoints } from './bitquery';
import { createBitquerySurfaceAdapter } from './bitquery-surface';
import { createBitqueryTradeDaysAdapter } from './bitquery-days';

/*
 * What a request costs on the plan's meter (2026-09-30). The figures are the
 * provider's own, read back with `utilities.metrics` by query id: a realtime
 * document is five points a cube, an archive read is charged by what it
 * scans. Each adapter states its request's cost so the domain can book it.
 */
const json = { 'content-type': 'application/json' };
const HOUR = 3_600_000;

describe('Bitquery points per request', () => {
  it('books a realtime document at five points a cube', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: { EVM: { week: [] } } }), headers: json });
    const trades = await createBitqueryTradesAdapter().fetch(
      { addresses: ['0xb33eb16782776b4d738c0fd643577cb0284db610'], since: new Date('2026-09-29T00:00:00Z'), lookback: new Date('2026-09-25T00:00:00Z'), apiKey: 'test-token' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(trades.meteredUnits).toBe(BITQUERY_POINTS.perRealtimeCube);

    const days = await createBitqueryTradeDaysAdapter().fetch(
      { addresses: ['0xb33eb16782776b4d738c0fd643577cb0284db610'], since: new Date('2026-09-27T00:00:00Z'), apiKey: 'test-token' },
      testContext({ fetchImpl: stubFetch({ status: 200, body: JSON.stringify({ data: { EVM: {} } }), headers: json }).fetchImpl }),
    );
    // Three cubes in the document: the day rows, the day's traders, the breadth.
    expect(days.meteredUnits).toBe(3 * BITQUERY_POINTS.perRealtimeCube);
  });

  it('books a discovery page by the span of its slice on the archive, and a realtime page at one cube', async () => {
    const body = JSON.stringify({ data: { EVM: { DEXTradeByTokens: [] } } });
    const page = (since: Date, till: Date, dataset?: 'realtime' | 'combined') =>
      createBitqueryDiscoveryAdapter().fetch(
        { since, till, count: 1000, offset: 0, apiKey: 'test-token', ...(dataset ? { dataset } : {}) },
        testContext({ fetchImpl: stubFetch({ status: 200, body, headers: json }).fetchImpl }),
      );
    // testContext's clock is 2026-09-01: a slice ending that day is new, one a month before it is old.
    const recent = new Date('2026-09-01T00:00:00Z');
    const old = new Date('2026-08-01T00:00:00Z');
    expect((await page(new Date(recent.getTime() - HOUR), recent)).meteredUnits).toBe(10);
    expect((await page(new Date(old.getTime() - HOUR), old)).meteredUnits).toBe(20);
    expect((await page(new Date(recent.getTime() - 24 * HOUR), recent)).meteredUnits).toBe(20);
    expect((await page(new Date(old.getTime() - 24 * HOUR), old)).meteredUnits).toBe(40);
    expect((await page(new Date(recent.getTime() - HOUR), recent, 'realtime')).meteredUnits).toBe(BITQUERY_POINTS.perRealtimeCube);
  });

  it('books the scan\'s contract surface at what the archive charged for it', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: { EVM: { methods: [], totals: [], logs: [] } } }), headers: json });
    const surface = await createBitquerySurfaceAdapter().fetch({ address: '0xb33eb16782776b4d738c0fd643577cb0284db610', apiKey: 'test-token' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(surface.meteredUnits).toBe(BITQUERY_POINTS.surface);
  });

  it('charges a request retried after a 5xx twice, and grows with the slice', () => {
    const result = withBitqueryPoints({ fetchedAt: new Date(), cacheTtlSeconds: 0, status: 'fresh', attempts: 2 }, 5);
    expect(result.meteredUnits).toBe(10);
    const till = new Date('2026-09-30T00:00:00Z');
    const monthLater = new Date('2026-10-30T00:00:00Z');
    const slice = (hours: number, now = till) => bitqueryDiscoveryPagePoints(new Date(till.getTime() - hours * HOUR), till, now);
    expect([slice(0.25), slice(1), slice(6), slice(24), slice(7 * 24)]).toEqual([10, 10, 25, 20, 140]);
    expect([slice(1, monthLater), slice(24, monthLater)]).toEqual([20, 40]);
  });
});
