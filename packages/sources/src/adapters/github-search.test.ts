import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubSearchAdapter } from './github';

describe('GitHub repository search', () => {
  const adapter = createGithubSearchAdapter();

  it('normalizes hits and drops forks', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-search.json') });
    const result = await adapter.fetch(
      { query: 'topic:robinhood-chain' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(hasData(result)).toBe(true);
    // Three in the fixture; the third is a fork and says nothing about its owner.
    expect(result.data?.hits.map((hit) => hit.fullName)).toEqual([
      'eurotropica01-spec/squeeze',
      'Meridian402/meridian',
    ]);
    // The raw page held three; paging is judged on that, not on the two kept.
    expect(result.data?.pageSize).toBe(3);
    expect(result.data?.hits[1]).toMatchObject({
      owner: 'Meridian402',
      name: 'meridian',
      homepage: 'https://meridian402.xyz',
      stars: 3,
      isArchived: false,
    });
    expect(result.data?.hits[1]?.topics).toContain('robinhood-chain');
  });

  it('requests the page it was asked for, defaulting to the first', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-search.json') });
    const ctx = testContext({ fetchImpl: stub.fetchImpl });

    await adapter.fetch({ query: 'topic:robinhood-chain' }, ctx);
    await adapter.fetch({ query: 'topic:robinhood-chain', page: 3, perPage: 100 }, ctx);

    expect(stub.requests[0]?.url).toContain('&per_page=50&page=1');
    expect(stub.requests[1]?.url).toContain('&per_page=100&page=3');
  });

  it('never sends a token header when none is configured', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-search.json') });
    await adapter.fetch({ query: 'topic:robinhood-chain' }, testContext({ fetchImpl: stub.fetchImpl }));
    const headers = stub.requests[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBeUndefined();
  });
});
