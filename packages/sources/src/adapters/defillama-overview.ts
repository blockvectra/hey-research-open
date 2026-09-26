import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * DefiLlama's per-chain fee, revenue and DEX-volume overviews (2026-09-27,
 * brief §25 "Protocol Economics").
 *
 * One free, keyless request per metric returns every protocol DefiLlama has a
 * fee or volume adapter for *on that chain*, with its last-24-hour figure:
 *
 *   `/overview/fees/{chain}`                       fees
 *   `/overview/fees/{chain}?dataType=dailyRevenue` revenue (the same endpoint)
 *   `/overview/dexs/{chain}`                       DEX volume
 *
 * The chart arrays are excluded by query, so a read is ~0.5 MB rather than
 * ~0.5 MB plus a year of daily points. Checked live on 2026-09-27: 206 fee,
 * 203 revenue and 102 volume rows for Robinhood Chain; the per-protocol figure
 * is the chain's share (Curve DEX read $31k of volume here, not its global
 * total).
 *
 * A protocol absent from an overview is one DefiLlama does not track for that
 * metric on this chain — `NOT_TRACKED`, never zero. A row whose `total24h` is
 * null is the same: the adapter has no figure for the day. Only a number is a
 * measurement, and a measured zero stays zero.
 *
 * Context only: none of these figures reaches activity status, Build
 * Momentum, the Discovery Gap or the Builder Radar (product rules 2, 3).
 */
const DEFILLAMA_DEFAULT_BASE_URL = 'https://api.llama.fi';

/** Measured 2026-09-27 at ~0.5 MB with the charts excluded; the cap leaves room for growth, not for a chart. */
const OVERVIEW_MAX_BYTES = 4 * 1024 * 1024;
const CACHE_TTL_SECONDS = 60 * 60;

export const DEFILLAMA_OVERVIEW_METRICS = ['fees', 'revenue', 'dexs'] as const;
export type DefillamaOverviewMetric = (typeof DEFILLAMA_OVERVIEW_METRICS)[number];

const numberish = z.union([z.number(), z.string()]).nullish();

const overviewRowSchema = z.object({
  defillamaId: z.union([z.string(), z.number()]).nullish(),
  id: z.union([z.string(), z.number()]).nullish(),
  name: z.string().nullish(),
  displayName: z.string().nullish(),
  slug: z.string().nullish(),
  protocolType: z.string().nullish(),
  category: z.string().nullish(),
  total24h: numberish,
  total7d: numberish,
  total30d: numberish,
  methodologyURL: z.string().nullish(),
});

const overviewSchema = z.object({
  chain: z.string().nullish(),
  protocols: z.array(z.unknown()),
});

export type DefillamaOverviewInput = {
  /** The chain label DefiLlama uses, e.g. `Robinhood Chain`. */
  chain: string;
  metric: DefillamaOverviewMetric;
  baseUrl?: string;
};

export type ProtocolDimension = {
  /** The registry slug, the same key `/protocols` uses. */
  slug: string;
  defillamaId?: string;
  name: string;
  /** Last 24 hours, USD, on this chain. Undefined when DefiLlama publishes no figure — not zero. */
  total24hUsd?: number;
  total7dUsd?: number;
  total30dUsd?: number;
  /** DefiLlama's adapter for this metric: the methodology's own link. */
  methodologyUrl?: string;
};

export type DefillamaOverview = {
  metric: DefillamaOverviewMetric;
  chain: string;
  protocols: ProtocolDimension[];
};

const finite = (value: number | string | null | undefined): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  // A negative fee or volume is an adapter artefact, not a measurement.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const HTTP_PATTERN = /^https?:\/\/[^\s]+$/i;

export function defillamaOverviewUrl(input: DefillamaOverviewInput): string {
  const base = (input.baseUrl ?? DEFILLAMA_DEFAULT_BASE_URL).replace(/\/$/, '');
  const family = input.metric === 'dexs' ? 'dexs' : 'fees';
  const params = new URLSearchParams({ excludeTotalDataChart: 'true', excludeTotalDataChartBreakdown: 'true' });
  if (input.metric === 'revenue') params.set('dataType', 'dailyRevenue');
  return `${base}/overview/${family}/${encodeURIComponent(input.chain.trim())}?${params.toString()}`;
}

export function createDefillamaOverviewAdapter(): SourceAdapter<DefillamaOverviewInput, DefillamaOverview> {
  return {
    name: 'defillama-overview',

    canHandle(input) {
      return input.chain.trim().length > 0 && (DEFILLAMA_OVERVIEW_METRICS as readonly string[]).includes(input.metric);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<DefillamaOverview>> {
      const url = defillamaOverviewUrl(input);
      const wanted = input.chain.trim().toLowerCase();
      return performSourceFetch(
        ctx,
        { url, maxBytes: OVERVIEW_MAX_BYTES, allowedContentTypes: ['application/json'] },
        {
          schema: overviewSchema.refine((raw) => !raw.chain || raw.chain.trim().toLowerCase() === wanted, {
            message: 'overview is for another chain',
          }),
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): DefillamaOverview => {
            const seen = new Set<string>();
            const protocols: ProtocolDimension[] = [];
            for (const entry of raw.protocols) {
              // One malformed row costs that row, never the overview.
              const parsed = overviewRowSchema.safeParse(entry);
              if (!parsed.success) continue;
              const row = parsed.data;
              const slug = row.slug?.trim();
              // The chain's own row (`protocolType: chain`) is the chain's total, not a protocol.
              if (!slug || row.protocolType === 'chain' || seen.has(slug)) continue;
              seen.add(slug);
              const id = row.defillamaId ?? row.id;
              protocols.push({
                slug,
                name: row.displayName?.trim() || row.name?.trim() || slug,
                ...opt('defillamaId', id === null || id === undefined ? undefined : String(id)),
                ...opt('total24hUsd', finite(row.total24h)),
                ...opt('total7dUsd', finite(row.total7d)),
                ...opt('total30dUsd', finite(row.total30d)),
                ...opt('methodologyUrl', row.methodologyURL && HTTP_PATTERN.test(row.methodologyURL) ? row.methodologyURL : undefined),
              });
            }
            return { metric: input.metric, chain: input.chain, protocols };
          },
        },
      );
    },
  };
}
