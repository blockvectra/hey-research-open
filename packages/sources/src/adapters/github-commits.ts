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
      author: z.object({ name: z.string().nullish(), email: z.string().nullish(), date: z.string().nullish() }).nullish(),
    }),
    author: z.object({ login: z.string().nullish(), type: z.string().nullish() }).nullish(),
    /** More than one parent is a merge (2026-09-27): counted by structure, not only by its message. */
    parents: z.array(z.object({ sha: z.string() })).nullish(),
  }),
);

export type GithubCommit = {
  sha: string;
  message: string;
  authorLogin?: string;
  /**
   * Who wrote the commit, for counting distinct contributors only (outsider
   * audit, 2026-10-02): the lower-cased login, else the commit's author
   * e-mail, else its author name. Commits with no linked GitHub account all
   * read "unknown" before, so a repository whose commits carry no login always
   * said "1 contributor". Held in memory for the count; never stored.
   */
  authorKey?: string;
  committedAt: Date;
  /** Bot and automated commits are excluded from activity summaries. */
  isBot: boolean;
  /**
   * A merge commit: more than one parent (2026-09-27). It integrates work
   * already listed as its own commits, so it is not counted as another one —
   * whatever its message says. False when GitHub did not list the parents.
   */
  isMerge: boolean;
};

/**
 * One page of the commits endpoint (round-8 audit, 2026-09-18).
 *
 * The adapter reads a single page. The old shape was the bare list, so the
 * caller judged "was this the whole window?" by counting what was left after
 * bots and merges were dropped — a full page with one bot commit read as an
 * exact count ("94 commits in the last 90 days") for a repository with
 * thousands. The page carries its own raw length and whether GitHub said
 * there was more, and the caller judges from that.
 */
export type GithubCommitsPage = {
  commits: GithubCommit[];
  /** Rows on the page before any filtering. */
  pageSize: number;
  /**
   * The page did not reach `since`: GitHub named a next page, or, with no
   * `Link` header to go by, the page was full.
   */
  truncated: boolean;
  /** The earliest commit on the page, dated; what the page actually covers. */
  oldestCommitAt?: Date;
};

export type GithubCommitsInput = GithubRepoInput & {
  /** Only commits after this instant are requested. */
  since: Date;
  perPage?: number;
  /** 1-based page of the listing (2026-10-02): the caller follows a truncated week back. */
  page?: number;
};

const CACHE_TTL_SECONDS = 1800;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Automation that should not be mistaken for a human shipping (PRD V4 26).
 *
 * Widened 2026-10-02 (outsider audit): the only generic case was a `[bot]`
 * suffix, so an account named `brodie-terminal-bot` — committing "chore:
 * refresh ledgers" a dozen times a day under a GitHub user literally called
 * `bot` — was counted as a contributor and its commits as building. A login or
 * author name that is `bot`, ends in `-bot`/`_bot`/`.bot`/` bot` or starts
 * with `bot-` is automation; `talbot` and `abbot` are not.
 */
export const GITHUB_BOT_LOGIN =
  /\[bot\]$|(?:^|[-_.\s])bot$|^bot[-_.]|^(dependabot|renovate|github-actions|greenkeeper|snyk-bot|imgbot|allcontributors|semantic-release-bot|pre-commit-ci|mergify|codecov|kodiakhq|deepsource-autofix|actions-user|github-action|gitbook-bot|changeset-bot|release-please)/i;
const BOT_LOGIN = GITHUB_BOT_LOGIN;
/** A commit e-mail that names automation: `…[bot]@users.noreply.github.com`, `bot@…`, `x-bot@…`, GitHub Actions' own. */
export const GITHUB_BOT_EMAIL = /\[bot\]@|(?:^|[-_.+])bot@|^(action|actions|github-actions)@github\.com$/i;
/**
 * Messages only automation writes (2026-10-02). It used to be any `chore(deps)`
 * or `bump …` subject, whoever wrote it — so a person's "chore(deps): timebox
 * age excludes" was dropped as a bot's. Now only a dependency updater's own
 * subject (`bump X from A to B`) and merge subjects.
 */
const BOT_MESSAGE = /^((chore|build|fix|deps)\((deps|deps-dev)\): )?bump \S+ from \S+ to \S+|^merge pull request|^merge branch/i;

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** Whether a `Link` header names a next page. */
export const linkHasNext = (link: string | undefined): boolean =>
  link !== undefined && /;\s*rel="?next"?/i.test(link);

export function createGithubCommitsAdapter(): SourceAdapter<GithubCommitsInput, GithubCommitsPage> {
  return {
    name: 'github-commits',

    canHandle(input) {
      return REPO_PATTERN.test(input.owner) && REPO_PATTERN.test(input.repo);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubCommitsPage>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const perPage = Math.min(input.perPage ?? 100, 100);
      // Encoded rather than concatenated, so parameter values cannot alter the URL.
      const query = new URLSearchParams({
        since: input.since.toISOString(),
        per_page: String(perPage),
        ...(input.page !== undefined && input.page > 1 ? { page: String(Math.floor(input.page)) } : {}),
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
          normalize: (raw, response): GithubCommitsPage => {
            const commits = raw
              .map((entry) => {
                const committedAt = toDate(entry.commit.author?.date);
                if (!committedAt) return undefined;

                const login = entry.author?.login ?? undefined;
                // The commit's own author name, for a bot with no linked GitHub account (2026-09-24).
                const authorName = entry.commit.author?.name ?? undefined;
                const authorEmail = entry.commit.author?.email ?? undefined;
                const message = (entry.commit.message ?? '').split('\n')[0] ?? '';
                const authorKey = login?.toLowerCase() ?? (authorEmail ? `email:${authorEmail.toLowerCase()}` : authorName ? `name:${authorName.toLowerCase()}` : undefined);

                return {
                  sha: entry.sha,
                  message,
                  committedAt,
                  isBot:
                    entry.author?.type === 'Bot' ||
                    (login !== undefined && BOT_LOGIN.test(login)) ||
                    (authorName !== undefined && BOT_LOGIN.test(authorName)) ||
                    (authorEmail !== undefined && GITHUB_BOT_EMAIL.test(authorEmail)) ||
                    BOT_MESSAGE.test(message),
                  isMerge: (entry.parents?.length ?? 0) > 1,
                  ...opt('authorLogin', login),
                  ...opt('authorKey', authorKey),
                } satisfies GithubCommit;
              })
              .filter((commit): commit is GithubCommit => commit !== undefined);
            const oldestCommitAt = commits.reduce<Date | undefined>(
              (oldest, commit) => (oldest === undefined || commit.committedAt < oldest ? commit.committedAt : oldest),
              undefined,
            );
            // GitHub sends `Link` only when there is another page to name;
            // without one, a full page is the only sign that more exists.
            const truncated = linkHasNext(response.link) || (response.link === undefined && raw.length >= perPage);
            return {
              commits,
              pageSize: raw.length,
              truncated,
              ...opt('oldestCommitAt', oldestCommitAt),
            };
          },
        },
      );
    },
  };
}
