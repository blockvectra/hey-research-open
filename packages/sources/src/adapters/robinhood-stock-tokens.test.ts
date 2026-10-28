import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import {
  createRobinhoodStockAssetsAdapter,
  createRobinhoodStockPriceAdapter,
  stockTokenDecimal,
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

  it('keeps the issuer’s exact multipliers and never defaults an unread one (2026-10-29)', async () => {
    const stub = stubFetch(assets());
    const result = await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl }));
    const bySymbol = Object.fromEntries((result.data ?? []).map((asset) => [asset.symbol, asset]));
    expect(bySymbol['AAPL']).toMatchObject({ multiplierText: '1.000566080061092436' });
    expect(bySymbol['AAPL']).not.toHaveProperty('pendingMultiplierText');
    expect(bySymbol['SPLT']).toMatchObject({ multiplierText: '2.000000000000000000', pendingMultiplierText: '4.000000000000000000' });

    expect(stockTokenDecimal('')).toBeUndefined();
    expect(stockTokenDecimal('0.000000000000000000')).toBeUndefined();
    expect(stockTokenDecimal('-1')).toBeUndefined();
    expect(stockTokenDecimal('1e3')).toBeUndefined();
    expect(stockTokenDecimal(' 1.5 ')).toBe('1.5');
    expect(stockTokenDecimal(2)).toBe('2');

    const missing = stubFetch({ status: 200, body: JSON.stringify({ assets: [{ tokenSymbol: 'NOPE', deployments: [{ contractAddress: '0x7777777777777777777777777777777777777777', chainId: 4663 }] }] }) });
    const bare = await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: missing.fetchImpl }));
    // The price path still assumes one share per token; the stored figure stays unread.
    expect(bare.data?.[0]).toMatchObject({ symbol: 'NOPE', multiplier: 1 });
    expect(bare.data?.[0]).not.toHaveProperty('multiplierText');
    expect(bare.data?.[0]).not.toHaveProperty('tradingCapabilities');
  });

  it('reads tradingCapabilities by session and lot, leaving out what the feed does not state (2026-10-29)', async () => {
    const stub = stubFetch(assets());
    const result = await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: stub.fetchImpl }));
    const bySymbol = Object.fromEntries((result.data ?? []).map((asset) => [asset.symbol, asset]));
    expect(bySymbol['CRM']?.tradingCapabilities).toEqual({
      market: { whole: 'TRADING_STATUS_TRADABLE', fractional: 'TRADING_STATUS_TRADABLE' },
      extended: { whole: 'TRADING_STATUS_TRADABLE', fractional: 'TRADING_STATUS_TRADABLE' },
      overnight: { whole: 'TRADING_STATUS_TRADABLE', fractional: 'TRADING_STATUS_TRADABLE' },
    });
    // SPLT's feed entry states no overnight session at all, and extended fractional as something other than tradable.
    expect(bySymbol['SPLT']?.tradingCapabilities).toEqual({
      market: { whole: 'TRADING_STATUS_TRADABLE', fractional: 'TRADING_STATUS_TRADABLE' },
      extended: { whole: 'TRADING_STATUS_TRADABLE', fractional: 'TRADING_STATUS_UNTRADABLE' },
    });

    const odd = stubFetch({
      status: 200,
      body: JSON.stringify({
        assets: [
          {
            tokenSymbol: 'ODD',
            deployments: [{ contractAddress: '0x8888888888888888888888888888888888888888', chainId: 4663 }],
            tradingCapabilities: { market: { whole: 'trading_status_tradable', fractional: '<script>' }, overnight: null, weekend: { whole: 'TRADING_STATUS_TRADABLE' } },
          },
        ],
      }),
    });
    const read = await adapter.fetch({ chainId: 4663 }, testContext({ fetchImpl: odd.fetchImpl }));
    // Upper-cased; a malformed status and an unknown session are dropped, never guessed.
    expect(read.data?.[0]?.tradingCapabilities).toEqual({ market: { whole: 'TRADING_STATUS_TRADABLE' } });
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
