import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { cleanHttpUrl, socialTypeForUrl, type SocialLink } from '../links';
import { opt } from '../optional';
import { DEXSCREENER_DEFAULT_BASE_URL } from './dexscreener';

/**
 * DEX Screener token profiles — the lists of tokens whose teams filled in a profile.
 *
 * Three cross-chain feeds, each the latest ~30 records:
 *   `/token-profiles/latest/v1`   profiles as they are published
 *   `/token-boosts/latest/v1`     profiles whose team recently bought a boost
 *   `/token-boosts/top/v1`        profiles ranked by boost spend
 *
 * They are read for one reason: a team that wrote a description and linked a
 * website has identified itself, which is exactly what the candidate store
 * needs to open a page. The boost feeds are enumeration only. The boost
 * `amount` / `totalAmount` fields are validated and then dropped — paid
 * placement is not evidence of building and never reaches ranking
 * (CLAUDE.md product rule 6).
 *
 * Verified 2026-09-03: each feed returned 30 records; 20 / 14 / 14 of them
 * were `chainId: "robinhood"`. Profiles carried `icon` as a CDN URL; boost
 * records carried `icon` as a bare CMS id (`_bNkrynaHAamIH5s`), which is not
 * a URL and is not stored. Links were either `{label: "Website" | "Docs", url}`
 * or `{type: "twitter" | "telegram" | …, url}`, and some carried only `{url}`.
 */
export type DexscreenerProfileFeed = 'profiles' | 'boosts-latest' | 'boosts-top';

export const DEXSCREENER_PROFILE_FEEDS: readonly DexscreenerProfileFeed[] = [
  'profiles',
  'boosts-latest',
  'boosts-top',
];

const FEED_PATHS: Record<DexscreenerProfileFeed, string> = {
  profiles: '/token-profiles/latest/v1',
  'boosts-latest': '/token-boosts/latest/v1',
  'boosts-top': '/token-boosts/top/v1',
};

/** The feeds roll over constantly; a run reads each once. */
const CACHE_TTL_SECONDS = 15 * 60;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const linkSchema = z.object({
  label: z.string().nullish(),
  type: z.string().nullish(),
  url: z.string().nullish(),
});

const profileSchema = z.object({
  url: z.string().nullish(),
  chainId: z.string().nullish(),
  tokenAddress: z.string().nullish(),
  icon: z.string().nullish(),
  header: z.string().nullish(),
  openGraph: z.string().nullish(),
  description: z.string().nullish(),
  links: z.array(linkSchema).nullish(),
  cto: z.boolean().nullish(),
  /** Boost feeds only. Read so the payload validates; never surfaced. */
  amount: z.number().nullish(),
  totalAmount: z.number().nullish(),
});

const responseSchema = z.array(profileSchema);

export type DexscreenerProfilesInput = {
  chainId: number;
  /** DEX Screener's chain slug, `robinhood` for 4663. */
  chainSlug: string;
  feed: DexscreenerProfileFeed;
  baseUrl?: string;
};

export type TokenProfile = {
  chainId: number;
  contractAddress: string;
  description?: string;
  websiteUrl?: string;
  docsUrl?: string;
  /** The profile icon, only when it is an actual URL. */
  imageUrl?: string;
  socials: SocialLink[];
  /** DEX Screener's own page for the token, kept as provenance. */
  profileUrl?: string;
  /** Marked by DEX Screener as a community takeover. */
  communityTakeover?: boolean;
  feed: DexscreenerProfileFeed;
};

const isWebsiteLabel = (label: string | null | undefined): boolean =>
  (label ?? '').trim().toLowerCase() === 'website';

const isDocsLabel = (label: string | null | undefined): boolean => {
  const value = (label ?? '').trim().toLowerCase();
  return (
    value === 'docs' || value === 'documentation' || value === 'whitepaper' || value === 'gitbook'
  );
};

export function createDexscreenerProfilesAdapter(): SourceAdapter<
  DexscreenerProfilesInput,
  TokenProfile[]
> {
  return {
    name: 'dexscreener-profiles',

    canHandle(input) {
      return input.chainSlug.trim().length > 0 && input.feed in FEED_PATHS;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<TokenProfile[]>> {
      const base = (input.baseUrl ?? DEXSCREENER_DEFAULT_BASE_URL).replace(/\/$/, '');
      const url = `${base}${FEED_PATHS[input.feed]}`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): TokenProfile[] => {
            const profiles: TokenProfile[] = [];
            const seen = new Set<string>();

            for (const record of raw) {
              // Cross-chain feed: everything not on the configured chain is noise
              // for a chain-locked product, however good its profile looks.
              if (record.chainId !== input.chainSlug) continue;
              const address = record.tokenAddress?.toLowerCase();
              if (!address || !ADDRESS_PATTERN.test(address) || seen.has(address)) continue;
              seen.add(address);

              let websiteUrl: string | undefined;
              let docsUrl: string | undefined;
              const socials: SocialLink[] = [];

              for (const link of record.links ?? []) {
                const href = cleanHttpUrl(link.url);
                if (!href) continue;
                const explicitType = link.type?.trim().toLowerCase();
                const inferred = socialTypeForUrl(href);
                if (explicitType || inferred) {
                  const type = explicitType || inferred || 'other';
                  if (!socials.some((entry) => entry.url === href))
                    socials.push({ type, url: href });
                } else if (isDocsLabel(link.label)) {
                  docsUrl ??= href;
                } else if (isWebsiteLabel(link.label) || !link.label) {
                  websiteUrl ??= href;
                } else {
                  // Labelled something else ("App", "Chart"): a declared site,
                  // but not the one to open a page on. Kept as a social so the
                  // link is not lost.
                  socials.push({ type: link.label.trim().toLowerCase(), url: href });
                }
              }

              profiles.push({
                chainId: input.chainId,
                contractAddress: address,
                socials,
                feed: input.feed,
                ...opt('description', record.description?.trim() || undefined),
                ...opt('websiteUrl', websiteUrl),
                ...opt('docsUrl', docsUrl),
                ...opt('imageUrl', cleanHttpUrl(record.icon)),
                ...opt('profileUrl', cleanHttpUrl(record.url)),
                ...opt('communityTakeover', record.cto ?? undefined),
              });
            }

            return profiles;
          },
        },
      );
    },
  };
}
