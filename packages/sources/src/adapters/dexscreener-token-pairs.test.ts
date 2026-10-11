import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { stubFetch, testContext } from '../testing';
import { createDexscreenerTokenPairsAdapter, DEXSCREENER_TOKEN_PAIRS_CAP } from './dexscreener-token-pairs';
import { createDexscreenerTokensAdapter } from './dexscreener-tokens';

/**
 * The market refresh's read (2026-10-11). The fixtures are DEX Screener's own
 * answers, saved live on 2026-10-11:
 *  - `dexscreener-token-pairs.json`: `/token-pairs/v1/robinhood/<Artificial Inu>`,
 *    thirty pools, the provider's featured $87K pool first and its deepest
 *    ($3.46M) third;
 *  - `dexscreener-token-pairs-quote.json`: the same for Orbio, whose listing
 *    also carries seven pools that quote it (`PRIORS / ORBIO`);
 *  - `dexscreener-tokens-main-pair.json`: `/tokens/v1/robinhood/<both>` — one
 *    pair per token, the featured one.
 */
const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
type Pair = { pairAddress: string; url: string; baseToken: { address: string }; liquidity?: { usd?: number }; volume?: { h24?: number } };

const AI = '0x2e8c31162b855a2ffa90f6f8634643ad6f111e18';
const ORBIO = '0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3';

const read = async (body: string, tokenAddress: string) => {
  const stub = stubFetch({ status: 200, body });
  const result = await createDexscreenerTokenPairsAdapter().fetch({ chainId: 4663, chainSlug: 'robinhood', tokenAddress }, testContext({ fetchImpl: stub.fetchImpl }));
  return { result, stub };
};

describe('dexscreener token-pairs adapter: every pool of one token', () => {
  it('asks the chain-scoped pools endpoint for one lower-cased address', async () => {
    const { stub } = await read(fixture('dexscreener-token-pairs.json'), AI.toUpperCase().replace('0X', '0x'));
    expect(stub.callCount()).toBe(1);
    expect(stub.requests[0]!.url).toBe(`https://api.dexscreener.com/token-pairs/v1/robinhood/${AI}`);
  });

  it('links the deepest pool, not the one the provider lists first, and sums the depth of every pool', async () => {
    const pairs = JSON.parse(fixture('dexscreener-token-pairs.json')) as Pair[];
    expect(pairs).toHaveLength(DEXSCREENER_TOKEN_PAIRS_CAP);
    const deepest = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]!;
    // The fixture is the defect: the first listed pool is not the deepest.
    expect(pairs[0]!.pairAddress).not.toBe(deepest.pairAddress);

    const { result } = await read(fixture('dexscreener-token-pairs.json'), AI);
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) throw new Error('unreachable');
    expect(result.data.pairAddress).toBe(deepest.pairAddress);
    expect(result.data.pairUrl).toBe(deepest.url);
    const total = pairs.reduce((sum, pair) => sum + (pair.liquidity?.usd ?? 0), 0);
    expect(result.data.liquidityUsd).toBeCloseTo(total, 2);
    expect(result.data.liquidityUsd).toBeGreaterThan(5_000_000);
    expect(result.data.volume24hUsd).toBeCloseTo(pairs.reduce((sum, pair) => sum + (pair.volume?.h24 ?? 0), 0), 2);
    // The declared links still come with the reading.
    expect(result.data.websites.length + result.data.socials.length).toBeGreaterThan(0);
  });

  it('leaves out the pools that quote the token: they price another token', async () => {
    const pairs = JSON.parse(fixture('dexscreener-token-pairs-quote.json')) as Pair[];
    const base = pairs.filter((pair) => pair.baseToken.address.toLowerCase() === ORBIO);
    const quoted = pairs.filter((pair) => pair.baseToken.address.toLowerCase() !== ORBIO);
    expect(quoted.length).toBeGreaterThan(0);

    const { result } = await read(fixture('dexscreener-token-pairs-quote.json'), ORBIO);
    if (!hasData(result)) throw new Error('expected a reading');
    expect(result.data.contractAddress).toBe(ORBIO);
    expect(result.data.symbol).toBe('ORBIO');
    expect(result.data.liquidityUsd).toBeCloseTo(base.reduce((sum, pair) => sum + (pair.liquidity?.usd ?? 0), 0), 2);
    expect(quoted.map((pair) => pair.pairAddress)).not.toContain(result.data.pairAddress);
  });

  it('answers missing — never a zero market — when no pool of the token is listed, or only pools quoting it', async () => {
    const empty = await read('[]', AI);
    expect(hasData(empty.result)).toBe(false);
    expect(empty.result.status).toBe('missing');

    const onlyQuoted = (JSON.parse(fixture('dexscreener-token-pairs-quote.json')) as Pair[]).filter((pair) => pair.baseToken.address.toLowerCase() !== ORBIO);
    const quoted = await read(JSON.stringify(onlyQuoted), ORBIO);
    expect(quoted.result.status).toBe('missing');
    expect(quoted.result.data).toBeUndefined();
  });

  it('drops a pair echoing another chain', async () => {
    const pairs = JSON.parse(fixture('dexscreener-token-pairs.json')) as (Pair & { chainId: string })[];
    const foreign = pairs.map((pair, index) => (index === 2 ? { ...pair, chainId: 'base' } : pair));
    const { result } = await read(JSON.stringify(foreign), AI);
    if (!hasData(result)) throw new Error('expected a reading');
    expect(result.data.pairAddress).not.toBe(pairs[2]!.pairAddress);
  });

  it('refuses an address or a chain slug it cannot put in a path', () => {
    const adapter = createDexscreenerTokenPairsAdapter();
    expect(adapter.canHandle({ chainId: 4663, chainSlug: 'robinhood', tokenAddress: AI })).toBe(true);
    expect(adapter.canHandle({ chainId: 4663, chainSlug: 'robinhood', tokenAddress: 'nope' })).toBe(false);
    expect(adapter.canHandle({ chainId: 4663, chainSlug: '../x', tokenAddress: AI })).toBe(false);
  });

  it('reports an outage as an error, distinct from a token with no pools', async () => {
    const stub = stubFetch({ status: 500, body: 'Internal Server Error' });
    const result = await createDexscreenerTokenPairsAdapter().fetch({ chainId: 4663, chainSlug: 'robinhood', tokenAddress: AI }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
  });
});

describe('dexscreener batch endpoint: one pair per token, which is why the market refresh no longer reads it', () => {
  it('answers the featured pair for each token, not its pools', async () => {
    const stub = stubFetch({ status: 200, body: fixture('dexscreener-tokens-main-pair.json') });
    const result = await createDexscreenerTokensAdapter().fetch({ chainId: 4663, chainSlug: 'robinhood', addresses: [AI, ORBIO] }, testContext({ fetchImpl: stub.fetchImpl }));
    if (!hasData(result)) throw new Error('expected screenings');
    const ai = result.data.find((row) => row.contractAddress === AI)!;
    const pools = JSON.parse(fixture('dexscreener-token-pairs.json')) as Pair[];
    // The batch's "market" is the first-listed pool alone: its depth, its pair.
    expect(ai.pairAddress).toBe(pools[0]!.pairAddress);
    expect(ai.liquidityUsd).toBeLessThan(100_000);
  });
});
