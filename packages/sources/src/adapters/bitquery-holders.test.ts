import { describe, expect, it } from 'vitest';

import { BITQUERY_HOLDERS_QUERY, createBitqueryHoldersAdapter, normalizeBitqueryHolders } from './bitquery-holders';

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';

describe('bitquery holders', () => {
  it('asks for balances and edges, and for nothing that scores an account', () => {
    // The allowance the founder gave is a distribution map, not wallet analytics.
    expect(BITQUERY_HOLDERS_QUERY).toContain('Holders(');
    expect(BITQUERY_HOLDERS_QUERY).toContain('uniq(of: Holder_Address)');
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
      links: [],
    });
    expect(out.holders.map((h) => h.address)).toEqual([A, B]);
    expect(out.holders[0]).toMatchObject({ amount: 900.5, updateCount: 12 });
    expect(out.holders[0]!.firstChangeAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(out.holdersTotal).toBe(4321);
  });

  it('keeps only edges whose two ends are both ranked, and never a self-transfer', () => {
    const out = normalizeBitqueryHolders({
      top: [
        { Holder: { Address: A }, Balance: { Amount: '900' } },
        { Holder: { Address: B }, Balance: { Amount: '100' } },
      ],
      total: [],
      links: [
        { Transfer: { Sender: A, Receiver: B }, transfers: '3', amount: '50' },
        { Transfer: { Sender: A, Receiver: B }, transfers: '2', amount: '25' },
        // C is not on the map, so this edge has nothing to attach to.
        { Transfer: { Sender: A, Receiver: C }, transfers: '9', amount: '99' },
        // Moving to itself is not a connection.
        { Transfer: { Sender: A, Receiver: A }, transfers: '7', amount: '7' },
        { Transfer: { Sender: null, Receiver: B }, transfers: '1', amount: '1' },
      ],
    });
    expect(out.links).toEqual([{ from: A, to: B, transfers: 5, amount: 75 }]);
  });

  it('refuses a malformed token or a missing key', () => {
    const adapter = createBitqueryHoldersAdapter();
    expect(adapter.canHandle({ token: A, since: new Date(), apiKey: 'k' })).toBe(true);
    expect(adapter.canHandle({ token: 'nope', since: new Date(), apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ token: A, since: new Date(), apiKey: '' })).toBe(false);
  });
});
