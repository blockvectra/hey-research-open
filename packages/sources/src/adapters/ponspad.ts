import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * PonsPad — a Robinhood Chain-native launchpad with a documented public API.
 *
 * Small catalogue, but the highest-provenance discovery source available: every
 * token here was launched on Robinhood Chain by definition, and the launcher
 * supplied a description and links at launch time.
 *
 * Those links are self-declared, so they are recorded as launchpad-confidence
 * evidence. They are good enough to justify a closer look, never good enough on
 * their own to mark a GitHub repository authoritative.
 *
 * Verified 2026-09-01: `/api/v1/stats` → `tokenCount: 6`; `/api/v1/tokens`
 * returns the documented shape with `tokenAddress`, `website` and socials.
 */
export const PONSPAD_DEFAULT_BASE_URL = 'https://ponspad.app/api/v1';

const tokenSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  description: z.string().nullish(),
  /** Token artwork as an `ipfs://` URI. */
  image: z.string().nullish(),
  tokenAddress: z.string().nullish(),
  poolAddress: z.string().nullish(),
  createdAt: z.number().nullish(),
  feeStrategy: z.string().nullish(),
  status: z.string().nullish(),
  website: z.string().nullish(),
  twitter: z.string().nullish(),
  telegram: z.string().nullish(),
  discord: z.string().nullish(),
  farcaster: z.string().nullish(),
});

const listSchema = z.object({
  count: z.number().nullish(),
  total: z.number().nullish(),
  tokens: z.array(tokenSchema).nullish(),
});

export type PonspadInput = {
  chainId: number;
  limit?: number;
  baseUrl?: string;
};

export type PonspadListing = {
  chainId: number;
  contractAddress: string;
  name?: string;
  symbol?: string;
  description?: string;
  websiteUrl?: string;
  /** Raw as the launchpad gives it — usually `ipfs://<cid>`. */
  imageUrl?: string;
  socials: { type: string; url: string }[];
  pairAddress?: string;
  launchTimestamp?: Date;
  feeStrategy?: string;
  status?: string;
};

const CACHE_TTL_SECONDS = 43_200;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const cleanUrl = (url: string | null | undefined): string | undefined => {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

export function createPonspadAdapter(): SourceAdapter<PonspadInput, PonspadListing[]> {
  return {
    name: 'ponspad',

    canHandle(input) {
      return input.chainId > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<PonspadListing[]>> {
      const base = (input.baseUrl ?? PONSPAD_DEFAULT_BASE_URL).replace(/\/$/, '');
      const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
      const url = `${base}/tokens?limit=${limit}`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: listSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): PonspadListing[] => {
            const listings: PonspadListing[] = [];

            for (const token of raw.tokens ?? []) {
              const address = token.tokenAddress?.toLowerCase();
              if (!address || !ADDRESS_PATTERN.test(address)) continue;

              const socials = (
                [
                  ['twitter', token.twitter],
                  ['telegram', token.telegram],
                  ['discord', token.discord],
                  ['farcaster', token.farcaster],
                ] as const
              )
                .map(([type, value]): { type: string; url: string } | undefined => {
                  const url = cleanUrl(value);
                  return url ? { type, url } : undefined;
                })
                .filter((entry): entry is { type: string; url: string } => Boolean(entry));

              const createdAt =
                typeof token.createdAt === 'number' ? new Date(token.createdAt) : undefined;

              listings.push({
                chainId: input.chainId,
                contractAddress: address,
                socials,
                ...opt('name', token.name ?? undefined),
                ...opt('symbol', token.symbol ?? undefined),
                ...opt('description', token.description ?? undefined),
                ...opt('websiteUrl', cleanUrl(token.website)),
                ...opt('imageUrl', token.image?.trim() || undefined),
                ...opt('pairAddress', token.poolAddress ?? undefined),
                ...opt('feeStrategy', token.feeStrategy ?? undefined),
                ...opt('status', token.status ?? undefined),
                ...opt(
                  'launchTimestamp',
                  createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : undefined,
                ),
              });
            }

            return listings;
          },
        },
      );
    },
  };
}
