import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { keepToProviderHost } from './provider-host';

/**
 * GitHub — the core builder-activity source (PRD V4 section 26).
 *
 * Fetches repository metadata and releases. Deliberately does NOT return raw
 * commits as individual events: ShipEvent creation caps and aggregates code
 * activity in M4. Stars and forks are carried for display only — popularity is
 * not building, and they must never be scored.
 */
export const GITHUB_DEFAULT_BASE_URL = 'https://api.github.com';

export const githubRepoSchema = z.object({
  /** GitHub's numeric repository id (2026-10-02): unchanged by a rename or a transfer, so it is the repository's identity. */
  id: z.number().optional(),
  full_name: z.string(),
  description: z.string().nullish(),
  html_url: z.string().optional(),
  homepage: z.string().nullish(),
  default_branch: z.string().optional(),
  pushed_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  created_at: z.string().nullish(),
  archived: z.boolean().optional(),
  fork: z.boolean().optional(),
  is_template: z.boolean().optional(),
  /** Present on forks: the repository this one was forked from. */
  parent: z.object({ full_name: z.string() }).nullish(),
  stargazers_count: z.number().optional(),
  open_issues_count: z.number().optional(),
  /** Kilobytes; 0 means the repository has no content yet. */
  size: z.number().optional(),
  /*
   * Developer footprint (2026-09-27, brief §17): already in every `/repos`
   * answer HEY receives, dropped until now. Owner-declared context: topics,
   * the licence GitHub detected, the main language and whether the owner is a
   * user or an organisation. Never a ship, never scored.
   */
  topics: z.array(z.string()).nullish(),
  license: z.object({ spdx_id: z.string().nullish(), key: z.string().nullish() }).nullish(),
  language: z.string().nullish(),
  owner: z.object({ type: z.string().nullish() }).nullish(),
});

export const githubReleasesSchema = z.array(
  z.object({
    id: z.number(),
    tag_name: z.string(),
    name: z.string().nullish(),
    body: z.string().nullish(),
    html_url: z.string().optional(),
    draft: z.boolean().optional(),
    prerelease: z.boolean().optional(),
    published_at: z.string().nullish(),
    created_at: z.string().nullish(),
    /*
     * Release assets (2026-09-27, brief §17): the files attached to a release,
     * already in the payload HEY reads. Name, size and content type only —
     * `download_count` is deliberately not declared, so it never leaves the
     * parser: a count of downloads is popularity, not building.
     */
    assets: z
      .array(
        z.object({
          name: z.string(),
          size: z.number().nullish(),
          content_type: z.string().nullish(),
        }),
      )
      .nullish(),
  }),
);

/** One file attached to a release: what it is called, how big, and what GitHub says it is. */
export type GithubReleaseAsset = {
  name: string;
  sizeBytes?: number;
  contentType?: string;
};

export type GithubRelease = {
  externalId: string;
  tag: string;
  title: string;
  url?: string;
  publishedAt: Date;
  isPrerelease: boolean;
  body?: string;
  /**
   * Files attached to the release (never their download counts). The adapter
   * always sets it, empty when there are none; optional so a release built by
   * hand elsewhere need not invent one.
   */
  assets?: GithubReleaseAsset[];
};

export type GithubRepoActivity = {
  fullName: string;
  /** GitHub's numeric repository id, when the answer carried it (2026-10-02). */
  repoId?: number;
  description?: string;
  homepage?: string;
  defaultBranch?: string;
  latestPushAt?: Date;
  createdAt?: Date;
  isArchived: boolean;
  isFork: boolean;
  /** A template repository is scaffolding, not this team's build. */
  isTemplate: boolean;
  /** `owner/repo` this fork was taken from, when GitHub reports it. */
  forkOf?: string;
  /** Display context only. Never an HBM input. */
  stars?: number;
  /** Repository size in kilobytes; 0 is an empty repository. */
  sizeKb?: number;
  /** Owner-declared topics, lowercased as GitHub stores them. Context only. */
  topics?: string[];
  /** SPDX id of the licence GitHub detected (`MIT`, `NOASSERTION`). */
  licenseSpdx?: string;
  /** GitHub's main language for the repository. */
  language?: string;
  /** `Organization` or `User`, as GitHub reports the owner account. */
  ownerType?: string;
};

export type GithubRepoInput = {
  owner: string;
  repo: string;
  baseUrl?: string;
  /** Optional server token raises the public rate limit (PRD V4 section 20.1). */
  token?: string;
};

const CACHE_TTL_SECONDS = 1800;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

