/**
 * Minimal HTML metadata extraction.
 *
 * HEY reads a small, fixed set of head elements and never renders or stores raw
 * HTML, so a full DOM parser would be a dependency without a payoff. Everything
 * extracted is decoded and tag-stripped before use (PRD V4 section 27).
 */

/**
 * Named entities worth decoding. Numeric entities are handled generically below;
 * this covers the named ones that actually turn up in project titles and prose.
 * Anything unknown is left verbatim rather than mangled.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // typography
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  middot: '\u00b7',
  laquo: '\u00ab',
  raquo: '\u00bb',
  prime: '\u2032',
  // symbols and currency
  times: '\u00d7',
  minus: '\u2212',
  plusmn: '\u00b1',
  deg: '\u00b0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  rarr: '\u2192',
  larr: '\u2190',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    const known = ENTITIES[entity.toLowerCase()];
    if (known !== undefined) return known;
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

/** Strip every tag, decode entities and collapse whitespace. */
export function sanitizeText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const attr = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const raw = match?.[2] ?? match?.[3] ?? match?.[4];
  return raw === undefined ? undefined : decodeEntities(raw).trim();
};

export type HtmlMetadata = {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  /**
   * The site's own square icon (2026-09-08): an `apple-touch-icon` first,
   * else a PNG or SVG `icon`. Never a `.ico`, which is too small for a card,
   * and never `og:image`, which is usually a wide banner. Resolved to an
   * absolute URL. A logo source for projects that have a site and nothing else.
   */
  iconUrl?: string;
  canonicalUrl?: string;
  /** Discovered RSS/Atom feeds, resolved to absolute URLs. */
  feedUrls: string[];
  /**
   * Repository links the page itself publishes.
   *
   * This is what makes a GitHub mapping authoritative: the project linked to the
   * repository from a site it controls. A name or ticker match never qualifies
   * (PRD V4 section 26, real-data ingestion §7).
   */
  githubUrls: string[];
  /** Documentation links published by the page. */
  docsUrls: string[];
};

/** Cap on links harvested from one page, so a link farm cannot flood ingestion. */
const MAX_LINKS_PER_KIND = 10;

/**
 * GitHub's own navigation paths, which are two-segment URLs that are not
 * repositories.
 *
 * A project whose declared website is itself hosted on github.com yields
 * `github.com/enterprise/premium-support`, `github.com/open-source/sponsors`
 * and friends from GitHub's page chrome. Harvesting those would attribute
 * GitHub's marketing pages to the project as if they were its code, which is
 * the same fabricated-attribution failure as importing an aggregator's feed.
 */
const GITHUB_RESERVED_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'blog',
  'business',
  'codespaces',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'git-guides',
  'github',
  'github-copilot',
  'join',
  'login',
  'marketplace',
  'mobile',
  'newsroom',
  'notifications',
  'open-source',
  'orgs',
  'pricing',
  'readme',
  'security',
  'sessions',
  'settings',
  'signup',
  'site',
  'solutions',
  'sponsors',
  'team',
  'topics',
  'trending',
  'users',
]);

/** Repository sub-pages: `owner/repo/issues` is not a distinct repository. */
const GITHUB_REPO_SUBPATHS = new Set([
  'blob',
  'commit',
  'commits',
  'discussions',
  'issues',
  'pull',
  'pulls',
  'releases',
  'tree',
  'wiki',
]);

/**
 * The registrable domain (last two labels) of a host.
 *
 * Docs must belong to the project, not to whoever the project links out to:
 * `docs.github.com`, `docs.robinhood.com` and `docs.replit.com` all appeared on
 * real project pages during the builder-discovery audit and would otherwise be
 * recorded as that project's documentation.
 */
function registrableDomain(host: string): string {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  return labels.slice(-2).join('.');
}

