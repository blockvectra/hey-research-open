import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createDexscreenerTokensAdapter } from './dexscreener-tokens';

/**
 * The batch endpoint is the path that prices the catalogue, and its schema
 * dropped the venue, the trade counts and the price changes the provider
 * sends in the same payload (2026-09-18): 43,410 of 43,410 snapshots in a
 * week had them null. The saved fixture carries all three.
 */
describe('dexscreener batch adapter: the fields the card prints', () => {
  it('keeps the venue, the buy/sell counts and the price changes from the fixture', async () => {
    const body = readFileSync(new URL('../fixtures/dexscreener-tokens.json', import.meta.url), 'utf8');
    const first = (JSON.parse(body) as { baseToken: { address: string }; chainId: string }[])[0]!;
    const stub = stubFetch({ status: 200, body });
    const result = await createDexscreenerTokensAdapter().fetch(
      { chainId: 4663, chainSlug: first.chainId, addresses: [first.baseToken.address] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) throw new Error('unreachable');
    const row = result.data.find((entry) => entry.contractAddress === first.baseToken.address.toLowerCase());
    expect(row).toBeDefined();
    expect(row!.venue).toEqual(expect.any(String));
    expect(row!.buys24h).toEqual(expect.any(Number));
    expect(row!.sells24h).toEqual(expect.any(Number));
    expect(row!.priceChange24hPct).toEqual(expect.any(Number));
  });
});

/**
 * A price move too large for `numeric(12,4)` failed a whole REFRESH_MARKET_BATCH
 * (2026-09-25): one pool's 24 h change of 1e8 % or more overflowed the insert
 * and every token in the batch lost its reading. It is unknown now, not clipped.
 */
describe('dexscreener batch adapter: a price move HEY cannot store', () => {
  it('reads an overflowing or non-numeric move as unknown and keeps the rest of the reading', async () => {
    const body = JSON.parse(readFileSync(new URL('../fixtures/dexscreener-tokens.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
    const first = body[0] as { baseToken: { address: string }; chainId: string };
    body[0] = { ...body[0], priceChange: { h1: 'NaN', h6: -12.5, h24: 123_456_789.5 } };
    const stub = stubFetch({ status: 200, body: JSON.stringify(body) });
    const result = await createDexscreenerTokensAdapter().fetch(
      { chainId: 4663, chainSlug: first.chainId, addresses: [first.baseToken.address] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) throw new Error('unreachable');
    const row = result.data.find((entry) => entry.contractAddress === first.baseToken.address.toLowerCase());
    expect(row).toBeDefined();
    expect(row!.priceChange24hPct).toBeUndefined();
    expect(row!.priceChange1hPct).toBeUndefined();
    expect(row!.priceChange6hPct).toBe(-12.5);
    expect(row!.venue).toEqual(expect.any(String));
  });

  it('keeps whether a pair carries an active boost — presence, never the count — and the pool labels (2026-09-27)', async () => {
    const pair = (address: string, boosts: number | undefined, labels?: string[]) => ({
      chainId: 'robinhood',
      dexId: 'uniswap',
      pairAddress: address,
      baseToken: { address, name: 'T', symbol: 'T' },
      priceUsd: '1',
      liquidity: { usd: 100 },
      ...(boosts === undefined ? {} : { boosts: { active: boosts } }),
      ...(labels ? { labels } : {}),
    });
    const a = '0x' + 'a'.repeat(40);
    const b = '0x' + 'b'.repeat(40);
    const stub = stubFetch({ status: 200, body: JSON.stringify([pair(a, 10, ['v4', '<bad label>']), pair(b, undefined)]) });
    const result = await createDexscreenerTokensAdapter().fetch({ chainId: 4663, chainSlug: 'robinhood', addresses: [a, b] }, testContext({ fetchImpl: stub.fetchImpl }));
    const byAddress = Object.fromEntries((result.data ?? []).map((row) => [row.contractAddress, row]));
    expect(byAddress[a]).toMatchObject({ promotionActive: true, pairLabels: ['v4'] });
    expect(byAddress[b]).not.toHaveProperty('promotionActive');
    expect(JSON.stringify(result.data)).not.toMatch(/"active"|10}/);
  });
});
