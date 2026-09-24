import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createBitqueryTradesAdapter } from './bitquery';

/*
 * Graceful degradation (2026-09-24): a Bitquery outage or refusal must come
 * back as a typed result the caller can defer on — never a throw, never an
 * empty list of trades that would read as "nothing traded".
 */
const input = {
  addresses: ['0xb33eb16782776b4d738c0fd643577cb0284db610'],
  since: new Date('2026-09-11T10:00:00Z'),
  lookback: new Date('2026-09-05T10:00:00Z'),
  apiKey: 'test-token',
};
const json = { 'content-type': 'application/json' };

describe('Bitquery trades adapter under failure', () => {
  const adapter = createBitqueryTradesAdapter();

  it('reports a 500 as an upstream error with no readings, not as zero trades', async () => {
    const stub = stubFetch({ status: 500, body: '{"error":"internal"}', headers: json });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('UPSTREAM_ERROR');
    expect(result.data).toBeUndefined();
  });

  it('reports a 429 as rate_limited with the advertised wait, after exactly one request', async () => {
    const stub = stubFetch({ status: 429, body: '{"error":"too many requests"}', headers: { ...json, 'retry-after': '120' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.errorCode).toBe('RATE_LIMITED');
    expect(result.retryAfterSeconds).toBe(120);
    expect(result.data).toBeUndefined();
    // A 429 is never retried in-process: the points are not spent twice.
    expect(stub.callCount()).toBe(1);
  });

  it('reports a points-exhausted GraphQL answer as rate_limited, so the caller waits instead of calling it an outage', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ errors: [{ message: 'Points limit exceeded' }] }), headers: json });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.status).toBe('rate_limited');
    expect(result.errorCode).toBe('RATE_LIMITED');
    expect(result.errorMessage).toContain('Points limit exceeded');
    expect(result.data).toBeUndefined();
  });

  it('reports a query the provider rejects as an unusable answer, and a provider timeout as upstream', async () => {
    const rejected = stubFetch({ status: 200, body: JSON.stringify({ errors: [{ message: 'Cannot query field "Nope" on type "EVM"' }] }), headers: json });
    expect((await adapter.fetch(input, testContext({ fetchImpl: rejected.fetchImpl }))).errorCode).toBe('INVALID_RESPONSE');
    const slow = stubFetch({ status: 200, body: JSON.stringify({ errors: [{ message: 'query timed out' }] }), headers: json });
    expect((await adapter.fetch(input, testContext({ fetchImpl: slow.fetchImpl }))).errorCode).toBe('UPSTREAM_ERROR');
  });

  it('reports a 402 (plan / points refusal) as an error with no readings', async () => {
    const stub = stubFetch({ status: 402, body: '{"error":"payment required"}', headers: json });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
  });

  it('reports a network failure without throwing', async () => {
    const stub = stubFetch({ throws: new TypeError('fetch failed') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('NETWORK');
    expect(result.data).toBeUndefined();
  });
});
