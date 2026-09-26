import { createHash } from 'node:crypto';

import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { sanitizeText } from '../html';
import { performSourceFetch } from '../http/perform';

/**
 * An official site's well-known files (brief §29–31, 2026-09-27).
 *
 * robots.txt first, then sitemap.xml, llms.txt, /.well-known/security.txt and
 * — only when the site itself links one — an OpenAPI description. Each read
 * is one conditional GET through the shared client: SSRF-checked and pinned
 * (`enforceUrlSafety: true`), five redirects at most with every hop checked,
 * a per-file body cap, a content-type allow-list and the shared timeout.
 *
 * The content-type and body checks are what make a probe honest. A single-page
 * app answers 200 `text/html` for any path, so "HTTP 200 on /llms.txt" was a
 * soft 404 on five of twenty-three sampled sites (audit C §4): a file counts
 * as present only when its type is right *and* its body has the file's shape.
 *
 * Everything here is parsed, never obeyed: a line of llms.txt that reads
 * "ignore previous instructions" is text in a link label, and nothing in this
 * module or downstream reads labels as anything but data (brief §16). Parsers
 * are linear — line and index scans with bounded lines — so a hostile file
 * costs its size and no more.
 */

export const WELL_KNOWN_PARSER_VERSION = 'wk-v1';

/** HEY's product token for robots.txt groups (RFC 9309 §2.2.1), from `DEFAULT_USER_AGENT`. */
export const HEY_ROBOTS_TOKEN = 'heyresearchbot';

export const WELL_KNOWN_KINDS = ['robots', 'sitemap', 'llms', 'security', 'openapi'] as const;
export type WellKnownKind = (typeof WELL_KNOWN_KINDS)[number];

/** Where each file lives when nothing names another place. OpenAPI has no conventional path HEY probes. */
export const WELL_KNOWN_PATHS: Record<Exclude<WellKnownKind, 'openapi'>, string> = {
  robots: '/robots.txt',
  sitemap: '/sitemap.xml',
  llms: '/llms.txt',
  security: '/.well-known/security.txt',
};

/**
 * Local caps (conservative until the shared fetch limits land): RFC 9309 asks
 * a crawler to parse at least 500 KiB of robots.txt; sitemaps may be 50 MB by
 * spec, and HEY reads the first 2 MiB and 5,000 locations — enough to find a
 * docs section, never enough to crawl a site.
 */
export const WELL_KNOWN_LIMITS = {
  robots: { maxBytes: 512 * 1024 },
  sitemap: { maxBytes: 2 * 1024 * 1024, maxLocations: 5_000 },
  llms: { maxBytes: 256 * 1024, maxLinks: 200 },
  security: { maxBytes: 64 * 1024 },
  openapi: { maxBytes: 2 * 1024 * 1024, maxPaths: 5_000, maxStoredOperations: 1_000, maxServers: 20 },
  maxLineLength: 4_096,
} as const;

const CONTENT_TYPES: Record<WellKnownKind, readonly string[]> = {
  robots: ['text/plain'],
  sitemap: ['application/xml', 'text/xml', 'application/x-xml'],
  llms: ['text/plain', 'text/markdown', 'text/x-markdown'],
  security: ['text/plain'],
  openapi: ['application/json', 'application/vnd.oai.openapi+json', 'application/openapi+json', 'text/json'],
};

const ACCEPT: Record<WellKnownKind, string> = {
  robots: 'text/plain',
  sitemap: 'application/xml,text/xml',
  llms: 'text/plain,text/markdown',
  security: 'text/plain',
  openapi: 'application/json,application/vnd.oai.openapi+json',
};

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/* ------------------------------------------------------------------ lines */

function* lines(body: string): Generator<string> {
  let start = 0;
  while (start < body.length) {
    let end = body.indexOf('\n', start);
    if (end === -1) end = body.length;
    const line = body.slice(start, Math.min(end, start + WELL_KNOWN_LIMITS.maxLineLength)).replace(/\r$/, '');
    start = end + 1;
    yield line;
  }
}

/** A body that is an HTML document, whatever the header said: the SPA fallback. */
export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 512).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body');
}

/* ------------------------------------------------------------------ robots */

