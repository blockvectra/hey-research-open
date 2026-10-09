import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { findBadgePlacement, type BadgeTarget } from '../badge-match';
import { extractHtmlMetadata, type HtmlMetadata } from '../html';
import { performSourceFetch } from '../http/perform';

/**
 * Generic website metadata (PRD V4 section 27).
 *
 * Fetches one page — never crawls a whole site — with SSRF protection, a size cap,
 * a content-type allowlist and conditional requests so unchanged pages cost nothing.
 */
export type WebsiteInput = {
  url: string;
  /**
   * Strings to look for in the page body (2026-09-06).
   *
   * A site that names a token's contract has acknowledged it, which is the only
   * cheap evidence that the project actually runs the domain it claims. The
   * search happens here so a two-megabyte page body never crosses out of the
   * adapter; only the verdict does.
   */
  mentions?: readonly string[];
  /**
   * A project's HEY badge to look for (2026-10-09, `badge-match.ts`). Like
   * `mentions`, the search happens here so the body never leaves the adapter;
   * only the verdict does (`badge`).
   */
  badge?: BadgeTarget;
};

export type WebsiteMetadata = HtmlMetadata & {
  url: string;
  /** Hash of the response body; unchanged hashes skip downstream extraction. */
  contentHash: string;
  /** Which of the requested `mentions` the page actually contains, lowercased. */
  mentioned?: string[];
  /**
   * Which of `mentioned` appear *only* inside a list of contract addresses
   * (2026-10-02, outsider audit OA-A): every occurrence has at least
   * `LISTED_MIN_NEIGHBOURS` other distinct addresses within
   * `LISTED_WINDOW_CHARS` of it. A page of stock tokens it trades or of the
   * contracts it integrates names each of them; that is a contract the site
   * uses, not the one it issues.
   */
  listed?: string[];
  /** Whether the page shows the requested `badge`; absent when none was asked for. */
  badge?: { found: boolean };
};

/** Characters either side of a mention searched for other addresses. */
export const LISTED_WINDOW_CHARS = 600;
/** Other distinct addresses that make a mention part of a list. */
export const LISTED_MIN_NEIGHBOURS = 3;

const ADDRESS_IN_PAGE = /0x[0-9a-f]{40}/g;

/**
 * The needles of `mentioned` that the page names only inside a list of
 * contract addresses. Pure; `haystack` is the lower-cased body.
 */
export function listedMentions(haystack: string, mentioned: readonly string[]): string[] {
  const addresses: { at: number; address: string }[] = [];
  for (const match of haystack.matchAll(ADDRESS_IN_PAGE)) addresses.push({ at: match.index ?? 0, address: match[0] });
  const bare = (value: string) => value.replace(/^0x/, '');
  return mentioned.filter((needle) => {
    const own = bare(needle);
    let from = 0;
    let seen = false;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      seen = true;
      const neighbours = new Set<string>();
      for (const other of addresses) {
        if (Math.abs(other.at - at) > LISTED_WINDOW_CHARS) continue;
        const address = bare(other.address);
        if (address !== own) neighbours.add(address);
      }
      // One mention standing on its own is enough: the page names it as itself somewhere.
      if (neighbours.size < LISTED_MIN_NEIGHBOURS) return false;
      from = at + needle.length;
    }
    return seen;
  });
}

const CACHE_TTL_SECONDS = 21_600;

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'] as const;

/** 2 MB is generous for a marketing or docs page. */
const MAX_HTML_BYTES = 2 * 1024 * 1024;

export function createWebsiteAdapter(): SourceAdapter<WebsiteInput, WebsiteMetadata> {
  return {
    name: 'website',

    canHandle(input) {
      return /^https?:\/\//i.test(input.url);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<WebsiteMetadata>> {
      return performSourceFetch(
        ctx,
        {
          url: input.url,
          headers: { accept: 'text/html,application/xhtml+xml' },
          allowedContentTypes: HTML_CONTENT_TYPES,
          // Builder- and user-submitted, so the SSRF guard applies.
          enforceUrlSafety: true,
          maxBytes: MAX_HTML_BYTES,
        },
        {
          // The body is HTML, so validation happens after extraction.
          schema: z.string(),
          parse: (body) => body,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (body, response): WebsiteMetadata => {
            const finalUrl = response.url ?? input.url;
            const wanted = input.mentions ?? [];
            const haystack = wanted.length > 0 ? body.toLowerCase() : '';
            return {
              ...extractHtmlMetadata(body, finalUrl),
              url: finalUrl,
              contentHash: hashContent(body),
              ...(wanted.length > 0 ? mentionsOf(haystack, wanted) : {}),
              ...(input.badge ? { badge: { found: findBadgePlacement(body, 'html', input.badge).found } } : {}),
            };
          },
        },
      );
    },
  };
}

function mentionsOf(haystack: string, wanted: readonly string[]): { mentioned: string[]; listed: string[] } {
  const mentioned = wanted.map((needle) => needle.toLowerCase()).filter((needle) => needle.length > 0 && haystack.includes(needle));
  return { mentioned, listed: listedMentions(haystack, mentioned) };
}

/**
 * FNV-1a over the body. Only used to detect change, never for security, so a
 * fast non-cryptographic hash is the right tool.
 */
export function hashContent(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