export function extractHtmlMetadata(html: string, baseUrl?: string): HtmlMetadata {
  const meta: HtmlMetadata = { feedUrls: [], githubUrls: [], docsUrls: [] };

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleMatch?.[1]) meta.title = sanitizeText(titleMatch[1]);

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase();
    const content = attr(tag, 'content');
    if (!key || !content) continue;

    if (key === 'description') meta.description ??= sanitizeText(content);
    else if (key === 'og:title') meta.ogTitle ??= sanitizeText(content);
    else if (key === 'og:description') meta.ogDescription ??= sanitizeText(content);
    else if (key === 'og:image') meta.ogImage ??= content;
  }

  const seen = new Set<string>();
  let touchIcon = false;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase();
    const href = attr(tag, 'href');
    if (!rel || !href) continue;

    if (rel === 'canonical') {
      meta.canonicalUrl ??= resolveUrl(href, baseUrl);
      continue;
    }

    const rels = rel.split(/\s+/);
    if (rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) {
      const resolved = resolveUrl(href, baseUrl);
      if (resolved) {
        // An Apple touch icon is always square and large enough; it wins over any plain icon seen so far.
        meta.iconUrl = touchIcon ? meta.iconUrl : resolved;
        touchIcon = true;
      }
      continue;
    }
    if (rels.includes('icon') && !touchIcon) {
      const resolved = resolveUrl(href, baseUrl);
      const typeAttr = attr(tag, 'type')?.toLowerCase() ?? '';
      const path = resolved ? new URL(resolved).pathname.toLowerCase() : '';
      if (resolved && (typeAttr.includes('png') || typeAttr.includes('svg') || /\.(png|svg)$/.test(path))) meta.iconUrl ??= resolved;
      continue;
    }

    const type = attr(tag, 'type')?.toLowerCase() ?? '';
    const isFeed =
      rel.split(/\s+/).includes('alternate') &&
      (type.includes('rss') || type.includes('atom') || type.includes('xml'));
    if (!isFeed) continue;

    const resolved = resolveUrl(href, baseUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      meta.feedUrls.push(resolved);
    }
  }

  collectProjectLinks(html, baseUrl, meta);

  return meta;
}

/**
 * Harvest repository and documentation links from anchors.
 *
 * Only `owner` and `owner/repo` GitHub URLs are kept — a link to an issue, a
 * gist or a user's avatar says nothing about which repository is the project's.
 */
function collectProjectLinks(html: string, baseUrl: string | undefined, meta: HtmlMetadata): void {
  const github = new Set<string>();
  const docs = new Set<string>();

  let baseHost: string | undefined;
  if (baseUrl !== undefined) {
    try {
      baseHost = new URL(baseUrl).hostname;
    } catch {
      baseHost = undefined;
    }
  }

  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href');
    if (!href) continue;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) continue;

    let parsed: URL;
    try {
      parsed = new URL(resolved);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const segments = parsed.pathname.split('/').filter(Boolean);

    // Only `owner/repo` identifies a repository. A bare `github.com/org` link
    // names an organisation, not the project's code, and cannot be ingested.
    if (host === 'github.com') {
      const [owner, repo] = segments;
      if (
        segments.length === 2 &&
        owner !== undefined &&
        repo !== undefined &&
        !GITHUB_RESERVED_OWNERS.has(owner.toLowerCase()) &&
        !GITHUB_REPO_SUBPATHS.has(repo.toLowerCase()) &&
        github.size < MAX_LINKS_PER_KIND
      ) {
        // `.git` suffixes come from clone URLs and name the same repository.
        github.add(`https://github.com/${owner}/${repo.replace(/\.git$/i, '')}`);
      }
      continue;
    }

    // Documentation counts only when the project publishes it on its own
    // domain. A link to someone else's docs describes what the project uses,
    // not what it has built.
    const sameDomain =
      baseHost !== undefined && registrableDomain(host) === registrableDomain(baseHost);
    const isDocs =
      sameDomain && (host.startsWith('docs.') || /^\/docs(\/|$)/i.test(parsed.pathname));
    if (isDocs && docs.size < MAX_LINKS_PER_KIND) docs.add(resolved);
  }

  meta.githubUrls = [...github];
  meta.docsUrls = [...docs];
}

function resolveUrl(href: string, baseUrl?: string): string | undefined {
  try {
    return baseUrl ? new URL(href, baseUrl).toString() : new URL(href).toString();
  } catch {
    return undefined;
  }
}

/** Conventional locations to probe for update feeds (PRD V4 section 27). */
export const FEED_DISCOVERY_PATHS = [
  '/rss.xml',
  '/feed.xml',
  '/atom.xml',
  '/feed',
  '/blog/rss.xml',
  '/changelog.xml',
] as const;
