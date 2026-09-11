import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { GITHUB_DEFAULT_BASE_URL } from './github';

/**
 * GitHub code search — discovery by what a repository *contains*.
 *
 * Repository search indexes names, descriptions, topics and READMEs; it never
 * sees a chain id in a config file or an RPC host in a deploy script. Those
 * are exactly the markers that only a deployer writes, and code search finds
 * them: `rpc.mainnet.chain.robinhood.com` matched 2,132 files across GitHub
 * on 2026-09-04 while the repository queries HEY ran had surfaced 424
 * candidates in total.
 *
 * Constraints that shape the caller, not this adapter: the endpoint needs a
 * token, allows 10 requests a minute, returns at most 1,000 results per query
 * (10 pages of 100), and only indexes default branches of repositories that
 * have had recent activity. A hit is a file, so one repository appears once
 * per matching file — the caller dedupes by repository.
 */
export const GITHUB_CODE_SEARCH_PER_PAGE = 100;

const codeHitSchema = z.object({
  name: z.string(),
  path: z.string(),
  html_url: z.string().optional(),
  repository: z.object({
    full_name: z.string(),
    html_url: z.string().optional(),
    description: z.string().nullish(),
    fork: z.boolean().optional(),
    private: z.boolean().optional(),
    owner: z.object({ login: z.string(), type: z.string().nullish() }).nullish(),
  }),
});

export const githubCodeSearchSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean().optional(),
  items: z.array(codeHitSchema),
});

export type GithubCodeHit = {
  /** Path of the matching file inside the repository. */
  path: string;
  fileUrl?: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description?: string;
  /** A fork carries the upstream's files; it says nothing about this owner. */
  isFork: boolean;
  ownerType?: string;
};

export type GithubCodeSearchPage = {
  /** GitHub's count for the whole query, capped in practice at 1,000 reachable results. */
  totalCount: number;
  incomplete: boolean;
  hits: GithubCodeHit[];
};

export type GithubCodeSearchInput = {
  /** A code-search query, e.g. `"rpc.mainnet.chain.robinhood.com"`. */
  query: string;
  /** Required by GitHub for code search; unauthenticated requests are refused. */
  token: string;
  baseUrl?: string;
  /** 1-based; GitHub serves at most ten pages of a hundred. */
  page?: number;
  perPage?: number;
};

/** Code search results change slowly and cost a scarce request; an hour is conservative. */
const CACHE_TTL_SECONDS = 3_600;

export function createGithubCodeSearchAdapter(): SourceAdapter<GithubCodeSearchInput, GithubCodeSearchPage> {
  return {
    name: 'github-code-search',

    canHandle(input) {
      return input.query.trim().length > 0 && input.token.trim().length > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<GithubCodeSearchPage>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      const perPage = Math.min(input.perPage ?? GITHUB_CODE_SEARCH_PER_PAGE, 100);
      const page = Math.max(1, Math.floor(input.page ?? 1));
      const url =
        `${base}/search/code?q=${encodeURIComponent(input.query)}` + `&per_page=${perPage}&page=${page}`;

      return performSourceFetch(
        ctx,
        {
          url,
          headers: {
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            authorization: `Bearer ${input.token}`,
          },
        },
        {
          schema: githubCodeSearchSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): GithubCodeSearchPage => ({
            totalCount: raw.total_count,
            incomplete: raw.incomplete_results ?? false,
            hits: raw.items
              // A private repository cannot appear for a public token; guard anyway.
              .filter((item) => item.repository.private !== true)
              .map((item) => {
                const [ownerFromName, name] = item.repository.full_name.split('/');
                const owner = item.repository.owner?.login ?? ownerFromName ?? '';
                return { item, owner, name: name ?? '' };
              })
              .filter((entry) => entry.owner !== '' && entry.name !== '')
              .map(({ item, owner, name }) => ({
                path: item.path,
                owner,
                name,
                fullName: item.repository.full_name,
                url: item.repository.html_url ?? `https://github.com/${item.repository.full_name}`,
                isFork: item.repository.fork === true,
                ...opt('fileUrl', item.html_url),
                ...opt('description', item.repository.description ?? undefined),
                ...opt('ownerType', item.repository.owner?.type ?? undefined),
              })),
          }),
        },
      );
    },
  };
}
