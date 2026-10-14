import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * Registrations in the ERC-8004 Identity Registry on Robinhood Chain, as counts (2026-10-14, growth rule 10).
 *
 * The registry (`0x8004A169…a432`, an "AgentIdentity" proxy) mints one ERC-721 per agent and emits
 * `Registered(uint256 indexed agentId, string agentURI, address indexed owner)` for each — topic0
 * `keccak256("Registered(uint256,string,address)")`, confirmed against HEY's own registration
 * (transaction 0x9cffd268…f29e, block 87,277,370: its third log carries this topic with agentId 8783).
 *
 * One `eth_getLogs` per block window, filtered to the registry and that one topic. With a single value in
 * each topic position the public node answers up to ten million blocks a request (measured 2026-10-14: an
 * OR list of topics is held to 100,000); a range it will not serve comes back as an error the caller halves
 * on (`isLogWindowTooLarge`).
 *
 * Counts only. The owner (an account), the agent id and the agent URI are read past in memory and never
 * leave this adapter: the result is how many registrations each block held, and the block's time when the
 * node put it on the log. A repeated log (same transaction and log index) counts once; a log the node marks
 * `removed` (a reorganised block) is not counted; a log from another contract or of another event means
 * the answer is not the one asked for, and the whole window is refused rather than half-counted.
 */
export const ERC8004_IDENTITY_REGISTRY_ADDRESS = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432' as const;

/** `keccak256("Registered(uint256,string,address)")`. */
export const ERC8004_REGISTERED_TOPIC = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a' as const;

export const ERC8004_REGISTERED_EVENT = 'Registered(uint256 indexed agentId, string agentURI, address indexed owner)' as const;

export type Erc8004RegistrationWindowInput = { rpcUrl: string; fromBlock: number; toBlock: number };

/** Registrations in one block, and the block's time when the node gave it (null: the caller reads it). */
export type Erc8004RegistrationBlock = { blockNumber: number; registrations: number; at: Date | null };

export type Erc8004RegistrationWindow = { fromBlock: number; toBlock: number; blocks: Erc8004RegistrationBlock[] };

const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/;

const logSchema = z.object({
  address: z.string(),
  topics: z.array(z.string()),
  blockNumber: z.string().regex(HEX_QUANTITY),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  logIndex: z.string().regex(HEX_QUANTITY),
  blockTimestamp: z.string().regex(HEX_QUANTITY).optional(),
  removed: z.boolean().optional(),
});

const answerSchema = z
  .object({
    jsonrpc: z.literal('2.0').optional(),
    id: z.union([z.number(), z.string()]).nullish(),
    result: z.array(logSchema).optional(),
    error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
  })
  .superRefine((value, context) => {
    if (value.error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `rpc error: ${value.error.message}` });
      return;
    }
    if (!value.result) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'missing rpc result' });
      return;
    }
    for (const log of value.result) {
      if (log.address.toLowerCase() !== ERC8004_IDENTITY_REGISTRY_ADDRESS || log.topics[0]?.toLowerCase() !== ERC8004_REGISTERED_TOPIC || log.topics.length !== 3) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'a log that is not the registry’s Registered event' });
        return;
      }
    }
  });

const hex = (value: number): string => `0x${value.toString(16)}`;

/** Pure: per-block counts from validated logs. Nothing but the block, its time and the count survives. */
export function countRegistrationLogs(logs: readonly z.infer<typeof logSchema>[]): Erc8004RegistrationBlock[] {
  const seen = new Set<string>();
  const blocks = new Map<number, Erc8004RegistrationBlock>();
  for (const log of logs) {
    if (log.removed === true) continue;
    const key = `${log.transactionHash.toLowerCase()}:${Number.parseInt(log.logIndex, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const blockNumber = Number.parseInt(log.blockNumber, 16);
    if (!Number.isSafeInteger(blockNumber)) continue;
    const seconds = log.blockTimestamp === undefined ? Number.NaN : Number.parseInt(log.blockTimestamp, 16);
    const at = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
    const block = blocks.get(blockNumber);
    if (block) {
      block.registrations += 1;
      if (!block.at && at) block.at = at;
    } else {
      blocks.set(blockNumber, { blockNumber, registrations: 1, at });
    }
  }
  return [...blocks.values()].sort((a, b) => a.blockNumber - b.blockNumber);
}

export function createErc8004RegistrationAdapter(): SourceAdapter<Erc8004RegistrationWindowInput, Erc8004RegistrationWindow> {
  return {
    name: 'erc8004-registrations',

    canHandle(input) {
      return Boolean(input.rpcUrl) && Number.isSafeInteger(input.fromBlock) && input.fromBlock >= 0 && Number.isSafeInteger(input.toBlock) && input.toBlock >= input.fromBlock;
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<Erc8004RegistrationWindow>> {
      return performSourceFetch(
        ctx,
        {
          url: input.rpcUrl,
          method: 'POST' as const,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getLogs',
            params: [{ address: ERC8004_IDENTITY_REGISTRY_ADDRESS, topics: [ERC8004_REGISTERED_TOPIC], fromBlock: hex(input.fromBlock), toBlock: hex(input.toBlock) }],
          }),
          headers: { 'content-type': 'application/json' },
          conditional: false as const,
        },
        {
          schema: answerSchema,
          parse: (raw) => JSON.parse(raw) as unknown,
          // A window is read once; the next run starts after it.
          cacheTtlSeconds: 0,
          normalize: (raw): Erc8004RegistrationWindow => ({ fromBlock: input.fromBlock, toBlock: input.toBlock, blocks: countRegistrationLogs(raw.result ?? []) }),
        },
      );
    },
  };
}
