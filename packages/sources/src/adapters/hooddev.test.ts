import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createHooddevAdapter, HOODDEV_DEFAULT_SUBGRAPH_URL, parseHooddevSocials } from './hooddev';

const input = { chainId: 4663 };
const fixture = () => ({ status: 200, body: readFixture('hooddev-launches.json') });

describe('hood.dev subgraph adapter', () => {
  const adapter = createHooddevAdapter();

  it('needs a chain and a sane page', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ chainId: 0 })).toBe(false);
    expect(adapter.canHandle({ chainId: 4663, skip: -1 })).toBe(false);
  });

  it('posts the launches query to the public subgraph with paging variables', async () => {
    const stub = stubFetch(fixture());
    await adapter.fetch(
      { chainId: 4663, first: 100, skip: 200 },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    const request = stub.requests[0];
    expect(request?.url).toBe(HOODDEV_DEFAULT_SUBGRAPH_URL);
    expect(request?.init?.method).toBe('POST');
    const body = JSON.parse(String(request?.init?.body)) as { query: string; variables: unknown };
    expect(body.variables).toEqual({ first: 100, skip: 200 });
    expect(body.query).toContain('tokenLaunches(first: $first, skip: $skip');
    expect(body.query).toContain('launcherStats_collection');
  });

  it('turns every launch into a chain-4663 listing keyed by the token address', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data?.totalLaunches).toBe(45);
    expect(result.data?.launches.map((l) => l.symbol)).toEqual([
      'GAPE',
      'VOID',
      'KROOKLY',
      '42',
      'PBHCBP',
      'NOMO',
    ]);
    expect(result.data?.launches.every((l) => l.chainId === 4663)).toBe(true);
    expect(result.data?.launches.every((l) => /^0x[a-f0-9]{40}$/.test(l.contractAddress))).toBe(
      true,
    );
  });

  it('carries the creator-declared identity and links without inventing any', async () => {
    const stub = stubFetch(fixture());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const bySymbol = Object.fromEntries((result.data?.launches ?? []).map((l) => [l.symbol, l]));

    // A JSON `socials` string with a website and an @handle.
    expect(bySymbol['KROOKLY']).toMatchObject({
      contractAddress: '0x93d069a4821bf352a119ea2acf7f1420df25c0de',
      name: 'Krookly Wallet',
      description: 'Krookly is the first Social-Fi Wallet Built for Robinhood Chain',
      websiteUrl: 'https://www.krookly.com/',
      socials: [{ type: 'twitter', url: 'https://x.com/KrooklyWallet' }],
      imageUrl: 'https://arweave.net/KVJJE2WxABm2Gy93Z6EaG6JwCb8wrefrm5-MbUow-E4',
      pairAddress: '0x4d87c658e28f6dbdfc831c6c7943eb39bf8e779f',
      creatorAddress: '0x7712added79d2a780a312aa9cb5a0dffcfbb1454',
      hasBonded: false,
      venue: 1,
    });
    expect(bySymbol['KROOKLY']?.launchTimestamp?.toISOString()).toBe(
      new Date(1787354744 * 1000).toISOString(),
    );

    // An `ipfs://` image is kept verbatim, as PonsPad's are.
    expect(bySymbol['VOID']).toMatchObject({
      websiteUrl: 'https://voidcoin.fun/',
      imageUrl: 'ipfs://QmSTzmwHa3NiHhEb6EsztuvYkScVnmuts9HkFobpVbbuJu',
      socials: [],
    });

    // An `x` value that is a full URL stays a URL.
    expect(bySymbol['42']?.socials).toEqual([
      { type: 'twitter', url: 'https://x.com/MaxTheTrenchor/status/2089895757143003142?s=20' },
    ]);
    expect(bySymbol['42']).not.toHaveProperty('websiteUrl');

    // Empty strings are absent, not empty.
    expect(bySymbol['PBHCBP']).not.toHaveProperty('imageUrl');
    expect(bySymbol['PBHCBP']).not.toHaveProperty('description');
    expect(bySymbol['PBHCBP']).not.toHaveProperty('websiteUrl');
    expect(bySymbol['PBHCBP']?.socials).toEqual([]);

    expect(bySymbol['NOMO']?.hasBonded).toBe(true);
  });

  it('treats a GraphQL error body as a failed fetch, not an empty launchpad', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify({ errors: [{ message: 'indexing_error' }] }),
    });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
  });

  it('rejects a payload that is not the subgraph shape', async () => {
    const stub = stubFetch({
      status: 200,
      body: JSON.stringify({ data: { tokenLaunches: 'nope' } }),
    });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('degrades without throwing when the subgraph is down', async () => {
    const stub = stubFetch({ status: 503 });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
  });
});

describe('parseHooddevSocials', () => {
  it('reads the JSON object the launcher stores', () => {
    expect(
      parseHooddevSocials(
        '{"x":"@crappybirdmeme","website":"https://crappybird.meme/","telegram":"https://t.me/crappy"}',
      ),
    ).toEqual({
      websiteUrl: 'https://crappybird.meme/',
      socials: [
        { type: 'twitter', url: 'https://x.com/crappybirdmeme' },
        { type: 'telegram', url: 'https://t.me/crappy' },
      ],
    });
  });

  it('accepts a bare handle for x', () => {
    expect(parseHooddevSocials('{"x":"SavageApes"}').socials).toEqual([
      { type: 'twitter', url: 'https://x.com/SavageApes' },
    ]);
  });

  it('files a social network given as the website under socials, not website', () => {
    expect(parseHooddevSocials('{"website":"https://x.com/someone"}')).toEqual({
      socials: [{ type: 'twitter', url: 'https://x.com/someone' }],
    });
  });

  it('extracts URLs from a plain string and ignores anything else', () => {
    expect(parseHooddevSocials('see https://example.org and https://t.me/chat')).toEqual({
      websiteUrl: 'https://example.org/',
      socials: [{ type: 'telegram', url: 'https://t.me/chat' }],
    });
    expect(parseHooddevSocials('no links here')).toEqual({ socials: [] });
    expect(parseHooddevSocials('')).toEqual({ socials: [] });
    expect(parseHooddevSocials('{"website":"javascript:alert(1)"}')).toEqual({ socials: [] });
  });
});
