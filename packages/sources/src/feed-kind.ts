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
 * One rule, by URL, in TypeScript here and in SQL beside it
 * (`notAReleaseFeedUrlSql` in `@hey/domain`), held equal by a parity test.
 * Discovery never registers such a URL; one already registered is context
 * the quality gate keeps (`not_a_release_feed`).
 */
export const NOT_A_RELEASE_FEED_PATTERN =
  '(^|/)(sitemap[a-z0-9_-]*\\.xml|sitemap)(\\?|#|/?$)|/wp-json/oembed/|[?&]format=xml.*oembed|oembed.*[?&]format=xml|/comments/feed|/feed/comments|[?&]feed=comments-(rss2?|atom)';
const NOT_A_RELEASE_FEED = new RegExp(NOT_A_RELEASE_FEED_PATTERN, 'i');

/** Whether a URL names a sitemap, an oEmbed document or a comments feed rather than a release feed. */
export function isNotAReleaseFeedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
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
