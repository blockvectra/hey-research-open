import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import type { VerifiedContract } from './blockscout-verified';

/**
 * Sourcify — verified-source lookup and listing (PRD V4 sections 20.1, 28).
 *
 * Sourcify's v2 API serves chain 4663 to HEY's own user agent, which the
 * chain's Blockscout does not (Cloudflare challenges every API route for a
 * non-browser agent, checked 2026-09-02). That makes Sourcify the working
 * route to the strongest legitimacy signal on the chain: published source
 * that matches the deployed bytecode.
 *
 * The v1 `check-all-by-addresses` route this adapter used to call now 404s.
 */
export const SOURCIFY_DEFAULT_BASE_URL = 'https://sourcify.dev/server';

const CACHE_TTL_SECONDS = 86_400;

/** Sourcify v2 match qualities. `null` means no verified source on record. */
const matchSchema = z.enum(['exact_match', 'match']).nullable();

const contractSchema = z.object({
  match: matchSchema,
  creationMatch: matchSchema.optional(),
  runtimeMatch: matchSchema.optional(),
  chainId: z.string(),
  address: z.string(),
  verifiedAt: z.string().nullish(),
  matchId: z.string().nullish(),
  compilation: z
    .object({
      language: z.string().nullish(),
      compilerVersion: z.string().nullish(),
      name: z.string().nullish(),
      fullyQualifiedName: z.string().nullish(),
    })
    .nullish(),
});

export type SourcifyInput = {
  chainId: number;
  address: string;
  baseUrl?: string;
};

export type SourcifyVerification = {
  chainId: number;
  address: string;
  /** `perfect` is Sourcify's exact match; `partial` a metadata-tolerant one. */
  match: 'perfect' | 'partial' | 'none';
  isVerified: boolean;
  contractName?: string;
  verifiedAt?: Date;
};

const qualityOf = (match: 'exact_match' | 'match' | null | undefined): SourcifyVerification['match'] =>
  match === 'exact_match' ? 'perfect' : match === 'match' ? 'partial' : 'none';

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export function createSourcifyAdapter(): SourceAdapter<SourcifyInput, SourcifyVerification> {
  return {
    name: 'sourcify',

    canHandle(input) {
      return input.chainId > 0 && /^0x[a-fA-F0-9]{40}$/.test(input.address);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<SourcifyVerification>> {
      const base = (input.baseUrl ?? SOURCIFY_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/v2/contract/${input.chainId}/${input.address}?fields=all`;

      return performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' } },
        {
          schema: contractSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): SourcifyVerification => {
            const match = qualityOf(raw.match);
            return {
              chainId: input.chainId,
              address: input.address,
              match,
              isVerified: match !== 'none',
              ...opt('contractName', raw.compilation?.name ?? undefined),
              ...opt('verifiedAt', toDate(raw.verifiedAt)),
            };
          },
        },
      );
    },
  };
}

/**
 * Recently verified contracts on a chain, newest first.
 *
 * Sized as a daily sweep rather than a full index: a run keeps up with what
 * was verified since the last one, and the per-address lookup above covers
 * anything specific.
 */
const listSchema = z.object({
  results: z.array(contractSchema).default([]),
});

export type SourcifyListInput = {
  chainId: number;
  baseUrl?: string;
  /** Up to Sourcify's page cap. */
  limit?: number;
  /** Cursor: return matches older than this `matchId`. */
  afterMatchId?: string;
};

export type SourcifyListPage = {
  contracts: VerifiedContract[];
  /** `matchId` of the oldest row, for the next page; absent when the page was empty. */
  lastMatchId?: string;
};

export function createSourcifyListAdapter(): SourceAdapter<SourcifyListInput, SourcifyListPage> {
  return {
    name: 'sourcify-list',

    canHandle(input) {
      return input.chainId > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<SourcifyListPage>> {
      const base = (input.baseUrl ?? SOURCIFY_DEFAULT_BASE_URL).replace(/\/$/, '');
      const limit = Math.min(Math.max(1, input.limit ?? 200), 200);
      const cursor = input.afterMatchId ? `&afterMatchId=${encodeURIComponent(input.afterMatchId)}` : '';
      const url = `${base}/v2/contracts/${input.chainId}?sort=desc&limit=${limit}${cursor}`;

      return performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' } },
        {
          schema: listSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 60 * 60,
          normalize: (raw): SourcifyListPage => {
            const contracts: VerifiedContract[] = (raw.results ?? [])
              .filter((row) => row.match !== null)
              .map((row) => ({
                address: row.address,
                flaggedScam: false,
                isProxy: false,
                ...opt('name', row.compilation?.name ?? undefined),
                ...opt('language', row.compilation?.language?.toLowerCase() ?? undefined),
                ...opt('verifiedAt', toDate(row.verifiedAt)),
              }));
            const last = (raw.results ?? []).at(-1)?.matchId ?? undefined;
            return { contracts, ...opt('lastMatchId', last) };
          },
        },
      );
    },
  };
}
