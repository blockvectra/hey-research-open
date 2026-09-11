import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import {
  cleanHttpUrl,
  extractHttpUrls,
  socialTypeForUrl,
  twitterUrlFrom,
  type SocialLink,
} from '../links';
import { opt } from '../optional';

/**
 * hood.dev — a Robinhood Chain launchpad, read through its public Goldsky subgraph.
 *
 * The subgraph is unauthenticated GraphQL. Every `TokenLaunch` is a token the
 * launcher deployed on this chain, with the artwork, description and links the
 * creator supplied at launch. That makes it the same class of source as
 * PonsPad: small, chain-native, and self-declared — good enough to open a
 * candidate, never enough on its own to make a link authoritative.
 *
 * Verified 2026-09-03: `launcherStats_collection` → `launchCount: 45`, and
 * `tokenLaunches(first: 100)` returned all 45. `socials` is a free string that
 * was either empty or a JSON object such as `{"x":"@handle","website":"https://…"}`;
 * `image` was an `https://arweave.net/…` URL, an `ipfs://` URI, or empty.
 * Bonding-curve figures (`currentMcapEth`, `bondedEth`) are ETH-denominated and
 * are deliberately not surfaced: market context comes from the market adapters.
 */
export const HOODDEV_DEFAULT_SUBGRAPH_URL =
  'https://api.goldsky.com/api/public/project_cmg2x3lrvy37d01vq4bsnbtig/subgraphs/hooddev/prod/gn';

/** The subgraph caps `first` at 1000; 100 keeps one page well under the body cap. */
export const HOODDEV_PAGE_SIZE = 100;

const CACHE_TTL_SECONDS = 60 * 60;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const LAUNCHES_QUERY = `query HeyLaunches($first: Int!, $skip: Int!) {
  launcherStats_collection { launchCount }
  tokenLaunches(first: $first, skip: $skip, orderBy: createdAt, orderDirection: desc) {
    id
    token { id symbol name }
    creator { id }
    createdAt
    image
    description
    socials
    hasBonded
    venue
    pool
  }
}`;

const launchSchema = z.object({
  id: z.string(),
  token: z
    .object({ id: z.string().nullish(), symbol: z.string().nullish(), name: z.string().nullish() })
    .nullish(),
  creator: z.object({ id: z.string().nullish() }).nullish(),
  /** Unix seconds as a string — subgraph BigInts are serialised as strings. */
  createdAt: z.union([z.string(), z.number()]).nullish(),
  image: z.string().nullish(),
  description: z.string().nullish(),
  socials: z.string().nullish(),
  hasBonded: z.boolean().nullish(),
  venue: z.number().nullish(),
  pool: z.string().nullish(),
});

const responseSchema = z.object({
  data: z
    .object({
      launcherStats_collection: z
        .array(z.object({ launchCount: z.union([z.string(), z.number()]).nullish() }))
        .nullish(),
      tokenLaunches: z.array(launchSchema).nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string().nullish() })).nullish(),
});

export type HooddevInput = {
  chainId: number;
  first?: number;
  skip?: number;
  subgraphUrl?: string;
};

export type HooddevLaunch = {
  chainId: number;
  contractAddress: string;
  name?: string;
  symbol?: string;
  description?: string;
  websiteUrl?: string;
  /** As stored: an `https://arweave.net/…` URL or an `ipfs://` URI. */
  imageUrl?: string;
  socials: SocialLink[];
  creatorAddress?: string;
  pairAddress?: string;
  launchTimestamp?: Date;
  hasBonded?: boolean;
  /** The launcher's venue code, kept as given; its meaning is not documented. */
  venue?: number;
};

export type HooddevPage = {
  launches: HooddevLaunch[];
  /** The launcher's own total, so a caller can tell when it has read everything. */
  totalLaunches?: number;
};

/**
 * The creator's links, from a string the launcher does not constrain.
 *
 * JSON objects are read key by key (`website`, `x`, `twitter`, `telegram`, …);
 * anything else is scanned for absolute URLs. A value that is neither is
 * ignored rather than guessed at.
 */
