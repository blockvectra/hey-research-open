import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import {
  BITQUERY_SURFACE_QUERY,
  createBitquerySurfaceAdapter,
  normalizeBitquerySurface,
} from './bitquery-surface';

/** The real answer for 0xa78735ba… on 2026-09-15: a plain ERC-20 and nothing else. */
const plainToken = {
  EVM: {
    methods: [
      { calls: '39779', Call: { Signature: { Name: 'balanceOf' } } },
      { calls: '17021', Call: { Signature: { Name: 'transfer' } } },
      { calls: '5602', Call: { Signature: { Name: 'transferFrom' } } },
      { calls: '4829', Call: { Signature: { Name: 'approve' } } },
      { calls: '136', Call: { Signature: { Name: 'allowance' } } },
      { calls: '3', Call: { Signature: { Name: 'totalSupply' } } },
      // The decoder could not name this one; an unnamed method tells a reader nothing.
      { calls: '1', Call: { Signature: { Name: '' } } },
    ],
    totals: [{ calls: '67371', callers: '1180', methods: '7' }],
    logs: [
      { events: '22624', Log: { Signature: { Name: 'Transfer' } } },
      { events: '4829', Log: { Signature: { Name: 'Approval' } } },
    ],
  },
};

/** And the Pons V2 factory, read the same way on the same day. */
const protocol = {
  EVM: {
    methods: [
      { calls: '976987', Call: { Signature: { Name: 'getLaunchedToken' } } },
      { calls: '62149', Call: { Signature: { Name: 'launchTokenFor' } } },
      { calls: '31438', Call: { Signature: { Name: 'launchToken' } } },
      { calls: '1271', Call: { Signature: { Name: 'createGraduatedPool' } } },
      { calls: '900', Call: { Signature: { Name: 'balanceOf' } } },
    ],
    totals: [{ calls: '1072745', callers: '9004', methods: '12' }],
    logs: [],
  },
};

describe('bitquery contract surface', () => {
  it('asks one cube for the methods, the totals and the logs', () => {
    expect(BITQUERY_SURFACE_QUERY).toContain('Call: { To: { is: $address } }');
    expect(BITQUERY_SURFACE_QUERY).toContain('count(distinct: Call_Signature_Name)');
    // Realtime is the only dataset this plan may read on this chain.
    expect(BITQUERY_SURFACE_QUERY).toContain('dataset: realtime');
    // Never a holder, a balance or an address (product rule 1).
    expect(BITQUERY_SURFACE_QUERY).not.toMatch(/Holders|Balances|BalanceUpdates/);
  });

  it('separates a plain token from a protocol by what the contract answers', () => {
    const token = normalizeBitquerySurface(plainToken);
    expect(token.beyondErc20).toEqual([]);
    expect(token.methods.map((m) => m.name)).not.toContain('');
    expect(token.callers).toBe(1180);
    expect(token.calls).toBe(67371);
    expect(token.seen).toBe(true);

    const built = normalizeBitquerySurface(protocol);
    expect(built.beyondErc20.map((m) => m.name)).toEqual([
      'getLaunchedToken',
      'launchTokenFor',
      'launchToken',
      'createGraduatedPool',
    ]);
    // Busiest first, so the copy names the methods that are actually used.
    expect(built.beyondErc20[0]?.calls).toBe(976987);
  });

  it('reports an empty window as unseen rather than as an empty contract', () => {
    const quiet = normalizeBitquerySurface({ EVM: { methods: [], totals: [], logs: [] } });
    expect(quiet.seen).toBe(false);
    expect(quiet.calls).toBe(0);
    expect(normalizeBitquerySurface(undefined).seen).toBe(false);
  });

  it('declines an address it cannot ask about, and a missing key', () => {
    const adapter = createBitquerySurfaceAdapter();
    const address = '0xa78735badaad80fca7ac7c03bdd029160d45ce68';
    expect(adapter.canHandle({ address, apiKey: 'k' })).toBe(true);
    expect(adapter.canHandle({ address: 'nope', apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ address, apiKey: '' })).toBe(false);
  });

  it('surfaces a GraphQL error as an error rather than as an empty surface', async () => {
    const adapter = createBitquerySurfaceAdapter();
    const ctx = {
      timeoutMs: 1_000,
      retry: { attempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
      now: () => new Date('2026-09-15T12:00:00Z'),
      fetchImpl: async () =>
        new Response(JSON.stringify({ errors: [{ message: 'bad cube' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    };
    const result = await adapter.fetch(
      { address: '0xa78735badaad80fca7ac7c03bdd029160d45ce68', apiKey: 'k' },
      ctx as never,
    );
    expect(result.status).toBe('error');
  });
});

/*
 * The cases above hand literals to the normaliser; the only one that reaches
 * `performSourceFetch` sends a GraphQL error, so the Zod schema was never run
 * against a real body (round 9, 2026-09-19) — architecture rule 16 on the paid
 * source. The fixture is the Pons V2 factory's answer from 2026-09-15, in the
 * envelope the adapter receives; Bitquery is keyed and metered and no test
 * calls it.
 */
const json = (body: string) => ({ status: 200, body, headers: { 'content-type': 'application/json' } });
const fixture = () => JSON.parse(readFixture('bitquery-surface.json')) as {
  data: { EVM: { methods: Record<string, unknown>[]; totals: Record<string, unknown>[]; logs: Record<string, unknown>[] } };
};
const ADDRESS = '0xa78735badaad80fca7ac7c03bdd029160d45ce68';

describe('bitquery contract surface, through the schema', () => {
  const adapter = createBitquerySurfaceAdapter();

  it('validates the saved envelope and separates the protocol methods from the token ones', async () => {
    const stub = stubFetch(json(readFixture('bitquery-surface.json')));
    const result = await adapter.fetch({ address: ADDRESS, apiKey: 'test-token' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('fresh');
    expect(result.data?.beyondErc20.map((method) => method.name)).toEqual([
      'getLaunchedToken',
      'launchTokenFor',
      'launchToken',
      'createGraduatedPool',
    ]);
    // An unnamed signature is dropped; it tells a reader nothing.
    expect(result.data?.methods.map((method) => method.name)).not.toContain('');
    expect(result.data).toMatchObject({ calls: 1_072_745, callers: 9_004, distinctMethods: 12, seen: true });
  });

  it('refuses a cube that no longer answers with a list of rows', async () => {
    /*
     * This schema is the loosest of the six: every field inside a row is
     * nullish, so a renamed `Call` or `Signature` would normalise to an empty
     * surface and read as "a contract nobody calls". What it does still catch
     * is the shape of the cube itself, and that is what is pinned here.
     */
    const body = fixture();
    (body.data.EVM as Record<string, unknown>).methods = { edges: body.data.EVM.methods };
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch({ address: ADDRESS, apiKey: 'test-token' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('refuses a total that arrives as an object instead of a count', async () => {
    const body = fixture();
    body.data.EVM.totals[0]!.callers = { value: '9004' };
    const stub = stubFetch(json(JSON.stringify(body)));
    const result = await adapter.fetch({ address: ADDRESS, apiKey: 'test-token' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
