import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  createCoingeckoCoinAdapter,
  createCoingeckoListAdapter,
  isCoingeckoTokenizedStock,
} from './coingecko';

const listInput = { chainId: 4663, platform: 'robinhood' };
const list = () => ({ status: 200, body: readFixture('coingecko-coins-list.json') });

describe('CoinGecko coins list adapter', () => {
  const adapter = createCoingeckoListAdapter();

  it('needs a chain and a platform id', () => {
    expect(adapter.canHandle(listInput)).toBe(true);
    expect(adapter.canHandle({ chainId: 4663, platform: '' })).toBe(false);
  });

  it('asks for the registry with platforms included', async () => {
    const stub = stubFetch(list());
    await adapter.fetch(listInput, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe(
      'https://api.coingecko.com/api/v3/coins/list?include_platform=true',
    );
  });

  it('keeps only coins with an address on the requested platform', async () => {
    const stub = stubFetch(list());
    const result = await adapter.fetch(listInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    // Five in the fixture; bitcoin has no platforms and 1000bonk an empty map.
    expect(result.data?.map((c) => c.id)).toEqual([
      '1inch',
      'agentos',
      'adobe-inc-robinhood-token',
    ]);
    expect(result.data?.every((c) => c.chainId === 4663)).toBe(true);
  });

  it('carries the registry identity and how many chains the coin spans', async () => {
    const stub = stubFetch(list());
    const result = await adapter.fetch(listInput, testContext({ fetchImpl: stub.fetchImpl }));
    const byId = Object.fromEntries((result.data ?? []).map((c) => [c.id, c]));

    expect(byId['1inch']).toMatchObject({
      contractAddress: '0x1755c2910c126ee1b0cf1e08a307dc9e787285a0',
      symbol: '1inch',
      name: '1INCH',
      platformCount: 10,
      isTokenizedStock: false,
    });
    expect(byId['agentos']).toMatchObject({ platformCount: 1, isTokenizedStock: false });
    expect(byId['adobe-inc-robinhood-token']).toMatchObject({
      contractAddress: '0x232b8ed6377be97813853b0ac104c4cda8378d1b',
      isTokenizedStock: true,
    });
  });

  it('rejects a payload that is not the registry', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ coins: [] }) });
    const result = await adapter.fetch(listInput, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});

describe('CoinGecko coin detail adapter', () => {
  const adapter = createCoingeckoCoinAdapter();
  const detail = (name: string) => ({ status: 200, body: readFixture(name) });

  it('accepts CoinGecko ids only', () => {
    expect(adapter.canHandle({ ...listInput, id: 'adobe-inc-robinhood-token' })).toBe(true);
    expect(adapter.canHandle({ ...listInput, id: '../coins' })).toBe(false);
    expect(adapter.canHandle({ ...listInput, id: '' })).toBe(false);
  });

  it('requests the coin without the market, tickers and community blocks', async () => {
    const stub = stubFetch(detail('coingecko-coin-agentos.json'));
    await adapter.fetch(
      { ...listInput, id: 'agentos' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(stub.requests[0]?.url).toBe(
      'https://api.coingecko.com/api/v3/coins/agentos?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false',
    );
  });

  it('carries the team-declared homepage, artwork, categories and handle', async () => {
    const stub = stubFetch(detail('coingecko-coin-agentos.json'));
    const result = await adapter.fetch(
      { ...listInput, id: 'agentos' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(hasData(result)).toBe(true);
    expect(result.data).toMatchObject({
      chainId: 4663,
      id: 'agentos',
      contractAddress: '0x6eda83fc299c10d474068a7e69771c809bcbbba3',
      symbol: 'agentos',
      name: 'AgentOS',
      websiteUrl: 'https://useagentos.dev/',
      categories: ['Artificial Intelligence (AI)', 'Robinhood Ecosystem'],
      twitterUrl: 'https://x.com/useAgentOS',
      githubUrls: [],
      isTokenizedStock: false,
    });
    expect(result.data?.imageUrl).toMatch(
      /^https:\/\/coin-images\.coingecko\.com\/coins\/images\/102174570\/small\//,
    );
    // The description is an empty string upstream: absent, not empty.
    expect(result.data).not.toHaveProperty('description');
  });

  it('reads a multi-chain coin against the requested platform address', async () => {
    const stub = stubFetch(detail('coingecko-coin-1inch.json'));
    const result = await adapter.fetch(
      { ...listInput, id: '1inch' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.data).toMatchObject({
      contractAddress: '0x1755c2910c126ee1b0cf1e08a307dc9e787285a0',
      websiteUrl: 'https://1inch.com/',
      githubUrls: ['https://github.com/1inch'],
      isTokenizedStock: false,
    });
    expect(result.data?.description).toMatch(/^1inch is the DeFi ecosystem/);
  });

  it("flags Robinhood's tokenized equities and keeps their homepage as given", async () => {
    const stub = stubFetch(detail('coingecko-coin-adobe-robinhood-token.json'));
    const result = await adapter.fetch(
      { ...listInput, id: 'adobe-inc-robinhood-token' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.data).toMatchObject({
      name: 'Adobe Inc. • Robinhood Token',
      isTokenizedStock: true,
      // The adapter reports what CoinGecko says; the job decides not to use
      // the issuer's docs as the project's website.
      websiteUrl: 'https://docs.robinhood.com/rhj',
    });
    expect(result.data?.categories).toContain('Tokenized Stocks');
  });

  it('reports a missing coin as missing', async () => {
    const stub = stubFetch({ status: 404, body: '{"error":"coin not found"}' });
    const result = await adapter.fetch(
      { ...listInput, id: 'nope' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.status).toBe('missing');
  });

  it('reports the free-tier rate limit rather than throwing', async () => {
    const stub = stubFetch({ status: 429, headers: { 'retry-after': '60' } });
    const result = await adapter.fetch(
      { ...listInput, id: 'agentos' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.status).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(60);
  });
});

describe('isCoingeckoTokenizedStock', () => {
  it('matches by id suffix or by category', () => {
    expect(isCoingeckoTokenizedStock('adobe-inc-robinhood-token')).toBe(true);
    expect(isCoingeckoTokenizedStock('some-id', ['Tokenized Stocks'])).toBe(true);
    expect(isCoingeckoTokenizedStock('some-id', ['tokenized stocks'])).toBe(true);
    expect(isCoingeckoTokenizedStock('agentos', ['Artificial Intelligence (AI)'])).toBe(false);
  });
});
