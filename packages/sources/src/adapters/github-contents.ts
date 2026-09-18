import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { GITHUB_DEFAULT_BASE_URL, githubRepoSchema, type GithubSearchHit } from './github';

/**
 * Repository files and owner listings — the reads behind the weak-candidate
 * re-judge and the builder-account sweeps (2026-09-05).
 *
 * A repository whose description merely says "Robinhood Chain" is a weak
 * candidate; its README or its `foundry.toml` naming the chain id or the RPC
 * host is a deployment marker. Reading the file is one request, and the
 * answer settles a candidate that would otherwise sit PENDING forever (154
 * of them did, on 2026-09-04).
 */
const REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Files are read raw; anything past this is not a README anyone reads. */
export const GITHUB_FILE_MAX_BYTES = 256 * 1024;

const CACHE_TTL_SECONDS = 24 * 3_600;

const rawHeaders = (token?: string): Record<string, string> => ({
  accept: 'application/vnd.github.raw+json',
  'x-github-api-version': '2022-11-28',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

export type GithubFileInput = {
  owner: string;
  repo: string;
  /** Path inside the repository; omitted means the README GitHub itself resolves. */
  path?: string;
  baseUrl?: string;
  token?: string;
};

export type GithubFileContent = {
  path: string;
  text: string;
};

/** Repository file text: the README (`/readme`) or one path (`/contents/{path}`). */
export function createGithubFileAdapter(): SourceAdapter<GithubFileInput, GithubFileContent> {
  return {
    name: 'github-contents',

    canHandle(input) {
      return (
        REPO_PATTERN.test(input.owner) &&
        REPO_PATTERN.test(input.repo) &&
        (input.path === undefined || (!input.path.includes('..') && !input.path.startsWith('/')))
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubFileContent>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const path = input.path ?? 'README';
      const url = input.path
        ? `${base}/repos/${input.owner}/${input.repo}/contents/${input.path.split('/').map(encodeURIComponent).join('/')}`
        : `${base}/repos/${input.owner}/${input.repo}/readme`;

      return performSourceFetch(
        ctx,
        { url, headers: rawHeaders(input.token), maxBytes: GITHUB_FILE_MAX_BYTES },
        {
          // Raw media type: the body is the file, not a JSON envelope.
          schema: z.string(),
          parse: (body) => body,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (text): GithubFileContent => ({ path, text }),
        },
      );
    },
  };
}

/**
 * Repositories of one account, most recently pushed first.
 *
 * `/users/{login}/repos` answers for organisations as well as users, which
 * matters because the accounts worth sweeping are a mix of both. Forks are
 * dropped here for the same reason as in search: a fork is someone else's code.
 */
const ownerReposSchema = z.array(
  githubRepoSchema.extend({
    name: z.string(),
    owner: z.object({ login: z.string() }).nullish(),
    topics: z.array(z.string()).nullish(),
  }),
);

export type GithubOwnerReposInput = {
  owner: string;
  baseUrl?: string;
  token?: string;
  page?: number;
  perPage?: number;
};

/**
 * One page of an account's repositories (round-8 audit, 2026-09-18). Forks
 * are dropped from `repositories`, so the caller pages on `pageSize` — the
 * raw row count — not on what survived: a page of 100 with 24 forks used to
 * read as a short last page and end the sweep early.
 */
export type GithubOwnerReposPage = {
  repositories: GithubSearchHit[];
  /** Rows on the page before forks were dropped. */
  pageSize: number;
};

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export function createGithubOwnerReposAdapter(): SourceAdapter<GithubOwnerReposInput, GithubOwnerReposPage> {
  return {
    name: 'github-owner-repos',

    canHandle(input) {
      return REPO_PATTERN.test(input.owner);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubOwnerReposPage>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const perPage = Math.min(input.perPage ?? 100, 100);
      const page = Math.max(1, Math.floor(input.page ?? 1));
      const url = `${base}/users/${input.owner}/repos?type=owner&sort=pushed&direction=desc&per_page=${perPage}&page=${page}`;

      return performSourceFetch(
        ctx,
        {
          url,
          headers: {
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
          },
        },
        {
          schema: ownerReposSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): GithubOwnerReposPage => ({
            pageSize: raw.length,
            repositories: raw
              .filter((item) => item.fork !== true)
              .map((item) => ({
                fullName: item.full_name,
                owner: item.owner?.login ?? item.full_name.split('/')[0] ?? input.owner,
                name: item.name,
                url: item.html_url ?? `https://github.com/${item.full_name}`,
                topics: item.topics ?? [],
                isArchived: item.archived ?? false,
                isFork: item.fork ?? false,
                isTemplate: item.is_template ?? false,
                ...opt('description', item.description ?? undefined),
                ...opt('homepage', item.homepage ?? undefined),
                ...opt('defaultBranch', item.default_branch),
                ...opt('latestPushAt', toDate(item.pushed_at)),
                ...opt('createdAt', toDate(item.created_at)),
                ...opt('stars', item.stargazers_count),
                ...opt('sizeKb', item.size),
              })),
          }),
        },
      );
    },
  };
}
