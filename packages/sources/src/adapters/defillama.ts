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
 *
 * Widened 2026-09-27 (brief §25, audit D §3): the registry already sent the
 * protocol's declared token on each chain, its audit links, its methodology,
 * its parent and forks, its CoinGecko id, a dead-site flag and which metric
 * families it has adapters for; HEY dropped all of it. They are kept now as
 * registry claims — context and identity *candidates*, never facts about
 * building and never a merge on their own.
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
  id: z.union([z.string(), z.number()]).nullish(),
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
  // Widened 2026-09-27; each optional, and a malformed one costs only itself (see `validProtocol`).
  address: z.string().nullish(),
  audits: z.union([z.string(), z.number()]).nullish(),
  audit_links: z.array(z.string()).nullish(),
  methodology: z.string().nullish(),
  tvlCodePath: z.string().nullish(),
  gecko_id: z.string().nullish(),
  parentProtocolSlug: z.string().nullish(),
  forkedFromIds: z.array(z.union([z.string(), z.number()])).nullish(),
  deadUrl: z.boolean().nullish(),
  dimensions: z.record(z.string(), z.unknown()).nullish(),
});

/** The fields added on 2026-09-27: a malformed one is dropped from the row, never the row. */
const WIDENED_FIELDS = [
  'id',
  'address',
  'audits',
  'audit_links',
  'methodology',
  'tvlCodePath',
  'gecko_id',
  'parentProtocolSlug',
  'forkedFromIds',
  'deadUrl',
  'dimensions',
] as const;

/** The envelope only: each row is judged on its own in the normalizer. */
const protocolsSchema = z.array(z.unknown());

type Protocol = z.infer<typeof protocolSchema> & { name: string; slug: string };

const validProtocol = (row: unknown): Protocol | undefined => {
  let parsed = protocolSchema.safeParse(row);
  if (!parsed.success && row !== null && typeof row === 'object') {
    // Re-read without the extras that failed: the protocol keeps its identity and TVL.
    const bad = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')));
    const trimmed: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const field of WIDENED_FIELDS) if (bad.has(field)) delete trimmed[field];
    parsed = protocolSchema.safeParse(trimmed);
  }
  if (!parsed.success) return undefined;
  const { name, slug } = parsed.data;
  if (!name || !slug) return undefined;
  return { ...parsed.data, name, slug };
};

/** Methodology is the registry's prose; capped so one protocol cannot bloat a row. */
export const DEFILLAMA_METHODOLOGY_MAX_CHARS = 2_000;
/** A protocol lists a handful of audit links at most; more is noise. */
const MAX_AUDIT_LINKS = 10;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HTTP_PATTERN = /^https?:\/\/[^\s]+$/i;

/**
 * The registry's `address` names the protocol's token as `<chainKey>:0x…`;
 * a bare `0x…` means Ethereum and any other prefix another chain. Only the
 * requested chain's key is kept, lower-cased — a token on another chain is not
 * this chain's contract (architecture rule 19: identity is chain and address).
 */
export function declaredChainTokens(address: string | null | undefined, chainKey: string): string[] {
  if (!address) return [];
  const prefix = `${chainKey.toLowerCase()}:`;
  const found = address
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase().startsWith(prefix))
    .map((part) => part.slice(prefix.length).toLowerCase())
    .filter((value) => ADDRESS_PATTERN.test(value));
  return [...new Set(found)];
}

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
  /** DefiLlama's own protocol id, which its fee and volume overviews also carry. */
  defillamaId?: string;
  /**
   * Token contracts the registry declares for the protocol on this chain,
   * lower-cased. A registry claim: an identity candidate for review, never a
   * merge on its own (2026-09-27). The adapter always sets the widened
   * fields; they are optional only so a hand-built listing need not.
   */
  chainTokenAddresses?: string[];
  /** Links the registry lists as the protocol's audits, http(s) only. */
  auditLinks?: string[];
  /** The registry's audit code as sent (`"0"` none declared). Kept verbatim; never scored. */
  auditCode?: string;
  /** How the registry says it computes TVL, capped at `DEFILLAMA_METHODOLOGY_MAX_CHARS`. */
  methodology?: string;
  /** The registry's TVL adapter source: the methodology's own link. */
  methodologyUrl?: string;
  geckoId?: string;
  parentProtocolSlug?: string;
  forkedFromIds?: string[];
  /** The registry marks the protocol's site as dead. */
  deadUrl?: boolean;
  /** Metric families the registry has an adapter for (`fees`, `dexs`, …): what it can measure, not a measurement. */
  dimensions?: string[];
  source: 'defillama';
};

export type DefillamaInput = {
  /** The exact chain label DefiLlama uses, e.g. `Robinhood Chain`. */
  chain: string;
  /** The registry's key for the chain in `address` (`robinhood:0x…`); defaults to the label's first word, lower-cased. */
  chainKey?: string;
  baseUrl?: string;
};

/** `robinhood` for `Robinhood Chain`. */
export const defillamaChainKey = (chain: string): string => chain.trim().toLowerCase().split(/\s+/)[0] ?? chain.toLowerCase();

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
      const chainKey = (input.chainKey ?? defillamaChainKey(input.chain)).toLowerCase();

      return performSourceFetch(
        ctx,
        { url: `${base}/protocols`, maxBytes: PROTOCOLS_MAX_BYTES, allowedContentTypes: ['application/json'] },
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
                chainTokenAddresses: declaredChainTokens(protocol.address, chainKey),
                auditLinks: [...new Set((protocol.audit_links ?? []).map((link) => link.trim()).filter((link) => HTTP_PATTERN.test(link)))].slice(0, MAX_AUDIT_LINKS),
                forkedFromIds: (protocol.forkedFromIds ?? []).map(String),
                deadUrl: protocol.deadUrl === true,
                dimensions: Object.keys(protocol.dimensions ?? {}).sort(),
                source: 'defillama' as const,
                ...opt('category', protocol.category ?? undefined),
                ...opt('websiteUrl', protocol.url ?? undefined),
                ...opt('description', protocol.description ?? undefined),
                ...opt('twitterHandle', protocol.twitter ?? undefined),
                ...opt('symbol', protocol.symbol ?? undefined),
                ...opt('logoUrl', protocol.logo?.trim() || undefined),
                ...opt('defillamaId', protocol.id === null || protocol.id === undefined ? undefined : String(protocol.id)),
                ...opt('auditCode', protocol.audits === null || protocol.audits === undefined ? undefined : String(protocol.audits)),
                ...opt('methodology', protocol.methodology?.trim().slice(0, DEFILLAMA_METHODOLOGY_MAX_CHARS) || undefined),
                ...opt('methodologyUrl', protocol.tvlCodePath && HTTP_PATTERN.test(protocol.tvlCodePath.trim()) ? protocol.tvlCodePath.trim() : undefined),
                ...opt('geckoId', protocol.gecko_id?.trim() || undefined),
                ...opt('parentProtocolSlug', protocol.parentProtocolSlug?.trim() || undefined),
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
