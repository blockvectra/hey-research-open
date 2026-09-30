import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { explorerApiUrl, explorerNotKeyed, isKeyedExplorerApi, redactResultUrl } from '../http/explorer-api';
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
  /** Sourcify listing rows only (2026-09-27): its match quality, so an exact match and a partial one stay apart. */
  sourcifyMatch?: 'exact_match' | 'match';
  /** Sourcify listing rows only: the row's `matchId`, the sweep's watermark. */
  matchId?: string;
};

export type VerifiedContractPage = {
  contracts: VerifiedContract[];
  /** Opaque cursor for the next page; absent on the last page. */
  nextPage?: Record<string, string | number>;
};

export type BlockscoutVerifiedInput = {
  baseUrl: string;
  nextPage?: Record<string, string | number>;
  /** The keyed PRO API: sent as `chain_id` / `apikey`; without them nothing is read (2026-09-30). */
  chainId?: number | undefined;
  apiKey?: string | undefined;
  /**
   * PRO API only: list contracts verified at or after this moment. The PRO
   * listing (`module=contract&action=listcontracts`) carries no timestamps
   * and pages by address, so the caller keeps time in this filter.
   */
  since?: Date | undefined;
};

/** One page of the PRO API's `listcontracts`: name and compiler only, no timestamps, no proxy flag. */
const proPageSchema = z.object({
  status: z.string().nullish(),
  message: z.string().nullish(),
  result: z.union([z.array(z.object({ Address: z.string(), ContractName: z.string().nullish(), CompilerVersion: z.string().nullish() })), z.string()]).nullish(),
});
export const PRO_PAGE_SIZE = 100;

export function createBlockscoutVerifiedAdapter(): SourceAdapter<
  BlockscoutVerifiedInput,
  VerifiedContractPage
> {
  return {
    name: 'blockscout-verified',

    canHandle(input) {
      return isKeyedExplorerApi(input);
    },

    /*
     * Keyed only (founder ruling, 2026-09-30). The instance's REST listing is
     * no longer read: its CDN challenges non-browser clients, and HEY does not
     * rely on an agent string getting past it. Without the key the listing is
     * not read, and says so; no request leaves.
     */
    async fetch(input, ctx: SourceContext): Promise<SourceResult<VerifiedContractPage>> {
      if (!isKeyedExplorerApi(input)) return explorerNotKeyed(ctx);
      return fetchPro(input, ctx);
    },
  };
}

/**
 * The PRO API's Etherscan-style listing: `page`/`offset` paging, a
 * `verified_at_start_timestamp` floor, and only a name and compiler per row.
 * Proxy and scam flags are unknown here (false); the upgrade watcher reads
 * proxies from the chain itself.
 */
async function fetchPro(input: BlockscoutVerifiedInput, ctx: SourceContext): Promise<SourceResult<VerifiedContractPage>> {
  const page = Number(input.nextPage?.page ?? 1);
  const url = explorerApiUrl({ baseUrl: input.baseUrl, chainId: input.chainId, apiKey: input.apiKey }, '/v2/api', {
    module: 'contract',
    action: 'listcontracts',
    filter: 'verified',
    page,
    offset: PRO_PAGE_SIZE,
    ...(input.since ? { verified_at_start_timestamp: Math.floor(input.since.getTime() / 1000) } : {}),
  });
  const result = await performSourceFetch(
    ctx,
    { url, headers: { accept: 'application/json' } },
    {
      schema: proPageSchema,
      parse: (body) => JSON.parse(body) as unknown,
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      normalize: (raw): VerifiedContractPage => {
        const rows = Array.isArray(raw.result) ? raw.result : [];
        return {
          contracts: rows.map((row) => ({
            address: row.Address,
            flaggedScam: false,
            isProxy: false,
            ...opt('name', row.ContractName?.trim() || undefined),
            ...opt('compilerVersion', row.CompilerVersion ?? undefined),
          })),
          ...(rows.length >= PRO_PAGE_SIZE ? { nextPage: { page: page + 1 } } : {}),
        };
      },
    },
  );
  return redactResultUrl(result);
}
