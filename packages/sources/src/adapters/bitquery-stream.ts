import { z } from 'zod';

import { dexPoolFactoryById } from '../factories/dex-pools';
import { factoryById } from '../factories/registry';
import { BITQUERY_NETWORK } from './bitquery';
import { HOODLOCK } from './hoodlock';

/**
 * Bitquery's live stream, as a trigger only (2026-10-16, founder: the stream
 * allowance is 100,000 minutes a cycle, apart from points).
 *
 * One connection, one subscription, one `Events` cube, four OR-ed conditions:
 * every log of the Pons V2 factory, an `Initialize` on the Uniswap v4
 * PoolManager, every log of the HoodLock locker, and a proxy `Upgraded` on any
 * contract (2026-10-16 audit additions). An event read here is never a fact.
 * It names a block, a transaction and a log position, and HEY re-reads through
 * the path that already owns that fact (`REFRESH_CHAIN_TRIGGERS`): the hourly
 * launch scan's `readFactoryWindow`, the HoodLock sweep, the upgrade watch's
 * storage read. Only what those reads return is written. An `Upgraded` on a
 * contract HEY does not already watch is dropped in memory and never stored.
 * The document asks for no argument and no account field, so nothing in a
 * payload could become a fact even by mistake.
 *
 * The transport is the one Bitquery documents and a live 90-second probe used
 * on 2026-10-15: `wss://streaming.bitquery.io/graphql?token=<key>` with the
 * `graphql-ws` subprotocol — the legacy subscriptions-transport-ws messages
 * (`connection_init` → `connection_ack`, `start` → `data`…, `ka` keepalives,
 * `stop`, `connection_terminate`). Acknowledged in 0.9 s; events arrived
 * 0.3–1.3 s after their block.
 */

export const BITQUERY_STREAM_URL = 'wss://streaming.bitquery.io/graphql';
/** The legacy subscriptions-transport-ws subprotocol name, as Bitquery documents it. */
export const BITQUERY_STREAM_PROTOCOL = 'graphql-ws';
/** The one operation id this client ever starts. */
export const BITQUERY_STREAM_OPERATION_ID = '1';

/** The streaming endpoint with the key in the query, as Bitquery documents it. Never logged. */
export function bitqueryStreamUrl(token: string): string {
  return `${BITQUERY_STREAM_URL}?token=${encodeURIComponent(token)}`;
}

export type ChainTriggerKind = 'pons_factory' | 'v4_initialize' | 'hoodlock' | 'upgrade';

/** One of the fixed contracts the stream watches (the `upgrade` kind names no fixed contract). */
export type ChainTriggerSource = {
  kind: Exclude<ChainTriggerKind, 'upgrade'>;
  /** The scan source the re-read goes through (`readFactoryWindow`). */
  sourceId: string;
  chainId: number;
  /** Lower-cased. */
  address: string;
  /** `topics[0]` values the re-read path decodes from this contract; empty: every log is a trigger. */
  topics: readonly string[];
};

const ponsV2 = factoryById('PONS_V2');
const poolManager = dexPoolFactoryById('UNISWAP_V4_POOLS');
if (!ponsV2 || !poolManager) throw new Error('bitquery-stream: the Pons V2 factory and the v4 PoolManager must be registered');

/**
 * The two contracts, from the registry the hourly scan reads, so the stream and
 * the scan can never watch different addresses.
 */
export const CHAIN_TRIGGER_SOURCES: readonly ChainTriggerSource[] = [
  {
    kind: 'pons_factory',
    sourceId: ponsV2.id,
    chainId: ponsV2.chainId,
    address: ponsV2.factoryAddress.toLowerCase(),
    topics: [ponsV2.eventTopic0, ...(ponsV2.lifecycleTopics ?? [])].map((topic) => topic.toLowerCase()),
  },
  {
    kind: 'v4_initialize',
    sourceId: poolManager.id,
    chainId: poolManager.chainId,
    address: poolManager.factoryAddress.toLowerCase(),
    topics: [poolManager.eventTopic0.toLowerCase()],
  },
  {
    // A lock, an extension, a withdrawal: any log of the locker means its state moved; the sweep reads it.
    kind: 'hoodlock',
    sourceId: 'HOODLOCK',
    chainId: HOODLOCK.chainId,
    address: HOODLOCK.address.toLowerCase(),
    topics: [],
  },
];

/** `Upgraded(address indexed implementation)` (EIP-1967). `BeaconUpgraded` is deliberately not watched. */
export const UPGRADED_TOPIC0 = '0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b';
export const UPGRADED_EVENT_NAME = 'Upgraded';

export const chainTriggerSourceFor = (address: string): ChainTriggerSource | undefined =>
  CHAIN_TRIGGER_SOURCES.find((source) => source.address === address.toLowerCase());

