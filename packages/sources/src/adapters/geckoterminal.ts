import { z } from 'zod';

import { requireData, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { pickDeepestLiquidity, toNumber, type MarketContext } from '../market';

/**
 * GeckoTerminal — secondary/fallback market source (PRD V4 sections 20.1, 21).
 * Used when DEX Screener has no coverage or is degraded.
 */
export const GECKOTERMINAL_DEFAULT_BASE_URL = 'https://api.geckoterminal.com/api/v2';

const numericish = z.union([z.string(), z.number()]).nullish();

const poolSchema = z.object({
  id: z.string().optional(),
  attributes: z.object({
    address: z.string().optional(),
    name: z.string().optional(),
    base_token_price_usd: numericish,
    reserve_in_usd: numericish,
    fdv_usd: numericish,
    market_cap_usd: numericish,
    volume_usd: z.object({ h24: numericish }).nullish(),
    pool_created_at: z.string().nullish(),
  }),
  /** The DEX the pool belongs to, when the listing names it. */
  relationships: z.object({ dex: z.object({ data: z.object({ id: z.string().optional() }).nullish() }).nullish() }).nullish(),
});

export const geckoterminalResponseSchema = z.object({
  data: z.union([z.array(poolSchema), poolSchema]).nullish(),
});

export type GeckoterminalInput = {
  chainId: number;
  /** GeckoTerminal network slug, e.g. `robinhood-chain`. */
  network: string;
  tokenAddress: string;
  baseUrl?: string;
};

const CACHE_TTL_SECONDS = 300;

export function createGeckoterminalAdapter(): SourceAdapter<GeckoterminalInput, MarketContext> {
  return {
    name: 'geckoterminal',

    canHandle(input) {
      return input.network.length > 0 && /^0x[a-fA-F0-9]{40}$/.test(input.tokenAddress);
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<MarketContext>> {
      const base = (input.baseUrl ?? GECKOTERMINAL_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/networks/${input.network}/tokens/${input.tokenAddress}/pools`;

      const result = await performSourceFetch(
        ctx,
        { url },
        {
          schema: geckoterminalResponseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): MarketContext | undefined => {
            const list =
              raw.data === null || raw.data === undefined
                ? []
                : Array.isArray(raw.data)
                  ? raw.data
                  : [raw.data];

            const pools = list.map((pool) => ({
              pool,
              liquidityUsd: toNumber(pool.attributes.reserve_in_usd),
            }));
            const best = pickDeepestLiquidity(pools);
            if (!best) return undefined;

            const attrs = best.pool.attributes;
            const createdAt = attrs.pool_created_at ? new Date(attrs.pool_created_at) : undefined;

            return {
              chainId: input.chainId,
              tokenAddress: input.tokenAddress,
              source: 'geckoterminal',
              ...opt('priceUsd', toNumber(attrs.base_token_price_usd)),
              ...opt('marketCapUsd', toNumber(attrs.market_cap_usd)),
              ...opt('fdvUsd', toNumber(attrs.fdv_usd)),
              ...opt('liquidityUsd', best.liquidityUsd),
              ...opt('volume24hUsd', toNumber(attrs.volume_usd?.h24)),
              ...opt('pairAddress', attrs.address),
              ...opt('venue', best.pool.relationships?.dex?.data?.id),
              ...opt(
                'pairCreatedAt',
                createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined,
              ),
            };
          },
        },
      );

      return requireData(result, ctx, 'no pools listed for token', {
        sourceUrl: url,
        cacheTtlSeconds: CACHE_TTL_SECONDS,
      });
    },
  };
}
