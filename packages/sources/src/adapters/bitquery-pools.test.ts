import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { BITQUERY_POOLS_QUERY, createBitqueryPoolsAdapter, normalizeBitqueryPools } from './bitquery-pools';

const HEY = '0xb33eb16782776b4d738c0fd643577cb0284db610';
const PONS = '0x39dbed3a2bd333467115de45665cc57f813c4571';
const ETH = '0x0000000000000000000000000000000000000000';
const POOL_A = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const POOL_B = '0xe2c6b7056eba176add3097ff537114c11db0db18';

describe('bitquery pools', () => {
  it('matches a token on either side of the pool', () => {
    // $HEY is CurrencyB in its only pool. A one-sided filter finds nothing for
    // it at all, which is why both cubes use `any:` (2026-09-15).
    expect(BITQUERY_POOLS_QUERY).toContain('CurrencyA: { SmartContract: { in: $addresses } }');
    expect(BITQUERY_POOLS_QUERY).toContain('CurrencyB: { SmartContract: { in: $addresses } }');
    expect(BITQUERY_POOLS_QUERY).toContain('SlippageBasisPoints: { eq: 100 }');
  });

  it('adds both sides of every pool and counts the pools once', () => {
    const rows = normalizeBitqueryPools(
      {
        pools: [
          // The real shape: ETH is A, HEY is B.
          { PoolEvent: { Pool: { SmartContract: POOL_A, CurrencyA: { SmartContract: ETH }, CurrencyB: { SmartContract: HEY } }, Liquidity: { a: 20512.723, b: 20425.15 } }, events: '835' },
          { PoolEvent: { Pool: { SmartContract: POOL_B, CurrencyA: { SmartContract: PONS }, CurrencyB: { SmartContract: ETH } }, Liquidity: { a: 7516.95, b: 7421.34 } }, events: '12' },
          // A second event on a pool already seen must not count it twice.
          { PoolEvent: { Pool: { SmartContract: POOL_B, CurrencyA: { SmartContract: PONS }, CurrencyB: { SmartContract: ETH } }, Liquidity: { a: 0, b: 0 } }, events: '4' },
        ],
        depth: [],
      },
      [HEY, PONS],
    );
    const hey = rows.find((row) => row.tokenAddress === HEY);
    expect(hey).toMatchObject({ pools: 1, events: 835 });
    expect(hey?.liquidityUsd).toBeCloseTo(40_937.873, 3);
    expect(rows.find((row) => row.tokenAddress === PONS)).toMatchObject({ pools: 1, events: 16 });
  });

  it('reads the depth in the direction that sells the token', () => {
    const rows = normalizeBitqueryPools(
      {
        pools: [],
        depth: [
          // HEY is B, so selling it is B→A and only `sellingB` is its depth.
          { Price: { Pool: { SmartContract: POOL_A, CurrencyA: { SmartContract: ETH }, CurrencyB: { SmartContract: HEY } }, AtoB: { sellingA: 9.5 }, BtoA: { sellingB: 1200 } } },
          // PONS is A, so selling it is A→B.
          { Price: { Pool: { SmartContract: POOL_B, CurrencyA: { SmartContract: PONS }, CurrencyB: { SmartContract: ETH } }, AtoB: { sellingA: 611.957 }, BtoA: { sellingB: 4.1 } } },
          { Price: { Pool: { SmartContract: '0xaa241a27c911027b0f3236ec89d4db21269064da', CurrencyA: { SmartContract: PONS }, CurrencyB: { SmartContract: ETH } }, AtoB: { sellingA: 0.556 }, BtoA: { sellingB: 1 } } },
        ],
      },
      [HEY, PONS],
    );
    expect(rows.find((row) => row.tokenAddress === HEY)?.depthOnePctBase).toBeCloseTo(1200, 3);
    // Depth adds up across a token's pools.
    expect(rows.find((row) => row.tokenAddress === PONS)?.depthOnePctBase).toBeCloseTo(612.513, 3);
  });

  it('ignores a pool of two tokens it was not asked about', () => {
    const rows = normalizeBitqueryPools(
      { pools: [{ PoolEvent: { Pool: { SmartContract: POOL_B, CurrencyA: { SmartContract: ETH }, CurrencyB: { SmartContract: PONS } }, Liquidity: { a: 5, b: 5 } }, events: '1' }], depth: [] },
      [HEY],
    );
    expect(rows).toEqual([]);
  });

  it('refuses a batch larger than the provider takes', () => {
    const adapter = createBitqueryPoolsAdapter();
    const many = Array.from({ length: 101 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
    expect(adapter.canHandle({ addresses: many, since: new Date(), apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ addresses: [HEY], since: new Date(), apiKey: '' })).toBe(false);
    expect(adapter.canHandle({ addresses: [HEY], since: new Date(), apiKey: 'k' })).toBe(true);
  });
});

/*
 * The cases above hand literals to the normaliser, so the Zod schema never ran
 * (round 9, 2026-09-19) — architecture rule 16 on the paid source. The fixture
 * carries the same two pools asserted above, in the envelope the adapter
 * actually receives; Bitquery is keyed and metered and no test calls it.
 */
const json = (body: string) => ({ status: 200, body, headers: { 'content-type': 'application/json' } });
const fixture = () => JSON.parse(readFixture('bitquery-pools.json')) as {
  data: { EVM: { pools: Record<string, unknown>[]; depth: Record<string, unknown>[] } };
};

describe('bitquery pools, through the schema', () => {
  const adapter = createBitqueryPoolsAdapter();
  const input = { addresses: [HEY, PONS], since: new Date('2026-09-14T00:00:00Z'), apiKey: 'test-token' };

  it('validates the saved envelope, counts each pool once and reads depth in the selling direction', async () => {
    const stub = stubFetch(json(readFixture('bitquery-pools.json')));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    const hey = result.data?.find((row) => row.tokenAddress === HEY);
    expect(hey).toMatchObject({ pools: 1, events: 835 });
    expect(hey?.liquidityUsd).toBeCloseTo(40_937.873, 3);
    // HEY is CurrencyB, so its depth is the B→A side only.
    expect(hey?.depthOnePctBase).toBeCloseTo(1200, 3);
    const pons = result.data?.find((row) => row.tokenAddress === PONS);
    // A second event on a pool already seen must not count or bank it twice.
    expect(pons).toMatchObject({ pools: 1, events: 16 });
    expect(pons?.depthOnePctBase).toBeCloseTo(612.513, 3);
  });

  it('refuses an envelope whose pool wrapper was renamed', async () => {
    // `PoolEvent { Pool }` is required on every row. A rename would leave every
    // token with no pools and no liquidity, which reads as a dead market.
    const body = fixture();
    body.data.EVM.pools[0] = { PoolEvents: body.data.EVM.pools[0]!.PoolEvent, events: '835' };
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('refuses a pool address that arrives as a number', async () => {
    const body = fixture();
    ((body.data.EVM.depth[0]!.Price as Record<string, unknown>).Pool as Record<string, unknown>).SmartContract = 42;
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