export type RobotsRule = { allow: boolean; pattern: string };
export type RobotsTxt = {
  /** The rules of the group that applies to HEY: its own token's group, else `*`, else none. */
  rules: RobotsRule[];
  /** Which group applied. */
  group: 'hey' | 'any' | 'none';
  sitemaps: string[];
  /** A line-level sanity check: at least one directive HEY recognises. */
  recognised: boolean;
};

/**
 * RFC 9309 group matching: the most specific group naming HEY's product token,
 * else the `*` group. Consecutive `user-agent` lines share one group.
 */
export function parseRobotsTxt(body: string, token: string = HEY_ROBOTS_TOKEN): RobotsTxt {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | undefined;
  let lastWasAgent = false;
  let recognised = false;
  for (const raw of lines(body)) {
    const line = raw.split('#')[0]?.trim() ?? '';
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      recognised = true;
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      recognised = true;
      if (sitemaps.length < 10 && /^https?:\/\//i.test(value)) sitemaps.push(value);
      continue;
    }
    if ((key === 'allow' || key === 'disallow') && current) {
      recognised = true;
      // An empty Disallow allows everything; it adds no rule.
      if (value !== '' && current.rules.length < 1_000) current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  const own = groups.filter((group) => group.agents.some((agent) => agent !== '*' && (agent.split('/')[0] ?? '').trim() === token));
  if (own.length > 0) return { rules: own.flatMap((group) => group.rules), group: 'hey', sitemaps, recognised };
  const any = groups.filter((group) => group.agents.includes('*'));
  if (any.length > 0) return { rules: any.flatMap((group) => group.rules), group: 'any', sitemaps, recognised };
  return { rules: [], group: 'none', sitemaps, recognised };
}

/** Longest match wins; on a tie Allow wins (RFC 9309 §2.2.2). `*` and a trailing `$` are honoured. */
export function robotsAllows(robots: Pick<RobotsTxt, 'rules'> | undefined, path: string): boolean {
  if (!robots || robots.rules.length === 0) return true;
  let best: RobotsRule | undefined;
  let bestLength = -1;
  for (const rule of robots.rules) {
    if (!robotsPatternMatches(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (length > bestLength || (length === bestLength && rule.allow)) {
      best = rule;
      bestLength = length;
    }
  }
  return best ? best.allow : true;
}

/** A linear wildcard match: segments between `*` must appear in order; a trailing `$` anchors the end. */
function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split('*');
  const first = parts[0] ?? '';
  if (!path.startsWith(first)) return false;
  if (parts.length === 1) return anchored ? path === first : true;
  let at = first.length;
  for (let index = 1; index < parts.length - 1; index += 1) {
    const part = parts[index] ?? '';
    if (part === '') continue;
    const found = path.indexOf(part, at);
    if (found === -1) return false;
    at = found + part.length;
  }
  const last = parts[parts.length - 1] ?? '';
  if (last === '') return true;
  if (!anchored) return path.indexOf(last, at) !== -1;
  return path.endsWith(last) && path.length - last.length >= at;
}

/* ----------------------------------------------------------------- sitemap */

export type SitemapEntry = { loc: string; lastmod?: Date };
export type Sitemap = {
  kind: 'urlset' | 'sitemapindex';
  entries: SitemapEntry[];
  /** Every `<loc>` seen, up to the cap; `truncated` when there were more. */
  count: number;
  truncated: boolean;
  newestLastmod?: Date;
};

/** The root element, after an XML declaration, comments or whitespace; undefined for anything else. */
function sitemapRoot(body: string): 'urlset' | 'sitemapindex' | undefined {
  const head = body.slice(0, 4_096);
  let at = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const open = head.indexOf('<', at);
    if (open === -1) return undefined;
    if (head.startsWith('<?', open) || head.startsWith('<!--', open) || head.startsWith('<!', open)) {
      const close = head.indexOf('>', open);
      if (close === -1) return undefined;
      at = close + 1;
      continue;
    }
    const name = head.slice(open + 1, open + 40).split(/[\s>/]/)[0]?.toLowerCase() ?? '';
    const local = name.includes(':') ? name.split(':')[1] : name;
    return local === 'urlset' || local === 'sitemapindex' ? local : undefined;
  }
  return undefined;
}

const between = (text: string, open: string, close: string, from: number): { value: string; end: number } | undefined => {
  const start = text.indexOf(open, from);
  if (start === -1) return undefined;
  const valueStart = start + open.length;
  const end = text.indexOf(close, valueStart);
  if (end === -1 || end - valueStart > 2_048) return undefined;
  return { value: text.slice(valueStart, end), end: end + close.length };
};

const decodeXmlText = (value: string): string =>
  value
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

/**
 * A bounded index scan over `<url>`/`<sitemap>` blocks. No entity expansion,
 * no DTD, no recursion into child sitemaps: an index is recorded, not followed.
 */
export function parseSitemap(body: string): Sitemap | undefined {
  const kind = sitemapRoot(body);
  if (!kind) return undefined;
  const block = kind === 'urlset' ? 'url' : 'sitemap';
  const entries: SitemapEntry[] = [];
  let count = 0;
  let truncated = false;
  let newest: Date | undefined;
  let at = 0;
  const lower = body.toLowerCase();
  for (;;) {
    const open = lower.indexOf(`<${block}>`, at);
    if (open === -1) break;
    const close = lower.indexOf(`</${block}>`, open);
    if (close === -1) break;
    at = close + block.length + 3;
    const inner = body.slice(open, close);
    const innerLower = lower.slice(open, close);
    const locAt = innerLower.indexOf('<loc>');
    if (locAt === -1) continue;
    const loc = between(inner, '<loc>', '</loc>', locAt);
    if (!loc) continue;
    count += 1;
    if (entries.length >= WELL_KNOWN_LIMITS.sitemap.maxLocations) {
      truncated = true;
      continue;
    }
    const lastmodAt = innerLower.indexOf('<lastmod>');
    const lastmod = lastmodAt === -1 ? undefined : between(inner, '<lastmod>', '</lastmod>', lastmodAt);
    const date = lastmod ? new Date(decodeXmlText(lastmod.value)) : undefined;
    const valid = date && !Number.isNaN(date.getTime()) ? date : undefined;
    if (valid && (!newest || valid > newest)) newest = valid;
    entries.push({ loc: decodeXmlText(loc.value), ...(valid ? { lastmod: valid } : {}) });
  }
  return { kind, entries, count, truncated, ...(newest ? { newestLastmod: newest } : {}) };
}

/* -------------------------------------------------------------------- llms */

export type LlmsLink = { url: string; label?: string };
export type LlmsTxt = { title?: string; links: LlmsLink[] };

/**
 * llms.txt (llmstxt.org): a Markdown file whose first heading names the site.
 * Only links are kept — the prose is somebody's text about themselves and HEY
 * stores none of it beyond a sanitized label.
 */
export function parseLlmsTxt(body: string, baseUrl: string): LlmsTxt | undefined {
  if (looksLikeHtml(body)) return undefined;
  let title: string | undefined;
  let headingSeen = false;
  let inspected = 0;
  const links: LlmsLink[] = [];
  const seen = new Set<string>();
  const add = (href: string, label?: string) => {
    if (links.length >= WELL_KNOWN_LIMITS.llms.maxLinks) return;
    let resolved: string;
    try {
      resolved = new URL(href.trim(), baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(resolved) || seen.has(resolved)) return;
    seen.add(resolved);
    const clean = label ? sanitizeText(label).slice(0, 200) : undefined;
    links.push({ url: resolved, ...(clean ? { label: clean } : {}) });
  };
  let previous: string | undefined;
  for (const line of lines(body)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    inspected += 1;
    if (!headingSeen && trimmed.startsWith('# ')) {
      headingSeen = true;
      title = sanitizeText(trimmed.slice(2)).slice(0, 200);
    } else if (!headingSeen && previous !== undefined && /^=+$/.test(trimmed)) {
      // A Setext heading: the title line underlined with `=` (axon-agents.com writes it this way).
      headingSeen = true;
      title = sanitizeText(previous).slice(0, 200);
    }
    previous = trimmed;
    // `[label](url)` pairs, found by index so a hostile line costs its length.
    let at = 0;
    for (let guard = 0; guard < 50; guard += 1) {
      const open = trimmed.indexOf('](', at);
      if (open === -1) break;
      const close = trimmed.indexOf(')', open + 2);
      if (close === -1) break;
      const labelStart = trimmed.lastIndexOf('[', open);
      const href = trimmed.slice(open + 2, close).split(/\s/)[0] ?? '';
      add(href, labelStart === -1 ? undefined : trimmed.slice(labelStart + 1, open));
      at = close + 1;
    }
    // Bare URLs outside Markdown links, labelled by the text before them on the line (`API reference: https://…`).
    let offset = 0;
    for (const token of trimmed.split(/\s+/).slice(0, 50)) {
      const position = trimmed.indexOf(token, offset);
      if (position !== -1) offset = position + token.length;
      if (!/^<?https?:\/\//i.test(token) || token.includes('](')) continue;
      const before = position > 0 ? trimmed.slice(Math.max(0, position - 200), position).replace(/[\s:–—-]+$/, '') : '';
      add(token.slice(0, 2_048).replace(/^<|[>),.;]+$/g, ''), before === '' ? undefined : before);
    }
  }
  // llms.txt opens with a heading; a text file without one is not llms.txt.
  if (!headingSeen || inspected === 0) return undefined;
  return { ...(title ? { title } : {}), links };
}

/* ---------------------------------------------------------------- security */

export type SecurityTxt = { contacts: number; expires?: Date; hasPolicy: boolean };

/** RFC 9116: at least one `Contact:` line, or this is not a security.txt. */
export function parseSecurityTxt(body: string): SecurityTxt | undefined {
  if (looksLikeHtml(body)) return undefined;
  let contacts = 0;
  let expires: Date | undefined;
  let hasPolicy = false;
  for (const line of lines(body)) {
    const trimmed = line.trim();
    const colon = trimmed.indexOf(':');
    if (trimmed.startsWith('#') || colon <= 0) continue;
    const key = trimmed.slice(0, colon).toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (key === 'contact' && value !== '') contacts += 1;
    else if (key === 'expires') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) expires = date;
    } else if (key === 'policy') hasPolicy = true;
  }
  if (contacts === 0) return undefined;
  return { contacts, ...(expires ? { expires } : {}), hasPolicy };
}

/* ----------------------------------------------------------------- openapi */

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

export const openApiDocumentSchema = z
  .object({
    openapi: z.string().max(20).optional(),
    swagger: z.string().max(20).optional(),
    info: z.object({ title: z.unknown().optional(), version: z.unknown().optional() }).passthrough().optional(),
    paths: z.record(z.string(), z.unknown()).optional(),
    servers: z.array(z.object({ url: z.unknown() }).passthrough()).optional(),
    host: z.unknown().optional(),
    basePath: z.unknown().optional(),
  })
  .passthrough()
  .refine((doc) => (doc.openapi !== undefined && /^3\./.test(doc.openapi)) || doc.swagger === '2.0', {
    message: 'not an OpenAPI 3.x or Swagger 2.0 document',
  });
export type OpenApiDocument = z.infer<typeof openApiDocumentSchema>;

export type OpenApiSurface = {
  specVersion: string;
  title?: string;
  version?: string;
  pathCount: number;
  operationCount: number;
  /** Sorted `METHOD /path` keys, at most `maxStoredOperations`. */
  operations: string[];
  operationsTruncated: boolean;
  /** Server URLs as text. HEY never calls them. */
  servers: string[];
  /** sha256 over the sorted operations and the version: moves only when the surface does. */
  structureSha256: string;
};

const shortText = (value: unknown, max = 200): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? sanitizeText(String(value)).slice(0, max) || undefined : undefined;

/** Counts and names the operations. Nothing in the document is executed, followed or resolved. */
export function openApiSurface(doc: OpenApiDocument): OpenApiSurface {
  const operations: string[] = [];
  let pathCount = 0;
  let operationCount = 0;
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (pathCount >= WELL_KNOWN_LIMITS.openapi.maxPaths) break;
    pathCount += 1;
    if (!item || typeof item !== 'object') continue;
    const cleanPath = Array.from(path.slice(0, 300))
      .filter((char) => char.charCodeAt(0) >= 0x20)
      .join('');
    for (const method of HTTP_METHODS) {
      if (method in (item as Record<string, unknown>)) {
        operationCount += 1;
        operations.push(`${method.toUpperCase()} ${cleanPath}`);
      }
    }
  }
  operations.sort();
  const stored = operations.slice(0, WELL_KNOWN_LIMITS.openapi.maxStoredOperations);
  const servers = [
    ...(doc.servers ?? []).map((server) => shortText(server.url, 300)),
    ...(doc.swagger ? [shortText(`${typeof doc.host === 'string' ? doc.host : ''}${typeof doc.basePath === 'string' ? doc.basePath : ''}`, 300)] : []),
  ]
    .filter((value): value is string => Boolean(value))
    .slice(0, WELL_KNOWN_LIMITS.openapi.maxServers);
  const specVersion = doc.openapi ?? `swagger ${doc.swagger ?? ''}`.trim();
  const version = shortText(doc.info?.version, 60);
  const title = shortText(doc.info?.title);
  return {
    specVersion,
    ...(title ? { title } : {}),
    ...(version ? { version } : {}),
    pathCount,
    operationCount,
    operations: stored,
    operationsTruncated: operations.length > stored.length,
    servers,
    structureSha256: sha256(JSON.stringify({ version: version ?? null, operations })),
  };
}

