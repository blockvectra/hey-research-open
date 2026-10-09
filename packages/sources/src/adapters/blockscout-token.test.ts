import { describe, expect, it } from 'vitest';

import { hasData, type SourceResult } from '../adapter';
import { explorerChainApiUrl } from '../http/explorer-api';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  blockscoutUnits,
  createBlockscoutTokenAdapter,
  createBlockscoutTokenCountersAdapter,
  createBlockscoutTokenHoldersAdapter,
} from './blockscout-token';

const API = { baseUrl: 'https://api.blockscout.com', chainId: 4663, apiKey: 'free_tier_key' };
const TOKEN = '0xA1B2C3D4E5F60718293A4B5C6D7E8F9012345678';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const stub = (fixture: string, status = 200) => stubFetch({ status, body: readFixture(fixture), headers: JSON_HEADERS });

describe('Blockscout API token reads (free tier, key required; 2026-10-10)', () => {
  it('puts the chain in the path and the key in the query, and only for the keyed API', () => {
    expect(explorerChainApiUrl(API, '/api/v2/tokens/0xabc/counters')).toBe('https://api.blockscout.com/4663/api/v2/tokens/0xabc/counters?apikey=free_tier_key');
    // The instance, a missing key or a missing chain: no URL, so no request.
    expect(explorerChainApiUrl({ baseUrl: 'https://robinhoodchain.blockscout.com', chainId: 4663, apiKey: 'k' }, '/api/v2/tokens/0xabc')).toBeUndefined();
    expect(explorerChainApiUrl({ baseUrl: 'https://api.blockscout.com', chainId: 4663 }, '/api/v2/tokens/0xabc')).toBeUndefined();
    expect(explorerChainApiUrl({ baseUrl: 'https://api.blockscout.com', apiKey: 'k' }, '/api/v2/tokens/0xabc')).toBeUndefined();
  });

  it('reads the token record: supply in base units, decimals, the explorer’s holder count', async () => {
    const fetch = stub('blockscout-token-record.json');
    const result = await createBlockscoutTokenAdapter().fetch({ ...API, address: TOKEN }, testContext({ fetchImpl: fetch.fetchImpl }));
    expect(fetch.requests[0]?.url).toBe(`https://api.blockscout.com/4663/api/v2/tokens/${TOKEN.toLowerCase()}?apikey=free_tier_key`);
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual({ type: 'ERC-20', totalSupplyRaw: '1000000000000000000000000', decimals: 18, holdersCount: 412 });
    // The key never comes back on an echoed URL.
    expect(result.sourceUrl).not.toContain('free_tier_key');
  });

  it('reads the counters: holders and the all-time transfer count', async () => {
    const fetch = stub('blockscout-token-counters.json');
    const result = await createBlockscoutTokenCountersAdapter().fetch({ ...API, address: TOKEN }, testContext({ fetchImpl: fetch.fetchImpl }));
    expect(fetch.requests[0]?.url).toBe(`https://api.blockscout.com/4663/api/v2/tokens/${TOKEN.toLowerCase()}/counters?apikey=free_tier_key`);
    expect(result.data).toEqual({ holdersCount: 412, transfersCount: 98765 });
  });

  it('reads one page of the largest balances: each address once, zero balances dropped, lower-cased', async () => {
    const fetch = stub('blockscout-token-holders.json');
    const result = await createBlockscoutTokenHoldersAdapter().fetch({ ...API, address: TOKEN }, testContext({ fetchImpl: fetch.fetchImpl }));
    expect(fetch.requests).toHaveLength(1);
    expect(fetch.requests[0]?.url).toBe(`https://api.blockscout.com/4663/api/v2/tokens/${TOKEN.toLowerCase()}/holders?apikey=free_tier_key`);
    expect(result.data?.more).toBe(true);
    expect(result.data?.holders.map((holder) => holder.valueRaw)).toEqual([
      '400000000000000000000000',
      '150000000000000000000000',
      '100000000000000000000000',
      '50000000000000000000000',
    ]);
    expect(result.data?.holders[2]?.address).toBe('0x000000000000000000000000000000000000dead');
    expect(blockscoutUnits('150000000000000000000000', 18)).toBe(150_000);
  });

  it('leaves a figure the explorer did not give absent, never 0', async () => {
    const fetch = stubFetch({ status: 200, body: JSON.stringify({ total_supply: null, decimals: '18', holders_count: 'n/a' }), headers: JSON_HEADERS });
    const result = await createBlockscoutTokenAdapter().fetch({ ...API, address: TOKEN }, testContext({ fetchImpl: fetch.fetchImpl }));
    expect(result.data).toEqual({ decimals: 18 });
    const counters = stubFetch({ status: 200, body: JSON.stringify({ token_holders_count: '5', transfers_count: null }), headers: JSON_HEADERS });
    expect((await createBlockscoutTokenCountersAdapter().fetch({ ...API, address: TOKEN }, testContext({ fetchImpl: counters.fetchImpl }))).data).toEqual({ holdersCount: 5 });
  });

  it('reads "Network not supported" as no record, never an empty one', async () => {
    const adapters: { fetch: (input: typeof API & { address: string }, context: ReturnType<typeof testContext>) => Promise<SourceResult<unknown>> }[] = [
      createBlockscoutTokenAdapter(),
      createBlockscoutTokenCountersAdapter(),
      createBlockscoutTokenHoldersAdapter(),
    ];
    for (const adapter of adapters) {
      const ok = stub('blockscout-token-not-supported.json');
      const result = await adapter.fetch({ ...API, address: TOKEN }, testContext({ fetchImpl: ok.fetchImpl }));
      expect(hasData(result)).toBe(false);
      expect(result.errorCode).toBe('INVALID_RESPONSE');
    }
    const refused = stub('blockscout-token-not-supported.json', 404);
    const result = await createBlockscoutTokenHoldersAdapter().fetch({ ...API, address: TOKEN }, testContext({ fetchImpl: refused.fetchImpl }));
    expect(hasData(result)).toBe(false);
  });

  it('sends nothing without the key, to the instance, or for something that is not an address', async () => {
    const fetch = stub('blockscout-token-counters.json');
    const ctx = testContext({ fetchImpl: fetch.fetchImpl });
    expect((await createBlockscoutTokenCountersAdapter().fetch({ baseUrl: 'https://api.blockscout.com', chainId: 4663, address: TOKEN }, ctx)).errorCode).toBe('BLOCKED_URL');
    expect((await createBlockscoutTokenCountersAdapter().fetch({ baseUrl: 'https://robinhoodchain.blockscout.com', chainId: 4663, apiKey: 'k', address: TOKEN }, ctx)).errorCode).toBe('BLOCKED_URL');
    expect((await createBlockscoutTokenCountersAdapter().fetch({ ...API, address: '0x123' }, ctx)).errorCode).toBe('BLOCKED_URL');
    expect(fetch.requests).toHaveLength(0);
  });

  it('refuses an answer from another origin', async () => {
    const fetch = stubFetch({ status: 200, body: readFixture('blockscout-token-counters.json'), headers: JSON_HEADERS, url: 'https://elsewhere.example/4663/api/v2/tokens/x/counters' });
    const result = await createBlockscoutTokenCountersAdapter().fetch({ ...API, address: TOKEN }, testContext({ fetchImpl: fetch.fetchImpl }));
    expect(hasData(result)).toBe(false);
  });
});
