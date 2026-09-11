import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * Robinhood Chain Blockscout (PRD V4 sections 20.1, 28).
 *
 * Contract metadata, verification state and deployment evidence only.
 * Holder endpoints are deliberately not implemented — holder analytics are out of
 * scope (PRD V4 section 7, CLAUDE.md rule 1).
 */
export type BlockscoutInput = {
  baseUrl: string;
  address: string;
};

export const blockscoutAddressSchema = z.object({
  hash: z.string(),
  is_contract: z.boolean().nullish(),
  is_verified: z.boolean().nullish(),
  name: z.string().nullish(),
  creation_transaction_hash: z.string().nullish(),
  creator_address_hash: z.string().nullish(),
  implementations: z
    .array(z.object({ address: z.string().nullish(), name: z.string().nullish() }))
    .nullish(),
  token: z
    .object({
      name: z.string().nullish(),
      symbol: z.string().nullish(),
      decimals: z.union([z.string(), z.number()]).nullish(),
      type: z.string().nullish(),
    })
    .nullish(),
});

export type ContractEvidence = {
  address: string;
  isContract: boolean;
  isVerified: boolean;
  contractName?: string;
  creationTxHash?: string;
  creatorAddress?: string;
  /** Present when the address is a proxy; used for upgrade evidence in M4. */
  implementationAddresses: string[];
  token?: { name?: string; symbol?: string; decimals?: number; type?: string };
  explorerUrl: string;
};

const CACHE_TTL_SECONDS = 3600;

const toDecimals = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

export function createBlockscoutAdapter(): SourceAdapter<BlockscoutInput, ContractEvidence> {
  return {
    name: 'blockscout',

    canHandle(input) {
      return Boolean(input.baseUrl) && /^0x[a-fA-F0-9]{40}$/.test(input.address);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<ContractEvidence>> {
      const base = input.baseUrl.replace(/\/$/, '');
      const url = `${base}/api/v2/addresses/${input.address}`;

      return performSourceFetch(
        ctx,
        { url },
        {
          schema: blockscoutAddressSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): ContractEvidence => {
            const token = raw.token
              ? {
                  ...opt('name', raw.token.name ?? undefined),
                  ...opt('symbol', raw.token.symbol ?? undefined),
                  ...opt('decimals', toDecimals(raw.token.decimals)),
                  ...opt('type', raw.token.type ?? undefined),
                }
              : undefined;

            return {
              address: raw.hash,
              isContract: raw.is_contract ?? false,
              isVerified: raw.is_verified ?? false,
              implementationAddresses: (raw.implementations ?? [])
                .map((entry) => entry.address ?? undefined)
                .filter((value): value is string => value !== undefined),
              explorerUrl: `${base}/address/${raw.hash}`,
              ...opt('contractName', raw.name ?? undefined),
              ...opt('creationTxHash', raw.creation_transaction_hash ?? undefined),
              ...opt('creatorAddress', raw.creator_address_hash ?? undefined),
              ...(token && Object.keys(token).length > 0 ? { token } : {}),
            };
          },
        },
      );
    },
  };
}
