import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { BITQUERY_ARCHIVE_CUBES } from './bitquery';
import { BITQUERY_METHOD_BATCH, BITQUERY_METHOD_ROW_LIMIT, bitqueryMethodDaysQuery, createBitqueryMethodDaysAdapter, normalizeSelector } from './bitquery-methods';

/*
 * Calls per method per contract per day (F9, 2026-09-27). The fixture is
 * hand-built from the shapes the live probes returned on 2026-09-26 (M4 P1,
 * P6): aggregates as strings, a bare upper-case selector, an empty name on an
 * undecoded call, and the rare call that carries neither. Bitquery is keyed
 * and metered, so nothing here calls it.
 */
const STAKER = '0x5f0ff5a1b1b0e3c1d7c6c4b0e0f2a1d3c549c3aa';
const ORACLE = '0x0fa51f0000000000000000000000000000000001';
const json = (body: string) => ({ status: 200, body, headers: { 'content-type': 'application/json' } });
const window = { since: new Date('2026-09-24T00:00:00Z'), till: new Date('2026-09-25T23:59:59Z') };

describe('bitquery method days', () => {
  it('asks one granted cube for counts and never for an account', () => {
    for (const dataset of ['realtime', 'combined'] as const) {
      const query = bitqueryMethodDaysQuery(dataset);
      const cubes = [...query.matchAll(/\b([A-Z][A-Za-z]+)\s*\(/g)].map((match) => match[1]).filter((name) => name !== 'EVM' && !name!.startsWith('Hey'));
      expect(cubes).toEqual(['Calls']);
      expect(BITQUERY_ARCHIVE_CUBES as readonly string[]).toContain('Calls');
      expect(query).toContain(`dataset: ${dataset}`);
      // No sender, no caller, no count of either: the daily caller count lives on the usage read.
      expect(query).not.toMatch(/From|Sender|Holder|Balance|Transaction/);
      expect(query).toContain('Signature { Name SignatureHash }');
      expect(query).toContain(`limit: { count: ${BITQUERY_METHOD_ROW_LIMIT} }`);
    }
  });

  it('reads one row per contract, day and method, summing repeats, with the selector normalised', async () => {
    const stub = stubFetch(json(readFixture('bitquery-method-days.json')));
    const result = await createBitqueryMethodDaysAdapter().fetch(
      { addresses: [STAKER, ORACLE], ...window, dataset: 'realtime', apiKey: 'k' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    expect(result.data.truncated).toBe(false);
    expect(result.data.rows).toEqual([
      { address: ORACLE, day: '2026-09-24', name: 'getPrice', selector: '0x98d5fdca', calls: 14 },
      // A name that is not an identifier is not stored; the selector of a full signature hash is its first four bytes.
      { address: STAKER, day: '2026-09-24', selector: '0x4e71d92d', calls: 9 },
      // The call that carries neither a name nor a selector: one bucket, summed, never dropped.
      { address: STAKER, day: '2026-09-25', calls: 5 },
      { address: STAKER, day: '2026-09-25', selector: '0x8071cdfa', calls: 1 },
      { address: STAKER, day: '2026-09-25', name: 'balanceOf', selector: '0x70a08231', calls: 3_847_006 },
      { address: STAKER, day: '2026-09-25', name: 'loot', calls: 17 },
      { address: STAKER, day: '2026-09-25', name: 'stake', selector: '0xa694fc3a', calls: 1_244 },
      { address: STAKER, day: '2026-09-25', name: 'transfer', selector: '0xa9059cbb', calls: 20_112 },
    ]);
    // A contract nobody asked about, a malformed day and a zero count are all left out.
    expect(result.data.rows.some((row) => row.address === '0x9999999999999999999999999999999999999999')).toBe(false);

    const body = JSON.parse(String(stub.requests[0]!.init!.body)) as { query: string; variables: Record<string, unknown> };
    expect(body.variables).toEqual({ addresses: [STAKER, ORACLE], since: '2026-09-24T00:00:00.000Z', till: '2026-09-25T23:59:59.000Z' });
    expect(body.query).toContain('dataset: realtime');
  });

  it('flags an answer at the row limit as truncated rather than complete', async () => {
    const row = { Block: { Date: '2026-09-25' }, Call: { To: STAKER, Signature: { Name: 'stake', SignatureHash: 'A694FC3A' } }, calls: '1' };
    const body = JSON.stringify({ data: { EVM: { Calls: Array.from({ length: BITQUERY_METHOD_ROW_LIMIT }, () => row) } } });
    const result = await createBitqueryMethodDaysAdapter().fetch({ addresses: [STAKER], ...window, dataset: 'combined', apiKey: 'k' }, testContext({ fetchImpl: stubFetch(json(body)).fetchImpl }));
    expect(hasData(result) && result.data.truncated).toBe(true);
  });

  it('turns a GraphQL error into a typed refusal, and a spent allowance into a rate limit', async () => {
    const outside = JSON.stringify({ errors: [{ message: 'access restricted: your plan only allows "realtime,archive:robinhood:Calls"' }] });
    const refused = await createBitqueryMethodDaysAdapter().fetch({ addresses: [STAKER], ...window, dataset: 'combined', apiKey: 'k' }, testContext({ fetchImpl: stubFetch(json(outside)).fetchImpl }));
    expect(hasData(refused)).toBe(false);
    expect(refused.errorCode).toBe('INVALID_RESPONSE');

    const spent = JSON.stringify({ errors: [{ message: 'points limit exceeded for this billing period' }] });
    const limited = await createBitqueryMethodDaysAdapter().fetch({ addresses: [STAKER], ...window, dataset: 'realtime', apiKey: 'k' }, testContext({ fetchImpl: stubFetch(json(spent)).fetchImpl }));
    expect(limited.status).toBe('rate_limited');
  });

  it('refuses a batch it was not sized for, before any request', () => {
    const adapter = createBitqueryMethodDaysAdapter();
    const many = Array.from({ length: BITQUERY_METHOD_BATCH + 1 }, (_, i) => `0x${i.toString(16).padStart(40, '0')}`);
    expect(adapter.canHandle({ addresses: many, ...window, dataset: 'realtime', apiKey: 'k' })).toBe(false);
    expect(adapter.canHandle({ addresses: [STAKER], ...window, dataset: 'realtime', apiKey: '' })).toBe(false);
    expect(adapter.canHandle({ addresses: [STAKER], since: window.till, till: window.since, dataset: 'realtime', apiKey: 'k' })).toBe(false);
  });

  it('normalises a selector only when it is four bytes or a full hash', () => {
    expect(normalizeSelector('8071CDFA')).toBe('0x8071cdfa');
    expect(normalizeSelector('0xA9059CBB')).toBe('0xa9059cbb');
    expect(normalizeSelector('')).toBeUndefined();
    expect(normalizeSelector('xyz')).toBeUndefined();
    expect(normalizeSelector('1234')).toBeUndefined();
  });
});
