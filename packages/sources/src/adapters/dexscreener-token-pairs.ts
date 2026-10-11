import { z } from 'zod';

import { requireData, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { dexscreenerPairSchema, screeningFromPairs, type TokenScreening } from './dexscreener-tokens';

/**
 * DEX Screener's pools of one token — the market refresh's read (2026-10-11).
 *
 * `GET /token-pairs/v1/{chainId}/{tokenAddress}`, documented as "Get the pools
 * of a given token address" at 300 requests a minute, one address a call.
 * Measured live on 2026-10-11 against the two other token endpoints:
 *
 *  - `/tokens/v1/{chain}/{a,b,…}` (up to thirty addresses) answers **one** pair
 *    per token — the pair DEX Screener features, not the deepest. HEY priced
 *    the catalogue from it, so pages linked a minor pool and read one pool's
 *    depth as the token's (Artificial Inu: a $87K pool linked beside a $3.46M
 *    one; Orbio: $0.93M read against $2.27M across its pools).
 *  - `/latest/dex/tokens/{a,b,…}` is no longer in DEX Screener's reference,
 *    is cross-chain, and caps the whole answer at thirty pairs *across every
 *    address asked*, so a batch of popular tokens is silently truncated.
 *  - This endpoint is chain-scoped and lists the token's pools in the
 *    provider's own order, the pools where it is the quote asset included, up
 *    to thirty.
 *
 * Only the pools where the token is the **base** are its market: a pool that
 * quotes this token (`PRIORS / ORBIO`) prices the other token, and its depth
 * is half the other token's (2026-09-23, the single adapter's rule). Price,
 * valuation, venue and the pair HEY links come from the deepest of those
 * pools; depth, volume and trade counts are summed across them — a floor, not
 * a total, when the provider's thirty-pool cap was reached.
 *
 * One request a token: the market refresh budgets it that way
 * (`MARKET_TOKENS_PER_REQUEST`). Saved fixtures: `dexscreener-token-pairs.json`
 * (thirty base pools, the deepest third in the provider's order) and
 * `dexscreener-token-pairs-quote.json` (seven pools quoting the token).
 */
const responseSchema = z.union([z.array(dexscreenerPairSchema), z.object({ pairs: z.array(dexscreenerPairSchema).nullish() })]);

export type DexscreenerTokenPairsInput = {
  chainId: number;
  /** DEX Screener's slug for the chain (`robinhood`); it is in the path, and pairs echoing another chain are dropped. */
  chainSlug: string;
  tokenAddress: string;
  baseUrl?: string;
};

/** The most pools the endpoint lists for one token (measured 2026-10-11); a listing this long may be cut. */
export const DEXSCREENER_TOKEN_PAIRS_CAP = 30;

const CACHE_TTL_SECONDS = 300;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SLUG_PATTERN = /^[a-z0-9-]{1,40}$/;

export function createDexscreenerTokenPairsAdapter(): SourceAdapter<DexscreenerTokenPairsInput, TokenScreening> {
  return {
    name: 'dexscreener-token-pairs',

    canHandle(input) {
      return SLUG_PATTERN.test(input.chainSlug) && ADDRESS_PATTERN.test(input.tokenAddress);
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<TokenScreening>> {
      const base = (input.baseUrl ?? 'https://api.dexscreener.com').replace(/\/$/, '');
      const address = input.tokenAddress.toLowerCase();
      const url = `${base}/token-pairs/v1/${input.chainSlug}/${address}`;

      const result = await performSourceFetch(
        ctx,
        { url },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): TokenScreening | undefined => {
            const pairs = Array.isArray(raw) ? raw : (raw.pairs ?? []);
            const ours = pairs.filter(
              (pair) => (!pair.chainId || pair.chainId === input.chainSlug) && pair.baseToken?.address?.toLowerCase() === address,
            );
            return screeningFromPairs(input.chainId, address, ours);
          },
        },
      );

      // A valid answer listing no pool of this token is "not covered", never a market of zero.
      return requireData(result, ctx, 'no pairs listed for token', { sourceUrl: url, cacheTtlSeconds: CACHE_TTL_SECONDS });
    },
  };
}
