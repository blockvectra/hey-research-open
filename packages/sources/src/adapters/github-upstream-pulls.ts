import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { GITHUB_DEFAULT_BASE_URL } from './github';

/**
 * HEY's own pull requests in other people's public repositories (2026-10-21,
 * founder ruling; the `/contributions` page, "Contributions").
 *
 * One page of GitHub's issue search for `is:pr author:<account>
 * -user:<account>`: pull requests the account opened, in repositories it does
 * not own, newest first, a hundred a page. What leaves the parser is, per pull
 * request, the repository (owner/name), its number, title and URL, its state
 * (OPEN, MERGED or CLOSED) and the dates it was opened, merged and closed —
 * never the body, labels, comments or anyone's account. The account is HEY's
 * own; nobody else's activity is read.
 *
 * Pull requests only, never issues: an item without `pull_request` is dropped
 * here, whatever the query said. So is an item in a repository the account
 * owns, or one authored by another account, so a query typo can never list
 * HEY's own repositories or someone else's work.
 */
export const GITHUB_UPSTREAM_PULLS_PER_PAGE = 100;
/** GitHub's search answers at most 1,000 results for one query: ten pages of a hundred. */
export const GITHUB_UPSTREAM_PULLS_MAX_PAGES = 10;

export const githubUpstreamPullsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean().optional(),
  items: z.array(
    z.object({
      number: z.number().int().positive(),
      title: z.string(),
      html_url: z.string().url(),
      state: z.enum(['open', 'closed']),
      created_at: z.string(),
      closed_at: z.string().nullish(),
      repository_url: z.string().url(),
      /** Read to drop anything another account opened; never kept. */
      user: z.object({ login: z.string().nullish() }).nullish(),
      /** Present on a pull request only; an issue has none and is dropped. */
      pull_request: z.object({ merged_at: z.string().nullish() }).nullish(),
    }),
  ),
});

export type UpstreamPullState = 'OPEN' | 'MERGED' | 'CLOSED';

export type UpstreamPull = {
  /** `owner/name`, as GitHub spells it. */
  repository: string;
  number: number;
  title: string;
  url: string;
  state: UpstreamPullState;
  openedAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
};

export type UpstreamPullsPage = {
  pulls: UpstreamPull[];
  /** Items on the raw page, kept or not: a short page ends the walk. */
  pageSize: number;
  /** GitHub's own total for the query (issues included until the filter). */
  totalCount: number;
  /** GitHub said the search timed out before it read every match. */
  incomplete: boolean;
};

export type UpstreamPullsInput = {
  /** The GitHub account whose pull requests are read: HEY's own. */
  account: string;
  page?: number;
  perPage?: number;
  token?: string;
  baseUrl?: string;
};

const ACCOUNT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY_URL = /\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/;
const CACHE_TTL_SECONDS = 3600;

const toDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** The search query: the account's pull requests outside its own repositories. */
export function upstreamPullsQuery(account: string): string {
  return `is:pr author:${account} -user:${account}`;
}

/** The repository a search item names, `owner/name`, or undefined when its URL is not a repository's. */
export function repositoryFromApiUrl(url: string): string | undefined {
  const match = REPOSITORY_URL.exec(url);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** OPEN while open; MERGED once GitHub records a merge; CLOSED when closed without one. */
export function upstreamPullState(item: { state: 'open' | 'closed'; mergedAt: Date | null }): UpstreamPullState {
  if (item.mergedAt) return 'MERGED';
  return item.state === 'open' ? 'OPEN' : 'CLOSED';
}

/** One raw page to the kept pull requests: pull requests only, the account's own, in repositories it does not own. */
export function upstreamPullsFromPage(raw: z.infer<typeof githubUpstreamPullsSchema>, account: string): UpstreamPull[] {
  const self = account.toLowerCase();
  const pulls: UpstreamPull[] = [];
  for (const item of raw.items) {
    if (!item.pull_request) continue;
    const login = item.user?.login?.toLowerCase();
    if (login !== undefined && login !== self) continue;
    const repository = repositoryFromApiUrl(item.repository_url);
    if (!repository || repository.split('/')[0]!.toLowerCase() === self) continue;
    const openedAt = toDate(item.created_at);
    if (!openedAt) continue;
    const mergedAt = toDate(item.pull_request.merged_at);
    const closedAt = toDate(item.closed_at);
    pulls.push({
      repository,
      number: item.number,
      title: item.title.trim().slice(0, 300),
      url: item.html_url,
      state: upstreamPullState({ state: item.state, mergedAt }),
      openedAt,
      mergedAt,
      closedAt,
    });
  }
  return pulls;
}

export function createGithubUpstreamPullsAdapter(): SourceAdapter<UpstreamPullsInput, UpstreamPullsPage> {
  return {
    name: 'github-upstream-pulls',

    canHandle(input) {
      return ACCOUNT_PATTERN.test(input.account);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<UpstreamPullsPage>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const perPage = Math.min(Math.max(1, Math.floor(input.perPage ?? GITHUB_UPSTREAM_PULLS_PER_PAGE)), 100);
      const page = Math.min(Math.max(1, Math.floor(input.page ?? 1)), GITHUB_UPSTREAM_PULLS_MAX_PAGES);
      const query = new URLSearchParams({ q: upstreamPullsQuery(input.account), sort: 'created', order: 'desc', per_page: String(perPage), page: String(page) });
      const url = `${base}/search/issues?${query.toString()}`;

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
          schema: githubUpstreamPullsSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): UpstreamPullsPage => ({
            pulls: upstreamPullsFromPage(raw, input.account),
            pageSize: raw.items.length,
            totalCount: raw.total_count,
            incomplete: raw.incomplete_results === true,
          }),
        },
      );
    },
  };
}
