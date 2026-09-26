import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { DEXSCREENER_DEFAULT_BASE_URL } from './dexscreener';
import { providerDate } from './dexscreener-profiles';

/**
 * DEX Screener promotion and community-takeover context (2026-09-27, brief §26).
 *
 * Two cross-chain feeds and one per-token endpoint, all keyless and documented
 * at 60 requests a minute:
 *
 *   `/community-takeovers/latest/v1`   takeover claims, each with `claimDate`
 *   `/ads/latest/v1`                   ads, each with its `date` and `type`
 *   `/orders/v1/{chain}/{token}`       a token's paid orders (profile, takeover,
 *                                      ads) and boosts, each with `paymentTimestamp`
 *
 * What HEY keeps is that a promotion or a takeover was observed, of which
 * kind, and the provider's own timestamp. What it validates and drops:
 * `impressions`, `amount`, `totalAmount` and any other spend or reach figure —
 * paid placement is market context, never evidence of building, never a
 * ranking input and never a number HEY publishes (product rules 3, 6).
 *
 * Verified live 2026-09-27: takeovers 2 of 13 on `robinhood`, ads 12 of 30;
 * an order read for a Robinhood token returned one approved `tokenProfile`
 * order and one boost, and an unknown token returned `{"orders":[],"boosts":[]}`.
 */
export type DexscreenerPromotionFeed = 'takeovers' | 'ads';

export const DEXSCREENER_PROMOTION_FEEDS: readonly DexscreenerPromotionFeed[] = ['takeovers', 'ads'];

const FEED_PATHS: Record<DexscreenerPromotionFeed, string> = {
  takeovers: '/community-takeovers/latest/v1',
  ads: '/ads/latest/v1',
};

/** The two things HEY records about a token from these endpoints. */
export type PromotionKind = 'MARKET_PROMOTION_OBSERVED' | 'COMMUNITY_TAKEOVER_PROFILE_OBSERVED';

export type PromotionSighting = {
  chainId: number;
  /** Lower-cased. */
  contractAddress: string;
  kind: PromotionKind;
  /** `takeover_claim`, `ad`, `boost_order`, `profile_order`, `takeover_order`, or `<type>_order` for another order type. */
  channel: string;
  /** The provider's own timestamp; never HEY's clock. */
  providerAt: Date;
};

const JSON_TYPES = ['application/json'] as const;
const CACHE_TTL_SECONDS = 15 * 60;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
/** Channel names are provider words; kept short and plain so they never carry anything else. */
const CHANNEL_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

const feedRecordSchema = z.object({
  chainId: z.string().nullish(),
  tokenAddress: z.string().nullish(),
  claimDate: z.string().nullish(),
  date: z.string().nullish(),
  type: z.string().nullish(),
  /** Ads only: validated so the payload is what we think it is, then dropped. */
  impressions: z.number().nullish(),
});

const feedSchema = z.array(z.unknown());

export type DexscreenerPromotionFeedInput = {
  chainId: number;
  /** DEX Screener's chain slug, `robinhood` for 4663. */
  chainSlug: string;
  feed: DexscreenerPromotionFeed;
  baseUrl?: string;
};

/** `tokenAd` → `token_ad`: a provider word as a channel name, or nothing if it is not a plain word. */
export const channelOf = (type: string | null | undefined, suffix?: string): string | undefined => {
  // Only a plain provider word becomes a channel; anything with markup or punctuation does not.
  if (!type || !/^[A-Za-z0-9 _.-]{1,40}$/.test(type.trim())) return undefined;
  const snake = type
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
  const channel = suffix ? `${snake}_${suffix}` : snake;
  return CHANNEL_PATTERN.test(channel) ? channel : undefined;
};

export function createDexscreenerPromotionFeedAdapter(): SourceAdapter<DexscreenerPromotionFeedInput, PromotionSighting[]> {
  return {
    name: 'dexscreener-promotions',

    canHandle(input) {
      return input.chainSlug.trim().length > 0 && input.feed in FEED_PATHS;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<PromotionSighting[]>> {
      const base = (input.baseUrl ?? DEXSCREENER_DEFAULT_BASE_URL).replace(/\/$/, '');
      return performSourceFetch(
        ctx,
        { url: `${base}${FEED_PATHS[input.feed]}`, allowedContentTypes: JSON_TYPES },
        {
          schema: feedSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): PromotionSighting[] => {
            const out: PromotionSighting[] = [];
            const seen = new Set<string>();
            for (const entry of raw) {
              const parsed = feedRecordSchema.safeParse(entry);
              if (!parsed.success) continue;
              const record = parsed.data;
              if (record.chainId !== input.chainSlug) continue;
              const address = record.tokenAddress?.toLowerCase();
              if (!address || !ADDRESS_PATTERN.test(address)) continue;
              // Undated records are not kept: this adapter exists for the provider's own date.
              const providerAt = providerDate(input.feed === 'takeovers' ? record.claimDate : record.date);
              if (!providerAt) continue;
              const channel = input.feed === 'takeovers' ? 'takeover_claim' : (channelOf(record.type) ?? 'ad');
              const kind: PromotionKind = input.feed === 'takeovers' ? 'COMMUNITY_TAKEOVER_PROFILE_OBSERVED' : 'MARKET_PROMOTION_OBSERVED';
              const key = `${address}|${channel}|${providerAt.toISOString()}`;
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({ chainId: input.chainId, contractAddress: address, kind, channel, providerAt });
            }
            return out;
          },
        },
      );
    },
  };
}

