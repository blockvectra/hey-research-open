import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createGeckoterminalAdapter } from './geckoterminal';

/**
 * GeckoTerminal answers that are not market data (overnight audit
 * 2026-09-12). A maintenance page or a reshaped payload must come back as
 * an invalid response, so the market refresh records nothing and the card
 * keeps its last honest reading.
 */
describe('geckoterminal market context: answers that are not data', () => {
  const input = { chainId: 4663, network: 'robinhood-chain', tokenAddress: '0xb33eb16782776b4d738c0fd643577cb0284db610' };

  it('reports a body that is not JSON as an invalid response', async () => {
    const stub = stubFetch({ status: 200, body: '<!doctype html><title>Maintenance</title>' });
    const result = await createGeckoterminalAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result).toMatchObject({ status: 'error', errorCode: 'INVALID_RESPONSE' });
  });

  it('reports JSON of the wrong shape as an invalid response', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: 42 }) });
    const result = await createGeckoterminalAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result).toMatchObject({ status: 'error', errorCode: 'INVALID_RESPONSE' });
  });
});

/**
 * The pools endpoint lists every pool the token appears in, on either side
 * (2026-09-18). A pool where the token is the quote prices the other asset;
 * only base-side pools are this token's market.
 */
describe('geckoterminal market context: which side of the pool', () => {
  const token = '0xb33eb16782776b4d738c0fd643577cb0284db610';
  const input = { chainId: 4663, network: 'robinhood-chain', tokenAddress: token };
  const pool = (base: string, price: string, reserve: number) => ({
    id: `robinhood_${base}_pool`,
    attributes: { address: `0x${base.slice(2, 12).padEnd(40, '1')}`, name: 'x / y', base_token_price_usd: price, reserve_in_usd: reserve, volume_usd: { h24: 5 } },
    relationships: { dex: { data: { id: 'uniswap' } }, base_token: { data: { id: `robinhood_${base}` } } },
  });

  it('ignores a deeper pool where the token is only the quote asset', async () => {
    const other = '0x1111111111111111111111111111111111111111';
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: [pool(other, '3000', 900_000), pool(token, '0.02', 12_000)] }) });
    const result = await createGeckoterminalAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) throw new Error('unreachable');
    expect(result.data).toMatchObject({ priceUsd: 0.02, liquidityUsd: 12_000, volume24hUsd: 5 });
  });

  /** The provider omitted the side entirely; the id is absent, not wrong. */
  const unsided = (price: string, reserve: number) => ({
    id: 'robinhood_unsided_pool',
    attributes: { address: '0x9999999999999999999999999999999999999999', name: 'x / y', base_token_price_usd: price, reserve_in_usd: reserve, volume_usd: { h24: 5 } },
    relationships: { dex: { data: { id: 'uniswap' } } },
  });

  it('prefers the pool that names this token over a deeper one that names nothing (2026-09-24)', async () => {
    /*
     * These used to be filtered together, so a payload with one pool naming
     * this token and one naming nothing put both into the depth comparison —
     * and the deeper unverifiable one won and published its price as this
     * token's. Identity is backfilled from the winner under `coalesce`, so it
     * would never have been corrected.
     */
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: [unsided('3000', 900_000), pool(token, '0.02', 12_000)] }) });
    const result = await createGeckoterminalAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) throw new Error('unreachable');
    expect(result.data).toMatchObject({ priceUsd: 0.02, liquidityUsd: 12_000 });
  });

  it('still takes the deepest when the provider names no side for any pool', async () => {
    /* Nothing to prefer: the fallback is the case its own condition describes. */
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: [unsided('7', 5_000), unsided('9', 80_000)] }) });
    const result = await createGeckoterminalAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) throw new Error('unreachable');
    /* Price from the deepest pool; depth summed across the token's whole
       market, as `sumAcrossPools` does for every adapter. */
    expect(result.data).toMatchObject({ priceUsd: 9, liquidityUsd: 85_000 });
  });

  it('answers nothing when the token is the quote in every pool', async () => {
    const other = '0x1111111111111111111111111111111111111111';
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: [pool(other, '3000', 900_000)] }) });
    const result = await createGeckoterminalAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
  });
});
