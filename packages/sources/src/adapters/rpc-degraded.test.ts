import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createErc20SupplyAdapter } from './erc20-supply';
import { createRpcContractAdapter } from './rpc';

/*
 * Graceful degradation (2026-09-24): a Robinhood Chain RPC that times out
 * must come back as a typed TIMEOUT — never a throw, never "not a contract",
 * never a zero supply.
 */
const RPC = 'https://rpc.robinhoodchain.example';
const ADDRESS = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

describe('RPC reads under a timeout', () => {
  it('reports a contract read that times out as TIMEOUT, not as an externally-owned address', async () => {
    const stub = stubFetch({ throws: timeout() });
    const result = await createRpcContractAdapter().fetch({ rpcUrl: RPC, address: ADDRESS }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.data).toBeUndefined();
  });

  it('recovers when a retry answers after one timeout', async () => {
    const stub = stubFetch([{ throws: timeout() }, { status: 200, body: '{"jsonrpc":"2.0","id":1,"result":"0x6080"}' }]);
    const result = await createRpcContractAdapter().fetch({ rpcUrl: RPC, address: ADDRESS }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data?.isContract).toBe(true);
  });

  it('reports a supply read that times out as TIMEOUT, never as a zero supply', async () => {
    const stub = stubFetch({ throws: timeout() });
    const result = await createErc20SupplyAdapter().fetch({ rpcUrl: RPC, address: ADDRESS.toLowerCase() }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.data).toBeUndefined();
  });

  it('reports a node that answers 503 as an upstream error', async () => {
    const stub = stubFetch({ status: 503 });
    const result = await createRpcContractAdapter().fetch({ rpcUrl: RPC, address: ADDRESS }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('UPSTREAM_ERROR');
    expect(result.data).toBeUndefined();
  });
});
