import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { GITHUB_DEFAULT_BASE_URL, type GithubRepoInput } from './github';

/**
 * GitHub commit activity (PRD V4 section 26).
 *
 * Commits are read to build a single capped `CODE_ACTIVITY` summary per project per
 * day — never one ShipEvent per commit. Raw commit count carries low weight by
 * design: popularity and churn are not building.
 */
export const githubCommitsSchema = z.array(
  z.object({
    sha: z.string(),
    commit: z.object({
      message: z.string().nullish(),
      author: z.object({ name: z.string().nullish(), date: z.string().nullish() }).nullish(),
    }),
    author: z.object({ login: z.string().nullish(), type: z.string().nullish() }).nullish(),
  }),
);

export type GithubCommit = {
  sha: string;
  message: string;
  authorLogin?: string;
  committedAt: Date;
  /** Bot and automated commits are excluded from activity summaries. */
  isBot: boolean;
};

export type GithubCommitsInput = GithubRepoInput & {
  /** Only commits after this instant are requested. */
  since: Date;
  perPage?: number;
};

const CACHE_TTL_SECONDS = 1800;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Automation that should not be mistaken for a human shipping (PRD V4 26). */
const BOT_LOGIN = /\[bot\]$|^(dependabot|renovate|github-actions|greenkeeper|snyk-bot)/i;
const BOT_MESSAGE = /^(chore\(deps\)|build\(deps\)|bump |merge pull request|merge branch)/i;

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export function createGithubCommitsAdapter(): SourceAdapter<GithubCommitsInput, GithubCommit[]> {
  return {
    name: 'github-commits',

    canHandle(input) {
      return REPO_PATTERN.test(input.owner) && REPO_PATTERN.test(input.repo);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubCommit[]>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const perPage = Math.min(input.perPage ?? 100, 100);
      // Encoded rather than concatenated, so parameter values cannot alter the URL.
      const query = new URLSearchParams({
        since: input.since.toISOString(),
        per_page: String(perPage),
      });
      const url = `${base}/repos/${input.owner}/${input.repo}/commits?${query.toString()}`;

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
          schema: githubCommitsSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): GithubCommit[] =>
            raw
              .map((entry) => {
                const committedAt = toDate(entry.commit.author?.date);
                if (!committedAt) return undefined;

                const login = entry.author?.login ?? undefined;
                const message = (entry.commit.message ?? '').split('\n')[0] ?? '';

                return {
                  sha: entry.sha,
                  message,
                  committedAt,
                  isBot:
                    entry.author?.type === 'Bot' ||
                    (login !== undefined && BOT_LOGIN.test(login)) ||
                    BOT_MESSAGE.test(message),
                  ...opt('authorLogin', login),
                } satisfies GithubCommit;
              })
              .filter((commit): commit is GithubCommit => commit !== undefined),
        },
      );
    },
  };
}
