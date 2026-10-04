import { createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubAppAdapter, githubAppJwt, githubAppRequest } from './github-app';

/**
 * The HEY GitHub App's REST calls (2026-10-05, docs/GITHUB_APP.md): the
 * installation token and the opt-in badge pull request. Fixtures are GitHub's
 * documented response shapes; the key is generated for the test and the token
 * is a placeholder in GitHub's shape. CI never calls GitHub.
 */
const TOKEN = 'ghs_test_installation_token_not_real_000';
const adapter = createGithubAppAdapter();
const repo = { token: TOKEN, owner: 'use-agent-os', repo: 'agentos' };

describe('the app JWT', () => {
  it('is RS256, issued a minute back, valid nine minutes, issued by the app id — and verifies with the public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const now = new Date('2026-10-05T12:00:00Z');
    const jwt = githubAppJwt('1234567', pem, now);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as { iat: number; exp: number; iss: string };
    expect(claims.iss).toBe('1234567');
    expect(claims.iat).toBe(now.getTime() / 1000 - 60);
    expect(claims.exp - claims.iat).toBe(540);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
});

describe('github app adapter', () => {
  it('mints an installation token with the app JWT and reads what the installation granted', async () => {
    const stub = stubFetch({ status: 201, body: readFixture('github-app-installation-token.json') });
    const result = await adapter.fetch({ kind: 'installation_token', appJwt: 'a.b.c', installationId: 55500011 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]!.url).toBe('https://api.github.com/app/installations/55500011/access_tokens');
    expect(stub.requests[0]!.init?.method).toBe('POST');
    expect((stub.requests[0]!.init?.headers as Record<string, string>).authorization).toBe('Bearer a.b.c');
    expect(result.data).toEqual({
      kind: 'installation_token',
      token: 'ghs_16C7e42F292c6912E7710c838347Ae178B4a',
      expiresAt: new Date('2026-10-05T13:00:00Z'),
      permissions: { metadata: 'read', contents: 'read' },
    });
  });

  it('reads the repository, the default branch head and the README', async () => {
    const meta = await adapter.fetch({ kind: 'repo', ...repo }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('github-app-repo.json') }).fetchImpl }));
    expect(meta.data).toEqual({ kind: 'repo', repoId: 812345678, fullName: 'use-agent-os/agentos', defaultBranch: 'main', archived: false, ownerLogin: 'use-agent-os' });

    const head = stubFetch({ status: 200, body: readFixture('github-app-ref.json') });
    const ref = await adapter.fetch({ kind: 'branch_head', ...repo, branch: 'main' }, testContext({ fetchImpl: head.fetchImpl }));
    expect(head.requests[0]!.url).toBe('https://api.github.com/repos/use-agent-os/agentos/git/ref/heads/main');
    expect(ref.data).toEqual({ kind: 'branch_head', sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd' });

    const readme = await adapter.fetch({ kind: 'readme', ...repo }, testContext({ fetchImpl: stubFetch({ status: 200, body: readFixture('github-app-readme.json') }).fetchImpl }));
    expect(readme.data?.kind === 'readme' && readme.data.text.startsWith('# AgentOS\n')).toBe(true);
    expect(readme.data?.kind === 'readme' && readme.data.path).toBe('README.md');
  });

  it('lists open pull requests with their head branch, so HEY can see its own', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-app-pulls-open.json') });
    const result = await adapter.fetch({ kind: 'open_pulls', ...repo }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]!.url).toBe('https://api.github.com/repos/use-agent-os/agentos/pulls?state=open&per_page=100');
    expect(result.data).toEqual({ kind: 'open_pulls', pulls: [{ number: 17, url: 'https://github.com/use-agent-os/agentos/pull/17', headRef: 'hey-research/badge' }] });
  });

  it('commits to the named branch and opens the pull request against the default', async () => {
    const put = stubFetch({ status: 200, body: readFixture('github-app-put-file.json') });
    const commit = await adapter.fetch(
      { kind: 'put_file', ...repo, path: 'README.md', branch: 'hey-research/badge', message: 'Add the HEY Research badge to the README', contentBase64: 'IyBBZ2VudE9T', sha: '3d21ec53a331a6f037a91c368710b99387d012c1' },
      testContext({ fetchImpl: put.fetchImpl }),
    );
    expect(put.requests[0]!.init?.method).toBe('PUT');
    expect(JSON.parse(String(put.requests[0]!.init?.body))).toMatchObject({ branch: 'hey-research/badge', sha: '3d21ec53a331a6f037a91c368710b99387d012c1' });
    expect(commit.data).toEqual({ kind: 'put_file', commitSha: '7638417db6d59f3c431d3e1f261cc637155684cd' });

    const pull = stubFetch({ status: 201, body: readFixture('github-app-create-pull.json') });
    const opened = await adapter.fetch(
      { kind: 'create_pull', ...repo, title: 'Add the HEY Research badge to the README', head: 'hey-research/badge', base: 'main', body: 'One line.' },
      testContext({ fetchImpl: pull.fetchImpl }),
    );
    expect(JSON.parse(String(pull.requests[0]!.init?.body))).toMatchObject({ head: 'hey-research/badge', base: 'main' });
    expect(opened.data).toEqual({ kind: 'create_pull', number: 18, url: 'https://github.com/use-agent-os/agentos/pull/18' });
  });

  it('never retries a write: a refused branch is one request and a 422', async () => {
    const stub = stubFetch([{ status: 422, body: readFixture('github-app-error-exists.json') }, { status: 201, body: readFixture('github-app-ref.json') }]);
    const result = await adapter.fetch({ kind: 'create_branch', ...repo, branch: 'hey-research/badge', sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests).toHaveLength(1);
    expect(result.status).toBe('error');
    expect(result.httpStatus).toBe(422);
  });

  it('refuses names outside GitHub’s rules before any request: nothing from a payload reaches a URL', async () => {
    const stub = stubFetch({ status: 200, body: '{}' });
    const bad = [
      { kind: 'repo' as const, token: TOKEN, owner: '../admin', repo: 'x' },
      { kind: 'repo' as const, token: TOKEN, owner: 'ok', repo: 'a/b' },
      { kind: 'put_file' as const, ...repo, path: '../../etc/passwd', branch: 'hey-research/badge', message: 'x', contentBase64: 'eA==', sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd' },
      { kind: 'create_pull' as const, ...repo, title: 'x', head: 'main', base: 'main', body: '' },
    ];
    for (const call of bad) {
      expect(adapter.canHandle(call)).toBe(false);
      const result = await adapter.fetch(call, testContext({ fetchImpl: stub.fetchImpl }));
      expect(result.status).toBe('error');
    }
    expect(stub.requests).toHaveLength(0);
  });

  it('exchanges the manifest code without credentials and keeps the id, slug, key and webhook secret — never the OAuth client secret', async () => {
    const stub = stubFetch({ status: 201, body: readFixture('github-app-manifest-conversion.json') });
    const result = await adapter.fetch({ kind: 'manifest_conversion', code: 'abc123def456' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]!.url).toBe('https://api.github.com/app-manifests/abc123def456/conversions');
    expect((stub.requests[0]!.init?.headers as Record<string, string>).authorization).toBeUndefined();
    expect(result.data).toMatchObject({ kind: 'manifest_conversion', id: 1234567, slug: 'hey-research-lab', webhookSecret: 'test-webhook-secret-from-github-0123456789', ownerLogin: 'hey-research-lab' });
    expect(JSON.stringify(result)).not.toContain('test-client-secret');
    expect(adapter.canHandle({ kind: 'manifest_conversion', code: '../x' })).toBe(false);
  });

  it('encodes every path segment', () => {
    expect(githubAppRequest({ kind: 'branch_head', ...repo, branch: 'release/1.0' }).path).toBe('/repos/use-agent-os/agentos/git/ref/heads/release/1.0');
    expect(githubAppRequest({ kind: 'put_file', ...repo, path: 'docs/READ ME.md', branch: 'b', message: 'm', contentBase64: '', sha: 'a'.repeat(40) }).path).toBe('/repos/use-agent-os/agentos/contents/docs/READ%20ME.md');
  });
});
