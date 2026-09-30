import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { explorerApiUrl, explorerNotKeyed, isKeyedExplorerApi, redactResultUrl, type ExplorerApi } from '../http/explorer-api';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { abiSignatures, type ContractSource } from './explorer-etherscan';
import { sameOrigin } from './sourcify';

/**
 * The explorer's own record of one contract (2026-09-27, brief §28; audit D
 * recommendation 5): `GET /api/v2/smart-contracts/{address}`.
 *
 * The ABI watch used to read the Etherscan-style `getsourcecode`, which says
 * *that* a contract is verified but not *how*. This record says how:
 *
 * - `is_verified_via_eth_bytecode_db` — the explorer matched the bytecode to
 *   source someone had already published for another contract (every copy of
 *   a launchpad template is "verified" this way). HEY calls it **source
 *   matched by explorer**, never "source published".
 * - `is_verified_via_sourcify` / `_verifier_alliance` — imported from those
 *   services.
 * - otherwise a verified contract's source was submitted for this address:
 *   **source published**.
 * - `is_fully_verified` / `is_partially_verified` — a full match, or a
 *   metadata-tolerant one.
 * - `proxy_type` and `implementations` — the explorer's proxy claim, which
 *   `getsourcecode` carried so rarely that `explorer_proxy` was never true in
 *   production (0 of 2,456 readings). `eip1167` is an immutable minimal clone:
 *   its code is its implementation's and can never change.
 *
 * Served by the explorer instance to anonymous reads (checked from the
 * production host 2026-09-27), so the call carries no key. The answer holds
 * the full source and bytecode — a few hundred KB — of which HEY keeps the
 * ABI as canonical signatures and the facts above; nothing else is stored.
 * The answer must come from the origin asked (`sameOrigin`).
 */
const CACHE_TTL_SECONDS = 3600;
/** Source, ABI and both bytecodes: 0.4–0.7 MB measured; room for a large contract. */
const MAX_BYTES = 8 * 1024 * 1024;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;

const detailSchema = z
  .object({
    name: z.string().nullish(),
    compiler_version: z.string().nullish(),
    language: z.string().nullish(),
    is_verified: z.boolean().nullish(),
    is_verified_via_eth_bytecode_db: z.boolean().nullish(),
    is_verified_via_sourcify: z.boolean().nullish(),
    is_verified_via_verifier_alliance: z.boolean().nullish(),
    is_fully_verified: z.boolean().nullish(),
    is_partially_verified: z.boolean().nullish(),
    verified_at: z.string().nullish(),
    proxy_type: z.string().nullish(),
    implementations: z.array(z.object({ address_hash: z.string().nullish(), address: z.string().nullish(), name: z.string().nullish() }).passthrough()).nullish(),
    abi: z.array(z.unknown()).nullish(),
  })
  .passthrough();

/** How the explorer came to hold verified source for the address. */
export type ExplorerVerificationMethod = 'SOURCE_PUBLISHED' | 'BYTECODE_MATCH' | 'SOURCIFY' | 'VERIFIER_ALLIANCE';

/**
 * Proxy types whose code can never point anywhere else: an EIP-1167 minimal
 * clone (and its immutable-argument variant). A clone is its implementation's
 * code, so it is a template's copy — never "a proxy that can be upgraded".
 */
export const IMMUTABLE_CLONE_PROXY_TYPES: ReadonlySet<string> = new Set(['eip1167', 'clone_with_immutable_arguments']);

/**
 * Proxy types whose single implementation can be replaced, and so may be
 * reported as "a proxy" to the upgrade watch (which uses the claim only where
 * both EIP-1967 slots are empty). Everything else the explorer names is kept
 * as `proxyType` but claims nothing: a diamond's "implementations" are its
 * facets, an EIP-7702 delegation is an account, not a contract, a Safe's
 * master copy is not an upgrade path, and `unknown` is not a claim.
 */
export const UPGRADEABLE_PROXY_TYPES: ReadonlySet<string> = new Set([
  'eip1967',
  'eip1967_beacon',
  'eip1822',
  'eip930',
  'basic_implementation',
  'basic_get_implementation',
  'comptroller',
  'resolved_delegate_proxy',
]);