/**
 * The subscription. `any:` is Bitquery's OR (the same shape `bitquery-pools.ts`
 * sends); each element is a whole condition, so address-only and name-only
 * conditions mix, and all four ride one cube in one subscription: one stream.
 * The `Upgraded` condition filters by the decoded name — the filter
 * `bitquery-upgrades.ts` already reads Upgraded logs with in production — and
 * the topic is checked again in memory (`isTriggerRelevant`).
 */
export function bitqueryTriggerSubscription(): string {
  const [factory, manager, locker] = CHAIN_TRIGGER_SOURCES;
  return `subscription HeyChainTriggers {
  EVM(network: ${BITQUERY_NETWORK}) {
    Events(
      where: {
        any: [
          { Log: { SmartContract: { is: "${factory!.address}" } } }
          { Log: { SmartContract: { is: "${manager!.address}" }, Signature: { Name: { is: "Initialize" } } } }
          { Log: { SmartContract: { is: "${locker!.address}" } } }
          { Log: { Signature: { Name: { is: "${UPGRADED_EVENT_NAME}" } } } }
        ]
      }
    ) {
      Block { Number Time }
      Transaction { Hash }
      Log { Index SmartContract Signature { Name SignatureHash } }
    }
  }
}`;
}

/* ------------------------------------------------------------- client messages */

export const connectionInitMessage = (): string => JSON.stringify({ type: 'connection_init', payload: {} });
export const startMessage = (query: string = bitqueryTriggerSubscription()): string =>
  JSON.stringify({ id: BITQUERY_STREAM_OPERATION_ID, type: 'start', payload: { query } });
export const stopMessage = (): string => JSON.stringify({ id: BITQUERY_STREAM_OPERATION_ID, type: 'stop' });
export const connectionTerminateMessage = (): string => JSON.stringify({ type: 'connection_terminate' });

/* ------------------------------------------------------------- server messages */

const numberish = z.union([z.string(), z.number()]).nullish();

const eventRowSchema = z.object({
  Block: z.object({ Number: numberish, Time: z.string().nullish() }).nullish(),
  Transaction: z.object({ Hash: z.string().nullish() }).nullish(),
  Log: z
    .object({
      Index: numberish,
      SmartContract: z.string().nullish(),
      Signature: z.object({ Name: z.string().nullish(), SignatureHash: z.string().nullish() }).nullish(),
    })
    .nullish(),
});

const graphqlErrorSchema = z.object({ message: z.string() }).passthrough();

const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('connection_ack') }).passthrough(),
  z.object({ type: z.literal('ka') }).passthrough(),
  z.object({ type: z.literal('connection_error'), payload: z.unknown().optional() }).passthrough(),
  z
    .object({
      type: z.literal('data'),
      id: z.string().optional(),
      payload: z.object({
        data: z.object({ EVM: z.object({ Events: z.array(z.unknown()).nullish() }).nullish() }).nullish(),
        errors: z.array(graphqlErrorSchema).nullish(),
      }),
    })
    .passthrough(),
  z.object({ type: z.literal('error'), id: z.string().optional(), payload: z.unknown().optional() }).passthrough(),
  z.object({ type: z.literal('complete'), id: z.string().optional() }).passthrough(),
]);

/** One log the stream announced: where it is, never what it says. */
export type StreamEvent = {
  /**
   * Lower-cased: one of `CHAIN_TRIGGER_SOURCES`, or — for an `upgrade` — the contract that emitted
   * `Upgraded`, which stays in memory until the watched-contract filter keeps or drops it.
   */
  contract: string;
  kind: ChainTriggerKind;
  blockNumber: number;
  /** Null when the row carried no readable time. */
  blockTime: Date | null;
  txHash: string;
  logIndex: number;
  signatureName: string | null;
  /** `0x` + 64 lower-case hex, or null when the row carried none HEY can read. */
  signatureHash: string | null;
};

export type StreamMessage =
  | { kind: 'ack' }
  | { kind: 'ka' }
  | { kind: 'data'; events: StreamEvent[]; dropped: number; errors: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'connection_error'; message: string }
  | { kind: 'complete' }
  | { kind: 'invalid' };

const TX_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;

const int = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** A topic hash in one spelling (Bitquery may send it with or without `0x`); anything else is unknown. */
export function normalizeTopicHash(value: string | null | undefined): string | null {
  const hex = value?.trim().toLowerCase().replace(/^0x/, '');
  return hex && /^[0-9a-f]{64}$/.test(hex) ? `0x${hex}` : null;
}

