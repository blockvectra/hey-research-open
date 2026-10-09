import { z } from 'zod';

import { errorResult, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { explorerChainApiUrl, explorerNotKeyed, redactResultUrl, type ExplorerApi } from '../http/explorer-api';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { sameOrigin } from './sourcify';

/**
 * One token as the explorer counts it (2026-10-10): three REST reads on the
 * Blockscout API (free tier, key required), chain in the path
 * (`explorerChainApiUrl`):
 *
 *  - `GET /{chain}/api/v2/tokens/{address}` — the token record: total supply
 *    (base units), decimals, the explorer's holder count;
 *  - `GET /{chain}/api/v2/tokens/{address}/counters` — `token_holders_count`
 *    and `transfers_count`, the explorer's all-time count of the token's
 *    transfers;
 *  - `GET /{chain}/api/v2/tokens/{address}/holders` — the fifty largest
 *    balances, largest first.
 *
 * Why the explorer (CLAUDE.md product rule 1, the 2026-10-09 amendment): it
 * indexes every balance on the chain, so its holder count is the count a
 * reader can check on the explorer page, and a token whose balances have not
 * moved for a week still has a distribution — Bitquery's realtime `Holders`
 * cube answers only balances that changed in its window. It costs no Bitquery
 * point: HEY's only paid provider is Bitquery.
 *
 * The balances are handed to the caller in memory only, to be summed into
 * shares (`onchain/live.ts`); this adapter keeps no address and the caller
 * returns, logs, prints and stores none (CLAUDE.md product rule 1, cost rule
 * 10). Counts arrive as strings; a figure the explorer left out or answered as
 * something other than a whole number is absent, never 0 (machine rule 4).
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 15 * 60;
/** The record and the counters are a few hundred bytes; a page of fifty holders with their address records a few tens of KB. */
const MAX_BYTES = 1024 * 1024;

/** How many balances one holders page carries; HEY reads one page, never more. */
export const BLOCKSCOUT_HOLDERS_PAGE = 50;

const numberish = z.union([z.string(), z.number()]).nullish();

const tokenSchema = z
  .object({
    total_supply: numberish,
    decimals: numberish,
    holders_count: numberish,
    /** The older field name for the same count. */
    holders: numberish,
    type: z.string().nullish(),
  })
  .passthrough()
  // An answer carrying none of the record's fields ("Network not supported", an error body) is no record.
  .refine((raw) => raw.total_supply !== undefined || raw.decimals !== undefined || raw.holders_count !== undefined || raw.holders !== undefined, {
    message: 'not a token record',
  });

const countersSchema = z
  .object({
    token_holders_count: numberish,
    transfers_count: numberish,
  })
  .passthrough()
  .refine((raw) => raw.token_holders_count !== undefined || raw.transfers_count !== undefined, { message: 'not a token counters record' });

const holdersSchema = z
  .object({
    items: z.array(
      z
        .object({
          address: z.object({ hash: z.string() }).passthrough(),
          value: numberish,
        })
        .passthrough(),
    ),
    next_page_params: z.unknown().nullish(),
  })
  .passthrough();

/** A whole, non-negative count, or undefined. */
function count(value: string | number | null | undefined): number | undefined {
  const parsed = toNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** A base-unit integer as a decimal string, or undefined when it is not one. */
function baseUnits(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? text : undefined;
}

/**
 * Base units to whole tokens, for a share of supply. Exact enough for a share
 * (a double carries sixteen significant digits); never for an amount stored.
 */
export function blockscoutUnits(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

export type BlockscoutTokenInput = ExplorerApi & { address: string };

export type BlockscoutToken = {
  /** `ERC-20`, `ERC-721`… as the explorer types it. */
  type?: string;
  /** Total supply in base units, as the explorer read it from the contract. */
  totalSupplyRaw?: string;
  decimals?: number;
  /** Addresses with a balance above zero, as the explorer counts them. */
  holdersCount?: number;
};

export type BlockscoutTokenCounters = {
  holdersCount?: number;
  /** Every transfer of the token since it was created, as the explorer counts them. */
  transfersCount?: number;
};

export type BlockscoutHolderBalance = {
  /** Lower-cased. In memory only: never returned past the caller's sum, logged or stored. */
  address: string;
  /** Base units. */
  valueRaw: string;
};

export type BlockscoutTokenHolders = {
  /** Largest first, at most `BLOCKSCOUT_HOLDERS_PAGE`, each address once, zero balances dropped. */
  holders: BlockscoutHolderBalance[];
  /** The explorer has more balances past this page. */
  more: boolean;
};

export function normalizeBlockscoutToken(raw: z.infer<typeof tokenSchema>): BlockscoutToken {
  const totalSupplyRaw = baseUnits(raw.total_supply);
  const decimals = count(raw.decimals);
  const holdersCount = count(raw.holders_count) ?? count(raw.holders);
  const type = raw.type?.trim() || undefined;
  return {
    ...(type ? { type } : {}),
    ...(totalSupplyRaw === undefined ? {} : { totalSupplyRaw }),
    // A decimals figure past 77 is no ERC-20's (uint8 reads, and 10^77 is past a double's reach).
    ...(decimals === undefined || decimals > 77 ? {} : { decimals }),
    ...(holdersCount === undefined ? {} : { holdersCount }),
  };
}

export function normalizeBlockscoutTokenCounters(raw: z.infer<typeof countersSchema>): BlockscoutTokenCounters {
  const holdersCount = count(raw.token_holders_count);
  const transfersCount = count(raw.transfers_count);
  return {
    ...(holdersCount === undefined ? {} : { holdersCount }),
    ...(transfersCount === undefined ? {} : { transfersCount }),
  };
}

export function normalizeBlockscoutTokenHolders(raw: z.infer<typeof holdersSchema>): BlockscoutTokenHolders {
  const seen = new Set<string>();
  const holders: BlockscoutHolderBalance[] = [];
  for (const item of raw.items) {
    const address = item.address.hash.trim().toLowerCase();
    const valueRaw = baseUnits(item.value);
    if (!ADDRESS.test(address) || seen.has(address) || valueRaw === undefined || /^0+$/.test(valueRaw)) continue;
    seen.add(address);
    holders.push({ address, valueRaw });
    if (holders.length >= BLOCKSCOUT_HOLDERS_PAGE) break;
  }
  return { holders, more: raw.next_page_params !== null && raw.next_page_params !== undefined };
}

function tokenRead<TRaw, TOut>(
  name: string,
  suffix: string,
  schema: z.ZodType<TRaw>,
  normalize: (raw: TRaw) => TOut,
): SourceAdapter<BlockscoutTokenInput, TOut> {
  return {
    name,
    canHandle: (input) => ADDRESS.test(input.address) && explorerChainApiUrl(input, '/') !== undefined,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<TOut>> {
      if (!ADDRESS.test(input.address)) return errorResult<TOut>(ctx, 'BLOCKED_URL', 'not read: not a contract address');
      const url = explorerChainApiUrl(input, `/api/v2/tokens/${input.address.toLowerCase()}${suffix}`);
      // Keyed only: without the key (or the chain) no request leaves.
      if (!url) return explorerNotKeyed(ctx);
      const result = await performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' }, allowedContentTypes: ['application/json'], maxBytes: MAX_BYTES },
        {
          schema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw, response) => {
            sameOrigin(url, response);
            return normalize(raw);
          },
        },
      );
      return redactResultUrl(result);
    },
  };
}

/** The token record: supply, decimals and the explorer's holder count. */
export function createBlockscoutTokenAdapter(): SourceAdapter<BlockscoutTokenInput, BlockscoutToken> {
  return tokenRead('blockscout-token', '', tokenSchema, normalizeBlockscoutToken);
}

/** The explorer's holder count and its all-time transfer count. */
export function createBlockscoutTokenCountersAdapter(): SourceAdapter<BlockscoutTokenInput, BlockscoutTokenCounters> {
  return tokenRead('blockscout-token-counters', '/counters', countersSchema, normalizeBlockscoutTokenCounters);
}

/** The fifty largest balances, largest first: one page, in memory only. */
export function createBlockscoutTokenHoldersAdapter(): SourceAdapter<BlockscoutTokenInput, BlockscoutTokenHolders> {
  return tokenRead('blockscout-token-holders', '/holders', holdersSchema, normalizeBlockscoutTokenHolders);
}
