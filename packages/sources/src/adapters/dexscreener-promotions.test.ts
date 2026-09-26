import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { channelOf, createDexscreenerOrdersAdapter, createDexscreenerPromotionFeedAdapter } from './dexscreener-promotions';

/*
 * Fixtures: the live takeover and ad feeds and one live order read of
 * 2026-09-27, trimmed to four Robinhood and two other-chain records.
 */
const JSON_HEADERS = { 'content-type': 'application/json' };
const feedInput = { chainId: 4663, chainSlug: 'robinhood' };

describe('DEX Screener promotion feeds', () => {
  const adapter = createDexscreenerPromotionFeedAdapter();

  it('reads the takeover and ad feeds at their documented paths', async () => {
    const urls: string[] = [];
    for (const feed of ['takeovers', 'ads'] as const) {
      const stub = stubFetch({ status: 200, body: '[]', headers: JSON_HEADERS });
      await adapter.fetch({ ...feedInput, feed }, testContext({ fetchImpl: stub.fetchImpl }));
      urls.push(stub.requests[0]?.url ?? '');
    }
    expect(urls).toEqual(['https://api.dexscreener.com/community-takeovers/latest/v1', 'https://api.dexscreener.com/ads/latest/v1']);
    expect(adapter.canHandle({ ...feedInput, feed: 'boosts' as never })).toBe(false);
  });

  it('dates a takeover by its claim date, keeps only this chain, lower-cases the address', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-community-takeovers.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch({ ...feedInput, feed: 'takeovers' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    expect(result.data?.length).toBeGreaterThan(0);
    for (const sighting of result.data ?? []) {
      expect(sighting).toMatchObject({ chainId: 4663, kind: 'COMMUNITY_TAKEOVER_PROFILE_OBSERVED', channel: 'takeover_claim' });
      expect(sighting.contractAddress).toMatch(/^0x[0-9a-f]{40}$/);
      expect(sighting.providerAt).toBeInstanceOf(Date);
    }
  });

  it('dates an ad by its own date and never keeps its impressions', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-ads.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch({ ...feedInput, feed: 'ads' }, testContext({ fetchImpl: stub.fetchImpl }));
    const first = result.data?.[0];
    expect(first).toMatchObject({ kind: 'MARKET_PROMOTION_OBSERVED', channel: 'token_ad', contractAddress: '0x3458e003f6ed93df0f537b8acac6fbe08e41247f' });
    expect(first?.providerAt.toISOString()).toBe('2026-09-26T13:48:10.601Z');
    expect(JSON.stringify(result.data)).not.toMatch(/impressions|50000/);
  });

  it('keeps no undated record and no record whose type is not a plain word', async () => {
    const rows = [
      { chainId: 'robinhood', tokenAddress: '0x' + '1'.repeat(40), type: 'tokenAd' },
      { chainId: 'robinhood', tokenAddress: '0x' + '2'.repeat(40), type: '<script>', date: '2026-09-26T00:00:00Z' },
      { chainId: 'robinhood', tokenAddress: 'not-an-address', type: 'tokenAd', date: '2026-09-26T00:00:00Z' },
    ];
    const stub = stubFetch({ status: 200, body: JSON.stringify(rows), headers: JSON_HEADERS });
    const result = await adapter.fetch({ ...feedInput, feed: 'ads' }, testContext({ fetchImpl: stub.fetchImpl }));
    // The odd type falls back to the plain `ad` channel; the undated and the bad address are dropped.
    expect(result.data).toEqual([{ chainId: 4663, contractAddress: '0x' + '2'.repeat(40), kind: 'MARKET_PROMOTION_OBSERVED', channel: 'ad', providerAt: new Date('2026-09-26T00:00:00Z') }]);
    expect(channelOf('communityTakeover', 'order')).toBe('community_takeover_order');
    expect(channelOf('token profile')).toBe('token_profile');
  });
});

describe('DEX Screener order history for one token', () => {
  const adapter = createDexscreenerOrdersAdapter();
  const token = '0x75097fe218df489c9624a3ace74fda9141388249';

  it('records an approved profile order and a boost, dated by payment, amounts dropped', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('dexscreener-orders.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch({ ...feedInput, tokenAddress: token }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe(`https://api.dexscreener.com/orders/v1/robinhood/${token}`);
    expect(result.data?.sightings).toEqual([
      { chainId: 4663, contractAddress: token, kind: 'MARKET_PROMOTION_OBSERVED', channel: 'token_profile_order', providerAt: new Date(1790443773635) },
      { chainId: 4663, contractAddress: token, kind: 'MARKET_PROMOTION_OBSERVED', channel: 'boost_order', providerAt: new Date(1790444449673) },
    ]);
    expect(JSON.stringify(result.data)).not.toMatch(/amount/);
  });

  it('files a takeover order as takeover context, counts but never records an unapproved order, and ignores another token', async () => {
    const body = JSON.stringify({
      orders: [
        { chainId: 'robinhood', tokenAddress: token, type: 'communityTakeover', status: 'approved', paymentTimestamp: 1790000000000 },
        { chainId: 'robinhood', tokenAddress: token, type: 'tokenAd', status: 'cancelled', paymentTimestamp: 1790000000001 },
        { chainId: 'robinhood', tokenAddress: '0x' + '9'.repeat(40), type: 'tokenProfile', status: 'approved', paymentTimestamp: 1790000000002 },
        { chainId: 'solana', tokenAddress: token, type: 'tokenProfile', status: 'approved', paymentTimestamp: 1790000000003 },
      ],
      boosts: [{ chainId: 'robinhood', tokenAddress: token, amount: 500 }],
    });
    const stub = stubFetch({ status: 200, body, headers: JSON_HEADERS });
    const result = await adapter.fetch({ ...feedInput, tokenAddress: token }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toEqual({
      sightings: [{ chainId: 4663, contractAddress: token, kind: 'COMMUNITY_TAKEOVER_PROFILE_OBSERVED', channel: 'community_takeover_order', providerAt: new Date(1790000000000) }],
      notApproved: 1,
    });
  });

  it('answers an unknown token with nothing, and refuses a non-JSON body', async () => {
    const empty = stubFetch({ status: 200, body: '{"orders":[],"boosts":[]}', headers: JSON_HEADERS });
    expect((await adapter.fetch({ ...feedInput, tokenAddress: token }, testContext({ fetchImpl: empty.fetchImpl }))).data).toEqual({ sightings: [], notApproved: 0 });
    const html = stubFetch({ status: 200, body: '<html/>', headers: { 'content-type': 'text/html' } });
    expect((await adapter.fetch({ ...feedInput, tokenAddress: token }, testContext({ fetchImpl: html.fetchImpl }))).errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');
    expect(adapter.canHandle({ ...feedInput, tokenAddress: 'nope' })).toBe(false);
  });
});
