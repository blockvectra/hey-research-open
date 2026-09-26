import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { formatTerminalPrice } from './format';
import { DRAWN_GLYPHS, Glyph, PriceDigits } from './glyph';

/** Drawn marks and prices (remaining issues, 2026-09-26): no character the site's font lacks reaches the page. */
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('Glyph', () => {
  it('draws every mark it knows as a hidden SVG, with no text in it', () => {
    for (const glyph of DRAWN_GLYPHS) {
      const out = html(createElement(Glyph, { glyph }));
      expect(out.startsWith('<svg'), glyph).toBe(true);
      expect(out).toContain('aria-hidden="true"');
      expect(out.replace(/<[^>]*>/g, ''), glyph).toBe('');
    }
  });

  it('prints a mark it does not know as hidden text, as before', () => {
    expect(html(createElement(Glyph, { glyph: '+' }))).toBe('<span aria-hidden="true">+</span>');
  });
});

describe('PriceDigits', () => {
  it('sets the zero count as a small digit drawn by CSS, in the site font', () => {
    const text = formatTerminalPrice(0.0000254);
    expect(text).toBe('$0.0₄254');
    const out = html(createElement(PriceDigits, { text }));
    expect(out).not.toMatch(/[₀-₉]/);
    expect(out).toContain('data-zeros="4"');
    expect(out).toContain('before:content-[attr(data-zeros)]');
  });

  it('copies and reads as the long decimal, never as a bigger number', () => {
    for (const value of [0.0000254, 0.0000253998, 0.00000000123, 0.0000999]) {
      const text = formatTerminalPrice(value);
      // The element's text: what a copy, innerText or a scraper gets.
      const content = html(createElement(PriceDigits, { text })).replace(/<[^>]*>/g, '');
      expect(content, text).toMatch(/^\$0\.0+\d{3}$/);
      expect(Number(content.slice(1)), text).toBe(Number(value.toPrecision(3)));
    }
  });

  it('leaves a price with no subscript alone', () => {
    expect(html(createElement(PriceDigits, { text: '$1.25' }))).toBe('$1.25');
  });
});