/* ----------------------------------------------------------------- adapter */

export type WellKnownInput = { kind: WellKnownKind; url: string };

export type WellKnownFile =
  | { kind: 'robots'; url: string; sha256: string; robots: RobotsTxt }
  | { kind: 'sitemap'; url: string; sha256: string; sitemap: Sitemap }
  | { kind: 'llms'; url: string; sha256: string; llms: LlmsTxt }
  | { kind: 'security'; url: string; sha256: string; security: SecurityTxt }
  | { kind: 'openapi'; url: string; sha256: string; openapi: OpenApiSurface };

/** A body that parsed as text but is not the file: a soft 404 the caller records as such. */
const SOFT_404 = 'soft 404: the body is not this file';

/**
 * One well-known file. `INVALID_RESPONSE` means the body did not have the
 * file's shape (an SPA fallback, a text page, a JSON error), and
 * `UNSUPPORTED_CONTENT_TYPE` that the server said it was something else;
 * both are soft 404s to the caller, never a present file.
 */
export function createSiteWellKnownAdapter(): SourceAdapter<WellKnownInput, WellKnownFile> {
  return {
    name: 'site-wellknown',
    canHandle(input) {
      return /^https?:\/\//i.test(input.url) && (WELL_KNOWN_KINDS as readonly string[]).includes(input.kind);
    },
    fetch(input, ctx: SourceContext): Promise<SourceResult<WellKnownFile>> {
      const limits = WELL_KNOWN_LIMITS[input.kind];
      return performSourceFetch<WellKnownFile, WellKnownFile>(
        ctx,
        {
          url: input.url,
          headers: { accept: ACCEPT[input.kind] },
          allowedContentTypes: CONTENT_TYPES[input.kind],
          // A project's own site is builder-supplied: DNS-checked and pinned on every hop.
          enforceUrlSafety: true,
          maxBytes: limits.maxBytes,
        },
        {
          // Parsing *is* the validation: a body without the file's shape is refused here.
          schema: z.custom<WellKnownFile>((value) => value !== undefined && value !== null, { message: SOFT_404 }),
          parse: (body) => parseWellKnown(input, body),
          normalize: (file, response) => ({ ...file, url: response.url ?? input.url }),
          cacheTtlSeconds: 7 * 24 * 60 * 60,
        },
      );
    },
  };
}

