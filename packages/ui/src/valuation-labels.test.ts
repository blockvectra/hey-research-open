import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuildVsMarketChart, type ScatterDatum } from './charts';
import { valuationKindLabel } from './format';
import { mapNodeTooltip } from './map';
import { DrawdownChart, drawdownMeasure } from './project-visuals';

/**
 * "Market cap" is never printed over a fully diluted valuation (audit A5-04,
 * A10-07; 2026-09-25). The cards stopped on 2026-09-25; the Pulse tooltip,
 * the map and the Still Building chart had not.
 */
const NOW = new Date('2026-09-25T12:00:00Z');

describe('valuationKindLabel', () => {
  it('names each kind, and claims neither when the kind is unknown', () => {
    expect(valuationKindLabel('fdv')).toBe('Fully diluted valuation');
    expect(valuationKindLabel('marketCap')).toBe('Market cap');
    expect(valuationKindLabel(undefined)).toBe('Valuation');
    expect(valuationKindLabel(null)).toBe('Valuation');
  });
});

describe('the Pulse chart tooltip', () => {
  const point = (over: Partial<ScatterDatum>): ScatterDatum => ({
    slug: 'pare',
    name: 'Pare',
    activityStatus: 'SHIPPING',
    buildMomentum: 50,
    marketAttention: 20,
    marketCapUsd: 4_227_632,
    ...over,
  });

  it('calls an FDV a fully diluted valuation, never a market cap', () => {
    const html = renderToStaticMarkup(createElement(BuildVsMarketChart, { data: [point({ valuationKind: 'fdv' })] }));
    expect(html).toContain('Fully diluted valuation $4.2M');
    expect(html).not.toContain('Market cap $4.2M');
  });

  it('keeps "Market cap" for a circulating figure, and says unavailable without one', () => {
    expect(renderToStaticMarkup(createElement(BuildVsMarketChart, { data: [point({ valuationKind: 'marketCap' })] }))).toContain('Market cap $4.2M');
    const { marketCapUsd: _drop, ...rest } = point({});
    expect(renderToStaticMarkup(createElement(BuildVsMarketChart, { data: [rest] }))).toContain('Valuation not available');
  });
});

describe('the map tooltip', () => {
  it('names the measure', () => {
    const node = { slug: 'vex', name: 'ProjectVex', activityStatus: 'ACTIVE' as const, marketCapUsd: 3_400_000 };
    expect(mapNodeTooltip({ ...node, valuationKind: 'fdv' }, NOW)).toContain('Fully diluted valuation $3.4M');
    expect(mapNodeTooltip({ ...node, valuationKind: 'marketCap' }, NOW)).toContain('Market cap $3.4M');
    expect(mapNodeTooltip(node, NOW)).toContain('Valuation $3.4M');
    expect(mapNodeTooltip({ ...node, valuationKind: 'fdv' }, NOW)).not.toContain('Market cap');
  });
});

describe('the Still Building chart', () => {
  it('titles the line by the measure it is drawn in', () => {
    expect(drawdownMeasure([{ fullyDiluted: true }, { fullyDiluted: true }])).toBe('Fully diluted valuation');
    expect(drawdownMeasure([{ fullyDiluted: false }, { fullyDiluted: false }])).toBe('Market cap');
    expect(drawdownMeasure([{ fullyDiluted: true }, { fullyDiluted: false }])).toBe('Valuation');
    expect(drawdownMeasure([{}, {}])).toBe('Valuation');
  });

  it('never says "Market capitalisation" over fully diluted days', () => {
    const history = [
      { observedAt: new Date('2026-09-01T00:00:00Z'), marketCapUsd: 100, fullyDiluted: true },
      { observedAt: new Date('2026-09-10T00:00:00Z'), marketCapUsd: 40, fullyDiluted: true },
    ];
    const html = renderToStaticMarkup(createElement(DrawdownChart, { history, ships: [] }));
    expect(html).toContain('Fully diluted valuation over time');
    expect(html).not.toContain('Market capitalisation');
  });
});
