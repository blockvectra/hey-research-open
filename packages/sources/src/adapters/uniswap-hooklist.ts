import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { SourceError } from '../errors';
import { performSourceFetch } from '../http/perform';
import { GITHUB_DEFAULT_BASE_URL } from './github';

/**
 * Uniswap's public hook registry, github.com/Uniswap/hooklist (2026-10-04).
 *
 * What it is: one JSON file per hook (`hooks/<chain>/<address>.json`) and a
 * regenerated aggregate, `hooklist.json`, across every chain Uniswap v4 runs
 * on — the hook's address, chain, a contract name, whether its source is
 * verified, its fourteen permission flags as the file lists them and five
 * properties (dynamic fee, upgradeable, custom swap data, vanilla swap, swap
 * access). Entries are submitted as GitHub issues; a workflow generates each
 * file from the verified source and a maintainer merges it.
 *
 * What HEY takes, and what it leaves (authority entry `uniswap_hooklist`:
 * context only — never identity, attribution or building):
 * - only Robinhood Chain entries, and of each only the factual fields: the
 *   name, `verifiedSource`, the flags and the properties as listed, the
 *   file's path and the commit HEY read it at;
 * - never the `description` (generated prose, in a repository that carries no
 *   licence file: HEY links to the file instead of republishing it) and never
 *   `auditUrl` (security context has its own reader and rules);
 * - the optional `deployer` (a submitter's claim about who created the hook)
 *   is handed to the caller as `claimedDeployer`, in memory only, for one
 *   comparison with the token deployers HEY already records (founder,
 *   2026-10-04: the list is a source of leads, never proof). It is an account:
 *   no caller may write it (machine-layer rule 12; `hooklist.ts` keeps only the
 *   comparison's outcome).
 *
 * Two requests, the first conditional (measured 2026-10-04): the head commit
 * of `main` as a bare sha (`application/vnd.github.sha`, with an ETag whose
 * `If-None-Match` answers 304), then — only when it moved — the aggregate at
 * that commit from raw.githubusercontent.com (about 6 MB for every chain), so
 * the file read and the commit recorded can never disagree.
 */
export const UNISWAP_HOOKLIST_REPOSITORY = 'Uniswap/hooklist';
export const UNISWAP_HOOKLIST_URL = 'https://github.com/Uniswap/hooklist';
export const UNISWAP_HOOKLIST_BRANCH = 'main';
export const UNISWAP_HOOKLIST_RAW_BASE_URL = 'https://raw.githubusercontent.com';
/** 6.2 MB on 2026-10-01 for 4,942 hooks on 21 chains; five times that is refused. */
export const UNISWAP_HOOKLIST_MAX_BYTES = 32 * 1024 * 1024;
/** Hooklist chain name per chain id HEY reads (the file layout uses the name). */
export const UNISWAP_HOOKLIST_CHAIN_NAMES: Readonly<Record<number, string>> = { 4663: 'robinhood' };
/**
 * Entries of the chain HEY reads that fail the schema are skipped and
 * counted; more than this means the format moved, and the read fails rather
 * than storing half a list.
 */
export const UNISWAP_HOOKLIST_MAX_INVALID = 25;

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const COMMIT = /^[0-9a-f]{40}$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/;

/** The fourteen flag names the hooklist schema uses (`schema.json`), in Hooks.sol bit order, high to low. */
export const UNISWAP_HOOKLIST_FLAGS = [
  'beforeInitialize',
  'afterInitialize',
  'beforeAddLiquidity',
  'afterAddLiquidity',
  'beforeRemoveLiquidity',
  'afterRemoveLiquidity',
  'beforeSwap',
  'afterSwap',
  'beforeDonate',
  'afterDonate',
  'beforeSwapReturnsDelta',
  'afterSwapReturnsDelta',
  'afterAddLiquidityReturnsDelta',
  'afterRemoveLiquidityReturnsDelta',
] as const;
export type UniswapHooklistFlag = (typeof UNISWAP_HOOKLIST_FLAGS)[number];

export const UNISWAP_HOOKLIST_SWAP_ACCESS = ['none', 'allowlist', 'governance', 'temporal', 'other'] as const;

