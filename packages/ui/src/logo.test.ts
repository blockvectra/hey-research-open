import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { BRAND_MARKS } from './brand';
import { HeyLogo } from './logo';

/**
 * Every page's response preloaded both header marks, one of them display:none (2026-10-24 full audit,
 * PERF-6). React preloads an eager <img> unless it is `fetchPriority="low"`, so the dark twin carries it.
 */
describe('HeyLogo', () => {
  it('leaves the dark mark out of the preload', () => {
    const html = renderToStaticMarkup(createElement(HeyLogo));
    const dark = html.match(new RegExp(`<img[^>]*${BRAND_MARKS.heyDark.replace(/\./g, '\\.')}[^>]*>`))?.[0] ?? '';
    const light = html.match(new RegExp(`<img[^>]*${BRAND_MARKS.hey.replace(/\./g, '\\.')}[^>]*>`))?.[0] ?? '';
    expect(dark).toMatch(/fetchPriority="low"/i);
    expect(light).not.toMatch(/fetchPriority/i);
  });
});
