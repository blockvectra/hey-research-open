import { z } from 'zod';

import { errorResult, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { keepToProviderHost, printableToken } from './provider-host';

/**
 * OSV (osv.dev) — keyless advisory lookups (2026-09-27, brief §33).
 *
 * Two reads against one configured host:
 *
 * - `POST /v1/querybatch` — up to 1,000 `(ecosystem, name, version)` queries
 *   in one request; each answer is only the advisory ids and their modified
 *   times.
 * - `GET /v1/vulns/{id}` — one advisory: aliases, a one-line summary, the
 *   affected ranges and fixed versions. The long free-text `details`, the
 *   references and any severity rating are deliberately not declared.
 *
 * An advisory is context about a published package version, never a verdict
 * about a project, and it never enters any score.
 */
export const OSV_BASE_URL = 'https://api.osv.dev';

/** OSV's ecosystem names for the registries HEY maps packages from. */
export const OSV_ECOSYSTEMS = ['npm', 'PyPI', 'Go', 'crates.io', 'Maven', 'NuGet', 'RubyGems', 'Packagist', 'Hex', 'Pub'] as const;
export type OsvEcosystem = (typeof OSV_ECOSYSTEMS)[number];

/** OSV's documented ceiling for one batch. */
export const OSV_MAX_BATCH = 1_000;

const CACHE_TTL_SECONDS = 3_600;
const TIMEOUT_MS = 30_000;
const BATCH_MAX_BYTES = 2 * 1024 * 1024;
const VULN_MAX_BYTES = 1024 * 1024;
const ADVISORY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,100}$/;
const SUMMARY_MAX = 300;

export const osvBatchSchema = z.object({
  results: z.array(
    z.object({
      vulns: z.array(z.object({ id: z.string(), modified: z.string().nullish() })).nullish(),
      next_page_token: z.string().nullish(),
    }),
  ),
});

const eventSchema = z.object({
  introduced: z.string().nullish(),
  fixed: z.string().nullish(),
  last_affected: z.string().nullish(),
  limit: z.string().nullish(),
});

export const osvVulnSchema = z.object({
  id: z.string(),
  summary: z.string().nullish(),
  aliases: z.array(z.string()).nullish(),
  published: z.string().nullish(),
  modified: z.string().nullish(),
  withdrawn: z.string().nullish(),
  affected: z
    .array(
      z.object({
        package: z.object({ ecosystem: z.string(), name: z.string() }).nullish(),
        ranges: z.array(z.object({ type: z.string(), events: z.array(eventSchema) })).nullish(),
      }),
    )
    .nullish(),
});

export type OsvQuery = { ecosystem: OsvEcosystem; name: string; version: string };

export type OsvBatchAnswer = {
  /** In the order the queries were sent. */
  results: { ids: string[]; modified: Record<string, string>; truncated: boolean }[];
};

export type OsvRangeEvent = { introduced?: string; fixed?: string; lastAffected?: string; limit?: string };

export type OsvAdvisory = {
  id: string;
  aliases: string[];
  summary?: string;
  publishedAt?: Date;
  modifiedAt?: Date;
  withdrawnAt?: Date;
  affected: { ecosystem: string; name: string; ranges: { type: string; events: OsvRangeEvent[] }[] }[];
};

export type OsvBatchInput = { queries: OsvQuery[]; baseUrl?: string };
export type OsvVulnInput = { id: string; baseUrl?: string };

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const baseOf = (input: { baseUrl?: string }): string => (input.baseUrl ?? OSV_BASE_URL).replace(/\/$/, '');
const bounded = (ctx: SourceContext): SourceContext => ({ ...ctx, timeoutMs: Math.min(ctx.timeoutMs, TIMEOUT_MS) });
const validToken = (value: string): boolean => printableToken(value, 300);

export function createOsvBatchAdapter(): SourceAdapter<OsvBatchInput, OsvBatchAnswer> {
  return {
    name: 'osv-querybatch',
    canHandle: (input) =>
      input.queries.length > 0 &&
      input.queries.length <= OSV_MAX_BATCH &&
      input.queries.every((query) => (OSV_ECOSYSTEMS as readonly string[]).includes(query.ecosystem) && validToken(query.name) && validToken(query.version)),
    async fetch(input, ctx): Promise<SourceResult<OsvBatchAnswer>> {
      const base = baseOf(input);
      const body = JSON.stringify({
        queries: input.queries.map((query) => ({ package: { ecosystem: query.ecosystem, name: query.name }, version: query.version })),
      });
      const result = await performSourceFetch(
        bounded(ctx),
        {
          url: `${base}/v1/querybatch`,
          method: 'POST',
          body,
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          maxBytes: BATCH_MAX_BYTES,
          allowedContentTypes: ['application/json'],
          conditional: false,
        },
        {
          schema: osvBatchSchema,
          parse: (text) => JSON.parse(text) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): OsvBatchAnswer => ({
            results: raw.results.map((entry) => ({
              ids: (entry.vulns ?? []).map((vuln) => vuln.id).filter((id) => ADVISORY_ID.test(id)),
              modified: Object.fromEntries((entry.vulns ?? []).filter((vuln) => vuln.modified).map((vuln) => [vuln.id, vuln.modified as string])),
              truncated: Boolean(entry.next_page_token),
            })),
          }),
        },
      );
      const kept = keepToProviderHost(result, base);
      // One answer per query, in order, or the answer cannot be attributed at all.
      if (kept.status === 'fresh' && kept.data && kept.data.results.length !== input.queries.length) {
        return errorResult(ctx, 'INVALID_RESPONSE', `querybatch answered ${kept.data.results.length} results for ${input.queries.length} queries`, {
          sourceUrl: `${base}/v1/querybatch`,
        });
      }
      return kept;
    },
  };
}

export function createOsvVulnAdapter(): SourceAdapter<OsvVulnInput, OsvAdvisory> {
  return {
    name: 'osv-vuln',
    canHandle: (input) => ADVISORY_ID.test(input.id),
    async fetch(input, ctx): Promise<SourceResult<OsvAdvisory>> {
      const base = baseOf(input);
      const result = await performSourceFetch(
        bounded(ctx),
        {
          url: `${base}/v1/vulns/${encodeURIComponent(input.id)}`,
          headers: { accept: 'application/json' },
          maxBytes: VULN_MAX_BYTES,
          allowedContentTypes: ['application/json'],
          conditional: false,
        },
        {
          schema: osvVulnSchema,
          parse: (text) => JSON.parse(text) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): OsvAdvisory => ({
            id: raw.id,
            aliases: raw.aliases ?? [],
            affected: (raw.affected ?? [])
              .filter((entry) => entry.package)
              .map((entry) => ({
                ecosystem: entry.package?.ecosystem ?? '',
                name: entry.package?.name ?? '',
                ranges: (entry.ranges ?? []).map((range) => ({
                  type: range.type,
                  events: range.events.map((event) => ({
                    ...opt('introduced', event.introduced ?? undefined),
                    ...opt('fixed', event.fixed ?? undefined),
                    ...opt('lastAffected', event.last_affected ?? undefined),
                    ...opt('limit', event.limit ?? undefined),
                  })),
                })),
              })),
            ...opt('summary', raw.summary ? raw.summary.trim().slice(0, SUMMARY_MAX) : undefined),
            ...opt('publishedAt', toDate(raw.published)),
            ...opt('modifiedAt', toDate(raw.modified)),
            ...opt('withdrawnAt', toDate(raw.withdrawn)),
          }),
        },
      );
      return keepToProviderHost(result, base);
    },
  };
}
