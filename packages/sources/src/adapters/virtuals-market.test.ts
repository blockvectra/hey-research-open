import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  VIRTUALS_MARKET_BATCH_SIZE,
  createVirtualsMarketAdapter,
  virtualsMarketUrl,
} from './virtuals-market';

const addresses = [
  '0x38845010568e5e32aba47c0f934db2bdb866e8b1',
  '0x1263b82fe1345e5552b991a3607007d9b519e833',
  '0x8f548b7de6d2ec5d5714938bf2addf7484790ecb',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
];
const input = { chainId: 4663, addresses };
const page = () => ({ status: 200, body: readFixture('virtuals-market.json') });

describe('Virtuals market adapter', () => {
  const adapter = createVirtualsMarketAdapter();

  it('takes a bounded batch of well-formed addresses', () => {
    expect(adapter.canHandle(input)).toBe(true);
    expect(adapter.canHandle({ chainId: 4663, addresses: [] })).toBe(false);
    expect(adapter.canHandle({ chainId: 4663, addresses: ['AOS'] })).toBe(false);
    const many = Array.from({ length: VIRTUALS_MARKET_BATCH_SIZE + 1 }, () => addresses[0]!);
    expect(adapter.canHandle({ chainId: 4663, addresses: many })).toBe(false);
  });

  it('filters by chain and by either token address in one request', async () => {
    const stub = stubFetch(page());
    await adapter.fetch({ chainId: 4663, addresses: addresses.slice(0, 1) }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe(
      'https://api.virtuals.io/api/virtuals?filters%5Bchain%5D=ROBINHOOD&pagination%5BpageSize%5D=50' +
        '&filters%5B%24or%5D%5B0%5D%5BpreToken%5D%5B%24in%5D%5B0%5D=0x38845010568e5e32aba47c0f934db2bdb866e8b1' +
        '&filters%5B%24or%5D%5B1%5D%5BtokenAddress%5D%5B%24in%5D%5B0%5D=0x38845010568e5e32aba47c0f934db2bdb866e8b1',
    );
    // Addresses are sent lowercase whatever the caller passed.
    expect(virtualsMarketUrl('https://x.test/api', ['0xABCDEF0000000000000000000000000000000000'])).toContain(
      '=0xabcdef0000000000000000000000000000000000',
    );
  });

  it('carries the curve valuation in VIRTUAL and the pool liquidity in USD, keyed by address', async () => {
    const stub = stubFetch(page());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    const byAddress = Object.fromEntries((result.data ?? []).map((r) => [r.contractAddress, r]));
    expect(byAddress['0x38845010568e5e32aba47c0f934db2bdb866e8b1']).toMatchObject({
      chainId: 4663,
      agentId: 'b16c2828-3eff-4c09-a9b5-45368e447acb',
      pageUrl: 'https://app.virtuals.io/virtuals/138766',
      graduated: false,
      mcapInVirtual: 8571.320995327775,
      fdvInVirtual: 8643.240424025,
      liquidityUsd: 11729,
    });
  });

  it('keys a graduated agent by its token, not its pre-token', async () => {
    const stub = stubFetch(page());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const graduated = result.data?.find((r) => r.contractAddress === '0x2222222222222222222222222222222222222222');
    expect(graduated).toMatchObject({ graduated: true, mcapInVirtual: 150000.5 });
    expect(result.data?.some((r) => r.contractAddress === '0x1111111111111111111111111111111111111111')).toBe(false);
  });

  it('drops agents on another chain even when the provider returns them', async () => {
    const stub = stubFetch(page());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.some((r) => r.contractAddress === '0x3333333333333333333333333333333333333333')).toBe(false);
  });

  it('records an agent without figures as present but unknown', async () => {
    const stub = stubFetch(page());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const curveless = result.data?.find((r) => r.contractAddress === '0x4444444444444444444444444444444444444444');
    expect(curveless).toBeDefined();
    expect(curveless).not.toHaveProperty('mcapInVirtual');
    expect(curveless).not.toHaveProperty('liquidityUsd');
  });

  it('never carries holder data, even though the payload has it', async () => {
    expect(readFixture('virtuals-market.json')).toContain('holderCount');
    const stub = stubFetch(page());
    const result = await adapter.fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    for (const reading of result.data ?? []) {
      expect(Object.keys(reading).join(' ')).not.toMatch(/holder/i);
    }
  });

  it('ignores addresses it did not ask for', async () => {
    const stub = stubFetch(page());
    const result = await adapter.fetch(
      { chainId: 4663, addresses: [addresses[0]!] },
      testContext({ fetchImpl: stub.fetchImpl }),
    );
    expect(result.data?.map((r) => r.contractAddress)).toEqual([addresses[0]]);
  });
});
