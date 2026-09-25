import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarketChange, changeDirection, describeMarketChange, type MarketChangeProps } from './market-change';

const render = (props: MarketChangeProps) => renderToStaticMarkup(createElement(MarketChange, props));
const spoken = (html: string) => /<span class="sr-only">([^<]*)<\/span>/.exec(html)?.[1];

/**
 * CLAUDE.md UI rule 13 (2026-09-26): a measured move may be green or red, and
 * always carries an arrow, a sign or a word; flat, unknown and stale never
 * take a direction colour.
 */
describe('changeDirection', () => {
  it('decides after rounding to the printed precision', () => {
    expect(changeDirection(4.24)).toBe('up');
    expect(changeDirection(-4.24)).toBe('down');
    expect(changeDirection(-0.04)).toBe('flat');
    expect(changeDirection(0.049)).toBe('flat');
    expect(changeDirection(0)).toBe('flat');
    expect(changeDirection(0.049, 2)).toBe('up');
  });

  it('is unknown for an absent or unmeasurable figure, never flat', () => {
    expect(changeDirection(undefined)).toBe('unknown');
    expect(changeDirection(Number.NaN)).toBe('unknown');
    expect(changeDirection(Number.POSITIVE_INFINITY)).toBe('unknown');
  });
});

describe('MarketChange', () => {
  it('prints up as ▲ and a plus, in the market-up colour', () => {
    const html = render({ pct: 4.24, window: '24h' });
    expect(html).toContain('▲ +4.2%');
    expect(html).toContain('text-market-up');
    expect(html).toContain('data-direction="up"');
    expect(spoken(html)).toBe('up 4.2 percent over 24 hours');
  });

  it('prints down as ▼ and a true minus sign (U+2212), in the market-down colour', () => {
    const html = render({ pct: -4.24, window: '24h' });
    expect(html).toContain('▼ −4.2%');
    expect(html).not.toContain('-4.2');
    expect(html).toContain('text-market-down');
    expect(spoken(html)).toBe('down 4.2 percent over 24 hours');
  });

  it('prints a move that rounds to zero as flat 0.0%, with no arrow', () => {
    for (const pct of [-0.04, 0.049, 0]) {
      const html = render({ pct, window: '24h' });
      expect(html, String(pct)).toContain('>0.0%<');
      expect(html).not.toMatch(/[▲▼]/);
      expect(html).toContain('text-market-flat');
      expect(html).not.toMatch(/text-market-(up|down)/);
      expect(html).toContain('data-direction="flat"');
      expect(spoken(html)).toBe('unchanged over 24 hours');
    }
  });

  it('prints an absent figure as a dash, never 0 and never a direction colour', () => {
    for (const pct of [undefined, Number.NaN]) {
      const html = render({ pct, window: '24h' });
      expect(html).toContain('>—<');
      expect(html).not.toContain('0.0%');
      expect(html).not.toContain('text-market-');
      expect(html).toContain('text-hey-unavailable');
      expect(html).toContain('data-direction="unknown"');
      expect(spoken(html)).toBe('24h change not reported');
    }
  });

  it('keeps the arrow and sign of a stale reading but drops the colour, and says how old it is', () => {
    const html = render({ pct: -11.3, window: '7D', stale: { age: '3d' } });
    expect(html).toContain('▼ −11.3%');
    expect(html).not.toContain('text-market-');
    expect(html).toContain('text-hey-unavailable');
    expect(html).toContain('· 3d old');
    expect(html).toContain('data-stale="true"');
    expect(spoken(html)).toBe('down 11.3 percent over 7 days, reading 3d old');
  });

  it('rounds a move of 100% or more to a grouped integer', () => {
    expect(render({ pct: 1234.56, window: '1Y' })).toContain('▲ +1,235%');
    expect(render({ pct: -100.4, window: '30D' })).toContain('▼ −100%');
  });

  it('prints the window at 12px in secondary, unless asked not to', () => {
    const html = render({ pct: 1, window: '90D' });
    expect(html).toContain('<span aria-hidden="true" class="text-t-meta text-hey-secondary">90D</span>');
    expect(render({ pct: 1, window: '90D', showWindow: false })).not.toContain('>90D<');
  });

  it('takes the requested type step', () => {
    expect(render({ pct: 1, window: '24h' })).toContain('text-t-ui');
    expect(render({ pct: 1, window: '24h', size: 'title' })).toContain('text-t-title');
    expect(render({ pct: 1, window: '24h', size: 'meta' })).toContain('text-t-meta font-medium');
  });

  it('has screen-reader text in every case', () => {
    for (const props of [
      { pct: 4.2, window: '24h' },
      { pct: -4.2, window: 'since event' },
      { pct: 0, window: 'All' },
      { window: 'since event' },
      { pct: 3, window: '30D', stale: { age: '2d' } },
    ] satisfies MarketChangeProps[]) {
      expect(spoken(render(props)), JSON.stringify(props)).toMatch(/\w/);
    }
    expect(describeMarketChange(-4.2, 'since event').spoken).toBe('down 4.2 percent since the event');
    expect(describeMarketChange(undefined, 'since event').spoken).toBe('change since the event not reported');
  });

  it('never reaches for a builder colour', () => {
    for (const pct of [5, -5, 0, undefined]) {
      expect(render({ pct, window: '24h' })).not.toMatch(/accent|status-/);
    }
  });
});

describe('marketWindowPhrase', () => {
  it('speaks the chart readout\'s one-day window', async () => {
    const { marketWindowPhrase } = await import('./market-change');
    expect(marketWindowPhrase('1D')).toBe('over the day');
    // A history shorter than the range names its own span.
    expect(marketWindowPhrase('89D')).toBe('over 89 days');
    expect(describeMarketChange(-8.4, '1D').spoken).toBe('down 8.4 percent over the day');
  });
});
