import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubReleasesAdapter, createGithubRepoAdapter } from './github';

const repoInput = { owner: 'agentos', repo: 'core' };

describe('GitHub repo adapter', () => {
  const adapter = createGithubRepoAdapter();

  it('rejects owner/repo values that are not valid path segments', () => {
    expect(adapter.canHandle(repoInput)).toBe(true);
    expect(adapter.canHandle({ owner: '../etc', repo: 'core' })).toBe(false);
    expect(adapter.canHandle({ owner: 'agentos', repo: 'core/../..' })).toBe(false);
  });

  it('normalizes repository activity from a fixture', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-repo.json') });
    const result = await adapter.fetch(repoInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data).toMatchObject({
      fullName: 'agentos/core',
      defaultBranch: 'main',
      isArchived: false,
      isFork: false,
      isTemplate: false,
    });
    expect(result.data?.forkOf).toBeUndefined();
    expect(result.data?.latestPushAt?.toISOString()).toBe('2026-08-30T14:22:10.000Z');
  });

  it('reports a fork with its upstream, and a template, so neither is taken for build evidence', async () => {
    const base = JSON.parse(readFixture('github-repo.json')) as Record<string, unknown>;
    const fork = stubFetch({
      status: 200,
      body: JSON.stringify({ ...base, fork: true, parent: { full_name: 'upstream/core' } }),
    });
    const forked = await adapter.fetch(repoInput, testContext({ fetchImpl: fork.fetchImpl }));
    expect(forked.data).toMatchObject({ isFork: true, forkOf: 'upstream/core', isTemplate: false });

    const template = stubFetch({ status: 200, body: JSON.stringify({ ...base, is_template: true }) });
    const templated = await adapter.fetch(repoInput, testContext({ fetchImpl: template.fetchImpl }));
    expect(templated.data).toMatchObject({ isFork: false, isTemplate: true });
  });

  it('sends the token only when one is configured', async () => {
    const anon = stubFetch({ status: 200, body: readFixture('github-repo.json') });
    await adapter.fetch(repoInput, testContext({ fetchImpl: anon.fetchImpl }));
    expect(
      (anon.requests[0]?.init?.headers as Record<string, string>).authorization,
    ).toBeUndefined();

    const authed = stubFetch({ status: 200, body: readFixture('github-repo.json') });
    await adapter.fetch(
      { ...repoInput, token: 'ghp_test' },
      testContext({ fetchImpl: authed.fetchImpl }),
    );
    expect((authed.requests[0]?.init?.headers as Record<string, string>).authorization).toBe(
      'Bearer ghp_test',
    );
  });

  it('keeps stars as display context only, never as a score input', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-repo.json') });
    const result = await adapter.fetch(repoInput, testContext({ fetchImpl: stub.fetchImpl }));

    // Stars are carried, but nothing in the normalized shape ranks or weights them.
    expect(result.data?.stars).toBe(42);
    expect(result.data).not.toHaveProperty('score');
  });

  it('keeps previous data usable when GitHub is down', async () => {
    const stub = stubFetch({ status: 500 });
    const result = await adapter.fetch(repoInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('UPSTREAM_ERROR');
    expect(result.data).toBeUndefined();
  });
});

describe('GitHub releases adapter', () => {
  const adapter = createGithubReleasesAdapter();

  it('normalizes releases and skips drafts', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-releases.json') });
    const result = await adapter.fetch(repoInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data).toHaveLength(2);
    expect(result.data?.map((release) => release.tag)).toEqual(['v0.4.0', 'v0.4.1-rc1']);
  });

  it('gives every release a stable external id for dedupe', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-releases.json') });
    const result = await adapter.fetch(repoInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.[0]?.externalId).toBe('5001');
    expect(new Set(result.data?.map((r) => r.externalId)).size).toBe(result.data?.length);
  });

  it('falls back to the tag when a release has no name', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-releases.json') });
    const result = await adapter.fetch(repoInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.data?.[1]?.title).toBe('v0.4.1-rc1');
    expect(result.data?.[1]?.isPrerelease).toBe(true);
  });

  it('returns an empty list rather than failing when there are no releases', async () => {
    const stub = stubFetch({ status: 200, body: '[]' });
    const result = await adapter.fetch(repoInput, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    expect(result.data).toEqual([]);
  });
});
