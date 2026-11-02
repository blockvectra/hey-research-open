import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  agentTopic,
  countFeedbackLogs,
  createErc8004FeedbackAdapter,
  emptyFeedbackValueCounts,
  ERC8004_FEEDBACK_REVOKED_TOPIC,
  ERC8004_NEW_FEEDBACK_TOPIC,
  ERC8004_REPUTATION_REGISTRY_ADDRESS,
  feedbackValueBucket,
  isLogHistoryNotServed,
  readFeedbackValue,
} from './erc8004-reputation';
import { isLogWindowTooLarge } from './rpc-logs';

/**
 * The ERC-8004 feedback reader (2026-11-02): one `eth_getLogs` per window and event, filtered to HEY's own agent,
 * counts and value buckets per block, nothing else. The fixtures are encoded with viem from the registry's ABI:
 * five `NewFeedback` logs for agentId 8783 from three made-up clients (values 100, 10.000000, −5, 87.5 and 250; the
 * fourth carries no `blockTimestamp`) with the first repeated, and one `FeedbackRevoked`.
 */
const RPC = 'https://rpc.example/';
const BLOCK = 96_431_600;
const read = (event: 'new' | 'revoked', body: string, agent = 8783) =>
  createErc8004FeedbackAdapter().fetch({ rpcUrl: RPC, fromBlock: 96_000_000, toBlock: 98_000_000, event, agent }, testContext({ fetchImpl: stubFetch({ status: 200, body }).fetchImpl }));

describe('ERC-8004 feedback logs', () => {
  it('asks for the reputation registry, one event and HEY’s agent only, one value per topic position, and never caches', async () => {
    for (const [event, topic] of [['new', ERC8004_NEW_FEEDBACK_TOPIC], ['revoked', ERC8004_FEEDBACK_REVOKED_TOPIC]] as const) {
      const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }) });
      const result = await createErc8004FeedbackAdapter().fetch({ rpcUrl: RPC, fromBlock: 1, toBlock: 100, event, agent: 8783 }, testContext({ fetchImpl: stub.fetchImpl }));
      expect(hasData(result)).toBe(true);
      expect(result.cacheTtlSeconds).toBe(0);
      const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: [Record<string, unknown>] };
      expect(body.method).toBe('eth_getLogs');
      expect(body.params[0]).toEqual({ address: ERC8004_REPUTATION_REGISTRY_ADDRESS, topics: [topic, '0x000000000000000000000000000000000000000000000000000000000000224f'], fromBlock: '0x1', toBlock: '0x64' });
    }
  });

  it('counts feedback per block with its value bucket, a repeated log once, and keeps nothing but blocks, times and counts', async () => {
    const result = await read('new', readFixture('rpc-erc8004-new-feedback.json'));
    expect(hasData(result)).toBe(true);
    const blocks = result.data!.blocks;
    expect(blocks.map((block) => [block.blockNumber, block.feedback, block.revoked])).toEqual([
      [BLOCK, 2, 0],
      [BLOCK + 864_000, 1, 0],
      [BLOCK + 864_100, 1, 0],
      [BLOCK + 864_200, 1, 0],
    ]);
    expect(blocks[0]!.values).toEqual({ ...emptyFeedbackValueCounts(), from80to100: 1, from0to20: 1 });
    expect(blocks[1]!.values).toEqual({ ...emptyFeedbackValueCounts(), below0: 1 });
    expect(blocks[2]!.values).toEqual({ ...emptyFeedbackValueCounts(), from80to100: 1 });
    expect(blocks[3]!.values).toEqual({ ...emptyFeedbackValueCounts(), above100: 1 });
    expect(blocks[0]!.at!.toISOString()).toBe('2026-11-02T01:00:00.000Z');
    // No blockTimestamp on the log: unread, never a made-up time.
    expect(blocks[2]!.at).toBeNull();
    // No client address, tag, endpoint, URI, hash or transaction survives the adapter.
    const printed = JSON.stringify(result.data);
    expect(printed).not.toMatch(/1111|2222|3333|starred|reachable|ipfs|heyresearch|cdcd|aaaa|0x[0-9a-f]{40}/i);
  });

  it('counts revocations per block, with no value', async () => {
    const result = await read('revoked', readFixture('rpc-erc8004-feedback-revoked.json'));
    expect(result.data!.blocks).toEqual([{ blockNumber: BLOCK + 864_300, feedback: 0, revoked: 1, values: emptyFeedbackValueCounts(), at: new Date('2026-11-03T00:15:00.000Z') }]);
    expect(JSON.stringify(result.data)).not.toMatch(/1111/);
  });

  it('does not count a log the node marks removed', async () => {
    const answer = JSON.parse(readFixture('rpc-erc8004-new-feedback.json')) as { result: Record<string, unknown>[] };
    answer.result = answer.result.map((log) => ({ ...log, removed: true }));
    const result = await read('new', JSON.stringify(answer));
    expect(result.data?.blocks).toEqual([]);
  });

  it('refuses a window holding another contract’s, another event’s or another agent’s log, rather than half-count it', async () => {
    const answer = JSON.parse(readFixture('rpc-erc8004-new-feedback.json')) as { result: { topics: string[] }[] };
    const changes: Record<string, unknown>[] = [
      { address: '0x0000000000000000000000000000000000000001' },
      { topics: [ERC8004_FEEDBACK_REVOKED_TOPIC, ...answer.result[0]!.topics.slice(1)] },
      { topics: [ERC8004_NEW_FEEDBACK_TOPIC, agentTopic(8784), ...answer.result[0]!.topics.slice(2)] },
      { data: '0x01' },
    ];
    for (const change of changes) {
      const copy = JSON.parse(readFixture('rpc-erc8004-new-feedback.json')) as { result: Record<string, unknown>[] };
      copy.result[0] = { ...copy.result[0], ...change };
      const result = await read('new', JSON.stringify(copy));
      expect(hasData(result), JSON.stringify(change)).toBe(false);
      expect(result.errorCode).toBe('INVALID_RESPONSE');
    }
    // A revocation window holding a NewFeedback log is refused too.
    expect(hasData(await read('revoked', readFixture('rpc-erc8004-new-feedback.json')))).toBe(false);
  });

  it('reports the node’s range limit as a window the caller halves, and a pruned node’s refusal as history not served', async () => {
    const limited = await read('new', readFixture('rpc-getlogs-range-limit.json'));
    expect(hasData(limited)).toBe(false);
    expect(isLogWindowTooLarge(limited.errorMessage)).toBe(true);
    const pruned = await read('new', JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode' } }));
    expect(hasData(pruned)).toBe(false);
    expect(isLogHistoryNotServed(pruned.errorMessage)).toBe(true);
    expect(isLogWindowTooLarge(pruned.errorMessage)).toBe(false);
    expect(isLogHistoryNotServed('historical state 205d83… is not available')).toBe(true);
    expect(isLogHistoryNotServed('http 502')).toBe(false);
  });

  it('reads an answer with no result and no error as an error, never as an empty window', async () => {
    const result = await read('new', JSON.stringify({ jsonrpc: '2.0', id: 1 }));
    expect(hasData(result)).toBe(false);
  });

  it('refuses a backwards window, an unknown event or no agent before asking', () => {
    const adapter = createErc8004FeedbackAdapter();
    expect(adapter.canHandle({ rpcUrl: RPC, fromBlock: 10, toBlock: 9, event: 'new', agent: 8783 })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: RPC, fromBlock: 1, toBlock: 9, event: 'other' as 'new', agent: 8783 })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: RPC, fromBlock: 1, toBlock: 9, event: 'new', agent: 0 })).toBe(false);
  });
});

