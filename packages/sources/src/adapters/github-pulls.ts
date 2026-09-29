import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { GITHUB_DEFAULT_BASE_URL, type GithubRepoInput } from './github';
import { GITHUB_BOT_LOGIN, linkHasNext } from './github-commits';

/**
 * Merged pull requests of a repository HEY reads (2026-09-29, the Terminal
 * chart's code lane).
 *
 * One page of the recently closed pull requests, newest update first, sent
 * with the ETag of the last answer so an unchanged list costs a 304. What
 * leaves the parser is the number, the merge time and whether automation
 * opened it — never the title, the body, the branch, or who opened, merged
 * or reviewed it: product rule 1 keeps no per-person record, and the schema
 * declares none of those fields, so they are dropped at validation.
 *
 * A merged pull request is display context on the chart. It is not a ship,
 * it is not counted as building, and nothing in scoring reads it.
 */
export const githubPullsSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    merged_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    /** Read to tell automation from people, then dropped: the login is never kept. */
    user: z.object({ login: z.string().nullish(), type: z.string().nullish() }).nullish(),
  }),
);

export type GithubPullMerge = {
  number: number;
  mergedAt: Date;
  /** Opened by automation (a bot account, a dependency updater), by the commits adapter's rule. */
  isBot: boolean;
};

export type GithubPullsPage = {
  merges: GithubPullMerge[];
  /** Closed pull requests on the page, merged or not. */
  pageSize: number;
  /** GitHub named a next page: older merges exist that this page did not list. */
  truncated: boolean;
  /**
   * The oldest update on the page. The list is sorted by update, and a merge
   * is an update, so every merge at or after this instant is on the page:
   * it is where a truncated page's coverage starts.
   */
  oldestUpdatedAt?: Date;
};

export type GithubPullsInput = GithubRepoInput & { perPage?: number };

const CACHE_TTL_SECONDS = 1800;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export function createGithubPullsAdapter(): SourceAdapter<GithubPullsInput, GithubPullsPage> {
  return {
    name: 'github-pulls',

    canHandle(input) {
      return REPO_PATTERN.test(input.owner) && REPO_PATTERN.test(input.repo);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubPullsPage>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const perPage = Math.min(Math.max(1, input.perPage ?? 50), 100);
      const query = new URLSearchParams({ state: 'closed', sort: 'updated', direction: 'desc', per_page: String(perPage) });
      const url = `${base}/repos/${input.owner}/${input.repo}/pulls?${query.toString()}`;

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
          schema: githubPullsSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw, response): GithubPullsPage => ({
            merges: raw
              .map((pull) => {
                const mergedAt = toDate(pull.merged_at);
                if (!mergedAt) return undefined;
                const login = pull.user?.login ?? undefined;
                return {
                  number: pull.number,
                  mergedAt,
                  isBot: pull.user?.type === 'Bot' || (login !== undefined && GITHUB_BOT_LOGIN.test(login)),
                } satisfies GithubPullMerge;
              })
              .filter((merge): merge is GithubPullMerge => merge !== undefined),
            pageSize: raw.length,
            truncated: linkHasNext(response.link) || (response.link === undefined && raw.length >= perPage),
            ...((oldest) => (oldest ? { oldestUpdatedAt: oldest } : {}))(
              raw.reduce<Date | undefined>((min, pull) => {
                const at = toDate(pull.updated_at);
                return at && (!min || at < min) ? at : min;
              }, undefined),
            ),
          }),
        },
      );
    },
  };
}
