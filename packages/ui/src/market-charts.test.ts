import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { formatTokenPrice, tokenPriceSpeech } from './format';
import { ChartPanel, DailyBarsChart, DailyLineChart } from './market-charts';

const points = [
  { day: '2026-10-01', value: 7_000 },
  { day: '2026-10-02', value: 7_400 },
  { day: '2026-10-03', value: 1_200 },
];

const render = (partialDay?: string) => renderToStaticMarkup(createElement(DailyBarsChart, { points, label: 'DEX trades', partialDay }));

/**
 * The day in progress (full audit, 2026-10-03): /pulse drew today's few hours of trades and ships as
 * a full bar beside complete days, unmarked, while the launches chart beside them hatched its backfill.
 */
describe('DailyBarsChart: the day still being counted', () => {
  it('hatches and outlines that bar, names it in the legend, the title and the summary', () => {
    const html = render('2026-10-03');
    expect(html.match(/data-partial=""/g)).toHaveLength(1);
    expect(html).toContain('data-testid="daily-bar-partial"');
    expect(html).toContain('border-dashed');
    expect(html).toContain('repeating-linear-gradient');
    expect(html).toContain('data-testid="daily-bars-partial-legend"');
    expect(html).toContain('today so far');
    expect(html).toContain('2026-10-03 1,200 (today so far, still being counted)');
    expect(html).toContain('title="2026-10-03: 1,200 — today so far, still being counted"');
  });

  it('marks nothing when no day is partial, or the partial day is not drawn', () => {
    for (const html of [render(), render('2026-10-04')]) {
      expect(html).not.toContain('data-partial');
      expect(html).not.toContain('today so far');
      expect(html).not.toContain('border-dashed');
    }
  });
});

/** Audit #166 (2026-10-16): `$0.0₄314` has no spoken meaning; read as "$0.04314" it is 1,000× too high. */
describe('a subscript price, spoken in full', () => {
  it('speaks and titles the full figure only where the printed one carries a subscript', () => {
    expect(formatTokenPrice(0.0000314)).toBe('$0.0₄314');
    expect(tokenPriceSpeech(0.0000314)).toBe('$0.0000314');
    expect(tokenPriceSpeech(0.0123)).toBeUndefined();
    expect(tokenPriceSpeech(2.5)).toBeUndefined();
  });

  it('labels the chart and the panel figure with the spoken form, and hides the printed one from speech', () => {
    const prices = [
      { day: '2026-10-14', value: 0.0000501 },
      { day: '2026-10-15', value: 0.0000309 },
      { day: '2026-10-16', value: 0.0000314 },
    ];
    const chart = renderToStaticMarkup(createElement(DailyLineChart, { points: prices, label: 'Price', format: formatTokenPrice, speak: tokenPriceSpeech }));
    expect(chart).toContain('aria-label="Price by day: 2026-10-14 $0.0000501; 2026-10-15 $0.0000309; 2026-10-16 $0.0000314"');
    expect(chart).toContain('<p aria-hidden="true"');
    const panel = renderToStaticMarkup(
      createElement(ChartPanel, { label: 'Price', value: '$0.0₄314', valueSpeech: '$0.0000314', children: null }),
    );
    expect(panel).toContain('<span aria-hidden="true">$0.0₄314</span><span class="sr-only">$0.0000314</span>');
  });
});
