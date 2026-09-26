import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { SourceError } from '../errors';
import type { HttpResponse } from '../http/client';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import type { VerifiedContract } from './blockscout-verified';
import { abiSignatures } from './explorer-etherscan';

/**
 * Sourcify — verified-source lookup and listing (PRD V4 sections 20.1, 28;
 * brief §20, 2026-09-27).
 *
 * Sourcify's v2 API serves chain 4663 (checked live 2026-09-27: `supported`,
 * and testnet 46630 too). It matches a contract's *creation and runtime*
 * bytecode against published source, independently of the chain's explorer,
 * which makes it the second opinion HEY can hold beside the explorer's own
 * verification.
 *
 * Two reads:
 *
 * - the per-address lookup, asked only for the fields HEY uses
 *   (`abi,compilation,deployment,proxyResolution`, about 5 KB) rather than
 *   `fields=all` (about 500 KB with sources and bytecode). The deployment's
 *   *transaction and block* are kept; the account that sent it is not read
 *   into HEY here at all — a contract fact, never an account;
 * - the newest-first listing, with each row's match quality and `matchId`,
 *   so the daily sweep can page back to the last row it saw.
 *
 * Every answer must come from the origin that was asked: a redirect to
 * another host is refused (`sameOrigin`).
 */
export const SOURCIFY_DEFAULT_BASE_URL = 'https://sourcify.dev/server';

const CACHE_TTL_SECONDS = 86_400;
/** The four fields HEY reads come to ~5 KB; a large ABI stays well inside this. */
const CONTRACT_MAX_BYTES = 2 * 1024 * 1024;
/** A 200-row page is ~50 KB. */
const LIST_MAX_BYTES = 1024 * 1024;

/** The fields the per-address lookup asks for. */
export const SOURCIFY_CONTRACT_FIELDS = 'abi,compilation,deployment,proxyResolution';

