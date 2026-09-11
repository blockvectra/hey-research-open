import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { cleanHttpUrl, socialTypeForUrl, twitterUrlFrom, type SocialLink } from '../links';
import { opt } from '../optional';

/**
 * PAIR (pair.fund) — the multipool RWA launchpad on Robinhood Chain, read
 * through the JSON endpoint its own app renders from.
 *
 * Every launch pairs a new token with one or more tokenized stocks in Uniswap
 * v4 pools. The launcher contract's event carries the token address and a
 * metadata URL but not the name, symbol or links, so the factory scan alone
 * would leave every PAIR launch without identity. This endpoint carries what
 * the creator typed at launch — name, ticker, description, website, socials,
 * artwork — plus the launch transaction, so the candidate keeps its provenance.
 *
 * Verified 2026-09-03: `/api/tokens?limit=100&page=2` → `total: 1446`, 100
 * items, newest first, with a weak `ETag`. Curve and market figures
 * (`marketCapUsd`, `priceUsd`, `graduationProgress`, `holders`) are validated
 * only as far as the schema needs and are not surfaced: market context comes
 * from the market adapters, and holder counts are not read at all.
 */
export const PAIRFUND_DEFAULT_BASE_URL = 'https://pair.fund';
/** The endpoint accepts `limit=100`; 15 pages cover the whole catalogue. */
export const PAIRFUND_PAGE_SIZE = 100;

const CACHE_TTL_SECONDS = 60 * 60;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

/**
 * A figure the launchpad sends as a string, or nothing. Zero and negatives are
 * dropped rather than stored: a token the curve has not priced yet reports
 * `null` or `0`, and a zero market cap recorded as a reading would be a
 * measurement HEY never made.
 */
