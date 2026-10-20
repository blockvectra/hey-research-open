import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubUpstreamPullsAdapter, repositoryFromApiUrl, upstreamPullState, upstreamPullsQuery } from './github-upstream-pulls';

/**
 * HEY's upstream pull requests (2026-10-21). The fixture is one search page
 * shaped as GitHub answers it, with invented repositories: a merged, an open
 * and a closed-unmerged pull request, an issue (dropped: pull requests only),
 * a pull request in HEY's own repository (dropped: not upstream) and a
 * repository spelled with capitals and a dot.
 */
const page = readFixture('github-upstream-pulls.json');
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

describe('HEY’s pull requests in other repositories', () => {
  it('asks for the account’s pull requests outside its own repositories, newest first, and sends the token', async () => {
    const stub = stubFetch({ status: 200, body: page, headers: JSON_HEADERS });
    await createGithubUpstreamPullsAdapter().fetch({ account: 'hey-research-lab', page: 2, token: 'ghp_test' }, testContext({ fetchImpl: stub.fetchImpl }));
    const url = new URL(stub.requests[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.github.com/search/issues');
    expect(url.searchParams.get('q')).toBe('is:pr author:hey-research-lab -user:hey-research-lab');
    expect(url.searchParams.get('sort')).toBe('created');
    expect(url.searchParams.get('order')).toBe('desc');
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(url.searchParams.get('page')).toBe('2');
    expect((stub.requests[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer ghp_test');
  });

  it('keeps pull requests only, never an issue or a pull request in HEY’s own repository', async () => {
    const stub = stubFetch({ status: 200, body: page, headers: JSON_HEADERS });
    const result = await createGithubUpstreamPullsAdapter().fetch({ account: 'hey-research-lab' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data?.pageSize).toBe(6);
    expect(result.data?.totalCount).toBe(6);
    expect(result.data?.incomplete).toBe(false);
    expect(result.data?.pulls.map((pull) => `${pull.repository}#${pull.number}`)).toEqual([
      'example-chain/chain-registry#1757',
      'example-dex/indexer#2424',
      'example-app/bounty-app#1579',
      'example-org/Docs.Site#53',
    ]);
  });

  it('reads the state in three words and keeps the three dates', async () => {
    const stub = stubFetch({ status: 200, body: page, headers: JSON_HEADERS });
    const result = await createGithubUpstreamPullsAdapter().fetch({ account: 'hey-research-lab' }, testContext({ fetchImpl: stub.fetchImpl }));
    const [merged, open, closed] = result.data!.pulls;
    expect(merged).toEqual({
      repository: 'example-chain/chain-registry',
      number: 1757,
      title: 'fix: replace dead Robinhood Chain explorer url',
      url: 'https://github.com/example-chain/chain-registry/pull/1757',
      state: 'MERGED',
      openedAt: new Date('2026-10-20T07:08:44Z'),
      mergedAt: new Date('2026-10-20T09:46:03Z'),
      closedAt: new Date('2026-10-20T09:46:03Z'),
    });
    expect(open).toMatchObject({ state: 'OPEN', mergedAt: null, closedAt: null });
    expect(closed).toMatchObject({ state: 'CLOSED', mergedAt: null, closedAt: new Date('2026-10-19T16:31:30Z') });
  });

  it('keeps no body, label, comment or account', async () => {
    const stub = stubFetch({ status: 200, body: page, headers: JSON_HEADERS });
    const result = await createGithubUpstreamPullsAdapter().fetch({ account: 'hey-research-lab' }, testContext({ fetchImpl: stub.fetchImpl }));
    const out = JSON.stringify(result.data);
    for (const word of ['Fixture text', 'login', 'CONTRIBUTOR', 'labels', 'comments']) expect(out).not.toContain(word);
  });

  it('drops a pull request another account opened, whatever the query returned', async () => {
    const raw = JSON.parse(page) as { items: { user: { login: string } }[] };
    raw.items[0]!.user.login = 'someone-else';
    const stub = stubFetch({ status: 200, body: JSON.stringify(raw), headers: JSON_HEADERS });
    const result = await createGithubUpstreamPullsAdapter().fetch({ account: 'hey-research-lab' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.pulls.map((pull) => pull.number)).toEqual([2424, 1579, 53]);
  });

  it('refuses an answer that is not a search page', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ message: 'Validation Failed' }), headers: JSON_HEADERS });
    const result = await createGithubUpstreamPullsAdapter().fetch({ account: 'hey-research-lab' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('handles only a GitHub account name', () => {
    const adapter = createGithubUpstreamPullsAdapter();
    expect(adapter.canHandle({ account: 'hey-research-lab' })).toBe(true);
    expect(adapter.canHandle({ account: 'hey research' })).toBe(false);
    expect(adapter.canHandle({ account: 'a+b:c' })).toBe(false);
  });

  it('names the repository and the state with small pure helpers', () => {
    expect(upstreamPullsQuery('hey-research-lab')).toBe('is:pr author:hey-research-lab -user:hey-research-lab');
    expect(repositoryFromApiUrl('https://api.github.com/repos/Owner/repo.name')).toBe('Owner/repo.name');
    expect(repositoryFromApiUrl('https://api.github.com/users/someone')).toBeUndefined();
    expect(upstreamPullState({ state: 'closed', mergedAt: new Date() })).toBe('MERGED');
    expect(upstreamPullState({ state: 'open', mergedAt: null })).toBe('OPEN');
    expect(upstreamPullState({ state: 'closed', mergedAt: null })).toBe('CLOSED');
  });
});
