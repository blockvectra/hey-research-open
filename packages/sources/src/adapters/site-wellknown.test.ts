import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import {
  createSiteWellKnownAdapter,
  openApiDocumentSchema,
  openApiSurface,
  parseLlmsTxt,
  parseRobotsTxt,
  parseSecurityTxt,
  parseSitemap,
  parseWellKnown,
  robotsAllows,
  WELL_KNOWN_LIMITS,
} from './site-wellknown';

const text = (body: string, type = 'text/plain; charset=utf-8', extra: Record<string, string> = {}) => ({
  status: 200,
  body,
  headers: { 'content-type': type, ...extra },
});

describe('robots.txt (RFC 9309)', () => {
  it('reads the * group of a real file and its sitemap line', () => {
    const robots = parseRobotsTxt(readFixture('wellknown-axon-robots.txt'));
    expect(robots.group).toBe('any');
    expect(robots.sitemaps).toEqual(['https://axon-agents.com/sitemap.xml']);
    expect(robotsAllows(robots, '/llms.txt')).toBe(true);
    expect(robotsAllows(robots, '/api/openapi')).toBe(true);
    expect(robotsAllows(robots, '/api/admin/users')).toBe(false);
    expect(robotsAllows(robots, '/dashboard')).toBe(false);
  });

  it('honours a site that keeps its API out of crawlers (own.money)', () => {
    const robots = parseRobotsTxt(readFixture('wellknown-ownmoney-robots.txt'));
    expect(robotsAllows(robots, '/api/openapi.json')).toBe(false);
    expect(robotsAllows(robots, '/llms.txt')).toBe(true);
  });

  it('prefers the group naming HEY over *, and applies longest-match with Allow winning a tie', () => {
    const robots = parseRobotsTxt(['User-agent: *', 'Disallow: /', '', 'User-agent: HEYResearchBot', 'Disallow: /private', 'Allow: /private/ok'].join('\n'));
    expect(robots.group).toBe('hey');
    expect(robotsAllows(robots, '/llms.txt')).toBe(true);
    expect(robotsAllows(robots, '/private/x')).toBe(false);
    expect(robotsAllows(robots, '/private/ok/y')).toBe(true);
    const tie = parseRobotsTxt('User-agent: *\nDisallow: /a\nAllow: /a\n');
    expect(robotsAllows(tie, '/a')).toBe(true);
  });

  it('matches * and $ without backtracking', () => {
    const robots = parseRobotsTxt('User-agent: *\nDisallow: /*.json$\nDisallow: /tmp*/cache\n');
    expect(robotsAllows(robots, '/openapi.json')).toBe(false);
    expect(robotsAllows(robots, '/openapi.json?x=1')).toBe(true);
    expect(robotsAllows(robots, '/tmp1/cache/a')).toBe(false);
    const hostile = `User-agent: *\nDisallow: /${'*a'.repeat(2_000)}$\n`;
    const started = performance.now();
    robotsAllows(parseRobotsTxt(hostile), `/${'a'.repeat(4_000)}b`);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('disallows the whole site to HEY when told to', () => {
    const robots = parseRobotsTxt('User-agent: heyresearchbot\nDisallow: /\n');
    expect(robotsAllows(robots, '/')).toBe(false);
    expect(robotsAllows(robots, '/llms.txt')).toBe(false);
  });
});

describe('sitemap.xml', () => {
  it('reads a real urlset: every location, no lastmod invented', () => {
    const sitemap = parseSitemap(readFixture('wellknown-axon-sitemap.xml'));
    expect(sitemap?.kind).toBe('urlset');
    expect(sitemap?.count).toBeGreaterThan(50);
    expect(sitemap?.entries[0]?.loc).toBe('https://axon-agents.com');
    expect(sitemap?.entries.some((entry) => entry.loc.includes('/docs'))).toBe(true);
  });

  it('records an index without following it, and keeps lastmod as the site’s own claim', () => {
    const index = parseSitemap('<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.example/s1.xml</loc><lastmod>2026-09-01</lastmod></sitemap></sitemapindex>');
    expect(index).toMatchObject({ kind: 'sitemapindex', count: 1 });
    expect(index?.newestLastmod?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('is not a sitemap when the body is an SPA page', () => {
    expect(parseSitemap(readFixture('wellknown-spa-fallback.html'))).toBeUndefined();
  });

  it('caps locations and stays linear on a hostile body', () => {
    const many = `<urlset>${'<url><loc>https://a.example/p</loc></url>'.repeat(WELL_KNOWN_LIMITS.sitemap.maxLocations + 10)}</urlset>`;
    const sitemap = parseSitemap(many);
    expect(sitemap?.entries).toHaveLength(WELL_KNOWN_LIMITS.sitemap.maxLocations);
    expect(sitemap?.truncated).toBe(true);
    const unclosed = `<urlset>${'<url><loc>'.repeat(200_000)}`;
    const started = performance.now();
    parseSitemap(unclosed);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('does not expand entities or read a DTD', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><urlset><url><loc>https://a.example/&lol2;</loc></url></urlset>';
    expect(parseSitemap(bomb)?.entries[0]?.loc).toBe('https://a.example/&lol2;');
  });
});

describe('llms.txt', () => {
  it('reads a real file with a Setext heading and "Label: url" lines', () => {
    const llms = parseLlmsTxt(readFixture('wellknown-axon-llms.txt'), 'https://axon-agents.com/llms.txt');
    expect(llms?.title).toBe('Axon');
    const openapi = llms?.links.find((link) => link.url === 'https://axon-agents.com/api/openapi');
    expect(openapi?.label).toBe('OpenAPI');
    expect(llms?.links.some((link) => link.url === 'https://axon-agents.com/docs/api')).toBe(true);
  });

  it('is not llms.txt when the body is an SPA page or has no heading', () => {
    expect(parseLlmsTxt(readFixture('wellknown-spa-fallback.html'), 'https://a.example/llms.txt')).toBeUndefined();
    expect(parseLlmsTxt('just some text https://a.example', 'https://a.example/llms.txt')).toBeUndefined();
  });

  it('keeps links from a hostile file as links, drops non-http ones, and nothing else', () => {
    const llms = parseLlmsTxt(readFixture('wellknown-injection-llms.txt'), 'https://totally-legit.example/llms.txt');
    const urls = llms?.links.map((link) => link.url) ?? [];
    expect(urls).toContain('https://github.com/attacker/stolen-repo');
    expect(urls.some((url) => url.startsWith('javascript:'))).toBe(false);
    // The parser returns links and a title only: there is no field an instruction could land in.
    expect(Object.keys(llms ?? {}).sort()).toEqual(['links', 'title']);
    for (const link of llms?.links ?? []) expect(Object.keys(link).every((key) => key === 'url' || key === 'label')).toBe(true);
  });

  it('caps the links it keeps', () => {
    const body = `# Big\n${Array.from({ length: 500 }, (_, index) => `- [l](https://a.example/${index})`).join('\n')}`;
    expect(parseLlmsTxt(body, 'https://a.example/llms.txt')?.links).toHaveLength(WELL_KNOWN_LIMITS.llms.maxLinks);
  });
});

describe('security.txt (RFC 9116)', () => {
  it('needs a Contact line', () => {
    expect(parseSecurityTxt(readFixture('wellknown-security.txt'))).toMatchObject({ contacts: 2, hasPolicy: true });
    expect(parseSecurityTxt('Policy: https://a.example')).toBeUndefined();
    expect(parseSecurityTxt(readFixture('wellknown-spa-fallback.html'))).toBeUndefined();
  });
});

describe('OpenAPI surface', () => {
  it('counts a real description’s paths and operations (Axon: 46 paths, 73 operations)', () => {
    const doc = openApiDocumentSchema.parse(JSON.parse(readFixture('wellknown-axon-openapi.json')));
    const surface = openApiSurface(doc);
    expect(surface).toMatchObject({ specVersion: '3.1.0', title: 'Axon API', version: '0.1.0', pathCount: 46, operationCount: 73, servers: ['/api'] });
    expect(surface.operations).toHaveLength(73);
    expect(surface.structureSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats a hostile description as text: servers are strings, summaries are dropped', () => {
    const doc = openApiDocumentSchema.parse(JSON.parse(readFixture('wellknown-openapi-injection.json')));
    const surface = openApiSurface(doc);
    expect(surface.servers).toEqual(['http://169.254.169.254/latest', 'https://evil.example/api']);
    expect(surface.operations).toEqual(['DELETE /admin/delete-everything', 'POST /v1/score']);
    expect(JSON.stringify(surface)).not.toContain('curl');
  });

  it('the structure hash moves with the surface, not with prose', () => {
    const base = { openapi: '3.0.0', info: { title: 'A', version: '1' }, paths: { '/a': { get: { summary: 'x' } } } };
    const reworded = { ...base, info: { title: 'B', version: '1' }, paths: { '/a': { get: { summary: 'y' } } } };
    const grown = { ...base, paths: { ...base.paths, '/b': { post: {} } } };
    const hash = (doc: unknown) => openApiSurface(openApiDocumentSchema.parse(doc)).structureSha256;
    expect(hash(reworded)).toBe(hash(base));
    expect(hash(grown)).not.toBe(hash(base));
  });

  it('refuses a JSON body that is not an OpenAPI or Swagger document', () => {
    expect(parseWellKnown({ kind: 'openapi', url: 'https://a.example/openapi.json' }, '{"error":"not found"}')).toBeUndefined();
    expect(parseWellKnown({ kind: 'openapi', url: 'https://a.example/openapi.json' }, '<html>')).toBeUndefined();
  });
});

describe('the site-wellknown adapter (contract)', () => {
  const adapter = createSiteWellKnownAdapter();

  it('reads a present file with validators and the final URL', async () => {
    const stub = stubFetch(text(readFixture('wellknown-axon-llms.txt'), 'text/plain; charset=utf-8', { etag: '"abc"' }));
    const result = await adapter.fetch({ kind: 'llms', url: 'https://axon-agents.com/llms.txt' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('fresh');
    expect(result.etag).toBe('"abc"');
    expect(result.data?.kind).toBe('llms');
    expect(stub.requests[0]?.url).toBe('https://axon-agents.com/llms.txt');
  });

  it('sends the validators it holds, and a 304 is not_modified', async () => {
    const stub = stubFetch({ status: 304 });
    const result = await adapter.fetch({ kind: 'robots', url: 'https://a.example/robots.txt' }, testContext({ fetchImpl: stub.fetchImpl, etag: '"v1"' }));
    expect(result.status).toBe('not_modified');
    const headers = stub.requests[0]?.init?.headers as Record<string, string>;
    expect(headers['if-none-match']).toBe('"v1"');
  });

  it('an SPA answering 200 text/html is a soft 404, never a present file', async () => {
    const stub = stubFetch(text(readFixture('wellknown-spa-fallback.html'), 'text/html; charset=utf-8'));
    const result = await adapter.fetch({ kind: 'llms', url: 'https://a.example/llms.txt' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');
  });

  it('an SPA that lies about its content type is still a soft 404', async () => {
    const stub = stubFetch(text(readFixture('wellknown-spa-fallback.html'), 'text/plain'));
    const result = await adapter.fetch({ kind: 'security', url: 'https://a.example/.well-known/security.txt' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('INVALID_RESPONSE');
  });

  it('a 404 is absence, and a private address is refused before any request', async () => {
    const missing = await adapter.fetch({ kind: 'sitemap', url: 'https://a.example/sitemap.xml' }, testContext({ fetchImpl: stubFetch({ status: 404 }).fetchImpl }));
    expect(missing.errorCode).toBe('NOT_FOUND');
    const stub = stubFetch(text('User-agent: *'));
    const blocked = await adapter.fetch({ kind: 'robots', url: 'http://169.254.169.254/robots.txt' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(blocked.errorCode).toBe('BLOCKED_URL');
    expect(stub.callCount()).toBe(0);
  });

  it('refuses a body over its cap', async () => {
    const stub = stubFetch(text(`User-agent: *\n${'#'.repeat(WELL_KNOWN_LIMITS.robots.maxBytes + 10)}`));
    const result = await adapter.fetch({ kind: 'robots', url: 'https://a.example/robots.txt' }, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.errorCode).toBe('TOO_LARGE');
  });

  it('reads an OpenAPI description only as JSON', async () => {
    const ok = await adapter.fetch(
      { kind: 'openapi', url: 'https://axon-agents.com/api/openapi' },
      testContext({ fetchImpl: stubFetch(text(readFixture('wellknown-axon-openapi.json'), 'application/json')).fetchImpl }),
    );
    expect(ok.data?.kind === 'openapi' && ok.data.openapi.operationCount).toBe(73);
    const yaml = await adapter.fetch(
      { kind: 'openapi', url: 'https://a.example/openapi.yaml' },
      testContext({ fetchImpl: stubFetch(text('openapi: 3.0.0', 'application/yaml')).fetchImpl }),
    );
    expect(yaml.errorCode).toBe('UNSUPPORTED_CONTENT_TYPE');
  });
});