const positiveNumber = (value: string | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const TX_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const tokenSchema = z.object({
  address: z.string(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  description: z.string().nullish(),
  website: z.string().nullish(),
  twitter: z.string().nullish(),
  telegram: z.string().nullish(),
  discord: z.string().nullish(),
  /** A path on pair.fund (`/api/images/<hash>`) or an absolute URL. */
  imageUrl: z.string().nullish(),
  metadataUri: z.string().nullish(),
  creator: z.string().nullish(),
  launchTxHash: z.string().nullish(),
  /** Unix seconds. */
  launchedAt: z.number().nullish(),
  graduated: z.boolean().nullish(),
  hidden: z.boolean().nullish(),
  flagged: z.boolean().nullish(),
  quoteToken: z.object({ address: z.string().nullish(), symbol: z.string().nullish() }).nullish(),
  /*
   * The launchpad's own curve valuation, as strings (2026-09-05). Surfaced
   * because no aggregator can price these: a pre-graduation token has no pool,
   * and DEX Screener and GeckoTerminal both return nothing for one. The
   * launchpad is the only party that knows, so HEY records what it says and
   * labels it `pairfund` — never as a DEX reading.
   */
  marketCapUsd: z.string().nullish(),
  priceUsd: z.string().nullish(),
  pairs: z
    .array(z.object({ poolId: z.string().nullish(), ammVersion: z.string().nullish() }))
    .nullish(),
});

const responseSchema = z.object({
  items: z.array(tokenSchema).nullish(),
  total: z.number().nullish(),
  page: z.number().nullish(),
  limit: z.number().nullish(),
});

export type PairfundInput = {
  chainId: number;
  page: number;
  limit?: number;
  baseUrl?: string;
};

export type PairfundToken = {
  chainId: number;
  contractAddress: string;
  name?: string;
  symbol?: string;
  description?: string;
  websiteUrl?: string;
  /** Absolute https URL on pair.fund. */
  imageUrl?: string;
  socials: SocialLink[];
  creatorAddress?: string;
  launchTxHash?: string;
  launchTimestamp?: Date;
  graduated?: boolean;
  /** The tokenized stock (or other asset) the launch is paired with. */
  quoteSymbol?: string;
  /** Uniswap v4 pool id of the first pair. */
  pairAddress?: string;
  /** The launchpad's curve valuation in USD, when it reports one. */
  marketCapUsd?: number;
  priceUsd?: number;
  /** Hidden or flagged by the launchpad itself; kept so a caller can skip it. */
  hidden: boolean;
};

export type PairfundPage = { tokens: PairfundToken[]; total?: number; page: number };

export function createPairfundAdapter(): SourceAdapter<PairfundInput, PairfundPage> {
  return {
    name: 'pairfund',

    canHandle(input) {
      return input.chainId > 0 && Number.isInteger(input.page) && input.page >= 1;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<PairfundPage>> {
      const base = (input.baseUrl ?? PAIRFUND_DEFAULT_BASE_URL).replace(/\/$/, '');
      const limit = Math.min(Math.max(input.limit ?? PAIRFUND_PAGE_SIZE, 1), PAIRFUND_PAGE_SIZE);
      const url = `${base}/api/tokens?limit=${limit}&page=${input.page}`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): PairfundPage => {
            const tokens: PairfundToken[] = [];

            for (const item of raw.items ?? []) {
              const address = item.address.trim().toLowerCase();
              if (!ADDRESS_PATTERN.test(address)) continue;

              const socials: SocialLink[] = [];
              const push = (type: string, link: string | undefined) => {
                if (link && !socials.some((entry) => entry.url === link)) {
                  socials.push({ type, url: link });
                }
              };
              push('twitter', twitterUrlFrom(item.twitter));
              push('telegram', cleanHttpUrl(item.telegram));
              push('discord', cleanHttpUrl(item.discord));

              // A social network given as the website is a social, not a site.
              let websiteUrl = cleanHttpUrl(item.website);
              if (websiteUrl) {
                const social = socialTypeForUrl(websiteUrl);
                if (social) {
                  push(social, websiteUrl);
                  websiteUrl = undefined;
                }
              }

              const image = item.imageUrl?.trim();
              const imageUrl = image
                ? image.startsWith('/')
                  ? `${base}${image}`
                  : cleanHttpUrl(image)
                : undefined;

              const creator = item.creator?.trim().toLowerCase();
              const tx = item.launchTxHash?.trim().toLowerCase();
              const launchedAt =
                typeof item.launchedAt === 'number' && item.launchedAt > 0
                  ? new Date(item.launchedAt * 1000)
                  : undefined;
              const poolId = item.pairs?.[0]?.poolId?.trim().toLowerCase();

              tokens.push({
                chainId: input.chainId,
                contractAddress: address,
                socials,
                hidden: Boolean(item.hidden) || Boolean(item.flagged),
                ...opt('name', item.name?.trim() || undefined),
                ...opt('symbol', item.symbol?.trim() || undefined),
                ...opt('description', item.description?.trim() || undefined),
                ...opt('websiteUrl', websiteUrl),
                ...opt('imageUrl', imageUrl),
                ...opt('creatorAddress', creator && ADDRESS_PATTERN.test(creator) ? creator : undefined),
                ...opt('launchTxHash', tx && TX_PATTERN.test(tx) ? tx : undefined),
                ...opt('launchTimestamp', launchedAt),
                ...opt('graduated', item.graduated ?? undefined),
                ...opt('marketCapUsd', positiveNumber(item.marketCapUsd)),
                ...opt('priceUsd', positiveNumber(item.priceUsd)),
                ...opt('quoteSymbol', item.quoteToken?.symbol?.trim() || undefined),
                ...opt('pairAddress', poolId && /^0x[a-f0-9]{64}$/.test(poolId) ? poolId : undefined),
              });
            }

            return {
              tokens,
              page: raw.page ?? input.page,
              ...opt('total', raw.total ?? undefined),
            };
          },
        },
      );
    },
  };
}