/** Sourcify v2 match qualities. `null` means no verified source on record. */
const matchSchema = z.enum(['exact_match', 'match']).nullable();
export type SourcifyMatch = 'exact_match' | 'match';

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
  abi: z.array(z.unknown()).nullish(),
  deployment: z
    .object({
      transactionHash: z.string().nullish(),
      blockNumber: z.union([z.string(), z.number()]).nullish(),
    })
    .passthrough()
    .nullish(),
  proxyResolution: z
    .object({
      isProxy: z.boolean().nullish(),
      proxyType: z.string().nullish(),
      implementations: z.array(z.object({ address: z.string().nullish(), name: z.string().nullish() }).passthrough()).nullish(),
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
  /** Sourcify's own words for each half of the bytecode: `exact_match`, `match`, or absent when not matched. */
  creationMatch?: SourcifyMatch;
  runtimeMatch?: SourcifyMatch;
  contractName?: string;
  compilerVersion?: string;
  language?: string;
  verifiedAt?: Date;
  matchId?: string;
  /** The verified ABI as canonical signatures, the same form the explorer read keeps. */
  abi?: { functions: string[]; events: string[] };
  /** Sourcify's proxy resolution, when it gave one. Implementations lower-cased. */
  proxy?: { isProxy: boolean; proxyType?: string; implementations: string[] };
  /** The creating transaction and its block — never the account that sent it. */
  deployment?: { txHash?: string; blockNumber?: number };
};

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const TX = /^0x[0-9a-fA-F]{64}$/;

const qualityOf = (match: 'exact_match' | 'match' | null | undefined): SourcifyVerification['match'] =>
  match === 'exact_match' ? 'perfect' : match === 'match' ? 'partial' : 'none';

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const toBlock = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/**
 * Redirect policy for a provider API (2026-09-27): the answer must come from
 * the origin HEY asked. The shared client already re-checks every hop for
 * safety; this refuses an answer served from somewhere else at all.
 */
export function sameOrigin(requestUrl: string, response: HttpResponse): void {
  if (!response.url) return;
  if (new URL(response.url).origin !== new URL(requestUrl).origin) {
    throw new SourceError('INVALID_RESPONSE', `answer came from ${new URL(response.url).origin}, not the origin asked`);
  }
}

export function normalizeSourcifyContract(raw: z.infer<typeof contractSchema>, input: SourcifyInput): SourcifyVerification {
  const match = qualityOf(raw.match);
  const abi = match !== 'none' && raw.abi ? abiSignatures(JSON.stringify(raw.abi)) : undefined;
  const proxy = raw.proxyResolution && typeof raw.proxyResolution.isProxy === 'boolean'
    ? {
        isProxy: raw.proxyResolution.isProxy,
        ...opt('proxyType', raw.proxyResolution.proxyType ?? undefined),
        implementations: (raw.proxyResolution.implementations ?? [])
          .map((entry) => entry.address?.toLowerCase())
          .filter((value): value is string => Boolean(value && ADDRESS.test(value))),
      }
    : undefined;
  const txHash = raw.deployment?.transactionHash && TX.test(raw.deployment.transactionHash) ? raw.deployment.transactionHash.toLowerCase() : undefined;
  const blockNumber = toBlock(raw.deployment?.blockNumber);
  return {
    chainId: input.chainId,
    address: input.address,
    match,
    isVerified: match !== 'none',
    ...opt('creationMatch', raw.creationMatch ?? undefined),
    ...opt('runtimeMatch', raw.runtimeMatch ?? undefined),
    ...opt('contractName', raw.compilation?.name ?? undefined),
    ...opt('compilerVersion', raw.compilation?.compilerVersion ?? undefined),
    ...opt('language', raw.compilation?.language?.toLowerCase() ?? undefined),
    ...opt('verifiedAt', toDate(raw.verifiedAt)),
    ...opt('matchId', raw.matchId ?? undefined),
    ...(abi && abi.functions.length + abi.events.length > 0 ? { abi } : {}),
    ...(proxy ? { proxy } : {}),
    ...(txHash || blockNumber !== undefined ? { deployment: { ...opt('txHash', txHash), ...opt('blockNumber', blockNumber) } } : {}),
  };
}

export function createSourcifyAdapter(): SourceAdapter<SourcifyInput, SourcifyVerification> {
  return {
    name: 'sourcify',

    canHandle(input) {
      return input.chainId > 0 && ADDRESS.test(input.address);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<SourcifyVerification>> {
      const base = (input.baseUrl ?? SOURCIFY_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/v2/contract/${input.chainId}/${input.address}?fields=${SOURCIFY_CONTRACT_FIELDS}`;

      /*
       * "Not verified" is a 404 with `{match: null}` on the live API
       * (2026-09-27); older answers were a 200 with a null match. The 200 is
       * data here; the 404 reaches the caller as `missing` / `NOT_FOUND`,
       * which the domain reads as the same definite answer.
       */
      return performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' }, allowedContentTypes: ['application/json'], maxBytes: CONTRACT_MAX_BYTES },
        {
          schema: contractSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw, response): SourcifyVerification => {
            sameOrigin(url, response);
            return normalizeSourcifyContract(raw, input);
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
  /** `matchId` of the newest row on the page, for the sweep's watermark; absent when the page was empty. */
  firstMatchId?: string;
  /** `matchId` of the oldest row, for the next page; absent when the page was empty. */
  lastMatchId?: string;
  /** Rows on the page, matched or not: a short page is the end of the listing. */
  rows: number;
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
        { url, headers: { accept: 'application/json' }, allowedContentTypes: ['application/json'], maxBytes: LIST_MAX_BYTES },
        {
          schema: listSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 60 * 60,
          normalize: (raw, response): SourcifyListPage => {
            sameOrigin(url, response);
            const results = raw.results ?? [];
            const contracts: VerifiedContract[] = results
              .filter((row) => row.match !== null)
              .map((row) => ({
                address: row.address,
                flaggedScam: false,
                isProxy: false,
                ...opt('name', row.compilation?.name ?? undefined),
                ...opt('language', row.compilation?.language?.toLowerCase() ?? undefined),
                ...opt('verifiedAt', toDate(row.verifiedAt)),
                ...opt('sourcifyMatch', row.match ?? undefined),
                ...opt('matchId', row.matchId ?? undefined),
              }));
            return {
              contracts,
              rows: results.length,
              ...opt('firstMatchId', results[0]?.matchId ?? undefined),
              ...opt('lastMatchId', results.at(-1)?.matchId ?? undefined),
            };
          },
        },
      );
    },
  };
}
