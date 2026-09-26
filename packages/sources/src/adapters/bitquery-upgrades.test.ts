import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { BITQUERY_UPGRADES_QUERY, createBitqueryUpgradesAdapter } from './bitquery-upgrades';

const PROXY = '0x9d2ed15300000000000000000000000000000001';
const BEACON_PROXY = '0x5f10a1f6a2b1b0e3c1d7c6c4b0e0f2a1d3c549c3';

describe('bitquery upgrade events (2026-09-26)', () => {
  it('reads Upgraded and BeaconUpgraded logs in chain order, with their evidence', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-upgrade-events.json'), headers: { 'content-type': 'application/json' } });
    const result = await createBitqueryUpgradesAdapter().fetch({ addresses: [PROXY, BEACON_PROXY], apiKey: 'k' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    if (!hasData(result)) return;
    // Two upgrades of one proxy, both kept; a beacon change with and without its argument.
    expect(result.data.map((event) => [event.address, event.event, event.blockNumber, event.logIndex])).toEqual([
      [BEACON_PROXY, 'BeaconUpgraded', 1_200_000, 0],
      [BEACON_PROXY, 'BeaconUpgraded', 1_200_500, 1],
      [PROXY, 'Upgraded', 3_120_441, 4],
      [PROXY, 'Upgraded', 5_102_200, 2],
    ]);
    expect(result.data[0]).toMatchObject({ beacon: '0xe10b6f6b00000000000000000000000000001b00', occurredAt: new Date('2026-06-02T10:00:00Z') });
    // An argument the cube did not decode is unknown, never a zero address.
    expect(result.data[1]).not.toHaveProperty('beacon');
    expect(result.data[3]).toMatchObject({ implementation: '0x2222222222222222222222222222222222222222', txHash: '0x9d2ed1530000000000000000000000000000000000000000000000000000a002' });
  });

  it('drops a log with no time and a contract nobody asked about', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('bitquery-upgrade-events.json'), headers: { 'content-type': 'application/json' } });
    const result = await createBitqueryUpgradesAdapter().fetch({ addresses: [BEACON_PROXY], apiKey: 'k' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result) && result.data.every((event) => event.address === BEACON_PROXY && event.blockNumber !== 1_200_600)).toBe(true);
  });

  it('asks the archive through the combined dataset, for the Events cube only', () => {
    expect(BITQUERY_UPGRADES_QUERY).toContain('dataset: combined');
    expect(BITQUERY_UPGRADES_QUERY).toMatch(/\bEvents\s*\(/);
    expect(BITQUERY_UPGRADES_QUERY).not.toMatch(/\b(Transfers|Transactions|DEXPoolEvents|BalanceUpdates)\s*\(/);
    // Accounts are never selected: no sender, no caller.
    expect(BITQUERY_UPGRADES_QUERY).not.toMatch(/\bFrom\b/);
  });
});
