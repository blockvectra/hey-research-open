import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createNpmPackageAdapter, createNpmSearchAdapter, githubRepoFromNpmUrl } from './npm';

describe('npm registry search', () => {
  const adapter = createNpmSearchAdapter();

  it('returns every package with its description, keywords and repository link', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('npm-search.json') });
    const result = await adapter.fetch({ text: 'robinhood-chain', size: 20 }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.map((hit) => hit.name)).toEqual(['robinhood-chain-kit', 'ponscli', 'robinhood-api', 'rh-launcher-mcp']);
    expect(result.data?.[0]).toMatchObject({
      keywords: ['robinhood-chain', 'arbitrum-orbit', '4663', 'tokenized-stocks', 'evm', 'viem'],
      repositoryUrl: 'git+https://github.com/hey-fixture-dev/robinhood-chain-kit.git',
    });
    // A package without a repository is still reported; the caller decides.
    expect(result.data?.[3]?.repositoryUrl).toBeUndefined();
    expect(stub.requests[0]?.url).toBe('https://registry.npmjs.org/-/v1/search?text=robinhood-chain&size=20');
  });

  it('clamps the page size to what the registry accepts', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('npm-search.json') });
    await adapter.fetch({ text: 'pons', size: 9_999 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toContain('&size=250');
  });
});

describe('npm package document', () => {
  const adapter = createNpmPackageAdapter();

  it('reads the README and the declared repository', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('npm-package.json') });
    const result = await adapter.fetch({ name: 'robinhood-chain-kit' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.readme).toContain('rpc.mainnet.chain.robinhood.com');
    expect(result.data?.repositoryUrl).toBe('git+https://github.com/hey-fixture-dev/robinhood-chain-kit.git');
    expect(stub.requests[0]?.url).toBe('https://registry.npmjs.org/robinhood-chain-kit');
  });

  it('addresses a scoped package with its scope encoded', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('npm-package.json') });
    await adapter.fetch({ name: '@madeonsol/plugin-robinhood-chain' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://registry.npmjs.org/%40madeonsol/plugin-robinhood-chain');
    expect(adapter.canHandle({ name: '../etc' })).toBe(false);
  });
});

describe('repository URL forms the registry stores', () => {
  it('normalises each to https://github.com/owner/repo', () => {
    expect(githubRepoFromNpmUrl('git+https://github.com/hey-fixture-dev/robinhood-chain-kit.git')).toBe(
      'https://github.com/hey-fixture-dev/robinhood-chain-kit',
    );
    expect(githubRepoFromNpmUrl('git://github.com/o/r')).toBe('https://github.com/o/r');
    expect(githubRepoFromNpmUrl('github:o/r')).toBe('https://github.com/o/r');
    expect(githubRepoFromNpmUrl('https://github.com/nirholas/robinhood-toolkit/tree/main/packages/robinhood-chain#readme')).toBe(
      'https://github.com/nirholas/robinhood-toolkit',
    );
    expect(githubRepoFromNpmUrl('https://gitlab.com/o/r')).toBeUndefined();
    expect(githubRepoFromNpmUrl(undefined)).toBeUndefined();
  });
});
