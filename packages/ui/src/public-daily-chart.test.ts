import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { candleOfMarketDay, PublicDailyCandleChart, PUBLIC_SHIP_FAMILY } from './public-daily-chart';
import type { CandleDay, ChartEvent } from './terminal-chart';

type Props = Parameters<typeof PublicDailyCandleChart>[0];

const TODAY = '2026-09-20';
const render = (props: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(PublicDailyCandleChart, { days: DAYS, todayUtc: TODAY, now: new Date(`${TODAY}T12:00:00Z`), ...props }));

/** The `<g>` of one day's candle, or undefined when that day draws nothing. */
const candle = (html: string, day: string) => new RegExp(`<g data-day="${day}"[^>]*>(.*?)</g>`).exec(html)?.[0];

/*
 * Four days: up, down, a doji, then a gap (17th not read), then a close-only
 * trade day, then today (still open).
 */
const DAYS: CandleDay[] = [
  { day: '2026-09-14', open: 1, high: 1.3, low: 0.9, close: 1.2, readings: 4, ohlcSource: 'price' },
  { day: '2026-09-15', open: 1.2, high: 1.25, low: 1, close: 1.05, readings: 4, ohlcSource: 'price' },
  { day: '2026-09-16', open: 1.05, high: 1.1, low: 1, close: 1.05, readings: 3, ohlcSource: 'price' },
  // 2026-09-17: not read.
  { day: '2026-09-18', close: 1.1, readings: 2, ohlcSource: 'trade' },
  { day: '2026-09-19', open: 1.1, high: 1.15, low: 1.05, close: 1.12, readings: 3, ohlcSource: 'price' },
  { day: TODAY, open: 1.12, high: 1.2, low: 1.1, close: 1.18, readings: 1, ohlcSource: 'price' },
];

const SHIPS: ChartEvent[] = [
  { id: 'ship:00000000-0000-4000-8000-000000000001', at: '2026-09-15T14:30:00Z', title: 'Agent SDK v0.4', family: PUBLIC_SHIP_FAMILY.key, precision: 'EXACT', href: '/evidence/ship:00000000-0000-4000-8000-000000000001' },
  { id: 'ship:00000000-0000-4000-8000-000000000002', at: '2026-09-18T00:00:00Z', title: 'Docs rewrite', family: PUBLIC_SHIP_FAMILY.key, precision: 'DATE' },
  // Before the range: no marker.
  { id: 'ship:00000000-0000-4000-8000-000000000003', at: '2026-08-01T10:00:00Z', title: 'Old release', family: PUBLIC_SHIP_FAMILY.key, precision: 'EXACT' },
];

