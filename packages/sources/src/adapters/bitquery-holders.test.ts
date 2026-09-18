import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { BITQUERY_HOLDERS_QUERY, createBitqueryHoldersAdapter, normalizeBitqueryHolders } from './bitquery-holders';

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';

describe('bitquery holders', () => {
  it('asks for balances and edges, and for nothing that scores an account', () => {
    // The allowance the founder gave is a distribution map, not wallet analytics.
    expect(BITQUERY_HOLDERS_QUERY).toContain('Holders(');
    // The cube keeps a row for every address that has ever held the token, so an
    // unfiltered count answers "ever touched it", not "holds it". On $HEY that
    // was 2,445 against 1,040 on the block explorer.
    expect(BITQUERY_HOLDERS_QUERY).toContain('count(distinct: Holder_Address, if: { Balance: { Amount: { gt: "0" } } })');
    expect(BITQUERY_HOLDERS_QUERY).not.toContain('uniq(of: Holder_Address)');
    // The edges are a separate request now; this document must not pay for them.
    expect(BITQUERY_HOLDERS_QUERY).not.toContain('Transfers(');
    /*
     * GraphQL refuses an operation declaring a variable it never uses, and
     * that is exactly how removing the transfers cube broke all 434 requests
     * on 2026-09-14. Every declared variable must appear in the body.
     */
    const declared = [...BITQUERY_HOLDERS_QUERY.matchAll(/\$(\w+):/g)].map((m) => m[1]!);
    const body = BITQUERY_HOLDERS_QUERY.slice(BITQUERY_HOLDERS_QUERY.indexOf('{'));
    for (const name of declared) expect(body).toContain(`$${name}`);
    expect(declared).toEqual(['token', 'top', 'exclude']);
    // The exclusion belongs to the counts only: the ranked list must still
    // return the pool and the burn address, because the map labels them.
    const total = BITQUERY_HOLDERS_QUERY.slice(BITQUERY_HOLDERS_QUERY.indexOf('total:'));
    expect(total).toContain('notIn: $exclude');
    const topSelection = BITQUERY_HOLDERS_QUERY.slice(BITQUERY_HOLDERS_QUERY.indexOf('top: Holders'), BITQUERY_HOLDERS_QUERY.indexOf('total:'));
    expect(topSelection).not.toContain('$exclude');
    expect(BITQUERY_HOLDERS_QUERY).not.toMatch(/AmountInUSD|PnL|Trade/);
  });

  it('ranks holders and drops a zero balance', () => {
    const out = normalizeBitqueryHolders({
      top: [
        { Holder: { Address: A.toUpperCase() }, Balance: { Amount: '900.5', FirstChangeTime: '2026-09-01T00:00:00Z', LastChangeTime: '2026-09-13T00:00:00Z', UpdateCount: '12' } },
        { Holder: { Address: B }, Balance: { Amount: '100', FirstChangeTime: null, LastChangeTime: null, UpdateCount: null } },
        { Holder: { Address: C }, Balance: { Amount: '0', FirstChangeTime: null, LastChangeTime: null, UpdateCount: null } },
      ],
      total: [{ holders: '4321' }],
    });
    expect(out.holders.map((h) => h.address)).toEqual([A, B]);
    expect(out.holders[0]).toMatchObject({ amount: 900.5, updateCount: 12 });
    expect(out.holders[0]!.firstChangeAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(out.holdersTotal).toBe(4321);
  });

  it('refuses a malformed token or a missing key', () => {
    const adapter = createBitqueryHoldersAdapter();
    expect(adapter.canHandle({ token: A, since: new Date(), apiKey: 'k' })).toBe(true);
    expect(adapter.canHandle({ token: 'nope', since: new Date(), apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ token: A, since: new Date(), apiKey: '' })).toBe(false);
  });
});

/*
 * The cases above bypass the Zod schema by handing literals to the normaliser
 * (round 9, 2026-09-19), so nothing proved the envelope this adapter actually
 * receives is the one it validates — architecture rule 16 on the paid source.
 * The fixture is hand-built from the adapter's own schema; Bitquery is keyed
 * and metered and no test calls it.
 */
const json = (body: string) => ({ status: 200, body, headers: { 'content-type': 'application/json' } });
const fixture = () => JSON.parse(readFixture('bitquery-holders.json')) as {
  data: { EVM: { top: Record<string, unknown>[]; total: Record<string, unknown>[] } };
};

describe('bitquery holders, through the schema', () => {
  const adapter = createBitqueryHoldersAdapter();
  const input = { token: A, since: new Date('2026-09-14T00:00:00Z'), apiKey: 'test-token', exclude: [C] };

  it('validates the saved envelope, ranks the balances and carries the concentration figures', async () => {
    const stub = stubFetch(json(readFixture('bitquery-holders.json')));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    // A zero balance is a row the cube keeps and not a holder.
    expect(result.data?.holders.map((holder) => holder.address)).toEqual([A, B]);
    expect(result.data).toMatchObject({ holdersTotal: 4321, gini: 0.8123, nakamotoHalf: 34, medianBalance: 125.75 });
    // The exclusion is a variable on the request, not something the reply carries.
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { variables: { exclude: string[]; top: number } };
    expect(body.variables).toMatchObject({ exclude: [C], top: 50 });
  });

  it('refuses a holder address that arrives null instead of a string', async () => {
    // `Holder { Address }` is the only required string in the reply. A null
    // there would drop a balance out of the map with no error at all.
    const body = fixture();
    (body.data.EVM.top[0]!.Holder as Record<string, unknown>).Address = null;
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('refuses a balance that arrives flattened to a bare amount', async () => {
    // The plausible reshape for this cube: `Balance` collapsing from an object
    // to the number it mostly carries. Everything inside `Balance` is nullish,
    // so the object being required is the whole of the guard.
    const body = fixture();
    body.data.EVM.top[0]!.Balance = 900.5 as unknown as Record<string, unknown>;
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
