import { describe, expect, it } from 'vitest';

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
