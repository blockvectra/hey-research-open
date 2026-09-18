import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
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

/*
 * The cases above hand literals to the normaliser, so the Zod schema never ran
 * (round 9, 2026-09-19) — architecture rule 16 on the paid source. The fixture
 * is hand-built from the adapter's own schema and the pairs already asserted
 * above; Bitquery is keyed and metered and no test calls it.
 */
const json = (body: string) => ({ status: 200, body, headers: { 'content-type': 'application/json' } });
const fixture = () => JSON.parse(readFixture('bitquery-holder-graph.json')) as {
  data: { EVM: { edges: Record<string, unknown>[] } };
};

describe('bitquery holder graph, through the schema', () => {
  const adapter = createBitqueryHolderGraphAdapter();
  const input = { token: '0xb33eb16782776b4d738c0fd643577cb0284db610', addresses: [A, B], since: new Date('2026-09-14T00:00:00Z'), apiKey: 'test-token' };

  it('validates the saved envelope, sums repeated pairs and keeps both directions', async () => {
    const stub = stubFetch(json(readFixture('bitquery-holder-graph.json')));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    // The fourth fixture row reaches OUTSIDE the ranked set and is dropped.
    expect(result.data?.edges).toEqual([
      { from: A, to: B, transfers: 8, amount: 14 },
      { from: B, to: A, transfers: 1, amount: 2 },
    ]);
    expect(result.data?.edges.some((edge) => edge.to === OUTSIDE)).toBe(false);
  });

  it('refuses an envelope whose edge field was renamed', async () => {
    // `Transfer` is the one required object on a row. A rename would empty the
    // map and read as "these holders never traded with each other".
    const body = fixture();
    const [first] = body.data.EVM.edges;
    body.data.EVM.edges[0] = { Transfers: first!.Transfer, transfers: first!.transfers, amount: first!.amount };
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('refuses a sender that is no longer a string', async () => {
    const body = fixture();
    (body.data.EVM.edges[0]!.Transfer as Record<string, unknown>).Sender = { Address: A };
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
