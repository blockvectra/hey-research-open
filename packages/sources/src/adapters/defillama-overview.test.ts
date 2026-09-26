import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { createDefillamaOverviewAdapter, defillamaOverviewUrl, DEFILLAMA_OVERVIEW_METRICS } from './defillama-overview';

/*
 * Fixtures: the live chain overviews of 2026-09-27, trimmed to a handful of
 * protocol rows (the chain's own row and the null-figure rows kept on purpose).
 */
const JSON_HEADERS = { 'content-type': 'application/json' };
const fixtureFor = { fees: 'defillama-overview-fees.json', revenue: 'defillama-overview-revenue.json', dexs: 'defillama-overview-dexs.json' } as const;

describe('DefiLlama chain overviews (Protocol Economics)', () => {
  const adapter = createDefillamaOverviewAdapter();

  it('asks for the right endpoint per metric, charts excluded, revenue by data type', () => {
    expect(defillamaOverviewUrl({ chain: 'Robinhood Chain', metric: 'fees' })).toBe(
      'https://api.llama.fi/overview/fees/Robinhood%20Chain?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true',
    );
    expect(defillamaOverviewUrl({ chain: 'Robinhood Chain', metric: 'revenue' })).toContain('/overview/fees/Robinhood%20Chain?');
    expect(defillamaOverviewUrl({ chain: 'Robinhood Chain', metric: 'revenue' })).toContain('dataType=dailyRevenue');
    expect(defillamaOverviewUrl({ chain: 'Robinhood Chain', metric: 'dexs' })).toContain('/overview/dexs/Robinhood%20Chain?');
    expect(adapter.canHandle({ chain: ' ', metric: 'fees' })).toBe(false);
    expect(adapter.canHandle({ chain: 'Robinhood Chain', metric: 'tvl' as never })).toBe(false);
  });

  it.each(DEFILLAMA_OVERVIEW_METRICS)('parses the %s overview: the chain row is not a protocol, and a null figure is not zero', async (metric) => {
    const stub = stubFetch({ status: 200, body: readFixture(fixtureFor[metric]), headers: JSON_HEADERS });
    const result = await adapter.fetch({ chain: 'Robinhood Chain', metric }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(hasData(result)).toBe(true);
    const bySlug = Object.fromEntries((result.data?.protocols ?? []).map((row) => [row.slug, row]));
    expect(bySlug['robinhood-chain']).toBeUndefined();
    // brownfi-v3 is listed with `total24h: null`: no figure, never 0.
    expect(bySlug['brownfi-v3']).toBeDefined();
    expect(bySlug['brownfi-v3']).not.toHaveProperty('total24hUsd');
    expect(bySlug['giga-v3']?.total24hUsd).toBeGreaterThan(0);
    expect(bySlug['giga-v3']?.defillamaId).toBe('8256');
    expect(bySlug['giga-v3']?.methodologyUrl).toMatch(/^https:\/\/github\.com\/DefiLlama\/dimension-adapters/);
  });

  it('keeps a measured zero as zero', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('defillama-overview-revenue.json'), headers: JSON_HEADERS });
    const result = await adapter.fetch({ chain: 'Robinhood Chain', metric: 'revenue' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.protocols.find((row) => row.slug === 'morpho-blue')?.total24hUsd).toBe(0);
  });

  it('refuses an overview for another chain, and a body that is not JSON', async () => {
    const other = stubFetch({ status: 200, body: JSON.stringify({ chain: 'Base', protocols: [] }), headers: JSON_HEADERS });
    expect((await adapter.fetch({ chain: 'Robinhood Chain', metric: 'fees' }, testContext({ fetchImpl: other.fetchImpl }))).errorCode).toBe('INVALID_RESPONSE');
    const html = stubFetch({ status: 200, body: '<html></html>', headers: { 'content-type': 'text/html' } });
    expect((await adapter.fetch({ chain: 'Robinhood Chain', metric: 'fees' }, testContext({ fetchImpl: html.fetchImpl }))).errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');
  });

  it('costs one malformed row, never the overview, and drops negative or non-numeric figures', async () => {
    const body = JSON.stringify({
      chain: 'Robinhood Chain',
      protocols: [
        { slug: 'good', name: 'Good', total24h: 12.5, defillamaId: 1 },
        { slug: 7, name: 'Bad' },
        { slug: 'negative', name: 'Negative', total24h: -4 },
        { slug: 'text', name: 'Text', total24h: 'n/a' },
      ],
    });
    const stub = stubFetch({ status: 200, body, headers: JSON_HEADERS });
    const result = await adapter.fetch({ chain: 'Robinhood Chain', metric: 'dexs' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.protocols).toEqual([
      { slug: 'good', name: 'Good', defillamaId: '1', total24hUsd: 12.5 },
      { slug: 'negative', name: 'Negative' },
      { slug: 'text', name: 'Text' },
    ]);
  });

  it('refuses a body past its cap rather than buffering it', async () => {
    const stub = stubFetch({ status: 200, body: '{}', headers: { ...JSON_HEADERS, 'content-length': String(64 * 1024 * 1024) } });
    const result = await adapter.fetch({ chain: 'Robinhood Chain', metric: 'fees' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.errorCode).toBe('TOO_LARGE');
  });
});
