import { describe, expect, it } from 'vitest';

import type { SourceContext, SourceResult } from '../adapter';
import { stubFetch, testContext } from '../testing';
import {
  createGithubDeploymentsAdapter,
  createGithubReleasesAdapter,
  createGithubRepoAdapter,
  githubRepoPath,
  githubUserPath,
  isGithubName,
} from './github';
import { createGithubCommitDetailAdapter } from './github-commit-detail';
import { createGithubCommitsAdapter } from './github-commits';
import {
  createGithubFileAdapter,
  createGithubOwnerProfileAdapter,
  createGithubOwnerReposAdapter,
  createGithubTreeAdapter,
} from './github-contents';
import { createGithubPullsAdapter } from './github-pulls';

/**
 * An owner or repository name goes into a GitHub API path as one segment (2026-10-25): `.` and `..` are not GitHub
 * names and are refused before anything is sent; every name is encoded; a leading dot (`.github`) stays readable.
 */
type Bound = { canHandle: () => boolean; fetch: (ctx: SourceContext) => Promise<SourceResult<unknown>> };

function bind<TInput>(
  adapter: { canHandle(input: TInput): boolean; fetch(input: TInput, ctx: SourceContext): Promise<SourceResult<unknown>> },
  input: TInput,
): Bound {
  return { canHandle: () => adapter.canHandle(input), fetch: (ctx) => adapter.fetch(input, ctx) };
}

const since = new Date('2026-09-01T00:00:00Z');
const sha = 'a'.repeat(40);

const repoAdapters: [string, (owner: string, repo: string) => Bound][] = [
  ['repo', (owner, repo) => bind(createGithubRepoAdapter(), { owner, repo })],
  ['releases', (owner, repo) => bind(createGithubReleasesAdapter(), { owner, repo })],
  ['deployments', (owner, repo) => bind(createGithubDeploymentsAdapter(), { owner, repo })],
  ['commits', (owner, repo) => bind(createGithubCommitsAdapter(), { owner, repo, since })],
  ['pulls', (owner, repo) => bind(createGithubPullsAdapter(), { owner, repo })],
  ['commit detail', (owner, repo) => bind(createGithubCommitDetailAdapter(), { owner, repo, sha })],
  ['readme', (owner, repo) => bind(createGithubFileAdapter(), { owner, repo })],
  ['tree', (owner, repo) => bind(createGithubTreeAdapter(), { owner, repo })],
];

describe('GitHub owner and repository names in API paths', () => {
  it.each(repoAdapters)('%s: refuses "." and ".." as owner or repository and sends nothing', async (_name, make) => {
    for (const [owner, repo] of [['..', 'user'], ['.', 'core'], ['agentos', '..'], ['agentos', '.']] as const) {
      const adapter = make(owner, repo);
      expect(adapter.canHandle()).toBe(false);
      const stub = stubFetch({ status: 200, body: '{}' });
      const result = await adapter.fetch(testContext({ fetchImpl: stub.fetchImpl }));
      expect(result).toMatchObject({ status: 'error', errorCode: 'BLOCKED_URL' });
      expect(stub.callCount()).toBe(0);
    }
  });

  it.each(repoAdapters)('%s: still reads a repository whose name starts with a dot', async (_name, make) => {
    const adapter = make('agentos', '.github');
    expect(adapter.canHandle()).toBe(true);
    const stub = stubFetch({ status: 404 });
    await adapter.fetch(testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toMatch(/^https:\/\/api\.github\.com\/repos\/agentos\/\.github(\/|\?|$)/);
  });

  it('refuses "." and ".." as an owner on the owner reads, and as a step of a file path', async () => {
    for (const adapter of [bind(createGithubOwnerReposAdapter(), { owner: '..' }), bind(createGithubOwnerProfileAdapter(), { owner: '.' })]) {
      expect(adapter.canHandle()).toBe(false);
      const stub = stubFetch({ status: 200, body: '{}' });
      expect(await adapter.fetch(testContext({ fetchImpl: stub.fetchImpl }))).toMatchObject({ status: 'error', errorCode: 'BLOCKED_URL' });
      expect(stub.callCount()).toBe(0);
    }
    for (const path of ['docs/../../user', './README.md', 'docs/.']) {
      const stub = stubFetch({ status: 200, body: 'x' });
      const result = await createGithubFileAdapter().fetch({ owner: 'agentos', repo: 'core', path }, testContext({ fetchImpl: stub.fetchImpl }));
      expect(result).toMatchObject({ status: 'error', errorCode: 'BLOCKED_URL' });
      expect(stub.callCount()).toBe(0);
    }
  });

  it('builds each path from checked, encoded segments', () => {
    expect(githubRepoPath('agentos', 'core.js')).toBe('/repos/agentos/core.js');
    expect(githubRepoPath('agentos', '..')).toBeUndefined();
    expect(githubRepoPath('agentos', 'a/b')).toBeUndefined();
    expect(githubRepoPath('agentos', 'a%2fb')).toBeUndefined();
    expect(githubUserPath('agentos')).toBe('/users/agentos');
    expect(githubUserPath('..')).toBeUndefined();
    expect(isGithubName('.github')).toBe(true);
    expect(isGithubName('...')).toBe(true);
  });
});
