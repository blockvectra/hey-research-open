import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createDexscreenerSearchAdapter } from './dexscreener-search';

const input = { chainId: 4663, chainSlug: 'robinhood', query: 'robinhood chain' };
const fixture = () => ({ status: 200, body: readFixture('dexscreener-search.json') });

describe('DEX Screener search discovery adapter', () => {
  const adapter = createDexscreenerSearchAdapter();

  it('yields candidates only for the configured chain', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.map((c) => c.symbol)).toEqual(['AOS', 'DCP']);
    expect(result.data?.every((c) => c.chainId === 4663)).toBe(true);
  });

  it('collapses several pairs sharing one base token into a single candidate', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    // The fixture lists the same token twice, in checksum and lowercase form.
    expect(result.data?.filter((c) => c.symbol === 'AOS')).toHaveLength(1);
  });

  it('drops entries whose base token address is malformed', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.map((c) => c.contractAddress)).not.toContain('not-an-address');
  });

  it('records provenance on every candidate', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.every((c) => c.discoveredVia === 'dexscreener-search')).toBe(true);
  });

  it('degrades without throwing when the provider is down', async () => {
    const stub = stubFetch({ status: 503 });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
  });
});
