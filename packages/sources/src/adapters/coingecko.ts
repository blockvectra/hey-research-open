import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { cleanHttpUrl, twitterUrlFrom } from '../links';
import { opt } from '../optional';

/**
 * CoinGecko — the public coin registry, filtered to one asset platform.
 *
 * Two reads. `/coins/list?include_platform=true` is the whole registry in one
 * ~3.4 MB body, and every entry with a `platforms.<platform>` address is a
 * token CoinGecko has catalogued on that chain. `/coins/{id}` then supplies
 * what the registry row lacks: homepage, artwork, description, categories and
 * the team's Twitter handle. Both are unauthenticated on the free tier, whose
 * effective limit is roughly 10–30 requests a minute, so the detail read is
 * paced by the caller and bounded per run.
 *
 * Verified 2026-09-03: 19,496 coins listed, **690** with a `robinhood`
 * platform address; 148 of those have ids ending `-robinhood-token`. The
 * asset platform id is `robinhood` (chain identifier 4663).
 *
 * Tokenized equities. Robinhood's own stock tokens (`Adobe Inc. • Robinhood
 * Token`, category `Tokenized Stocks`, homepage `docs.robinhood.com/rhj`) are
 * real contracts on the chain but are not projects with a team building them.
 * The adapter flags them as `isTokenizedStock` so the caller can file them
 * under the issuer rather than publish hundreds of near-identical pages.
 */
export const COINGECKO_DEFAULT_BASE_URL = 'https://api.coingecko.com/api/v3';
export const COINGECKO_ROBINHOOD_PLATFORM = 'robinhood';

/** The registry is ~3.4 MB today and grows; 16 MB leaves room without being unbounded. */
const LIST_MAX_BYTES = 16 * 1024 * 1024;
const LIST_CACHE_TTL_SECONDS = 24 * 60 * 60;
/** Homepage, artwork and description change rarely; a week between re-reads. */
const COIN_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TOKENIZED_STOCK_CATEGORY = 'tokenized stocks';
const TOKENIZED_STOCK_ID_SUFFIX = '-robinhood-token';

const listEntrySchema = z.object({
  id: z.string(),
  symbol: z.string().nullish(),
  name: z.string().nullish(),
  platforms: z.record(z.string(), z.string().nullable()).nullish(),
});

const listSchema = z.array(listEntrySchema);

const coinSchema = z.object({
  id: z.string(),
  symbol: z.string().nullish(),
  name: z.string().nullish(),
  asset_platform_id: z.string().nullish(),
  platforms: z.record(z.string(), z.string().nullable()).nullish(),
  categories: z.array(z.string().nullable()).nullish(),
  description: z.object({ en: z.string().nullish() }).nullish(),
  links: z
    .object({
      homepage: z.array(z.string().nullable()).nullish(),
      twitter_screen_name: z.string().nullish(),
      repos_url: z.object({ github: z.array(z.string().nullable()).nullish() }).nullish(),
    })
    .nullish(),
  image: z
    .object({
      thumb: z.string().nullish(),
      small: z.string().nullish(),
      large: z.string().nullish(),
    })
    .nullish(),
});

/** CoinGecko's demo plan sends its key as a header; absent, the keyless public limits apply. */
export const COINGECKO_DEMO_KEY_HEADER = 'x-cg-demo-api-key';
export const coingeckoHeaders = (apiKey: string | undefined): Record<string, string> => (apiKey ? { [COINGECKO_DEMO_KEY_HEADER]: apiKey } : {});

export type CoingeckoListInput = {
  chainId: number;
  /** CoinGecko's asset platform id, `robinhood` for 4663. */
  platform: string;
  baseUrl?: string;
  apiKey?: string;
};

export type CoingeckoListing = {
  chainId: number;
  contractAddress: string;
  /** CoinGecko's coin id, the key for the detail read. */
  id: string;
  symbol?: string;
  name?: string;
  /** How many platforms the coin is catalogued on; 1 means this chain only. */
  platformCount: number;
  /** Named by id alone; the categories that confirm it come from the detail read. */
  isTokenizedStock: boolean;
};

export type CoingeckoCoinInput = {
  chainId: number;
  platform: string;
  id: string;
  baseUrl?: string;
  apiKey?: string;
};

