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

  it('calls the v2 per-contract route for the four fields HEY reads, never fields=all', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contract.json'), headers: { 'content-type': 'application/json' } });
    await adapter.fetch({ chainId: 4663, address: ADDRESS }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe(`https://sourcify.dev/server/v2/contract/4663/${ADDRESS}?fields=abi,compilation,deployment,proxyResolution`);
  });

  it('maps a metadata-tolerant match to partial and keeps the contract name', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contract.json'), headers: { 'content-type': 'application/json' } });
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
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contract-unverified.json'), headers: { 'content-type': 'application/json' } });
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
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contracts.json'), headers: { 'content-type': 'application/json' } });
    const ctx = testContext({ fetchImpl: stub.fetchImpl });

    await adapter.fetch({ chainId: 4663, limit: 200 }, ctx);
    await adapter.fetch({ chainId: 4663, limit: 200, afterMatchId: '47034235' }, ctx);

    expect(stub.requests[0]?.url).toBe('https://sourcify.dev/server/v2/contracts/4663?sort=desc&limit=200');
    expect(stub.requests[1]?.url).toBe(
      'https://sourcify.dev/server/v2/contracts/4663?sort=desc&limit=200&afterMatchId=47034235',
    );
  });

  it('normalizes rows into the shared verified-contract shape and exposes the next cursor', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contracts.json'), headers: { 'content-type': 'application/json' } });
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
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contracts.json'), headers: { 'content-type': 'application/json' } });
    await adapter.fetch({ chainId: 4663, limit: 5_000 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toContain('limit=200');
  });
});

describe('Sourcify per-address evidence (2026-09-27)', () => {
  const adapter = createSourcifyAdapter();
  const REGISTRY = '0x3E717dc89AAF4605b607324329EEeB0a8B3C8A1c';
  const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

  it('keeps both match halves, the compiler, the ABI as signatures and the creating transaction — never the deployer', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contract-fields.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch({ chainId: 4663, address: REGISTRY }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data).toMatchObject({
      match: 'partial',
      creationMatch: 'match',
      runtimeMatch: 'match',
      contractName: 'ENSRegistry',
      compilerVersion: '0.8.19+commit.7dd6d404',
      language: 'solidity',
      matchId: '40809788',
      proxy: { isProxy: false, implementations: [] },
      deployment: { txHash: '0x8c502807c24d7e6dcf73ccf86ef7f4decaeb5cfff868143410a81fd7ff4d6398', blockNumber: 5708232 },
    });
    expect(result.data?.abi?.functions).toContain('owner(bytes32)');
    expect(result.data?.abi?.events).toContain('NewOwner(bytes32,bytes32,address)');
    // The account that sent the deployment is not read into HEY at all.
    expect(JSON.stringify(result.data)).not.toContain('0x0000000000000000000000000000000000000001');
    expect(result.data?.deployment).not.toHaveProperty('deployer');
  });

  it('reads a proxy resolution with its implementations, lower-cased', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contract-proxy.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch({ chainId: 4663, address: '0x0bb40d7fbae7f0c69bc5910c601987dce697d85f' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toMatchObject({
      match: 'perfect',
      runtimeMatch: 'exact_match',
      proxy: { isProxy: true, proxyType: 'EIP1967BeaconProxy', implementations: ['0xef3b461697c6bd38c5458afa31e1250c98fd0f5f'] },
    });
    expect(result.data).not.toHaveProperty('creationMatch');
  });

  it('answers the live 404 {match:null} as NOT_FOUND, which the domain reads as "not on Sourcify"', async () => {
    const stub = stubFetch({ status: 404, body: readFixture('sourcify-contract-404.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch({ chainId: 4663, address: REGISTRY }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('missing');
    expect(result.errorCode).toBe('NOT_FOUND');
  });

  it('refuses a body that is not JSON and an answer served from another origin', async () => {
    const html = stubFetch({ status: 200, body: '<html>challenge</html>', headers: { 'content-type': 'text/html' } });
    expect((await adapter.fetch({ chainId: 4663, address: REGISTRY }, testContext({ fetchImpl: html.fetchImpl }))).status).toBe('error');

    const moved = stubFetch({ status: 200, body: readFixture('sourcify-contract-fields.json'), headers: JSON_HEADERS, url: 'https://evil.example/v2/contract/4663/x' });
    const offOrigin = await adapter.fetch({ chainId: 4663, address: REGISTRY }, testContext({ fetchImpl: moved.fetchImpl }));
    expect(offOrigin.status).toBe('error');
    expect(offOrigin.errorCode).toBe('INVALID_RESPONSE');
  });

  it("keeps each listed row's match quality and matchId, and the page's newest matchId for the watermark", async () => {
    const stub = stubFetch({ status: 200, body: readFixture('sourcify-contracts.json'), headers: { 'content-type': 'application/json' } });
    const result = await createSourcifyListAdapter().fetch({ chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.contracts[0]).toMatchObject({ sourcifyMatch: 'exact_match', matchId: '47034236' });
    expect(result.data?.firstMatchId).toBe('47034236');
    expect(result.data?.rows).toBe(2);
  });
});
