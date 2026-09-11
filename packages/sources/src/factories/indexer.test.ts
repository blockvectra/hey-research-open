import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import {
  decodeEventString,
  MAX_RATE_LIMIT_HITS,
  RATE_LIMIT_BACKOFF_MAX_MS,
  RATE_LIMIT_BACKOFF_MS,
  scanFactory,
} from './indexer';
import { factoryById } from './registry';

/**
 * The factory scanner against a stubbed RPC: log decoding, adaptive chunking,
 * rate-limit back-off and the request budget. No sleeping, no network.
 */
const factory = factoryById('PONS_V2')!;
const token = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const topicFor = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;

const logs = (entries: { address: string; block: number; tx: string }[]) => ({
  status: 200,
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: entries.map((entry) => ({
      address: factory.factoryAddress,
      topics: [factory.eventTopic0, topicFor(entry.address), topicFor('0x' + '9'.repeat(40))],
      blockNumber: `0x${entry.block.toString(16)}`,
      transactionHash: entry.tx,
    })),
  }),
});

const rpcError = (message: string) => ({
  status: 200,
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message } }),
});

const noSleep = async () => {};

describe('scanFactory', () => {
  it('decodes the token from the indexed topic and records where it stopped', async () => {
    const stub = stubFetch(logs([{ address: token, block: 120, tx: '0xt1' }]));

    const result = await scanFactory(
      factory,
      { rpcUrl: 'https://rpc.example', fromBlock: 100, toBlock: 200, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.launches).toEqual([
      {
        sourceId: 'PONS_V2',
        chainId: 4663,
        contractAddress: token,
        blockNumber: 120,
        txHash: '0xt1',
        factoryAddress: factory.factoryAddress.toLowerCase(),
        version: 'V2',
      },
    ]);
    expect(result.lastIndexedBlock).toBe(200);
    expect(result.truncated).toBe(false);
    expect(result.unresolvedWindows).toEqual([]);

    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as {
      params: { address: string; topics: string[]; fromBlock: string; toBlock: string }[];
    };
    expect(body.params[0]?.address).toBe(factory.factoryAddress);
    expect(body.params[0]?.topics).toEqual([factory.eventTopic0]);
    expect(body.params[0]?.fromBlock).toBe('0x64');
  });

  it('halves the window on a dense-range error and grows it back after success', async () => {
    const stub = stubFetch([
      rpcError('query timeout exceeded'),
      logs([]),
      logs([{ address: token, block: 3_000_000, tx: '0xt2' }]),
    ]);

    const result = await scanFactory(
      factory,
      { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 3_000_000, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    // Request 1: 0..2M fails. Request 2: 0..1M succeeds. Request 3: 1M+1..3M succeeds.
    const windows = stub.requests.map((request) => {
      const body = JSON.parse(String(request.init?.body)) as { params: { fromBlock: string; toBlock: string }[] };
      return [Number.parseInt(body.params[0]!.fromBlock, 16), Number.parseInt(body.params[0]!.toBlock, 16)];
    });
    expect(windows).toEqual([
      [0, 2_000_000],
      [0, 1_000_000],
      [1_000_001, 3_000_000],
    ]);
    expect(result.launches).toHaveLength(1);
    expect(result.lastIndexedBlock).toBe(3_000_000);
  });

  it('backs off exponentially on a rate limit without shrinking the window or losing coverage', async () => {
    const slept: number[] = [];
    const stub = stubFetch([{ status: 429 }, { status: 429 }, rpcError('429 Too Many Requests'), logs([])]);

    const result = await scanFactory(
      factory,
      {
        rpcUrl: 'https://rpc.example',
        fromBlock: 10,
        toBlock: 20,
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.rateLimitHits).toBe(3);
    // 3 s, 6 s, 12 s — then the window that succeeded, followed by the pacing sleep.
    expect(slept.slice(0, 3)).toEqual([RATE_LIMIT_BACKOFF_MS, RATE_LIMIT_BACKOFF_MS * 2, RATE_LIMIT_BACKOFF_MS * 4]);
    expect(result.lastIndexedBlock).toBe(20);
    expect(result.unresolvedWindows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('caps the back-off, resets it after a success, and stops after too many refusals', async () => {
    const slept: number[] = [];
    const refusals = Array.from({ length: MAX_RATE_LIMIT_HITS + 1 }, () => ({ status: 429 }));
    const stub = stubFetch([{ status: 429 }, logs([]), ...refusals]);

    const result = await scanFactory(
      factory,
      {
        rpcUrl: 'https://rpc.example',
        fromBlock: 0,
        toBlock: 3_000_000,
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    // First refusal, then a success resets the curve: the next refusal waits 3 s again.
    expect(slept[0]).toBe(RATE_LIMIT_BACKOFF_MS);
    expect(slept[2]).toBe(RATE_LIMIT_BACKOFF_MS);
    expect(Math.max(...slept)).toBe(RATE_LIMIT_BACKOFF_MAX_MS);
    // The run gave up on the second window, and says so: resumable, not lost.
    expect(result.rateLimitHits).toBe(MAX_RATE_LIMIT_HITS + 1);
    expect(result.lastIndexedBlock).toBe(2_000_000);
    expect(result.truncated).toBe(true);
    expect(result.unresolvedWindows).toEqual([]);
  });

  it("decodes hood.fun's community launchpad log the way the registry says", async () => {
    const community = factoryById('HOODFUN_COMMUNITY')!;
    const stub = stubFetch({ status: 200, body: readFixture('hoodfun-community-launch.json') });

    const result = await scanFactory(
      community,
      { rpcUrl: 'https://rpc.example', fromBlock: 7_523_400, toBlock: 7_523_410, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.launches).toHaveLength(1);
    expect(result.launches[0]).toMatchObject({
      sourceId: 'HOODFUN_COMMUNITY',
      contractAddress: '0x72081adc58bdb794b989d424a65948c16848600d',
      blockNumber: 7_523_403,
      txHash: '0xd015d2ef63d49fc11aaa1071e3f191af2f2cebf68b63606c14bf157ef478d672',
      factoryAddress: community.factoryAddress.toLowerCase(),
      version: 'community',
      name: 'FEATHER',
      symbol: 'FEATHER',
    });
    expect(result.launches[0]?.metadataUri).toMatch(/^\{/);
  });

  it('stops at the request budget and reports the scan as truncated', async () => {
    const stub = stubFetch(logs([]));

    const result = await scanFactory(
      factory,
      { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 10_000_000, maxRequests: 2, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.requests).toBe(2);
    expect(result.truncated).toBe(true);
    // The resume point is the last block actually covered, never the target.
    expect(result.lastIndexedBlock).toBe(4_000_001);
  });

  it('records a window it could not resolve rather than silently skipping it', async () => {
    const stub = stubFetch(rpcError('query timeout exceeded'));

    const result = await scanFactory(
      factory,
      { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 30_000, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.unresolvedWindows.length).toBeGreaterThan(0);
    expect(result.lastError).toMatch(/timeout/);
  });
});

/* ------------------------------------------------- event data strings */

/**
 * ABI-encode a launch event's data: fixed words first, then each dynamic
 * string's bytes, with the pointer words filled in as the encoder lays them
 * out — the same layout the chain produces for `string` event arguments.
 */
const encodeData = (words: (bigint | { string: string })[]): string => {
  const head: string[] = [];
  let tail = '';
  let offset = words.length * 32;
  for (const word of words) {
    if (typeof word === 'bigint') {
      head.push(word.toString(16).padStart(64, '0'));
      continue;
    }
    const bytes = Buffer.from(word.string, 'utf8');
    head.push(offset.toString(16).padStart(64, '0'));
    const padded = Math.ceil(bytes.length / 32) * 32;
    tail +=
      bytes.length.toString(16).padStart(64, '0') + bytes.toString('hex').padEnd(padded * 2, '0');
    offset += 32 + padded;
  }
  return `0x${head.join('')}${tail}`;
};

describe('decodeEventString', () => {
  const data = encodeData([
    { string: 'Climb Net' },
    { string: 'CLIMB' },
    { string: '{"description":"up"}' },
    2810n,
  ]);

  it('reads each string by the word that holds its offset', () => {
    expect(decodeEventString(data, 0)).toBe('Climb Net');
    expect(decodeEventString(data, 1)).toBe('CLIMB');
    expect(decodeEventString(data, 2)).toBe('{"description":"up"}');
  });

  it('refuses a word that is not a string pointer, and anything past the data', () => {
    expect(decodeEventString(data, 3)).toBeUndefined();
    expect(decodeEventString(data, 9)).toBeUndefined();
    expect(decodeEventString('0x', 0)).toBeUndefined();
    expect(decodeEventString(`0x${'ff'.repeat(32)}`, 0)).toBeUndefined();
  });

  it('caps the length and rejects bytes that are not text', () => {
    expect(decodeEventString(encodeData([{ string: 'x'.repeat(600) }]), 0)).toBeUndefined();
    expect(decodeEventString(encodeData([{ string: 'x'.repeat(600) }]), 0, 1_000)).toHaveLength(600);
    expect(decodeEventString(encodeData([{ string: 'bad byte' }]), 0)).toBeUndefined();
  });
});

describe('scanFactory with event strings', () => {
  const stringFactory = {
    ...factory,
    id: 'HOODFUN',
    launchpad: 'hoodfun',
    eventStrings: { name: 0, symbol: 1, metadataUri: 2 },
  };

  it('carries the creator-supplied name, ticker and metadata off the launch log', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: [
          {
            address: factory.factoryAddress,
            topics: [factory.eventTopic0, topicFor(token), topicFor(`0x${'9'.repeat(40)}`)],
            data: encodeData([
              { string: 'Climb Net' },
              { string: 'CLIMB' },
              { string: '{"description":"up"}' },
              2810n,
            ]),
            blockNumber: '0x10',
            transactionHash: '0xt9',
          },
        ],
      }),
    });

    const result = await scanFactory(
      stringFactory,
      { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 100, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.launches[0]).toMatchObject({
      contractAddress: token,
      name: 'Climb Net',
      symbol: 'CLIMB',
      metadataUri: '{"description":"up"}',
    });
  });
});

describe('scanFactory with the token in a data word', () => {
  const dataFactory = {
    ...factory,
    id: 'FLAP',
    launchpad: 'flap',
    tokenTopicIndex: 'data' as const,
    tokenDataWord: 1,
    eventStrings: { name: 2, symbol: 3 },
  };

  it('reads the token address off the declared word and ignores a word that is not an address', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: [
          {
            address: factory.factoryAddress,
            topics: [factory.eventTopic0],
            data: encodeData([1787487665n, BigInt(token), { string: 'Ducky' }, { string: 'DUCKYY' }]),
            blockNumber: '0x11',
            transactionHash: '0xt10',
          },
          {
            address: factory.factoryAddress,
            topics: [factory.eventTopic0],
            // Word 1 is a full 256-bit value, not a left-padded address.
            data: encodeData([1n, (1n << 255n) + 7n, { string: 'x' }, { string: 'X' }]),
            blockNumber: '0x12',
            transactionHash: '0xt11',
          },
        ],
      }),
    });

    const result = await scanFactory(
      dataFactory,
      { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 100, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.launches).toHaveLength(1);
    expect(result.launches[0]).toMatchObject({ contractAddress: token, name: 'Ducky', symbol: 'DUCKYY', txHash: '0xt10' });
  });
});
