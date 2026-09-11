import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createSourcifyAdapter, createSourcifyListAdapter } from './sourcify';

const ADDRESS = '0x4C3B4CDd55b2E9e60eefcD93234A77D4AD53e365';

describe('Sourcify v2 contract lookup', () => {
  const adapter = createSourcifyAdapter();

  it('only handles a chain and a well-formed address', () => {
    expect(adapter.canHandle({ chainId: 4663, address: ADDRESS })).toBe(true);
    expect(adapter.canHandle({ chainId: 0, address: ADDRESS })).toBe(false);
    expect(adapter.canHandle({ chainId: 4663, address: 'StripVault' })).toBe(false);
  });

  it('calls the v2 per-contract route, not the retired v1 check', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contract.json') });
    await adapter.fetch({ chainId: 4663, address: ADDRESS }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe(`https://sourcify.dev/server/v2/contract/4663/${ADDRESS}?fields=all`);
  });

  it('maps a metadata-tolerant match to partial and keeps the contract name', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contract.json') });
    const result = await adapter.fetch({ chainId: 4663, address: ADDRESS }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data).toMatchObject({
      chainId: 4663,
      address: ADDRESS,
      match: 'partial',
      isVerified: true,
      contractName: 'StripVault',
    });
    expect(result.data?.verifiedAt?.toISOString()).toBe('2026-09-02T11:36:46.000Z');
  });

  /*
   * v2 answers "no verified source" with a 200 and a null match. That is a
   * definite answer, so it is returned as data rather than as `missing` —
   * a caller can now tell "checked and unverified" from "never checked".
   */
  it('reports an unverified contract as a definite answer, not a miss', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contract-unverified.json') });
    const result = await adapter.fetch(
      { chainId: 4663, address: '0x8eC575649f729b570181213E5f0290789C5cd275' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.status).toBe('fresh');
    expect(result.data).toMatchObject({ match: 'none', isVerified: false });
    expect(result.data).not.toHaveProperty('contractName');
  });
});

describe('Sourcify v2 verified-contract listing', () => {
  const adapter = createSourcifyListAdapter();

  it('lists newest first with the requested size, and appends the cursor when given', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contracts.json') });
    const ctx = testContext({ fetchImpl: stub.fetchImpl });

    await adapter.fetch({ chainId: 4663, limit: 200 }, ctx);
    await adapter.fetch({ chainId: 4663, limit: 200, afterMatchId: '47034235' }, ctx);

    expect(stub.requests[0]?.url).toBe('https://sourcify.dev/server/v2/contracts/4663?sort=desc&limit=200');
    expect(stub.requests[1]?.url).toBe(
      'https://sourcify.dev/server/v2/contracts/4663?sort=desc&limit=200&afterMatchId=47034235',
    );
  });

  it('normalizes rows into the shared verified-contract shape and exposes the next cursor', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contracts.json') });
    const result = await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.contracts).toHaveLength(2);
    expect(result.data?.contracts[0]).toMatchObject({
      address: '0xf7a4Af51De7B3ccA9b48FC8c9180b48a6628624D',
      flaggedScam: false,
      isProxy: false,
    });
    expect(result.data?.contracts[0]?.verifiedAt?.toISOString()).toBe('2026-09-02T11:38:49.000Z');
    // Oldest row on the page is the cursor for the next one.
    expect(result.data?.lastMatchId).toBe('47034235');
  });

  it('clamps the page size to what Sourcify serves', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contracts.json') });
    await adapter.fetch({ chainId: 4663, limit: 5_000 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toContain('limit=200');
  });
});
