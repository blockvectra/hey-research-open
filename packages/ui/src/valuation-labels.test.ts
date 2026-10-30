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

  it('never draws an unmeasured Build Momentum as 0: the point is left out and counted (2026-10-09 red-team F4)', () => {
    const html = renderToStaticMarkup(
      createElement(BuildVsMarketChart, { data: [point({}), point({ slug: 'unread', name: 'Unread', activityStatus: 'UNKNOWN', buildMomentum: null })] }),
    );
    expect(html).not.toContain('Unread');
    expect(html).not.toContain('Build Momentum 0');
    expect(html).toContain('1 project is not placed: Build Momentum not measured.');
  });
});

/**
 * The map prints no valuation at all since 2026-10-30 (V2 phase 6): its figure was ungated by UI rule 3's R5, and the
 * page says the market takes no part in the picture. Its tooltip names the ships the circle is sized by instead.
 */
describe('the map tooltip', () => {
  it('names no valuation, of any kind, whatever the node was read with', () => {
    const node = { slug: 'vex', name: 'ProjectVex', activityStatus: 'ACTIVE' as const, countedShips: 3 };
    const read = { ...node, marketCapUsd: 3_400_000, valuationKind: 'fdv' };
    const text = mapNodeTooltip(read, NOW);
    expect(text).toContain('3 counted ships in 8 weeks');
    expect(text).not.toMatch(/valuation|market cap|\$3\.4M/i);
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
