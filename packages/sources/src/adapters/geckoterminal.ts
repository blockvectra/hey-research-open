import { z } from 'zod';

import { requireData, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { pickDeepestLiquidity, priceChangePct, sumAcrossPools, toNumber, type MarketContext } from '../market';

/**
 * GeckoTerminal — secondary/fallback market source (PRD V4 sections 20.1, 21).
 * Used when DEX Screener has no coverage or is degraded.
 */
export const GECKOTERMINAL_DEFAULT_BASE_URL = 'https://api.geckoterminal.com/api/v2';

const numericish = z.union([z.string(), z.number()]).nullish();

const poolSchema = z.object({
  id: z.string().nullish(),
  attributes: z.object({
    address: z.string().nullish(),
    name: z.string().nullish(),
    base_token_price_usd: numericish,
    reserve_in_usd: numericish,
    fdv_usd: numericish,
    market_cap_usd: numericish,
    volume_usd: z.object({ h24: numericish }).nullish(),
    transactions: z.object({ h24: z.object({ buys: numericish, sells: numericish }).nullish() }).nullish(),
    price_change_percentage: z.object({ h1: priceChangePct, h6: priceChangePct, h24: priceChangePct }).nullish(),
    pool_created_at: z.string().nullish(),
  }),
  /** The DEX the pool belongs to, when the listing names it, and which token is the base. */
  relationships: z
    .object({
      dex: z.object({ data: z.object({ id: z.string().nullish() }).nullish() }).nullish(),
      base_token: z.object({ data: z.object({ id: z.string().nullish() }).nullish() }).nullish(),
    })
    .nullish(),
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

            /*
             * The pools endpoint lists every pool the token appears in, on
             * either side (2026-09-18). A pool where this token is the quote —
             * pair.fund launches against tokenised stocks — prices the other
             * asset in `base_token_price_usd`. Only base-side pools are this
             * token's market; when the listing names no base token at all,
             * take what it gave rather than dropping the reading.
             */
            const wanted = input.tokenAddress.toLowerCase();
            const baseOf = (pool: (typeof list)[number]): string | undefined =>
              pool.relationships?.base_token?.data?.id?.toLowerCase();
            const isMine = (id: string | undefined): boolean =>
              id !== undefined && (id.endsWith(`_${wanted}`) || id === wanted);
            /*
             * A pool that names its base token and a pool that does not are
             * not equal candidates (2026-09-24).
             *
             * These were filtered together — `!id || matches` — so a payload
             * carrying one pool that names this token and four that name
             * nothing put all five into the depth comparison, and the deepest
             * of the four unverifiable ones could win and publish its price,
             * symbol, name and logo as this token's. That is the narrower form
             * of the defect the DEX Screener adapter lost on 2026-09-23, and
             * it lands in the same place: the identity backfill writes symbol
             * and name under `coalesce` and the logo only when null, so it is
             * never corrected afterwards.
             *
             * A positively matched pool always wins. The all-unknown fallback
             * below is kept and is the case its own condition describes — the
             * provider said nothing about sides at all, for any pool, so there
             * is nothing to prefer.
             */
            const matched = list.filter((pool) => isMine(baseOf(pool)));
            const mine =
              matched.length > 0 ? matched : list.every((pool) => baseOf(pool) === undefined) ? list : [];
            const pools = mine.map((pool) => ({
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
              // Depth and volume across every pool the token trades in, not
              // the deepest one's alone (2026-09-14).
              ...opt('liquidityUsd', sumAcrossPools(mine, (pool) => toNumber(pool.attributes.reserve_in_usd))),
              ...opt('volume24hUsd', sumAcrossPools(mine, (pool) => toNumber(pool.attributes.volume_usd?.h24))),
              ...opt('pairAddress', attrs.address),
              ...opt('venue', best.pool.relationships?.dex?.data?.id),
              ...opt('buys24h', sumAcrossPools(mine, (pool) => toNumber(pool.attributes.transactions?.h24?.buys))),
              ...opt('sells24h', sumAcrossPools(mine, (pool) => toNumber(pool.attributes.transactions?.h24?.sells))),
              ...opt('priceChange1hPct', toNumber(attrs.price_change_percentage?.h1)),
              ...opt('priceChange6hPct', toNumber(attrs.price_change_percentage?.h6)),
              ...opt('priceChange24hPct', toNumber(attrs.price_change_percentage?.h24)),
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
