import { describe, expect, it } from 'vitest';

import { createBitqueryContractActivityAdapter, normalizeBitqueryContractDays, BITQUERY_CONTRACT_ACTIVITY_QUERY } from './bitquery-contracts';

const A = '0x39dbed3a2bd333467115de45665cc57f813c4571';
const B = '0x2e8c31162b855a2ffa90f6f8634643ad6f111e18';

describe('bitquery contract activity', () => {
  it('asks for counts and never for an account', () => {
    /*
     * CLAUDE.md product rule 1: the cubes below can all group by the sending
     * account on this chain. The query must not — but counting how many
     * distinct accounts there were is a count, and that is the whole of
     * `callers` (2026-09-15). The guard is therefore about the *shape*: the
     * sender field may appear only inside `count(distinct: …)`, never as a
     * selection that would put an address in the response.
     */
    expect(BITQUERY_CONTRACT_ACTIVITY_QUERY).not.toMatch(/Call_From|Transfer_Sender|Holder|Balance/);
    expect(BITQUERY_CONTRACT_ACTIVITY_QUERY).toContain('count(distinct: Transaction_From)');
    expect(BITQUERY_CONTRACT_ACTIVITY_QUERY.replace(/count\(distinct: Transaction_From\)/g, '')).not.toContain('Transaction_From');
    expect(BITQUERY_CONTRACT_ACTIVITY_QUERY).toContain('count(distinct: Call_Signature_Name)');
    expect(BITQUERY_CONTRACT_ACTIVITY_QUERY).toContain('count(distinct: Log_Signature_Name)');
  });

  it('joins three cubes into one row per contract and day', () => {
    const rows = normalizeBitqueryContractDays({
      calls: [
        { Block: { Date: '2026-09-13' }, Call: { To: A.toUpperCase() }, calls: '1450750', methods: '17', callers: '7835' },
        { Block: { Date: '2026-09-12' }, Call: { To: A }, calls: '900', methods: '4', callers: '12' },
      ],
      events: [
        { Block: { Date: '2026-09-13' }, Log: { SmartContract: A }, events: '590679', kinds: '3' },
        { Block: { Date: '2026-09-13' }, Log: { SmartContract: B }, events: '12', kinds: '2' },
      ],
      transactions: [{ Block: { Date: '2026-09-13' }, Transaction: { To: A }, transactions: '4200' }],
    });

    expect(rows).toHaveLength(3);
    const latest = rows.find((row) => row.address === A && row.day === '2026-09-13');
    expect(latest).toEqual({ address: A, day: '2026-09-13', calls: 1_450_750, methods: 17, callers: 7_835, events: 590_679, eventKinds: 3, transactions: 4_200 });
    // A contract that only emitted events still gets a row, with zeroes for the rest.
    expect(rows.find((row) => row.address === B)).toEqual({ address: B, day: '2026-09-13', calls: 0, methods: 0, callers: 0, events: 12, eventKinds: 2, transactions: 0 });
  });

  it('drops a malformed address or day rather than guessing', () => {
    const rows = normalizeBitqueryContractDays({
      calls: [
        { Block: { Date: 'not-a-day' }, Call: { To: A }, calls: '5', methods: '1', callers: '1' },
        { Block: { Date: '2026-09-13' }, Call: { To: '0xnope' }, calls: '5', methods: '1', callers: '1' },
        { Block: { Date: '2026-09-13' }, Call: { To: null }, calls: '5', methods: '1', callers: '1' },
      ],
      events: [],
      transactions: [],
    });
    expect(rows).toEqual([]);
  });

  it('refuses a batch larger than the provider accepts and one with a bad address', () => {
    const adapter = createBitqueryContractActivityAdapter();
    const many = Array.from({ length: 101 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
    expect(adapter.canHandle({ addresses: many, since: new Date(), apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ addresses: [A], since: new Date(), apiKey: '' })).toBe(false);
    expect(adapter.canHandle({ addresses: ['nope'], since: new Date(), apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ addresses: [A], since: new Date(), apiKey: 'k' })).toBe(true);
  });
});
