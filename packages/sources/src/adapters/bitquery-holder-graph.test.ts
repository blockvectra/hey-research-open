import { describe, expect, it } from 'vitest';

import { BITQUERY_HOLDER_GRAPH_QUERY, createBitqueryHolderGraphAdapter, normalizeBitqueryHolderGraph } from './bitquery-holder-graph';

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OUTSIDE = '0xdddddddddddddddddddddddddddddddddddddddd';

describe('bitquery holder graph', () => {
  /*
   * The whole point of this adapter: the provider filters BOTH ends. Filtering
   * one end and sifting here is what the first cut did, and it lost almost
   * every real pair to busier rows going nowhere the map draws.
   */
  it('asks the provider to filter both ends of an edge', () => {
    expect(BITQUERY_HOLDER_GRAPH_QUERY).toContain('Sender: { in: $addresses }');
    expect(BITQUERY_HOLDER_GRAPH_QUERY).toContain('Receiver: { in: $addresses }');
    // And it asks for nothing that would pass as provenance: a first-funder
    // lookup on a realtime-only plan returns the oldest transfer still inside a
    // five-day window, not the first ever, and it fails with a 200.
    expect(BITQUERY_HOLDER_GRAPH_QUERY).not.toContain('ascending: Block_Time');
  });

  it('sums repeated pairs and keeps direction', () => {
    const out = normalizeBitqueryHolderGraph(
      {
        edges: [
          { Transfer: { Sender: A, Receiver: B }, transfers: '5', amount: '10' },
          { Transfer: { Sender: A.toUpperCase(), Receiver: B }, transfers: '3', amount: '4' },
          { Transfer: { Sender: B, Receiver: A }, transfers: '1', amount: '2' },
        ],
      },
      [A, B],
    );
    // A→B and B→A are two different flows, never merged.
    expect(out.edges).toEqual([
      { from: A, to: B, transfers: 8, amount: 14 },
      { from: B, to: A, transfers: 1, amount: 2 },
    ]);
  });

  it('drops a self-transfer and anything reaching outside the set', () => {
    const out = normalizeBitqueryHolderGraph(
      {
        edges: [
          { Transfer: { Sender: A, Receiver: A }, transfers: '9', amount: '9' },
          { Transfer: { Sender: A, Receiver: OUTSIDE }, transfers: '99', amount: '99' },
          { Transfer: { Sender: null, Receiver: B }, transfers: '2', amount: '2' },
        ],
      },
      [A, B],
    );
    expect(out.edges).toEqual([]);
  });

  it('refuses an address list longer than the document comfortably carries', () => {
    const adapter = createBitqueryHolderGraphAdapter();
    const many = Array.from({ length: 61 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
    expect(adapter.canHandle({ token: A, addresses: many, since: new Date(), apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ token: A, addresses: [], since: new Date(), apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ token: A, addresses: [B], since: new Date(), apiKey: 'k' })).toBe(true);
  });
});
