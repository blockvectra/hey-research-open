import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createDexscreenerAdapter } from './dexscreener';

/**
 * The single-token endpoint is cross-chain and capped at thirty pairs
 * (2026-09-18): an address that also exists on another chain answers with
 * those pools too, and the deepest of them used to be taken as this token's
 * price and venue. Off-chain pairs are dropped before anything is summed.
 */
const TOKEN = '0x4200000000000000000000000000000000000006';
const pair = (chainId: string, liquidity: number, price: string, dexId = 'uniswap') => ({
  chainId,
  dexId,
  pairAddress: `0x${chainId.padEnd(40, '0').slice(0, 40)}`,
  url: `https://dexscreener.com/${chainId}/x`,
  baseToken: { address: TOKEN, name: 'Wrapped', symbol: 'W' },
  priceUsd: price,
  liquidity: { usd: liquidity },
  volume: { h24: 10 },
  txns: { h24: { buys: 1, sells: 1 } },
});

describe('dexscreener single-token adapter: the chain filter', () => {
  it('keeps only pairs on the configured chain, however deep the others are', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ pairs: [pair('base', 9_000_000, '2500'), pair('robinhood', 40_000, '2400'), pair('ink', 5_000_000, '2600')] }) });
    const result = await createDexscreenerAdapter().fetch({ chainId: 4663, tokenAddress: TOKEN, chainSlug: 'robinhood' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) throw new Error('unreachable');
    expect(result.data).toMatchObject({ priceUsd: 2400, liquidityUsd: 40_000, volume24hUsd: 10, buys24h: 1 });
  });

  it('answers nothing when every pair is on another chain', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ pairs: [pair('base', 9_000_000, '2500')] }) });
    const result = await createDexscreenerAdapter().fetch({ chainId: 4663, tokenAddress: TOKEN, chainSlug: 'robinhood' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
  });
});
