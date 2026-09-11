import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
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
};

export type WebsiteMetadata = HtmlMetadata & {
  url: string;
  /** Hash of the response body; unchanged hashes skip downstream extraction. */
  contentHash: string;
  /** Which of the requested `mentions` the page actually contains, lowercased. */
  mentioned?: string[];
};

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
              ...(wanted.length > 0
                ? {
                    mentioned: wanted
                      .map((needle) => needle.toLowerCase())
                      .filter((needle) => needle.length > 0 && haystack.includes(needle)),
                  }
                : {}),
            };
          },
        },
      );
    },
  };
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
