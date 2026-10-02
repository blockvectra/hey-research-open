import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { BITQUERY_POINTS } from './bitquery';
import { ROBINHOOD_QUOTE_ASSETS } from './bitquery-days';
import { BITQUERY_OHLC_QUERY, BITQUERY_OHLC_ROW_LIMIT, createBitqueryOhlcAdapter } from './bitquery-ohlc';

/*
 * The fixture is hand-built in the shape every Bitquery aggregate answers in
 * (aggregates as strings or numbers, one row per token and bucket), with the
 * rows a careful reader must drop: a duplicate bucket, a zero low, an
 * off-quarter bucket, a malformed time and a malformed address.
 */
const hey = '0xb33eb16782776b4d738c0fd643577cb0284db610';
const other = '0x1740a3c5b6fb21044df973490b8095439dbb1b07';
const json = (body: string) => ({ status: 200, body, headers: { 'content-type': 'application/json' } });
const input = { addresses: [hey, other], since: new Date('2026-10-03T10:00:00Z'), till: new Date('2026-10-03T11:07:00Z'), apiKey: 'test-token' };

describe('Bitquery intraday bars adapter', () => {
  const adapter = createBitqueryOhlcAdapter();

  it('asks one realtime cube for quarter-hour buckets of trades against the quote assets, and nothing about accounts', async () => {
    const stub = stubFetch(json(readFixture('bitquery-intraday-bars.json')));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const request = stub.requests[0];
    expect((request?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer test-token');
    const body = JSON.parse(String(request?.init?.body)) as { query: string; variables: { addresses: string[]; quotes: string[]; since: string; till: string } };
    expect(body.query).toBe(BITQUERY_OHLC_QUERY);
    expect(body.query).toContain('dataset: realtime');
    expect(body.query.match(/DEXTradeByTokens/g)).toHaveLength(1);
    expect(body.query).toContain('Time(interval: { in: minutes, count: 15 })');
    expect(body.query).toContain('Side: { Currency: { SmartContract: { in: $quotes } } }');
    expect(body.query).not.toMatch(/Transaction_From|Balance|Holder|Sender|Receiver|Buyer|Seller/);
    expect(body.variables).toEqual({ addresses: [hey, other], quotes: [...ROBINHOOD_QUOTE_ASSETS], since: '2026-10-03T10:00:00.000Z', till: '2026-10-03T11:07:00.000Z' });
    // One realtime cube: five points, whatever it returns.
    expect(result.meteredUnits).toBe(BITQUERY_POINTS.perRealtimeCube);
  });

  it('keeps a bar per token and bucket, widens high and low to the open and close, keeps an unknown volume unknown, and drops what is not a bar', async () => {
    const stub = stubFetch(json(readFixture('bitquery-intraday-bars.json')));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    const { bars, rows, truncated } = result.data!;
    expect(rows).toBe(9);
    expect(truncated).toBe(false);
    expect(bars.map((bar) => `${bar.contractAddress.slice(0, 6)}@${bar.start.toISOString().slice(11, 16)}`)).toEqual(['0x1740@10:30', '0xb33e@10:00', '0xb33e@10:15', '0xb33e@10:45']);
    expect(bars[1]).toMatchObject({ openUsd: 0.012, closeUsd: 0.0124, highUsd: 0.0126, lowUsd: 0.0119, trades: 41, volumeUsd: 1830.5 });
    // The provider's high (0.0129) sat under its own close (0.0130): the bar holds its close.
    const late = bars[3]!;
    expect(late.highUsd).toBe(0.013);
    // A volume the provider did not give is absent, never zero.
    expect(late.volumeUsd).toBeUndefined();
    // The duplicate 10:45 row (another casing) is dropped, the first kept; a zero low is a gap, not a bar.
    expect(bars.filter((bar) => bar.start.toISOString().endsWith('10:45:00.000Z'))).toHaveLength(1);
    expect(bars.some((bar) => bar.start.toISOString().endsWith('11:00:00.000Z'))).toBe(false);
  });

  it('says when an answer filled the row limit, so a cut answer is never stored as whole', async () => {
    const row = { Block: { bucket: '2026-10-03T10:00:00Z' }, Trade: { Currency: { SmartContract: hey }, open: 1, close: 1, high: 1, low: 1 }, trades: 1, volume_usd: 1 };
    const full = JSON.stringify({ data: { EVM: { bars: Array.from({ length: BITQUERY_OHLC_ROW_LIMIT }, () => row) } } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stubFetch(json(full)).fetchImpl }));
    expect(result.data?.truncated).toBe(true);
  });

  it('turns a GraphQL error into a typed source error, and a spent allowance into a rate limit', async () => {
    const invalid = await adapter.fetch(input, testContext({ fetchImpl: stubFetch(json(JSON.stringify({ errors: [{ message: 'Cannot query field "bucket"' }] }))).fetchImpl }));
    expect(invalid.status).toBe('error');
    expect(invalid.errorCode).toBe('INVALID_RESPONSE');
    const spent = await adapter.fetch(input, testContext({ fetchImpl: stubFetch(json(JSON.stringify({ errors: [{ message: 'points limit exceeded' }] }))).fetchImpl }));
    expect(spent.errorCode).toBe('RATE_LIMITED');
  });

  it('refuses a batch over a hundred, a malformed address and an empty window', () => {
    const many = Array.from({ length: 101 }, (_, k) => `0x${k.toString(16).padStart(40, '0')}`);
    expect(adapter.canHandle({ ...input, addresses: many })).toBe(false);
    expect(adapter.canHandle({ ...input, addresses: ['0x123'] })).toBe(false);
    expect(adapter.canHandle({ ...input, till: input.since })).toBe(false);
    expect(adapter.canHandle(input)).toBe(true);
  });
});
