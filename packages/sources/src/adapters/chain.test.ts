import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createBlockscoutAdapter } from './blockscout';
import { createBlockscoutVerifiedAdapter } from './blockscout-verified';
import { createRpcContractAdapter } from './rpc';

const ADDRESS = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';

describe('Blockscout adapter', () => {
  const adapter = createBlockscoutAdapter();
  const input = { baseUrl: 'https://scout.robinhoodchain.example', address: ADDRESS };

  it('normalizes contract evidence from a fixture', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-address.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data).toMatchObject({
      isContract: true,
      isVerified: true,
      contractName: 'AgentOSToken',
      token: { symbol: 'AOS', decimals: 18, type: 'ERC-20' },
    });
  });

  it('captures proxy implementations for upgrade evidence', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-address.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.implementationAddresses).toEqual([
      '0x8888888888888888888888888888888888888888',
    ]);
  });

  it('never requests a holders endpoint', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-address.json') });
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    for (const request of stub.requests) {
      expect(request.url.toLowerCase()).not.toContain('holder');
      expect(request.url.toLowerCase()).not.toContain('token-transfers');
    }
  });

  it('builds an explorer link for the evidence trail', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-address.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.explorerUrl).toBe(
      `https://scout.robinhoodchain.example/address/${ADDRESS}`,
    );
  });
});

describe('RPC contract adapter', () => {
  const adapter = createRpcContractAdapter();
  const input = { rpcUrl: 'https://rpc.robinhoodchain.example', address: ADDRESS };

  it('detects a contract from returned bytecode', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-getcode.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.isContract).toBe(true);
    expect(result.data?.bytecodeSize).toBeGreaterThan(0);
  });

  it('treats an empty code response as a non-contract address', async () => {
    const stub = stubFetch({ status: 200, body: '{"jsonrpc":"2.0","id":1,"result":"0x"}' });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.isContract).toBe(false);
    expect(result.data?.bytecodeSize).toBe(0);
  });

  it('reports a JSON-RPC error object as an invalid response', async () => {
    const stub = stubFetch({
      status: 200,
      body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"boom"}}',
    });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('issues a POST and does not send conditional headers', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('rpc-getcode.json') });
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"x"' }));

    expect(stub.requests[0]?.init?.method).toBe('POST');
    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers['if-none-match']).toBeUndefined();
  });
});


describe('blockscout PRO API routing (2026-09-12)', () => {
  it('sends chain_id and the key as query parameters and never echoes the key back', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-address.json') });
    const result = await createBlockscoutAdapter().fetch(
      { baseUrl: 'https://api.blockscout.com', address: '0x1111111111111111111111111111111111111111', chainId: 4663, apiKey: 'proapi_secret' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(stub.requests[0]?.url).toBe('https://api.blockscout.com/api/v2/addresses/0x1111111111111111111111111111111111111111?chain_id=4663&apikey=proapi_secret');
    expect(JSON.stringify(result)).not.toContain('proapi_secret');
    expect(result.sourceUrl).toContain('apikey=REDACTED');
  });
});


describe('blockscout PRO listing of verified contracts (2026-09-12)', () => {
  it('asks the Etherscan-style listing since a moment, pages by number, and reports what it knows', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-pro-listcontracts.json') });
    const since = new Date('2026-09-11T00:00:00Z');
    const result = await createBlockscoutVerifiedAdapter().fetch(
      { baseUrl: 'https://api.blockscout.com', chainId: 4663, apiKey: 'proapi_secret', since, nextPage: { page: 2 } },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(stub.requests[0]?.url).toBe(
      `https://api.blockscout.com/v2/api?module=contract&action=listcontracts&filter=verified&page=2&offset=100&verified_at_start_timestamp=${Math.floor(since.getTime() / 1000)}&chain_id=4663&apikey=proapi_secret`,
    );
    expect(result.data?.contracts.map((c) => [c.address, c.name, c.isProxy, c.flaggedScam])).toEqual([
      ['0xcb199e9bbd4a3e52331eb1e90d17e6d3746b5fc6', 'HoodlockVault', false, false],
      ['0x0000000000000000000000000000000000000065', 'ArbSys', false, false],
    ]);
    // Two rows is less than a page: nothing more to read.
    expect(result.data?.nextPage).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('proapi_secret');
  });
});
