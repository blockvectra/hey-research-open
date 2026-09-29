import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubPullsAdapter } from './github-pulls';

const input = { owner: 'agentos', repo: 'core' };

describe('GitHub merged pull requests adapter (2026-09-29)', () => {
  const adapter = createGithubPullsAdapter();

  it('keeps the merged ones only: number, merge time and whether automation opened them', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-pulls.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    expect(result.data.merges).toEqual([
      { number: 58, mergedAt: new Date('2026-09-28T14:02:11Z'), isBot: false },
      { number: 57, mergedAt: new Date('2026-09-27T09:30:40Z'), isBot: true },
      { number: 55, mergedAt: new Date('2026-09-25T11:44:03Z'), isBot: false },
    ]);
    expect(result.data.pageSize).toBe(4);
    expect(result.data.oldestUpdatedAt).toEqual(new Date('2026-09-25T11:45:00Z'));
    expect(result.data.truncated).toBe(false);
    expect(stub.requests[0]!.url).toBe('https://api.github.com/repos/agentos/core/pulls?state=closed&sort=updated&direction=desc&per_page=50');
  });

  it('never lets a title, a body, a branch or a person leave the parser (product rule 1)', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-pulls.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const text = JSON.stringify(result.data);
    for (const kept of ['ada', 'grace', 'linus', 'dependabot', 'limit-order', 'feat/', 'Reviewed', 'login', 'title', 'user']) {
      expect(text).not.toContain(kept);
    }
  });

  it('sends the last ETag and reports an unchanged list as not modified', async () => {
    const stub = stubFetch({ status: 304 });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"abc"' }));
    expect(result.status).toBe('not_modified');
    const headers = new Headers(stub.requests[0]!.init?.headers);
    expect(headers.get('if-none-match')).toBe('W/"abc"');
  });

  it('says when GitHub names a next page', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-pulls.json'), headers: { link: '<https://api.github.com/repos/agentos/core/pulls?page=2>; rel="next"' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.truncated).toBe(true);
  });

  it('refuses a repository name that is not one', () => {
    expect(adapter.canHandle({ owner: 'agentos', repo: 'core/../x' })).toBe(false);
  });
});