export type ExplorerContractDetail = ContractSource & {
  /** The explorer's `proxy_type`, lower-cased, when it named one. */
  proxyType?: string;
  /** Every implementation the explorer resolves the proxy to, lower-cased. */
  implementations: string[];
  /** Present only when the contract is verified. */
  verification?: { method: ExplorerVerificationMethod; match?: 'FULL' | 'PARTIAL'; verifiedAt?: Date };
};

export function verificationMethodOf(raw: {
  is_verified_via_eth_bytecode_db?: boolean | null | undefined;
  is_verified_via_sourcify?: boolean | null | undefined;
  is_verified_via_verifier_alliance?: boolean | null | undefined;
}): ExplorerVerificationMethod {
  if (raw.is_verified_via_eth_bytecode_db === true) return 'BYTECODE_MATCH';
  if (raw.is_verified_via_sourcify === true) return 'SOURCIFY';
  if (raw.is_verified_via_verifier_alliance === true) return 'VERIFIER_ALLIANCE';
  return 'SOURCE_PUBLISHED';
}

export function normalizeExplorerContractDetail(raw: z.infer<typeof detailSchema>, address: string): ExplorerContractDetail {
  const verified = raw.is_verified === true;
  const parsedAbi = verified && raw.abi ? abiSignatures(JSON.stringify(raw.abi)) : undefined;
  const abi = parsedAbi && parsedAbi.functions.length + parsedAbi.events.length > 0 ? parsedAbi : undefined;
  const implementations = [
    ...new Set(
      (raw.implementations ?? [])
        .map((entry) => (entry.address_hash ?? entry.address ?? '').trim().toLowerCase())
        .filter((value) => ADDRESS.test(value) && !ZERO_ADDRESS.test(value)),
    ),
  ];
  const proxyType = raw.proxy_type?.trim().toLowerCase() || undefined;
  const name = raw.name?.trim() || undefined;
  const compiler = raw.compiler_version?.trim() || undefined;
  const verifiedAt = raw.verified_at ? new Date(raw.verified_at) : undefined;
  const match = raw.is_fully_verified === true ? 'FULL' : raw.is_partially_verified === true ? 'PARTIAL' : undefined;
  /*
   * The ContractSource claim the upgrade watch reads: a proxy only when the
   * explorer names an upgradeable proxy type and exactly one implementation.
   * No proxy type is the explorer saying "not a proxy"; any other type is kept
   * as `proxyType` and claims nothing.
   */
  const upgradeable = proxyType !== undefined && UPGRADEABLE_PROXY_TYPES.has(proxyType) && implementations.length === 1;
  return {
    address: address.toLowerCase(),
    verified,
    ...opt('name', name),
    ...(verified ? opt('compiler', compiler) : {}),
    ...(abi ? { abi } : {}),
    isProxy: upgradeable,
    ...(upgradeable ? { implementation: implementations[0]! } : {}),
    ...opt('proxyType', proxyType),
    implementations,
    ...(verified
      ? {
          verification: {
            method: verificationMethodOf(raw),
            ...opt('match', match),
            ...(verifiedAt && !Number.isNaN(verifiedAt.getTime()) ? { verifiedAt } : {}),
          },
        }
      : {}),
  };
}

export type ExplorerContractInput = ExplorerApi & { address: string };

export function createExplorerContractAdapter(): SourceAdapter<ExplorerContractInput, ExplorerContractDetail> {
  return {
    name: 'blockscout-contract',
    canHandle(input) {
      return isKeyedExplorerApi(input) && ADDRESS.test(input.address);
    },
    async fetch(input, ctx: SourceContext): Promise<SourceResult<ExplorerContractDetail>> {
      // Keyed only (2026-09-30): the instance is never read, and no request leaves without the key.
      if (!isKeyedExplorerApi(input)) return explorerNotKeyed(ctx);
      const url = explorerApiUrl(input, `/api/v2/smart-contracts/${input.address.toLowerCase()}`);
      const result = await performSourceFetch(
        ctx,
        {
          url,
          headers: { accept: 'application/json' },
          allowedContentTypes: ['application/json'],
          maxBytes: MAX_BYTES,
        },
        {
          schema: detailSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw, response) => {
            sameOrigin(url, response);
            return normalizeExplorerContractDetail(raw, input.address);
          },
        },
      );
      return redactResultUrl(result);
    },
  };
}
