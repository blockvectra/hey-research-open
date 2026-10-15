import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { scanFactory } from './indexer';
import {
  decodePonsLifecycleLog,
  isPonsLifecycleTopic,
  OR_TOPIC_MAX_BLOCK_RANGE,
  PONS_V2_GRADUATION_LOCKED_TOPIC0,
  PONS_V2_LAUNCH_SWEPT_TOPIC0,
  PONS_V2_LIFECYCLE_TOPICS,
  PONS_V2_POOL_GRADUATED_TOPIC0,
} from './pons-lifecycle';
import { factoryById } from './registry';

/**
 * The Pons V2 lifecycle decoder against logs read from chain 4663 on
 * 2026-10-15 (token 0x28e3c0c4…, swept in block 89,210,728 and graduated in
 * the next), and the launch scan that carries them in its one request.
 */
type RpcLog = { topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex?: string };
const fixture = JSON.parse(readFixture('pons-v2-lifecycle-logs.json')) as { result: RpcLog[] };
const TOKEN = '0x28e3c0c404088f1a5d739221072ddf6ab4431022';
const factory = factoryById('PONS_V2')!;
const noSleep = async () => {};

describe('decodePonsLifecycleLog', () => {
  it('decodes the sweep, the permanent lock and the graduation exactly as the chain reported them', () => {
    const [swept, locked, graduated] = fixture.result.map((log) => decodePonsLifecycleLog(log));
    expect(swept).toEqual({
      kind: 'swept',
      token: TOKEN,
      blockNumber: 89_210_728,
      txHash: '0x08ddeca95f5ed46d7656cad4d56e67dfeeb1272c181c94d335763b30988816a0',
      logIndex: 16,
      quoteOutRaw: '4200000000000000532',
      tokenOutRaw: '285714285714285714285714285',
    });
    expect(locked).toEqual({
      kind: 'locked',
      token: TOKEN,
      blockNumber: 89_210_729,
      txHash: '0x0e47abfd2cd4b2b69c2b293fa66ebe770eec38deed32ea9cd0646b362c104c09',
      logIndex: 16,
      // 81.63M tokens at 18 decimals.
      amountRaw: '81632653061224482410106900',
    });
    expect(graduated).toEqual({
      kind: 'graduated',
      token: TOKEN,
      blockNumber: 89_210_729,
      txHash: '0x0e47abfd2cd4b2b69c2b293fa66ebe770eec38deed32ea9cd0646b362c104c09',
      logIndex: 30,
      positionIdRaw: '3828001',
      // 204.08M tokens and 4.2 ETH seeded into the v4 position.
      tokenAmountRaw: '204081632653061231875607385',
      pairTokenAmountRaw: '4200000000000000532',
    });
  });

  it('drops a log that is not exactly one of the three events, never storing it half-read', () => {
    const graduated = fixture.result[2]!;
    // A launch log is not a lifecycle event.
    expect(decodePonsLifecycleLog({ ...graduated, topics: [factory.eventTopic0, graduated.topics[1]] })).toBeUndefined();
    // Too few or too many data words for the event.
    expect(decodePonsLifecycleLog({ ...graduated, data: graduated.data.slice(0, -64) })).toBeUndefined();
    expect(decodePonsLifecycleLog({ ...graduated, data: `${graduated.data}${'0'.repeat(64)}` })).toBeUndefined();
    // A token topic that is not a left-padded address.
    expect(decodePonsLifecycleLog({ ...graduated, topics: [graduated.topics[0], `0x${'f'.repeat(64)}`] })).toBeUndefined();
    // The token missing, or an extra indexed field.
    expect(decodePonsLifecycleLog({ ...graduated, topics: [graduated.topics[0]] })).toBeUndefined();
    expect(decodePonsLifecycleLog({ ...graduated, topics: [...graduated.topics, graduated.topics[1]] })).toBeUndefined();
    // A log a reorg removed, and a payload that is not a log at all.
    expect(decodePonsLifecycleLog({ ...graduated, removed: true })).toBeUndefined();
    expect(decodePonsLifecycleLog({ topics: 'nope' })).toBeUndefined();
    expect(decodePonsLifecycleLog(null)).toBeUndefined();
  });

  it('knows its three topics and nothing else', () => {
    expect(PONS_V2_LIFECYCLE_TOPICS).toEqual([PONS_V2_LAUNCH_SWEPT_TOPIC0, PONS_V2_POOL_GRADUATED_TOPIC0, PONS_V2_GRADUATION_LOCKED_TOPIC0]);
    for (const topic of PONS_V2_LIFECYCLE_TOPICS) expect(isPonsLifecycleTopic(topic)).toBe(true);
    expect(isPonsLifecycleTopic(factory.eventTopic0)).toBe(false);
    expect(isPonsLifecycleTopic(undefined)).toBe(false);
  });
});