const authHeaders = (token?: string): Record<string, string> => ({
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** Repository metadata: existence, activity window and default branch. */
export function createGithubRepoAdapter(): SourceAdapter<GithubRepoInput, GithubRepoActivity> {
  return {
    name: 'github-repo',

    canHandle(input) {
      return REPO_PATTERN.test(input.owner) && REPO_PATTERN.test(input.repo);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubRepoActivity>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/repos/${input.owner}/${input.repo}`;

      return performSourceFetch(
        ctx,
        { url, headers: authHeaders(input.token) },
        {
          schema: githubRepoSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): GithubRepoActivity => ({
            fullName: raw.full_name,
            ...opt('repoId', raw.id !== undefined && Number.isSafeInteger(raw.id) && raw.id > 0 ? raw.id : undefined),
            isArchived: raw.archived ?? false,
            isFork: raw.fork ?? false,
            isTemplate: raw.is_template ?? false,
            ...opt('forkOf', raw.parent?.full_name),
            ...opt('description', raw.description ?? undefined),
            ...opt('homepage', raw.homepage ?? undefined),
            ...opt('defaultBranch', raw.default_branch),
            ...opt('latestPushAt', toDate(raw.pushed_at)),
            ...opt('createdAt', toDate(raw.created_at)),
            ...opt('stars', raw.stargazers_count),
            ...opt('sizeKb', raw.size),
            ...(raw.topics ? { topics: raw.topics } : {}),
            ...opt('licenseSpdx', raw.license?.spdx_id ?? undefined),
            ...opt('language', raw.language ?? undefined),
            ...opt('ownerType', raw.owner?.type ?? undefined),
          }),
        },
      );
    },
  };
}

/** Releases become one `GITHUB_RELEASE` ShipEvent each in M4. */
export function createGithubReleasesAdapter(): SourceAdapter<GithubRepoInput, GithubRelease[]> {
  return {
    name: 'github-releases',

    canHandle(input) {
      return REPO_PATTERN.test(input.owner) && REPO_PATTERN.test(input.repo);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubRelease[]>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/repos/${input.owner}/${input.repo}/releases?per_page=30`;

      return performSourceFetch(
        ctx,
        { url, headers: authHeaders(input.token) },
        {
          schema: githubReleasesSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): GithubRelease[] =>
            raw
              // Drafts are not public evidence of shipping.
              .filter((release) => release.draft !== true)
              .map((release) => {
                const publishedAt = toDate(release.published_at) ?? toDate(release.created_at);
                return { release, publishedAt };
              })
              .filter(
                (entry): entry is { release: (typeof raw)[number]; publishedAt: Date } =>
                  entry.publishedAt !== undefined,
              )
              .map(({ release, publishedAt }) => ({
                externalId: String(release.id),
                tag: release.tag_name,
                title: release.name?.trim() || release.tag_name,
                publishedAt,
                isPrerelease: release.prerelease ?? false,
                assets: (release.assets ?? []).map((asset) => ({
                  name: asset.name,
                  ...opt('sizeBytes', asset.size ?? undefined),
                  ...opt('contentType', asset.content_type ?? undefined),
                })),
                ...opt('url', release.html_url),
                ...opt('body', release.body ?? undefined),
              })),
        },
      );
    },
  };
}

/**
 * Repository search, for discovering Robinhood Chain builders who never
 * launched a token (Builder Discovery Repair V1 sections 7, 18).
 *
 * Results are candidates only. A repository matching a search phrase is not
 * evidence that it belongs to any HEY project, and section 41 forbids
 * publishing one without identity resolution and the quality gate.
 */
export const githubSearchSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean().optional(),
  items: z.array(
    githubRepoSchema.extend({
      owner: z.object({ login: z.string() }).nullish(),
      topics: z.array(z.string()).nullish(),
    }),
  ),
});

export type GithubSearchHit = GithubRepoActivity & {
  owner: string;
  name: string;
  url: string;
  topics: string[];
};

/**
 * One page of repository search (round-8 audit, 2026-09-18). Forks are
 * dropped from `hits`; `pageSize` is the raw row count, which is what tells
 * a caller whether this was the last page.
 */
export type GithubSearchPage = {
  hits: GithubSearchHit[];
  /** Rows on the page before forks were dropped. */
  pageSize: number;
  /** GitHub's own total for the query, capped by the API at 1,000 reachable. */
  totalCount: number;
};

export type GithubSearchInput = {
  /** A GitHub search qualifier string, e.g. `"Robinhood Chain" in:readme`. */
  query: string;
  baseUrl?: string;
  token?: string;
  perPage?: number;
  /**
   * 1-based results page. Discovery read only page one for a year and found
   * 97 candidates against a 206-repository topic; the caller pages, bounded.
   */
  page?: number;
};

