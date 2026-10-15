import { z } from 'zod';

/**
 * The Pons V2 launch lifecycle, read from the factory's own events
 * (2026-10-15, Bitquery renewal pass).
 *
 * A Pons V2 token lives on its bonding curve until the curve fills. Then the
 * factory sweeps the curve (`LaunchSwept`), and in the next block one
 * transaction seeds a full-range Uniswap v4 position (`PoolGraduated`) and
 * locks the rest of the graduation tokens for good
 * (`GraduationTokensPermanentlyLocked`). The three events are emitted by the
 * same factory as the launch itself, so they ride in the launch scan's one
 * `eth_getLogs` as an OR list in `topics[0]` — no extra log request.
 *
 * Every topic below was computed with keccak256 over the signature and then
 * matched against live logs of `0x7eD598…` on 2026-10-15 (block 89,210,729,
 * tx 0x0e47abfd…; saved as `fixtures/pons-v2-lifecycle-logs.json`): each has
 * the token alone in `topics[1]` and its other arguments as whole data words.
 *
 * Keyed by factory: Pons V1 graduates into Uniswap v3 and emits none of
 * these, so nothing here is ever read for a V1 factory.
 */

/** `LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)`. */
export const PONS_V2_LAUNCH_SWEPT_TOPIC0 = '0xcdb72f157fd3666758a6ce201387ffb52038c7562e4fff352828da1096c4b6b4' as const;
/** `PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)`. */
export const PONS_V2_POOL_GRADUATED_TOPIC0 = '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259' as const;
/** `GraduationTokensPermanentlyLocked(address indexed token, uint256 amount)`. */
export const PONS_V2_GRADUATION_LOCKED_TOPIC0 = '0xa0a18f5bf205becee8b268d7cf69addab8548ae8ef361791464cf0e0e17c1361' as const;

export const PONS_V2_LIFECYCLE_TOPICS = [PONS_V2_LAUNCH_SWEPT_TOPIC0, PONS_V2_POOL_GRADUATED_TOPIC0, PONS_V2_GRADUATION_LOCKED_TOPIC0] as const;

/**
 * The public node refuses an `eth_getLogs` whose `topics[0]` is an OR list
 * over more than this many blocks ("only 100000 are allowed for this request
 * … or send one value per position", read 2026-10-15). A single topic is not
 * limited this way. The hourly head scan reads about 40,000 blocks, so it is
 * one request either way; a wide rescan of a lifecycle factory is cut to
 * windows of this size from the start instead of halving down to it.
 */
export const OR_TOPIC_MAX_BLOCK_RANGE = 100_000;

type Common = {
  token: string;
  blockNumber: number;
  txHash: string;
  logIndex: number | null;
};

export type PonsLifecycleEvent =
  | (Common & { kind: 'swept'; quoteOutRaw: string; tokenOutRaw: string })
  | (Common & { kind: 'graduated'; positionIdRaw: string; tokenAmountRaw: string; pairTokenAmountRaw: string })
  | (Common & { kind: 'locked'; amountRaw: string });

const HEX = /^0x[0-9a-fA-F]*$/;
const lifecycleLogSchema = z.object({
  topics: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).length(2),
  data: z.string().regex(HEX),
  blockNumber: z.string().regex(/^0x[0-9a-fA-F]+$/),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  logIndex: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  removed: z.boolean().optional(),
});

/** How many whole data words each event carries, by its topic. */
const WORDS: Record<string, { kind: PonsLifecycleEvent['kind']; words: number }> = {
  [PONS_V2_LAUNCH_SWEPT_TOPIC0]: { kind: 'swept', words: 2 },
  [PONS_V2_POOL_GRADUATED_TOPIC0]: { kind: 'graduated', words: 3 },
  [PONS_V2_GRADUATION_LOCKED_TOPIC0]: { kind: 'locked', words: 1 },
};

/** True when a log's `topics[0]` is one of the lifecycle events. */
export const isPonsLifecycleTopic = (topic0: string | undefined): boolean => topic0 !== undefined && topic0.toLowerCase() in WORDS;

/**
 * One factory log as a lifecycle event, or undefined when it is not shaped
 * exactly like one: the wrong number of topics, a token topic that is not a
 * left-padded address, data that is not exactly the event's words, or a log
 * the node marks as removed by a reorg. Nothing is guessed: a log that does
 * not decode is dropped, never stored half-read.
 */
export function decodePonsLifecycleLog(raw: unknown): PonsLifecycleEvent | undefined {
  const parsed = lifecycleLogSchema.safeParse(raw);
  if (!parsed.success || parsed.data.removed === true) return undefined;
  const log = parsed.data;
  const shape = WORDS[log.topics[0]!.toLowerCase()];
  if (!shape) return undefined;
  const tokenTopic = log.topics[1]!.toLowerCase();
  if (!/^0x0{24}[0-9a-f]{40}$/.test(tokenTopic)) return undefined;
  const token = `0x${tokenTopic.slice(-40)}`;
  if (token === '0x0000000000000000000000000000000000000000') return undefined;
  const hex = log.data.slice(2);
  if (hex.length !== shape.words * 64) return undefined;
  const word = (index: number): string => BigInt(`0x${hex.slice(index * 64, index * 64 + 64)}`).toString();
  const blockNumber = Number.parseInt(log.blockNumber, 16);
  if (!Number.isSafeInteger(blockNumber)) return undefined;
  const logIndex = log.logIndex === undefined ? null : Number.parseInt(log.logIndex, 16);
  const common: Common = {
    token,
    blockNumber,
    txHash: log.transactionHash.toLowerCase(),
    logIndex: logIndex !== null && Number.isSafeInteger(logIndex) ? logIndex : null,
  };
  switch (shape.kind) {
    case 'swept':
      return { ...common, kind: 'swept', quoteOutRaw: word(0), tokenOutRaw: word(1) };
    case 'graduated':
      return { ...common, kind: 'graduated', positionIdRaw: word(0), tokenAmountRaw: word(1), pairTokenAmountRaw: word(2) };
    case 'locked':
      return { ...common, kind: 'locked', amountRaw: word(0) };
  }
}
