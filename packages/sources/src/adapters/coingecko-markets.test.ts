import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  COINGECKO_MARKETS_BATCH_SIZE,
  coingeckoMarketsUrl,
  createCoingeckoMarketsAdapter,
} from './coingecko-markets';

const ids = ['pons', '1inch', 'agentos', 'hoodagent'];
const markets = () => ({ status: 200, body: readFixture('coingecko-markets.json') });

describe('CoinGecko markets adapter', () => {
  const adapter = createCoingeckoMarketsAdapter();

  it('takes up to 250 well-formed coin ids per call', () => {
    expect(adapter.canHandle({ ids })).toBe(true);
    expect(adapter.canHandle({ ids: [] })).toBe(false);
    expect(adapter.canHandle({ ids: ['../coins'] })).toBe(false);
    expect(adapter.canHandle({ ids: Array.from({ length: COINGECKO_MARKETS_BATCH_SIZE }, (_, i) => `c${i}`) })).toBe(true);
    expect(adapter.canHandle({ ids: Array.from({ length: COINGECKO_MARKETS_BATCH_SIZE + 1 }, (_, i) => `c${i}`) })).toBe(false);
  });

  it('asks for the batch in USD with full precision and no sparkline', async () => {
    const stub = stubFetch(markets());
    await adapter.fetch({ ids }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=pons,1inch,agentos,hoodagent&per_page=250&page=1&sparkline=false&precision=full',
    );
    expect(coingeckoMarketsUrl('https://example.test/v3/', ['a b'])).toContain('ids=a%20b');
  });

  it('carries price, market cap, FDV and volume per coin id', async () => {
    const stub = stubFetch(markets());
    const result = await adapter.fetch({ ids }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    const byId = Object.fromEntries((result.data ?? []).map((quote) => [quote.id, quote]));
    expect(byId['pons']).toMatchObject({
      symbol: 'pons',
      name: 'Pons',
      priceUsd: 0.481911,
      marketCapUsd: 343023180,
      fdvUsd: 340410680,
      volume24hUsd: 129947747,
      pageUrl: 'https://www.coingecko.com/en/coins/pons',
    });
    expect(byId['pons']?.updatedAt?.toISOString()).toBe('2026-09-03T03:55:30.000Z');
    expect(byId['pons']?.imageUrl).toMatch(/^https:\/\/coin-images\.coingecko\.com\//);
    expect(byId['agentos']).toMatchObject({ marketCapUsd: 441439, fdvUsd: 441439 });
  });

  it('treats a zero market cap or volume as unknown, never as a figure', async () => {
    const stub = stubFetch(markets());
    const result = await adapter.fetch({ ids }, testContext({ fetchImpl: stub.fetchImpl }));
    const hoodagent = result.data?.find((quote) => quote.id === 'hoodagent');

    expect(hoodagent).toBeDefined();
    expect(hoodagent).not.toHaveProperty('marketCapUsd');
    expect(hoodagent).not.toHaveProperty('volume24hUsd');
    expect(hoodagent).toMatchObject({ fdvUsd: 120000, priceUsd: 0.0012 });
  });

  it('ignores coins it did not ask for', async () => {
    const stub = stubFetch(markets());
    const result = await adapter.fetch({ ids: ['pons'] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.map((quote) => quote.id)).toEqual(['pons']);
  });

  it('reports a 429 as rate limited with the advertised wait', async () => {
    const stub = stubFetch({ status: 429, headers: { 'retry-after': '60' } });
    const result = await adapter.fetch({ ids }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('rejects a payload that is not a list of quotes', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ error: 'nope' }) });
    const result = await adapter.fetch({ ids }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
