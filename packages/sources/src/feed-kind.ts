/**
 * What is not a release feed (2026-10-02, outsider audit).
 *
 * A site advertises several XML documents with `<link rel="alternate">`, and
 * HEY registered every one of them as the project's feed. Three of them say
 * nothing about what a project shipped:
 *
 *  - a sitemap (`/sitemap.xml`, `sitemap_index.xml`): every page of a docs
 *    site, no entries — read as "a feed HEY looked at and found nothing", it
 *    made Arcus Perps DORMANT beside $68.5K of daily fees;
 *  - a WordPress oEmbed document (`/wp-json/oembed/1.0/embed?…&format=xml`):
 *    the site's own card, not a post;
 *  - a comments feed (`/comments/feed/`, `?feed=comments-rss2`): readers'
 *    comments, filed as "Comment on Isometric Smart City by Andrew" — an
 *    ANNOUNCEMENT ship whose evidence was `#comment-4`.
 *
 * And a fourth (2026-10-07): any feed on HEY's own host (`isHeyOwnUrl`).
 *
 * One rule, by URL, in TypeScript here and in SQL beside it
 * (`notAReleaseFeedUrlSql` in `@hey/domain`), held equal by a parity test.
 * Discovery never registers such a URL; one already registered is context
 * the quality gate keeps (`not_a_release_feed`).
 */
export const NOT_A_RELEASE_FEED_PATTERN =
  '(^|/)(sitemap[a-z0-9_-]*\\.xml|sitemap)(\\?|#|/?$)|/wp-json/oembed/|[?&]format=xml.*oembed|oembed.*[?&]format=xml|/comments/feed|/feed/comments|[?&]feed=comments-(rss2?|atom)';
const NOT_A_RELEASE_FEED = new RegExp(NOT_A_RELEASE_FEED_PATTERN, 'i');

/**
 * HEY's own public domains (2026-10-07). Every feed HEY publishes —
 * `/feed/updates.xml`, `/feed/ships.xml`, `/feed/this-week.xml`, a project's
 * `/project/<slug>/feed.xml` — is HEY's research about projects, never a
 * project's release feed, and a HEY page is never a project's ship. On
 * 2026-10-05 site-feed discovery registered `/feed/updates.xml` as a source of
 * HEY's own project, and every ship HEY recorded came back as a ship of HEY's
 * own: a loop of 876 ships in two days. The running deployment's own host
 * (`APP_URL`) is added by the caller (`heyDeploymentHosts` in `@hey/domain`).
 */
export const HEY_OWN_DOMAINS = ['heyresearch.xyz'] as const;

/** A host as HEY compares its own: lower-case, no trailing dot, no `www.`, no default port. */
export function normalizeOwnHost(hostname: string, port = ''): string {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return port && port !== '80' && port !== '443' ? `${host}:${port}` : host;
}

/**
 * Whether a URL is on one of HEY's own hosts: a canonical domain or any of its
 * subdomains, or one of the deployment's own hosts (`host[:port]` as
 * `normalizeOwnHost` writes it, from `APP_URL`). Held equal to `heyOwnUrlSql`
 * in `@hey/domain` by an integration test.
 */
export function isHeyOwnUrl(url: string | null | undefined, deploymentHosts: readonly string[] = []): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (HEY_OWN_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return true;
  const host = normalizeOwnHost(parsed.hostname, parsed.port);
  return deploymentHosts.some((own) => own === host);
}

/**
 * Whether a URL names a sitemap, an oEmbed document, a comments feed or a feed
 * on HEY's own host rather than a release feed. `deploymentHosts` are the
 * running deployment's own hosts (`heyDeploymentHosts` in `@hey/domain`);
 * HEY's canonical domains are always included.
 */
export function isNotAReleaseFeedUrl(url: string | null | undefined, deploymentHosts: readonly string[] = []): boolean {
  if (!url) return false;
  if (isHeyOwnUrl(url, deploymentHosts)) return true;
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    path = url;
  }
  return NOT_A_RELEASE_FEED.test(path);
}

/**
 * Whether a feed entry is a reader's comment rather than a post: its link or
 * id points at a `#comment-…` anchor, or its title is WordPress's
 * "Comment on <post> by <name>".
 */
export function isCommentEntry(entry: { link?: string | undefined; externalId?: string | undefined; title?: string | undefined }): boolean {
  const anchor = /#comment-\d+/i;
  return anchor.test(entry.link ?? '') || anchor.test(entry.externalId ?? '') || /^comment on .+ by .+$/i.test(entry.title ?? '');
}