const flagsSchema = z.object(Object.fromEntries(UNISWAP_HOOKLIST_FLAGS.map((flag) => [flag, z.boolean()])) as Record<UniswapHooklistFlag, z.ZodBoolean>);

const propertiesSchema = z.object({
  dynamicFee: z.boolean(),
  upgradeable: z.boolean(),
  requiresCustomSwapData: z.boolean(),
  vanillaSwap: z.boolean().optional(),
  // A value the schema adds later is kept as listed, never coerced to a known one.
  swapAccess: z.string().min(1).max(40).optional(),
});

/** One entry as the schema defines it. Unknown keys are ignored; `description` and `auditUrl` are never read. */
const entrySchema = z.object({
  hook: z.object({
    address: z.string().regex(ADDRESS),
    chain: z.string().min(1).max(40),
    chainId: z.number().int().positive(),
    name: z.string().trim().min(1).max(100),
    verifiedSource: z.boolean(),
    // Optional and often empty; anything but an address is no claim, never a failed entry.
    deployer: z.string().max(100).optional(),
  }),
  flags: flagsSchema,
  properties: propertiesSchema,
});

/** The aggregate is an array of entries; each is checked on its own so one bad entry elsewhere costs nothing. */
const aggregateSchema = z.array(z.unknown()).min(1).max(100_000);

export type UniswapHooklistProperties = {
  dynamicFee: boolean;
  upgradeable: boolean;
  requiresCustomSwapData: boolean;
  /** Absent when the file does not say. */
  vanillaSwap?: boolean;
  swapAccess?: string;
};

export type UniswapHooklistEntry = {
  chainId: number;
  /** Lower-cased. */
  address: string;
  /** The contract name as listed (the hooklist's `name`). */
  name: string;
  verifiedSource: boolean;
  /** The fourteen flags exactly as the file lists them. */
  flags: Record<UniswapHooklistFlag, boolean>;
  properties: UniswapHooklistProperties;
  /** The entry's own file in the repository: `hooks/<chain>/<address>.json`. */
  path: string;
  /**
   * The listing's `deployer`, lower-cased, when it is an address: a
   * submitter's claim, never verified by the list. In memory only — compared
   * with HEY's deployer records and dropped; never persisted (machine-layer
   * rule 12).
   */
  claimedDeployer?: string;
};

export type UniswapHooklistSnapshot = {
  commit: string;
  chainId: number;
  /** Every entry in the aggregate, all chains. */
  totalEntries: number;
  /** The chain's entries that passed the schema, one per address. */
  entries: UniswapHooklistEntry[];
  /** The chain's entries that failed the schema and were skipped. */
  invalidEntries: number;
  /** The chain's entries listed twice under one address; the first is kept. */
  duplicateEntries: number;
};

/** `https://github.com/Uniswap/hooklist/blob/<commit>/<path>`: the listing a reader can open, pinned to what HEY read. */
export function uniswapHooklistFileUrl(commit: string, path: string): string {
  return `${UNISWAP_HOOKLIST_URL}/blob/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The chain's entries from a parsed aggregate. Throws when the chain's share is mostly unreadable. */
export function uniswapHooklistEntries(raw: readonly unknown[], chainId: number, commit: string): UniswapHooklistSnapshot {
  const chain = UNISWAP_HOOKLIST_CHAIN_NAMES[chainId];
  if (!chain) throw new SourceError('INVALID_RESPONSE', `the hooklist has no chain name for chain ${chainId}`);
  const entries: UniswapHooklistEntry[] = [];
  const seen = new Set<string>();
  let invalidEntries = 0;
  let duplicateEntries = 0;
  for (const item of raw) {
    // Only this chain's entries are read; a loose look at the id decides which those are.
    const hook = typeof item === 'object' && item !== null ? (item as { hook?: { chainId?: unknown } }).hook : undefined;
    if (!hook || hook.chainId !== chainId) continue;
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success) {
      invalidEntries += 1;
      continue;
    }
    const address = parsed.data.hook.address.toLowerCase();
    if (seen.has(address)) {
      duplicateEntries += 1;
      continue;
    }
    seen.add(address);
    const props = parsed.data.properties;
    const claimed = parsed.data.hook.deployer?.trim() ?? '';
    entries.push({
      chainId,
      address,
      name: parsed.data.hook.name,
      verifiedSource: parsed.data.hook.verifiedSource,
      flags: { ...parsed.data.flags },
      properties: {
        dynamicFee: props.dynamicFee,
        upgradeable: props.upgradeable,
        requiresCustomSwapData: props.requiresCustomSwapData,
        ...(props.vanillaSwap === undefined ? {} : { vanillaSwap: props.vanillaSwap }),
        ...(props.swapAccess === undefined ? {} : { swapAccess: props.swapAccess }),
      },
      path: `hooks/${chain}/${address}.json`,
      ...(ADDRESS.test(claimed) && !ZERO_ADDRESS.test(claimed) ? { claimedDeployer: claimed.toLowerCase() } : {}),
    });
  }
  if (invalidEntries > UNISWAP_HOOKLIST_MAX_INVALID) {
    throw new SourceError('INVALID_RESPONSE', `${invalidEntries} of the chain's hooklist entries failed the schema (cap ${UNISWAP_HOOKLIST_MAX_INVALID})`);
  }
  entries.sort((a, b) => a.address.localeCompare(b.address));
  return { commit, chainId, totalEntries: raw.length, entries, invalidEntries, duplicateEntries };
}