/** Exported for the fixture tests: the same parse the adapter runs. */
export function parseWellKnown(input: WellKnownInput, body: string): WellKnownFile | undefined {
  const hash = sha256(body);
  switch (input.kind) {
    case 'robots': {
      if (looksLikeHtml(body)) return undefined;
      const robots = parseRobotsTxt(body);
      // An empty robots.txt is a real file that allows everything.
      return robots.recognised || body.trim() === '' ? { kind: 'robots', url: input.url, sha256: hash, robots } : undefined;
    }
    case 'sitemap': {
      const sitemap = parseSitemap(body);
      return sitemap ? { kind: 'sitemap', url: input.url, sha256: hash, sitemap } : undefined;
    }
    case 'llms': {
      const llms = parseLlmsTxt(body, input.url);
      return llms ? { kind: 'llms', url: input.url, sha256: hash, llms } : undefined;
    }
    case 'security': {
      const security = parseSecurityTxt(body);
      return security ? { kind: 'security', url: input.url, sha256: hash, security } : undefined;
    }
    case 'openapi': {
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        return undefined;
      }
      const parsed = openApiDocumentSchema.safeParse(json);
      return parsed.success ? { kind: 'openapi', url: input.url, sha256: hash, openapi: openApiSurface(parsed.data) } : undefined;
    }
  }
}
