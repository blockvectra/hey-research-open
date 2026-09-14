import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createDexscreenerTokensAdapter, DEXSCREENER_BATCH_SIZE } from './dexscreener-tokens';
import { createGeckoterminalPoolsAdapter } from './geckoterminal-pools';
import { createPonspadAdapter } from './ponspad';

/**
 * Contract tests for the real-data ingestion adapters, against fixtures captured
 * from the live providers on 2026-09-01. CI must never depend on a live API
 * (CLAUDE.md architecture rule 16).
 */
const ADDRESSES = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
];

describe('GeckoTerminal pools adapter', () => {
  const adapter = createGeckoterminalPoolsAdapter();

  it('rejects an unusable page number', () => {
    expect(adapter.canHandle({ chainId: 4663, network: 'robinhood', page: 1 })).toBe(true);
    expect(adapter.canHandle({ chainId: 4663, network: 'robinhood', page: 0 })).toBe(false);
  });

  it('extracts a base token address from each pool', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('geckoterminal-network-pools.json') });
    const result = await adapter.fetch(
      { chainId: 4663, network: 'robinhood', page: 1 },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(hasData(result)).toBe(true);
    const candidates = result.data ?? [];
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.contractAddress).toMatch(/^0x[a-f0-9]{40}$/);
      expect(candidate.chainId).toBe(4663);
      expect(candidate.discoveredVia).toBe('geckoterminal-pools');
    }
  });

  it('skips pools whose base token cannot be identified', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify({ data: [{ attributes: { name: 'A / B' }, relationships: {} }] }),
    });
    const result = await adapter.fetch(
      { chainId: 4663, network: 'robinhood', page: 1 },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    // A pool with no resolvable token is dropped, not guessed at.
    expect(result.data).toEqual([]);
  });
});

describe('DEX Screener batch token adapter', () => {
  const adapter = createDexscreenerTokensAdapter();
  const input = { chainId: 4663, chainSlug: 'robinhood', addresses: ADDRESSES };

  it('refuses a batch larger than the documented limit', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(
      adapter.canHandle({
        ...input,
        addresses: Array.from({ length: DEXSCREENER_BATCH_SIZE + 1 }, () => ADDRESSES[0] ?? ''),
      }),
    ).toBe(false);
  });

  it('reads the declared websites and socials that gate promotion', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-tokens.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    const screenings = result.data ?? [];
    expect(screenings.length).toBeGreaterThan(0);

    const withSite = screenings.find((screening) => screening.websites.length > 0);
    expect(withSite).toBeDefined();
    expect(withSite?.websiteUrl).toMatch(/^https?:\/\//);
  });

  it('drops a pair the provider reports on another chain', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify([
        {
          chainId: 'base',
          baseToken: { address: ADDRESSES[0], symbol: 'FOREIGN' },
          liquidity: { usd: 100 },
        },
      ]),
    });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    // HEY V1 is chain-locked; a foreign-chain pair must never enter the universe.
    expect(result.data).toEqual([]);
  });

  it('values a token from its deepest pair and counts depth across all of them', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify([
        {
          chainId: 'robinhood',
          baseToken: { address: ADDRESSES[0], symbol: 'A' },
          liquidity: { usd: 10 },
          marketCap: 1000,
        },
        {
          chainId: 'robinhood',
          baseToken: { address: ADDRESSES[0], symbol: 'A' },
          liquidity: { usd: 900 },
          marketCap: 2000,
        },
      ]),
    });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data).toHaveLength(1);
    // The valuation is the deepest pair's; the depth is both pools (2026-09-14).
    expect(result.data?.[0]?.liquidityUsd).toBe(910);
    expect(result.data?.[0]?.marketCapUsd).toBe(2000);
  });
});

describe('PonsPad adapter', () => {
  const adapter = createPonspadAdapter();

  it('normalizes launch listings with their declared links', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('ponspad-tokens.json') });
    const result = await adapter.fetch(
      { chainId: 4663 },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(hasData(result)).toBe(true);
    const listings = result.data ?? [];
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      expect(listing.contractAddress).toMatch(/^0x[a-f0-9]{40}$/);
      // Empty strings in the provider payload must not become empty links.
      for (const social of listing.socials) expect(social.url).toMatch(/^https?:\/\//);
    }
  });

  it('ignores a listing with no usable token address', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify({ tokens: [{ name: 'x', tokenAddress: 'not-an-address' }] }),
    });
    const result = await adapter.fetch(
      { chainId: 4663 },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.data).toEqual([]);
  });
});
