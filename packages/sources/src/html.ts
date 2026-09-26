import { registrableHost } from './registrable';

/**
 * Minimal HTML metadata extraction.
 *
 * HEY reads a small, fixed set of head elements and never renders or stores raw
 * HTML, so a full DOM parser would be a dependency without a payoff. Everything
 * extracted is decoded and tag-stripped before use (PRD V4 section 27).
 *
 * Linear in the page (2026-09-27, audit G S1): the extractor used five
 * regexes that each rescanned to the end of the page from every unclosed
 * `<a`, `<meta`, `<link` or `<title`, so a hostile 2 MB page held the worker's
 * event loop for about three minutes, after the fetch timeout had stopped
 * applying. One scanner now reads the page left to right once, extraction
 * reads at most `MAX_EXTRACT_CHARS`, and every text helper is a single pass.
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
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  laquo: '«',
  raquo: '»',
  prime: '′',
  // symbols and currency
  times: '×',
  minus: '−',
  plusmn: '±',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  rarr: '→',
  larr: '←',
};

/** U+FFFD, what HTML substitutes for a reference to no character. */
export const REPLACEMENT_CHARACTER = '�';

/**
 * A numeric reference's character, clamped (2026-09-27, audit G S3). HTML maps
 * NUL, a surrogate and anything past U+10FFFF to U+FFFD; `String.fromCodePoint`
 * throws on the last, so one `&#99999999;` in a title made the whole page
 * unreadable and the read was filed as a network failure.
 */
const codePointText = (code: number): string =>
  Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : REPLACEMENT_CHARACTER;

