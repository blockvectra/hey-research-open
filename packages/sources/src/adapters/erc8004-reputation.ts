import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * Feedback left for HEY's own agent in the ERC-8004 Reputation Registry, as counts (2026-11-02, founder:
 * "ok buat no 1 dan no 2").
 *
 * The registry is the canonical `ReputationRegistryUpgradeable` (erc-8004/erc-8004-contracts, `getVersion()` "2.0.0")
 * behind the vanity proxy `0x8004BAa1…9b63`, at the same address on Robinhood Chain (4663), Ethereum (1) and Base
 * (8453); on each, `getIdentityRegistry()` answers the Identity Registry HEY registered in (`0x8004A169…a432`). Read
 * on chain 2026-11-02: code at the address on all three, the EIP-1967 implementation `0x16e0fa7f…da34` on all three.
 *
 * Two of its events are counted, each asked for on its own so every topic position holds one value (Robinhood Chain's
 * node then serves ten million blocks a request; an OR list of topics is held to 100,000):
 *
 *   - `NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value,
 *     uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI,
 *     bytes32 feedbackHash)` — one per `giveFeedback`;
 *   - `FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex)` — one per
 *     `revokeFeedback`.
 *
 * Every request is filtered to one agent id (topic 1): HEY asks for its own agent's feedback only, never anyone
 * else's. Counts only. The client address (topic 2), the tags, the endpoint, the feedback URI and hash and the
 * transaction are read past in memory and never leave this adapter; what survives is, per block, how many feedback
 * entries and revocations it held, the block's time when the node gave it, and — for new feedback — how many fell in
 * each value bucket. The value is read as the client gave it (`value / 10^valueDecimals`); what it measures depends on
 * the tag the client chose, which HEY does not keep, so a bucket says where the number fell and nothing about HEY.
 *
 * A repeated log (same transaction and log index) counts once; a log the node marks `removed` is not counted; a log
 * from another contract, of another event or for another agent means the answer is not the one asked for, and the
 * whole window is refused rather than half-counted.
 */
export const ERC8004_REPUTATION_REGISTRY_ADDRESS = '0x8004baa17c55a88189ae136b182e5fda19de9b63' as const;

/** `keccak256("NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)")`. */
export const ERC8004_NEW_FEEDBACK_TOPIC = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc' as const;
/** `keccak256("FeedbackRevoked(uint256,address,uint64)")`. */
export const ERC8004_FEEDBACK_REVOKED_TOPIC = '0x25156fd3288212246d8b008d5921fde376c71ed14ac2e072a506eb06fde6d09d' as const;

export const ERC8004_NEW_FEEDBACK_EVENT =
  'NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)' as const;
export const ERC8004_FEEDBACK_REVOKED_EVENT = 'FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex)' as const;

/** How a client submits feedback, and withdraws it (the registry's own functions; HEY calls neither). */
export const ERC8004_GIVE_FEEDBACK_FUNCTION =
  'giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)' as const;
export const ERC8004_REVOKE_FEEDBACK_FUNCTION = 'revokeFeedback(uint256 agentId, uint64 feedbackIndex)' as const;

/**
 * HEY's own agent on each chain the registry was read on, by chain id (the Identity Registry's agentIds:
 * `apps/web/src/lib/erc8004.ts` holds the same, and a test holds them equal). The only agents HEY asks about.
 */
export const HEY_ERC8004_AGENTS_BY_CHAIN: Readonly<Record<number, number>> = { 4663: 8783, 1: 56081, 8453: 1148006 };

export type Erc8004FeedbackEvent = 'new' | 'revoked';

/** Where a feedback value fell, read as `value / 10^valueDecimals`; 100 sits in the top bucket of the 0–100 range. */
export const ERC8004_FEEDBACK_VALUE_BUCKETS = ['below0', 'from0to20', 'from20to40', 'from40to60', 'from60to80', 'from80to100', 'above100'] as const;
export type Erc8004FeedbackValueBucket = (typeof ERC8004_FEEDBACK_VALUE_BUCKETS)[number];
export type Erc8004FeedbackValueCounts = Record<Erc8004FeedbackValueBucket, number>;

export const emptyFeedbackValueCounts = (): Erc8004FeedbackValueCounts => ({ below0: 0, from0to20: 0, from20to40: 0, from40to60: 0, from60to80: 0, from80to100: 0, above100: 0 });

export type Erc8004FeedbackWindowInput = { rpcUrl: string; fromBlock: number; toBlock: number; event: Erc8004FeedbackEvent; agent: number };

/** One block's counts. `values` is empty counts for a revocation window. `at` is null when the log carried no time. */
export type Erc8004FeedbackBlock = { blockNumber: number; feedback: number; revoked: number; values: Erc8004FeedbackValueCounts; at: Date | null };

export type Erc8004FeedbackWindow = { fromBlock: number; toBlock: number; event: Erc8004FeedbackEvent; blocks: Erc8004FeedbackBlock[] };

const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/;
const WORD = 64;

const logSchema = z.object({
  address: z.string(),
  topics: z.array(z.string()),
  data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/),
  blockNumber: z.string().regex(HEX_QUANTITY),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  logIndex: z.string().regex(HEX_QUANTITY),
  blockTimestamp: z.string().regex(HEX_QUANTITY).optional(),
  removed: z.boolean().optional(),
});
type FeedbackLog = z.infer<typeof logSchema>;

const hex = (value: number): string => `0x${value.toString(16)}`;

/** The 32-byte topic an agent id is filtered on. */
export const agentTopic = (agent: number): string => `0x${agent.toString(16).padStart(WORD, '0')}`;

