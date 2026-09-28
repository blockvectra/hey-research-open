import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { readableSummary, shortenHexInText, truncateAtWord } from './format';
import { BuildTimeline } from './timeline';

/** One sanitiser for the builder story's ship summaries (public UX review, 2026-09-28). */
describe('readableSummary', () => {
  const hash = '0x8d039b0cd5cf1ba9ba3cbdcdcc6b2cb6a81e9692254a0d81ba52013e28261c2a';
  const address = '0x604f247c496049ffe05e603a87fcd7926a3c9fb9';

  it('turns inline bullets into points and shortens hashes and addresses', () => {
    const summary = readableSummary(`cCATCH joins the record. - cCATCH: ${address} - Launch transaction: ${hash} - All components verified.`);
    expect(summary?.items).toEqual(['cCATCH joins the record.', 'cCATCH: 0x604f…9fb9', 'Launch transaction: 0x8d03…1c2a', 'All components verified.']);
    expect(summary?.short).toBe('cCATCH joins the record. · cCATCH: 0x604f…9fb9 · Launch transaction: 0x8d03…1c2a · All components verified.');
    expect(summary?.truncated).toBe(false);
    expect(summary?.short).not.toContain(' - ');
  });

  it('keeps a hyphenated word and a date as written', () => {
    expect(readableSummary('Read-only tools for 2026-09 - see docs')?.items).toEqual(['Read-only tools for 2026-09', 'see docs']);
  });

  it('cuts at a word with one ellipsis, never mid-word', () => {
    const summary = readableSummary('word '.repeat(100), { max: 40 });
    expect(summary?.truncated).toBe(true);
    expect(summary?.short).toBe('word word word word word word word word…');
    expect(summary!.short.length).toBeLessThanOrEqual(40);
  });

  it('drops the fragment the store cut at 600 characters and says there is more', () => {
    const stored = `${'Public source record for all families. '.repeat(15)}And Sourci`.padEnd(600, 'x').replace(/x+$/, '');
    expect(stored.length).toBe(595);
    // A stored cut lands at the cap, give or take the trimmed space.
    const atCap = `${stored}fyxxx`;
    expect(atCap.length).toBe(600);
    const summary = readableSummary(atCap, { max: 1000 });
    expect(summary?.truncated).toBe(true);
    expect(summary?.short.endsWith('And…')).toBe(true);
    expect(summary?.short).not.toContain('Sourci');
    // Short of the cap, the text is whole and nothing is dropped.
    expect(readableSummary(stored, { max: 1000 })?.short.endsWith('And Sourci')).toBe(true);
    expect(summary?.items.at(-1)?.endsWith('…')).toBe(true);
  });

  it('is nothing for nothing', () => {
    expect(readableSummary(undefined)).toBeUndefined();
    expect(readableSummary('   ')).toBeUndefined();
  });
});

describe('the build timeline draws summaries through the sanitiser', () => {
  it('shows points, short hex and a way to the whole text', () => {
    const html = renderToStaticMarkup(
      createElement(BuildTimeline, {
        now: new Date('2026-09-28T12:00:00Z'),
        items: [
          {
            id: 's1',
            title: 'Catch Family V1 — cCATCH source record',
            summary: 'cCATCH joins the record. - cCATCH: 0x604f247c496049ffe05e603a87fcd7926a3c9fb9 - Launch block: 57602365',
            eventType: 'GITHUB_RELEASE',
            publishedAt: new Date('2026-09-09T12:00:00Z'),
            verificationStatus: 'PUBLICLY_VERIFIED',
          },
        ],
      }),
    );
    expect(html).toContain('0x604f…9fb9');
    expect(html).not.toContain('0x604f247c496049ffe05e603a87fcd7926a3c9fb9');
    expect(html).not.toContain(' - ');
    expect(html).toContain('Show all');
    expect(html).toContain('<li>Launch block: 57602365</li>');
    expect(html).not.toContain('overflow-wrap:anywhere');
  });
});

describe('truncateAtWord and shortenHexInText', () => {
  it('leaves short text alone', () => {
    expect(truncateAtWord('Release v0.2.14', 28)).toEqual({ text: 'Release v0.2.14', truncated: false, atWord: true });
  });

  it('never leaves a separator before the ellipsis', () => {
    expect(truncateAtWord('Catch Family V1 — cCATCH source record', 20).text).toBe('Catch Family V1…');
  });

  it('says when a single long token had to be cut', () => {
    expect(truncateAtWord('a'.repeat(50), 10).atWord).toBe(false);
  });

  it('shortens only hex long enough to be a hash or an address', () => {
    expect(shortenHexInText('fee 0x1f bps, pool 0x1f0d000000000000000000000000000000000abc')).toBe('fee 0x1f bps, pool 0x1f0d…0abc');
  });
});
