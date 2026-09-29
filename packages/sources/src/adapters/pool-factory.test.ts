import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createPoolFactoryBatchAdapter, decodeAbiAddress, decodeAggregate3Calls, FACTORY_CALL, MULTICALL3_ADDRESS, POOL_FACTORY_BATCH_SIZE } from './multicall';

/**
 * Which factory made a pool (2026-09-30), against an answer saved from
 * Robinhood Chain's public RPC on 2026-09-30: a pool DEX Screener calls
 * `uniswap`, one GeckoTerminal calls `uniswap-v2-robinhood`, one it calls
 * `uniswap-v3-robinhood`, one it calls `virtuals-robinhood`, and an address
 * with no code.
 */
const POOLS = [
  '0x8c244e08f68c992e7336394b65d2a6551bd57ada',
  '0x502be3da0ad1c83c79a9e64ac5a05eec39a44c78',
  '0xd6cb23b2c52a2769995c69829c9b8d86d848b4d5',
  '0x8ddae740c42e64ebf60b2b703bb9026c4b667039',
  '0x000000000000000000000000000000000000dead',
];
/** Uniswap's own published factories on chain 4663 (developers.uniswap.org/deployments.json). */
const V2_FACTORY = '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f';
const V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';

describe('createPoolFactoryBatchAdapter', () => {
  it('pins the selector to keccak("factory()") (cross-checked with viem in the domain deployments test)', () => {
    expect(FACTORY_CALL).toBe('0xc45a0155');
  });

  it('asks every pool for its factory in one eth_call to Multicall3', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-pool-factory-batch.json') });
    const result = await createPoolFactoryBatchAdapter().fetch({ rpcUrl: 'https://rpc.example', pools: POOLS }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.callCount()).toBe(1);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: [{ to: string; data: string }, string] };
    expect(body.method).toBe('eth_call');
    expect(body.params[0].to).toBe(MULTICALL3_ADDRESS);
    const calls = decodeAggregate3Calls(body.params[0].data);
    expect(calls?.map((call) => call.target)).toEqual(POOLS);
    expect(calls?.every((call) => call.callData === FACTORY_CALL && call.allowFailure)).toBe(true);

    expect(result.status).toBe('fresh');
    expect(result.data).toEqual([
      { pool: POOLS[0], factory: V3_FACTORY },
      { pool: POOLS[1], factory: V2_FACTORY },
      { pool: POOLS[2], factory: V3_FACTORY },
      // A Virtuals pool has no factory(): a reading, not Uniswap, and not an error.
      { pool: POOLS[3] },
      // No code at the address answers "success" with nothing.
      { pool: POOLS[4] },
    ]);
  });

  it('treats an RPC error as no answer for the batch, never as a hundred pools without a factory', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'header not found' } }) });
    const result = await createPoolFactoryBatchAdapter().fetch({ rpcUrl: 'https://rpc.example', pools: POOLS }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toBeUndefined();
    expect(result.status).toBe('error');
  });

  it('refuses a malformed pool, an empty batch or an oversized one without asking', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-pool-factory-batch.json') });
    const adapter = createPoolFactoryBatchAdapter();
    for (const pools of [[], ['0x123'], ['0x8c244e08f68c992e7336394b65d2a6551bd57ada00'], Array.from({ length: POOL_FACTORY_BATCH_SIZE + 1 }, () => POOLS[0]!)]) {
      const result = await adapter.fetch({ rpcUrl: 'https://rpc.example', pools }, testContext({ fetchImpl: stub.fetchImpl }));
      expect(result.data).toBeUndefined();
    }
    expect(stub.callCount()).toBe(0);
  });

  it('reads an address word strictly: no dirty high bytes, no zero address', () => {
    expect(decodeAbiAddress(`0x${'0'.repeat(24)}${V2_FACTORY.slice(2)}`)).toBe(V2_FACTORY);
    expect(decodeAbiAddress(`0x${'0'.repeat(23)}1${V2_FACTORY.slice(2)}`)).toBeUndefined();
    expect(decodeAbiAddress(`0x${'0'.repeat(64)}`)).toBeUndefined();
    expect(decodeAbiAddress('0x')).toBeUndefined();
  });
});
