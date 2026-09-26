import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { BITQUERY_CREATIONS_QUERY, createBitqueryCreationsAdapter } from './bitquery-creations';

const SERIAL = '0xd03543d900000000000000000000000000000001';
const SMALL = '0x70960076000000000000000000000000000000a2';
const EDGE = '0xccf14f0a00000000000000000000000000000003';
const NO_COUNT = '0x854dba2300000000000000000000000000000004';
const QUIET = '0x1111111111111111111111111111111111111111';
const since = new Date('2026-06-29T00:00:00Z');
const json = { 'content-type': 'application/json' };

describe('bitquery contract creations per deployer (2026-09-27, F4)', () => {
  it('counts creations per asked deployer, lower-cased, and drops accounts nobody asked about', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-contract-creations.json'), headers: json });
    const result = await createBitqueryCreationsAdapter().fetch({ senders: [SERIAL, SMALL, EDGE, NO_COUNT, QUIET], since, apiKey: 'k' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    expect(Object.fromEntries(result.data.counts)).toEqual({ [SERIAL]: 412, [SMALL]: 37, [EDGE]: 100 });
    // A deployer with no row created nothing in the window; a row with no count is not a zero.
    expect(result.data.counts.has(QUIET)).toBe(false);
    expect(result.data.counts.has(NO_COUNT)).toBe(false);
    expect(result.data.rows).toBe(5);
  });

  it('sends the window and the deployers lower-cased, and refuses a batch it cannot ask for', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-contract-creations.json'), headers: json });
    await createBitqueryCreationsAdapter().fetch({ senders: ['0xD03543D900000000000000000000000000000001'], since, apiKey: 'k' }, testContext({ fetchImpl: stub.fetchImpl }));
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { variables: { senders: string[]; since: string } };
    expect(body.variables).toEqual({ senders: [SERIAL], since: since.toISOString() });
    const adapter = createBitqueryCreationsAdapter();
    expect(adapter.canHandle({ senders: [], since, apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ senders: ['0xnot'], since, apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ senders: Array.from({ length: 1_001 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`), since, apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ senders: [SERIAL], since, apiKey: 'k' })).toBe(true);
  });

  it('turns a spent allowance into a rate limit, not an outage', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ errors: [{ message: 'points limit exceeded' }] }), headers: json });
    const result = await createBitqueryCreationsAdapter().fetch({ senders: [SERIAL], since, apiKey: 'k' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.errorCode).toBe('RATE_LIMITED');
  });

  it('asks the archive through the combined dataset, for the Calls cube only, and reads no created address', () => {
    expect(BITQUERY_CREATIONS_QUERY).toContain('dataset: combined');
    expect(BITQUERY_CREATIONS_QUERY).toMatch(/\bCalls\s*\(/);
    expect(BITQUERY_CREATIONS_QUERY).toContain('Create: true');
    expect(BITQUERY_CREATIONS_QUERY).not.toMatch(/\b(Transfers|Transactions|DEXPoolEvents|BalanceUpdates|Balances|Holders)\s*\(/);
    // Grouped by the sender only: never the created contract, never a caller.
    expect(BITQUERY_CREATIONS_QUERY).not.toMatch(/Call\s*\{/);
  });
});
