import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createErc8004RegistrationAdapter, ERC8004_IDENTITY_REGISTRY_ADDRESS, ERC8004_REGISTERED_TOPIC } from './erc8004-registry';
import { isLogWindowTooLarge } from './rpc-logs';

/**
 * The ERC-8004 registration reader (2026-10-14): one `eth_getLogs` per window, counts per block, nothing
 * else. The fixture's first log is HEY's own registration as the node returned it (transaction
 * 0x9cffd268…f29e, agentId 8783); the second is synthetic and carries no `blockTimestamp`; the third
 * repeats the first.
 */
const RPC = 'https://rpc.example/';
const HEY_BLOCK = 87_277_370;

describe('ERC-8004 Registered logs', () => {
  it('pins the topic HEY’s own registration log carries (cross-checked with viem in the domain registrations test)', () => {
    const answer = JSON.parse(readFixture('rpc-erc8004-registered.json')) as { result: { topics: string[] }[] };
    expect(answer.result[0]!.topics[0]).toBe(ERC8004_REGISTERED_TOPIC);
  });

  it('asks for the registry and the one topic over the window, and never caches', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-erc8004-registered.json') });
    const result = await createErc8004RegistrationAdapter().fetch({ rpcUrl: RPC, fromBlock: 87_000_000, toBlock: 87_300_000 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.cacheTtlSeconds).toBe(0);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: [Record<string, unknown>] };
    expect(body.method).toBe('eth_getLogs');
    // One value per topic position: the node serves ten million blocks a request for that shape.
    expect(body.params[0]).toEqual({ address: ERC8004_IDENTITY_REGISTRY_ADDRESS, topics: [ERC8004_REGISTERED_TOPIC], fromBlock: `0x${(87_000_000).toString(16)}`, toBlock: `0x${(87_300_000).toString(16)}` });
  });

  it('counts registrations per block, a repeated log once, and keeps nothing but the block, its time and the count', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-erc8004-registered.json') });
    const result = await createErc8004RegistrationAdapter().fetch({ rpcUrl: RPC, fromBlock: 87_000_000, toBlock: 87_300_000 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toEqual({
      fromBlock: 87_000_000,
      toBlock: 87_300_000,
      blocks: [
        { blockNumber: HEY_BLOCK, registrations: 1, at: new Date(0x6acdc573 * 1000) },
        // No blockTimestamp on the log: unread, never a made-up time.
        { blockNumber: HEY_BLOCK + 5000, registrations: 1, at: null },
      ],
    });
    expect(result.data!.blocks[0]!.at!.toISOString()).toBe('2026-10-13T05:45:23.000Z');
    // No owner, agent id, URI or transaction survives the adapter.
    const printed = JSON.stringify(result.data);
    expect(printed).not.toMatch(/fdfbcae9|224f|9cffd268|https|0x[0-9a-f]{40}/i);
  });

  it('does not count a log the node marks removed', async () => {
    const answer = JSON.parse(readFixture('rpc-erc8004-registered.json')) as { result: Record<string, unknown>[] };
    answer.result = answer.result.map((log) => ({ ...log, removed: true }));
    const stub = stubFetch({ status: 200, body: JSON.stringify(answer) });
    const result = await createErc8004RegistrationAdapter().fetch({ rpcUrl: RPC, fromBlock: 1, toBlock: 2 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.blocks).toEqual([]);
  });

  it('refuses a window whose answer holds another contract’s or another event’s log, rather than half-count it', async () => {
    for (const change of [{ address: '0x0000000000000000000000000000000000000001' }, { topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x0', '0x0'] }]) {
      const answer = JSON.parse(readFixture('rpc-erc8004-registered.json')) as { result: Record<string, unknown>[] };
      answer.result[0] = { ...answer.result[0], ...change };
      const stub = stubFetch({ status: 200, body: JSON.stringify(answer) });
      const result = await createErc8004RegistrationAdapter().fetch({ rpcUrl: RPC, fromBlock: 1, toBlock: 2 }, testContext({ fetchImpl: stub.fetchImpl }));
      expect(hasData(result)).toBe(false);
      expect(result.errorCode).toBe('INVALID_RESPONSE');
    }
  });

  it('reports the node’s range limit as a window the caller halves', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-getlogs-range-limit.json') });
    const result = await createErc8004RegistrationAdapter().fetch({ rpcUrl: RPC, fromBlock: 0, toBlock: 87_948_756 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(isLogWindowTooLarge(result.errorMessage)).toBe(true);
  });

  it('reads an answer with no result and no error as an error, never as an empty window', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1 }) });
    const result = await createErc8004RegistrationAdapter().fetch({ rpcUrl: RPC, fromBlock: 1, toBlock: 2 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(isLogWindowTooLarge(result.errorMessage)).toBe(false);
  });

  it('refuses a window that runs backwards before asking', () => {
    expect(createErc8004RegistrationAdapter().canHandle({ rpcUrl: RPC, fromBlock: 10, toBlock: 9 })).toBe(false);
  });
});