/* ------------------------------------------------------------ orders */

const orderSchema = z.object({
  chainId: z.string().nullish(),
  tokenAddress: z.string().nullish(),
  type: z.string().nullish(),
  status: z.string().nullish(),
  paymentTimestamp: z.number().nullish(),
});

const boostSchema = z.object({
  chainId: z.string().nullish(),
  tokenAddress: z.string().nullish(),
  id: z.string().nullish(),
  /** Validated so the payload is what we think it is; never kept. */
  amount: z.number().nullish(),
  paymentTimestamp: z.number().nullish(),
});

const ordersSchema = z.object({
  orders: z.array(z.unknown()).nullish(),
  boosts: z.array(z.unknown()).nullish(),
});

export type DexscreenerOrdersInput = {
  chainId: number;
  chainSlug: string;
  tokenAddress: string;
  baseUrl?: string;
};

export type DexscreenerOrders = {
  sightings: PromotionSighting[];
  /** Orders present but not approved (processing, cancelled, rejected): counted, never recorded. */
  notApproved: number;
};

/** An order type as its kind: a takeover order is takeover context, everything else paid promotion. */
const orderKind = (type: string): PromotionKind => (type === 'communityTakeover' ? 'COMMUNITY_TAKEOVER_PROFILE_OBSERVED' : 'MARKET_PROMOTION_OBSERVED');

export function createDexscreenerOrdersAdapter(): SourceAdapter<DexscreenerOrdersInput, DexscreenerOrders> {
  return {
    name: 'dexscreener-orders',

    canHandle(input) {
      return input.chainSlug.trim().length > 0 && ADDRESS_PATTERN.test(input.tokenAddress);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<DexscreenerOrders>> {
      const base = (input.baseUrl ?? DEXSCREENER_DEFAULT_BASE_URL).replace(/\/$/, '');
      const wanted = input.tokenAddress.toLowerCase();
      const url = `${base}/orders/v1/${encodeURIComponent(input.chainSlug)}/${wanted}`;
      return performSourceFetch(
        ctx,
        { url, allowedContentTypes: JSON_TYPES },
        {
          schema: ordersSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): DexscreenerOrders => {
            const sightings: PromotionSighting[] = [];
            const seen = new Set<string>();
            let notApproved = 0;
            const push = (sighting: PromotionSighting) => {
              const key = `${sighting.channel}|${sighting.providerAt.toISOString()}`;
              if (seen.has(key)) return;
              seen.add(key);
              sightings.push(sighting);
            };
            // The token in the path is the only token this answer may speak for.
            const mine = (chain: string | null | undefined, address: string | null | undefined) =>
              (!chain || chain === input.chainSlug) && (!address || address.toLowerCase() === wanted);

            for (const entry of raw.orders ?? []) {
              const parsed = orderSchema.safeParse(entry);
              if (!parsed.success) continue;
              const order = parsed.data;
              if (!mine(order.chainId, order.tokenAddress)) continue;
              const providerAt = providerDate(order.paymentTimestamp);
              const channel = channelOf(order.type, 'order');
              if (!providerAt || !channel || !order.type) continue;
              if ((order.status ?? '').toLowerCase() !== 'approved') {
                notApproved += 1;
                continue;
              }
              push({ chainId: input.chainId, contractAddress: wanted, kind: orderKind(order.type), channel, providerAt });
            }
            for (const entry of raw.boosts ?? []) {
              const parsed = boostSchema.safeParse(entry);
              if (!parsed.success) continue;
              const boost = parsed.data;
              if (!mine(boost.chainId, boost.tokenAddress)) continue;
              const providerAt = providerDate(boost.paymentTimestamp);
              if (!providerAt) continue;
              push({ chainId: input.chainId, contractAddress: wanted, kind: 'MARKET_PROMOTION_OBSERVED', channel: 'boost_order', providerAt });
            }
            return { sightings, notApproved };
          },
        },
      );
    },
  };
}
