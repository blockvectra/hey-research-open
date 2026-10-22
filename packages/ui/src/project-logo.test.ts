import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { isDrawableLogo, MONOGRAM_PALETTE, ProjectLogo } from './project-logo';

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

/** WEB-9 (2026-10-22): white initials on Research Blue 500 measured 3.56:1, on the infrastructure violet 4.4:1. */
// The open-source subset carries packages/ui without apps/web, so the check runs where the stylesheet is.
const GLOBALS_CSS = fileURLToPath(new URL('../../../apps/web/src/app/globals.css', import.meta.url));
describe.skipIf(!existsSync(GLOBALS_CSS))('the monogram palette', () => {
  const css = existsSync(GLOBALS_CSS) ? readFileSync(GLOBALS_CSS, 'utf8') : '';
  const hexOf = (background: string): string => {
    const arbitrary = /^bg-\[(#[0-9a-f]{6})\]$/i.exec(background);
    if (arbitrary) return arbitrary[1]!;
    const token = new RegExp(`--color-${background.slice(3)}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
    if (!token) throw new Error(`no colour for ${background}`);
    return token[1]!;
  };
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };

  it('gives white initials 4.5:1 on every tile', () => {
    for (const entry of MONOGRAM_PALETTE) {
      const background = entry.split(' ').find((name) => name.startsWith('bg-'))!;
      expect(entry, background).toContain('text-white');
      expect(1.05 / (luminance(hexOf(background)) + 0.05), background).toBeGreaterThanOrEqual(4.5);
    }
  });
});
