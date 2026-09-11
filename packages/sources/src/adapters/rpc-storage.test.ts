import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { EIP1967_IMPLEMENTATION_SLOT, createRpcStorageAdapter } from './rpc-storage';

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

  it('treats an rpc error as an error, not as an empty slot', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } }) });
    const result = await createRpcStorageAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
  });
});
