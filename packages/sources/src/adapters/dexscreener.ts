import { z } from 'zod';

import { requireData, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { pickDeepestLiquidity, sumAcrossPools, toNumber, type MarketContext } from '../market';

/**
 * DEX Screener — primary market-context source (PRD V4 sections 20.1, 21).
 * Cached aggressively; it is never called from a page render path.
 */
export const DEXSCREENER_DEFAULT_BASE_URL = 'https://api.dexscreener.com';

const numericish = z.union([z.string(), z.number()]).nullish();

const pairSchema = z.object({
  chainId: z.string().optional(),
  dexId: z.string().optional(),
  url: z.string().optional(),
  pairAddress: z.string().optional(),
  baseToken: z
    .object({
      address: z.string().optional(),
      name: z.string().optional(),
      symbol: z.string().optional(),
    })
    .optional(),
  priceUsd: numericish,
  liquidity: z.object({ usd: numericish }).nullish(),
  volume: z.object({ h24: numericish }).nullish(),
  txns: z.object({ h24: z.object({ buys: numericish, sells: numericish }).nullish() }).nullish(),
  priceChange: z.object({ h1: numericish, h6: numericish, h24: numericish }).nullish(),
  fdv: numericish,
  marketCap: numericish,
  pairCreatedAt: z.number().nullish(),
  info: z.object({ imageUrl: z.string().nullish() }).nullish(),
});

export const dexscreenerResponseSchema = z.object({
  // The API returns `pairs: null` for an unknown token rather than an error.
  pairs: z.array(pairSchema).nullable().optional(),
});

export type DexscreenerResponse = z.infer<typeof dexscreenerResponseSchema>;

export type DexscreenerInput = {
  chainId: number;
  tokenAddress: string;
  baseUrl?: string;
};

const CACHE_TTL_SECONDS = 300;

export function createDexscreenerAdapter(): SourceAdapter<DexscreenerInput, MarketContext> {
  return {
    name: 'dexscreener',

    canHandle(input) {
      return /^0x[a-fA-F0-9]{40}$/.test(input.tokenAddress);
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<MarketContext>> {
      const base = (input.baseUrl ?? DEXSCREENER_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/latest/dex/tokens/${input.tokenAddress}`;

      const result = await performSourceFetch(
        ctx,
        { url },
        {
          schema: dexscreenerResponseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): MarketContext | undefined => {
            /*
             * The endpoint answers with every pair the token appears in,
             * including ones where it is the quote asset rather than the thing
             * being priced. Only the pairs it is the base of are this token's
             * market; if the provider omits the base token entirely, take what
             * it gave rather than dropping the reading.
             */
            const all = raw.pairs ?? [];
            const ours = all.filter((pair) => pair.baseToken?.address?.toLowerCase() === input.tokenAddress.toLowerCase());
            const mine = ours.length > 0 ? ours : all;
            const pairs = mine.map((pair) => ({
              pair,
              liquidityUsd: toNumber(pair.liquidity?.usd),
            }));
            const best = pickDeepestLiquidity(pairs);
            if (!best) return undefined;

            const { pair } = best;
            return {
              chainId: input.chainId,
              tokenAddress: input.tokenAddress,
              source: 'dexscreener',
              ...opt('symbol', pair.baseToken?.symbol),
              ...opt('name', pair.baseToken?.name),
              ...opt('priceUsd', toNumber(pair.priceUsd)),
              ...opt('marketCapUsd', toNumber(pair.marketCap)),
              ...opt('fdvUsd', toNumber(pair.fdv)),
              // Depth, volume and trade counts belong to the token's whole
              // market; price, valuation and venue to the pool that quotes it.
              ...opt('liquidityUsd', sumAcrossPools(mine, (row) => toNumber(row.liquidity?.usd))),
              ...opt('volume24hUsd', sumAcrossPools(mine, (row) => toNumber(row.volume?.h24))),
              ...opt('pairAddress', pair.pairAddress),
              ...opt('pairUrl', pair.url),
              ...opt('venue', pair.dexId),
              ...opt('buys24h', sumAcrossPools(mine, (row) => toNumber(row.txns?.h24?.buys))),
              ...opt('sells24h', sumAcrossPools(mine, (row) => toNumber(row.txns?.h24?.sells))),
              ...opt('priceChange1hPct', toNumber(pair.priceChange?.h1)),
              ...opt('priceChange6hPct', toNumber(pair.priceChange?.h6)),
              ...opt('priceChange24hPct', toNumber(pair.priceChange?.h24)),
              ...opt('imageUrl', pair.info?.imageUrl?.trim() || undefined),
              ...opt(
                'pairCreatedAt',
                pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : undefined,
              ),
            };
          },
        },
      );

      // A valid response listing no pairs means "not covered", not "provider broke".
      return requireData(result, ctx, 'no pairs listed for token', {
        sourceUrl: url,
        cacheTtlSeconds: CACHE_TTL_SECONDS,
      });
    },
  };
}
