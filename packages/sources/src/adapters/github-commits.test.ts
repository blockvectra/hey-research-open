import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubCommitsAdapter } from './github-commits';

const input = {
  owner: 'agentos',
  repo: 'core',
  since: new Date('2026-08-25T00:00:00Z'),
};

describe('GitHub commits adapter', () => {
  const adapter = createGithubCommitsAdapter();

  it('normalizes commits from a fixture', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commits.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    expect(result.data?.commits[0]).toMatchObject({ sha: 'aaa1111', authorLogin: 'ada', isBot: false });
  });

  it('keeps only the first line of a commit message', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commits.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.commits[0]?.message).toBe('feat: autonomous execution');
  });

  it('flags bot, dependency and merge commits so they can be excluded', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commits.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    const bots = result.data?.commits.filter((commit) => commit.isBot).map((commit) => commit.sha);
    expect(bots).toEqual(['ddd4444', 'eee5555']);
  });

  it('drops commits with no usable date', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commits.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.commits.map((commit) => commit.sha)).not.toContain('fff6666');
  });

  /** A synthetic page: `size` rows, the first a dependabot commit, one commit per hour back from `newest`. */
  const pageOf = (size: number, newest = new Date('2026-08-30T10:00:00Z')) =>
    JSON.stringify(
      Array.from({ length: size }, (_, index) => ({
        sha: `sha${index}`,
        commit: {
          message: index === 0 ? 'chore(deps): bump zod' : `feat: change ${index}`,
          author: { name: index === 0 ? 'dependabot[bot]' : 'Ada', date: new Date(newest.getTime() - index * 3_600_000).toISOString() },
        },
        author: index === 0 ? { login: 'dependabot[bot]', type: 'Bot' } : { login: 'ada', type: 'User' },
      })),
    );

  describe('page truncation is judged on the raw page, not the human count (round-8, 2026-09-18)', () => {
    it('reports a full page with a bot row on it as truncated, with its raw size and oldest commit', async () => {
      const stub = stubFetch({ status: 200, body: pageOf(100) });
      const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

      expect(result.data?.pageSize).toBe(100);
      expect(result.data?.truncated).toBe(true);
      expect(result.data?.commits.filter((commit) => !commit.isBot)).toHaveLength(99);
      expect(result.data?.oldestCommitAt?.toISOString()).toBe('2026-08-26T07:00:00.000Z');
    });

    it('reports a short page as exact', async () => {
      const stub = stubFetch({ status: 200, body: pageOf(40) });
      const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

      expect(result.data?.pageSize).toBe(40);
      expect(result.data?.truncated).toBe(false);
    });

    it('believes a Link header over the page length, either way', async () => {
      const next = { link: '<https://api.github.com/repositories/1/commits?page=2>; rel="next", <https://api.github.com/repositories/1/commits?page=9>; rel="last"' };
      const shortButMore = await adapter.fetch(
        input,
        testContext({ fetchImpl: stubFetch({ status: 200, body: pageOf(40), headers: next }).fetchImpl }),
      );
      expect(shortButMore.data?.truncated).toBe(true);

      const last = { link: '<https://api.github.com/repositories/1/commits?page=1>; rel="prev", <https://api.github.com/repositories/1/commits?page=1>; rel="first"' };
      const fullButLast = await adapter.fetch(
        input,
        testContext({ fetchImpl: stubFetch({ status: 200, body: pageOf(100), headers: last }).fetchImpl }),
      );
      expect(fullButLast.data?.truncated).toBe(false);
    });

    it('measures fullness against the page size it asked for', async () => {
      const stub = stubFetch({ status: 200, body: pageOf(30) });
      const result = await adapter.fetch({ ...input, perPage: 30 }, testContext({ fetchImpl: stub.fetchImpl }));
      expect(result.data?.truncated).toBe(true);
    });
  });

  it('requests only commits since the given instant', async () => {
    const stub = stubFetch({ status: 200, body: '[]' });
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(stub.requests[0]?.url).toContain('since=2026-08-25T00%3A00%3A00.000Z');
  });

  it('rejects owner and repo values that are not path segments', () => {
    expect(adapter.canHandle({ ...input, repo: '../../etc' })).toBe(false);
  });

  it('degrades without throwing when GitHub is down', async () => {
    const stub = stubFetch({ status: 503 });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
  });
});
