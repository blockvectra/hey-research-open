import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { DEXSCREENER_DEFAULT_BASE_URL } from './dexscreener';

/**
 * Token discovery via DEX Screener's public search endpoint (PRD V4 section 25).
 *
 * This is a discovery *input*, not a market-data read: it yields candidate
 * tokens which the discovery pipeline then dedupes and turns into project shells.
 * Results are filtered to the configured chain — the endpoint is cross-chain.
 */
export type TokenCandidate = {
  chainId: number;
  contractAddress: string;
  symbol?: string;
  name?: string;
  pairCreatedAt?: Date;
  /** Which provider surfaced the candidate; kept as provenance. */
  discoveredVia: string;
};

export type DexscreenerSearchInput = {
  /** Numeric chain id stored by HEY, e.g. 4663. */
  chainId: number;
  /** DEX Screener's own chain slug, e.g. `robinhoodchain`. */
  chainSlug: string;
  query: string;
  baseUrl?: string;
};

const searchResponseSchema = z.object({
  pairs: z
    .array(
      z.object({
        chainId: z.string().nullish(),
        baseToken: z
          .object({
            address: z.string().nullish(),
            name: z.string().nullish(),
            symbol: z.string().nullish(),
          })
          .optional(),
        pairCreatedAt: z.number().nullish(),
      }),
    )
    .nullable()
    .optional(),
});

const CACHE_TTL_SECONDS = 300;

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function createDexscreenerSearchAdapter(): SourceAdapter<
  DexscreenerSearchInput,
  TokenCandidate[]
> {
  return {
    name: 'dexscreener-search',

    canHandle(input) {
      return input.query.trim().length > 0 && input.chainSlug.trim().length > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<TokenCandidate[]>> {
      const base = (input.baseUrl ?? DEXSCREENER_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/latest/dex/search?q=${encodeURIComponent(input.query)}`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: searchResponseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): TokenCandidate[] => {
            const seen = new Set<string>();
            const candidates: TokenCandidate[] = [];

            for (const pair of raw.pairs ?? []) {
              // The endpoint is cross-chain; anything off our chain is not ours.
              if (pair.chainId !== input.chainSlug) continue;

              const address = pair.baseToken?.address;
              if (!address || !ADDRESS_PATTERN.test(address)) continue;

              // One pair per token: several pairs commonly share a base token.
              const key = address.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);

              candidates.push({
                chainId: input.chainId,
                contractAddress: address,
                discoveredVia: 'dexscreener-search',
                ...opt('symbol', pair.baseToken?.symbol),
                ...opt('name', pair.baseToken?.name),
                ...opt(
                  'pairCreatedAt',
                  pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : undefined,
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
