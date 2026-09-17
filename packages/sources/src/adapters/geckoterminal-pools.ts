import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { toNumber } from '../market';
import type { TokenCandidate } from './dexscreener-search';

/**
 * GeckoTerminal pool listing — the breadth of candidate discovery.
 *
 * DEX Screener's search only surfaces tokens matching a keyword, which biases
 * discovery toward projects that named themselves after the chain. Paging the
 * network's pool list instead enumerates what actually trades on Robinhood
 * Chain, independent of naming.
 *
 * Verified 2026-09-01: 20 pools per page, and the listing stops at page 10 —
 * roughly 200 pools. That ceiling is the real bound on HEY's discovery
 * universe, so the caller pages both `pools` and `new_pools` and merges.
 */
export const GECKOTERMINAL_POOLS_MAX_PAGE = 10;

const poolSchema = z.object({
  id: z.string().nullish(),
  attributes: z
    .object({
      address: z.string().nullish(),
      name: z.string().nullish(),
      pool_created_at: z.string().nullish(),
      market_cap_usd: z.union([z.string(), z.number()]).nullish(),
      fdv_usd: z.union([z.string(), z.number()]).nullish(),
      reserve_in_usd: z.union([z.string(), z.number()]).nullish(),
    })
    .default({}),
  relationships: z
    .object({
      base_token: z.object({ data: z.object({ id: z.string() }).nullish() }).nullish(),
    })
    .nullish(),
});

const poolsResponseSchema = z.object({ data: z.array(poolSchema).nullish() });

export type GeckoterminalPoolsInput = {
  chainId: number;
  network: string;
  page: number;
  /** `pools` is the established set; `new_pools` surfaces recent launches. */
  listing?: 'pools' | 'new_pools';
  baseUrl?: string;
};

export type PoolCandidate = TokenCandidate & {
  pairAddress?: string;
  marketCapUsd?: number;
  liquidityUsd?: number;
};

const CACHE_TTL_SECONDS = 900;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/** Token ids look like `robinhood_0xabc…`; the address is the trailing segment. */
function addressFrom(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const address = id.slice(id.lastIndexOf('_') + 1);
  return ADDRESS_PATTERN.test(address) ? address.toLowerCase() : undefined;
}

/** Pool names are `BASE / QUOTE 0.3%`; the base symbol is the part HEY wants. */
function baseSymbolFrom(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const symbol = name.split('/')[0]?.trim();
  return symbol && symbol.length > 0 ? symbol : undefined;
}

export function createGeckoterminalPoolsAdapter(): SourceAdapter<
  GeckoterminalPoolsInput,
  PoolCandidate[]
> {
  return {
    name: 'geckoterminal-pools',

    canHandle(input) {
      return input.network.length > 0 && input.page >= 1;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<PoolCandidate[]>> {
      const base = (input.baseUrl ?? 'https://api.geckoterminal.com/api/v2').replace(/\/$/, '');
      const listing = input.listing ?? 'pools';
      const url = `${base}/networks/${input.network}/${listing}?page=${input.page}`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: poolsResponseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): PoolCandidate[] => {
            const candidates: PoolCandidate[] = [];

            for (const pool of raw.data ?? []) {
              const address = addressFrom(pool.relationships?.base_token?.data?.id);
              if (!address) continue;

              const attrs = pool.attributes ?? {};
              const createdAt = attrs.pool_created_at ? new Date(attrs.pool_created_at) : undefined;

              candidates.push({
                chainId: input.chainId,
                contractAddress: address,
                discoveredVia: `geckoterminal-${listing}`,
                ...opt('symbol', baseSymbolFrom(attrs.name ?? undefined)),
                ...opt('pairAddress', attrs.address),
                ...opt('marketCapUsd', toNumber(attrs.market_cap_usd)),
                ...opt('liquidityUsd', toNumber(attrs.reserve_in_usd)),
                ...opt(
                  'pairCreatedAt',
                  createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined,
                ),
              });
            }

            return candidates;
          },
        },
      );
    },
  };
}
