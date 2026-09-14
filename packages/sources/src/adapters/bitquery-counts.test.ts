import { describe, expect, it } from 'vitest';

import { normalizeBitqueryContractDays, BITQUERY_CONTRACT_ACTIVITY_QUERY } from './bitquery-contracts';
import { normalizeBitqueryHolders } from './bitquery-holders';
import { normalizeBitqueryTokenDays } from './bitquery-days';

/**
 * The counts added on 2026-09-15, and the one rule they all share: an
 * aggregate the provider did not answer is unknown, never zero.
 *
 * This is the lesson the `Events` cube taught in the ugliest way — it does not
 * index every contract on this chain, so a zero from it meant "no data", and
 * writing that zero as a fact put a flat empty chart on a project whose
 * contract had taken 2.5 million calls that day.
 */
const A = '0x39dbed3a2bd333467115de45665cc57f813c4571';

describe('address counts', () => {
  it('counts distinct callers without ever selecting one', () => {
    // The whole of product rule 1 in one assertion: the sender field may
    // appear inside a count, and nowhere else.
    expect(BITQUERY_CONTRACT_ACTIVITY_QUERY).toContain('callers: count(distinct: Transaction_From)');
    expect(BITQUERY_CONTRACT_ACTIVITY_QUERY.replace(/count\(distinct: Transaction_From\)/g, '')).not.toContain('Transaction_From');

    const [row] = normalizeBitqueryContractDays({
      calls: [{ Block: { Date: '2026-09-14' }, Call: { To: A }, calls: '544469', methods: '10', callers: '7835' }],
      events: [],
      transactions: [],
    });
    expect(row).toMatchObject({ calls: 544_469, callers: 7_835 });
  });

  it('attaches trading breadth to a day that actually traded, and only that day', () => {
    const rows = normalizeBitqueryTokenDays(
      [{ Block: { Date: '2026-09-14' }, Trade: { Currency: { SmartContract: A }, Side: { Type: 'buy' }, close: '0.5' }, trades: '770', volume_usd: '122530' }],
      [],
      [
        { Block: { Date: '2026-09-14' }, Trade: { Currency: { SmartContract: A } }, addresses: '297', buyers: '206', sellers: '165', pools: '1' },
        // A breadth row for a day with no trades behind it is a figure about
        // nothing, and is dropped rather than inventing a day.
        { Block: { Date: '2026-09-01' }, Trade: { Currency: { SmartContract: A } }, addresses: '5', buyers: '5', sellers: '0', pools: '1' },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: '2026-09-14', trades: 770, distinctAddresses: 297, distinctBuyers: 206, distinctSellers: 165, poolsTraded: 1 });
  });

  it('leaves a count undefined when the provider did not answer it', () => {
    const rows = normalizeBitqueryTokenDays(
      [{ Block: { Date: '2026-09-14' }, Trade: { Currency: { SmartContract: A }, Side: { Type: 'buy' }, close: '0.5' }, trades: '770', volume_usd: '1' }],
      [],
      [{ Block: { Date: '2026-09-14' }, Trade: { Currency: { SmartContract: A } }, addresses: null, buyers: '206', sellers: null, pools: '0' }],
    );
    expect(rows[0]?.distinctBuyers).toBe(206);
    expect(rows[0]?.distinctAddresses).toBeUndefined();
    expect(rows[0]?.distinctSellers).toBeUndefined();
    // Zero pools on a day that traded is not a fact about the token.
    expect(rows[0]?.poolsTraded).toBeUndefined();
  });

  it('reads concentration as the provider computed it, and drops what it did not', () => {
    const read = normalizeBitqueryHolders({
      top: [{ Holder: { Address: A }, Balance: { Amount: '100', FirstChangeTime: null, LastChangeTime: null, UpdateCount: null } }],
      // The figures $HEY actually returned on 2026-09-15.
      total: [{ holders: '1053', gini: 0.9364780160976185, nakamoto: 17, median: null }],
    });
    expect(read.holdersTotal).toBe(1_053);
    expect(read.gini).toBeCloseTo(0.93648, 5);
    expect(read.nakamotoHalf).toBe(17);
    expect(read.medianBalance).toBeUndefined();
  });
});
