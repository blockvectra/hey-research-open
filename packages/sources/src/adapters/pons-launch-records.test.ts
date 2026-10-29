import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { decodeAggregate3, MULTICALL3_ADDRESS } from './multicall';
import { createPonsLaunchRecordBatchAdapter, decodePonsLaunchRecord, PONS_GET_LAUNCHED_TOKEN_SELECTOR, ponsGetLaunchedTokenCall } from './pons-launch-records';

/**
 * Pons V2 launch records through Multicall3 (2026-10-30), against the answer read from chain 4663 on 2026-10-30
 * (`fixtures/rpc-pons-launch-records.json`): $MVA (fee recipient a vault, launcher a platform contract), a launch whose
 * fee recipient is its launcher, a launch whose fee recipient is not its launcher, and the Uniswap v4 singleton, which
 * the factory never launched (an all-zero record, `exists` false).
 */
type Fixture = { factory: string; tokens: string[]; request: { params: [{ to: string; data: string }, string] }; response: { result: string } };
const fixture = JSON.parse(readFixture('rpc-pons-launch-records.json')) as Fixture;
const [MVA, SAME, OTHER, NOT_LAUNCHED] = fixture.tokens as [string, string, string, string];
const answer = (body: unknown) => stubFetch({ status: 200, body: JSON.stringify(body) });

describe('decodePonsLaunchRecord', () => {
  const returnData = decodeAggregate3(fixture.response.result)!.map((entry) => entry.returnData);

  it('reads the launcher and the fee recipient, lower-cased, for the token asked', () => {
    expect(decodePonsLaunchRecord(MVA, returnData[0]!)).toEqual({
      exists: true,
      launcher: '0x0e1651aec67b2a049a4fa6aeb6c1c305aabfc35b',
      feeRecipient: '0xaa453c4e7b03e9f309a91c0a48c06f0a6cd503ca',
    });
    expect(decodePonsLaunchRecord(SAME, returnData[1]!)).toEqual({ exists: true, launcher: '0xd9da10e119a1c095f32a3b423b387ceec1d3e34c', feeRecipient: '0xd9da10e119a1c095f32a3b423b387ceec1d3e34c' });
    expect(decodePonsLaunchRecord(OTHER, returnData[2]!)).toEqual({ exists: true, launcher: '0xbd5a91de166685be3b2a59fb28f9332e8b644657', feeRecipient: '0x6a2953b9d68ed5921aa5873a97c9367bec3b16d6' });
  });

  it('says the factory holds no record for a token it never launched', () => {
    expect(decodePonsLaunchRecord(NOT_LAUNCHED, returnData[3]!)).toEqual({ exists: false });
  });

  it('refuses a record for another token, of the wrong length or with a malformed word', () => {
    expect(decodePonsLaunchRecord(SAME, returnData[0]!)).toBeUndefined();
    expect(decodePonsLaunchRecord(MVA, returnData[0]!.slice(0, -64))).toBeUndefined();
    expect(decodePonsLaunchRecord(MVA, `${returnData[0]!.slice(0, -1)}2`)).toBeUndefined();
    expect(decodePonsLaunchRecord(MVA, `0x${'f'.repeat(64)}${returnData[0]!.slice(66)}`)).toBeUndefined();
  });
});

describe('createPonsLaunchRecordBatchAdapter', () => {
  it('asks exactly the call confirmed on chain: getLaunchedToken (0x3cf28b5a) of each token, through Multicall3', async () => {
    const stub = answer(fixture.response);
    const result = await createPonsLaunchRecordBatchAdapter().fetch({ rpcUrl: 'https://rpc.example', factory: fixture.factory, tokens: fixture.tokens }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.callCount()).toBe(1);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as Fixture['request'];
    expect(body.params[0].to).toBe(MULTICALL3_ADDRESS);
    expect(body.params[0].data).toBe(fixture.request.params[0].data);
    expect(ponsGetLaunchedTokenCall(MVA)).toBe(`${PONS_GET_LAUNCHED_TOKEN_SELECTOR}${'0'.repeat(24)}${MVA.slice(2)}`);

    expect(result.status).toBe('fresh');
    expect(result.data).toEqual([
      { token: MVA, read: true, exists: true, launcher: '0x0e1651aec67b2a049a4fa6aeb6c1c305aabfc35b', feeRecipient: '0xaa453c4e7b03e9f309a91c0a48c06f0a6cd503ca' },
      { token: SAME, read: true, exists: true, launcher: '0xd9da10e119a1c095f32a3b423b387ceec1d3e34c', feeRecipient: '0xd9da10e119a1c095f32a3b423b387ceec1d3e34c' },
      { token: OTHER, read: true, exists: true, launcher: '0xbd5a91de166685be3b2a59fb28f9332e8b644657', feeRecipient: '0x6a2953b9d68ed5921aa5873a97c9367bec3b16d6' },
      { token: NOT_LAUNCHED, read: true, exists: false },
    ]);
  });

  it('a call that failed or a record that did not decode is that launch unread, never a guess', async () => {
    // The same answer asked for the tokens in another order: every record names a token other than the one asked.
    const stub = answer(fixture.response);
    const result = await createPonsLaunchRecordBatchAdapter().fetch(
      { rpcUrl: 'https://rpc.example', factory: fixture.factory, tokens: [SAME, MVA, OTHER, NOT_LAUNCHED] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.data?.slice(0, 2)).toEqual([
      { token: SAME, read: false, reason: 'the launch record did not decode' },
      { token: MVA, read: false, reason: 'the launch record did not decode' },
    ]);
  });

  it('treats a provider error as no answer for the whole batch', async () => {
    const stub = answer({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'header not found' } });
    const result = await createPonsLaunchRecordBatchAdapter().fetch({ rpcUrl: 'https://rpc.example', factory: fixture.factory, tokens: [MVA] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toBeUndefined();
    expect(result.errorMessage).toMatch(/header not found/);
  });

  it('asks nothing for a malformed batch', async () => {
    const stub = answer(fixture.response);
    const adapter = createPonsLaunchRecordBatchAdapter();
    for (const input of [
      { rpcUrl: 'https://rpc.example', factory: 'nope', tokens: [MVA] },
      { rpcUrl: 'https://rpc.example', factory: fixture.factory, tokens: [] },
      { rpcUrl: 'https://rpc.example', factory: fixture.factory, tokens: Array.from({ length: 101 }, () => MVA) },
    ]) {
      const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
      expect(result.data).toBeUndefined();
    }
    expect(stub.callCount()).toBe(0);
  });
});
