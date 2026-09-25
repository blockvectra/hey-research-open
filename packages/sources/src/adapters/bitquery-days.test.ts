import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { ROBINHOOD_QUOTE_ASSETS, createBitqueryChainDaysAdapter, createBitqueryTradeDaysAdapter, normalizeBitqueryTokenDays } from './bitquery-days';

/*
 * Fixtures are hand-built from the shapes the live probe returned on
 * 2026-09-13 (aggregates as strings, one row per token, day and side).
 */
const hey = '0xb33eb16782776b4d738c0fd643577cb0284db610';
const other = '0x1740a3c5b6fb21044df973490b8095439dbb1b07';
const json = (name: string) => ({ status: 200, body: readFixture(name), headers: { 'content-type': 'application/json' } });

describe('Bitquery trade days adapter', () => {
  const adapter = createBitqueryTradeDaysAdapter();
  const input = { addresses: [hey, other], since: new Date('2026-09-10T00:00:00Z'), apiKey: 'test-token' };

  it('posts the addresses and the window as a bearer request, and asks for nothing about accounts', async () => {
    const stub = stubFetch(json('bitquery-trade-days.json'));
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const request = stub.requests[0];
    const headers = request?.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer test-token');
    const body = JSON.parse(String(request?.init?.body)) as { query: string; variables: { addresses: string[]; since: string } };
    expect(body.query).toContain('DEXTradeByTokens');
    expect(body.query).toContain('Transfers');
    /*
     * A count of distinct senders is a count; selecting one is an account
     * (2026-09-15). `count(distinct: Transaction_From)` is how the day learns
     * how many addresses traded, and it returns a number. What must never
     * appear is the field on its own — a selection would put an address in the
     * response (CLAUDE.md product rule 1).
     */
    expect(body.query).not.toMatch(/Balance|Holder|Sender|Receiver/);
    expect(body.query).toContain('count(distinct: Transaction_From)');
    expect(body.query.replace(/count\(distinct: Transaction_From[^)]*\)/g, '')).not.toContain('Transaction_From');
    expect(body.variables.addresses).toEqual([hey, other]);
    expect(body.variables.since).toBe('2026-09-10T00:00:00.000Z');
  });

  it('reads a closed window when given an end, and an open one otherwise (2026-09-25)', async () => {
    const bounded = stubFetch(json('bitquery-trade-days.json'));
    await adapter.fetch({ ...input, till: new Date('2026-09-17T00:00:00Z'), dataset: 'archive' }, testContext({ fetchImpl: bounded.fetchImpl }));
    const body = JSON.parse(String(bounded.requests[0]?.init?.body)) as { query: string; variables: { till?: string } };
    expect(body.variables.till).toBe('2026-09-17T00:00:00.000Z');
    expect(body.query).toContain('$till: DateTime');
    expect(body.query.match(/till: \$till/g)).toHaveLength(2);

    const open = stubFetch(json('bitquery-trade-days.json'));
    await adapter.fetch(input, testContext({ fetchImpl: open.fetchImpl }));
    const openBody = JSON.parse(String(open.requests[0]?.init?.body)) as { query: string; variables: { till?: string } };
    expect(openBody.variables.till).toBeUndefined();
    expect(openBody.query).not.toContain('$till');
  });

  it('asks each side for the block of its last trade, beside that trade\'s price', async () => {
    const stub = stubFetch(json('bitquery-trade-days.json'));
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { query: string };
    expect(body.query).toContain('Block { Date lastBlock: Number(maximum: Block_Number) }');
    expect(body.query).toContain('close: PriceInUSD(maximum: Block_Number)');
  });

  it('folds side rows into one row per token and day, closes on the side that traded last, and drops a malformed day', async () => {
    const stub = stubFetch(json('bitquery-trade-days.json'));
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    const rows = result.data!;
    expect(rows.map((row) => `${row.contractAddress}:${row.day}`)).toEqual([`${other}:2026-09-12`, `${hey}:2026-09-10`, `${hey}:2026-09-11`, `${hey}:2026-09-12`]);
    const day = rows.find((row) => row.contractAddress === hey && row.day === '2026-09-12')!;
    // The day ended on a buy (block 48120377, after the last sell at 48119902): its price is the close.
    expect(day).toMatchObject({ trades: 447, buys: 231, sells: 216, buyVolumeUsd: 18250.5, sellVolumeUsd: 17100.25, closeUsd: 0.0125, transfers: 1204 });
    // And a day that ended on a sell closes on the sell, whichever row came first.
    expect(rows.find((row) => row.contractAddress === hey && row.day === '2026-09-11')).toMatchObject({ trades: 208, buys: 120, sells: 88, closeUsd: 0.0117 });
    // A day with transfers but no trades is still a day.
    expect(rows.find((row) => row.contractAddress === hey && row.day === '2026-09-10')).toMatchObject({ trades: 0, transfers: 7 });
    expect(rows.find((row) => row.day === 'not-a-day')).toBeUndefined();
  });

  it('compares blocks, not row order, and keeps the sell close only when no side says when it traded (2026-09-25)', () => {
    const row = (side: 'buy' | 'sell', close: string, lastBlock?: string) => ({
      Block: { Date: '2026-09-12', ...(lastBlock === undefined ? {} : { lastBlock }) },
      Trade: { Currency: { SmartContract: hey }, Side: { Type: side }, close },
      trades: '1',
      volume_usd: '1',
    });
    const closeOf = (rows: ReturnType<typeof row>[]) => normalizeBitqueryTokenDays(rows, [])[0]?.closeUsd;
    // Sell listed first, buy later in the chain: the buy closes the day in either order.
    expect(closeOf([row('sell', '2', '100'), row('buy', '3', '101')])).toBe(3);
    expect(closeOf([row('buy', '3', '101'), row('sell', '2', '100')])).toBe(3);
    // A side that carries its block beats one that does not.
    expect(closeOf([row('sell', '2'), row('buy', '3', '101')])).toBe(3);
    expect(closeOf([row('buy', '3', '101'), row('sell', '2')])).toBe(3);
    // Neither carries one: the old rule, the sell side's price.
    expect(closeOf([row('buy', '3'), row('sell', '2')])).toBe(2);
    expect(closeOf([row('sell', '2'), row('buy', '3')])).toBe(2);
  });

  it('refuses more than a batch, a bad address or no key', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ ...input, apiKey: '' })).toBe(false);
    expect(adapter.canHandle({ ...input, addresses: ['x'] })).toBe(false);
  });
});

describe('Bitquery chain days adapter', () => {
  const adapter = createBitqueryChainDaysAdapter();

  it('reads the chain day by day and prices volume only against the known quote assets', async () => {
    const stub = stubFetch(json('bitquery-chain-days.json'));
    const result = await adapter.fetch({ since: new Date('2026-09-10T00:00:00Z'), apiKey: 'test-token' }, testContext({ fetchImpl: stub.fetchImpl }));
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { variables: { quotes: string[] } };
    expect(body.variables.quotes).toEqual([...ROBINHOOD_QUOTE_ASSETS]);
    expect(hasData(result)).toBe(true);
    expect(result.data).toEqual([
      { day: '2026-09-11', dexTrades: 9155148, poolsTraded: 32204, tokensTraded: 45661, dexVolumeUsd: 2101602451.214927, transactions: 10273729 },
      { day: '2026-09-12', dexTrades: 7512133, poolsTraded: 23911, tokensTraded: 36445, dexVolumeUsd: 951204644.2529359, transactions: 7941445, transfers: 10819312 },
    ]);
  });
});