const topicFor = (event: Erc8004FeedbackEvent): string => (event === 'new' ? ERC8004_NEW_FEEDBACK_TOPIC : ERC8004_FEEDBACK_REVOKED_TOPIC);

/** Pure: the bucket a value falls in, read as `value / 10^decimals`, compared exactly (no floating point). */
export function feedbackValueBucket(value: bigint, decimals: number): Erc8004FeedbackValueBucket {
  if (value < 0n) return 'below0';
  const scale = 10n ** BigInt(decimals);
  if (value < 20n * scale) return 'from0to20';
  if (value < 40n * scale) return 'from20to40';
  if (value < 60n * scale) return 'from40to60';
  if (value < 80n * scale) return 'from60to80';
  if (value <= 100n * scale) return 'from80to100';
  return 'above100';
}

/**
 * Pure: `value` (int128, sign-extended to a 256-bit word) and `valueDecimals` (uint8) from a `NewFeedback` log's data —
 * the second and third words after `feedbackIndex`. Null when the data cannot hold them or the decimals are out of the
 * registry's own range (it refuses more than 18 on write).
 */
export function readFeedbackValue(data: string): { value: bigint; decimals: number } | null {
  const body = data.slice(2);
  // feedbackIndex, value, valueDecimals, five string offsets and the hash: eight head words at least.
  if (body.length < 8 * WORD) return null;
  const word = (index: number): bigint => BigInt(`0x${body.slice(index * WORD, (index + 1) * WORD)}`);
  const raw = word(1);
  const value = raw >= 1n << 255n ? raw - (1n << 256n) : raw;
  const decimals = word(2);
  if (decimals > 18n) return null;
  if (value > 10n ** 38n || value < -(10n ** 38n)) return null;
  return { value, decimals: Number(decimals) };
}

function answerSchema(input: Erc8004FeedbackWindowInput) {
  const topic = topicFor(input.event);
  const agent = agentTopic(input.agent);
  return z
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
        if (log.address.toLowerCase() !== ERC8004_REPUTATION_REGISTRY_ADDRESS || log.topics[0]?.toLowerCase() !== topic || log.topics[1]?.toLowerCase() !== agent || log.topics.length !== 4) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'a log that is not the registry’s feedback event for the agent asked' });
          return;
        }
        if (input.event === 'new' && log.removed !== true && readFeedbackValue(log.data) === null) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'a NewFeedback log whose value cannot be read' });
          return;
        }
      }
    });
}

/** Pure: per-block counts from validated logs of one event. Nothing but the block, its time and the counts survives. */
export function countFeedbackLogs(logs: readonly FeedbackLog[], event: Erc8004FeedbackEvent): Erc8004FeedbackBlock[] {
  const seen = new Set<string>();
  const blocks = new Map<number, Erc8004FeedbackBlock>();
  for (const log of logs) {
    if (log.removed === true) continue;
    const key = `${log.transactionHash.toLowerCase()}:${Number.parseInt(log.logIndex, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const blockNumber = Number.parseInt(log.blockNumber, 16);
    if (!Number.isSafeInteger(blockNumber)) continue;
    const seconds = log.blockTimestamp === undefined ? Number.NaN : Number.parseInt(log.blockTimestamp, 16);
    const at = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
    let block = blocks.get(blockNumber);
    if (!block) {
      block = { blockNumber, feedback: 0, revoked: 0, values: emptyFeedbackValueCounts(), at };
      blocks.set(blockNumber, block);
    }
    if (!block.at && at) block.at = at;
    if (event === 'revoked') {
      block.revoked += 1;
      continue;
    }
    const read = readFeedbackValue(log.data);
    // The schema refused an unreadable value; this keeps the pure function total.
    if (!read) continue;
    block.feedback += 1;
    block.values[feedbackValueBucket(read.value, read.decimals)] += 1;
  }
  return [...blocks.values()].sort((a, b) => a.blockNumber - b.blockNumber);
}

export function createErc8004FeedbackAdapter(): SourceAdapter<Erc8004FeedbackWindowInput, Erc8004FeedbackWindow> {
  return {
    name: 'erc8004-feedback',

    canHandle(input) {
      return (
        Boolean(input.rpcUrl) &&
        (input.event === 'new' || input.event === 'revoked') &&
        Number.isSafeInteger(input.agent) &&
        input.agent > 0 &&
        Number.isSafeInteger(input.fromBlock) &&
        input.fromBlock >= 0 &&
        Number.isSafeInteger(input.toBlock) &&
        input.toBlock >= input.fromBlock
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<Erc8004FeedbackWindow>> {
      return performSourceFetch(
        ctx,
        {
          url: input.rpcUrl,
          method: 'POST' as const,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getLogs',
            params: [{ address: ERC8004_REPUTATION_REGISTRY_ADDRESS, topics: [topicFor(input.event), agentTopic(input.agent)], fromBlock: hex(input.fromBlock), toBlock: hex(input.toBlock) }],
          }),
          headers: { 'content-type': 'application/json' },
          conditional: false as const,
        },
        {
          schema: answerSchema(input),
          parse: (raw) => JSON.parse(raw) as unknown,
          // A window is read once; the next run starts after it.
          cacheTtlSeconds: 0,
          normalize: (raw): Erc8004FeedbackWindow => ({ fromBlock: input.fromBlock, toBlock: input.toBlock, event: input.event, blocks: countFeedbackLogs(raw.result ?? [], input.event) }),
        },
      );
    },
  };
}

/** A node that will not serve logs this far back (a pruned or keyless public node): the read stops there, never skips. */
export function isLogHistoryNotServed(message: string | undefined): boolean {
  return /archive|historical state|pruned|missing trie node|header not found/i.test(message ?? '');
}