describe('the Pons V2 launch scan reads the lifecycle in the same request', () => {
  const launch = {
    address: factory.factoryAddress,
    topics: [factory.eventTopic0, `0x${'0'.repeat(24)}${'ab'.repeat(20)}`, `0x${'0'.repeat(24)}${'99'.repeat(20)}`, `0x${'0'.repeat(24)}${'88'.repeat(20)}`],
    data: '0x',
    blockNumber: '0x5513f00',
    transactionHash: `0x${'12'.repeat(32)}`,
  };

  it('asks for the launch and the three lifecycle topics as one OR list, and keeps launches and lifecycle apart', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: [launch, ...fixture.result] }) });
    const result = await scanFactory(factory, { rpcUrl: 'https://rpc.example', fromBlock: 89_200_000, toBlock: 89_240_000, sleep: noSleep }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests).toHaveLength(1);
    const body = JSON.parse(String(stub.requests[0]!.init?.body)) as { params: { topics: unknown[] }[] };
    expect(body.params[0]!.topics).toEqual([[factory.eventTopic0, ...PONS_V2_LIFECYCLE_TOPICS]]);
    // The graduated token is never mistaken for a launch.
    expect(result.launches.map((entry) => entry.contractAddress)).toEqual([`0x${'ab'.repeat(20)}`]);
    expect(result.lifecycle.map((event) => event.kind)).toEqual(['swept', 'locked', 'graduated']);
    expect(result.lastIndexedBlock).toBe(89_240_000);
  });

  const windows = (requests: { init?: RequestInit }[]) =>
    requests.map((request) => {
      const [params] = (JSON.parse(String(request.init?.body)) as { params: { fromBlock: string; toBlock: string; topics: unknown[] }[] }).params;
      return { from: Number.parseInt(params!.fromBlock, 16), to: Number.parseInt(params!.toBlock, 16), orList: Array.isArray(params!.topics[0]) };
    });
  const empty = { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }) };

  it('reads an OR list over at most 100,000 blocks a request, the node’s ceiling for one', async () => {
    const start = factory.lifecycleStartBlock!;
    const stub = stubFetch([empty, empty, empty]);
    const result = await scanFactory(factory, { rpcUrl: 'https://rpc.example', fromBlock: start, toBlock: start + 250_000, sleep: noSleep }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(windows(stub.requests).map((window) => window.to - window.from + 1)).toEqual([OR_TOPIC_MAX_BLOCK_RANGE, OR_TOPIC_MAX_BLOCK_RANGE, 50_001]);
    expect(result.lastIndexedBlock).toBe(start + 250_000);
  });

  it('reads the launches before the lifecycle start at the single-topic pace, and never straddles it', async () => {
    const start = factory.lifecycleStartBlock!;
    expect(start).toBeGreaterThan(80_000_000);
    const stub = stubFetch([empty, empty, empty, empty]);
    await scanFactory(factory, { rpcUrl: 'https://rpc.example', fromBlock: start - 2_050_001, toBlock: start + 150_000, sleep: noSleep }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(windows(stub.requests)).toEqual([
      { from: start - 2_050_001, to: start - 50_001, orList: false },
      { from: start - 50_000, to: start - 1, orList: false },
      { from: start, to: start + 99_999, orList: true },
      { from: start + 100_000, to: start + 150_000, orList: true },
    ]);
  });

  it('asks only for the lifecycle when the backfill says so', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: fixture.result }) });
    const result = await scanFactory(
      factory,
      { rpcUrl: 'https://rpc.example', fromBlock: 89_200_000, toBlock: 89_240_000, sleep: noSleep, lifecycleOnly: true },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    const body = JSON.parse(String(stub.requests[0]!.init?.body)) as { params: { topics: unknown[] }[] };
    expect(body.params[0]!.topics).toEqual([[...PONS_V2_LIFECYCLE_TOPICS]]);
    expect(result.launches).toEqual([]);
    expect(result.lifecycle).toHaveLength(3);
  });

  it('never reads a lifecycle for a factory that has none (Pons V1 graduates into Uniswap v3)', async () => {
    expect(factoryById('PONS_V1')?.lifecycleTopics).toBeUndefined();
    await expect(scanFactory(factoryById('PONS_V1')!, { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 10, lifecycleOnly: true }, testContext())).rejects.toThrow(/no lifecycle topics/);
  });
});
