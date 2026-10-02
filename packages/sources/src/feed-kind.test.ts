import { describe, expect, it } from 'vitest';

import { createFeedAdapter } from './adapters/feed';
import { isCommentEntry, isNotAReleaseFeedUrl } from './feed-kind';
import { extractHtmlMetadata } from './html';
import { stubFetch, testContext } from './testing';

/**
 * What is not a release feed (2026-10-02, outsider audit). The URLs are the
 * production rows: Arcus Perps read DORMANT on a docs sitemap, and Tiny
 * Humans AI's ship log held "Comment on Isometric Smart City by Andrew"
 * (`#comment-4`) read from its comments feed beside its oEmbed card.
 */
describe('isNotAReleaseFeedUrl', () => {
  it('names sitemaps, oEmbed documents and comments feeds', () => {
    for (const url of [
      'https://docs.arcus.xyz/sitemap.xml',
      'https://docs.alphagrid.capital/sitemap.xml',
      'https://example.com/sitemap_index.xml',
      'https://example.com/sitemap-posts.xml',
      'https://tinyhumansworld.com/wp-json/oembed/1.0/embed?url=https%3A%2F%2Ftinyhumansworld.com%2F&format=xml',
      'https://tinyhumansworld.com/comments/feed/',
      'https://memesmanagement.xyz/index.php/comments/feed/',
      'https://example.com/?feed=comments-rss2',
    ]) {
      expect(isNotAReleaseFeedUrl(url), url).toBe(true);
    }
  });

  it('leaves release feeds and changelogs alone', () => {
    for (const url of [
      'https://tinyhumansworld.com/feed/',
      'https://agentos.xyz/changelog.xml',
      'https://blog.example.com/rss.xml',
      'https://github.com/acme/app/releases.atom',
      'https://example.com/blog/sitemap-improvements/',
      'https://example.com/feed/atom/',
    ]) {
      expect(isNotAReleaseFeedUrl(url), url).toBe(false);
    }
    expect(isNotAReleaseFeedUrl(undefined)).toBe(false);
  });
});

describe('isCommentEntry', () => {
  it('names a reader\'s comment by its anchor or WordPress\'s title', () => {
    expect(isCommentEntry({ link: 'https://tinyhumansworld.com/product/isometric-smart-city/#comment-4' })).toBe(true);
    expect(isCommentEntry({ externalId: 'https://auregon.bravisthemes.com/?post_type=product&p=2607#comment-4' })).toBe(true);
    expect(isCommentEntry({ title: 'Comment on Isometric Smart City by Andrew' })).toBe(true);
    expect(isCommentEntry({ title: 'Introducing the Tiny Track & Rewards Board', link: 'https://tinyhumansworld.com/introducing/' })).toBe(false);
  });
});

describe('feed discovery registers release feeds only', () => {
  it('skips a sitemap, an oEmbed card and a comments feed advertised beside the real feed', () => {
    const page = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed/">
      <link rel="alternate" type="application/rss+xml" title="Comments" href="/comments/feed/">
      <link rel="alternate" type="text/xml+oembed" href="/wp-json/oembed/1.0/embed?url=x&amp;format=xml">
      <link rel="alternate" type="application/xml" href="/sitemap.xml">
    </head><body></body></html>`;
    expect(extractHtmlMetadata(page, 'https://tinyhumansworld.com/').feedUrls).toEqual(['https://tinyhumansworld.com/feed/']);
  });

  it('reads a link to a repository\'s releases or tags as that repository, and a file link as nothing', () => {
    const page = `<a href="https://github.com/morpho-org/morpho-blue/releases">Releases</a>
      <a href="https://github.com/acme/sdk/tags">Tags</a>
      <a href="https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/ERC20.sol">ERC20</a>`;
    expect(extractHtmlMetadata(page, 'https://docs.example/').githubUrls).toEqual(['https://github.com/morpho-org/morpho-blue', 'https://github.com/acme/sdk']);
  });
});

describe('the feed adapter', () => {
  const adapter = createFeedAdapter();
  const headers = { 'content-type': 'application/xml' };

  it('refuses a document with neither an RSS nor an Atom root: a sitemap is not a feed HEY read empty', async () => {
    const sitemap = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://docs.arcus.xyz/</loc></url></urlset>';
    const stub = stubFetch({ status: 200, body: sitemap, headers });
    const result = await adapter.fetch({ url: 'https://docs.arcus.xyz/sitemap.xml' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data).toBeUndefined();
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('drops a reader\'s comment from a feed', async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Comments</title>
      <item><title>Comment on Isometric Smart City by Andrew</title><link>https://tinyhumansworld.com/product/isometric-smart-city/#comment-4</link><guid>https://auregon.bravisthemes.com/?p=2607#comment-4</guid><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item>
      <item><title>Introducing the Tiny Track</title><link>https://tinyhumansworld.com/introducing/</link><guid>https://tinyhumansworld.com/?p=13980</guid><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const stub = stubFetch({ status: 200, body: rss, headers: { 'content-type': 'application/rss+xml' } });
    const result = await adapter.fetch({ url: 'https://tinyhumansworld.com/feed/' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.data?.entries.map((entry) => entry.title)).toEqual(['Introducing the Tiny Track']);
  });
});
