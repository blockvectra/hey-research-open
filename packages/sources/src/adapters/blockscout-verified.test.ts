import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createBlockscoutVerifiedAdapter } from './blockscout-verified';

const input = { baseUrl: 'https://robinhoodchain.blockscout.com' };

describe('Blockscout verified-contract listing', () => {
  const adapter = createBlockscoutVerifiedAdapter();

  it('needs an absolute explorer URL', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ baseUrl: 'robinhoodchain.blockscout.com' })).toBe(false);
  });

  it('normalizes a page and keeps the cursor', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-smart-contracts.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.contracts).toHaveLength(3);
    expect(result.data?.nextPage).toEqual({ items_count: 50, smart_contract_id: 904577 });
    expect(stub.requests[0]?.url).toBe('https://robinhoodchain.blockscout.com/api/v2/smart-contracts');
  });

  it('reports proxies with their implementation rather than hiding them', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-smart-contracts.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const proxy = result.data?.contracts[0];

    expect(proxy).toMatchObject({
      address: '0x82F535F484345B4CE057120bb81245A6563C007F',
      name: 'CurvePumpERC1967Proxy',
      isProxy: true,
      implementationAddress: '0x1D18110771eE888e82392071fd3501DF745381A5',
      language: 'solidity',
      flaggedScam: false,
    });
    expect(proxy?.verifiedAt?.toISOString()).toBe('2026-09-02T11:23:19.828Z');
    expect(result.data?.contracts[1]?.isProxy).toBe(false);
    expect(result.data?.contracts[1]?.compilerVersion).toBe('v0.8.29+commit.ab55807c');
  });

  it('identifies itself with the crawler-convention agent string the explorer admits', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-smart-contracts.json') });
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers['user-agent']).toBe('Mozilla/5.0 (compatible; HEYResearchBot/0.1; +https://heyresearch.xyz)');
  });

  it('passes the cursor back as query parameters', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('blockscout-smart-contracts.json') });
    await adapter.fetch(
      { ...input, nextPage: { items_count: 50, smart_contract_id: 904577 } },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(stub.requests[0]?.url).toBe(
      'https://robinhoodchain.blockscout.com/api/v2/smart-contracts?items_count=50&smart_contract_id=904577',
    );
  });

  it('treats a Cloudflare interstitial as an invalid response, not as data', async () => {
    const stub = stubFetch({ status: 200, body: '<!DOCTYPE html><title>Just a moment...</title>' });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
