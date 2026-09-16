import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * On-chain activity, read from the public RPC (2026-09-12).
 *
 * The explorer's API sits behind a bot challenge, so the one question HEY
 * wants answered about a contract — is anyone using it — is read from the
 * node itself: `eth_getLogs` filtered to the contract over a block window,
 * counted, never stored. One call a day per contract for the projects that
 * are being watched closely, and the node's own limits (a query that times
 * out, a window with too many results) are reported as errors the caller
 * can split the window on. Nothing here indexes history (PRD V4 §22.2).
 */
export type RpcLogCountInput = {
  rpcUrl: string;
  address: string;
  fromBlock: number;
  toBlock: number;
};

export type LogCount = {
  address: string;
  fromBlock: number;
  toBlock: number;
  count: number;
};

const envelope = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.number(), z.string()]).nullish(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

const hex = (value: number): string => `0x${value.toString(16)}`;

/** Never cached: a count is for the window it was asked about, once. */
const NO_CACHE = 0;

function rpcRequest(rpcUrl: string, method: string, params: unknown[]) {
  return {
    url: rpcUrl,
    method: 'POST' as const,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    headers: { 'content-type': 'application/json' },
    conditional: false as const,
  };
}

const rpcSchema = envelope.superRefine((value, context) => {
  if (value.error) context.addIssue({ code: z.ZodIssueCode.custom, message: `rpc error: ${value.error.message}` });
  else if (value.result === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'missing rpc result' });
});

/** The node's own reasons for refusing a window: the caller halves it and asks again. */
export function isLogWindowTooLarge(message: string | undefined): boolean {
  return /timed out|more than \d+ results|query returned more|block range|too many|exceeds|limit/i.test(message ?? '');
}

export function createRpcLogCountAdapter(): SourceAdapter<RpcLogCountInput, LogCount> {
  return {
    name: 'rpc-logs',

    canHandle(input) {
      return Boolean(input.rpcUrl) && /^0x[a-fA-F0-9]{40}$/.test(input.address) && input.fromBlock >= 0 && input.toBlock >= input.fromBlock;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<LogCount>> {
      return performSourceFetch(
        ctx,
        rpcRequest(input.rpcUrl, 'eth_getLogs', [{ address: input.address, fromBlock: hex(input.fromBlock), toBlock: hex(input.toBlock) }]),
        {
          schema: rpcSchema,
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: NO_CACHE,
          normalize: (raw): LogCount => ({
            address: input.address,
            fromBlock: input.fromBlock,
            toBlock: input.toBlock,
            count: Array.isArray(raw.result) ? raw.result.length : 0,
          }),
        },
      );
    },
  };
}

export type RpcHeadInput = { rpcUrl: string };
export type ChainHead = { blockNumber: number };

export function createRpcBlockNumberAdapter(): SourceAdapter<RpcHeadInput, ChainHead> {
  return {
    name: 'rpc-head',
    canHandle(input) {
      return Boolean(input.rpcUrl);
    },
    fetch(input, ctx: SourceContext): Promise<SourceResult<ChainHead>> {
      return performSourceFetch(ctx, rpcRequest(input.rpcUrl, 'eth_blockNumber', []), {
        schema: rpcSchema,
        parse: (raw) => JSON.parse(raw) as unknown,
        cacheTtlSeconds: NO_CACHE,
        normalize: (raw): ChainHead => ({ blockNumber: typeof raw.result === 'string' ? Number.parseInt(raw.result, 16) : 0 }),
      });
    },
  };
}

export type RpcBlockBatchInput = { rpcUrl: string; blockNumbers: readonly number[] };

/** Every block the node answered for, by number; one it refused is simply absent. */
export type BlockStamps = { stamps: ReadonlyMap<number, Date> };

const batchSchema = z.array(envelope).superRefine((value, context) => {
  if (value.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'empty batch response' });
});

/**
 * Many block timestamps in one request (2026-09-16).
 *
 * JSON-RPC allows an array of calls in a single POST, and this node honours
 * it: a hundred blocks come back in about half a second. The node counts the
 * *calls*, not the requests, so batching does not buy an unlimited rate — it
 * buys the round trips, which is what made a one-at-a-time backfill of 4,411
 * blocks take a day rather than an hour.
 *
 * A block the node declines is left out of the map rather than defaulted, so
 * a caller writes a date only where it actually read one.
 */
export function createRpcBlockTimestampBatchAdapter(): SourceAdapter<RpcBlockBatchInput, BlockStamps> {
  return {
    name: 'rpc-block-batch',
    canHandle(input) {
      return Boolean(input.rpcUrl) && input.blockNumbers.length > 0 && input.blockNumbers.every((n) => n >= 0);
    },
    fetch(input, ctx: SourceContext): Promise<SourceResult<BlockStamps>> {
      const calls = input.blockNumbers.map((blockNumber, index) => ({
        jsonrpc: '2.0',
        id: index,
        method: 'eth_getBlockByNumber',
        params: [hex(blockNumber), false],
      }));
      return performSourceFetch(
        ctx,
        {
          url: input.rpcUrl,
          method: 'POST' as const,
          body: JSON.stringify(calls),
          headers: { 'content-type': 'application/json' },
          conditional: false as const,
        },
        {
          schema: batchSchema,
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: NO_CACHE,
          normalize: (raw): BlockStamps => {
            const stamps = new Map<number, Date>();
            for (const entry of raw) {
              const index = typeof entry.id === 'number' ? entry.id : Number(entry.id);
              const blockNumber = input.blockNumbers[index];
              if (blockNumber === undefined || entry.error) continue;
              const block = entry.result as { timestamp?: string } | null;
              if (!block?.timestamp) continue;
              const seconds = Number.parseInt(block.timestamp, 16);
              // A block with no usable time is left out: absent means unread.
              if (!Number.isFinite(seconds) || seconds <= 0) continue;
              stamps.set(blockNumber, new Date(seconds * 1000));
            }
            return { stamps };
          },
        },
      );
    },
  };
}

export type RpcBlockInput = { rpcUrl: string; blockNumber: number };
export type BlockStamp = { blockNumber: number; timestamp: Date };

/** The timestamp of one block, so a day can be turned into a block window without assuming a block time. */
export function createRpcBlockTimestampAdapter(): SourceAdapter<RpcBlockInput, BlockStamp> {
  return {
    name: 'rpc-block',
    canHandle(input) {
      return Boolean(input.rpcUrl) && input.blockNumber >= 0;
    },
    fetch(input, ctx: SourceContext): Promise<SourceResult<BlockStamp>> {
      return performSourceFetch(ctx, rpcRequest(input.rpcUrl, 'eth_getBlockByNumber', [hex(input.blockNumber), false]), {
        schema: rpcSchema,
        parse: (raw) => JSON.parse(raw) as unknown,
        cacheTtlSeconds: NO_CACHE,
        normalize: (raw): BlockStamp => {
          const block = raw.result as { timestamp?: string } | null;
          const seconds = block?.timestamp ? Number.parseInt(block.timestamp, 16) : 0;
          return { blockNumber: input.blockNumber, timestamp: new Date(seconds * 1000) };
        },
      });
    },
  };
}
