import { describe, expect, it } from 'vitest';

import type { SourceContext } from '../adapter';
import {
  LaunchpadRegistry,
  type LaunchpadAdapter,
  type LaunchpadListing,
  type LaunchpadQuery,
} from './launchpad';

/**
 * The launchpad contract ships without a concrete provider: per the backlog, a
 * specific launchpad is only added once its data access is public, documented and
 * permitted. This test pins the interface using a stub.
 */
const stubAdapter = (name: string, listings: LaunchpadListing[]): LaunchpadAdapter => ({
  name,
  canHandle: (query: LaunchpadQuery) => query.chainId === 4663,
  fetch: async (_query, ctx: SourceContext) => ({
    data: listings,
    fetchedAt: ctx.now?.() ?? new Date(),
    cacheTtlSeconds: 600,
    status: 'fresh' as const,
  }),
});

describe('LaunchpadRegistry', () => {
  it('starts empty so no unvetted provider is a dependency', () => {
    expect(new LaunchpadRegistry().list()).toEqual([]);
  });

  it('registers and resolves adapters by name', () => {
    const registry = new LaunchpadRegistry();
    const adapter = stubAdapter('example-pad', []);
    registry.register(adapter);

    expect(registry.get('example-pad')).toBe(adapter);
    expect(registry.list()).toHaveLength(1);
  });

  it('lets discovery iterate providers without knowing any by name', async () => {
    const registry = new LaunchpadRegistry();
    registry.register(
      stubAdapter('example-pad', [
        {
          externalId: 'listing-1',
          chainId: 4663,
          contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          symbol: 'AOS',
          provenance: 'example-pad',
        },
      ]),
    );

    const query: LaunchpadQuery = { chainId: 4663 };
    const results = await Promise.all(
      registry
        .list()
        .filter((adapter) => adapter.canHandle(query))
        .map((adapter) => adapter.fetch(query, { timeoutMs: 1000 })),
    );

    expect(results[0]?.data?.[0]?.provenance).toBe('example-pad');
  });
});
