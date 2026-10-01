import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { DEX_POOL_FACTORIES, DEX_POOL_SKIP_TOKENS, dexPoolFactoryById, enabledDexPoolFactories, isDexPoolDiscovery } from './dex-pools';
import { decodeLaunchHookClaim, scanFactory } from './indexer';
import { factoryById, LAUNCH_FACTORIES } from './registry';

const noSleep = async () => {};
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';

describe('DEX pool factories (coverage audit, 2026-09-30)', () => {
  it('is locked to Robinhood Chain, separate from the launchpad registry, and names no launchpad', () => {
    for (const factory of DEX_POOL_FACTORIES) {
      expect(factory.chainId).toBe(4663);
      expect(factory.id).toMatch(/^(UNISWAP_V[234]_(PAIRS|POOLS)|DOPPLER_AIRLOCK)$/);
      expect(factory.factoryAddress).toMatch(/^0x[0-9a-f]{40}$/);
      expect(factory.eventTopic0).toMatch(/^0x[0-9a-f]{64}$/);
      // A pool names both of its sides; the Airlock names the one token it launched.
      if (factory.venue === 'doppler') expect(factory.tokenTopicIndex).toBe('data');
      else expect(factory.pairTokenTopics).toEqual(factory.venue === 'uniswap-v4' ? [2, 3] : [1, 2]);
      expect(factory.skipTokens).toBe(DEX_POOL_SKIP_TOKENS);
      expect(factory.verification.length).toBeGreaterThan(40);
      // A pool is not a launch: no id or address is shared with the launch registry.
      expect(factoryById(factory.id)).toBeUndefined();
      expect(LAUNCH_FACTORIES.some((launch) => launch.factoryAddress.toLowerCase() === factory.factoryAddress)).toBe(false);
      expect('launchpad' in factory).toBe(false);
    }
    expect(enabledDexPoolFactories(4663).map((factory) => factory.id)).toEqual(['UNISWAP_V2_PAIRS', 'UNISWAP_V3_POOLS', 'UNISWAP_V4_POOLS', 'DOPPLER_AIRLOCK']);
    expect(isDexPoolDiscovery('DOPPLER_AIRLOCK')).toBe(true);
    expect(DEX_POOL_SKIP_TOKENS).toContain('0x0000000000000000000000000000000000000000');
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

  it('reads both currencies of a live v4 Initialize log, never the pool id, and skips the quote asset (2026-09-30)', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dex-v4-initialize.json') });
    const result = await scanFactory(
      dexPoolFactoryById('UNISWAP_V4_POOLS')!,
      { rpcUrl: 'https://rpc.example', fromBlock: 9_505, toBlock: 9_505, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    // topics[1] is the pool id, topics[2] WETH (a quote asset), topics[3] the token.
    expect(result.launches.map((launch) => launch.contractAddress)).toEqual(['0x42bcdf8d4116545d04dd5b76f48b614450f18b1b']);
    expect(result.launches[0]).toMatchObject({ sourceId: 'UNISWAP_V4_POOLS', blockNumber: 9_505 });
  });

  it('reads the launched token from a live Doppler Airlock Create log, never the indexed numeraire (2026-09-30)', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('doppler-airlock-create.json') });
    const result = await scanFactory(
      dexPoolFactoryById('DOPPLER_AIRLOCK')!,
      { rpcUrl: 'https://rpc.example', fromBlock: 734_616, toBlock: 734_616, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.launches.map((launch) => launch.contractAddress)).toEqual(['0xa61b14c20b3fbd26a16507459ba48658a64bf7be']);
    expect(result.launches[0]).toMatchObject({ sourceId: 'DOPPLER_AIRLOCK', factoryAddress: '0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862' });
    // An intake, not a launchpad: the registry does not know it.
    expect(factoryById('DOPPLER_AIRLOCK')).toBeUndefined();
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

  it('returns every v4 Initialize as a pool init, hook zero included, at no extra request (2026-10-01)', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dex-v4-initialize.json') });
    const result = await scanFactory(
      dexPoolFactoryById('UNISWAP_V4_POOLS')!,
      { rpcUrl: 'https://rpc.example', fromBlock: 9_505, toBlock: 9_505, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.requests).toBe(1);
    expect(result.poolInits).toEqual([
      {
        poolId: '0xdb2c20421239d46bb30a7a73029b7f9b7f166489bfb972057d33cbd7249413a5',
        currency0: WETH,
        currency1: '0x42bcdf8d4116545d04dd5b76f48b614450f18b1b',
        hook: '0x0000000000000000000000000000000000000000',
        blockNumber: 9_505,
        txHash: '0x9ac26a1db2e4b2322a84c688bb31bebb437a2a2587cdeb51d7b6052662ee1ebf',
        logIndex: 0,
      },
    ]);
    expect(result.launchHookClaims).toEqual([]);
  });

  it('decodes the hook from data word 2 of live hooked Initialize logs, a quote-only pool included (2026-10-01)', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dex-v4-initialize-hooked.json') });
    const result = await scanFactory(
      dexPoolFactoryById('UNISWAP_V4_POOLS')!,
      { rpcUrl: 'https://rpc.example', fromBlock: 77_293_300, toBlock: 77_327_518, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.requests).toBe(1);
    expect(result.poolInits.map((init) => [init.blockNumber, init.logIndex, init.hook])).toEqual([
      [77_293_300, 21, '0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544'],
      // Native ETH against USDC: two quote assets, no launch, still a pool init.
      [77_323_583, 27, '0x0000000000000000000000000000000000000000'],
      [77_327_518, 22, '0x95a72f9dd348bd2aae0ad40b8c8f446c5222a0cc'],
    ]);
    expect(result.poolInits[0]).toMatchObject({
      poolId: '0x89dc10f89490b8a1fa1b7935063a48ca2644a0a0ae5ba3dcd52ff46ff832398b',
      currency0: '0x0830a9dd26a04e959657ab6788d45f5725590c32',
      currency1: '0x638a36bebc29aca22fcf7a298d8fded6ea086c07',
      txHash: '0xd5b6aaa64fb8e6b0921d92fb8c433edeaf151794b950dea347a47099cccd26d0',
    });
    // The quote-only pool writes no launch; the hook never becomes one either.
    const launched = result.launches.map((launch) => launch.contractAddress);
    expect(launched).not.toContain('0x5fc5360d0400a0fd4f2af552add042d716f1d168');
    expect(launched).not.toContain('0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544');
    expect(launched.sort()).toEqual(['0x0830a9dd26a04e959657ab6788d45f5725590c32', '0x2f76ee20087d9c880379093c2fd0e81108ee24ba', '0x638a36bebc29aca22fcf7a298d8fded6ea086c07']);
  });

  it('keeps a hooked pool between two quote assets that the token filter drops', async () => {
    const factory = dexPoolFactoryById('UNISWAP_V4_POOLS')!;
    const topicFor = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
    const hook = '0x00000000000000000000000000000000000020cc';
    const word = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: [
          {
            address: factory.factoryAddress,
            topics: [factory.eventTopic0, `0x${'ab'.repeat(32)}`, topicFor('0x0000000000000000000000000000000000000000'), topicFor(WETH)],
            data: `0x${word('bb8')}${word('3c')}${word(hook)}${word('1')}${word('0')}`,
            blockNumber: '0x10',
            transactionHash: '0xquote',
            logIndex: '0x3',
          },
        ],
      }),
    });
    const result = await scanFactory(factory, { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 100, sleep: noSleep }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.launches).toEqual([]);
    expect(result.poolInits).toEqual([expect.objectContaining({ hook, logIndex: 3, currency0: '0x0000000000000000000000000000000000000000', currency1: WETH })]);
  });

  it('a window the RPC never answered yields no pool init and no hook claim', async () => {
    const stub = stubFetch({ status: 502, body: 'bad gateway' });
    const result = await scanFactory(
      dexPoolFactoryById('UNISWAP_V4_POOLS')!,
      { rpcUrl: 'https://rpc.example', fromBlock: 0, toBlock: 100, sleep: noSleep },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.truncated).toBe(true);
    expect(result.poolInits).toEqual([]);
    expect(result.launchHookClaims).toEqual([]);
  });

  it('reads the Airlock Create words as asset 0, initializer 1, poolOrHook 2, and claims the initializer when poolOrHook is the asset (2026-10-01)', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('doppler-airlock-create.json') });
    const airlock = dexPoolFactoryById('DOPPLER_AIRLOCK')!;
    expect(airlock.launchHook).toEqual({ protocol: 'doppler', assetWord: 0, initializerWord: 1, poolOrHookWord: 2 });
    const result = await scanFactory(airlock, { rpcUrl: 'https://rpc.example', fromBlock: 734_616, toBlock: 734_616, sleep: noSleep }, testContext({ fetchImpl: stub.fetchImpl }));
    // The multicurve initializer returns the asset as poolOrHook and is itself the pools' hook.
    expect(result.launchHookClaims).toEqual([
      {
        protocol: 'doppler',
        hook: '0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544',
        asset: '0xa61b14c20b3fbd26a16507459ba48658a64bf7be',
        blockNumber: 734_616,
        txHash: '0x8d32b9ddc5a9a2f8325dbbafca67065fe490c677800869622e6f3f866e4a427e',
      },
    ]);
    expect(result.poolInits).toEqual([]);
  });

  it('claims poolOrHook itself when an initializer returns a distinct contract', () => {
    const word = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
    const asset = '0x1111111111111111111111111111111111111111';
    const initializer = '0x2222222222222222222222222222222222222222';
    const hook = '0x3333333333333333333333333333333333332cc0';
    const spec = { protocol: 'doppler', assetWord: 0, initializerWord: 1, poolOrHookWord: 2 };
    const log = { data: `0x${word(asset)}${word(initializer)}${word(hook)}`, blockNumber: '0x1', transactionHash: '0xAB' };
    expect(decodeLaunchHookClaim(log, spec)).toMatchObject({ hook, asset, txHash: '0xab' });
    // Malformed data is no claim at all.
    expect(decodeLaunchHookClaim({ ...log, data: `0x${word(asset)}` }, spec)).toBeUndefined();
  });

  it('decodes no hook for the v2, v3 and Airlock entries', () => {
    for (const factory of DEX_POOL_FACTORIES) {
      expect(factory.hookDataWord).toBe(factory.id === 'UNISWAP_V4_POOLS' ? 2 : undefined);
      expect(Boolean(factory.launchHook)).toBe(factory.id === 'DOPPLER_AIRLOCK');
    }
  });
});