/** Bitquery's tokens look like `ory_at_…`; a message is redacted before it is kept or logged. */
const redact = (text: string): string => text.replace(/ory_[a-z]{2}_[A-Za-z0-9._-]+/g, '[redacted]').replace(/token=[^&\s"]+/gi, 'token=[redacted]');

const messageOf = (payload: unknown): string => {
  if (typeof payload === 'string') return redact(payload).slice(0, 240);
  if (Array.isArray(payload)) return payload.map(messageOf).filter(Boolean).join('; ').slice(0, 240);
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string') return redact(record.message).slice(0, 240);
    if (Array.isArray(record.errors)) return messageOf(record.errors);
  }
  return 'no message';
};

/**
 * One row as an event, or undefined when it cannot be one: a row with no
 * block, transaction, position or one of the two contracts is dropped, never
 * patched — a trigger HEY cannot point the RPC at is no trigger.
 */
export function parseStreamEvent(row: unknown): StreamEvent | undefined {
  const parsed = eventRowSchema.safeParse(row);
  if (!parsed.success) return undefined;
  const contract = parsed.data.Log?.SmartContract?.toLowerCase();
  const source = contract && ADDRESS.test(contract) ? chainTriggerSourceFor(contract) : undefined;
  const signatureName = parsed.data.Log?.Signature?.Name?.trim() || null;
  const signatureHash = normalizeTopicHash(parsed.data.Log?.Signature?.SignatureHash);
  // Not one of the fixed contracts: an upgrade, or nothing.
  const upgrade = !source && signatureName === UPGRADED_EVENT_NAME;
  const blockNumber = int(parsed.data.Block?.Number);
  const logIndex = int(parsed.data.Log?.Index);
  const txHash = parsed.data.Transaction?.Hash?.toLowerCase();
  if ((!source && !upgrade) || !contract || !ADDRESS.test(contract) || blockNumber === undefined || logIndex === undefined || !txHash || !TX_HASH.test(txHash)) return undefined;
  const time = parsed.data.Block?.Time ? new Date(parsed.data.Block.Time) : null;
  return {
    contract,
    kind: source ? source.kind : 'upgrade',
    blockNumber,
    blockTime: time && !Number.isNaN(time.getTime()) ? time : null,
    txHash,
    logIndex,
    signatureName,
    signatureHash,
  };
}

/** Parse one text frame from the server. Anything that is not the protocol is `invalid`, never thrown. */
export function parseStreamMessage(raw: string): StreamMessage {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = serverMessageSchema.safeParse(json);
  if (!parsed.success) return { kind: 'invalid' };
  const message = parsed.data;
  switch (message.type) {
    case 'connection_ack':
      return { kind: 'ack' };
    case 'ka':
      return { kind: 'ka' };
    case 'connection_error':
      return { kind: 'connection_error', message: messageOf(message.payload) };
    case 'error':
      return { kind: 'error', message: messageOf(message.payload) };
    case 'complete':
      return { kind: 'complete' };
    case 'data': {
      const rows = message.payload.data?.EVM?.Events ?? [];
      const events: StreamEvent[] = [];
      let dropped = 0;
      for (const row of rows) {
        const event = parseStreamEvent(row);
        if (event) events.push(event);
        else dropped += 1;
      }
      return { kind: 'data', events, dropped, errors: (message.payload.errors ?? []).map((error) => redact(error.message).slice(0, 240)) };
    }
  }
}

/**
 * Whether an event can change anything its re-read path reads. A factory log
 * whose topic is known and is not one HEY decodes (a curve trade, a
 * `BuybackEnabledUpdated`, the `0x308c390e…` event) is not a trigger. A row
 * whose topic Bitquery did not give is kept: unknown is not irrelevant, and
 * the re-read costs a request, not a fact. An `Upgraded` must carry the
 * EIP-1967 topic when a topic is given; whether its contract is watched is the
 * caller's filter, in memory.
 */
export function isTriggerRelevant(event: StreamEvent): boolean {
  if (event.kind === 'upgrade') return event.signatureHash === null || event.signatureHash === UPGRADED_TOPIC0;
  const source = chainTriggerSourceFor(event.contract);
  if (!source) return false;
  if (source.topics.length === 0) return true;
  if (event.signatureHash) return source.topics.includes(event.signatureHash);
  // The subscription already narrows the PoolManager to Initialize; a factory row without a topic stays a trigger.
  return true;
}

export type StreamErrorClass = 'auth' | 'document' | 'transient';

const AUTH_WORDS =
  /unauthori[sz]ed|forbidden|invalid[ _-]?token|token (is )?(invalid|expired|missing)|api[ _-]?key|not allowed|permission|entitle|\bplan\b|billing|payment|subscription limit|quota|(points|minutes|stream(ing)?[ -]time|limit)\b[^.]{0,24}\b(exceeded|reached|exhausted)|\b40[123]\b/i;
const DOCUMENT_WORDS = /cannot query field|unknown (argument|type|field)|syntax error|validation|not defined|expected type|parse error/i;

/**
 * What an error from the server means for the connection. An auth or plan
 * error, or a document the server rejects, cannot be fixed by reconnecting:
 * the stream stops and asks for a person. Anything else is retried.
 */
export function classifyStreamError(message: string): StreamErrorClass {
  if (AUTH_WORDS.test(message)) return 'auth';
  if (DOCUMENT_WORDS.test(message)) return 'document';
  return 'transient';
}

/**
 * WebSocket close codes that mean "do not come back the same way": 1008 is a
 * policy violation, and the graphql-ws family uses 4400 (bad request), 4401
 * (unauthorised) and 4403 (forbidden).
 */
export const FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([1008, 4400, 4401, 4403]);
