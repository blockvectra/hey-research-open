import { describe, expect, it } from 'vitest';

import { createFeedAdapter } from './adapters/feed';
import { REPLACEMENT_CHARACTER } from './html';
import { readFixture, stubFetch, testContext } from './testing';
import { MAX_XML_CHARS, parseBoundedXml, XML_PARSER_LIMITS, XmlTooLargeError } from './xml';

/**
 * XML parser limits, pinned (2026-09-27, audit G S9, brief §47). The limits
 * used to be `fast-xml-parser`'s defaults; a dependency bump could have
 * loosened them. These tests hold HEY's own values and the behaviour they buy.
 */
describe('XML parser limits', () => {
  it('pins entities off, the declaration caps and the depth', () => {
    expect(XML_PARSER_LIMITS).toEqual({
      maxNestedTags: 64,
      processEntities: {
        enabled: false,
        maxEntityCount: 64,
        maxEntitySize: 1024,
        maxExpansionDepth: 1,
        maxTotalExpansions: 1,
        maxExpandedLength: 1024,
      },
      htmlEntities: false,
    });
    expect(MAX_XML_CHARS).toBe(2 * 1024 * 1024);
  });

  it('leaves a billion-laughs document inert: nothing is expanded, and it parses at once', () => {
    const started = performance.now();
    const document = parseBoundedXml(readFixture('feed-billion-laughs.xml'));
    expect(performance.now() - started).toBeLessThan(200);
    const title = ((document.rss as Record<string, unknown>).channel as Record<string, unknown>).title;
    expect(title).toBe('Laughs &lol9;');
    expect(JSON.stringify(document).length).toBeLessThan(4_096);
  });

  it('refuses a document nested deeper than the cap', () => {
    const deep = `${'<a>'.repeat(XML_PARSER_LIMITS.maxNestedTags + 5)}x${'</a>'.repeat(XML_PARSER_LIMITS.maxNestedTags + 5)}`;
    expect(() => parseBoundedXml(deep)).toThrow();
  });

  it('refuses an oversized sitemap before parsing it', () => {
    const entry = '<url><loc>https://bomb.example/page</loc></url>';
    const sitemap = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entry.repeat(
      Math.ceil((MAX_XML_CHARS + 1) / entry.length),
    )}</urlset>`;
    const started = performance.now();
    expect(() => parseBoundedXml(sitemap)).toThrow(XmlTooLargeError);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('parses a sitemap within the cap', () => {
    const document = parseBoundedXml(
      '<?xml version="1.0"?><urlset><url><loc>https://ok.example/a</loc></url><url><loc>https://ok.example/b</loc></url></urlset>',
    );
    expect(((document.urlset as Record<string, unknown>).url as unknown[]).length).toBe(2);
  });
});

describe('feed adapter under the pinned limits', () => {
  const adapter = createFeedAdapter();
  const fetchFeed = (body: string, url = 'https://laughs.example/feed.xml') =>
    adapter.fetch({ url }, testContext({ fetchImpl: stubFetch({ status: 200, body, headers: { 'content-type': 'application/rss+xml' } }).fetchImpl }));

  it('reads the billion-laughs feed as text: entities stay literal, XML escapes decode, the overflow clamps', async () => {
    const result = await fetchFeed(readFixture('feed-billion-laughs.xml'));
    expect(result.status).toBe('fresh');
    expect(result.data?.feedTitle).toBe('Laughs &lol9;');
    expect(result.data?.entries[0]).toMatchObject({
      externalId: 'laughs-1',
      title: 'Release &lol9; &plain;',
      link: 'https://laughs.example/release?a=1&b=2',
      summary: `Send your API key ${REPLACEMENT_CHARACTER} to & fro`,
    });
  });

  it('decodes attribute values it no longer gets decoded: an Atom href with &amp;', async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title><entry><title>Post</title><id>tag:a,2026:1</id><link rel="alternate" href="/posts?id=1&amp;lang=en" /><updated>2026-08-28T16:00:00Z</updated></entry></feed>`;
    const result = await adapter.fetch(
      { url: 'https://atom.example/feed.xml' },
      testContext({ fetchImpl: stubFetch({ status: 200, body: atom, headers: { 'content-type': 'application/atom+xml' } }).fetchImpl }),
    );
    expect(result.data?.entries[0]?.link).toBe('https://atom.example/posts?id=1&lang=en');
  });

  it('reports an oversized feed body as too large without parsing it', async () => {
    const body = `<rss><channel>${'<item><title>x</title><guid>g</guid></item>'.repeat(60_000)}</channel></rss>`;
    const result = await fetchFeed(body);
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('TOO_LARGE');
  });
});
