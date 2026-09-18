import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { pickDeepestLiquidity, sumAcrossPools, toNumber } from '../market';

/**
 * DEX Screener batch token lookup — the screening step.
 *
 * `/tokens/v1/{chain}/{addresses}` accepts up to 30 addresses per request, so a
 * few hundred candidates can be screened in a handful of calls. Crucially it
 * returns the `info` block: the websites and social links a project declared.
 * Those links are what decide promotion, so this endpoint is where a token stops
 * being an anonymous contract and starts being a candidate project.
 *
 * Verified 2026-09-01: `tokens/v1/robinhood/{a,b,c}` returns one entry per pair,
 * and 12 of 25 Robinhood Chain pairs carried website or social metadata.
 */
export const DEXSCREENER_BATCH_SIZE = 30;

const linkSchema = z.object({
  label: z.string().nullish(),
  type: z.string().nullish(),
  url: z.string().nullish(),
});

const pairSchema = z.object({
  chainId: z.string().nullish(),
  dexId: z.string().nullish(),
  pairAddress: z.string().nullish(),
  url: z.string().nullish(),
  baseToken: z
    .object({
      address: z.string().nullish(),
      name: z.string().nullish(),
      symbol: z.string().nullish(),
    })
    .optional(),
  priceUsd: z.union([z.string(), z.number()]).nullish(),
  marketCap: z.union([z.string(), z.number()]).nullish(),
  fdv: z.union([z.string(), z.number()]).nullish(),
  liquidity: z.object({ usd: z.union([z.string(), z.number()]).nullish() }).nullish(),
  volume: z.object({ h24: z.union([z.string(), z.number()]).nullish() }).nullish(),
  // The provider sends these in the same payload; the schema dropped them and every card's venue line stayed empty (2026-09-18).
  txns: z.object({ h24: z.object({ buys: z.union([z.string(), z.number()]).nullish(), sells: z.union([z.string(), z.number()]).nullish() }).nullish() }).nullish(),
  priceChange: z.object({ h1: z.union([z.string(), z.number()]).nullish(), h6: z.union([z.string(), z.number()]).nullish(), h24: z.union([z.string(), z.number()]).nullish() }).nullish(),
  pairCreatedAt: z.number().nullish(),
  info: z
    .object({
      imageUrl: z.string().nullish(),
      websites: z.array(linkSchema).nullish(),
      socials: z.array(linkSchema).nullish(),
    })
    .nullish(),
});

const responseSchema = z.union([
  z.array(pairSchema),
  z.object({ pairs: z.array(pairSchema).nullish() }),
]);

export type DexscreenerTokensInput = {
  chainId: number;
  chainSlug: string;
  /** At most `DEXSCREENER_BATCH_SIZE`; the caller chunks. */
  addresses: readonly string[];
  baseUrl?: string;
};

/** What screening learned about one token. */
export type TokenScreening = {
  chainId: number;
  contractAddress: string;
  name?: string;
  symbol?: string;
  websiteUrl?: string;
  /** Token artwork from the profile the deployer submitted. */
  imageUrl?: string;
  /** Every declared site, so docs and repositories can be picked out. */
  websites: string[];
  socials: { type: string; url: string }[];
  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  priceUsd?: number;
  pairAddress?: string;
  pairUrl?: string;
  pairCreatedAt?: Date;
  /** The DEX the deepest pair is on, and the market's trade counts and moves — the batch path kept none of them until 2026-09-18. */
  venue?: string;
  buys24h?: number;
  sells24h?: number;
  priceChange1hPct?: number;
  priceChange6hPct?: number;
  priceChange24hPct?: number;
};

const CACHE_TTL_SECONDS = 300;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const cleanUrl = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

export function createDexscreenerTokensAdapter(): SourceAdapter<
  DexscreenerTokensInput,
  TokenScreening[]
> {
  return {
    name: 'dexscreener-tokens',

    canHandle(input) {
      return (
        input.chainSlug.length > 0 &&
        input.addresses.length > 0 &&
        input.addresses.length <= DEXSCREENER_BATCH_SIZE &&
        input.addresses.every((address) => ADDRESS_PATTERN.test(address))
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<TokenScreening[]>> {
      const base = (input.baseUrl ?? 'https://api.dexscreener.com').replace(/\/$/, '');
      const url = `${base}/tokens/v1/${input.chainSlug}/${input.addresses.join(',')}`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): TokenScreening[] => {
            const pairs = Array.isArray(raw) ? raw : (raw.pairs ?? []);

            // Several pairs can share one token. Price, valuation and venue
            // come from the deepest pair; depth, volume and trade counts are
            // summed across them all, because those are properties of the
            // token's market rather than of one pool (2026-09-14).
            const byToken = new Map<string, typeof pairs>();
            for (const pair of pairs) {
              // The chain is in the path, but a provider echoing a different one
              // must not slip a foreign-chain token into a chain-locked product.
              if (pair.chainId && pair.chainId !== input.chainSlug) continue;
              const address = pair.baseToken?.address?.toLowerCase();
              if (!address || !ADDRESS_PATTERN.test(address)) continue;
              const bucket = byToken.get(address);
              if (bucket) bucket.push(pair);
              else byToken.set(address, [pair]);
            }

            const screenings: TokenScreening[] = [];

            for (const [address, tokenPairs] of byToken) {
              const scored = tokenPairs.map((pair) => ({
                pair,
                liquidityUsd: toNumber(pair.liquidity?.usd),
              }));
              const best = pickDeepestLiquidity(scored);
              if (!best) continue;

              const { pair } = best;
              const info = pair.info ?? {};
              const websites = (info.websites ?? [])
                .map((entry) => cleanUrl(entry.url))
                .filter((url): url is string => Boolean(url));
              const socials = (info.socials ?? [])
                .map((entry) => {
                  const url = cleanUrl(entry.url);
                  return url ? { type: entry.type ?? entry.label ?? 'other', url } : undefined;
                })
                .filter((entry): entry is { type: string; url: string } => Boolean(entry));

              const createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : undefined;

              screenings.push({
                chainId: input.chainId,
                contractAddress: address,
                websites,
                socials,
                ...opt('name', pair.baseToken?.name),
                ...opt('symbol', pair.baseToken?.symbol),
                ...opt('websiteUrl', websites[0]),
                ...opt('imageUrl', cleanUrl(info.imageUrl)),
                ...opt('marketCapUsd', toNumber(pair.marketCap)),
                ...opt('fdvUsd', toNumber(pair.fdv)),
                ...opt('liquidityUsd', sumAcrossPools(tokenPairs, (row) => toNumber(row.liquidity?.usd))),
                ...opt('volume24hUsd', sumAcrossPools(tokenPairs, (row) => toNumber(row.volume?.h24))),
                ...opt('priceUsd', toNumber(pair.priceUsd)),
                ...opt('pairAddress', pair.pairAddress),
                ...opt('pairUrl', pair.url),
                ...opt('venue', pair.dexId ?? undefined),
                ...opt('buys24h', sumAcrossPools(tokenPairs, (row) => toNumber(row.txns?.h24?.buys))),
                ...opt('sells24h', sumAcrossPools(tokenPairs, (row) => toNumber(row.txns?.h24?.sells))),
                ...opt('priceChange1hPct', toNumber(pair.priceChange?.h1)),
                ...opt('priceChange6hPct', toNumber(pair.priceChange?.h6)),
                ...opt('priceChange24hPct', toNumber(pair.priceChange?.h24)),
                ...opt(
                  'pairCreatedAt',
                  createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined,
                ),
              });
            }

            return screenings;
          },
        },
      );
    },
  };
}
