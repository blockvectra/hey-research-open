import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createDefillamaAdapter, declaredChainTokens } from './defillama';

const input = { chain: 'Robinhood Chain' };
const JSON_HEADERS = { 'content-type': 'application/json' };

describe('DefiLlama adapter', () => {
  const adapter = createDefillamaAdapter();

  it('needs a chain label', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ chain: '  ' })).toBe(false);
  });

  it('keeps only protocols deployed on the requested chain', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    // Five in the fixture; the two exchanges are not on the chain.
    expect(result.data?.map((p) => p.slug)).toEqual(['deepstate', 'lighter-robinhood-perps', 'morpho-blue']);
  });

  it('matches the chain label case-insensitively', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch(
      { chain: 'robinhood chain' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.data).toHaveLength(3);
  });

  it('reports chain-only TVL, summing the chain sub-buckets and nothing else', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const byslug = Object.fromEntries((result.data ?? []).map((p) => [p.slug, p]));

    // Morpho has $9.4B globally; on this chain it is the plain + borrowed buckets only.
    expect(byslug['morpho-blue']?.chainTvlUsd).toBeCloseTo(480522132.63877594, 3);
    expect(byslug['morpho-blue']?.chainCount).toBe(6);
    // Deepstate is on this chain only; its TVL excludes nothing.
    expect(byslug['deepstate']?.chainCount).toBe(1);
  });

  it('carries the team-declared identity without inventing anything', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json'), headers: JSON_HEADERS });
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
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json'), headers: JSON_HEADERS });
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
    const stub = stubFetch({ status: 200, body: JSON.stringify(rows), headers: JSON_HEADERS });
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
    const stub = stubFetch({ status: 200, body: JSON.stringify(rows), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.map((p) => p.slug)).toEqual(['alpha']);
  });

  it('rejects a payload that is not the registry', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ protocols: 'nope' }), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('refuses a body that does not say it is JSON', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols.json'), headers: { 'content-type': 'text/html' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');
  });
});

/*
 * The widened registry (2026-09-27): the fixture is seven untrimmed live
 * records of 27 Sep plus one exchange, so fields the schema drops would show.
 */
describe('DefiLlama registry fields kept since 2026-09-27', () => {
  const adapter = createDefillamaAdapter();
  const read = async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-protocols-robinhood.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    return Object.fromEntries((result.data ?? []).map((listing) => [listing.slug, listing]));
  };

  it('keeps only this chain\'s declared token, lower-cased, and never another chain\'s', async () => {
    const bySlug = await read();
    expect(bySlug['giga-v3']?.chainTokenAddresses).toEqual(['0x5baaec1b70864f01dbdb747358ff59f2e2ccf7d5']);
    expect(bySlug['earn']?.chainTokenAddresses).toEqual(['0xa3b6aee90017b72c0812dc1e013de70eb2917ba3']);
    // A bare 0x… is Ethereum; `bsc:` is BNB Chain. Neither is this chain's contract.
    expect(bySlug['morpho-blue']?.chainTokenAddresses).toEqual([]);
    expect(bySlug['pancakeswap-amm']?.chainTokenAddresses).toEqual([]);
    expect(declaredChainTokens('robinhood:0xAbC0000000000000000000000000000000000001,base:0x1', 'robinhood')).toEqual(['0xabc0000000000000000000000000000000000001']);
    expect(declaredChainTokens('robinhood:not-an-address', 'robinhood')).toEqual([]);
  });

  it('keeps audit links, methodology, parent, forks, dimensions and the dead-site flag as the registry sent them', async () => {
    const bySlug = await read();
    expect(bySlug['lagoon']).toMatchObject({ auditLinks: ['https://docs.lagoon.finance/resources/audits'], auditCode: '2', githubOrgs: ['hopperlabsxyz'], dimensions: ['fees'], defillamaId: '5547' });
    expect(bySlug['lagoon']?.methodologyUrl).toMatch(/^https:\/\/github\.com\/DefiLlama\//);
    expect(bySlug['pancakeswap-amm']).toMatchObject({ parentProtocolSlug: 'pancakeswap', forkedFromIds: ['2197'], dimensions: ['dexs', 'fees'] });
    expect(bySlug['giga-v2']?.methodology).toMatch(/^Value of the tokens locked/);
    expect(bySlug['popi']?.deadUrl).toBe(true);
    expect(bySlug['giga-v3']?.deadUrl).toBe(false);
    // The exchange is not on the chain.
    expect(bySlug['binance-cex']).toBeUndefined();
  });

  it('drops one malformed extra, never the protocol', async () => {
    const rows = [{ name: 'Alpha', slug: 'alpha', chains: ['Robinhood Chain'], chainTvls: { 'Robinhood Chain': 7 }, audit_links: 'not-a-list', address: 'robinhood:0x' + 'a'.repeat(40) }];
    const stub = stubFetch({ status: 200, body: JSON.stringify(rows), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.[0]).toMatchObject({ slug: 'alpha', chainTvlUsd: 7, auditLinks: [], chainTokenAddresses: ['0x' + 'a'.repeat(40)] });
  });

  it('never keeps a non-http audit or methodology link', async () => {
    const rows = [{ name: 'Beta', slug: 'beta', chains: ['Robinhood Chain'], audit_links: ['javascript:alert(1)', 'https://audits.example/beta.pdf'], tvlCodePath: 'file:///etc/passwd' }];
    const stub = stubFetch({ status: 200, body: JSON.stringify(rows), headers: JSON_HEADERS });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.[0]?.auditLinks).toEqual(['https://audits.example/beta.pdf']);
    expect(result.data?.[0]).not.toHaveProperty('methodologyUrl');
  });
});
