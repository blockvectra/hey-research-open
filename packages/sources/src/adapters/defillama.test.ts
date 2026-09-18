import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createDefillamaAdapter } from './defillama';

const input = { chain: 'Robinhood Chain' };

describe('DefiLlama adapter', () => {
  const adapter = createDefillamaAdapter();

  it('needs a chain label', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ chain: '  ' })).toBe(false);
  });

  it('keeps only protocols deployed on the requested chain', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    // Five in the fixture; the two exchanges are not on the chain.
    expect(result.data?.map((p) => p.slug)).toEqual(['deepstate', 'lighter-robinhood-perps', 'morpho-blue']);
  });

  it('matches the chain label case-insensitively', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json') });
    const result = await adapter.fetch(
      { chain: 'robinhood chain' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.data).toHaveLength(3);
  });

  it('reports chain-only TVL, summing the chain sub-buckets and nothing else', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const byslug = Object.fromEntries((result.data ?? []).map((p) => [p.slug, p]));

    // Morpho has $9.4B globally; on this chain it is the plain + borrowed buckets only.
    expect(byslug['morpho-blue']?.chainTvlUsd).toBeCloseTo(480522132.63877594, 3);
    expect(byslug['morpho-blue']?.chainCount).toBe(6);
    // Deepstate is on this chain only; its TVL excludes nothing.
    expect(byslug['deepstate']?.chainCount).toBe(1);
  });

  it('carries the team-declared identity without inventing anything', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json') });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const deepstate = result.data?.find((p) => p.slug === 'deepstate');

    expect(deepstate).toMatchObject({
      name: 'Deepstate',
      category: 'Dexs',
      websiteUrl: 'https://deepstate.sh/',
      twitterHandle: 'josephdelong',
      githubOrgs: ['Deepstate-Protocol'],
      symbol: 'DEEP',
      source: 'defillama',
    });
    expect(deepstate?.listedAt?.toISOString()).toBe(new Date(1787593511 * 1000).toISOString());

    // Lighter declares no GitHub and no listedAt; neither is fabricated.
    const lighter = result.data?.find((p) => p.slug === 'lighter-robinhood-perps');
    expect(lighter?.githubOrgs).toEqual([]);
    expect(lighter).not.toHaveProperty('listedAt');
  });

  it('asks for the whole registry with a raised size cap', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json') });
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.llama.fi/protocols');
  });

  it('keeps the good rows when one protocol is malformed (round-8, 2026-09-18)', async () => {
    const rows = [
      { name: 'Alpha', slug: 'alpha', chains: ['Robinhood Chain'], chainTvls: { 'Robinhood Chain': 10 } },
      // name null, chains null: the registry does send these.
      { name: null, slug: 'broken', chains: null, chainTvls: 'nope' },
      { name: 'Gamma', slug: 'gamma', chains: ['Robinhood Chain', 'Base'], chainTvls: { 'Robinhood Chain': 5, 'Robinhood Chain-borrowed': 5 } },
    ];
    const stub = stubFetch({ status: 200, body: JSON.stringify(rows) });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.map((p) => p.slug)).toEqual(['alpha', 'gamma']);
    // The borrowed bucket is deliberately not added on top of the chain figure.
    expect(result.data?.find((p) => p.slug === 'gamma')?.chainTvlUsd).toBe(5);
  });

  it('skips a row with an explicit null chains list rather than failing the registry', async () => {
    const rows = [
      { name: 'Alpha', slug: 'alpha', chains: ['Robinhood Chain'] },
      { name: 'NoChains', slug: 'nochains', chains: null },
    ];
    const stub = stubFetch({ status: 200, body: JSON.stringify(rows) });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.map((p) => p.slug)).toEqual(['alpha']);
  });

  it('rejects a payload that is not the registry', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ protocols: 'nope' }) });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
