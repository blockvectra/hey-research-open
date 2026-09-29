import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { DEX_POOL_FACTORIES, DEX_POOL_SKIP_TOKENS, dexPoolFactoryById, enabledDexPoolFactories, isDexPoolDiscovery } from './dex-pools';
import { scanFactory } from './indexer';
import { factoryById, LAUNCH_FACTORIES } from './registry';

const noSleep = async () => {};
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';

describe('DEX pool factories (coverage audit, 2026-09-30)', () => {
  it('is locked to Robinhood Chain, separate from the launchpad registry, and names no launchpad', () => {
    for (const factory of DEX_POOL_FACTORIES) {
      expect(factory.chainId).toBe(4663);
      expect(factory.id).toMatch(/^UNISWAP_V[23]_(PAIRS|POOLS)$/);
      expect(factory.factoryAddress).toMatch(/^0x[0-9a-f]{40}$/);
      expect(factory.eventTopic0).toMatch(/^0x[0-9a-f]{64}$/);
      expect(factory.pairTokenTopics).toEqual([1, 2]);
      expect(factory.verification.length).toBeGreaterThan(40);
      // A pool is not a launch: no id or address is shared with the launch registry.
      expect(factoryById(factory.id)).toBeUndefined();
      expect(LAUNCH_FACTORIES.some((launch) => launch.factoryAddress.toLowerCase() === factory.factoryAddress)).toBe(false);
      expect('launchpad' in factory).toBe(false);
    }
    expect(enabledDexPoolFactories(4663).map((factory) => factory.id)).toEqual(['UNISWAP_V2_PAIRS', 'UNISWAP_V3_POOLS']);
    expect(enabledDexPoolFactories(1)).toEqual([]);
    expect(isDexPoolDiscovery('UNISWAP_V3_POOLS')).toBe(true);
    expect(isDexPoolDiscovery('PONS_V2')).toBe(false);
    expect(DEX_POOL_SKIP_TOKENS).toContain(WETH);
  });

  it('reads the token side of a live V2 PairCreated log and skips the quote asset', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dex-pair-created.json') });
    const result = await scanFactory(
      dexPoolFactoryById('UNISWAP_V2_PAIRS')!,
      { rpcUrl: 'https://rpc.example', fromBlock: 9_486, toBlock: 9_486, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.launches).toEqual([
      expect.objectContaining({
        sourceId: 'UNISWAP_V2_PAIRS',
        contractAddress: '0x0d6b6f604c1bf5b3533c445334bb4e1044145688',
        blockNumber: 9_486,
        factoryAddress: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',
      }),
    ]);
    expect(result.launches.some((launch) => launch.contractAddress === WETH)).toBe(false);
  });

  it('reads both topics of a live V3 PoolCreated log and never the fee topic', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dex-pool-created.json') });
    const result = await scanFactory(
      dexPoolFactoryById('UNISWAP_V3_POOLS')!,
      { rpcUrl: 'https://rpc.example', fromBlock: 9_490, toBlock: 9_490, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.launches.map((launch) => launch.contractAddress)).toEqual(['0x99f381b8bcd5b367178809abdbb7ae79da782e0e']);
    // topics[3] is the fee tier (0xbb8), which is not an address anyone launched.
    expect(result.launches.some((launch) => launch.contractAddress.endsWith('0bb8'))).toBe(false);
  });

  it('keeps a token\'s first pool when a window holds several', async () => {
    const factory = dexPoolFactoryById('UNISWAP_V3_POOLS')!;
    const topicFor = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
    const token = '0x1111111111111111111111111111111111111111';
    const other = '0x2222222222222222222222222222222222222222';
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: [
          { address: factory.factoryAddress, topics: [factory.eventTopic0, topicFor(token), topicFor(WETH), topicFor('0x' + '0'.repeat(36) + '0bb8')], data: '0x', blockNumber: '0x10', transactionHash: '0xfirst' },
          { address: factory.factoryAddress, topics: [factory.eventTopic0, topicFor(token), topicFor(other), topicFor('0x' + '0'.repeat(36) + '2710')], data: '0x', blockNumber: '0x20', transactionHash: '0xsecond' },
        ],
      }),
    });
    const result = await scanFactory(factory, { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 100, sleep: noSleep }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.launches).toHaveLength(2);
    expect(result.launches.find((launch) => launch.contractAddress === token)?.txHash).toBe('0xfirst');
    expect(result.launches.find((launch) => launch.contractAddress === other)?.txHash).toBe('0xsecond');
  });
});
