import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  createErc8004ValidationRequestAdapter,
  ERC8004_VALIDATION_REGISTRY_ADDRESS,
  ERC8004_VALIDATION_REQUEST_TOPIC,
  ERC8004_VALIDATION_URI_READ_MAX_BYTES,
  readRequestUri,
  validatorTopic,
} from './erc8004-validation';

/**
 * The ERC-8004 validation-request reader (2026-11-02): one `eth_getLogs` per window, filtered to one validator, and
 * nothing but each request's place, hash and URI out. The fixture is encoded with viem from the registry's ABI, in the
 * shape Robinhood Chain's node answers (its `blockTimestamp` is 0x0; read 2026-11-02 on real requests): a HEY claim
 * (repeated once), a HEY claim whose hash is not its URI's, a URL, a 621-byte URI and three bytes that are not UTF-8,
 * all naming the made-up validator 0x7e57…0001, from made-up agents and transactions.
 */
const RPC = 'https://rpc.example/';
const VALIDATOR = '0x7e57000000000000000000000000000000000001';
const BLOCK = 104_100_000;
const CLAIM = 'hey-ship-claim:1:example-project:1761955200:1762560000';
const read = (body: string, validator = VALIDATOR) =>
  createErc8004ValidationRequestAdapter().fetch({ rpcUrl: RPC, fromBlock: 104_000_000, toBlock: 105_000_000, validator }, testContext({ fetchImpl: stubFetch({ status: 200, body }).fetchImpl }));

describe('ERC-8004 validation requests', () => {
  it('asks the validation registry for the request event naming one validator, and never caches', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }) });
    const result = await createErc8004ValidationRequestAdapter().fetch({ rpcUrl: RPC, fromBlock: 1, toBlock: 100, validator: VALIDATOR.toUpperCase().replace('0X', '0x') }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.cacheTtlSeconds).toBe(0);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: [Record<string, unknown>] };
    expect(body.method).toBe('eth_getLogs');
    expect(body.params[0]).toEqual({
      address: ERC8004_VALIDATION_REGISTRY_ADDRESS,
      topics: [ERC8004_VALIDATION_REQUEST_TOPIC, '0x0000000000000000000000007e57000000000000000000000000000000000001'],
      fromBlock: '0x1',
      toBlock: '0x64',
    });
  });

  it('reads each request once, oldest first, with its hash and URI — and nothing about who asked', async () => {
    const result = await read(readFixture('rpc-erc8004-validation-requests.json'));
    expect(hasData(result)).toBe(true);
    const requests = result.data!.requests;
    expect(requests.map((request) => [request.blockNumber, request.logIndex, request.requestUri, request.uriBytes])).toEqual([
      [BLOCK, 3, CLAIM, CLAIM.length],
      [BLOCK + 10, 0, 'hey-ship-claim:1:example-project:1761955200:1762646400', 54],
      [BLOCK + 20, 1, 'https://receipts.example/api/receipt/abc-123', 44],
      // Too long to be a HEY claim: only its length survives.
      [BLOCK + 30, 0, null, 621],
      // Not UTF-8.
      [BLOCK + 40, 0, null, 3],
    ]);
    expect(requests[0]!.requestHash).toBe('0xf978ad70916be763807cb29c6a9b0c77c426727bd8c65ae75ee94dc348eda88b');
    expect(Object.keys(requests[0]!).sort()).toEqual(['blockNumber', 'logIndex', 'requestHash', 'requestUri', 'uriBytes']);
    // No agent id, transaction, block hash or address survives the adapter.
    const printed = JSON.stringify(result.data);
    expect(printed).not.toMatch(/1092|abababab|cdcdcdcd|7e57|0x[0-9a-f]{40}"/i);
  });

  it('does not read a log the node marks removed', async () => {
    const answer = JSON.parse(readFixture('rpc-erc8004-validation-requests.json')) as { result: Record<string, unknown>[] };
    answer.result = answer.result.map((log) => ({ ...log, removed: true }));
    expect((await read(JSON.stringify(answer))).data?.requests).toEqual([]);
  });

  it('refuses a window holding another contract’s, another event’s or another validator’s log, rather than half-read it', async () => {
    const answer = JSON.parse(readFixture('rpc-erc8004-validation-requests.json')) as { result: { address: string; topics: string[] }[] };
    const variants = [
      { ...answer.result[0]!, address: '0x8004baa17c55a88189ae136b182e5fda19de9b63' },
      { ...answer.result[0]!, topics: ['0xafddf629e874ccc3963b6a888c477bd464a6c8525024fc88759ea3b2326349ae', ...answer.result[0]!.topics.slice(1)] },
      { ...answer.result[0]!, topics: [answer.result[0]!.topics[0]!, validatorTopic('0x1111111111111111111111111111111111111111'), ...answer.result[0]!.topics.slice(2)] },
      { ...answer.result[0]!, topics: answer.result[0]!.topics.slice(0, 3) },
      { ...answer.result[0]!, data: '0x1234' },
    ];
    for (const variant of variants) {
      const result = await read(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [variant] }));
      expect(hasData(result), JSON.stringify(variant).slice(0, 80)).toBe(false);
    }
  });

  it('passes a node’s refusal through as an error the caller can halve or stop on', async () => {
    const result = await read(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'logs matched by query exceeds limit of 10000' } }));
    expect(hasData(result)).toBe(false);
    expect(result.errorMessage).toMatch(/exceeds limit/);
  });

  it('refuses to ask without a validator, or for the zero address', () => {
    const adapter = createErc8004ValidationRequestAdapter();
    expect(adapter.canHandle({ rpcUrl: RPC, fromBlock: 1, toBlock: 2, validator: VALIDATOR })).toBe(true);
    expect(adapter.canHandle({ rpcUrl: RPC, fromBlock: 1, toBlock: 2, validator: '' })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: RPC, fromBlock: 1, toBlock: 2, validator: `0x${'0'.repeat(40)}` })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: RPC, fromBlock: 3, toBlock: 2, validator: VALIDATOR })).toBe(false);
  });

  it('reads a request URI exactly, refusing data that is not one ABI string', () => {
    const encode = (text: string) => {
      const bytes = Buffer.from(text, 'utf8');
      const padded = Buffer.concat([bytes, Buffer.alloc((32 - (bytes.length % 32)) % 32)]);
      return `0x${(32).toString(16).padStart(64, '0')}${bytes.length.toString(16).padStart(64, '0')}${padded.toString('hex')}`;
    };
    expect(readRequestUri(encode(CLAIM))).toEqual({ uri: CLAIM, bytes: CLAIM.length });
    expect(readRequestUri(encode(''))).toEqual({ uri: '', bytes: 0 });
    // A byte-order mark is kept, so the text re-encodes to the bytes it came from.
    expect(readRequestUri(encode('﻿hey'))?.uri).toBe('﻿hey');
    expect(readRequestUri(encode('x'.repeat(ERC8004_VALIDATION_URI_READ_MAX_BYTES + 1)))).toEqual({ uri: null, bytes: ERC8004_VALIDATION_URI_READ_MAX_BYTES + 1 });
    expect(readRequestUri('0x')).toBeNull();
    // A length past the data, or an offset that is not one word.
    expect(readRequestUri(`0x${(32).toString(16).padStart(64, '0')}${(64).toString(16).padStart(64, '0')}${'00'.repeat(32)}`)).toBeNull();
    expect(readRequestUri(`0x${(64).toString(16).padStart(64, '0')}${(0).toString(16).padStart(64, '0')}`)).toBeNull();
  });
});
