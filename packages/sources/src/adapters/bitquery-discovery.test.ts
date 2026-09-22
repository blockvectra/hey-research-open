import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createBitqueryDiscoveryAdapter, discoveryQuery, normalizeBitqueryTradedTokens } from './bitquery';

const input = {
  since: new Date('2026-09-05T00:00:00Z'),
  till: new Date('2026-09-12T00:00:00Z'),
  count: 1000,
  offset: 2000,
  apiKey: 'test-token',
};

describe('Bitquery discovery adapter', () => {
  const adapter = createBitqueryDiscoveryAdapter();

  it('pages by offset, a thousand rows at most, and needs a key', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ ...input, count: 1001 })).toBe(false);
    expect(adapter.canHandle({ ...input, offset: -1 })).toBe(false);
    expect(adapter.canHandle({ ...input, apiKey: '' })).toBe(false);
  });

  it('asks for the window and the page, and never for holders or balances', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-traded-tokens.json'), headers: { 'content-type': 'application/json' } });
    await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { query: string; variables: Record<string, unknown> };
    expect(body.variables).toEqual({ since: '2026-09-05T00:00:00.000Z', till: '2026-09-12T00:00:00.000Z', count: 1000, offset: 2000 });
    expect(body.query).not.toMatch(/Balance|Holder|BalanceUpdates/);
    expect(body.query).toContain('count(distinct: Transaction_From)');
  });

  it('groups a token across venues, keeps the busiest venue and the largest trader count, drops junk', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-traded-tokens.json'), headers: { 'content-type': 'application/json' } });
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    const tokens = result.data ?? [];
    expect(tokens.map((token) => token.contractAddress)).toEqual(['0x1937cad42b17d43bb2b347ce16d5288887c46c33', '0x6b09c294ecc9fbe3285f0421eb76ebb6222ade64']);
    expect(tokens[0]).toMatchObject({ symbol: 'ANTHROPICx1L', name: 'Anthropic x1 Long', decimals: 18, trades: 472991, traders: 15534, venue: 'uniswap_v4', venueFamily: 'Uniswap' });
    expect(tokens[0]?.volumeUsd).toBeCloseTo(75026176.5, 1);
    expect(tokens[1]).toMatchObject({ symbol: 'Maple', venue: 'pons_v2', traders: 3643 });
  });
});

describe('the dataset the discovery sweep reads', () => {
  it('spans the chain rather than the last four days', () => {
    /*
     * This is the only chain-wide question HEY asks Bitquery. On `realtime`
     * it asked for seven days of a dataset that holds about four and a half,
     * and realtime does not error when a window reaches past its floor — it
     * returns fewer rows. Three of the seven days did not exist, silently.
     */
    expect(discoveryQuery()).toContain('dataset: combined');
    expect(discoveryQuery('realtime')).toContain('dataset: realtime');
  });

  it('ranks by trade count, because the wider dataset reports no USD', () => {
    /*
     * The trap that makes the dataset switch a real change rather than a flag
     * flip. Measured 2026-09-22 over one window: `realtime` put WETH on top at
     * 2.6e12 USD; `combined` returned `0` for every USD sum and put a token
     * with a single trade on top. Ordering by USD volume on the wider dataset
     * does not lose precision — it inverts the ranking.
     */
    expect(discoveryQuery()).toContain('orderBy: { descendingByField: "trades" }');
    expect(discoveryQuery()).not.toContain('descendingByField: "volume_usd"');
  });

  it('treats a zero USD sum as absent, never as a token that traded for nothing', () => {
    const [token] = normalizeBitqueryTradedTokens([
      {
        Trade: { Currency: { SmartContract: '0xB33eb16782776b4D738c0Fd643577cb0284Db610', Symbol: 'HEY', Name: 'Hey', Decimals: 18 }, Dex: { ProtocolName: 'uniswap_v4', ProtocolFamily: 'Uniswap' } },
        trades: '42',
        volume_usd: '0',
        traders: '7',
      },
    ]);
    expect(token?.trades).toBe(42);
    expect(token?.traders).toBe(7);
    expect(token).not.toHaveProperty('volumeUsd');
  });

  it('still sums a real USD figure when the dataset computes one', () => {
    const [token] = normalizeBitqueryTradedTokens([
      {
        Trade: { Currency: { SmartContract: '0xB33eb16782776b4D738c0Fd643577cb0284Db610', Symbol: 'HEY', Name: 'Hey', Decimals: 18 }, Dex: { ProtocolName: 'uniswap_v4', ProtocolFamily: 'Uniswap' } },
        trades: '42',
        volume_usd: '1250.5',
        traders: '7',
      },
    ]);
    expect(token?.volumeUsd).toBe(1250.5);
  });
});

describe('the slice the sweep asks for', () => {
  it('bounds both ends, because the provider serves only the first ten thousand rows of one', async () => {
    /*
     * Measured 2026-09-22: an offset of 11,000 returns an empty page for a
     * thirty-day window however many tokens the chain holds. The ceiling is
     * per query, so a bounded slice is the only way past it — and at offset
     * 9,500 each weekly slice still returned tokens with 45 to 232 distinct
     * traders, which the single-window form could never have reached.
     */
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-traded-tokens.json'), headers: { 'content-type': 'application/json' } });
    await createBitqueryDiscoveryAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const body = JSON.parse(String(stub.requests[0]?.init?.body)) as { query: string; variables: Record<string, unknown> };
    expect(body.variables.since).toBe('2026-09-05T00:00:00.000Z');
    expect(body.variables.till).toBe('2026-09-12T00:00:00.000Z');
    expect(body.query).toContain('since: $since, till: $till');
  });
});
