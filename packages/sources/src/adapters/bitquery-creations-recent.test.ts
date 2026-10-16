import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { BITQUERY_POINTS } from './bitquery';
import {
  BITQUERY_RECENT_CREATIONS_BATCH,
  BITQUERY_RECENT_CREATIONS_QUERY,
  BITQUERY_RECENT_CREATIONS_ROW_LIMIT,
  createBitqueryRecentCreationsAdapter,
  normalizeBitqueryRecentCreations,
} from './bitquery-creations-recent';

/*
 * The follow-up trigger's read (2026-10-16). The fixture is hand-built from the
 * adapter's own schema and the row shape `HeyDeployment` returned live on
 * 2026-09-15 (`Block { Number Time }`, `Transaction { Hash From }`,
 * `Call { To }`); Bitquery is keyed and metered, so nothing here calls it.
 */
const DEPLOYER = '0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6';
const OTHER = '0x9999999999999999999999999999999999999999';
const since = new Date('2026-10-16T08:45:00Z');
const json = { 'content-type': 'application/json' };

describe('bitquery recent contract creations (2026-10-16)', () => {
  it('returns each creation by an asked deployer once, lower-cased and oldest first, and drops everyone else', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-recent-creations.json'), headers: json });
    const result = await createBitqueryRecentCreationsAdapter().fetch({ senders: [DEPLOYER], since, apiKey: 'k' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    expect(result.data).toEqual({
      rows: 6,
      truncated: false,
      creations: [
        {
          address: '0xcb199e9bbd4a3e52331eb1e90d17e6d3746b5fc6',
          sender: DEPLOYER,
          txHash: '0x7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
          blockNumber: 61_204_417,
          createdAt: new Date('2026-10-16T09:12:04Z'),
        },
        {
          address: '0x00000000000000000000000000000000000c0de2',
          sender: DEPLOYER,
          txHash: '0x' + '11'.repeat(32),
          blockNumber: 61_204_990,
          createdAt: new Date('2026-10-16T09:21:37Z'),
        },
      ],
    });
    // The account nobody asked about, a row with no block and a row with no usable hash are not in the answer.
    expect(JSON.stringify(result.data)).not.toContain(OTHER.slice(2));
    expect(JSON.stringify(result.data)).not.toContain('c0de4');
    expect(JSON.stringify(result.data)).not.toContain('c0de5');
  });

  it('books five points for the one realtime cube, whatever comes back', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ data: { EVM: { Calls: [] } } }), headers: json });
    const result = await createBitqueryRecentCreationsAdapter().fetch({ senders: [DEPLOYER], since, apiKey: 'k' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.meteredUnits).toBe(BITQUERY_POINTS.perRealtimeCube);
    expect(hasData(result) && result.data).toEqual({ creations: [], rows: 0, truncated: false });
  });

  it('sends the window and the deployers lower-cased, and refuses a batch it cannot ask for', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-recent-creations.json'), headers: json });
    await createBitqueryRecentCreationsAdapter().fetch({ senders: [DEPLOYER.toUpperCase().replace('0X', '0x')], since, apiKey: 'k' }, testContext({ fetchImpl: stub.fetchImpl }));
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { query: string; variables: { senders: string[]; since: string } };
    expect(body.variables).toEqual({ senders: [DEPLOYER], since: since.toISOString() });
    expect(body.query).toBe(BITQUERY_RECENT_CREATIONS_QUERY);
    const adapter = createBitqueryRecentCreationsAdapter();
    expect(adapter.canHandle({ senders: [], since, apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ senders: ['0xnot'], since, apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ senders: [DEPLOYER], since: new Date('nope'), apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ senders: [DEPLOYER], since, apiKey: '' })).toBe(false);
    expect(adapter.canHandle({ senders: Array.from({ length: BITQUERY_RECENT_CREATIONS_BATCH + 1 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`), since, apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ senders: Array.from({ length: BITQUERY_RECENT_CREATIONS_BATCH }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`), since, apiKey: 'k' })).toBe(true);
  });

  it('refuses a whole answer that reaches the row limit: nothing in it is returned', () => {
    const row = (i: number) => ({
      Block: { Number: String(61_000_000 + i), Time: '2026-10-16T09:00:00Z' },
      Transaction: { Hash: `0x${i.toString(16).padStart(64, '0')}`, From: DEPLOYER },
      Call: { To: `0x${(i + 1).toString(16).padStart(40, '0')}` },
    });
    const full = normalizeBitqueryRecentCreations(Array.from({ length: BITQUERY_RECENT_CREATIONS_ROW_LIMIT }, (_, i) => row(i)), [DEPLOYER]);
    expect(full).toEqual({ creations: [], rows: BITQUERY_RECENT_CREATIONS_ROW_LIMIT, truncated: true });
    const under = normalizeBitqueryRecentCreations(Array.from({ length: BITQUERY_RECENT_CREATIONS_ROW_LIMIT - 1 }, (_, i) => row(i)), [DEPLOYER]);
    expect(under.truncated).toBe(false);
    expect(under.creations).toHaveLength(BITQUERY_RECENT_CREATIONS_ROW_LIMIT - 1);
  });

  it('turns a spent allowance into a rate limit and a malformed envelope into an invalid response', async () => {
    const spent = stubFetch({ status: 200, body: JSON.stringify({ errors: [{ message: 'points limit exceeded' }] }), headers: json });
    const limited = await createBitqueryRecentCreationsAdapter().fetch({ senders: [DEPLOYER], since, apiKey: 'k' }, testContext({ fetchImpl: spent.fetchImpl }));
    expect(hasData(limited)).toBe(false);
    expect(limited.errorCode).toBe('RATE_LIMITED');
    const odd = stubFetch({ status: 200, body: JSON.stringify({ data: { EVM: { Calls: 'nope' } } }), headers: json });
    const invalid = await createBitqueryRecentCreationsAdapter().fetch({ senders: [DEPLOYER], since, apiKey: 'k' }, testContext({ fetchImpl: odd.fetchImpl }));
    expect(hasData(invalid)).toBe(false);
    expect(invalid.errorCode).toBe('INVALID_RESPONSE');
  });

  it('reads realtime, the Calls cube only, creations by the asked senders only, and no other account', () => {
    expect(BITQUERY_RECENT_CREATIONS_QUERY).toContain('dataset: realtime');
    expect(BITQUERY_RECENT_CREATIONS_QUERY).toContain('Create: true');
    expect(BITQUERY_RECENT_CREATIONS_QUERY).toContain('Transaction: { From: { in: $senders } }');
    expect([...BITQUERY_RECENT_CREATIONS_QUERY.matchAll(/\b(DEXTradeByTokens|DEXTrades|Transfers|Transactions|Calls|Events|DEXPoolEvents|DEXPoolSlippages|Holders|BalanceUpdates)\s*\(/g)].map((m) => m[1])).toEqual(['Calls']);
    // The executing account (a factory's address on an indirect creation) and any count are never asked for.
    expect(BITQUERY_RECENT_CREATIONS_QUERY).toMatch(/Call \{ To \}/);
    expect(BITQUERY_RECENT_CREATIONS_QUERY).not.toMatch(/Call \{[^}]*From/);
    expect(BITQUERY_RECENT_CREATIONS_QUERY).not.toMatch(/\w+:\s*count\b|count\(|sum\(/);
  });
});
