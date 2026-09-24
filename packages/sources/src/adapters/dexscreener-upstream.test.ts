import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createDexscreenerAdapter } from './dexscreener';

/*
 * Graceful degradation (2026-09-24): a DEX Screener outage must come back as
 * a typed error, never as a token with no market (which is `missing`) and
 * never as a zero price or liquidity.
 */
const input = { chainId: 4663, tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };

describe('DEX Screener adapter under failure', () => {
  const adapter = createDexscreenerAdapter();

  it('reports a 500 as an upstream error, distinct from a token with no pairs', async () => {
    const stub = stubFetch({ status: 500, body: 'Internal Server Error' });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('UPSTREAM_ERROR');
    expect(result.data).toBeUndefined();
  });

  it('reports a truncated JSON body as INVALID_RESPONSE with no reading', async () => {
    const stub = stubFetch({ status: 200, body: '{"schemaVersion":"1.0.0","pairs":[{"chainId":"robinhood","priceUsd":"0.1"', headers: { 'content-type': 'application/json' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
    expect(result.data).toBeUndefined();
  });

  it('reports a pairs field of the wrong type as INVALID_RESPONSE rather than an empty market', async () => {
    const stub = stubFetch({ status: 200, body: '{"pairs":"nope"}', headers: { 'content-type': 'application/json' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
