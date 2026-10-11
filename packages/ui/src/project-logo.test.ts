import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { isDrawableLogo, ProjectLogo } from './project-logo';

/**
 * A reader's browser loads a project logo only from HEY (FE-5, 2026-10-12).
 *
 * A crawl of 400 production pages found 13 `<img src="https://<owner's host>…">`
 * — every reader's address and user agent handed to a project owner's server,
 * and an image beside HEY's verdicts the owner could swap at will. The web
 * layer proxies the hosts it vets; `ProjectLogo` draws nothing else, so a page
 * that forgets to ask the proxy shows the monogram, never a hot-link.
 */
const draw = (logoUrl: string | null) => renderToStaticMarkup(createElement(ProjectLogo, { name: 'Talis Markets', slug: 'talis', logoUrl }));

describe('ProjectLogo', () => {
  it('draws the monogram, and no image, for a logo on any other host', () => {
    for (const url of ['https://www.usetalis.markets/icons/apple-touch-icon.png', 'http://tappy.site/logo.png', '//rhdex.site/logo.png', '/\\evil.example/x.png']) {
      const markup = draw(url);
      expect(markup, url).not.toContain('<img');
      expect(markup, url).toContain('TM');
    }
  });

  it("draws the proxy's image, HEY's own asset and inline data", () => {
    for (const url of ['/api/logo?u=https%3A%2F%2Fcdn.dexscreener.com%2Fx.png&s=88', '/apple-icon.png?5a71', 'data:image/png;base64,iVBORw0KGgo=']) {
      expect(draw(url), url).toContain(`src="${url.replace(/&/g, '&amp;')}"`);
    }
  });

  it('never puts a src off the origin into the HTML', () => {
    const markup = ['https://a.example/x.png', '/api/logo?u=x&s=88', null].map(draw).join('');
    expect([...markup.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((match) => match[1]).filter((src) => /^(https?:)?\/\//.test(src!))).toEqual([]);
  });
});

describe('isDrawableLogo', () => {
  it('accepts a same-origin path or inline image data only', () => {
    expect(isDrawableLogo('/api/logo?u=x&s=88')).toBe(true);
    expect(isDrawableLogo('data:image/webp;base64,AAAA')).toBe(true);
    expect(isDrawableLogo('https://heyresearch.xyz/apple-icon.png')).toBe(false);
    expect(isDrawableLogo('data:text/html,<script>')).toBe(false);
    expect(isDrawableLogo('//evil.example/x.png')).toBe(false);
    expect(isDrawableLogo('')).toBe(false);
    expect(isDrawableLogo(null)).toBe(false);
  });
});
