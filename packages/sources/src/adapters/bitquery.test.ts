import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { BITQUERY_BATCH_SIZE, BITQUERY_DEFAULT_BASE_URL, createBitqueryTradesAdapter, normalizeBitqueryTrades } from './bitquery';

/*
 * The fixture is hand-built from Bitquery's documented `DEXTradeByTokens`
 * shape (aggregates as strings, one row per token and venue) rather than
 * recorded, because the trial key lives only on the production host. The
 * first live run replaces it with a recorded body, keys redacted.
 */
const hey = '0xb33eb16782776b4d738c0fd643577cb0284db610';
const input = { addresses: [hey, '0x1740a3c5b6fb21044df973490b8095439dbb1b07', '0x44b7d533b21d9f6f00e61798db55ca4dda3d9b07'], since: new Date('2026-09-11T10:00:00Z'), apiKey: 'test-token' };
const trades = () => ({ status: 200, body: readFixture('bitquery-trades.json'), headers: { 'content-type': 'application/json' } });

describe('Bitquery trades adapter', () => {
  const adapter = createBitqueryTradesAdapter();

  it('takes up to a hundred contract addresses and needs a key', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ ...input, addresses: [] })).toBe(false);
    expect(adapter.canHandle({ ...input, addresses: ['not-an-address'] })).toBe(false);
    expect(adapter.canHandle({ ...input, apiKey: '' })).toBe(false);
    expect(adapter.canHandle({ ...input, addresses: Array.from({ length: BITQUERY_BATCH_SIZE + 1 }, (_, i) => `0x${String(i).padStart(40, '0')}`) })).toBe(false);
  });

  it('posts one GraphQL query with the addresses and the window, the key as a bearer token', async () => {
    const stub = stubFetch(trades());
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const request = stub.requests[0];
    expect(request?.url).toBe(BITQUERY_DEFAULT_BASE_URL);
    expect(request?.init?.method).toBe('POST');
    const headers = request?.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer test-token');
    const body = JSON.parse(String(request?.init?.body)) as { query: string; variables: { addresses: string[]; since: string } };
    expect(body.query).toContain('DEXTradeByTokens');
    expect(body.query).not.toMatch(/Balance|Holder/);
    expect(body.variables.addresses).toEqual(input.addresses);
    expect(body.variables.since).toBe('2026-09-11T10:00:00.000Z');
  });

  it('sums a token across venues, prices it from the newest trade and names the busiest venue', async () => {
    const stub = stubFetch(trades());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    const byAddress = Object.fromEntries((result.data ?? []).map((reading) => [reading.contractAddress, reading]));
    expect(byAddress[hey]).toMatchObject({ symbol: 'HEY', decimals: 18, trades: 41, lastPriceUsd: 0.0000835, venue: 'pons_v2', venueFamily: 'Uniswap' });
    expect(byAddress[hey]?.volumeUsd).toBeCloseTo(2046.701, 3);
    expect(byAddress[hey]?.lastTradeAt?.toISOString()).toBe('2026-09-12T10:02:55.000Z');
    // A venue row with no trades in the window carries no price and no time; nothing is invented.
    expect(byAddress['0x44b7d533b21d9f6f00e61798db55ca4dda3d9b07']).toMatchObject({ trades: 0, volumeUsd: 0 });
    expect(byAddress['0x44b7d533b21d9f6f00e61798db55ca4dda3d9b07']?.lastPriceUsd).toBeUndefined();
  });

  it('reports a GraphQL error as an unusable answer that names the field', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ errors: [{ message: 'Cannot query field "PriceInUSD" on type "Trade"' }] }), headers: { 'content-type': 'application/json' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('PriceInUSD');
  });

  it('refuses a body that is not the documented shape', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: { EVM: { DEXTradeByTokens: [{ Trade: {} }] } } }), headers: { 'content-type': 'application/json' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('normalises an empty answer to no readings', () => {
    expect(normalizeBitqueryTrades([])).toEqual([]);
  });
});
