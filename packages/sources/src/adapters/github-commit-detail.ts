import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { GITHUB_DEFAULT_BASE_URL, type GithubRepoInput } from './github';
import { linkHasNext } from './github-commits';

/**
 * One commit's changed files (2026-09-27, founder ruling G1).
 *
 * `GET /repos/{owner}/{repo}/commits/{sha}`: which files changed, how, and the
 * patch of each, so HEY can tell a commit that changed code from one that only
 * touched documentation, a lockfile or whitespace. A commit is immutable, so
 * each is read once. The patches are handed to the classifier in memory and
 * never stored; nor is anything about who wrote the commit — the schema does
 * not even parse the author.
 *
 * GitHub lists at most 300 files on the first page of a commit; a larger
 * commit names a next page, and HEY reads only the first — the result says
 * the list was cut (`filesTruncated`) rather than pretending it saw them all.
 */
export const GITHUB_COMMIT_FILES_PAGE_CAP = 300;

const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const githubCommitDetailSchema = z.object({
  sha: z.string(),
  parents: z.array(z.object({ sha: z.string() })).nullish(),
  stats: z.object({ additions: z.number(), deletions: z.number(), total: z.number() }).nullish(),
  files: z
    .array(
      z.object({
        filename: z.string(),
        status: z.string(),
        additions: z.number(),
        deletions: z.number(),
        changes: z.number(),
        patch: z.string().nullish(),
        previous_filename: z.string().nullish(),
      }),
    )
    .nullish(),
});

export type GithubCommitFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  /** The unified diff, when GitHub inlines one; for classification in memory only. */
  patch?: string;
  previousFilename?: string;
};

export type GithubCommitDetail = {
  sha: string;
  isMerge: boolean;
  files: GithubCommitFile[];
  /** GitHub listed only part of the commit's files. */
  filesTruncated: boolean;
  stats?: { additions: number; deletions: number; total: number };
};

export type GithubCommitDetailInput = GithubRepoInput & { sha: string };

export function createGithubCommitDetailAdapter(): SourceAdapter<GithubCommitDetailInput, GithubCommitDetail> {
  return {
    name: 'github-commit-detail',

    canHandle(input) {
      return REPO_PATTERN.test(input.owner) && REPO_PATTERN.test(input.repo) && SHA_PATTERN.test(input.sha);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubCommitDetail>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      // Every part is validated by `canHandle` and encoded, so no value can alter the URL.
      const url = `${base}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/commits/${encodeURIComponent(input.sha)}`;

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
          schema: githubCommitDetailSchema,
          parse: (body) => JSON.parse(body) as unknown,
          // Immutable: HEY stores the reading and never asks again.
          cacheTtlSeconds: 0,
          normalize: (raw, response): GithubCommitDetail => {
            const files = (raw.files ?? []).map(
              (file): GithubCommitFile => ({
                filename: file.filename,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                changes: file.changes,
                ...opt('patch', file.patch ?? undefined),
                ...opt('previousFilename', file.previous_filename ?? undefined),
              }),
            );
            return {
              sha: raw.sha,
              isMerge: (raw.parents?.length ?? 0) > 1,
              files,
              filesTruncated: linkHasNext(response.link) || files.length >= GITHUB_COMMIT_FILES_PAGE_CAP,
              ...(raw.stats ? { stats: { additions: raw.stats.additions, deletions: raw.stats.deletions, total: raw.stats.total } } : {}),
            };
          },
        },
      );
    },
  };
}
