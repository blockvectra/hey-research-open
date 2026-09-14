import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createErc20SupplyAdapter, createErc20SupplyBatchAdapter, ERC20_SUPPLY_BATCH, wholeTokens } from './erc20-supply';

const RPC = 'https://rpc.example/';
const TOKEN = '0xb818ddfa44aad2157b0f7058aebcb52d4733d4c4';
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
const batch = (supply: bigint, decimals: bigint) =>
  JSON.stringify([
    { jsonrpc: '2.0', id: 1, result: word(supply) },
    { jsonrpc: '2.0', id: 2, result: word(decimals) },
  ]);

describe('erc20 supply', () => {
  it('applies decimals to the raw supply', () => {
    expect(wholeTokens(word(10n ** 27n), 18)).toBe(1_000_000_000);
    expect(wholeTokens(word(10n ** 18n), 9)).toBe(1_000_000_000);
    expect(wholeTokens(word(0n), 18)).toBeUndefined();
    expect(wholeTokens('0x', 18)).toBeUndefined();
  });

  it('reads supply and decimals in one batched call', async () => {
    const stub = stubFetch({ status: 200, body: batch(10n ** 27n, 18n) });
    const result = await createErc20SupplyAdapter().fetch({ rpcUrl: RPC, address: TOKEN }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual({ address: TOKEN, totalSupply: 1_000_000_000, decimals: 18 });
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { method: string; params: [{ data: string }] }[];
    expect(body.map((entry) => entry.params[0].data)).toEqual(['0x18160ddd', '0x313ce567']);
  });

  it('refuses an implausible decimals rather than guessing a denominator', async () => {
    const stub = stubFetch({ status: 200, body: batch(10n ** 27n, 99n) });
    const result = await createErc20SupplyAdapter().fetch({ rpcUrl: RPC, address: TOKEN }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
  });

  it('refuses a token whose supply reads zero', async () => {
    const stub = stubFetch({ status: 200, body: batch(0n, 18n) });
    const result = await createErc20SupplyAdapter().fetch({ rpcUrl: RPC, address: TOKEN }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
  });
});

describe('erc20 supply, batched', () => {
  const B = '0x39dbed3a2bd333467115de45665cc57f813c4571';
  const batchBody = (entries: readonly (readonly [bigint, bigint])[]) =>
    JSON.stringify(
      entries.flatMap(([supply, decimals], index) => [
        { jsonrpc: '2.0', id: 2 * index + 1, result: word(supply) },
        { jsonrpc: '2.0', id: 2 * index + 2, result: word(decimals) },
      ]),
    );

  it('reads several tokens in one request and keeps them in order', async () => {
    const stub = stubFetch({ status: 200, body: batchBody([[10n ** 27n, 18n], [10n ** 18n, 9n]]) });
    const result = await createErc20SupplyBatchAdapter().fetch({ rpcUrl: RPC, addresses: [TOKEN, B] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual([
      { address: TOKEN, totalSupply: 1_000_000_000, decimals: 18 },
      { address: B, totalSupply: 1_000_000_000, decimals: 9 },
    ]);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { params: [{ to: string; data: string }] }[];
    expect(body).toHaveLength(4);
    expect(body.map((entry) => entry.params[0].to)).toEqual([TOKEN, TOKEN, B, B]);
  });

  it('leaves out a contract that answered nothing usable rather than guessing it', async () => {
    const stub = stubFetch({ status: 200, body: batchBody([[10n ** 27n, 18n], [0n, 18n]]) });
    const result = await createErc20SupplyBatchAdapter().fetch({ rpcUrl: RPC, addresses: [TOKEN, B] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toEqual([{ address: TOKEN, totalSupply: 1_000_000_000, decimals: 18 }]);
  });

  it('refuses a batch larger than the node answers', () => {
    const adapter = createErc20SupplyBatchAdapter();
    const many = Array.from({ length: ERC20_SUPPLY_BATCH + 1 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
    expect(adapter.canHandle({ rpcUrl: RPC, addresses: many })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: RPC, addresses: [TOKEN] })).toBe(true);
    expect(adapter.canHandle({ rpcUrl: RPC, addresses: [] })).toBe(false);
  });
});
