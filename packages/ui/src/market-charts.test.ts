import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DailyBarsChart } from './market-charts';

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
