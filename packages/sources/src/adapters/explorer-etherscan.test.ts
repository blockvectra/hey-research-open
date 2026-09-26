import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { abiSignatures, createAddressTxListAdapter, createContractCreationAdapter, createContractSourceAdapter, explorerProxyClaim } from './explorer-etherscan';

const api = { baseUrl: 'https://api.blockscout.com', chainId: 4663, apiKey: 'proapi_secret' };
const TOKEN = '0xb33eb16782776b4d738c0fd643577cb0284db610';

describe('explorer etherscan-style reads (Blockscout PRO)', () => {
  it('reads who created a contract, through which factory, and when', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('explorer-getcontractcreation.json') });
    const result = await createContractCreationAdapter().fetch({ ...api, addresses: [TOKEN, '0x07ff37412adc90524f5ea37a34fb86268e4ff066'] }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toContain('module=contract&action=getcontractcreation&contractaddresses=');
    expect(stub.requests[0]?.url).toContain('chain_id=4663&apikey=proapi_secret');
    expect(result.data).toEqual([
      { address: TOKEN, creator: '0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6', factory: '0x3711cea4feade896c913c68f01eda97cb06d1a42', txHash: '0x53baa96a207184574779986e61b9988c00cfab760428271edf1802e22c184fa6', blockNumber: 58729102, createdAt: new Date(1788975306 * 1000) },
      { address: '0x07ff37412adc90524f5ea37a34fb86268e4ff066', creator: '0xa6d8376c000000000000000000000000000000aa', txHash: '0xef9b7bcd00000000000000000000000000000000000000000000000000000001', blockNumber: 16801116, createdAt: new Date(1784760942 * 1000) },
    ]);
    expect(JSON.stringify(result)).not.toContain('proapi_secret');
  });

  it('lists what an address sent since a block and marks the deployments and the failures', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('explorer-txlist.json') });
    const result = await createAddressTxListAdapter().fetch({ ...api, address: '0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6', startBlock: 58729102 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toContain('module=account&action=txlist&address=0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6&startblock=58729102&page=1&offset=100&sort=asc');
    expect(result.data?.map((tx) => [tx.contractAddress ?? null, tx.blockNumber, tx.failed])).toEqual([
      [null, 58729102, false],
      ['0xcb199e9bbd4a3e52331eb1e90d17e6d3746b5fc6', 60100000, false],
      ['0xdead00000000000000000000000000000000dead', 60100050, true],
    ]);
  });

  it('reads an empty listing as no transactions, not as an error', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('explorer-txlist-empty.json') });
    const result = await createAddressTxListAdapter().fetch({ ...api, address: '0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data).toEqual([]);
  });

  it('reads the string `result` the provider actually returns when there is nothing to list', async () => {
    /*
     * `explorer-etherscan.ts:9-12` documents that this API answers with a
     * *string* rather than a list when empty, and `rows()` exists to absorb
     * exactly that. The only empty fixture held `"result": []` until round 9
     * (2026-09-19), so the documented behaviour was certified by nothing and
     * the union in `envelope()` was never exercised.
     */
    const stub = stubFetch({ status: 200, body: readFixture('explorer-txlist-empty-string.json') });
    const result = await createAddressTxListAdapter().fetch({ ...api, address: '0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data).toEqual([]);
  });

  it('cannot tell a rate-limit envelope from an empty listing (2026-09-19)', async () => {
    /*
     * The provider's rate-limit answer is a 200 with `status: "0"`,
     * `message: "NOTOK"` and a string `result`, which `rows()` absorbs into
     * the same empty list as "no transactions found". Pinned deliberately:
     * the caller currently reads "this address has sent nothing since that
     * block" from a request that was refused, which is a real gap in the
     * adapter rather than in this test. Changing that behaviour has to change
     * this case with it.
     */
    const stub = stubFetch({ status: 200, body: readFixture('explorer-ratelimit.json') });
    const result = await createAddressTxListAdapter().fetch({ ...api, address: '0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data).toEqual([]);

    // The same envelope on the creation read, which is where it would be read
    // as "this contract has no creation record".
    const creation = stubFetch({ status: 200, body: readFixture('explorer-ratelimit.json') });
    const created = await createContractCreationAdapter().fetch({ ...api, addresses: [TOKEN] }, testContext({ fetchImpl: creation.fetchImpl }));
    expect(created.data).toEqual([]);

    // And on the source read, where it becomes "unverified".
    const source = stubFetch({ status: 200, body: readFixture('explorer-ratelimit.json') });
    const named = await createContractSourceAdapter().fetch({ ...api, address: TOKEN }, testContext({ fetchImpl: source.fetchImpl }));
    expect(named.data).toEqual({ address: TOKEN, verified: false });
  });

  it('names a verified contract', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('explorer-getsourcecode.json') });
    const result = await createContractSourceAdapter().fetch({ ...api, address: '0xcb199e9bbd4a3e52331eb1e90d17e6d3746b5fc6' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toEqual({ address: '0xcb199e9bbd4a3e52331eb1e90d17e6d3746b5fc6', verified: true, name: 'HoodlockVault' });
  });

  it('reads a verified contract’s ABI as canonical function and event signatures (2026-09-24)', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('explorer-getsourcecode-abi.json') });
    const result = await createContractSourceAdapter().fetch({ ...api, address: '0xcb199e9bbd4a3e52331eb1e90d17e6d3746b5fc6' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toMatchObject({ verified: true, name: 'PonsV2LauncherToken', compiler: 'v0.8.35+commit.47b9dedd' });
    const abi = result.data!.abi!;
    expect(abi.functions.length).toBeGreaterThan(3);
    expect(abi.functions).toEqual([...abi.functions].sort());
    for (const signature of [...abi.functions, ...abi.events]) expect(signature).toMatch(/^[A-Za-z_$][\w$]*\([^\s]*\)$/);
  });

  it('reads the explorer’s proxy claim for a ClonableBeaconProxy (2026-09-26, M4 G1)', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('explorer-getsourcecode-beacon.json') });
    const address = '0x5f10a1f6a2b1b0e3c1d7c6c4b0e0f2a1d3c549c3';
    const result = await createContractSourceAdapter().fetch({ ...api, address }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toMatchObject({ address, verified: true, name: 'ClonableBeaconProxy', isProxy: true, implementation: '0xb354c1a2e3d4f5a6b7c8d9e0f1a2b3c4d5e65ae2' });
    // The proxy's own ABI: events only, which is why a baseline read from it is empty of functions.
    expect(result.data!.abi?.functions ?? []).toEqual([]);
  });

  it('says nothing about proxying when the explorer said nothing', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('explorer-getsourcecode.json') });
    const result = await createContractSourceAdapter().fetch({ ...api, address: '0xcb199e9bbd4a3e52331eb1e90d17e6d3746b5fc6' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).not.toHaveProperty('isProxy');
    expect(result.data).not.toHaveProperty('implementation');
  });

  it('holds no ABI for an unverified contract', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('explorer-getsourcecode-unverified.json') });
    const result = await createContractSourceAdapter().fetch({ ...api, address: '0x000000000000000000000000000000000000dead' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toEqual({ address: '0x000000000000000000000000000000000000dead', verified: false });
  });
});

