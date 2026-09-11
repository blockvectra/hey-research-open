import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createPairfundAdapter, PAIRFUND_DEFAULT_BASE_URL } from './pairfund';

const input = { chainId: 4663, page: 2 };
const fixture = () => ({
  status: 200,
  body: readFixture('pairfund-tokens.json'),
  headers: { etag: 'W/"5a6a0-UzFIm4HwdnImZBZbKLed3M81MPM"' },
});

describe('pair.fund tokens adapter', () => {
  const adapter = createPairfundAdapter();

  it('needs a chain and a page', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ chainId: 0, page: 1 })).toBe(false);
    expect(adapter.canHandle({ chainId: 4663, page: 0 })).toBe(false);
  });

  it('reads one page of the public tokens endpoint and keeps its validator', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests[0]?.url).toBe(`${PAIRFUND_DEFAULT_BASE_URL}/api/tokens?limit=100&page=2`);
    expect(hasData(result)).toBe(true);
    expect(result.etag).toBe('W/"5a6a0-UzFIm4HwdnImZBZbKLed3M81MPM"');
    expect(result.data?.total).toBe(1446);
    expect(result.data?.page).toBe(2);
    expect(result.data?.tokens.map((token) => token.symbol)).toEqual(['RKT', 'ROARING', 'Qubit']);
    expect(result.data?.tokens.every((token) => token.chainId === 4663)).toBe(true);
  });

  it('carries the launch record and the creator-declared links without inventing any', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const bySymbol = Object.fromEntries((result.data?.tokens ?? []).map((token) => [token.symbol, token]));

    // A launch with a website and an X post: the site is kept, the post is a social.
    expect(bySymbol['Qubit']).toMatchObject({
      contractAddress: '0x3bbae31ba522e23e9700345d2e1734355fbeb361',
      name: 'Qubit',
      websiteUrl:
        'https://blog.google/innovation-and-ai/products/qubit-dog-big-questions-quantum-computing/',
      socials: [{ type: 'twitter', url: 'https://x.com/pairdotfund/status/2094572351967142267' }],
      imageUrl: `${PAIRFUND_DEFAULT_BASE_URL}/api/images/6280a45850adc6adf84a4007f23d029cd1689019da4f0056de59c002de83013c`,
      launchTxHash: '0x86ab6ac2793c56a81cee803da073815b581150210e954ab436e597fa6accb637',
      creatorAddress: '0x460f7775d56c1980bc9a1a8979363fe96c75aeea',
      graduated: false,
      hidden: false,
    });
    expect(bySymbol['Qubit']?.launchTimestamp?.toISOString()).toBe(
      new Date(1788220085 * 1000).toISOString(),
    );
    expect(bySymbol['Qubit']?.pairAddress).toMatch(/^0x[a-f0-9]{64}$/);
    expect(bySymbol['Qubit']?.quoteSymbol).toBeTypeOf('string');

    // Nothing declared: nothing recorded.
    expect(bySymbol['RKT']).not.toHaveProperty('websiteUrl');
    expect(bySymbol['RKT']?.socials).toEqual([]);
    expect(bySymbol['RKT']?.name).toBe('Roaring Kitty');
  });

  it('rejects a payload that is not the endpoint shape', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ items: 'nope' }) });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('degrades without throwing when the launchpad is down', async () => {
    const stub = stubFetch({ status: 503 });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
  });
});
