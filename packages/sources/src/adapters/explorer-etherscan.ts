import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { explorerApiUrl, redactResultUrl, type ExplorerApi } from '../http/explorer-api';
import { performSourceFetch } from '../http/perform';

/**
 * The explorer's Etherscan-style form (2026-09-12), which is what the
 * Blockscout PRO API serves for Robinhood Chain: `module` and `action` in
 * the query, `status`/`message`/`result` in the answer, and a `result` that
 * is a string rather than a list when there is nothing to list.
 *
 * Three reads, each answering one question HEY asks about a contract:
 * who sent the transaction that created it, what an address has sent since
 * a block (a deployment shows up with `contractAddress` set), and what a
 * verified contract is called.
 */
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const CACHE_TTL_SECONDS = 3600;

const envelope = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    status: z.string().nullish(),
    message: z.string().nullish(),
    result: z.union([z.array(item), z.string(), z.null()]).optional(),
  });

const rows = <T>(result: T[] | string | null | undefined): T[] => (Array.isArray(result) ? result : []);

export type ContractCreationInput = ExplorerApi & {
  /** Up to five addresses per call. */
  addresses: readonly string[];
};

export type ContractCreation = {
  address: string;
  /** The account that sent the creating transaction, lower-cased. */
  creator: string;
  /** The factory that created it, when one did. */
  factory?: string;
  txHash?: string;
  blockNumber?: number;
  createdAt?: Date;
};

const creationSchema = envelope(
  z.object({
    contractAddress: z.string(),
    contractCreator: z.string(),
    contractFactory: z.string().nullish(),
    txHash: z.string().nullish(),
    blockNumber: z.union([z.string(), z.number()]).nullish(),
    timestamp: z.union([z.string(), z.number()]).nullish(),
  }),
);

const toInt = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function createContractCreationAdapter(): SourceAdapter<ContractCreationInput, ContractCreation[]> {
  return {
    name: 'blockscout',
    canHandle(input) {
      return Boolean(input.baseUrl) && input.addresses.length > 0 && input.addresses.length <= 5 && input.addresses.every((a) => ADDRESS.test(a));
    },
    async fetch(input, ctx: SourceContext): Promise<SourceResult<ContractCreation[]>> {
      const url = explorerApiUrl(input, '/v2/api', { module: 'contract', action: 'getcontractcreation', contractaddresses: input.addresses.join(',') });
      const result = await performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' } },
        {
          schema: creationSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): ContractCreation[] =>
            rows(raw.result)
              .filter((row) => ADDRESS.test(row.contractAddress) && ADDRESS.test(row.contractCreator))
              .map((row) => {
                const block = toInt(row.blockNumber);
                const seconds = toInt(row.timestamp);
                return {
                  address: row.contractAddress.toLowerCase(),
                  creator: row.contractCreator.toLowerCase(),
                  ...(row.contractFactory && ADDRESS.test(row.contractFactory) ? { factory: row.contractFactory.toLowerCase() } : {}),
                  ...(row.txHash ? { txHash: row.txHash.toLowerCase() } : {}),
                  ...(block === undefined ? {} : { blockNumber: block }),
                  ...(seconds === undefined ? {} : { createdAt: new Date(seconds * 1000) }),
                };
              }),
        },
      );
      return redactResultUrl(result);
    },
  };
}

export type AddressTxListInput = ExplorerApi & {
  address: string;
  /** Only transactions at or after this block. */
  startBlock?: number;
  page?: number;
  /** Rows per page; the explorer caps it. */
  pageSize?: number;
};

export type AddressTx = {
  hash: string;
  from: string;
  to?: string;
  /** Set when the transaction created a contract. */
  contractAddress?: string;
  blockNumber: number;
  timestamp: Date;
  failed: boolean;
};

const txSchema = envelope(
  z.object({
    hash: z.string(),
    from: z.string(),
    to: z.string().nullish(),
    contractAddress: z.string().nullish(),
    blockNumber: z.union([z.string(), z.number()]),
    timeStamp: z.union([z.string(), z.number()]),
    isError: z.union([z.string(), z.number()]).nullish(),
    txreceipt_status: z.union([z.string(), z.number()]).nullish(),
  }),
);

export const ADDRESS_TX_PAGE_SIZE = 100;

