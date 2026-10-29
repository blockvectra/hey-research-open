import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { cleanHttpUrl, twitterUrlFrom } from '../links';
import { opt } from '../optional';

/**
 * Raeto's public, keyless agent-activity reads (2026-10-29, founder "aku nak collab dengan raeto … setuju";
 * docs: https://raeto.cc/developers#public-activity). Raeto sells model calls to agents on Robinhood Chain; a
 * project running agents there may turn sharing on, and only then is it listed.
 *
 *   GET https://api.raeto.cc/v1/public/projects       the projects that turned sharing on: id (`p_…`), name, the
 *                                                     website and X the project gave Raeto, its model calls over the
 *                                                     last 7 days and its Raeto page
 *   GET https://api.raeto.cc/v1/public/projects/<id>  one shared project's model calls by UTC day; a project that is
 *                                                     not shared answers 404
 *
 * Raeto caches both for 60 seconds. HEY reads them from the worker only (`SYNC_RAETO_ACTIVITY`), never on a page
 * request, on the `raeto-public` budget.
 *
 * **Activity, never spend.** The project read also carries `agent_wallets`, a count of the agents' accounts: it is
 * dropped here and never leaves this adapter, and nothing about a wallet, a balance or a spend is asked for or kept —
 * HEY never reads `/v1/public/wallets/<address>/spend` (CLAUDE.md product rule 1). The schemas list only the fields
 * HEY keeps, so any other field Raeto adds is stripped before normalising.
 *
 * Unknown is never zero: a missing or malformed `calls7d` is absent, never 0; a day entry that is not a date with a
 * whole, non-negative count is left out, never counted as 0.
 */
export const RAETO_PUBLIC_API_BASE_URL = 'https://api.raeto.cc/v1/public';
/** Where a reader reads what the two endpoints are. */
export const RAETO_PUBLIC_ACTIVITY_DOCS_URL = 'https://raeto.cc/developers#public-activity';

/** Raeto caches 60 s; HEY reads a few times a day, unconditionally (each answer is small). */
const CACHE_TTL_SECONDS = 60;
/** A Raeto project id, as the list names one (`p_…`); anything else is never put into a URL. */
export const RAETO_PROJECT_ID_PATTERN = /^p_[A-Za-z0-9_-]{1,64}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Days one project read keeps at most: a year, far beyond the 7 days the docs describe. */
const MAX_DAYS = 366;
/** Projects one list read keeps at most. */
const MAX_PROJECTS = 2_000;
const MAX_BYTES = 2 * 1024 * 1024;

const count = z.number().int().nonnegative();

const listEntrySchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  website: z.string().nullish(),
  x: z.string().nullish(),
  calls7d: z.unknown().optional(),
  url: z.string().nullish(),
});

const listSchema = z.object({
  object: z.literal('list'),
  count: z.number().nullish(),
  updated: z.string().nullish(),
  note: z.string().nullish(),
  data: z.array(listEntrySchema),
});

const daySchema = z.object({ day: z.unknown(), calls: z.unknown() });

const activitySchema = z.object({
  object: z.literal('project_activity'),
  name: z.string().nullish(),
  calls7d: z.unknown().optional(),
  // `agent_wallets` is deliberately not listed: zod strips it, so it never reaches `normalize`.
  days: z.array(daySchema).nullish(),
});

/** One project Raeto lists as sharing its agents' activity, as Raeto states it. */
export type RaetoSharedProject = {
  /** Raeto's project id, `p_…`. */
  id: string;
  name?: string;
  /** The website the project gave Raeto, an absolute http(s) URL. */
  websiteUrl?: string;
  /** The X account the project gave Raeto, as an x.com URL. */
  xUrl?: string;
  /** Model calls across the project's agents over the last 7 days; absent when Raeto gave none. */
  calls7d?: number;
  /** The project's page on raeto.cc; absent unless it is on Raeto's own host. */
  raetoUrl?: string;
};

export type RaetoSharedProjectList = {
  projects: RaetoSharedProject[];
  /** When Raeto says the list was last updated, when it says. */
  updatedAt?: Date;
};

export type RaetoActivityDay = { day: string; calls: number };

/** One shared project's model calls by UTC day. Never a wallet, a balance or a spend. */
export type RaetoProjectActivity = {
  id: string;
  name?: string;
  calls7d?: number;
  days: RaetoActivityDay[];
};

