import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createGeckoterminalOhlcvAdapter } from './geckoterminal-ohlcv';

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
