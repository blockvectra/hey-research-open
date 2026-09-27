import { describe, expect, it } from 'vitest';

import {
  decodeEntities,
  extractHtmlMetadata,
  MAX_ANCHORS,
  MAX_EXTRACT_CHARS,
  parseForgeRepoUrl,
  REPLACEMENT_CHARACTER,
  sanitizeText,
} from './html';
import { createWebsiteAdapter } from './adapters/website';
import { readFixture, stubFetch, testContext } from './testing';

/**
 * Parser fixtures for the website extractor (2026-09-27, audit G S1/S3/S8,
 * brief §47). The timing cases are the hostile pages audit G measured against
 * the regex extractor: a 2 MB page of unclosed `<a href=x ` took 181 s there,
 * 600 KB of unclosed `<meta content="` 10 s, 280 KB of repeated `<title>` 1.9 s.
 * Each must now finish well inside the 200 ms budget.
 */
const TWO_MB = 2 * 1024 * 1024;
const BUDGET_MS = 200;

const repeatTo = (unit: string, size: number): string => unit.repeat(Math.ceil(size / unit.length)).slice(0, size);

const timed = <T>(work: () => T): { value: T; ms: number } => {
  const started = performance.now();
  const value = work();
  return { value, ms: performance.now() - started };
};

describe('extraction is linear in the page (audit G S1)', () => {
  const hostile: [string, string][] = [
    ['unclosed anchors', repeatTo('<a href=x ', TWO_MB)],
    ['unclosed meta content', repeatTo('<meta content="', TWO_MB)],
    ['unclosed link tags', repeatTo('<link rel=icon href=', TWO_MB)],
    ['repeated titles without a close', repeatTo('<title>', TWO_MB)],
    ['a title that never closes', `<title>${repeatTo('<a <meta ', TWO_MB)}`],
    ['open angle brackets only', repeatTo('<', TWO_MB)],
    ['attribute soup inside tags just under the tag cap', repeatTo(`<meta ${repeatTo('content="', 8000)}>`, TWO_MB)],
    ['closed anchors past the anchor cap', repeatTo('<a href="https://github.com/o/r">x</a>', TWO_MB)],
  ];

  it.each(hostile)('%s: a 2 MB page parses in under 200 ms', (_name, page) => {
    // Warm once so the measurement is the scan, not the JIT.
    extractHtmlMetadata(page.slice(0, 4096), 'https://hostile.example/');
    const { ms, value } = timed(() => extractHtmlMetadata(page, 'https://hostile.example/'));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.githubUrls.length).toBeLessThanOrEqual(10);
  });

  it('stays linear below the extraction cap too, not only because of it', () => {
    const page = repeatTo('<a href=x ', MAX_EXTRACT_CHARS);
    const quarter = timed(() => extractHtmlMetadata(page.slice(0, MAX_EXTRACT_CHARS / 4)));
    const whole = timed(() => extractHtmlMetadata(page));
    expect(whole.ms).toBeLessThan(BUDGET_MS);
    // Four times the input may not cost the square of four; allow noise on tiny numbers.
    expect(whole.ms).toBeLessThan(Math.max(20, quarter.ms * 10));
  });

  it('sanitizes 2 MB of text with no closing bracket, or of bare ampersands, in under 200 ms', () => {
    expect(timed(() => sanitizeText(repeatTo('<b', TWO_MB))).ms).toBeLessThan(BUDGET_MS);
    expect(timed(() => sanitizeText(repeatTo('&aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', TWO_MB))).ms).toBeLessThan(BUDGET_MS);
    expect(timed(() => sanitizeText(repeatTo('&#x0000000000000000000000', TWO_MB))).ms).toBeLessThan(BUDGET_MS);
  });

  it('reads only the first MAX_EXTRACT_CHARS: a link past it is not harvested', () => {
    const early = '<a href="https://github.com/early/repo">e</a>';
    const late = '<a href="https://github.com/late/repo">l</a>';
    const page = `${early}${' '.repeat(MAX_EXTRACT_CHARS)}${late}`;
    expect(extractHtmlMetadata(page).githubUrls).toEqual(['https://github.com/early/repo']);
  });

  it('examines at most MAX_ANCHORS anchors', () => {
    const filler = '<a href="/x">x</a>'.repeat(MAX_ANCHORS);
    const page = `${filler}<a href="https://github.com/after/cap">late</a>`;
    expect(extractHtmlMetadata(page, 'https://site.example/').githubUrls).toEqual([]);
  });
});

describe('the scanner reads what the regexes read', () => {
  it('keeps the first of a repeated attribute, any quoting, any case', () => {
    const meta = extractHtmlMetadata(
      `<META NAME='description' CONTENT="first" content="second"><meta property=og:title content=Unquoted>
       <link REL="Canonical" HREF="/home"><A HREF='https://github.com/Case/Repo'>x</A>`,
      'https://case.example/',
    );
    expect(meta.description).toBe('first');
    expect(meta.ogTitle).toBe('Unquoted');
    expect(meta.canonicalUrl).toBe('https://case.example/home');
    expect(meta.githubUrls).toEqual(['https://github.com/Case/Repo']);
  });

  it('does not read `data-content` as `content`, or `<abbr>` / `<article>` as `<a>`', () => {
    const meta = extractHtmlMetadata(
      `<meta name="description" data-content="wrong"><abbr href="https://github.com/no/abbr">x</abbr>
       <article href="https://github.com/no/article"></article>`,
      'https://strict.example/',
    );
    expect(meta.description).toBeUndefined();
    expect(meta.githubUrls).toEqual([]);
  });

  it('reads a title with markup and entities inside it, and skips a tag longer than the cap', () => {
    const giant = `<a href="https://github.com/giant/tag" data-x="${'y'.repeat(9000)}">`;
    const meta = extractHtmlMetadata(`<title> The <b>Build</b> &amp; Ship </title>${giant}<a href="https://github.com/ok/repo">`);
    expect(meta.title).toBe('The Build & Ship');
    expect(meta.githubUrls).toEqual(['https://github.com/ok/repo']);
  });
});

