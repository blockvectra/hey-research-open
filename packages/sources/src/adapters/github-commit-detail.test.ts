import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubCommitDetailAdapter, GITHUB_COMMIT_FILES_PAGE_CAP } from './github-commit-detail';

const input = { owner: 'agentos', repo: 'core', sha: 'aaa1111000000000000000000000000000000000' };

describe('GitHub commit detail adapter', () => {
  const adapter = createGithubCommitDetailAdapter();

  it('normalizes the changed files from a fixture', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commit-detail.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    expect(result.data).toMatchObject({ sha: input.sha, isMerge: false, filesTruncated: false, stats: { additions: 14, deletions: 3, total: 17 } });
    expect(result.data?.files.map((file) => file.filename)).toEqual(['src/runtime/execute.ts', 'src/runtime/execute.test.ts', 'README.md', 'docs/logo.png']);
    expect(result.data?.files[0]?.patch).toContain('execute(plan)');
    // A binary file carries no patch; nothing is invented for it.
    expect(result.data?.files[3]?.patch).toBeUndefined();
    expect(stub.requests[0]?.url).toBe(`https://api.github.com/repos/agentos/core/commits/${input.sha}`);
  });

  it('keeps nothing about who wrote the commit', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-commit-detail.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const text = JSON.stringify(result.data);
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('"ada"');
    expect(Object.keys(result.data ?? {})).not.toContain('author');
  });

  it('says when GitHub listed only part of the files', async () => {
    const files = Array.from({ length: GITHUB_COMMIT_FILES_PAGE_CAP }, (_, index) => ({ filename: `src/f${index}.ts`, status: 'modified', additions: 1, deletions: 0, changes: 1 }));
    const full = await adapter.fetch(input, testContext({ fetchImpl: stubFetch({ status: 200, body: JSON.stringify({ sha: input.sha, files }) }).fetchImpl }));
    expect(full.data?.filesTruncated).toBe(true);

    const next = { link: '<https://api.github.com/repositories/1/commits/x?page=2>; rel="next"' };
    const linked = await adapter.fetch(
      input,
      testContext({ fetchImpl: stubFetch({ status: 200, body: JSON.stringify({ sha: input.sha, files: files.slice(0, 3) }), headers: next }).fetchImpl }),
    );
    expect(linked.data?.filesTruncated).toBe(true);
  });

  it('reads a merge from its parents', async () => {
    const body = JSON.stringify({ sha: input.sha, parents: [{ sha: 'a' }, { sha: 'b' }], files: [] });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stubFetch({ status: 200, body }).fetchImpl }));
    expect(result.data?.isMerge).toBe(true);
  });

  it('refuses a sha or path that is not one', () => {
    expect(adapter.canHandle({ ...input, sha: '../../etc' })).toBe(false);
    expect(adapter.canHandle({ ...input, sha: 'main' })).toBe(false);
    expect(adapter.canHandle({ ...input, repo: 'a/b' })).toBe(false);
    expect(adapter.canHandle(input)).toBe(true);
  });

  it('reports a GitHub rate limit as one, without throwing', async () => {
    const stub = stubFetch({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1788000000' }, body: '{}' });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toBeUndefined();
    expect(result.errorCode).toBe('RATE_LIMITED');
  });

  it('reports a commit GitHub no longer has without data', async () => {
    const result = await adapter.fetch(input, testContext({ fetchImpl: stubFetch({ status: 422, body: '{"message":"No commit found"}' }).fetchImpl }));
    expect(result.data).toBeUndefined();
    expect(result.status).not.toBe('fresh');
  });
});
