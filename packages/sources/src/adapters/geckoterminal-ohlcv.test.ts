import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createGeckoterminalOhlcvAdapter, ohlcvUrl } from './geckoterminal-ohlcv';

describe('geckoterminal ohlcv adapter', () => {
  const pool = '0x04de0599e1f0701f55e16cee7a7489c33eb0e74363a4aa886235e80e01f32fd0';

  it('reads daily candles oldest first and keeps the numbers as numbers', async () => {
    const ctx = testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('geckoterminal-ohlcv-day.json') }).fetchImpl });
    const result = await createGeckoterminalOhlcvAdapter().fetch({ network: 'robinhood', poolAddress: pool }, ctx);
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    expect(result.data).toHaveLength(7);
    expect(result.data[0]!.day.getTime()).toBeLessThan(result.data[6]!.day.getTime());
    const high = Math.max(...result.data.map((c) => c.highUsd));
    expect(high).toBeCloseTo(0.00353251698760605, 12);
    expect(result.data[6]).toMatchObject({ closeUsd: 1.82873512499702e-5 });
    expect(result.sourceUrl).toContain(`/pools/${pool}/ohlcv/day?limit=90`);
  });

  it('refuses a pool address that is not one', () => {
    expect(createGeckoterminalOhlcvAdapter().canHandle({ network: 'robinhood', poolAddress: 'nope' })).toBe(false);
  });

  it('reports an empty candle list as missing, not as data', async () => {
    const ctx = testContext({ fetchImpl: stubFetch({ status: 200, body: JSON.stringify({ data: { attributes: { ohlcv_list: [] } } }) }).fetchImpl });
    const result = await createGeckoterminalOhlcvAdapter().fetch({ network: 'robinhood', poolAddress: pool }, ctx);
    expect(result.status).toBe('missing');
  });
});

describe('geckoterminal ohlcv adapter, intraday (2026-09-29)', () => {
  const pool = '0x04de0599e1f0701f55e16cee7a7489c33eb0e74363a4aa886235e80e01f32fd0';

  it('keeps the daily URL byte-identical when no timeframe is named', () => {
    expect(ohlcvUrl({ network: 'robinhood', poolAddress: pool })).toBe(
      `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pool}/ohlcv/day?limit=90`,
    );
    expect(ohlcvUrl({ network: 'robinhood', poolAddress: pool, days: 30, timeframe: 'day' })).toBe(
      `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pool}/ohlcv/day?limit=30`,
    );
  });

  it('reads hourly bars, oldest first, with the hour each one starts', async () => {
    const ctx = testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('geckoterminal-ohlcv-hour.json') }).fetchImpl });
    const result = await createGeckoterminalOhlcvAdapter().fetch({ network: 'robinhood', poolAddress: pool, timeframe: 'hour', aggregate: 1, limit: 24 }, ctx);
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    expect(result.data).toHaveLength(7);
    const starts = result.data.map((c) => c.day.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // Every bar starts on the hour.
    for (const start of starts) expect(start % 3_600_000).toBe(0);
    expect(result.data.at(-1)).toMatchObject({ closeUsd: 8.28795236256375e-6 });
    expect(result.sourceUrl).toContain(`/pools/${pool}/ohlcv/hour?aggregate=1&limit=24`);
    expect(result.cacheTtlSeconds).toBe(900);
  });

  it('reads quarter-hour bars, and an older page asks with before_timestamp', async () => {
    const ctx = testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('geckoterminal-ohlcv-minute.json') }).fetchImpl });
    const result = await createGeckoterminalOhlcvAdapter().fetch(
      { network: 'robinhood', poolAddress: pool, timeframe: 'minute', aggregate: 15, limit: 1000, beforeTimestamp: 1790450000 },
      ctx,
    );
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    for (const candle of result.data) expect(candle.day.getTime() % 900_000).toBe(0);
    // The provider lists only bars that traded: seven bars over days, never padded with zeros here.
    expect(result.data).toHaveLength(7);
    expect(result.data.every((c) => c.volumeUsd > 0)).toBe(true);
    expect(result.sourceUrl).toContain('/ohlcv/minute?aggregate=15&limit=1000&before_timestamp=1790450000');
  });

  it('refuses an aggregate the provider does not serve', () => {
    const adapter = createGeckoterminalOhlcvAdapter();
    expect(adapter.canHandle({ network: 'robinhood', poolAddress: pool, timeframe: 'minute', aggregate: 10 })).toBe(false);
    expect(adapter.canHandle({ network: 'robinhood', poolAddress: pool, timeframe: 'hour', aggregate: 1 })).toBe(true);
  });
});
