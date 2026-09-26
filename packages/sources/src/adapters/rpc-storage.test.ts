import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { EIP1967_BEACON_SLOT, EIP1967_IMPLEMENTATION_SLOT, IMPLEMENTATION_CALL, createRpcStorageAdapter } from './rpc-storage';

describe('rpc storage adapter', () => {
  const input = { rpcUrl: 'https://rpc.example', address: '0x' + 'ab'.repeat(20), slot: EIP1967_IMPLEMENTATION_SLOT };

  it('reads the implementation address out of the EIP-1967 slot', async () => {
    const impl = 'c0ffee0000000000000000000000000000000001';
    let sent: unknown;
    const fetchImpl: typeof fetch = async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${'0'.repeat(24)}${impl}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await createRpcStorageAdapter().fetch(input, testContext({ fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    expect(result.data.addressValue).toBe(`0x${impl}`);
    expect(sent).toMatchObject({ method: 'eth_getStorageAt', params: [input.address, EIP1967_IMPLEMENTATION_SLOT, 'latest'] });
  });

  it('reads an empty slot as no address, whatever the node pads it to', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x0' }) });
    const result = await createRpcStorageAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    expect(result.data.value).toBe(`0x${'0'.repeat(64)}`);
    expect(result.data.addressValue).toBeUndefined();
  });

  it('reads the beacon slot, then asks the beacon for its implementation (2026-09-26)', async () => {
    const beacon = 'e10b6f6b00000000000000000000000000001b00';
    const impl = 'b354c1a2e3d4f5a6b7c8d9e0f1a2b3c4d5e65ae2';
    const sent: unknown[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      sent.push(body);
      const word = body.method === 'eth_call' ? impl : beacon;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${'0'.repeat(24)}${word}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const slotRead = await createRpcStorageAdapter().fetch({ ...input, slot: EIP1967_BEACON_SLOT }, testContext({ fetchImpl }));
    expect(hasData(slotRead) && slotRead.data.addressValue).toBe(`0x${beacon}`);
    const call = await createRpcStorageAdapter().fetch({ rpcUrl: input.rpcUrl, address: `0x${beacon}`, call: IMPLEMENTATION_CALL }, testContext({ fetchImpl }));
    expect(hasData(call) && call.data.addressValue).toBe(`0x${impl}`);
    expect(sent[1]).toMatchObject({ method: 'eth_call', params: [{ to: `0x${beacon}`, data: IMPLEMENTATION_CALL }, 'latest'] });
  });

  it('takes a slot or a call, never both or neither', () => {
    const adapter = createRpcStorageAdapter();
    expect(adapter.canHandle({ rpcUrl: input.rpcUrl, address: input.address })).toBe(false);
    expect(adapter.canHandle({ ...input, call: IMPLEMENTATION_CALL })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: input.rpcUrl, address: input.address, call: '0x5c60' })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: input.rpcUrl, address: input.address, call: IMPLEMENTATION_CALL })).toBe(true);
  });

  it('treats an rpc error as an error, not as an empty slot', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } }) });
    const result = await createRpcStorageAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
  });
});
