import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { sanitizeText } from '../html';
import { performSourceFetch } from '../http/perform';
import { hashContent } from './website';

/**
 * RSS / Atom / changelog ingestion (PRD V4 section 27).
 *
 * Entries become candidate ShipEvents in M4; this adapter only normalizes them.
 * Conditional requests plus a content hash mean an unchanged feed does no work.
 */
export type FeedInput = { url: string };

export type FeedEntry = {
  /** Stable id for dedupe: the feed's own guid/id, else the entry link. */
  externalId: string;
  title: string;
  link?: string;
  summary?: string;
  publishedAt?: Date;
};

export type FeedResult = {
  feedTitle?: string;
  entries: FeedEntry[];
  contentHash: string;
};

const CACHE_TTL_SECONDS = 7200;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 50;

const FEED_CONTENT_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'application/rdf+xml',
  'text/html',
] as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    const inner = (value as { '#text': unknown })['#text'];
    return typeof inner === 'string' ? sanitizeText(inner) : undefined;
  }
  return undefined;
};

/**
 * `YYYY-MM-DD HH:MM:SS` or ISO-8601 without a zone or offset. `new Date()`
 * reads the first as local time and the second as local time too (the spec
 * says UTC only for date-only forms), so the worker's zone would have
 * shifted a feed's dates. A feed that gives no zone is read as UTC.
 */
const ZONELESS_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const toDate = (value: unknown): Date | undefined => {
  const raw = text(value);
  if (!raw) return undefined;
  const normalized = ZONELESS_DATETIME.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/**
 * Atom links are attribute-based; RSS links are element text. Either kind is
 * resolved against the feed's own URL (round-8 audit, 2026-09-18): a
 * relative `/blog/v2-release` used to be stored as the entry's provenance
 * and external id, so it dereferenced to nothing and deduped against nothing.
 * A link that is still not absolute http(s) after resolution is no link.
 */
const linkOf = (entry: Record<string, unknown>, feedUrl: string): string | undefined => {
  const direct = text(entry.link);
  if (direct) return absoluteHttpUrl(direct, feedUrl);

  for (const candidate of asArray(entry.link as unknown)) {
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      const rel = record['@_rel'];
      const href = record['@_href'];
      if (typeof href === 'string' && (rel === undefined || rel === 'alternate')) {
        return absoluteHttpUrl(href, feedUrl);
      }
    }
  }
  return undefined;
};

const absoluteHttpUrl = (href: string, base: string): string | undefined => {
  const trimmed = href.trim();
  // A fragment-only href resolves to the feed itself, which is not the entry's page.
  if (trimmed === '' || trimmed.startsWith('#')) return undefined;
  try {
    const resolved = new URL(trimmed, base);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : undefined;
  } catch {
    return undefined;
  }
};

function normalizeEntries(document: Record<string, unknown>, feedUrl: string): {
  feedTitle?: string;
  entries: FeedEntry[];
} {
  const rss = document.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const atom = document.feed as Record<string, unknown> | undefined;

  const rawEntries = channel
    ? asArray(channel.item as Record<string, unknown>[])
    : asArray(atom?.entry as Record<string, unknown>[]);

  const feedTitle = text(channel?.title ?? atom?.title);

  const entries = rawEntries
    .map((entry): FeedEntry | undefined => {
      const title = text(entry.title);
      const link = linkOf(entry, feedUrl);
      // An entry whose only id would have been an unusable link is dropped:
      // `#` or `javascript:` is not something HEY can cite.
      const externalId = text(entry.guid) ?? text(entry.id) ?? link;
      if (!externalId || !title) return undefined;

      const summary = text(entry.description ?? entry.summary ?? entry.content);
      const publishedAt = toDate(entry.pubDate ?? entry.published ?? entry.updated);

      return {
        externalId,
        title,
        ...(link === undefined ? {} : { link }),
        ...(summary === undefined ? {} : { summary: summary.slice(0, 600) }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
      };
    })
    .filter((entry): entry is FeedEntry => entry !== undefined)
    .slice(0, MAX_ENTRIES);

  return { ...(feedTitle === undefined ? {} : { feedTitle }), entries };
}

export function createFeedAdapter(): SourceAdapter<FeedInput, FeedResult> {
  return {
    name: 'feed',

    canHandle(input) {
      return /^https?:\/\//i.test(input.url);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<FeedResult>> {
      return performSourceFetch(
        ctx,
        {
          url: input.url,
          headers: { accept: 'application/rss+xml, application/atom+xml, application/xml' },
          allowedContentTypes: FEED_CONTENT_TYPES,
          enforceUrlSafety: true,
          maxBytes: MAX_FEED_BYTES,
        },
        {
          schema: z.object({ body: z.string(), document: z.record(z.unknown()) }),
          parse: (body) => ({ body, document: parser.parse(body) as Record<string, unknown> }),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: ({ body, document }, response): FeedResult => ({
            ...normalizeEntries(document, response.url ?? input.url),
            contentHash: hashContent(body),
          }),
        },
      );
    },
  };
}