export function createGithubSearchAdapter(): SourceAdapter<GithubSearchInput, GithubSearchPage> {
  return {
    name: 'github-search',

    canHandle(input) {
      return input.query.trim().length > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubSearchPage>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const perPage = Math.min(input.perPage ?? 50, 100);
      const page = Math.max(1, Math.floor(input.page ?? 1));
      const url =
        `${base}/search/repositories?q=${encodeURIComponent(input.query)}` +
        `&sort=updated&order=desc&per_page=${perPage}&page=${page}`;

      return performSourceFetch(
        ctx,
        { url, headers: authHeaders(input.token) },
        {
          schema: githubSearchSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): GithubSearchPage => ({
            pageSize: raw.items.length,
            totalCount: raw.total_count,
            hits: raw.items
              // A fork is someone else's code; it says nothing about this team.
              .filter((item) => item.fork !== true)
              .map((item) => {
                const [owner, name] = item.full_name.split('/');
                return { item, owner: item.owner?.login ?? owner ?? '', name: name ?? '' };
              })
              .filter((entry) => entry.owner !== '' && entry.name !== '')
              .map(({ item, owner, name }) => ({
                fullName: item.full_name,
                owner,
                name,
                url: item.html_url ?? `https://github.com/${item.full_name}`,
                topics: item.topics ?? [],
                isArchived: item.archived ?? false,
                isFork: item.fork ?? false,
                // Search hits do not carry is_template; the repo read does.
                isTemplate: false,
                ...opt('description', item.description ?? undefined),
                ...opt('homepage', item.homepage ?? undefined),
                ...opt('defaultBranch', item.default_branch),
                ...opt('latestPushAt', toDate(item.pushed_at)),
                ...opt('createdAt', toDate(item.created_at)),
                ...opt('stars', item.stargazers_count),
              })),
          }),
        },
      );
    },
  };
}

/**
 * The latest deployment to an environment named `production` (2026-09-27,
 * brief §17). One request per official repository, sent with the ETag of the
 * last answer, so an unchanged list costs a 304.
 *
 * GitHub filters `environment` server-side and, as measured on 2026-09-27,
 * without regard to case (`PRODUCTION` and `production` returned the same
 * list), so Vercel's `Production` is found by the same request. The adapter
 * still keeps only rows whose name is exactly production, whatever the case,
 * and drops transient (preview) environments. Only the environment's name, the
 * creation time and the commit are kept — never who deployed.
 *
 * A deployment record is not a ship, not a success and not activity: a
 * workflow creates one on every push to a branch it watches, and one audited
 * repository carried 36,000 of them. It is shown as dated context only.
 */
export const githubDeploymentsSchema = z.array(
  z.object({
    id: z.number(),
    environment: z.string(),
    created_at: z.string(),
    sha: z.string().nullish(),
    transient_environment: z.boolean().optional(),
  }),
);

export type GithubProductionDeployment = {
  environment: string;
  createdAt: Date;
  sha?: string;
};

export type GithubDeploymentsReading = {
  /** Absent when the repository has no deployment to a production environment. */
  latestProduction?: GithubProductionDeployment;
};

/** The only environment name read as production. */
export const PRODUCTION_ENVIRONMENT = /^production$/i;

const DEPLOYMENTS_MAX_BYTES = 512 * 1024;
const DEPLOYMENTS_TIMEOUT_MS = 15_000;

export function createGithubDeploymentsAdapter(): SourceAdapter<GithubRepoInput, GithubDeploymentsReading> {
  return {
    name: 'github-deployments',

    canHandle(input) {
      return REPO_PATTERN.test(input.owner) && REPO_PATTERN.test(input.repo);
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<GithubDeploymentsReading>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/repos/${input.owner}/${input.repo}/deployments?environment=production&per_page=5`;

      const result = await performSourceFetch(
        { ...ctx, timeoutMs: Math.min(ctx.timeoutMs, DEPLOYMENTS_TIMEOUT_MS) },
        { url, headers: authHeaders(input.token), maxBytes: DEPLOYMENTS_MAX_BYTES, allowedContentTypes: ['application/json'] },
        {
          schema: githubDeploymentsSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): GithubDeploymentsReading => {
            const latest = raw
              .filter((row) => PRODUCTION_ENVIRONMENT.test(row.environment) && row.transient_environment !== true)
              .map((row) => ({ row, at: toDate(row.created_at) }))
              .filter((entry): entry is { row: (typeof raw)[number]; at: Date } => entry.at !== undefined)
              .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
            if (!latest) return {};
            return {
              latestProduction: {
                environment: latest.row.environment,
                createdAt: latest.at,
                ...opt('sha', latest.row.sha ?? undefined),
              },
            };
          },
        },
      );
      return keepToProviderHost(result, base);
    },
  };
}
