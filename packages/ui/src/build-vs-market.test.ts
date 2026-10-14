import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BuildVsMarketChart, type ScatterDatum } from './charts';

/**
 * Under the Radar is the rule's, not the quadrant's (2026-10-14, Pulse repair).
 *
 * Production stored 18 projects under the rule; the chart's tinted top-left
 * quadrant, labelled "Under the radar", held about 3 of them. A point the rule
 * holds is ringed where it sits, the caption says how many of the rule's
 * projects are drawn, and no quadrant carries the badge's name.
 */
const point = (over: Partial<ScatterDatum>): ScatterDatum => ({
  slug: 'pare',
  name: 'Pare',
  activityStatus: 'SHIPPING',
  buildMomentum: 50,
  marketAttention: 20,
  ...over,
});

describe('Build vs Market rings what the Under the Radar rule holds', () => {
  it('rings a held point wherever it sits, and never names a quadrant after the badge', () => {
    const html = renderToStaticMarkup(
      createElement(BuildVsMarketChart, {
        data: [
          // Held, but bottom-right by position: ringed, not moved.
          point({ slug: 'held', name: 'Held', buildMomentum: 35, marketAttention: 80, underTheRadar: true }),
          // Top-left by position, not held: not ringed.
          point({ slug: 'topleft', name: 'Top left', buildMomentum: 90, marketAttention: 5 }),
        ],
        underTheRadarTotal: 1,
      }),
    );
    expect(html.match(/data-under-the-radar="true"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/project\/held"[^>]*data-under-the-radar="true"/);
    expect(html).not.toMatch(/href="\/project\/topleft"[^>]*data-under-the-radar/);
    expect(html).toContain("Held: Shipping, Build Momentum 35, market attention high, Under the Radar by HEY&#x27;s rule");
    expect(html).not.toContain('>Under the radar<');
    expect(html).toContain('More momentum than attention');
    expect(html).toContain('Ringed: the project HEY&#x27;s Under the Radar rule holds today.');
  });

  it('says how many of the rule’s projects are drawn when the chart cannot place them all', () => {
    const html = renderToStaticMarkup(
      createElement(BuildVsMarketChart, {
        data: [point({ underTheRadar: true }), point({ slug: 'b', name: 'B', underTheRadar: true })],
        underTheRadarTotal: 18,
      }),
    );
    expect(renderToStaticMarkup(createElement(BuildVsMarketChart, { data: [point({ underTheRadar: true }), point({ slug: 'b', underTheRadar: true })], underTheRadarTotal: 2 }))).toContain(
      'Ringed: the 2 projects HEY&#x27;s Under the Radar rule holds today, all drawn.',
    );
    expect(html).toContain('Ringed: 2 of the 18 projects HEY&#x27;s Under the Radar rule holds today; the rest lack a reading the chart needs to place them.');
  });

  it('says so when no project meets the rule', () => {
    const html = renderToStaticMarkup(createElement(BuildVsMarketChart, { data: [point({})], underTheRadarTotal: 0 }));
    expect(html).toContain('No project meets it today.');
    expect(html).not.toContain('data-under-the-radar');
  });
});