describe('feedback values', () => {
  it('reads the signed int128 and its decimals from the log data, and refuses what the registry could not have written', () => {
    const word = (value: bigint) => (value < 0n ? (1n << 256n) + value : value).toString(16).padStart(64, '0');
    const data = (value: bigint, decimals: bigint) => `0x${word(1n)}${word(value)}${word(decimals)}${'0'.repeat(64 * 5)}`;
    expect(readFeedbackValue(data(100n, 0n))).toEqual({ value: 100n, decimals: 0 });
    expect(readFeedbackValue(data(-5n, 2n))).toEqual({ value: -5n, decimals: 2 });
    expect(readFeedbackValue(data(1n, 19n))).toBeNull();
    expect(readFeedbackValue(data(10n ** 39n, 0n))).toBeNull();
    expect(readFeedbackValue('0x')).toBeNull();
  });

  it('buckets exactly, with 100 in the top of the 0–100 range', () => {
    expect(feedbackValueBucket(-1n, 0)).toBe('below0');
    expect(feedbackValueBucket(0n, 0)).toBe('from0to20');
    expect(feedbackValueBucket(1999n, 2)).toBe('from0to20');
    expect(feedbackValueBucket(2000n, 2)).toBe('from20to40');
    expect(feedbackValueBucket(59n, 0)).toBe('from40to60');
    expect(feedbackValueBucket(60n, 0)).toBe('from60to80');
    expect(feedbackValueBucket(80n, 0)).toBe('from80to100');
    expect(feedbackValueBucket(100n * 10n ** 18n, 18)).toBe('from80to100');
    expect(feedbackValueBucket(100n * 10n ** 18n + 1n, 18)).toBe('above100');
  });

  it('counts nothing from an empty answer', () => {
    expect(countFeedbackLogs([], 'new')).toEqual([]);
  });
});