export type RaetoPublicListInput = { baseUrl?: string };
export type RaetoPublicActivityInput = { id: string; baseUrl?: string };

const countOf = (value: unknown): number | undefined => {
  const parsed = count.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const isRaetoHost = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'raeto.cc' || host.endsWith('.raeto.cc');
  } catch {
    return false;
  }
};

/** A website as a project typed it: an absolute URL, or a bare host Raeto kept without its scheme. */
const websiteOf = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const direct = cleanHttpUrl(trimmed);
  if (direct) return direct;
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed) ? cleanHttpUrl(`https://${trimmed}`) : undefined;
};

const xOf = (value: string | null | undefined): string | undefined => {
  const url = twitterUrlFrom(value);
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^(www\.|mobile\.)/, '');
    return host === 'x.com' || host === 'twitter.com' ? url : undefined;
  } catch {
    return undefined;
  }
};

const dateOk = (day: string): boolean => {
  if (!DAY_PATTERN.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
};

/** Pure: the day entries HEY keeps — a real date and a whole, non-negative count, one per day, oldest first. */
export function raetoActivityDays(raw: readonly { day: unknown; calls: unknown }[] | null | undefined): RaetoActivityDay[] {
  const byDay = new Map<string, number>();
  for (const entry of raw ?? []) {
    const day = typeof entry.day === 'string' ? entry.day.trim() : '';
    const calls = countOf(entry.calls);
    if (!dateOk(day) || calls === undefined) continue;
    // A day named twice keeps its first figure: Raeto's answer is one figure a day, and HEY never adds two.
    if (!byDay.has(day)) byDay.set(day, calls);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-MAX_DAYS)
    .map(([day, calls]) => ({ day, calls }));
}

const base = (input: { baseUrl?: string }): string => (input.baseUrl ?? RAETO_PUBLIC_API_BASE_URL).replace(/\/$/, '');

export function createRaetoPublicProjectsAdapter(): SourceAdapter<RaetoPublicListInput, RaetoSharedProjectList> {
  return {
    name: 'raeto-public-projects',
    canHandle() {
      return true;
    },
    fetch(input, ctx: SourceContext): Promise<SourceResult<RaetoSharedProjectList>> {
      return performSourceFetch(
        ctx,
        { url: `${base(input)}/projects`, conditional: false, headers: { accept: 'application/json' }, maxBytes: MAX_BYTES },
        {
          schema: listSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): RaetoSharedProjectList => {
            const projects: RaetoSharedProject[] = [];
            const seen = new Set<string>();
            for (const entry of raw.data) {
              const id = entry.id.trim();
              if (!RAETO_PROJECT_ID_PATTERN.test(id) || seen.has(id)) continue;
              seen.add(id);
              const raetoUrl = cleanHttpUrl(entry.url);
              projects.push({
                id,
                ...opt('name', entry.name?.trim() || undefined),
                ...opt('websiteUrl', websiteOf(entry.website)),
                ...opt('xUrl', xOf(entry.x)),
                ...opt('calls7d', countOf(entry.calls7d)),
                ...opt('raetoUrl', raetoUrl && isRaetoHost(raetoUrl) ? raetoUrl : undefined),
              });
              if (projects.length >= MAX_PROJECTS) break;
            }
            const updated = raw.updated ? new Date(raw.updated) : undefined;
            return { projects, ...opt('updatedAt', updated && !Number.isNaN(updated.getTime()) ? updated : undefined) };
          },
        },
      );
    },
  };
}

export function createRaetoPublicActivityAdapter(): SourceAdapter<RaetoPublicActivityInput, RaetoProjectActivity> {
  return {
    name: 'raeto-public-activity',
    canHandle(input) {
      return RAETO_PROJECT_ID_PATTERN.test(input.id);
    },
    fetch(input, ctx: SourceContext): Promise<SourceResult<RaetoProjectActivity>> {
      return performSourceFetch(
        ctx,
        { url: `${base(input)}/projects/${encodeURIComponent(input.id)}`, conditional: false, headers: { accept: 'application/json' }, maxBytes: MAX_BYTES },
        {
          schema: activitySchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): RaetoProjectActivity => ({
            id: input.id,
            ...opt('name', raw.name?.trim() || undefined),
            ...opt('calls7d', countOf(raw.calls7d)),
            days: raetoActivityDays(raw.days),
          }),
        },
      );
    },
  };
}
