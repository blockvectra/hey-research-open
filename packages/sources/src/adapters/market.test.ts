import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createDexscreenerAdapter } from './dexscreener';
import { createGeckoterminalAdapter } from './geckoterminal';

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const input = { chainId: 4663, tokenAddress: TOKEN };

describe('DEX Screener adapter', () => {
  const adapter = createDexscreenerAdapter();

  it('keeps the reading when a provider sends null for an optional field (2026-09-17)', async () => {
    // `.optional()` refused an explicit null and the whole response — not the
    // one pair — became INVALID_RESPONSE, so the token had no market at all.
    const body = JSON.parse(readFixture('dexscreener-token.json')) as { pairs: Record<string, unknown>[] };
    body.pairs[0] = { ...body.pairs[0], pairAddress: null, dexId: null, url: null };
    const stub = stubFetch({ status: 200, body: JSON.stringify(body) });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
  });

  it('reads a price move too large for the column as unknown, not as a failed reading (2026-09-25)', async () => {
    // numeric(12,4) holds under 1e8; one pool's larger move failed a whole market batch.
    const body = JSON.parse(readFixture('dexscreener-token.json')) as { pairs: Record<string, unknown>[] };
    body.pairs = body.pairs.map((pair) => ({ ...pair, priceChange: { h1: 'Infinity', h6: -99_999_999.99995, h24: 250_000_000 } }));
    const stub = stubFetch({ status: 200, body: JSON.stringify(body) });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data?.priceChange1hPct).toBeUndefined();
    expect(result.data?.priceChange6hPct).toBeUndefined();
    expect(result.data?.priceChange24hPct).toBeUndefined();
    expect(result.data?.liquidityUsd).toBe(10_351.25);
  });

  it('only handles well-formed contract addresses', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ chainId: 4663, tokenAddress: 'AOS' })).toBe(false);
  });

  it('normalizes a fixture into market context', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-token.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data).toMatchObject({
      source: 'dexscreener',
      chainId: 4663,
      symbol: 'AOS',
      // Depth and volume across both of the token's pools, not the deepest
      // alone (2026-09-14): 2,100.50 + 8,250.75 and 900.25 + 4,300.10.
      liquidityUsd: 10_351.25,
      volume24hUsd: 5_200.35,
      fdvUsd: 23900,
    });
    expect(result.data?.priceUsd).toBeCloseTo(0.0000239, 10);
  });

  it('quotes from the deepest pair and counts depth across them all', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-token.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.pairAddress).toBe('0x2222222222222222222222222222222222222222');
    // The pool's protocol travels with the reading, as the provider names it (2026-09-13).
    expect(result.data?.venue).toBe('ponsswap');
    // The price move is the chosen pair's; the trade counts are the token's
    // whole market, 40 + 312 and 35 + 288 (2026-09-14).
    expect(result.data).toMatchObject({ buys24h: 352, sells24h: 323, priceChange1hPct: 0.7, priceChange6hPct: -2.4, priceChange24hPct: 4.2 });
    // The shallow pair reported a market cap; the deep pair did not. It must not be borrowed.
    expect(result.data?.marketCapUsd).toBeUndefined();
  });

  it('keeps market cap and FDV distinguishable rather than inventing one', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-token.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.fdvUsd).toBe(23900);
    expect(result.data).not.toHaveProperty('marketCapUsd');
  });

  it('carries no holder, wallet or trader field', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-token.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    const keys = Object.keys(result.data ?? {})
      .join(' ')
      .toLowerCase();
    for (const banned of ['holder', 'wallet', 'pnl', 'trader']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('treats a token with no pairs as missing, not as a provider error', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-empty.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('missing');
    expect(result.errorCode).toBe('NOT_FOUND');
  });

  it('surfaces rate limiting without throwing', async () => {
    const stub = stubFetch({ status: 429, headers: { 'retry-after': '30' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(30);
    expect(result.data).toBeUndefined();
  });

  it('reports a malformed payload as INVALID_RESPONSE', async () => {
    const stub = stubFetch({ status: 200, body: '{ not json' });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('passes through 304 as not_modified', async () => {
    const stub = stubFetch({ status: 304 });
    const result = await adapter.fetch(
      input,
      testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"prev"' }),
    );

    expect(result.status).toBe('not_modified');
    expect(result.etag).toBe('W/"prev"');
  });
});

describe('GeckoTerminal adapter', () => {
  const adapter = createGeckoterminalAdapter();
  const gtInput = { ...input, network: 'robinhood-chain' };

  it('normalizes a fixture into the same market shape as DEX Screener', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('geckoterminal-pools.json') });
    const result = await adapter.fetch(gtInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data).toMatchObject({
      source: 'geckoterminal',
      liquidityUsd: 7900,
      fdvUsd: 23850,
      volume24hUsd: 3100.5,
    });
    expect(result.data?.pairCreatedAt?.toISOString()).toBe('2026-07-14T10:12:00.000Z');
    expect(result.data?.venue).toBe('uniswap-v4-robinhood-chain');
    expect(result.data).toMatchObject({ buys24h: 96, sells24h: 92, priceChange24hPct: -1.5 });
  });

  it('reads a price move too large for the column as unknown, and keeps one that fits (2026-09-25)', async () => {
    const body = JSON.parse(readFixture('geckoterminal-pools.json')) as { data: { attributes: Record<string, unknown> }[] };
    body.data = body.data.map((pool) => ({ ...pool, attributes: { ...pool.attributes, price_change_percentage: { h1: '1e8', h6: '99999999.9999', h24: 'not a number' } } }));
    const stub = stubFetch({ status: 200, body: JSON.stringify(body) });
    const result = await adapter.fetch(gtInput, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data?.priceChange1hPct).toBeUndefined();
    expect(result.data?.priceChange6hPct).toBe(99_999_999.9999);
    expect(result.data?.priceChange24hPct).toBeUndefined();
    expect(result.data?.liquidityUsd).toBe(7900);
  });

  it('does not invent a market cap when the provider reports null', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('geckoterminal-pools.json') });
    const result = await adapter.fetch(gtInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data).not.toHaveProperty('marketCapUsd');
  });

  it('reports no coverage as missing so DEX Screener stays the primary', async () => {
    const stub = stubFetch({ status: 200, body: '{"data":[]}' });
    const result = await adapter.fetch(gtInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('missing');
  });
});