export type UniswapHooklistHeadInput = { baseUrl?: string; token?: string };

/** The head commit of the hooklist's `main`, as a sha; conditional on the stored ETag. */
export function createUniswapHooklistHeadAdapter(): SourceAdapter<UniswapHooklistHeadInput, { commit: string }> {
  return {
    name: 'uniswap-hooklist-head',
    canHandle: () => true,
    fetch(input: UniswapHooklistHeadInput, ctx: SourceContext): Promise<SourceResult<{ commit: string }>> {
      const base = (input.baseUrl ?? GITHUB_DEFAULT_BASE_URL).replace(/\/$/, '');
      return performSourceFetch(
        ctx,
        {
          url: `${base}/repos/${UNISWAP_HOOKLIST_REPOSITORY}/commits/${UNISWAP_HOOKLIST_BRANCH}`,
          headers: {
            accept: 'application/vnd.github.sha',
            'x-github-api-version': '2022-11-28',
            ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
          },
          allowedContentTypes: ['application/vnd.github.sha', 'text/plain'],
          maxBytes: 1024,
        },
        {
          schema: z.object({ commit: z.string().regex(COMMIT) }),
          parse: (body) => ({ commit: body.trim().toLowerCase() }),
          normalize: (raw) => raw,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
        },
      );
    },
  };
}

export type UniswapHooklistInput = { commit: string; chainId: number; baseUrl?: string };

/** The aggregate `hooklist.json` at one commit, narrowed to one chain. Immutable at a commit, so never conditional. */
export function createUniswapHooklistAdapter(): SourceAdapter<UniswapHooklistInput, UniswapHooklistSnapshot> {
  return {
    name: 'uniswap-hooklist',
    canHandle: (input) => COMMIT.test(input.commit) && UNISWAP_HOOKLIST_CHAIN_NAMES[input.chainId] !== undefined,
    fetch(input: UniswapHooklistInput, ctx: SourceContext): Promise<SourceResult<UniswapHooklistSnapshot>> {
      const base = (input.baseUrl ?? UNISWAP_HOOKLIST_RAW_BASE_URL).replace(/\/$/, '');
      // A commit-pinned file never changes: an ETag a caller passed for another request must not ride along.
      const pinned: SourceContext = { ...ctx };
      delete pinned.etag;
      delete pinned.lastModified;
      return performSourceFetch(
        pinned,
        {
          url: `${base}/${UNISWAP_HOOKLIST_REPOSITORY}/${input.commit}/hooklist.json`,
          headers: { accept: 'application/json, text/plain' },
          allowedContentTypes: ['application/json', 'text/plain'],
          maxBytes: UNISWAP_HOOKLIST_MAX_BYTES,
          conditional: false,
        },
        {
          schema: aggregateSchema,
          parse: (body) => JSON.parse(body) as unknown,
          normalize: (raw) => uniswapHooklistEntries(raw, input.chainId, input.commit),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
        },
      );
    },
  };
}