describe('numeric entities are clamped, never thrown (audit G S3)', () => {
  it('turns out-of-range, NUL and surrogate references into U+FFFD', () => {
    expect(decodeEntities('a&#x110000;b')).toBe(`a${REPLACEMENT_CHARACTER}b`);
    expect(decodeEntities('&#99999999;')).toBe(REPLACEMENT_CHARACTER);
    expect(decodeEntities('&#0;&#xD800;&#xdfff;')).toBe(REPLACEMENT_CHARACTER.repeat(3));
    expect(decodeEntities('&#x1F680;&#65;&#x41;')).toBe('\u{1F680}AA');
  });

  it('keeps a page with an out-of-range entity a fresh read, not a NETWORK failure', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('website-entity-overflow.html'), headers: { 'content-type': 'text/html' } });
    const result = await createWebsiteAdapter().fetch({ url: 'https://entity.example/' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.data?.githubUrls).toEqual(['https://github.com/entity-example/app']);
  });

  it('parses the entity-overflow fixture instead of failing the page', () => {
    const meta = extractHtmlMetadata(readFixture('website-entity-overflow.html'), 'https://entity.example/');
    expect(meta.title).toBe(`Launch ${REPLACEMENT_CHARACTER} day ${REPLACEMENT_CHARACTER} notes ${REPLACEMENT_CHARACTER} ${REPLACEMENT_CHARACTER} — ok`);
    expect(meta.description).toBe('Ships &#99999999999999999999; weekly & openly.');
    expect(meta.githubUrls).toEqual(['https://github.com/entity-example/app']);
  });
});

describe('hostile links (audit G S8, brief §47)', () => {
  const meta = extractHtmlMetadata(readFixture('website-hostile-links.html'), 'https://mine.vercel.app/');

  it('keeps docs on this tenant only: another tenant of the same shared host is another site', () => {
    expect(meta.docsUrls).toEqual(['https://mine.vercel.app/docs/start', 'https://docs.mine.vercel.app/api']);
  });

  it('never yields a javascript:, data: or metadata-address link', () => {
    const everything = [...meta.githubUrls, ...meta.docsUrls, ...meta.feedUrls, ...meta.forgeUrls.map((forge) => forge.url)];
    expect(everything.some((url) => /^(javascript|data):/i.test(url) || url.includes('169.254.169.254'))).toBe(false);
  });

  it('counts GitLab.com and Codeberg repositories, and never a self-hosted forge or the forge’s own pages', () => {
    expect(meta.forgeUrls).toEqual([
      { forge: 'gitlab', url: 'https://gitlab.com/mine-group/sub/app', path: 'mine-group/sub/app' },
      { forge: 'codeberg', url: 'https://codeberg.org/mine/app', path: 'mine/app' },
    ]);
    expect(meta.githubUrls).toEqual(['https://github.com/mine-org/app']);
  });

  it('parses forge URLs by the same rule as GitHub: the repository root only', () => {
    const parse = (url: string) => parseForgeRepoUrl(new URL(url));
    expect(parse('https://gitlab.com/group/project')).toMatchObject({ forge: 'gitlab', path: 'group/project' });
    expect(parse('https://www.gitlab.com/Group/Sub/Project.git')?.url).toBe('https://gitlab.com/Group/Sub/Project');
    expect(parse('https://gitlab.com/group')).toBeUndefined();
    expect(parse('https://gitlab.com/group/project/-/tree/main')).toBeUndefined();
    expect(parse('https://gitlab.com/users/sign_in')).toBeUndefined();
    expect(parse('https://codeberg.org/owner/repo/src/branch/main')).toBeUndefined();
    expect(parse('https://codeberg.org/user/login')).toBeUndefined();
    expect(parse('https://gitlab.example.org/group/project')).toBeUndefined();
    expect(parse('ftp://gitlab.com/group/project')).toBeUndefined();
  });

  it('caps forge links per page like every other kind', () => {
    const page = Array.from({ length: 25 }, (_, index) => `<a href="https://gitlab.com/g/p${index}">x</a>`).join('');
    expect(extractHtmlMetadata(page).forgeUrls).toHaveLength(10);
  });
});

describe('a docs page is one link whatever its anchor (review repair, 2026-09-27)', () => {
  it('drops the #fragment, so skip links and in-page anchors do not use up the docs slots', () => {
    const page = [
      '<a href="/docs#main">skip</a>',
      '<a href="/docs#install">install</a>',
      '<a href="/docs">docs</a>',
      '<a href="/docs/api#top">api</a>',
    ].join('');
    expect(extractHtmlMetadata(page, 'https://example.org/').docsUrls).toEqual(['https://example.org/docs', 'https://example.org/docs/api']);
  });
});
