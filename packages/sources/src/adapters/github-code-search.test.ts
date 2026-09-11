import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubCodeSearchAdapter } from './github-code-search';

const input = { query: '"rpc.mainnet.chain.robinhood.com"', token: 'ghp_test' };

describe('GitHub code search', () => {
  const adapter = createGithubCodeSearchAdapter();

  it('refuses to run without a token: the endpoint does', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ ...input, token: ' ' })).toBe(false);
    expect(adapter.canHandle({ ...input, query: '' })).toBe(false);
  });

  it('returns one hit per matching file with its repository, and reports the total', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-code-search.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.totalCount).toBe(2132);
    // Four files in the fixture; two belong to the same repository and one to a fork.
    expect(result.data?.hits.map((hit) => `${hit.fullName}:${hit.path}`)).toEqual([
      'DefiLlama/chainlist:constants/additionalChainRegistry/chainid-4663.js',
      'Meridian402/meridian:foundry.toml',
      'Meridian402/meridian:src/chains.ts',
      'someone/wormhole-fork:ethereum/env/.env.robinhoodchain.mainnet',
    ]);
    expect(result.data?.hits[1]).toMatchObject({
      owner: 'Meridian402',
      name: 'meridian',
      url: 'https://github.com/Meridian402/meridian',
      isFork: false,
      ownerType: 'Organization',
    });
    // The fork is reported as one, so the caller can refuse it rather than never see it.
    expect(result.data?.hits[3]?.isFork).toBe(true);
  });

  it('sends the token, the API version and the page it was asked for', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-code-search.json') });
    await adapter.fetch({ ...input, page: 3 }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests[0]?.url).toBe(
      'https://api.github.com/search/code?q=%22rpc.mainnet.chain.robinhood.com%22&per_page=100&page=3',
    );
    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer ghp_test');
    expect(headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('surfaces a secondary rate limit as rate_limited with the advertised wait', async () => {
    const stub = stubFetch({
      status: 403,
      body: '{"message":"API rate limit exceeded"}',
      headers: { 'retry-after': '60' },
    });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('rejects a payload that is not a search result', async () => {
    const stub = stubFetch({ status: 200, body: '{"items": "nope"}' });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
