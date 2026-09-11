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
    expect(result.data?.[0]).toMatchObject({ sha: 'aaa1111', authorLogin: 'ada', isBot: false });
  });

  it('keeps only the first line of a commit message', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commits.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.[0]?.message).toBe('feat: autonomous execution');
  });

  it('flags bot, dependency and merge commits so they can be excluded', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commits.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    const bots = result.data?.filter((commit) => commit.isBot).map((commit) => commit.sha);
    expect(bots).toEqual(['ddd4444', 'eee5555']);
  });

  it('drops commits with no usable date', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commits.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.map((commit) => commit.sha)).not.toContain('fff6666');
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
