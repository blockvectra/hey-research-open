import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { explorerApiUrl, redactResultUrl } from '../http/explorer-api';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * Blockscout's verified-contract listing.
 *
 * A verified contract is the strongest public "this is real" signal on the
 * chain — someone published matching source for the bytecode. HEY had a
 * per-address Blockscout adapter and never called it: 25,567 candidates were
 * promoted with `chain_verification = UNKNOWN` (audit, 2026-09-02). This lists
 * verified contracts in bulk so verification can run without one call per
 * token.
 *
 * The list is dominated by launcher templates (one contract name appeared
 * 1,919 times in the first 3,000 rows). Telling a template from a project is
 * a judgement about the whole run, not one row, so it lives in the domain
 * layer; this adapter reports exactly what the explorer says.
 */
const CACHE_TTL_SECONDS = 60 * 60;

/**
 * The explorer's CDN answers 403 to any agent string that does not begin
 * with `Mozilla/5.0` — HEY's own `HEYResearchBot/0.1 (+https://…)` included
 * (checked 2026-09-04: 403 with it, 200 with the form below). The
 * `Mozilla/5.0 (compatible; <bot>; +<url>)` shape is the convention every
 * public crawler uses; it still names HEY and its contact URL, so the
 * operator can identify and rate-limit the traffic. It is not an attempt to
 * pass as a browser.
 */
export const BLOCKSCOUT_USER_AGENT =
  'Mozilla/5.0 (compatible; HEYResearchBot/0.1; +https://heyresearch.xyz)';

const contractSchema = z.object({
  address: z.object({
    hash: z.string(),
    name: z.string().nullish(),
    is_verified: z.boolean().nullish(),
    is_scam: z.boolean().nullish(),
    proxy_type: z.string().nullish(),
    implementations: z.array(z.object({ address_hash: z.string().nullish() })).nullish(),
  }),
  language: z.string().nullish(),
  license_type: z.string().nullish(),
  compiler_version: z.string().nullish(),
  optimization_enabled: z.boolean().nullish(),
  verified_at: z.string().nullish(),
  certified: z.boolean().nullish(),
});

const pageSchema = z.object({
  items: z.array(contractSchema).default([]),
  next_page_params: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
});

export type VerifiedContract = {
  address: string;
  name?: string;
  language?: string;
  license?: string;
  /** As the explorer reports it, e.g. `v0.8.35+commit.47b9dedd`. */
  compilerVersion?: string;
  verifiedAt?: Date;
  /** The explorer's own scam flag; surfaced, never acted on silently. */
  flaggedScam: boolean;
  isProxy: boolean;
  implementationAddress?: string;
};

export type VerifiedContractPage = {
  contracts: VerifiedContract[];
  /** Opaque cursor for the next page; absent on the last page. */
  nextPage?: Record<string, string | number>;
};

export type BlockscoutVerifiedInput = {
  baseUrl: string;
  nextPage?: Record<string, string | number>;
  /** PRO API routing (2026-09-12): sent as `chain_id` / `apikey`; absent for an instance. */
  chainId?: number | undefined;
  apiKey?: string | undefined;
};

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export function createBlockscoutVerifiedAdapter(): SourceAdapter<
  BlockscoutVerifiedInput,
  VerifiedContractPage
> {
  return {
    name: 'blockscout-verified',

    canHandle(input) {
      return /^https?:\/\//.test(input.baseUrl);
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<VerifiedContractPage>> {
      const url = explorerApiUrl({ baseUrl: input.baseUrl, chainId: input.chainId, apiKey: input.apiKey }, '/api/v2/smart-contracts', input.nextPage ?? {});

      const result = await performSourceFetch(
        ctx,
        {
          url,
          headers: { accept: 'application/json', 'user-agent': BLOCKSCOUT_USER_AGENT },
        },
        {
          schema: pageSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): VerifiedContractPage => ({
            contracts: (raw.items ?? [])
              // The endpoint lists verified contracts, but the flag is the fact.
              .filter((item) => item.address.is_verified !== false)
              .map((item) => ({
                address: item.address.hash,
                flaggedScam: item.address.is_scam === true,
                isProxy: Boolean(item.address.proxy_type),
                ...opt('name', item.address.name?.trim() || undefined),
                ...opt('language', item.language ?? undefined),
                ...opt('license', item.license_type ?? undefined),
                ...opt('compilerVersion', item.compiler_version ?? undefined),
                ...opt('verifiedAt', toDate(item.verified_at)),
                ...opt(
                  'implementationAddress',
                  item.address.implementations?.[0]?.address_hash ?? undefined,
                ),
              })),
            ...opt('nextPage', raw.next_page_params ?? undefined),
          }),
        },
      );
      return redactResultUrl(result);
    },
  };
}
