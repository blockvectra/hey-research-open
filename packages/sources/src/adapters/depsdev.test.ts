import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import {
  createDepsDevPackageAdapter,
  createDepsDevProjectAdapter,
  createDepsDevRepoPackagesAdapter,
  createDepsDevVersionAdapter,
  githubRepoUrlFrom,
} from './depsdev';

/**
 * deps.dev v3 contract tests (2026-09-27). Fixtures are live answers saved on
 * 2026-09-27, trimmed: an npm SDK built with SLSA provenance, a repository
 * named by an npm package (unverified) and a Go module (its origin), a
 * package's versions, one version, and two project records — one with an
 * OpenSSF Scorecard block and one without.
 */
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const ctx = (fixture: string, extra: Record<string, string> = {}) =>
  stubFetch({ status: 200, body: readFixture(fixture), headers: { ...JSON_HEADERS, ...extra } });

describe('deps.dev repository → packages', () => {
  const adapter = createDepsDevRepoPackagesAdapter();

  it('asks the v3 packageversions endpoint with the project key encoded', async () => {
    const stub = ctx('depsdev-packageversions-slsa.json');
    await adapter.fetch({ owner: 'useboardwalk', repo: 'boardwalk-sdk' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.deps.dev/v3/projects/github.com%2Fuseboardwalk%2Fboardwalk-sdk:packageversions');
  });

  it('groups versions by package and keeps the verified SLSA provenance repository', async () => {
    const stub = ctx('depsdev-packageversions-slsa.json');
    const result = await adapter.fetch({ owner: 'useboardwalk', repo: 'boardwalk-sdk' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data?.packages).toEqual([
      {
        system: 'NPM',
        name: '@useboardwalk/sdk',
        relations: [{ type: 'SOURCE_REPO', provenance: 'SLSA_ATTESTATION' }],
        verifiedProvenanceRepos: ['https://github.com/useboardwalk/boardwalk-sdk'],
        versionCount: 3,
      },
    ]);
  });

  it('tells a typed claim from a Go module origin', async () => {
    const stub = ctx('depsdev-packageversions-mixed.json');
    const result = await adapter.fetch({ owner: 'madeonsol', repo: 'robinhood-chain-sdk' }, testContext({ fetchImpl: stub.fetchImpl }));
    const byName = Object.fromEntries((result.data?.packages ?? []).map((pkg) => [pkg.name, pkg]));
    expect(byName['robinhood-chain-sdk']?.relations).toEqual([
      { type: 'SOURCE_REPO', provenance: 'UNVERIFIED_METADATA' },
      { type: 'ISSUE_TRACKER', provenance: 'UNVERIFIED_METADATA' },
    ]);
    expect(byName['robinhood-chain-sdk']?.verifiedProvenanceRepos).toEqual([]);
    expect(byName['github.com/madeonsol/robinhood-chain-sdk']).toMatchObject({ system: 'GO', relations: [{ type: 'SOURCE_REPO', provenance: 'GO_ORIGIN' }] });
  });

  it('reads the plain-text 404 for an unknown repository as "missing", not an error', async () => {
    const stub = stubFetch({ status: 404, body: 'project not found', headers: { 'content-type': 'text/plain' } });
    const result = await adapter.fetch({ owner: 'TokenBrice', repo: 'pharos-watch' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('missing');
  });

  it('refuses a non-JSON body, an oversized body and an answer from another host', async () => {
    const html = stubFetch({ status: 200, body: '<html/>', headers: { 'content-type': 'text/html' } });
    expect((await adapter.fetch({ owner: 'a', repo: 'b' }, testContext({ fetchImpl: html.fetchImpl }))).errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');

    const huge = stubFetch({ status: 200, body: '{}', headers: { ...JSON_HEADERS, 'content-length': String(50 * 1024 * 1024) } });
    expect((await adapter.fetch({ owner: 'a', repo: 'b' }, testContext({ fetchImpl: huge.fetchImpl }))).errorCode).toBe('TOO_LARGE');

    const moved = stubFetch({ status: 200, body: '{"versions":[]}', headers: JSON_HEADERS, url: 'https://evil.example/v3/x' });
    expect((await adapter.fetch({ owner: 'a', repo: 'b' }, testContext({ fetchImpl: moved.fetchImpl }))).errorCode).toBe('BLOCKED_URL');
  });

  it('rejects a schema drift instead of storing it', async () => {
    const stub = stubFetch({ status: 200, body: '{"versions":[{"versionKey":{"system":"NPM"}}]}', headers: JSON_HEADERS });
    const result = await adapter.fetch({ owner: 'a', repo: 'b' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('refuses owner or repository names that could escape the path', () => {
    expect(adapter.canHandle({ owner: 'a/../b', repo: 'c' })).toBe(false);
    expect(adapter.canHandle({ owner: 'a', repo: 'c:packageversions' })).toBe(false);
  });
});

describe('deps.dev package and version', () => {
  it('returns every version with its time, and the registry default as latest', async () => {
    const stub = ctx('depsdev-package.json');
    const result = await createDepsDevPackageAdapter().fetch({ system: 'NPM', name: '@useboardwalk/sdk' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.deps.dev/v3/systems/npm/packages/%40useboardwalk%2Fsdk');
    expect(result.data?.latest).toMatchObject({ version: '2.1.1', isDefault: true });
    expect(result.data?.versions.length).toBeGreaterThan(5);
    expect(result.data?.versions[0]?.publishedAt).toEqual(new Date('2026-06-09T08:33:58Z'));
  });

  it('reads one version\'s homepage, typed repository, verified provenance and related projects', async () => {
    const stub = ctx('depsdev-version.json');
    const result = await createDepsDevVersionAdapter().fetch({ system: 'NPM', name: '@useboardwalk/sdk', version: '2.1.1' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.deps.dev/v3/systems/npm/packages/%40useboardwalk%2Fsdk/versions/2.1.1');
    expect(result.data).toMatchObject({
      version: '2.1.1',
      homepage: 'https://www.useboardwalk.com',
      sourceRepo: 'git+https://github.com/useboardwalk/boardwalk-sdk.git',
      verifiedProvenanceRepos: ['https://github.com/useboardwalk/boardwalk-sdk'],
    });
    expect(result.data?.relatedProjects).toContainEqual({ id: 'github.com/useboardwalk/boardwalk-sdk', provenance: 'SLSA_ATTESTATION', type: 'SOURCE_REPO' });
  });
});

describe('deps.dev project (Scorecard only)', () => {
  it('keeps the published checks with their date, and drops stars, forks and the aggregate score', async () => {
    const stub = ctx('depsdev-project-scorecard.json');
    const result = await createDepsDevProjectAdapter().fetch({ owner: 'MetaMask', repo: 'metamask-extension' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.scorecard?.date).toEqual(new Date('2026-08-24T00:00:00Z'));
    expect(result.data?.scorecard?.checks.map((check) => check.name).sort()).toEqual(['Code-Review', 'Maintained', 'Packaging', 'Signed-Releases']);
    const text = JSON.stringify(result.data);
    expect(text).not.toMatch(/overallScore|starsCount|forksCount|stars|forks/);
    // The fixture does carry them; the parser is what keeps them out.
    expect(readFixture('depsdev-project-scorecard.json')).toContain('overallScore');
  });

  it('has no scorecard when deps.dev holds none — the common case', async () => {
    const stub = ctx('depsdev-project-no-scorecard.json');
    const result = await createDepsDevProjectAdapter().fetch({ owner: 'wevm', repo: 'viem' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data?.scorecard).toBeUndefined();
  });
});

describe('githubRepoUrlFrom', () => {
  it('normalises the forms registries store and refuses other hosts', () => {
    expect(githubRepoUrlFrom('git+https://github.com/UseBoardwalk/boardwalk-sdk.git')).toBe('https://github.com/useboardwalk/boardwalk-sdk');
    expect(githubRepoUrlFrom('https://github.com/a/b/tree/main/packages/c')).toBe('https://github.com/a/b');
    expect(githubRepoUrlFrom('git@github.com:a/b.git')).toBeUndefined();
    expect(githubRepoUrlFrom('ssh://git@github.com/a/b.git')).toBe('https://github.com/a/b');
    expect(githubRepoUrlFrom('https://github.com.evil.example/a/b')).toBeUndefined();
    expect(githubRepoUrlFrom('https://gitlab.com/a/b')).toBeUndefined();
    expect(githubRepoUrlFrom(undefined)).toBeUndefined();
  });
});
