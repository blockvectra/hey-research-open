import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { pickDeepestLiquidity, priceChangePct, sumAcrossPools, toNumber } from '../market';

/**
 * DEX Screener batch token lookup — the screening step.
 *
 * `/tokens/v1/{chain}/{addresses}` accepts up to 30 addresses per request, so a
 * few hundred candidates can be screened in a handful of calls. Crucially it
 * returns the `info` block: the websites and social links a project declared.
 * Those links are what decide promotion, so this endpoint is where a token stops
 * being an anonymous contract and starts being a candidate project.
 *
 * What it does not return is a token's market (re-measured live 2026-10-11):
 * it answers **one pair per token** — the pair DEX Screener itself features
 * for the token, which is often not its deepest pool. Artificial Inu answered
 * its $87K USDG pool while `/token-pairs/v1` lists a $3.46M NVDA pool for the
 * same token; Orbio answered one pool of $0.93M against $2.27M across its own.
 * So its depth, volume and pair are that one pool's, never the token's market:
 * the market refresh reads `/token-pairs/v1` (`dexscreener-token-pairs.ts`),
 * and this endpoint stays the screening step, where only the declared links
 * matter. (The 2026-09-01 note here said it "returns one entry per pair"; it
 * returns one entry per *token*, and the depth summed across "pools" below is
 * one pool's on this endpoint.)
 */
export const DEXSCREENER_BATCH_SIZE = 30;

const linkSchema = z.object({
  label: z.string().nullish(),
  type: z.string().nullish(),
  url: z.string().nullish(),
});

/** One DEX Screener pair, as `/tokens/v1` and `/token-pairs/v1` both serialise it. */
export const dexscreenerPairSchema = z.object({
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
  // A move too large for numeric(12,4), or not a number, is unknown (2026-09-25): one such value failed the whole batch.
  priceChange: z.object({ h1: priceChangePct, h6: priceChangePct, h24: priceChangePct }).nullish(),
  pairCreatedAt: z.number().nullish(),
  /*
   * Kept since 2026-09-27 (audit D §3): whether the pair carries an active
   * paid boost, and the pool's version labels (`v4`). The boost count is read
   * only as "any"; it is a spend proxy and is never stored as a number.
   */
  boosts: z.object({ active: z.number().nullish() }).nullish(),
  labels: z.array(z.string()).nullish(),
  info: z
    .object({
      imageUrl: z.string().nullish(),
      websites: z.array(linkSchema).nullish(),
      socials: z.array(linkSchema).nullish(),
    })
    .nullish(),
});

/** As the fetch hands it to `normalize`; every figure goes through `toNumber`, which takes either form. */
export type DexscreenerPair = z.input<typeof dexscreenerPairSchema>;

const responseSchema = z.union([
  z.array(dexscreenerPairSchema),
  z.object({ pairs: z.array(dexscreenerPairSchema).nullish() }),
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
  /** A pair of this token carries an active paid boost right now. Presence only — never a count or an amount. */
  promotionActive?: true;
  /** The deepest pair's version labels as DEX Screener shows them (`v4`). */
  pairLabels?: string[];
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

            // This endpoint answers one pair per token (see the note above), so
            // each bucket normally holds one pool; the shared normaliser is the
            // one `/token-pairs/v1` uses, where a bucket is every pool.
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
              const screening = screeningFromPairs(input.chainId, address, tokenPairs);
              if (screening) screenings.push(screening);
            }

            return screenings;
          },
        },
      );
    },
  };
}

/**
 * One token's screening from the pairs DEX Screener listed for it, every one
 * of them with this token as its base (the caller filters).
 *
 * Price, valuation, venue and the pair HEY links to come from the deepest
 * pool — `pickDeepestLiquidity`, the one rule — and depth, volume and trade
 * counts are summed across the pools, because those are properties of the
 * token's market rather than of one pool (2026-09-14). On `/token-pairs/v1`
 * the pools are every pool the provider lists (at most thirty, so the sum is
 * a floor — `sumAcrossPools`); on `/tokens/v1` they are the one pool it
 * features. Undefined when no pair was given.
 */
export function screeningFromPairs(chainId: number, address: string, tokenPairs: readonly DexscreenerPair[]): TokenScreening | undefined {
  const scored = tokenPairs.map((pair) => ({
    pair,
    liquidityUsd: toNumber(pair.liquidity?.usd),
  }));
  const best = pickDeepestLiquidity(scored);
  if (!best) return undefined;

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

  return {
    chainId,
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
    ...opt('pairCreatedAt', createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined),
    ...(tokenPairs.some((row) => (row.boosts?.active ?? 0) > 0) ? { promotionActive: true as const } : {}),
    ...opt('pairLabels', pair.labels && pair.labels.length > 0 ? pair.labels.filter((label) => /^[A-Za-z0-9._-]{1,16}$/.test(label)).slice(0, 5) : undefined),
  };
}