export function createAddressTxListAdapter(): SourceAdapter<AddressTxListInput, AddressTx[]> {
  return {
    name: 'blockscout',
    canHandle(input) {
      return Boolean(input.baseUrl) && ADDRESS.test(input.address);
    },
    async fetch(input, ctx: SourceContext): Promise<SourceResult<AddressTx[]>> {
      const url = explorerApiUrl(input, '/v2/api', {
        module: 'account',
        action: 'txlist',
        address: input.address,
        ...(input.startBlock === undefined ? {} : { startblock: input.startBlock }),
        page: input.page ?? 1,
        offset: input.pageSize ?? ADDRESS_TX_PAGE_SIZE,
        sort: 'asc',
      });
      const result = await performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' } },
        {
          schema: txSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 0,
          normalize: (raw): AddressTx[] =>
            rows(raw.result).map((row) => ({
              hash: row.hash.toLowerCase(),
              from: row.from.toLowerCase(),
              ...(row.to && ADDRESS.test(row.to) ? { to: row.to.toLowerCase() } : {}),
              ...(row.contractAddress && ADDRESS.test(row.contractAddress) ? { contractAddress: row.contractAddress.toLowerCase() } : {}),
              blockNumber: toInt(row.blockNumber) ?? 0,
              timestamp: new Date((toInt(row.timeStamp) ?? 0) * 1000),
              failed: String(row.isError ?? '0') === '1' || String(row.txreceipt_status ?? '1') === '0',
            })),
        },
      );
      return redactResultUrl(result);
    },
  };
}

export type ContractSourceInput = ExplorerApi & { address: string };
/**
 * What the explorer holds for a contract's source (2026-09-24: the ABI too).
 *
 * `abi` is present only for a verified contract whose ABI parsed, as the
 * canonical signatures of its functions and events — `transfer(address,uint256)`,
 * `Transfer(address,address,uint256)` — sorted, which is the form two reads
 * can be compared in. The ABI is never stored whole.
 */
export type ContractSource = {
  address: string;
  verified: boolean;
  name?: string;
  compiler?: string;
  abi?: { functions: string[]; events: string[] };
};

const sourceSchema = envelope(
  z.object({
    ContractName: z.string().nullish(),
    SourceCode: z.string().nullish(),
    ABI: z.string().nullish(),
    CompilerVersion: z.string().nullish(),
  }),
);

type AbiParam = { type: string; components?: AbiParam[] | undefined };
const abiParam: z.ZodType<AbiParam> = z.lazy(() => z.object({ type: z.string(), components: z.array(abiParam).optional() }));
const abiSchema = z.array(
  z
    .object({ type: z.string().optional(), name: z.string().optional(), inputs: z.array(abiParam).optional() })
    .passthrough(),
);

/** The canonical type of one parameter: tuples expand to their components, array suffixes kept. */
function canonicalType(param: AbiParam): string {
  if (!param.type.startsWith('tuple')) return param.type;
  return `(${(param.components ?? []).map(canonicalType).join(',')})${param.type.slice('tuple'.length)}`;
}

/** Function and event signatures from an ABI string, or undefined when it is not an ABI. */
export function abiSignatures(raw: string | null | undefined): { functions: string[]; events: string[] } | undefined {
  if (!raw || !raw.trim().startsWith('[')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const items = abiSchema.safeParse(parsed);
  if (!items.success) return undefined;
  const signature = (item: { name?: string | undefined; inputs?: AbiParam[] | undefined }) => `${item.name ?? ''}(${(item.inputs ?? []).map(canonicalType).join(',')})`;
  const functions = [...new Set(items.data.filter((item) => item.type === 'function' && item.name).map(signature))].sort();
  const events = [...new Set(items.data.filter((item) => item.type === 'event' && item.name).map(signature))].sort();
  return { functions, events };
}

/** What a verified contract is called; an unverified one answers with an empty name. */
export function createContractSourceAdapter(): SourceAdapter<ContractSourceInput, ContractSource> {
  return {
    name: 'blockscout',
    canHandle(input) {
      return Boolean(input.baseUrl) && ADDRESS.test(input.address);
    },
    async fetch(input, ctx: SourceContext): Promise<SourceResult<ContractSource>> {
      const url = explorerApiUrl(input, '/v2/api', { module: 'contract', action: 'getsourcecode', address: input.address });
      const result = await performSourceFetch(
        ctx,
        { url, headers: { accept: 'application/json' }, maxBytes: 4 * 1024 * 1024 },
        {
          schema: sourceSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): ContractSource => {
            const first = rows(raw.result)[0];
            const name = first?.ContractName?.trim();
            const verified = Boolean(first?.SourceCode && first.SourceCode.length > 0);
            const parsedAbi = verified ? abiSignatures(first?.ABI) : undefined;
            // An empty ABI says nothing to compare; it is left out rather than stored as "no functions".
            const abi = parsedAbi && parsedAbi.functions.length + parsedAbi.events.length > 0 ? parsedAbi : undefined;
            const compiler = first?.CompilerVersion?.trim();
            return {
              address: input.address.toLowerCase(),
              verified,
              ...(name ? { name } : {}),
              ...(verified && compiler ? { compiler } : {}),
              ...(abi ? { abi } : {}),
            };
          },
        },
      );
      return redactResultUrl(result);
    },
  };
}
