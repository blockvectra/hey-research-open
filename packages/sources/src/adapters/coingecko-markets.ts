import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { coingeckoHeaders } from './coingecko';
import { cleanHttpUrl } from '../links';
import { toNumber } from '../market';
import { opt } from '../optional';
import { COINGECKO_DEFAULT_BASE_URL } from './coingecko';

/**
 * CoinGecko `/coins/markets` — current price, market cap, FDV and volume for
 * up to 250 coins in one request.
 *
 * The registry adapter (`coingecko.ts`) says *which* coins are on Robinhood
 * Chain; this one says what the market thinks of them today. Keyed by
 * CoinGecko id, never by symbol: the caller resolves ids from the registry's
 * `platforms.robinhood` address so the reading lands on the right
 * `(chain_id, contract_address)`.
 *
 * Verified 2026-09-03 on the free tier: `ids=pons,1inch,agentos,…&per_page=250`
 * answered with `current_price`, `market_cap`, `fully_diluted_valuation`,
 * `total_volume` and `last_updated`; `cache-control: max-age=30`, ETag sent.
 * `/simple/token_price/{platform}` accepts one address per free call and is
 * deliberately not used. CoinGecko reports an unknown market cap as `0`, so a
 * zero is treated as absent rather than as a real figure (PRD V4 section 29:
 * never manufacture market cap).
 *
 * Market data is context only. It never touches activity status, Build
 * Momentum or ranking (CLAUDE.md product rules 3 and 6).
 */
export const COINGECKO_MARKETS_BATCH_SIZE = 250;

/** The free tier is roughly 5–15 requests a minute; readings an hour old are fine. */
const CACHE_TTL_SECONDS = 60 * 60;

const COIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

const quoteSchema = z.object({
  id: z.string(),
  symbol: z.string().nullish(),
  name: z.string().nullish(),
  image: z.string().nullish(),
  current_price: z.number().nullish(),
  market_cap: z.number().nullish(),
  fully_diluted_valuation: z.number().nullish(),
  total_volume: z.number().nullish(),
  last_updated: z.string().nullish(),
});

const responseSchema = z.array(quoteSchema);

export type CoingeckoMarketsInput = {
  /** CoinGecko coin ids, at most `COINGECKO_MARKETS_BATCH_SIZE`; the caller chunks. */
  ids: readonly string[];
  baseUrl?: string;
  apiKey?: string;
};

export type CoingeckoMarketQuote = {
  id: string;
  symbol?: string;
  name?: string;
  priceUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  volume24hUsd?: number;
  /** CoinGecko's own artwork for the coin. */
  imageUrl?: string;
  /** When CoinGecko last refreshed the figures, as it reports it. */
  updatedAt?: Date;
  /** CoinGecko's public page for the coin, kept as the snapshot's provenance pointer. */
  pageUrl: string;
};

/** A zero from CoinGecko means "not known", not "worth nothing". */
const positive = (value: number | null | undefined): number | undefined => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

export function coingeckoMarketsUrl(base: string, ids: readonly string[]): string {
  const root = base.replace(/\/$/, '');
  const list = ids.map((id) => encodeURIComponent(id)).join(',');
  return (
    `${root}/coins/markets?vs_currency=usd&ids=${list}` +
    `&per_page=${COINGECKO_MARKETS_BATCH_SIZE}&page=1&sparkline=false&precision=full`
  );
}

export function createCoingeckoMarketsAdapter(): SourceAdapter<
  CoingeckoMarketsInput,
  CoingeckoMarketQuote[]
> {
  return {
    name: 'coingecko-markets',

    canHandle(input) {
      return (
        input.ids.length > 0 &&
        input.ids.length <= COINGECKO_MARKETS_BATCH_SIZE &&
        input.ids.every((id) => COIN_ID_PATTERN.test(id))
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<CoingeckoMarketQuote[]>> {
      const url = coingeckoMarketsUrl(input.baseUrl ?? COINGECKO_DEFAULT_BASE_URL, input.ids);

      return performSourceFetch(
        ctx,
        { url, conditional: true, headers: coingeckoHeaders(input.apiKey) },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): CoingeckoMarketQuote[] => {
            const requested = new Set(input.ids);
            const quotes: CoingeckoMarketQuote[] = [];
            const seen = new Set<string>();
            for (const coin of raw) {
              // Only what was asked for, once: a provider echoing extra rows
              // must not attach a reading to a coin the caller never mapped.
              if (!requested.has(coin.id) || seen.has(coin.id)) continue;
              seen.add(coin.id);
              const updatedAt = coin.last_updated ? new Date(coin.last_updated) : undefined;
              quotes.push({
                id: coin.id,
                pageUrl: `https://www.coingecko.com/en/coins/${encodeURIComponent(coin.id)}`,
                ...opt('symbol', coin.symbol?.trim() || undefined),
                ...opt('name', coin.name?.trim() || undefined),
                ...opt('priceUsd', positive(coin.current_price)),
                ...opt('marketCapUsd', positive(coin.market_cap)),
                ...opt('fdvUsd', positive(coin.fully_diluted_valuation)),
                ...opt('volume24hUsd', positive(coin.total_volume)),
                ...opt('imageUrl', cleanHttpUrl(coin.image)),
                ...opt(
                  'updatedAt',
                  updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : undefined,
                ),
              });
            }
            return quotes;
          },
        },
      );
    },
  };
}