export function parseHooddevSocials(raw: string | null | undefined): {
  websiteUrl?: string;
  socials: SocialLink[];
} {
  const text = raw?.trim();
  if (!text) return { socials: [] };

  let websiteUrl: string | undefined;
  const socials: SocialLink[] = [];
  const push = (type: string, url: string | undefined) => {
    if (url && !socials.some((entry) => entry.url === url)) socials.push({ type, url });
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const field = key.toLowerCase();
      if (field === 'website' || field === 'site' || field === 'url') {
        const url = cleanHttpUrl(value);
        if (!url) continue;
        const social = socialTypeForUrl(url);
        if (social) push(social, url);
        else websiteUrl ??= url;
      } else if (field === 'x' || field === 'twitter') {
        push('twitter', twitterUrlFrom(value));
      } else {
        const url = cleanHttpUrl(value);
        if (url) push(socialTypeForUrl(url) ?? field, url);
      }
    }
    return { ...opt('websiteUrl', websiteUrl), socials };
  }

  for (const url of extractHttpUrls(text)) {
    const social = socialTypeForUrl(url);
    if (social) push(social, url);
    else websiteUrl ??= url;
  }
  return { ...opt('websiteUrl', websiteUrl), socials };
}

export function createHooddevAdapter(): SourceAdapter<HooddevInput, HooddevPage> {
  return {
    name: 'hooddev',

    canHandle(input) {
      return input.chainId > 0 && (input.first ?? HOODDEV_PAGE_SIZE) > 0 && (input.skip ?? 0) >= 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<HooddevPage>> {
      const url = input.subgraphUrl ?? HOODDEV_DEFAULT_SUBGRAPH_URL;
      const first = Math.min(Math.max(input.first ?? HOODDEV_PAGE_SIZE, 1), 1000);
      const skip = Math.max(input.skip ?? 0, 0);

      return performSourceFetch(
        ctx,
        {
          url,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: LAUNCHES_QUERY, variables: { first, skip } }),
          conditional: false,
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): HooddevPage => {
            if (raw.errors?.length && !raw.data) {
              // GraphQL reports failure with HTTP 200; surface it as no data
              // rather than pretending the launchpad is empty.
              throw new Error(raw.errors.map((e) => e.message ?? 'graphql error').join('; '));
            }

            const launches: HooddevLaunch[] = [];
            for (const launch of raw.data?.tokenLaunches ?? []) {
              const address = (launch.token?.id ?? launch.id).toLowerCase();
              if (!ADDRESS_PATTERN.test(address)) continue;

              const seconds = Number(launch.createdAt);
              const createdAt =
                Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;
              const links = parseHooddevSocials(launch.socials);
              const creator = launch.creator?.id?.toLowerCase();
              const pool = launch.pool?.toLowerCase();

              launches.push({
                chainId: input.chainId,
                contractAddress: address,
                socials: links.socials,
                ...opt('name', launch.token?.name?.trim() || undefined),
                ...opt('symbol', launch.token?.symbol?.trim() || undefined),
                ...opt('description', launch.description?.trim() || undefined),
                ...opt('websiteUrl', links.websiteUrl),
                ...opt('imageUrl', launch.image?.trim() || undefined),
                ...opt(
                  'creatorAddress',
                  creator && ADDRESS_PATTERN.test(creator) ? creator : undefined,
                ),
                ...opt('pairAddress', pool && ADDRESS_PATTERN.test(pool) ? pool : undefined),
                ...opt('launchTimestamp', createdAt),
                ...opt('hasBonded', launch.hasBonded ?? undefined),
                ...opt('venue', launch.venue ?? undefined),
              });
            }

            const total = Number(raw.data?.launcherStats_collection?.[0]?.launchCount);
            return {
              launches,
              ...opt('totalLaunches', Number.isFinite(total) ? total : undefined),
            };
          },
        },
      );
    },
  };
}
