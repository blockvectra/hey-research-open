import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * DefiLlama protocol registry, filtered to one chain.
 *
 * The 2026-09-02 coverage audit found HEY's intake was 99.7% one launchpad.
 * DefiLlama lists every protocol with a TVL adapter, per chain, with the
 * team's own website, Twitter and GitHub organisations — for Robinhood Chain
 * that was 134 protocols, 79 of them built for this chain only, and HEY held
 * none of them. It is free, unauthenticated, and not rate-limited in practice.
 *
 * A listing is a strong claim that a project exists and is deployed here, but
 * it is not a build signal: TVL is capital, not shipping. It qualifies a page;
 * activity status still comes from the team's own sources.
 */
const DEFILLAMA_DEFAULT_BASE_URL = 'https://api.llama.fi';

/** The registry returns every protocol at once; ~10 MB, well past the default cap. */
const PROTOCOLS_MAX_BYTES = 32 * 1024 * 1024;

const CACHE_TTL_SECONDS = 6 * 60 * 60;

/*
 * Lenient on purpose (round-8 audit, 2026-09-18). The registry is ~10 MB of
 * other people's data; one protocol with a null name or `"chains": null`
 * used to fail the whole list's schema and HEY read nothing. `name` and
 * `slug` may be absent — the row is skipped — and `chains` is `nullish`
 * rather than defaulted, because a default does not survive an explicit
 * null. Rows are validated one at a time below, so one bad row costs one row.
 */
const protocolSchema = z.object({
  name: z.string().nullish(),
  slug: z.string().nullish(),
  url: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  chains: z.array(z.string()).nullish(),
  twitter: z.string().nullish(),
  github: z.array(z.string()).nullish(),
  chainTvls: z.record(z.string(), z.number().nullable()).nullish(),
  listedAt: z.number().nullish(),
  symbol: z.string().nullish(),
  logo: z.string().nullish(),
});

/** The envelope only: each row is judged on its own in the normalizer. */
const protocolsSchema = z.array(z.unknown());

type Protocol = z.infer<typeof protocolSchema> & { name: string; slug: string };

const validProtocol = (row: unknown): Protocol | undefined => {
  const parsed = protocolSchema.safeParse(row);
  if (!parsed.success) return undefined;
  const { name, slug } = parsed.data;
  if (!name || !slug) return undefined;
  return { ...parsed.data, name, slug };
};

export type EcosystemListing = {
  name: string;
  slug: string;
  category?: string;
  websiteUrl?: string;
  description?: string;
  /** Bare handle as DefiLlama stores it, never a URL. */
  twitterHandle?: string;
  /** GitHub organisations or users the protocol declares. */
  githubOrgs: string[];
  /** How many chains the protocol reports; 1 means built for this chain only. */
  chainCount: number;
  /** TVL on the requested chain only, USD. 0 when the registry reports none. */
  chainTvlUsd: number;
  listedAt?: Date;
  symbol?: string;
  /** The registry's icon for the protocol, e.g. `https://icons.llamao.fi/icons/protocols/<slug>`. */
  logoUrl?: string;
  source: 'defillama';
};

export type DefillamaInput = {
  /** The exact chain label DefiLlama uses, e.g. `Robinhood Chain`. */
  chain: string;
  baseUrl?: string;
};

const chainTvlOf = (tvls: Record<string, number | null> | null | undefined, chain: string): number => {
  if (!tvls) return 0;
  const key = chain.toLowerCase();
  let total = 0;
  for (const [label, value] of Object.entries(tvls)) {
    /*
     * Exact label only, deliberately. `Robinhood Chain-borrowed`,
     * `-staking` and `-pool2` are DefiLlama's variants of the same chain
     * bucket and must not be summed on top of it: borrowed is counted inside
     * the headline figure already, and adding it doubles the number.
     */
    if (label.toLowerCase() === key && typeof value === 'number') total += value;
  }
  return total;
};

export function createDefillamaAdapter(): SourceAdapter<DefillamaInput, EcosystemListing[]> {
  return {
    name: 'defillama',

    canHandle(input) {
      return input.chain.trim().length > 0;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<EcosystemListing[]>> {
      const base = (input.baseUrl ?? DEFILLAMA_DEFAULT_BASE_URL).replace(/\/$/, '');
      const wanted = input.chain.trim().toLowerCase();

      return performSourceFetch(
        ctx,
        { url: `${base}/protocols`, maxBytes: PROTOCOLS_MAX_BYTES },
        {
          schema: protocolsSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): EcosystemListing[] =>
            raw
              .map(validProtocol)
              .filter((protocol): protocol is Protocol => protocol !== undefined)
              .filter((protocol) => (protocol.chains ?? []).some((c) => c.toLowerCase() === wanted))
              .map((protocol) => ({
                name: protocol.name,
                slug: protocol.slug,
                githubOrgs: (protocol.github ?? []).filter((org) => org.trim().length > 0),
                chainCount: (protocol.chains ?? []).length,
                chainTvlUsd: chainTvlOf(protocol.chainTvls, input.chain),
                source: 'defillama' as const,
                ...opt('category', protocol.category ?? undefined),
                ...opt('websiteUrl', protocol.url ?? undefined),
                ...opt('description', protocol.description ?? undefined),
                ...opt('twitterHandle', protocol.twitter ?? undefined),
                ...opt('symbol', protocol.symbol ?? undefined),
                ...opt('logoUrl', protocol.logo?.trim() || undefined),
                ...opt(
                  'listedAt',
                  typeof protocol.listedAt === 'number'
                    ? new Date(protocol.listedAt * 1000)
                    : undefined,
                ),
              })),
        },
      );
    },
  };
}
