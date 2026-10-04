import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createRpcBlockNumberAdapter, createRpcBlockTimestampAdapter, createRpcBlockTimestampBatchAdapter, createRpcLogCountAdapter, createRpcTransactionTargetBatchAdapter, isLogWindowTooLarge } from './rpc-logs';

const RPC = 'https://rpc.example/';
const TOKEN = '0xB33eb16782776b4D738c0Fd643577cb0284Db610';

describe('rpc log count', () => {
  it('counts the logs the node returns for the window and never caches', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-getlogs.json') });
    const result = await createRpcLogCountAdapter().fetch({ rpcUrl: RPC, address: TOKEN, fromBlock: 61_000_000, toBlock: 61_851_106 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual({ address: TOKEN, fromBlock: 61_000_000, toBlock: 61_851_106, count: 3 });
    expect(result.cacheTtlSeconds).toBe(0);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: [{ address: string; fromBlock: string; toBlock: string }] };
    expect(body.method).toBe('eth_getLogs');
    expect(body.params[0]).toEqual({ address: TOKEN, fromBlock: `0x${(61_000_000).toString(16)}`, toBlock: `0x${(61_851_106).toString(16)}` });
  });

  it('reports a window the node refuses as an invalid response the caller can split on', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-getlogs-timeout.json') });
    const result = await createRpcLogCountAdapter().fetch({ rpcUrl: RPC, address: TOKEN, fromBlock: 1, toBlock: 6_000_000 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.errorCode).toBe('INVALID_RESPONSE');
    expect(isLogWindowTooLarge(result.errorMessage)).toBe(true);
    expect(isLogWindowTooLarge('missing rpc result')).toBe(false);
  });

  it('refuses a window that runs backwards before asking', () => {
    expect(createRpcLogCountAdapter().canHandle({ rpcUrl: RPC, address: TOKEN, fromBlock: 10, toBlock: 9 })).toBe(false);
  });
});

describe('rpc head and block timestamp', () => {
  it('reads the head block number', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-blocknumber.json') });
    const result = await createRpcBlockNumberAdapter().fetch({ rpcUrl: RPC }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toEqual({ blockNumber: 0x3a2a4f9 });
  });

  it('reads a block timestamp', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-block.json') });
    const result = await createRpcBlockTimestampAdapter().fetch({ rpcUrl: RPC, blockNumber: 0x3a2a4f9 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toEqual({ blockNumber: 0x3a2a4f9, timestamp: new Date(0x6ac2a9c0 * 1000) });
  });
});

describe('rpc block batch', () => {
  it('maps every block the node answered for, and leaves out the ones it did not', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 0, result: { number: '0x3c22909', timestamp: '0x68c74e2f' } },
        // Out of order on purpose: a batch reply may come back in any order,
        // so the id is what maps a result to its block, never the position.
        { jsonrpc: '2.0', id: 2, result: { number: '0x128f', timestamp: '0x682c1f97' } },
        { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'block not found' } },
      ]),
    });

    const result = await createRpcBlockTimestampBatchAdapter().fetch(
      { rpcUrl: RPC, blockNumbers: [0x3c22909, 0x999999, 0x128f] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.status).toBe('fresh');
    const stamps = result.data!.stamps;
    expect(stamps.size).toBe(2);
    expect(stamps.get(0x3c22909)?.toISOString()).toBe(new Date(0x68c74e2f * 1000).toISOString());
    expect(stamps.get(0x128f)?.toISOString()).toBe(new Date(0x682c1f97 * 1000).toISOString());
    // The refused block is absent rather than defaulted: absent means unread.
    expect(stamps.has(0x999999)).toBe(false);

    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: unknown[] }[];
    expect(body).toHaveLength(3);
    expect(body[0]).toMatchObject({ method: 'eth_getBlockByNumber', params: ['0x3c22909', false] });
  });

  it('refuses an empty answer rather than reporting nothing found', async () => {
    const stub = stubFetch({ status: 200, body: '[]' });
    const result = await createRpcBlockTimestampBatchAdapter().fetch(
      { rpcUrl: RPC, blockNumbers: [1] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.status).not.toBe('fresh');
  });
});

describe('rpc transaction targets (2026-10-04)', () => {
  const POOL_FACTORY_TX = '0xcc0715f8fd6ccd32dd54c4937a9b30bfe6f3de089eb3a7e5e8cee6ee138e05f1';
  const DIRECT_TX = '0x64619f716672c4247faa95e81686719cbee2658628aac3dd1ddd1d768e788d69';
  const UNKNOWN_TX = `0x${'ab'.repeat(32)}`;

  it('keeps only where each transaction was sent, by hash, and leaves an unknown transaction out', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-gettransactionbyhash-batch.json') });
    const result = await createRpcTransactionTargetBatchAdapter().fetch(
      { rpcUrl: RPC, txHashes: [POOL_FACTORY_TX, DIRECT_TX.toUpperCase().replace('0X', '0x'), UNKNOWN_TX] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.status).toBe('fresh');
    expect([...result.data!.targets]).toEqual([
      [POOL_FACTORY_TX, '0xbe183de7bb93346a41769c44f47cb588d164df2d'],
      [DIRECT_TX, '0x8366a39cc670b4001a1121b8f6a443a643e40951'],
    ]);
    // Nothing but the target leaves the adapter: no sender, no input.
    expect(JSON.stringify([...result.data!.targets])).not.toMatch(/3bcd53b331b6054b4c0e45a26ad58a142d910ade/);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: unknown[] }[];
    expect(body).toHaveLength(3);
    expect(body[1]).toMatchObject({ method: 'eth_getTransactionByHash', params: [DIRECT_TX] });
  });

  it('refuses a batch with something that is not a transaction hash before asking', () => {
    expect(createRpcTransactionTargetBatchAdapter().canHandle({ rpcUrl: RPC, txHashes: ['0x1234'] })).toBe(false);
    expect(createRpcTransactionTargetBatchAdapter().canHandle({ rpcUrl: RPC, txHashes: [] })).toBe(false);
  });
});