describe('explorerProxyClaim', () => {
  it('reads both explorer dialects and refuses a zero implementation', () => {
    expect(explorerProxyClaim({ IsProxy: 'false' })).toEqual({ isProxy: false });
    expect(explorerProxyClaim({ Proxy: '1', Implementation: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD' })).toEqual({ isProxy: true, implementation: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' });
    expect(explorerProxyClaim({ IsProxy: 'true', ImplementationAddress: '0x0000000000000000000000000000000000000000' })).toEqual({ isProxy: true });
    expect(explorerProxyClaim({ ImplementationAddresses: ['0x' + '12'.repeat(20)] })).toEqual({ implementation: '0x' + '12'.repeat(20) });
    expect(explorerProxyClaim({ IsProxy: 'false', ImplementationAddress: '0x' + '12'.repeat(20) })).toEqual({ isProxy: false });
    expect(explorerProxyClaim({})).toEqual({});
  });
});

describe('abiSignatures', () => {
  it('expands tuples and keeps array suffixes, ignoring constructors and errors', () => {
    const abi = JSON.stringify([
      { type: 'constructor', inputs: [{ type: 'string' }] },
      { type: 'function', name: 'swap', inputs: [{ type: 'tuple', components: [{ type: 'address' }, { type: 'uint256' }] }, { type: 'bytes32[]' }] },
      { type: 'function', name: 'batch', inputs: [{ type: 'tuple[]', components: [{ type: 'uint8' }] }] },
      { type: 'event', name: 'Swapped', inputs: [{ type: 'address', indexed: true }, { type: 'uint256' }] },
      { type: 'error', name: 'Nope', inputs: [] },
    ]);
    expect(abiSignatures(abi)).toEqual({ functions: ['batch((uint8)[])', 'swap((address,uint256),bytes32[])'], events: ['Swapped(address,uint256)'] });
    expect(abiSignatures('Contract source code not verified')).toBeUndefined();
    expect(abiSignatures('[not json')).toBeUndefined();
  });
});
