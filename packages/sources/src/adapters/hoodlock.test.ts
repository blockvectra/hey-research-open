import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  createHoodlockAssetKindAdapter,
  createHoodlockLockBatchAdapter,
  createHoodlockTotalLocksAdapter,
  HOODLOCK,
  HOODLOCK_LOCK_BATCH,
} from './hoodlock';

const RPC = 'https://rpc.example/';
/* Every fixture in this file is a real response from chain 4663, captured 2026-09-22. */

describe('hoodlock total locks', () => {
  it('reads the reconciliation figure and never caches it', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('hoodlock-total.json') });
    const result = await createHoodlockTotalLocksAdapter().fetch({ rpcUrl: RPC }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual({ totalLocks: 515 });
    expect(result.cacheTtlSeconds).toBe(0);
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as [{ method: string; params: [{ to: string; data: string }] }];
    expect(body[0]?.method).toBe('eth_call');
    expect(body[0]?.params[0]).toEqual({ to: HOODLOCK.address, data: '0xd2d18eac' });
  });
});

describe('hoodlock locks', () => {
  it('reads the live balance rather than the original deposit', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('hoodlock-locks.json') });
    const result = await createHoodlockLockBatchAdapter().fetch({ rpcUrl: RPC, lockIds: [0, 1, 316] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    const locks = result.data ?? [];
    expect(locks).toHaveLength(3);

    /*
     * Lock #1 is the whole reason both reads happen. `getLock` still reports
     * the original 100,000 deposit; the locker holds nothing. Trusting
     * `amount` would print withdrawn supply as locked.
     */
    const withdrawn = locks.find((lock) => lock.lockId === 1);
    expect(withdrawn?.originalAmount).toBe('100000000000000000000000');
    expect(withdrawn?.lockedAmount).toBe('0');
    expect(withdrawn?.withdrawn).toBe(true);

    /* Lock #0 has run past its unlock time and has NOT been withdrawn: claimable, not gone. */
    const expired = locks.find((lock) => lock.lockId === 0);
    expect(expired?.withdrawn).toBe(false);
    expect(expired?.lockedAmount).toBe('2000000000000000000000000');
    expect(expired?.unlockAt.toISOString()).toBe('2026-08-06T19:31:00.000Z');

    /* Lock #316 is HEY's own, and the figure the project page prints. */
    const hey = locks.find((lock) => lock.lockId === 316);
    expect(hey?.tokenAddress).toBe('0xb33eb16782776b4d738c0fd643577cb0284db610');
    expect(hey?.lockedAmount).toBe('25324166739187189974762857');
    expect(hey?.withdrawn).toBe(false);
    expect(hey?.unlockAt.toISOString()).toBe('2027-09-09T17:53:00.000Z');
  });

  it('asks for each lock twice, by id, in one batched request', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('hoodlock-locks.json') });
    await createHoodlockLockBatchAdapter().fetch({ rpcUrl: RPC, lockIds: [0, 1, 316] }, testContext({ fetchImpl: stub.fetchImpl }));
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { id: number; method: string; params: [{ to: string; data: string }] }[];
    expect(stub.requests).toHaveLength(1);
    expect(body).toHaveLength(6);
    expect(body.every((call) => call.method === 'eth_call' && call.params[0].to === HOODLOCK.address)).toBe(true);
    /* getLock(316) then lockedAmount(316), the id encoded as a full 32-byte word. */
    expect(body[4]?.params[0].data).toBe(`0xd68f4dd1${(316).toString(16).padStart(64, '0')}`);
    expect(body[5]?.params[0].data).toBe(`0xcf1cb351${(316).toString(16).padStart(64, '0')}`);
  });

  it('omits a lock it could not read rather than reporting it as released', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } },
        { jsonrpc: '2.0', id: 2, error: { code: 3, message: 'execution reverted' } },
      ]),
    });
    const result = await createHoodlockLockBatchAdapter().fetch({ rpcUrl: RPC, lockIds: [7] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('refuses a batch larger than the node answers, before asking', () => {
    const adapter = createHoodlockLockBatchAdapter();
    expect(adapter.canHandle({ rpcUrl: RPC, lockIds: [] })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: RPC, lockIds: Array.from({ length: HOODLOCK_LOCK_BATCH + 1 }, (_, i) => i) })).toBe(false);
    expect(adapter.canHandle({ rpcUrl: RPC, lockIds: [-1] })).toBe(false);
  });
});

describe('hoodlock asset kind', () => {
  it('separates a liquidity pair from a plain token by asking the asset itself', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('hoodlock-asset-kind.json') });
    const result = await createHoodlockAssetKindAdapter().fetch(
      { rpcUrl: RPC, addresses: ['0xFF1692a5616f4bb6292c66AFc066Ac02d782530C', '0xB33eb16782776b4D738c0Fd643577cb0284Db610'] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual([
      {
        address: '0xff1692a5616f4bb6292c66afc066ac02d782530c',
        kind: 'lp',
        token0: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
        token1: '0xc30c5c95afd582b47f11f39b0cb2e01db2142e06',
      },
      /* HEY's token reverts on token0(); a token that is not a pair is not a failed read. */
      { address: '0xb33eb16782776b4d738c0fd643577cb0284db610', kind: 'token' },
    ]);
  });
});
