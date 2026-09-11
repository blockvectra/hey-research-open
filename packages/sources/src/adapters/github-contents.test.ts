import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createGithubFileAdapter, createGithubOwnerReposAdapter, GITHUB_FILE_MAX_BYTES } from './github-contents';

describe('GitHub repository files', () => {
  const adapter = createGithubFileAdapter();

  it('reads the README raw through the readme endpoint', async () => {
    const stub = stubFetch({
      status: 200,
      body: readFixture('github-readme.md'),
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
    const result = await adapter.fetch(
      { owner: 'eurotropica01-spec', repo: 'squeeze', token: 't' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(hasData(result)).toBe(true);
    expect(result.data?.path).toBe('README');
    expect(result.data?.text).toContain('rpc.mainnet.chain.robinhood.com');
    expect(stub.requests[0]?.url).toBe('https://api.github.com/repos/eurotropica01-spec/squeeze/readme');
    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers.accept).toBe('application/vnd.github.raw+json');
    expect(headers.authorization).toBe('Bearer t');
  });

  it('reads one path through the contents endpoint, encoding each segment', async () => {
    const stub = stubFetch({ status: 200, body: '[profile.default]\neth_rpc_url = "https://rpc.mainnet.chain.robinhood.com"\n' });
    const result = await adapter.fetch(
      { owner: 'o', repo: 'r', path: 'packages/contracts/foundry.toml' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.data?.path).toBe('packages/contracts/foundry.toml');
    expect(stub.requests[0]?.url).toBe('https://api.github.com/repos/o/r/contents/packages/contracts/foundry.toml');
  });

  it('refuses path traversal and absolute paths', () => {
    expect(adapter.canHandle({ owner: 'o', repo: 'r', path: '../secrets' })).toBe(false);
    expect(adapter.canHandle({ owner: 'o', repo: 'r', path: '/etc/passwd' })).toBe(false);
    expect(adapter.canHandle({ owner: 'o', repo: 'r', path: 'hardhat.config.ts' })).toBe(true);
  });

  it('reports a missing file as missing, not as an error', async () => {
    const stub = stubFetch({ status: 404, body: '{"message":"Not Found"}' });
    const result = await adapter.fetch({ owner: 'o', repo: 'r', path: 'foundry.toml' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('missing');
  });

  it('caps the file size so a giant README cannot fill memory', async () => {
    const stub = stubFetch({ status: 200, body: 'x'.repeat(GITHUB_FILE_MAX_BYTES + 1) });
    const result = await adapter.fetch({ owner: 'o', repo: 'r' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('TOO_LARGE');
  });
});

describe('GitHub owner repositories', () => {
  const adapter = createGithubOwnerReposAdapter();

  it('lists an account’s own repositories, newest push first, without forks', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('github-owner-repos.json') });
    const result = await adapter.fetch({ owner: 'nirholas', token: 't' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.map((repo) => repo.fullName)).toEqual(['nirholas/loxley', 'nirholas/dotfiles']);
    expect(result.data?.[0]).toMatchObject({
      owner: 'nirholas',
      name: 'loxley',
      homepage: 'https://loxley.dev',
      topics: ['x402', 'robinhood-chain', 'usdg'],
      isArchived: false,
      isTemplate: false,
    });
    expect(result.data?.[0]?.latestPushAt?.toISOString()).toBe('2026-09-03T18:12:00.000Z');
    expect(stub.requests[0]?.url).toBe(
      'https://api.github.com/users/nirholas/repos?type=owner&sort=pushed&direction=desc&per_page=100&page=1',
    );
  });

  it('answers an unknown account as missing', async () => {
    const stub = stubFetch({ status: 404, body: '{"message":"Not Found"}' });
    const result = await adapter.fetch({ owner: 'pair-fund' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('missing');
  });
});
