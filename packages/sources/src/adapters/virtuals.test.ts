import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createVirtualsAdapter, VIRTUALS_DEFAULT_BASE_URL } from './virtuals';

/**
 * Contract test for the largest launch source. Until 2026-09-04 this adapter
 * was the one production intake with no saved fixture, so a schema change at
 * Virtuals would have been discovered in the worker log.
 */
const input = { chainId: 4663, page: 1 };
const fixture = () => ({ status: 200, body: readFixture('virtuals-agents.json') });

describe('Virtuals adapter', () => {
  const adapter = createVirtualsAdapter();

  it('handles only real pages on a real chain', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ chainId: 4663, page: 0 })).toBe(false);
    expect(adapter.canHandle({ chainId: 0, page: 1 })).toBe(false);
  });

  it('asks for the Robinhood Chain slice, oldest first, in the request itself', async () => {
    const stub = stubFetch(fixture());
    await adapter.fetch({ chainId: 4663, page: 7, pageSize: 500 }, testContext({ fetchImpl: stub.fetchImpl }));

    const url = stub.requests[0]?.url ?? '';
    expect(url.startsWith(VIRTUALS_DEFAULT_BASE_URL)).toBe(true);
    expect(url).toContain('filters%5Bchain%5D=ROBINHOOD');
    expect(url).toContain('pagination%5Bpage%5D=7');
    // The provider caps page size; asking for more is clamped, not forwarded.
    expect(url).toContain('pagination%5BpageSize%5D=100');
    expect(url).toContain('sort=createdAt%3Aasc');
  });

  it('reads an empty tokenAddress as "not graduated" and keeps the agent at its pre-token (2026-09-17)', async () => {
    const body = JSON.parse(readFixture('virtuals-agents.json')) as { data: Record<string, unknown>[] };
    body.data[0] = { ...body.data[0], tokenAddress: '' };
    const stub = stubFetch({ status: 200, body: JSON.stringify(body) });
    const result = await createVirtualsAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    const scout = result.data?.agents.find((agent) => agent.symbol === 'SCOUT');
    expect(scout?.contractAddress).toBe('0x1111111111111111111111111111111111111111');
  });

  it('keeps only chain-4663 agents with a real contract address', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.total).toBe(25253);
    // BASE agent and the malformed address are dropped; two remain.
    expect(result.data?.agents.map((agent) => agent.symbol)).toEqual(['SCOUT', 'GFOX']);
    expect(result.data?.agents.every((agent) => agent.chainId === 4663)).toBe(true);
  });

  it('carries verified links, the service id and artwork, and invents nothing', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const [scout, fox] = result.data?.agents ?? [];

    expect(scout).toMatchObject({
      contractAddress: '0x1111111111111111111111111111111111111111',
      agentId: 'a1f0c0f2-9b2f-4d3a-8b5e-000000000001',
      graduated: false,
      verifiedWebsite: 'https://sherwoodscout.example/',
      verifiedTwitter: 'https://x.com/sherwoodscout',
      serviceId: '9021',
      imageUrl: 'https://s3.ap-southeast-1.amazonaws.com/virtualprotocolcdn/scout.png',
      officialUrl: 'https://app.virtuals.io/virtuals/40112',
    });
    expect(scout?.createdAt?.toISOString()).toBe('2026-08-30T09:12:44.000Z');

    // A graduated agent is identified by its full token, not its pre-token.
    expect(fox?.contractAddress).toBe('0x2222222222222222222222222222222222222222');
    expect(fox?.graduated).toBe(true);
    // Empty and non-URL links are absent rather than empty strings.
    expect(fox).not.toHaveProperty('verifiedWebsite');
    expect(fox).not.toHaveProperty('verifiedTwitter');
    expect(fox).not.toHaveProperty('imageUrl');
    expect(fox).not.toHaveProperty('serviceId');
  });

  it('rejects a payload that is not the API shape', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: 'nope' }) });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('reports a rate limit with the advertised cool-off', async () => {
    const stub = stubFetch({ status: 429, headers: { 'retry-after': '30' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(30);
  });
});
