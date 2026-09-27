import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createErc20MetadataBatchAdapter, decodeAggregate3, decodeAggregate3Calls, encodeAggregate3, encodeAggregate3Result, MULTICALL3_ADDRESS } from './multicall';

/**
 * Batched ERC-20 naming through Multicall3 (2026-09-27), against an answer
 * saved from Robinhood Chain: two Pons V2 launches, the Pons V2 factory (a
 * contract with no `name()`, so both calls fail) and an address with no code
 * (both calls "succeed" with nothing).
 */
const ADDRESSES = [
  '0x2da57ba43f61a52d32477b7265446343ec2520d0',
  '0x2330b6d4994b92d4103b448bb438fd036293889b',
  '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
  '0x000000000000000000000000000000000000dead',
];

describe('aggregate3 encoding', () => {
  it('lays out a call array the way the ABI does', () => {
    const encoded = encodeAggregate3([{ target: ADDRESSES[0]!, allowFailure: true, callData: '0x06fdde03' }]);
    const words = encoded.slice(10).match(/.{64}/g)!;
    expect(encoded.slice(0, 10)).toBe('0x82ad56cb');
    // offset to the array, its length, the one element's offset, then the tuple.
    expect(words.map((w) => BigInt(`0x${w}`))).toEqual([
      0x20n,
      1n,
      0x20n,
      BigInt(ADDRESSES[0]!),
      1n,
      0x60n,
      4n,
      BigInt('0x06fdde03') << 224n,
    ]);
  });

  it('round-trips calls and answers, for the stubs that answer a batch', () => {
    const calls = [
      { target: ADDRESSES[0]!, allowFailure: true, callData: '0x06fdde03' },
      { target: ADDRESSES[1]!, allowFailure: false, callData: '0x95d89b41' },
    ];
    expect(decodeAggregate3Calls(encodeAggregate3(calls))).toEqual(calls);
    const answers = [{ success: true, returnData: `0x${'ab'.repeat(40)}` }, { success: false, returnData: '0x' }];
    expect(decodeAggregate3(encodeAggregate3Result(answers))).toEqual(answers);
  });

  it('refuses an answer whose offsets point outside the data', () => {
    expect(decodeAggregate3('0x')).toBeUndefined();
    expect(decodeAggregate3(`0x${'00'.repeat(31)}ff`)).toBeUndefined();
    expect(decodeAggregate3(`0x${(0x20).toString(16).padStart(64, '0')}${(5).toString(16).padStart(64, '0')}`)).toBeUndefined();
  });
});

describe('createErc20MetadataBatchAdapter', () => {
  it('names each token in one request, and leaves a token that answers nothing unnamed', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('multicall-erc20-metadata.json') });

    const result = await createErc20MetadataBatchAdapter().fetch({ rpcUrl: 'https://rpc.example', addresses: ADDRESSES }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.callCount()).toBe(1);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: [{ to: string }, string] };
    expect(body.method).toBe('eth_call');
    expect(body.params[0].to).toBe(MULTICALL3_ADDRESS);

    expect(result.status).toBe('fresh');
    const values = result.data!;
    expect(values.map((value) => value.address)).toEqual(ADDRESSES);
    expect(values[0]?.name).toBeTruthy();
    expect(values[0]?.symbol).toBeTruthy();
    expect(values[1]?.name).toBeTruthy();
    // The factory has no name(); the address with no code answers nothing.
    expect(values[2]).toEqual({ address: ADDRESSES[2] });
    expect(values[3]).toEqual({ address: ADDRESSES[3] });
  });

  it('treats a provider error as no answer, never as a hundred tokens without names', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'out of gas' } }) });
    const result = await createErc20MetadataBatchAdapter().fetch({ rpcUrl: 'https://rpc.example', addresses: ADDRESSES }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toBeUndefined();
    expect(result.errorMessage).toMatch(/out of gas/);
  });

  it('says so when no multicall contract answers', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }) });
    const result = await createErc20MetadataBatchAdapter().fetch({ rpcUrl: 'https://rpc.example', addresses: ADDRESSES }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toBeUndefined();
    expect(result.errorMessage).toMatch(/no multicall contract/);
  });
});
