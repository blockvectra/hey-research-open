import { z } from 'zod';

import { requireData, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { GECKOTERMINAL_DEFAULT_BASE_URL } from './geckoterminal';

/**
 * GeckoTerminal token info (2026-09-08).
 *
 * The listing a team fills in on GeckoTerminal: website, X, Telegram, Discord,
 * a description, the registry's categories and the token image. Free, public,
 * one read per token, and available for every token with a pool — which is
 * most of the cards HEY shows without a website or an X account.
 *
 * Deliberately not read: the holder count, the developer address and its
 * holding share. HEY does not do holder or wallet analytics (CLAUDE.md rule
 * 1), so the schema never sees those fields.
 */
const infoSchema = z.object({
  data: z.object({
    attributes: z.object({
      name: z.string().nullish(),
      symbol: z.string().nullish(),
      image_url: z.string().nullish(),
      coingecko_coin_id: z.string().nullish(),
      websites: z.array(z.string()).nullish(),
      discord_url: z.string().nullish(),
      farcaster_url: z.string().nullish(),
      telegram_handle: z.string().nullish(),
      twitter_handle: z.string().nullish(),
      description: z.string().nullish(),
      categories: z.array(z.string()).nullish(),
      gt_verified: z.boolean().nullish(),
    }),
  }),
});

export type TokenInfo = {
  name?: string;
  symbol?: string;
  description?: string;
  websites: string[];
  twitterUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
  farcasterUrl?: string;
  categories: string[];
  imageUrl?: string;
  coingeckoCoinId?: string;
  /** GeckoTerminal's own "verified listing" mark: the team claimed the page, nothing more. */
  listingVerified: boolean;
};

export type GeckoterminalInfoInput = {
  network: string;
  tokenAddress: string;
  baseUrl?: string;
};

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MISSING_IMAGE = /missing\.png$/i;

const clean = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const handleUrl = (base: string, handle: string | null | undefined): string | undefined => {
  const h = clean(handle)?.replace(/^@/, '').replace(/^https?:\/\/[^/]+\//i, '');
  return h && /^[A-Za-z0-9_]{1,32}$/.test(h) ? `${base}/${h}` : undefined;
};

export function createGeckoterminalInfoAdapter(): SourceAdapter<GeckoterminalInfoInput, TokenInfo> {
  return {
    name: 'geckoterminal-info',

    canHandle(input) {
      return input.network.length > 0 && /^0x[a-fA-F0-9]{40}$/.test(input.tokenAddress);
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<TokenInfo>> {
      const base = (input.baseUrl ?? GECKOTERMINAL_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}/networks/${input.network}/tokens/${input.tokenAddress.toLowerCase()}/info`;

      const result = await performSourceFetch(
        ctx,
        { url },
        {
          schema: infoSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): TokenInfo => {
            const a = raw.data.attributes;
            const image = clean(a.image_url);
            const info: TokenInfo = {
              websites: (a.websites ?? []).map((w) => w.trim()).filter((w) => /^https?:\/\//i.test(w)),
              categories: (a.categories ?? []).map((c) => c.trim()).filter(Boolean),
              listingVerified: a.gt_verified === true,
            };
            const name = clean(a.name);
            const symbol = clean(a.symbol);
            const description = clean(a.description);
            const twitterUrl = handleUrl('https://x.com', a.twitter_handle);
            const telegramUrl = handleUrl('https://t.me', a.telegram_handle);
            const discordUrl = clean(a.discord_url);
            const farcasterUrl = clean(a.farcaster_url);
            const coingeckoCoinId = clean(a.coingecko_coin_id);
            if (name) info.name = name;
            if (symbol) info.symbol = symbol;
            if (description) info.description = description;
            if (twitterUrl) info.twitterUrl = twitterUrl;
            if (telegramUrl) info.telegramUrl = telegramUrl;
            if (discordUrl && /^https?:\/\//i.test(discordUrl)) info.discordUrl = discordUrl;
            if (farcasterUrl && /^https?:\/\//i.test(farcasterUrl)) info.farcasterUrl = farcasterUrl;
            if (image && !MISSING_IMAGE.test(image)) info.imageUrl = image;
            if (coingeckoCoinId) info.coingeckoCoinId = coingeckoCoinId;
            return info;
          },
        },
      );

      return requireData(result, ctx, 'no token info', { sourceUrl: url, cacheTtlSeconds: CACHE_TTL_SECONDS });
    },
  };
}
