import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createExplorerContractAdapter } from './blockscout-contract';

const INSTANCE = 'https://robinhoodchain.blockscout.com';
const PRO = { baseUrl: 'https://api.blockscout.com', chainId: 4663, apiKey: 'proapi_secret' };
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const read = async (fixture: string, address: string) => {
  const stub = stubFetch({ status: 200, body: readFixture(fixture), headers: JSON_HEADERS });
  const result = await createExplorerContractAdapter().fetch({ ...PRO, address }, testContext({ fetchImpl: stub.fetchImpl }));
  return { result, stub };
};

describe('explorer smart-contract detail (audit D rec. 5)', () => {
  it('reads the record only through the keyed API, and never the instance (2026-09-30)', async () => {
    const { stub } = await read('explorer-smart-contract-published.json', '0xF8BC08092C06DB6148114DCF82AF881F1085F92B');
    expect(stub.requests[0]?.url).toBe('https://api.blockscout.com/api/v2/smart-contracts/0xf8bc08092c06db6148114dcf82af881f1085f92b?chain_id=4663&apikey=proapi_secret');
    const instance = stubFetch({ status: 200, body: readFixture('explorer-smart-contract-published.json'), headers: JSON_HEADERS });
    const refused = await createExplorerContractAdapter().fetch({ baseUrl: INSTANCE, apiKey: 'proapi_secret', address: '0xf8bc08092c06db6148114dcf82af881f1085f92b' }, testContext({ fetchImpl: instance.fetchImpl }));
    expect(instance.requests).toHaveLength(0);
    expect(refused.errorCode).toBe('BLOCKED_URL');
  });

  it('says source published for a contract whose source was submitted for its own address', async () => {
    const { result } = await read('explorer-smart-contract-published.json', '0xf8bc08092c06db6148114dcf82af881f1085f92b');
    expect(hasData(result)).toBe(true);
    expect(result.data).toMatchObject({ verified: true, name: 'WOOD', isProxy: false, implementations: [], verification: { method: 'SOURCE_PUBLISHED', match: 'FULL' } });
    expect(result.data?.abi?.functions.length).toBeGreaterThan(0);
    expect(result.data?.verification?.verifiedAt?.toISOString()).toBe('2026-07-13T16:12:57.962Z');
  });

  it('says source matched by explorer for a launchpad template the bytecode database matched', async () => {
    const { result } = await read('explorer-smart-contract-bytecode-match.json', '0xb33eb16782776b4d738c0fd643577cb0284db610');
    expect(result.data).toMatchObject({ verified: true, name: 'PonsV2LauncherToken', verification: { method: 'BYTECODE_MATCH', match: 'FULL' } });
  });

  it('reports an upgradeable proxy with its implementation — the claim explorer_proxy never carried', async () => {
    const { result } = await read('explorer-smart-contract-beacon-proxy.json', '0x0bb40d7fbae7f0c69bc5910c601987dce697d85f');
    expect(result.data).toMatchObject({
      isProxy: true,
      proxyType: 'eip1967_beacon',
      implementation: '0xef3b461697c6bd38c5458afa31e1250c98fd0f5f',
      implementations: ['0xef3b461697c6bd38c5458afa31e1250c98fd0f5f'],
    });
  });

  it('reads an EIP-1167 clone as a copy of its implementation, never an upgradeable proxy, and not itself verified', async () => {
    const { result } = await read('explorer-smart-contract-clone.json', '0xa15cd06dd305269a0f48bebeb30aa3588fba7b32');
    expect(result.data).toMatchObject({ verified: false, isProxy: false, proxyType: 'eip1167', implementations: ['0x581f7b996e6d3e436c537989157c9cb36421419b'] });
    expect(result.data).not.toHaveProperty('implementation');
    expect(result.data).not.toHaveProperty('verification');
    expect(result.data).not.toHaveProperty('abi');
  });

  it('claims an upgradeable proxy only for an upgradeable type with one implementation: a diamond, a delegation or an unknown type claims nothing', async () => {
    for (const [proxyType, implementations, claims] of [
      ['eip2535', ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20)], false],
      ['eip7702', ['0x' + '11'.repeat(20)], false],
      ['unknown', ['0x' + '11'.repeat(20)], false],
      ['master_copy', ['0x' + '11'.repeat(20)], false],
      ['basic_implementation', ['0x' + '11'.repeat(20)], true],
    ] as const) {
      const body = JSON.stringify({ is_verified: null, proxy_type: proxyType, implementations: implementations.map((address_hash) => ({ address_hash })) });
      const stub = stubFetch({ status: 200, body, headers: JSON_HEADERS });
      const result = await createExplorerContractAdapter().fetch({ ...PRO, address: '0x99c0af645a9000b7d523ce30d8eb848c6a1e600d' }, testContext({ fetchImpl: stub.fetchImpl }));
      expect(result.data?.isProxy).toBe(claims);
      expect(result.data?.proxyType).toBe(proxyType);
    }
  });

  it('reads an unverified contract as unverified, with no proxy', async () => {
    const { result } = await read('explorer-smart-contract-unverified.json', '0x99c0af645a9000b7d523ce30d8eb848c6a1e600d');
    expect(result.data).toMatchObject({ verified: false, isProxy: false, implementations: [] });
    expect(result.data).not.toHaveProperty('name');
  });

  it('refuses a challenge page and an off-origin answer', async () => {
    const html = stubFetch({ status: 200, body: '<html>Just a moment…</html>', headers: { 'content-type': 'text/html' } });
    const challenged = await createExplorerContractAdapter().fetch({ ...PRO, address: '0x99c0af645a9000b7d523ce30d8eb848c6a1e600d' }, testContext({ fetchImpl: html.fetchImpl }));
    expect(challenged.status).toBe('error');
    const moved = stubFetch({ status: 200, body: readFixture('explorer-smart-contract-unverified.json'), headers: JSON_HEADERS, url: 'https://elsewhere.example/api' });
    const offOrigin = await createExplorerContractAdapter().fetch({ ...PRO, address: '0x99c0af645a9000b7d523ce30d8eb848c6a1e600d' }, testContext({ fetchImpl: moved.fetchImpl }));
    expect(offOrigin.errorCode).toBe('INVALID_RESPONSE');
  });

  it('only handles the keyed API and a well-formed address', () => {
    expect(createExplorerContractAdapter().canHandle({ ...PRO, address: '0x99c0af645a9000b7d523ce30d8eb848c6a1e600d' })).toBe(true);
    expect(createExplorerContractAdapter().canHandle({ baseUrl: INSTANCE, address: '0x99c0af645a9000b7d523ce30d8eb848c6a1e600d' })).toBe(false);
    expect(createExplorerContractAdapter().canHandle({ ...PRO, address: '0x1' })).toBe(false);
  });
});
