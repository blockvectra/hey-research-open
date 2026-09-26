import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubDeploymentsAdapter, createGithubReleasesAdapter, createGithubRepoAdapter } from './github';

/**
 * Developer footprint from GitHub (2026-09-27, brief §17). Contract tests over
 * payloads saved from live reads on 2026-09-27: a repository's own topics,
 * licence, language and owner type; a release's assets without their download
 * counts; and the newest deployment to an environment named production.
 */
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const input = { owner: 'KeeperHub', repo: 'keeperhub' };

describe('GitHub repository footprint fields', () => {
  it('reads topics, licence, language and owner type from the /repos answer HEY already fetches', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-repo-footprint.json') });
    const result = await createGithubRepoAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    expect(result.data?.topics).toContain('defi');
    expect(result.data?.topics?.length).toBe(13);
    expect(result.data?.licenseSpdx).toBe('NOASSERTION');
    expect(result.data?.language).toBe('TypeScript');
    expect(result.data?.ownerType).toBe('Organization');
  });

  it('leaves the fields absent, not empty, when GitHub does not send them', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-repo.json') });
    const result = await createGithubRepoAdapter().fetch({ owner: 'agentos', repo: 'core' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(Object.hasOwn(result.data ?? {}, 'licenseSpdx')).toBe(false);
  });
});

describe('GitHub release assets', () => {
  it('keeps each asset\'s name, size and content type, and never its download count', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-release-assets.json') });
    const result = await createGithubReleasesAdapter().fetch({ owner: 'textile-protocol', repo: 'textile-stitch' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    const assets = result.data?.[0]?.assets ?? [];
    expect(assets).toHaveLength(22);
    expect(assets).toContainEqual({ name: 'Stitch.dmg', sizeBytes: 35544978, contentType: 'application/x-apple-diskimage' });
    // The fixture carries download_count on every asset; nothing downstream may see it.
    expect(readFixture('github-release-assets.json')).toContain('download_count');
    expect(JSON.stringify(result.data)).not.toMatch(/download_?count/i);
    expect(assets.every((asset) => Object.keys(asset).every((key) => ['name', 'sizeBytes', 'contentType'].includes(key)))).toBe(true);
  });

  it('gives a release without assets an empty list', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-releases.json') });
    const result = await createGithubReleasesAdapter().fetch({ owner: 'agentos', repo: 'core' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.every((release) => Array.isArray(release.assets))).toBe(true);
  });
});

describe('GitHub production deployments', () => {
  const adapter = createGithubDeploymentsAdapter();

  it('asks for the production environment only, one page of five', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-deployments.json'), headers: JSON_HEADERS });
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.github.com/repos/KeeperHub/keeperhub/deployments?environment=production&per_page=5');
  });

  it('returns the newest production deployment with its environment name, time and commit — and never who deployed', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-deployments.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    expect(result.data?.latestProduction).toEqual({
      environment: 'production',
      createdAt: new Date('2026-09-26T13:03:29Z'),
      sha: 'eac0afb40df5ccad37e333fad43de2c1a338a356',
    });
    expect(JSON.stringify(result.data)).not.toContain('example-user');
  });

  it('reads Vercel\'s capitalised Production, and ignores staging, previews and transient environments', async () => {
    const rows = [
      { id: 1, environment: 'staging', created_at: '2026-09-27T10:00:00Z', sha: 'a' },
      { id: 2, environment: 'Production', created_at: '2026-09-20T10:00:00Z', sha: 'b' },
      { id: 3, environment: 'production', created_at: '2026-09-26T10:00:00Z', sha: 'c', transient_environment: true },
      { id: 4, environment: 'production-preview', created_at: '2026-09-27T11:00:00Z', sha: 'd' },
    ];
    const stub = stubFetch({ status: 200, body: JSON.stringify(rows), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.latestProduction).toMatchObject({ environment: 'Production', sha: 'b' });
  });

  it('says "none" as an empty reading, not as an error', async () => {
    const stub = stubFetch({ status: 200, body: '[]', headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data).toEqual({});
  });

  it('replays the stored ETag and treats a 304 as unchanged', async () => {
    const stub = stubFetch({ status: 304 });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"abc"' }));
    expect(result.status).toBe('not_modified');
    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('W/"abc"');
  });

  it('refuses a body that is not JSON, and an answer from another host', async () => {
    const html = stubFetch({ status: 200, body: '<html></html>', headers: { 'content-type': 'text/html' } });
    expect((await adapter.fetch(input, testContext({ fetchImpl: html.fetchImpl }))).errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');

    const moved = stubFetch({ status: 200, body: '[]', headers: JSON_HEADERS, url: 'https://elsewhere.example/repos/x/y/deployments' });
    const result = await adapter.fetch(input, testContext({ fetchImpl: moved.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('BLOCKED_URL');
  });

  it('refuses owner or repository names that are not path segments', () => {
    expect(adapter.canHandle({ owner: '../x', repo: 'y' })).toBe(false);
    expect(adapter.canHandle({ owner: 'x', repo: 'y?environment=staging' })).toBe(false);
  });
});