describe('PublicDailyCandleChart (CLAUDE.md UI rule 13)', () => {
  it('colours an up candle with --hey-market-up and a down candle with --hey-market-down', () => {
    const html = render();
    expect(candle(html, '2026-09-14')).toContain('fill="var(--hey-market-up)"');
    expect(candle(html, '2026-09-14')).not.toContain('--hey-market-down');
    expect(candle(html, '2026-09-15')).toContain('fill="var(--hey-market-down)"');
    expect(candle(html, '2026-09-15')).not.toContain('--hey-market-up');
  });

  it('draws a doji in --hey-market-flat and never green or red', () => {
    const doji = candle(render(), '2026-09-16')!;
    expect(doji).toContain('var(--hey-market-flat)');
    expect(doji).not.toMatch(/--hey-market-(up|down)/);
  });

  it('draws nothing for a day HEY did not read, and says gaps are not zero', () => {
    const html = render();
    expect(candle(html, '2026-09-17')).toBeUndefined();
    expect(html).toContain('Missing days are gaps, not zero.');
    expect(html).toContain('Not read by HEY: a gap, not zero');
  });

  it('gives a close-only day and today no direction colour', () => {
    const html = render();
    expect(candle(html, '2026-09-18')).not.toMatch(/--hey-market-(up|down)/);
    const today = candle(html, TODAY)!;
    expect(today).not.toMatch(/--hey-market-(up|down)/);
    expect(today).toContain('fill="none"');
  });

  it('turns every direction colour off on a stale series, and says why', () => {
    const html = render({ stale: { reason: 'HEY has no reading of this market in the last week.' } });
    expect(html).not.toMatch(/--hey-market-(up|down)/);
    expect(candle(html, '2026-09-14')).toContain('fill="none"');
    expect(html).toContain('Colours are off: HEY has no reading of this market in the last week.');
  });

  it('draws no candle at all on a withheld series', () => {
    const html = render({ withheld: 'HEY marked this market’s readings as implausible, so its prices are not charted.' });
    expect(html).not.toMatch(/--hey-market-(up|down|flat)/);
    expect(html).not.toContain('<svg');
    expect(html).toContain('data-testid="public-daily-chart-withheld"');
    expect(html).toContain('so its prices are not charted');
  });

  it('labels both axes with the unit and its kind', () => {
    const html = render({ symbol: '$AOS' });
    expect(html).toContain('Price (US dollars per $AOS)');
    expect(html).toContain('Date (UTC day)');
    expect(html).toContain('Price only — the valuation is not drawn.');
    // Price ticks on the axis, date ticks under it.
    expect(html).toMatch(/\$1\.\d\d<\/span>/);
    expect(html).toContain('14 Sep');
  });

  it('says what each colour means in words, with an arrow', () => {
    const html = render();
    expect(html).toContain('▲ Green: close above open');
    expect(html).toContain('▼ Red: close below open');
    expect(html).toContain('Grey: unchanged');
  });

  it('carries every day in a screen-reader table with open, high, low, close and the direction in words', () => {
    const html = render();
    // Hidden by a block wrapper, never by a class on the table: a table ignores the 1px box and widened the page (2026-10-02).
    const table = /<div class="sr-only"><table data-testid="public-daily-chart-table">[\s\S]*<\/table><\/div>/.exec(html)![0];
    expect(table).toContain('<th scope="col">Open</th>');
    expect(table).toContain('Open $1.00');
    expect(table).toContain('High $1.30');
    expect(table).toContain('Low $0.9');
    expect(table).toContain('Close $1.20');
    expect(table).toContain('Up: close above open');
    expect(table).toContain('Down: close below open');
    expect(table).toContain('Unchanged: close equals open');
    expect(table).toContain('Today so far: no direction');
  });

  it('marks ships by date, says "Shipped", links the evidence, and drops ships outside the range', () => {
    const html = render({ ships: SHIPS });
    const marks = html.match(/data-testid="public-daily-chart-ship"[^>]*data-day="([^"]+)"/g) ?? [];
    expect(marks).toHaveLength(2);
    expect(html).toContain('data-day="2026-09-15"');
    expect(html).toContain('aria-label="Shipped: Agent SDK v0.4 — 15 September 2026, 14:30 UTC"');
    expect(html).toContain('href="/evidence/ship:00000000-0000-4000-8000-000000000001"');
    expect(html).toContain('Shipped: Docs rewrite');
    expect(html).not.toContain('Old release');
    expect(html).toContain('never a cause');
    // A marker never takes a market colour.
    const lane = /data-testid="public-daily-chart-ships"[\s\S]*?<\/div>/.exec(html)![0];
    expect(lane).not.toMatch(/--hey-market-/);
  });

  it('shows an honest empty state with fewer than two priced days', () => {
    const html = render({ days: [{ day: '2026-09-19', readings: 2 }] });
    expect(html).toContain('data-testid="public-daily-chart-empty"');
    expect(html).toContain('No daily readings yet');
    expect(html).not.toContain('<svg');
  });

  it('names the figure by its heading', () => {
    const html = render();
    expect(html).toMatch(/<figure[^>]*aria-labelledby="daily-candles-heading"/);
    expect(html).toContain('id="daily-candles-heading"');
    expect(html).toMatch(/role="img" aria-label="Daily candles, US dollars per token, 2026-09-14 to 2026-09-20\./);
  });
});

describe('candleOfMarketDay', () => {
  it('takes the four prices from the price series', () => {
    expect(candleOfMarketDay({ day: '2026-09-14', priceOpenUsd: 1, priceHighUsd: 2, priceLowUsd: 0.5, priceCloseUsd: 1.5, readings: 3 })).toMatchObject({ open: 1, close: 1.5, ohlcSource: 'price' });
  });

  it('keeps a trade close alone, and calls it mixed beside price fields', () => {
    expect(candleOfMarketDay({ day: '2026-09-14', tradeCloseUsd: 1.1, readings: 1 })).toMatchObject({ close: 1.1, ohlcSource: 'trade' });
    expect(candleOfMarketDay({ day: '2026-09-14', tradeCloseUsd: 1.1, priceOpenUsd: 1, readings: 1 })).toMatchObject({ ohlcSource: 'mixed' });
    expect(candleOfMarketDay({ day: '2026-09-14', readings: 2 }).close).toBeUndefined();
  });
});
