import { describe, expect, it } from 'vitest';

import type { SourceAdapter } from '../adapter';
import { createBlockscoutAdapter } from './blockscout';
import { createDexscreenerAdapter } from './dexscreener';
import { createFeedAdapter } from './feed';
import { createGeckoterminalAdapter } from './geckoterminal';
import { createGithubReleasesAdapter, createGithubRepoAdapter } from './github';
import { createRpcContractAdapter } from './rpc';
import { createSourcifyAdapter } from './sourcify';
import { createWebsiteAdapter } from './website';

/** Every adapter delivered by M2, checked against the shared contract. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous adapter inputs
const ADAPTERS: SourceAdapter<any, unknown>[] = [
  createDexscreenerAdapter(),
  createGeckoterminalAdapter(),
  createBlockscoutAdapter(),
  createRpcContractAdapter(),
  createGithubRepoAdapter(),
  createGithubReleasesAdapter(),
  createWebsiteAdapter(),
  createFeedAdapter(),
  createSourcifyAdapter(),
];

describe('SourceAdapter contract', () => {
  it('covers every source class the milestone requires', () => {
    expect(ADAPTERS.map((adapter) => adapter.name).sort()).toEqual([
      'blockscout',
      'dexscreener',
      'feed',
      'geckoterminal',
      'github-releases',
      'github-repo',
      'rpc-contract',
      'sourcify',
      'website',
    ]);
  });

  it('gives every adapter a unique name and the required methods', () => {
    const names = ADAPTERS.map((adapter) => adapter.name);
    expect(new Set(names).size).toBe(names.length);

    for (const adapter of ADAPTERS) {
      expect(typeof adapter.canHandle).toBe('function');
      expect(typeof adapter.fetch).toBe('function');
    }
  });

  it('rejects input it cannot handle instead of guessing', () => {
    expect(createDexscreenerAdapter().canHandle({ chainId: 4663, tokenAddress: 'nope' })).toBe(
      false,
    );
    expect(createWebsiteAdapter().canHandle({ url: 'javascript:alert(1)' })).toBe(false);
    expect(
      createBlockscoutAdapter().canHandle({ baseUrl: 'https://x.example', address: '0x1' }),
    ).toBe(false);
  });
});
