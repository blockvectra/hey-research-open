import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

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
  }),
);

export type GithubRelease = {
  externalId: string;
  tag: string;
  title: string;
  url?: string;
  publishedAt: Date;
  isPrerelease: boolean;
  body?: string;
};

export type GithubRepoActivity = {
  fullName: string;
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

export function createGithubSearchAdapter(): SourceAdapter<GithubSearchInput, GithubSearchHit[]> {
  return {
    name: 'github-search',

    canHandle(input) {
      return input.query.trim().length > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubSearchHit[]>> {
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
          normalize: (raw): GithubSearchHit[] =>
            raw.items
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
        },
      );
    },
  };
}
