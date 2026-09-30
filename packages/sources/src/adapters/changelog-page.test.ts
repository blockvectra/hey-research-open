import { describe, expect, it } from 'vitest';

import { hasData } from '../adapter';
import { readFixture, stubFetch, testContext } from '../testing';
import { dateInText, isHtmlPage, parseChangelogPage } from './changelog-page';
import { createFeedAdapter } from './feed';

/**
 * An HTML changelog page read as dated entries (2026-09-30): only a heading
 * that states a date is an entry, and only a CHANGELOG source reads HTML so.
 */
describe('an HTML changelog page', () => {
  const html = readFixture('changelog-page.html');
  const url = 'https://neon.example/changelog#top';

  it('turns each dated release heading into an entry, and skips the undated ones', () => {
    const entries = parseChangelogPage(html, url);
    expect(entries.map((entry) => [entry.title, entry.publishedAt?.toISOString().slice(0, 10)])).toEqual([
      ['v1.4.0 — 2026-09-12', '2026-09-12'],
      // The date from the section's <time datetime>.
      ['v1.3.0', '2026-08-30'],
      ['September 2, 2026 — Docs refresh', '2026-09-02'],
      // "Coming soon" has no date and is not an entry; the section's first line dates v1.2.0.
      ['v1.2.0', '2026-07-14'],
      // A future date is kept here; ship ingestion skips it like an undated entry.
      ['v9.0.0 — 2031-01-01', '2031-01-01'],
    ]);
  });

  it('keys an entry on the page and the heading’s anchor, never on the fragment it was read with', () => {
    const [first, second] = parseChangelogPage(html, url);
    expect(first).toMatchObject({ externalId: 'https://neon.example/changelog#v1-4-0', link: 'https://neon.example/changelog#v1-4-0' });
    expect(first?.summary).toContain('Released the vault migration tool.');
    expect(second?.summary).toContain('Launched staking rewards dashboard & new SDK release.');
    const [, , third] = parseChangelogPage(html, url);
    // No id: the anchor is the heading's slug, the link the page itself.
    expect(third).toMatchObject({ externalId: 'https://neon.example/changelog#september-2-2026-docs-refresh', link: 'https://neon.example/changelog' });
  });

  it('reads calendar dates in the forms changelogs use, and refuses impossible ones', () => {
    expect(dateInText('Released 2026-09-12')?.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    expect(dateInText('Sept. 3rd, 2026')?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    expect(dateInText('3 September 2026')?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    expect(dateInText('2026/02/30')).toBeUndefined();
    expect(dateInText('v1.2.3')).toBeUndefined();
  });

  it('knows an HTML page from a feed', () => {
    expect(isHtmlPage(html)).toBe(true);
    expect(isHtmlPage(readFixture('feed-rss.xml'))).toBe(false);
  });

  it('stays linear on hostile markup: unclosed headings and a flood of tags', () => {
    const hostile = `<html><body>${'<h2 '.repeat(20_000)}${'<h2>2026-09-01</h2><p>x</p>'.repeat(200)}</body></html>`;
    const started = Date.now();
    const entries = parseChangelogPage(hostile, 'https://neon.example/changelog');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(entries.length).toBeLessThanOrEqual(50);
  });
});

describe('the feed reader on a changelog source', () => {
  it('reads an HTML changelog page only when told the source is a CHANGELOG page', async () => {
    const html = readFixture('changelog-page.html');
    const stub = stubFetch({ status: 200, body: html, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const asChangelog = await createFeedAdapter().fetch({ url: 'https://neon.example/changelog', changelogPage: true }, testContext({ fetchImpl: stub.fetchImpl, lookupImpl: async () => ['93.184.216.34'] }));
    expect(hasData(asChangelog)).toBe(true);
    expect(asChangelog.data?.entries.length).toBe(5);

    const asFeed = await createFeedAdapter().fetch({ url: 'https://neon.example/changelog' }, testContext({ fetchImpl: stub.fetchImpl, lookupImpl: async () => ['93.184.216.34'] }));
    // Any other caller never mistakes a page for a feed.
    expect(asFeed.data?.entries ?? []).toEqual([]);
  });

  it('still reads a real feed at a changelog source as a feed', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('feed-rss.xml'), headers: { 'content-type': 'application/rss+xml' } });
    const result = await createFeedAdapter().fetch({ url: 'https://neon.example/changelog.xml', changelogPage: true }, testContext({ fetchImpl: stub.fetchImpl, lookupImpl: async () => ['93.184.216.34'] }));
    expect(hasData(result)).toBe(true);
    expect(result.data?.entries.length).toBeGreaterThan(0);
  });
});
