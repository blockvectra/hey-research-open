import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createHoodlockLockBatchAdapter, createHoodlockTotalLocksAdapter } from './hoodlock';

/*
 * Graceful degradation (2026-09-24): a HoodLock read that fails must never
 * read as "no locks" (total 0) or "every lock released" (an empty batch).
 * The sweep in packages/domain/src/contracts/hoodlock.ts relies on
 * `hasData` being false for exactly these cases.
 */
const RPC = 'https://rpc.example/';
const timeout = () => Object.assign(new Error('aborted'), { name: 'TimeoutError' });

describe('hoodlock total locks under failure', () => {
  const adapter = createHoodlockTotalLocksAdapter();

  it('reports a timeout as TIMEOUT, never as zero locks', async () => {
    const stub = stubFetch({ throws: timeout() });
    const result = await adapter.fetch({ rpcUrl: RPC }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.data).toBeUndefined();
  });

  it('reports a reverted totalLocks call as INVALID_RESPONSE, never as zero locks', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify([{ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } }]) });
    const result = await adapter.fetch({ rpcUrl: RPC }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('reports a node rate limit as rate_limited so the sweep pauses', async () => {
    const stub = stubFetch({ status: 429, headers: { 'retry-after': '30' } });
    const result = await adapter.fetch({ rpcUrl: RPC }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.data).toBeUndefined();
  });
});

describe('hoodlock lock batch under failure', () => {
  const adapter = createHoodlockLockBatchAdapter();

  it('reports a 502 as an error, not as an empty (all-released) batch', async () => {
    const stub = stubFetch({ status: 502 });
    const result = await adapter.fetch({ rpcUrl: RPC, lockIds: [0, 1] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.errorCode).toBe('UPSTREAM_ERROR');
    expect(result.data).toBeUndefined();
  });

  it('reports a whole-batch JSON-RPC error object as INVALID_RESPONSE, not as an empty batch', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'limit exceeded' } }) });
    const result = await adapter.fetch({ rpcUrl: RPC, lockIds: [0, 1] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.errorCode).toBe('INVALID_RESPONSE');
    expect(result.data).toBeUndefined();
  });
});
