import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createDexscreenerAdapter } from './dexscreener';
import { createGeckoterminalAdapter } from './geckoterminal';

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const input = { chainId: 4663, tokenAddress: TOKEN };

describe('DEX Screener adapter', () => {
  const adapter = createDexscreenerAdapter();

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
      liquidityUsd: 8250.75,
      volume24hUsd: 4300.1,
      fdvUsd: 23900,
    });
    expect(result.data?.priceUsd).toBeCloseTo(0.0000239, 10);
  });

  it('picks the pair with the deepest liquidity, never merging pairs', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-token.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.pairAddress).toBe('0x2222222222222222222222222222222222222222');
    // The pool's protocol travels with the reading, as the provider names it (2026-09-13).
    expect(result.data?.venue).toBe('ponsswap');
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
