import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  createRobinhoodStockAssetsAdapter,
  createRobinhoodStockPriceAdapter,
  stockTokenPriceUsd,
} from './robinhood-stock-tokens';

const assets = () => ({ status: 200, body: readFixture('robinhood-stock-assets.json') });
const price = () => ({ status: 200, body: readFixture('robinhood-stock-price.json') });

describe('Robinhood stock token assets adapter', () => {
  const adapter = createRobinhoodStockAssetsAdapter();

  it('reads the issuer asset list without a key', async () => {
    const stub = stubFetch(assets());
    await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.robinhood.com/rhj/assets');
  });

  it('keeps the deployment on the requested chain, lowercase, with its multiplier', async () => {
    const stub = stubFetch(assets());
    const result = await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    const bySymbol = Object.fromEntries((result.data ?? []).map((asset) => [asset.symbol, asset]));
    expect(bySymbol['CRM']).toMatchObject({
      chainId: 4663,
      contractAddress: '0xd95b44124e475743a7589e68f3d74008a5536d44',
      name: 'Salesforce • Robinhood Token',
      multiplier: 1,
      status: 'ASSET_STATUS_ACTIVE',
      decimals: 18,
    });
    expect(bySymbol['CRM']?.logoUrl).toMatch(/^https:\/\/cdn\.robinhood\.com\//);
    expect(bySymbol['CRM']).not.toHaveProperty('pendingMultiplier');
    expect(bySymbol['SPLT']).toMatchObject({ multiplier: 2, pendingMultiplier: 4 });
    expect(bySymbol['SPLT']).not.toHaveProperty('logoUrl');
  });

  it('drops assets that are not deployed on the requested chain', async () => {
    const stub = stubFetch(assets());
    const result = await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.map((asset) => asset.symbol).sort()).toEqual(['AAPL', 'CRM', 'SPLT']);

    const elsewhere = await adapter.fetch({ chainId: 42161 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(elsewhere.data?.map((asset) => asset.symbol)).toEqual(['OTHR']);
  });

  it('rejects a payload without the assets list', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify([]) });
    const result = await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});

describe('Robinhood stock token price adapter', () => {
  const adapter = createRobinhoodStockPriceAdapter();

  it('accepts equity symbols only', () => {
    expect(adapter.canHandle({ chainId: 4663, symbol: 'AAPL' })).toBe(true);
    expect(adapter.canHandle({ chainId: 4663, symbol: 'BRK.B' })).toBe(true);
    expect(adapter.canHandle({ chainId: 4663, symbol: 'aapl' })).toBe(false);
    expect(adapter.canHandle({ chainId: 4663, symbol: '../assets' })).toBe(false);
  });

  it('uses the path form of the endpoint', async () => {
    const stub = stubFetch(price());
    await adapter.fetch({ chainId: 4663, symbol: 'AAPL' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(stub.requests[0]?.url).toBe('https://api.robinhood.com/rhj/prices/AAPL');
  });

  it('carries the raw underlying bid and ask, the mid and the deployment', async () => {
    const stub = stubFetch(price());
    const result = await adapter.fetch({ chainId: 4663, symbol: 'AAPL' }, testContext({ fetchImpl: stub.fetchImpl }));

    expect(hasData(result)).toBe(true);
    expect(result.data).toMatchObject({
      symbol: 'AAPL',
      contractAddress: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9',
      bid: 324.69,
      ask: 324.83,
      mid: 324.76,
      currency: 'USD',
      tradingHalted: false,
      sourceUrl: 'https://api.robinhood.com/rhj/prices/AAPL',
    });
    expect(result.data?.generatedAt?.toISOString()).toBe('2026-09-03T04:05:00.614Z');
  });

  it('treats an empty or foreign quote list as no reading', async () => {
    const stub = stubFetch({ status: 200, body: JSON.stringify({ quotes: [] }) });
    const result = await adapter.fetch({ chainId: 4663, symbol: 'AAPL' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(false);
    expect(result.status).toBe('error');
  });
});

describe('per-token USD price', () => {
  it('applies the shares-per-token multiplier to the underlying mid', () => {
    expect(stockTokenPriceUsd({ mid: 324.76, currency: 'USD' }, { multiplier: 1 })).toBe(324.76);
    expect(stockTokenPriceUsd({ mid: 100, currency: 'USD' }, { multiplier: 2 })).toBe(200);
  });

  it('refuses to guess for a non-USD quote', () => {
    expect(stockTokenPriceUsd({ mid: 100, currency: 'EUR' }, { multiplier: 1 })).toBeUndefined();
  });
});
