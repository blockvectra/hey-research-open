import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  createDexscreenerProfilesAdapter,
  DEXSCREENER_PROFILE_FEEDS,
} from './dexscreener-profiles';

const input = { chainId: 4663, chainSlug: 'robinhood', feed: 'profiles' as const };
const profiles = () => ({ status: 200, body: readFixture('dexscreener-token-profiles.json') });
const boosts = () => ({ status: 200, body: readFixture('dexscreener-token-boosts.json') });

describe('DEX Screener token profiles adapter', () => {
  const adapter = createDexscreenerProfilesAdapter();

  it('handles the three documented feeds and nothing else', () => {
    for (const feed of DEXSCREENER_PROFILE_FEEDS) {
      expect(adapter.canHandle({ ...input, feed })).toBe(true);
    }
    expect(adapter.canHandle({ ...input, feed: 'ads' as never })).toBe(false);
    expect(adapter.canHandle({ ...input, chainSlug: ' ' })).toBe(false);
  });

  it('requests the feed path for each list', async () => {
    const paths: string[] = [];
    for (const feed of DEXSCREENER_PROFILE_FEEDS) {
      const stub = stubFetch(profiles());
      await adapter.fetch({ ...input, feed }, testContext({ fetchImpl: stub.fetchImpl }));
      paths.push(stub.requests[0]?.url ?? '');
    }
    expect(paths).toEqual([
      'https://api.dexscreener.com/token-profiles/latest/v1',
      'https://api.dexscreener.com/token-boosts/latest/v1',
      'https://api.dexscreener.com/token-boosts/top/v1',
    ]);
  });

  it('keeps only the configured chain from the cross-chain feed', async () => {
    const stub = stubFetch(profiles());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    // Five records in the fixture, two of them Solana.
    expect(result.data).toHaveLength(3);
    expect(result.data?.every((p) => p.chainId === 4663 && p.feed === 'profiles')).toBe(true);
    expect(result.data?.map((p) => p.contractAddress)).toContain(
      '0x6b1497cd68878f0b14ecbbd3db81b46103d66e3d',
    );
  });

  it('maps labelled links to website and docs, typed links to socials', async () => {
    const stub = stubFetch(profiles());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const liquidex = result.data?.find((p) => p.websiteUrl === 'https://liquidex.sh/');

    expect(liquidex).toMatchObject({
      contractAddress: '0x348e63224f4f2b75f0de7a38529840fbbab9d699',
      docsUrl: 'https://docs.liquidex.sh/',
      socials: [
        { type: 'twitter', url: 'https://x.com/LiquidexRH' },
        { type: 'telegram', url: 'https://t.me/LiquidexRH' },
      ],
      profileUrl: 'https://dexscreener.com/robinhood/0x348e63224f4f2b75f0de7a38529840fbbab9d699',
      communityTakeover: false,
    });
    expect(liquidex?.imageUrl).toMatch(/^https:\/\/cdn\.dexscreener\.com\/cms\/images\//);
    expect(liquidex?.description).toBe('The Index Liquidity Layers for Real-World Assets');

    // A profile without a description gets none invented.
    const dripswap = result.data?.find(
      (p) => p.contractAddress === '0x6b1497cd68878f0b14ecbbd3db81b46103d66e3d',
    );
    expect(dripswap).toMatchObject({
      websiteUrl: 'https://dripswap.tech/',
      socials: [{ type: 'twitter', url: 'https://x.com/Dripswapapp' }],
    });
    expect(dripswap).not.toHaveProperty('description');
    expect(dripswap).not.toHaveProperty('docsUrl');
  });

  it('reads the boost lists for identity only and drops the boost amounts', async () => {
    const stub = stubFetch(boosts());
    const result = await adapter.fetch(
      { ...input, feed: 'boosts-top' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.data).toHaveLength(2);
    const chump = result.data?.find(
      (p) => p.contractAddress === '0x0e0d2c89a5a019fe1cf762e5e33187631dacc21b',
    );
    expect(chump?.description).toMatch(/^CHUMP COIN 2 1 BILLY/);
    // Untyped links: the first ordinary site is the website; social hosts are
    // recognised by host even without a type; the rest are kept as sites.
    expect(chump?.websiteUrl).toBe('https://cc21b.meme/');
    expect(chump?.socials).toEqual([
      { type: 'twitter', url: 'https://x.com/i/communities/2020660935854014618/' },
      { type: 'twitter', url: 'https://x.com/ChumpCoinX' },
      { type: 'telegram', url: 'https://t.me/CHUMPCOIN21B' },
      { type: 'tiktok', url: 'https://www.tiktok.com/@chumpcoin?_r=1' },
    ]);
    // A bare CMS id is not an image URL.
    expect(chump).not.toHaveProperty('imageUrl');
    for (const profile of result.data ?? []) {
      expect(profile).not.toHaveProperty('amount');
      expect(profile).not.toHaveProperty('totalAmount');
    }
  });

  it('rejects a payload that is not a list', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ profiles: [] }) });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('reports a rate limit rather than throwing', async () => {
    const stub = stubFetch({ status: 429, headers: { 'retry-after': '30' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(30);
  });
});
