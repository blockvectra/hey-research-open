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
  /**
   * Which of `mentioned` the page disowns (2026-10-12, audit INV-1): a
   * disowning phrase ("not issued or endorsed by", "not our token", "no
   * official token", …) within `DISCLAIMER_WINDOW_CHARS` of the contract, and
   * nearer to it than to any other address on the page. nautilo.ai links the
   * community token whose fees support it and says, in the next sentence, that
   * Nautilo did not issue or endorse it; a substring match read that as the
   * site naming its own token.
   */
  disclaimed?: string[];
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

/** Characters either side of a disowning phrase searched for the contract it speaks of. */
export const DISCLAIMER_WINDOW_CHARS = 600;

/**
 * A page disowning a token (2026-10-12, audit INV-1). Narrow on purpose: it
 * only ever withholds, but a meme calling itself "a community token" or a
 * prelaunch page saying "token not launched yet" names its own token, so
 * neither phrase is here. "Not issued" / "not endorsed" followed by Robinhood
 * is the Robinhood Chain disclaimer many projects print in a footer, about
 * Robinhood rather than the token, and is skipped (`ROBINHOOD_AFTER`).
 */
const DISCLAIMER_IN_PAGE =
  /\bnot (?:issued|endorsed)\b|\b(?:not|isn['’]t) (?:our|an official|the official) token\b|\bno official token\b|\bunofficial token\b|\bnot affiliated with (?:this|the|that|any) token\b|\bdid not (?:issue|endorse)\b/g;
const ROBINHOOD_AFTER = /^[^.<]{0,60}\brobinhood\b/;

/**
 * The needles of `mentioned` the page disowns. Pure; `haystack` is the
 * lower-cased body. Each disowning phrase speaks of the nearest address to it
 * within the window, and of none when two different addresses are equally
 * near: on a "beware: 0xfake is not our token — ours is 0xreal" page the
 * phrase belongs to the fake.
 */
export function disclaimedMentions(haystack: string, mentioned: readonly string[]): string[] {
  if (mentioned.length === 0) return [];
  const bare = (value: string) => value.replace(/^0x/, '');
  const spots: { at: number; end: number; address: string }[] = [];
  for (const match of haystack.matchAll(ADDRESS_IN_PAGE)) {
    const at = match.index ?? 0;
    spots.push({ at, end: at + match[0].length, address: bare(match[0]) });
  }
  // A contract printed without its 0x is still the contract.
  for (const own of new Set(mentioned.map(bare))) {
    for (let at = haystack.indexOf(own); at >= 0; at = haystack.indexOf(own, at + own.length)) spots.push({ at, end: at + own.length, address: own });
  }
  const disowned = new Set<string>();
  for (const phrase of haystack.matchAll(DISCLAIMER_IN_PAGE)) {
    const start = phrase.index ?? 0;
    const end = start + phrase[0].length;
    if (ROBINHOOD_AFTER.test(haystack.slice(end, end + 80))) continue;
    let nearest: { distance: number; addresses: Set<string> } | undefined;
    for (const spot of spots) {
      const distance = spot.at >= end ? spot.at - end : start >= spot.end ? start - spot.end : 0;
      if (distance > DISCLAIMER_WINDOW_CHARS) continue;
      if (!nearest || distance < nearest.distance) nearest = { distance, addresses: new Set([spot.address]) };
      else if (distance === nearest.distance) nearest.addresses.add(spot.address);
    }
    if (nearest && nearest.addresses.size === 1) disowned.add([...nearest.addresses][0]!);
  }
  return mentioned.filter((needle) => disowned.has(bare(needle)));
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

function mentionsOf(haystack: string, wanted: readonly string[]): { mentioned: string[]; listed: string[]; disclaimed: string[] } {
  const mentioned = wanted.map((needle) => needle.toLowerCase()).filter((needle) => needle.length > 0 && haystack.includes(needle));
  return { mentioned, listed: listedMentions(haystack, mentioned), disclaimed: disclaimedMentions(haystack, mentioned) };
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
