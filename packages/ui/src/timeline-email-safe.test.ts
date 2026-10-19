import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { readableSummary } from './format';
import { BuildTimeline, ShipSummary } from './timeline';

/**
 * A ship's stored text never reaches the HTML e-mail-shaped (FE-1, 2026-10-12).
 *
 * Release notes and titles say `@scope/pkg@1.2.3` and `npm install
 * @piprail/x@0.1.0`; Cloudflare's e-mail obfuscation rewrote those in the
 * HTML of seven project pages — minified error #418 and "[email protected]"
 * for every reader without the blocked decoder. The timeline and the latest
 * ship card draw this text, so every text node they put in the HTML is held.
 */
const NOW = new Date('2026-10-12T10:00:00Z');
const textNodes = (markup: string): string[] => markup.split(/<[^>]*>/).filter(Boolean);
const EMAIL_SHAPED = /\S@[\w-]+\.\w/;

describe('the build timeline keeps stored text out of reach of e-mail obfuscation', () => {
  it('title, summary, code-week highlights and the substance note', () => {
    const markup = renderToStaticMarkup(
      createElement(BuildTimeline, {
        now: NOW,
        items: [
          {
            id: 'a',
            title: '@acme/pkg@0.5.0',
            summary: 'npm install @acme/pkg@0.5.0 and write to a@b.co',
            eventType: 'RELEASE',
            publishedAt: new Date('2026-10-11T10:00:00Z'),
            verificationStatus: 'PUBLICLY_VERIFIED',
            highlights: [{ text: 'bump @acme/core@1.2.3', href: 'https://github.com/acme/pkg/commit/1' }, { text: 'thanks ops@acme.dev' }],
            substanceNote: 'Read from dev@acme.dev.',
          },
        ],
      }),
    );
    expect(markup).toContain('@acme/pkg@');
    expect(textNodes(markup).filter((text) => EMAIL_SHAPED.test(text))).toEqual([]);
  });

  it('a summary as one line and as points behind "Show all"', () => {
    for (const summary of ['Published @d20dao/sdk@0.1.0.', `- @graphitti/core@1.0.0\n- @graphitti/hub@2.0.0\n- ${'long words '.repeat(40)}`]) {
      const markup = renderToStaticMarkup(createElement(ShipSummary, { summary: readableSummary(summary) }));
      expect(markup).toContain('@');
      expect(textNodes(markup).filter((text) => EMAIL_SHAPED.test(text))).toEqual([]);
    }
  });
});

describe('the build timeline names each evidence link (2026-10-19)', () => {
  it('says which ship and that the link opens a new tab', () => {
    const markup = renderToStaticMarkup(
      createElement(BuildTimeline, {
        now: NOW,
        items: [
          {
            id: 'b',
            title: 'Agent SDK v0.4',
            summary: 'Release.',
            eventType: 'RELEASE',
            publishedAt: new Date('2026-10-11T10:00:00Z'),
            verificationStatus: 'PUBLICLY_VERIFIED',
            sourceUrl: 'https://github.com/acme/sdk/releases/tag/v0.4',
          },
        ],
      }),
    );
    expect(markup).toContain('View evidence<span class="sr-only">: Agent SDK v0.4 (opens in a new tab)</span>');
  });
});