/** Bounded alternatives, so a long run of letters or digits cannot make one match expensive. */
const ENTITY_PATTERN = /&(#[xX][0-9a-fA-F]{1,16}|#[0-9]{1,16}|[a-zA-Z]{1,32});/g;

export function decodeEntities(value: string): string {
  return value.replace(ENTITY_PATTERN, (match, entity: string) => {
    const known = ENTITIES[entity.toLowerCase()];
    if (known !== undefined) return known;
    if (entity.startsWith('#x') || entity.startsWith('#X')) return codePointText(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return codePointText(Number.parseInt(entity.slice(1), 10));
    return match;
  });
}

/**
 * Replace every `<…>` with a space in one pass (2026-09-27, audit G S1).
 * `/<[^>]*>/g` restarted its scan at each `<`, so text with many `<` and no
 * `>` cost the square of its length. The next `>` is found once and reused
 * until the scan passes it; a `<` with no `>` after it stays text, as before.
 */
function stripTags(value: string): string {
  const parts: string[] = [];
  let position = 0;
  let close = -2;
  for (;;) {
    const open = value.indexOf('<', position);
    if (open === -1) break;
    if (close !== -1 && close < open) close = value.indexOf('>', open);
    if (close === -1) break;
    parts.push(value.slice(position, open), ' ');
    position = close + 1;
  }
  parts.push(value.slice(position));
  return parts.join('');
}

/** Strip every tag, decode entities and collapse whitespace. */
export function sanitizeText(value: string): string {
  return decodeEntities(stripTags(value))
    .replace(/\s+/g, ' ')
    .trim();
}

const isSpace = (code: number): boolean => code === 32 || (code >= 9 && code <= 13);

/**
 * A tag's attributes, read left to right once (2026-09-27, audit G S1). The
 * first occurrence of a name wins, as the regex it replaces did; names are
 * lower-cased; values are raw (not yet entity-decoded). `tag` runs from `<`
 * to the first `>`, so it is bounded by the scanner's tag cap.
 */
function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const end = tag.endsWith('>') ? tag.length - 1 : tag.length;
  let index = 1;
  while (index < end && !isSpace(tag.charCodeAt(index)) && tag[index] !== '/') index += 1;
  while (index < end) {
    while (index < end && (isSpace(tag.charCodeAt(index)) || tag[index] === '/')) index += 1;
    const nameStart = index;
    while (index < end && !isSpace(tag.charCodeAt(index)) && tag[index] !== '=' && tag[index] !== '/') index += 1;
    if (index === nameStart) {
      index += 1; // a stray `=`
      continue;
    }
    const name = tag.slice(nameStart, index).toLowerCase();
    while (index < end && isSpace(tag.charCodeAt(index))) index += 1;
    let value = '';
    if (tag[index] === '=') {
      index += 1;
      while (index < end && isSpace(tag.charCodeAt(index))) index += 1;
      const quote = tag[index];
      if (quote === '"' || quote === "'") {
        const closing = tag.indexOf(quote, index + 1);
        const valueEnd = closing === -1 || closing > end ? end : closing;
        value = tag.slice(index + 1, valueEnd);
        index = valueEnd + 1;
      } else {
        const valueStart = index;
        while (index < end && !isSpace(tag.charCodeAt(index))) index += 1;
        value = tag.slice(valueStart, index);
      }
    }
    if (!attributes.has(name)) attributes.set(name, value);
  }
  return attributes;
}

const attr = (attributes: Map<string, string>, name: string): string | undefined => {
  const raw = attributes.get(name);
  return raw === undefined ? undefined : decodeEntities(raw).trim();
};

/**
 * How much of a page extraction reads (2026-09-27, audit G recommendation 1):
 * the first 512 Ki characters. A page's head, its icons and its navigation
 * links sit at the top; the 2 MB the website adapter accepts still serves
 * change detection and the mention check, which read the whole body.
 */
export const MAX_EXTRACT_CHARS = 512 * 1024;
/** A tag longer than this is not one HEY reads (a real `<meta>` or `<a>` is well under 1 KB). */
export const MAX_TAG_CHARS = 8 * 1024;
/** Anchors examined per page; links are capped per kind as well. */
export const MAX_ANCHORS = 4_000;
/** Raw title text handed to the sanitizer. */
const MAX_TITLE_CHARS = 8 * 1024;

const WANTED_TAGS = new Set(['title', 'meta', 'link', 'a']);

const isTagNameCode = (code: number): boolean =>
  (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57);

type ScannedTag = { name: 'meta' | 'link' | 'a'; attributes: Map<string, string> };

/**
 * One left-to-right pass yielding the tags extraction reads (2026-09-27,
 * audit G S1). The next `>` is found once and reused until the scan passes
 * it, so an unclosed tag costs one search however many follow it; a tag over
 * `MAX_TAG_CHARS` is skipped; the title's closing tag is looked for once.
 */
function scanTags(html: string, visit: (tag: ScannedTag) => void): { title?: string } {
  const result: { title?: string } = {};
  let close = -2;
  // The closing `</title` is searched for once: with none in the page, every later `<title>` would search again.
  let titleSearched = false;
  let open = html.indexOf('<');
  while (open !== -1) {
    let nameEnd = open + 1;
    while (nameEnd < html.length && nameEnd - open <= 6 && isTagNameCode(html.charCodeAt(nameEnd))) nameEnd += 1;
    const name = html.slice(open + 1, nameEnd).toLowerCase();
    const boundary = html.charCodeAt(nameEnd);
    const wanted =
      WANTED_TAGS.has(name) && (Number.isNaN(boundary) || isSpace(boundary) || boundary === 47 || boundary === 62);
    if (!wanted) {
      open = html.indexOf('<', open + 1);
      continue;
    }
    if (close !== -1 && close < nameEnd) close = html.indexOf('>', nameEnd);
    if (close === -1) break; // no `>` after this point: no complete tag remains
    if (close - open > MAX_TAG_CHARS) {
      open = html.indexOf('<', open + 1);
      continue;
    }
    let next = close + 1;
    if (name === 'title') {
      if (!titleSearched) {
        titleSearched = true;
        const closing = /<\/title/gi;
        closing.lastIndex = next;
        const found = closing.exec(html);
        if (found) {
          result.title = html.slice(next, Math.min(found.index, next + MAX_TITLE_CHARS));
          next = found.index;
        }
      }
    } else {
      visit({ name: name as ScannedTag['name'], attributes: parseAttributes(html.slice(open, close + 1)) });
    }
    open = html.indexOf('<', next);
  }
  return result;
}

/**
 * A public forge repository linked from a page (2026-09-27, brief §18–19):
 * GitLab.com or Codeberg only, never a self-hosted instance. Counted, not
 * ingested — HEY has no forge adapter and measured no real use of one; the
 * harvester records how many pages link one, so building an adapter rests on
 * a number.
 */
export type ForgeRepoLink = {
  forge: 'gitlab' | 'codeberg';
  /** Canonical `https://<forge host>/<path>`. */
  url: string;
  /** `group/…/project` on GitLab, `owner/repo` on Codeberg. */
  path: string;
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
  /** GitLab.com and Codeberg repository links the page publishes (see `ForgeRepoLink`). */
  forgeUrls: ForgeRepoLink[];
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

/** GitLab.com top-level paths that are the site's own pages, not a group. */
const GITLAB_RESERVED = new Set([
  '-', 'abuse_reports', 'admin', 'api', 'assets', 'dashboard', 'explore', 'groups', 'help', 'ide', 'import',
  'invites', 'jwt', 'oauth', 'pages', 'profile', 'projects', 'public', 'search', 'snippets', 'uploads', 'users',
]);

/** Codeberg (Forgejo) top-level paths that are the site's own pages, not an owner. */
const CODEBERG_RESERVED = new Set([
  '-', 'admin', 'api', 'assets', 'attachments', 'avatars', 'explore', 'issues', 'login', 'milestones',
  'notifications', 'org', 'pulls', 'repo', 'swagger', 'user',
]);

const FORGE_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * The repository a GitLab.com or Codeberg URL names, or undefined. Like the
 * GitHub rule, only the repository's own root counts: `group/project` (any
 * depth of subgroups, at most eight) on GitLab, `owner/repo` on Codeberg.
 */
export function parseForgeRepoUrl(url: URL): ForgeRepoLink | undefined {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments.length - 1;
  if (last >= 0) segments[last] = segments[last]!.replace(/\.git$/i, '');
  if (!segments.every((segment) => FORGE_SEGMENT.test(segment))) return undefined;

  if (host === 'gitlab.com') {
    if (segments.length < 2 || segments.length > 8 || GITLAB_RESERVED.has(segments[0]!.toLowerCase())) return undefined;
    if (segments.includes('-')) return undefined;
    const path = segments.join('/');
    return { forge: 'gitlab', url: `https://gitlab.com/${path}`, path };
  }
  if (host === 'codeberg.org') {
    if (segments.length !== 2 || CODEBERG_RESERVED.has(segments[0]!.toLowerCase())) return undefined;
    const path = segments.join('/');
    return { forge: 'codeberg', url: `https://codeberg.org/${path}`, path };
  }
  return undefined;
}

export function extractHtmlMetadata(html: string, baseUrl?: string): HtmlMetadata {
  const meta: HtmlMetadata = { feedUrls: [], githubUrls: [], docsUrls: [], forgeUrls: [] };
  const page = html.length > MAX_EXTRACT_CHARS ? html.slice(0, MAX_EXTRACT_CHARS) : html;

  const seenFeeds = new Set<string>();
  let touchIcon = false;
  const links = new ProjectLinks(baseUrl);

  const { title } = scanTags(page, ({ name, attributes }) => {
    if (name === 'meta') {
      const key = (attr(attributes, 'property') ?? attr(attributes, 'name'))?.toLowerCase();
      const content = attr(attributes, 'content');
      if (!key || !content) return;

      if (key === 'description') meta.description ??= sanitizeText(content);
      else if (key === 'og:title') meta.ogTitle ??= sanitizeText(content);
      else if (key === 'og:description') meta.ogDescription ??= sanitizeText(content);
      else if (key === 'og:image') meta.ogImage ??= content;
      return;
    }

    if (name === 'a') {
      links.add(attr(attributes, 'href'));
      return;
    }

    const rel = attr(attributes, 'rel')?.toLowerCase();
    const href = attr(attributes, 'href');
    if (!rel || !href) return;

    if (rel === 'canonical') {
      meta.canonicalUrl ??= resolveUrl(href, baseUrl);
      return;
    }

    const rels = rel.split(/\s+/);
    if (rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) {
      const resolved = resolveUrl(href, baseUrl);
      if (resolved) {
        // An Apple touch icon is always square and large enough; it wins over any plain icon seen so far.
        meta.iconUrl = touchIcon ? meta.iconUrl : resolved;
        touchIcon = true;
      }
      return;
    }
    if (rels.includes('icon') && !touchIcon) {
      const resolved = resolveUrl(href, baseUrl);
      const typeAttr = attr(attributes, 'type')?.toLowerCase() ?? '';
      const path = resolved ? new URL(resolved).pathname.toLowerCase() : '';
      if (resolved && (typeAttr.includes('png') || typeAttr.includes('svg') || /\.(png|svg)$/.test(path))) meta.iconUrl ??= resolved;
      return;
    }

    const type = attr(attributes, 'type')?.toLowerCase() ?? '';
    const isFeed = rels.includes('alternate') && (type.includes('rss') || type.includes('atom') || type.includes('xml'));
    if (!isFeed) return;

    const resolved = resolveUrl(href, baseUrl);
    if (resolved && !seenFeeds.has(resolved)) {
      seenFeeds.add(resolved);
      meta.feedUrls.push(resolved);
    }
  });

  if (title) meta.title = sanitizeText(title);
  meta.githubUrls = [...links.github];
  meta.docsUrls = [...links.docs];
  meta.forgeUrls = [...links.forges.values()];
  return meta;
}

/**
 * Repository and documentation links harvested from anchors.
 *
 * Only `owner/repo` GitHub URLs are kept — a link to an issue, a gist or a
 * user's avatar says nothing about which repository is the project's.
 */
class ProjectLinks {
  readonly github = new Set<string>();
  readonly docs = new Set<string>();
  readonly forges = new Map<string, ForgeRepoLink>();
  private anchors = 0;
  private readonly baseHost: string | undefined;

  constructor(private readonly baseUrl: string | undefined) {
    let host: string | undefined;
    if (baseUrl !== undefined) {
      try {
        host = new URL(baseUrl).hostname;
      } catch {
        host = undefined;
      }
    }
    this.baseHost = host;
  }

  add(href: string | undefined): void {
    if (!href) return;
    this.anchors += 1;
    if (this.anchors > MAX_ANCHORS) return;
    const resolved = resolveUrl(href, this.baseUrl);
    if (!resolved) return;

    let parsed: URL;
    try {
      parsed = new URL(resolved);
    } catch {
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;

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
        this.github.size < MAX_LINKS_PER_KIND
      ) {
        // `.git` suffixes come from clone URLs and name the same repository.
        this.github.add(`https://github.com/${owner}/${repo.replace(/\.git$/i, '')}`);
      }
      return;
    }

    if (host === 'gitlab.com' || host === 'codeberg.org') {
      const forge = parseForgeRepoUrl(parsed);
      const key = forge ? `${forge.forge}:${forge.path.toLowerCase()}` : undefined;
      if (forge && key && !this.forges.has(key) && this.forges.size < MAX_LINKS_PER_KIND) this.forges.set(key, forge);
      return;
    }

    // Documentation counts only when the project publishes it on its own
    // domain. A link to someone else's docs describes what the project uses,
    // not what it has built. On a shared host the tenant is the domain
    // (2026-09-27): `docs.other.vercel.app` is not `mine.vercel.app`'s.
    const site = this.baseHost === undefined ? undefined : registrableHost(this.baseHost);
    const sameDomain = site !== undefined && registrableHost(host) === site;
    const isDocs = sameDomain && (host.startsWith('docs.') || /^\/docs(\/|$)/i.test(parsed.pathname));
    if (isDocs && this.docs.size < MAX_LINKS_PER_KIND) this.docs.add(resolved);
  }
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
