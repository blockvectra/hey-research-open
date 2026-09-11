import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * npm registry — packages built for Robinhood Chain (2026-09-05).
 *
 * A published SDK, CLI or MCP server for the chain is a builder announcing
 * itself, and the registry's search answers keylessly. Twenty packages named
 * the chain on 2026-09-04 (`robinhood-chain-sdk`, `robinhood-chain-kit`,
 * `ponscli`, `glory-mcp`, `@sinjoh/sdk` …) and nearly all carried a GitHub
 * repository link. The package is not the candidate — the repository it
 * points at is, and it goes through the same fingerprint and promotion path
 * as a search hit. Download counts are never read as evidence of anything.
 */
export const NPM_REGISTRY_BASE_URL = 'https://registry.npmjs.org';

const CACHE_TTL_SECONDS = 6 * 3_600;

/** A package document carries every version's manifest; a few hundred KB is normal. */
const PACKAGE_MAX_BYTES = 2 * 1024 * 1024;

const searchSchema = z.object({
  total: z.number().optional(),
  objects: z.array(
    z.object({
      package: z.object({
        name: z.string(),
        description: z.string().nullish(),
        keywords: z.array(z.string()).nullish(),
        date: z.string().nullish(),
        links: z
          .object({
            npm: z.string().nullish(),
            homepage: z.string().nullish(),
            repository: z.string().nullish(),
          })
          .nullish(),
      }),
    }),
  ),
});

export type NpmPackageHit = {
  name: string;
  description?: string;
  keywords: string[];
  repositoryUrl?: string;
  homepage?: string;
  publishedAt?: Date;
};

export type NpmSearchInput = {
  text: string;
  baseUrl?: string;
  /** Registry cap is 250; twenty to fifty is plenty for a chain this size. */
  size?: number;
};

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export function createNpmSearchAdapter(): SourceAdapter<NpmSearchInput, NpmPackageHit[]> {
  return {
    name: 'npm-search',

    canHandle(input) {
      return input.text.trim().length > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<NpmPackageHit[]>> {
      const base = (input.baseUrl ?? NPM_REGISTRY_BASE_URL).replace(/\/$/, '');
      const size = Math.min(Math.max(input.size ?? 50, 1), 250);
      const url = `${base}/-/v1/search?text=${encodeURIComponent(input.text)}&size=${size}`;

      return performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' } },
        {
          schema: searchSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): NpmPackageHit[] =>
            raw.objects.map(({ package: pkg }) => ({
              name: pkg.name,
              keywords: pkg.keywords ?? [],
              ...opt('description', pkg.description ?? undefined),
              ...opt('repositoryUrl', pkg.links?.repository ?? undefined),
              ...opt('homepage', pkg.links?.homepage ?? undefined),
              ...opt('publishedAt', toDate(pkg.date)),
            })),
        },
      );
    },
  };
}

/** The package document: the README the publisher shipped, and the repository it declares. */
const packageSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  readme: z.string().nullish(),
  homepage: z.string().nullish(),
  keywords: z.array(z.string()).nullish(),
  repository: z
    .union([z.string(), z.object({ url: z.string().nullish() })])
    .nullish(),
});

export type NpmPackageDocument = {
  name: string;
  description?: string;
  readme?: string;
  repositoryUrl?: string;
  homepage?: string;
  keywords: string[];
};

export type NpmPackageInput = {
  name: string;
  baseUrl?: string;
};

const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function createNpmPackageAdapter(): SourceAdapter<NpmPackageInput, NpmPackageDocument> {
  return {
    name: 'npm-package',

    canHandle(input) {
      return PACKAGE_NAME.test(input.name);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<NpmPackageDocument>> {
      const base = (input.baseUrl ?? NPM_REGISTRY_BASE_URL).replace(/\/$/, '');
      // Scoped names keep their slash; only the `@` needs encoding in the path.
      const url = `${base}/${input.name.replace('@', '%40')}`;

      return performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' }, maxBytes: PACKAGE_MAX_BYTES },
        {
          schema: packageSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): NpmPackageDocument => {
            const repository =
              typeof raw.repository === 'string' ? raw.repository : raw.repository?.url ?? undefined;
            return {
              name: raw.name,
              keywords: raw.keywords ?? [],
              ...opt('description', raw.description ?? undefined),
              ...opt('readme', raw.readme ?? undefined),
              ...opt('repositoryUrl', repository ?? undefined),
              ...opt('homepage', raw.homepage ?? undefined),
            };
          },
        },
      );
    },
  };
}

/**
 * `https://github.com/owner/repo` from the forms the registry stores:
 * `git+https://github.com/o/r.git`, `git://github.com/o/r`, `github:o/r`,
 * `https://github.com/o/r/tree/main/packages/x`.
 */
export function githubRepoFromNpmUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const shorthand = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value.trim());
  if (shorthand) return `https://github.com/${shorthand[1]}/${shorthand[2]}`;
  const match = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(value);
  if (!match) return undefined;
  return `https://github.com/${match[1]}/${match[2]}`;
}
