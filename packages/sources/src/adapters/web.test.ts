import { describe, expect, it } from 'vitest';

import { extractHtmlMetadata, sanitizeText } from '../html';
import { readFixture, stubFetch, testContext } from '../testing';
import { createFeedAdapter } from './feed';
import { createWebsiteAdapter, hashContent } from './website';

const html = () => ({
  status: 200,
  body: readFixture('website-home.html'),
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

describe('HTML metadata extraction', () => {
  it('decodes entities and strips markup from text', () => {
    expect(sanitizeText('<b>Agent</b>OS &amp; tools')).toBe('Agent OS & tools');
  });

  it('extracts title, description and Open Graph fields', () => {
    const meta = extractHtmlMetadata(readFixture('website-home.html'), 'https://agentos.xyz/');

    expect(meta.title).toBe('AgentOS — Autonomous agents for Robinhood Chain');
    expect(meta.description).toBe('Agent infrastructure & tooling.');
    expect(meta.ogTitle).toBe('AgentOS');
    expect(meta.canonicalUrl).toBe('https://agentos.xyz/');
  });

  it('discovers feeds and resolves relative hrefs against the page URL', () => {
    const meta = extractHtmlMetadata(readFixture('website-home.html'), 'https://agentos.xyz/');

    expect(meta.feedUrls).toEqual([
      'https://agentos.xyz/blog/rss.xml',
      'https://agentos.xyz/changelog.xml',
    ]);
  });

  it('keeps the site icon as a logo source: the touch icon first, a png or svg icon otherwise, never a .ico or the banner', () => {
    const touch = extractHtmlMetadata(
      '<link rel="icon" href="/favicon.ico"><link rel="icon" type="image/png" href="/icon-32.png"><link rel="apple-touch-icon" href="/touch.png"><meta property="og:image" content="/banner.png">',
      'https://chit.tools/',
    );
    expect(touch.iconUrl).toBe('https://chit.tools/touch.png');
    expect(touch.ogImage).toBe('/banner.png');
    const plain = extractHtmlMetadata('<link rel="shortcut icon" href="/favicon.ico"><link rel="icon" href="/logo.svg">', 'https://chit.tools/');
    expect(plain.iconUrl).toBe('https://chit.tools/logo.svg');
    expect(extractHtmlMetadata('<link rel="icon" href="/favicon.ico">', 'https://chit.tools/').iconUrl).toBeUndefined();
  });

  it('ignores stylesheets and other non-feed links', () => {
    const meta = extractHtmlMetadata(readFixture('website-home.html'), 'https://agentos.xyz/');
    expect(meta.feedUrls.join(' ')).not.toContain('styles.css');
  });

  /*
   * Guards from the builder-discovery audit (2026-09-02).
   *
   * Both cases were observed on real published projects. A project whose
   * declared website is hosted on github.com harvested GitHub's own marketing
   * pages as its repositories, and pages linking to `docs.robinhood.com` had
   * a third party's documentation recorded as their own.
   */
  it('rejects GitHub navigation paths that are not repositories', () => {
    const meta = extractHtmlMetadata(
      `<a href="https://github.com/enterprise/premium-support">x</a>
       <a href="https://github.com/open-source/sponsors">x</a>
       <a href="https://github.com/collections/ai">x</a>
       <a href="https://github.com/palisadescan/palisade">real</a>`,
      'https://github.com/palisadescan/palisade',
    );

    expect(meta.githubUrls).toEqual(['https://github.com/palisadescan/palisade']);
  });

  it('treats a clone URL and a repo sub-page as the same repository', () => {
    const meta = extractHtmlMetadata(
      `<a href="https://github.com/abhishekf96/pickles.git">clone</a>
       <a href="https://github.com/abhishekf96/pickles/issues">issues</a>`,
      'https://example.com/',
    );

    expect(meta.githubUrls).toEqual(['https://github.com/abhishekf96/pickles']);
  });

  it('only records documentation published on the project\'s own domain', () => {
    const meta = extractHtmlMetadata(
      `<a href="https://docs.github.com/en">github docs</a>
       <a href="https://docs.robinhood.com/crypto">robinhood docs</a>
       <a href="https://docs.agentos.xyz/start">our docs</a>`,
      'https://agentos.xyz/',
    );

    expect(meta.docsUrls).toEqual(['https://docs.agentos.xyz/start']);
  });
});

describe('website adapter', () => {
  const adapter = createWebsiteAdapter();

  it('normalizes a page into metadata plus a content hash', async () => {
    const stub = stubFetch(html());
    const result = await adapter.fetch(
      { url: 'https://agentos.xyz/' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.status).toBe('fresh');
    expect(result.data?.title).toContain('AgentOS');
    expect(result.data?.contentHash).toHaveLength(8);
  });

  it('produces a stable hash so unchanged pages skip downstream work', () => {
    const body = readFixture('website-home.html');
    expect(hashContent(body)).toBe(hashContent(body));
    expect(hashContent(body)).not.toBe(hashContent(`${body}<!-- changed -->`));
  });

  it('refuses to fetch a private address supplied by a builder', async () => {
    const stub = stubFetch(html());
    const result = await adapter.fetch(
      { url: 'http://169.254.169.254/latest/meta-data/' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.errorCode).toBe('BLOCKED_URL');
    expect(stub.callCount()).toBe(0);
  });

  it('rejects a non-HTML response', async () => {
    const stub = stubFetch({
      status: 200,
      body: '%PDF-1.7',
      headers: { 'content-type': 'application/pdf' },
    });
    const result = await adapter.fetch(
      { url: 'https://agentos.xyz/paper.pdf' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');
  });
});

describe('feed adapter', () => {
  const adapter = createFeedAdapter();
  const feedHeaders = { 'content-type': 'application/rss+xml' };

  it('normalizes RSS items', async () => {
    const stub = stubFetch({
      status: 200,
      body: readFixture('feed-rss.xml'),
      headers: feedHeaders,
    });
    const result = await adapter.fetch(
      { url: 'https://agentos.xyz/changelog.xml' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.data?.feedTitle).toBe('AgentOS Changelog');
    expect(result.data?.entries).toHaveLength(2);
    expect(result.data?.entries[0]).toMatchObject({
      externalId: 'https://agentos.xyz/changelog/v0-4-0',
      title: 'v0.4.0 released: limit-order support',
      link: 'https://agentos.xyz/changelog/v0-4-0',
    });
    expect(result.data?.entries[0]?.publishedAt?.toISOString()).toBe('2026-08-30T12:00:00.000Z');
  });

  it('strips HTML out of item descriptions', async () => {
    const stub = stubFetch({
      status: 200,
      body: readFixture('feed-rss.xml'),
      headers: feedHeaders,
    });
    const result = await adapter.fetch(
      { url: 'https://agentos.xyz/changelog.xml' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.data?.entries[0]?.summary).toBe('Limit orders are live for all agents.');
  });

  it('normalizes Atom entries into the same shape, including attribute links', async () => {
    const stub = stubFetch({
      status: 200,
      body: readFixture('feed-atom.xml'),
      headers: { 'content-type': 'application/atom+xml' },
    });
    const result = await adapter.fetch(
      { url: 'https://agentos.xyz/blog/atom.xml' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.data?.entries[0]).toMatchObject({
      externalId: 'tag:agentos.xyz,2026:post-11',
      title: 'Agent-to-agent settlement',
      link: 'https://agentos.xyz/blog/a2a-settlement',
    });
  });

  it('produces identical entries on repeat fetches so re-ingestion cannot duplicate', async () => {
    const body = readFixture('feed-rss.xml');
    const first = await adapter.fetch(
      { url: 'https://agentos.xyz/changelog.xml' },
      testContext({ fetchImpl: stubFetch({ status: 200, body, headers: feedHeaders }).fetchImpl }),
    );
    const second = await adapter.fetch(
      { url: 'https://agentos.xyz/changelog.xml' },
      testContext({ fetchImpl: stubFetch({ status: 200, body, headers: feedHeaders }).fetchImpl }),
    );

    expect(second.data?.entries.map((e) => e.externalId)).toEqual(
      first.data?.entries.map((e) => e.externalId),
    );
    expect(second.data?.contentHash).toBe(first.data?.contentHash);
  });

  it('reports malformed XML as an invalid response', async () => {
    const stub = stubFetch({
      status: 200,
      body: '<rss><channel><item></chan',
      headers: feedHeaders,
    });
    const result = await adapter.fetch(
      { url: 'https://agentos.xyz/broken.xml' },
      testContext({ fetchImpl: stub.fetchImpl }),
    );

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });
});