export type CoingeckoCoinDetail = {
  chainId: number;
  id: string;
  /** The coin's address on the requested platform, when the detail lists one. */
  contractAddress?: string;
  symbol?: string;
  name?: string;
  websiteUrl?: string;
  imageUrl?: string;
  description?: string;
  categories: string[];
  twitterUrl?: string;
  githubUrls: string[];
  /** Robinhood's own tokenized equity, by category or id — see the header note. */
  isTokenizedStock: boolean;
};

export const isCoingeckoTokenizedStock = (
  id: string,
  categories: readonly string[] = [],
): boolean =>
  id.endsWith(TOKENIZED_STOCK_ID_SUFFIX) ||
  categories.some((category) => category.trim().toLowerCase() === TOKENIZED_STOCK_CATEGORY);

const platformAddress = (
  platforms: Record<string, string | null> | null | undefined,
  platform: string,
): string | undefined => {
  const value = platforms?.[platform]?.trim().toLowerCase();
  return value && ADDRESS_PATTERN.test(value) ? value : undefined;
};

export function createCoingeckoListAdapter(): SourceAdapter<
  CoingeckoListInput,
  CoingeckoListing[]
> {
  return {
    name: 'coingecko-list',

    canHandle(input) {
      return input.chainId > 0 && input.platform.trim().length > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<CoingeckoListing[]>> {
      const base = (input.baseUrl ?? COINGECKO_DEFAULT_BASE_URL).replace(/\/$/, '');

      return performSourceFetch(
        ctx,
        { url: `${base}/coins/list?include_platform=true`, maxBytes: LIST_MAX_BYTES, headers: coingeckoHeaders(input.apiKey) },
        {
          schema: listSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: LIST_CACHE_TTL_SECONDS,
          normalize: (raw): CoingeckoListing[] => {
            const listings: CoingeckoListing[] = [];
            const seen = new Set<string>();
            for (const coin of raw) {
              const address = platformAddress(coin.platforms, input.platform);
              if (!address || seen.has(address)) continue;
              seen.add(address);
              listings.push({
                chainId: input.chainId,
                contractAddress: address,
                id: coin.id,
                platformCount: Object.keys(coin.platforms ?? {}).length,
                isTokenizedStock: isCoingeckoTokenizedStock(coin.id),
                ...opt('symbol', coin.symbol?.trim() || undefined),
                ...opt('name', coin.name?.trim() || undefined),
              });
            }
            return listings;
          },
        },
      );
    },
  };
}

export function createCoingeckoCoinAdapter(): SourceAdapter<
  CoingeckoCoinInput,
  CoingeckoCoinDetail
> {
  return {
    name: 'coingecko-coin',

    canHandle(input) {
      return input.chainId > 0 && /^[a-z0-9-]+$/.test(input.id);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<CoingeckoCoinDetail>> {
      const base = (input.baseUrl ?? COINGECKO_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url =
        `${base}/coins/${encodeURIComponent(input.id)}` +
        '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false';

      return performSourceFetch(
        ctx,
        { url, headers: coingeckoHeaders(input.apiKey) },
        {
          schema: coinSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: COIN_CACHE_TTL_SECONDS,
          normalize: (raw): CoingeckoCoinDetail => {
            const categories = (raw.categories ?? []).filter(
              (category): category is string =>
                typeof category === 'string' && category.trim().length > 0,
            );
            const homepage = (raw.links?.homepage ?? [])
              .map((entry) => cleanHttpUrl(entry))
              .find((entry): entry is string => Boolean(entry));
            const githubUrls = (raw.links?.repos_url?.github ?? [])
              .map((entry) => cleanHttpUrl(entry))
              .filter((entry): entry is string => Boolean(entry));
            const description = raw.description?.en?.trim() || undefined;

            return {
              chainId: input.chainId,
              id: raw.id,
              categories,
              githubUrls,
              isTokenizedStock: isCoingeckoTokenizedStock(raw.id, categories),
              ...opt('contractAddress', platformAddress(raw.platforms, input.platform)),
              ...opt('symbol', raw.symbol?.trim() || undefined),
              ...opt('name', raw.name?.trim() || undefined),
              ...opt('websiteUrl', homepage),
              ...opt(
                'imageUrl',
                cleanHttpUrl(raw.image?.small ?? raw.image?.large ?? raw.image?.thumb),
              ),
              ...opt('description', description),
              ...opt('twitterUrl', twitterUrlFrom(raw.links?.twitter_screen_name)),
            };
          },
        },
      );
    },
  };
}
