import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createBitqueryDiscoveryAdapter } from './bitquery';

const input = { since: new Date('2026-09-05T00:00:00Z'), count: 1000, offset: 2000, apiKey: 'test-token' };

describe('Bitquery discovery adapter', () => {
  const adapter = createBitqueryDiscoveryAdapter();

  it('pages by offset, a thousand rows at most, and needs a key', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ ...input, count: 1001 })).toBe(false);
    expect(adapter.canHandle({ ...input, offset: -1 })).toBe(false);
    expect(adapter.canHandle({ ...input, apiKey: '' })).toBe(false);
  });

  it('asks for the window and the page, and never for holders or balances', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-traded-tokens.json'), headers: { 'content-type': 'application/json' } });
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { query: string; variables: Record<string, unknown> };
    expect(body.variables).toEqual({ since: '2026-09-05T00:00:00.000Z', count: 1000, offset: 2000 });
    expect(body.query).not.toMatch(/Balance|Holder|BalanceUpdates/);
    expect(body.query).toContain('count(distinct: Transaction_From)');
  });

  it('groups a token across venues, keeps the busiest venue and the largest trader count, drops junk', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-traded-tokens.json'), headers: { 'content-type': 'application/json' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    const tokens = result.data ?? [];
    expect(tokens.map((token) => token.contractAddress)).toEqual(['0x1937cad42b17d43bb2b347ce16d5288887c46c33', '0x6b09c294ecc9fbe3285f0421eb76ebb6222ade64']);
    expect(tokens[0]).toMatchObject({ symbol: 'ANTHROPICx1L', name: 'Anthropic x1 Long', decimals: 18, trades: 472991, traders: 15534, venue: 'uniswap_v4', venueFamily: 'Uniswap' });
    expect(tokens[0]?.volumeUsd).toBeCloseTo(75026176.5, 1);
    expect(tokens[1]).toMatchObject({ symbol: 'Maple', venue: 'pons_v2', traders: 3643 });
  });
});
