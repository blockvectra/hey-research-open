import { z } from 'zod';

import type { SourceContext } from '../adapter';
import type { LaunchFactoryConfig } from './registry';

/**
 * Generic factory-event indexer (Discovery Coverage V2 §13).
 *
 * One engine for every on-chain launch source: give it a factory, an event
 * topic and which topic holds the token, and it returns launches. Writing a
 * bespoke scanner per launchpad is how the addresses end up scattered and the
 * chunking bugs get fixed in one place and not the others.
 *
 * Adaptive chunking is the core of it. Robinhood Chain's public RPC answers a
 * 2M-block window in a second or two when the range is sparse, and times out
 * when it is dense — and a timeout is indistinguishable from "no launches here"
 * unless the scan reacts to it. So a failed window is halved and retried rather
 * than skipped: silently stepping over a dense range would lose exactly the
 * busiest periods, which is where the launches are.
 */
export type FactoryLaunch = {
  sourceId: string;
  chainId: number;
  contractAddress: string;
  blockNumber: number;
  txHash: string;
  factoryAddress: string;
  version?: string | undefined;
  /** Read from the event data when the registry says where the strings are. */
  name?: string | undefined;
  symbol?: string | undefined;
  metadataUri?: string | undefined;
  imageUri?: string | undefined;
};

/** Names and tickers longer than this are launch spam, not identity. */
const MAX_EVENT_STRING_LENGTH = 512;
/** Inline metadata (hood.fun embeds a base64 image) can run to tens of KB. */
const MAX_METADATA_STRING_LENGTH = 64 * 1024;

/**
 * Decode one dynamic `string` from ABI-encoded event data.
 *
 * `word` is the index of the 32-byte slot that holds the string's offset. The
 * layout is checked at every step — an offset outside the data, a length past
 * its end, or bytes that are not printable UTF-8 all yield `undefined` rather
 * than a corrupted identity. Exported so a registry entry's word indexes can be
 * verified against a saved log in tests.
 */
export function decodeEventString(
  data: string,
  word: number,
  maxLength = MAX_EVENT_STRING_LENGTH,
): string | undefined {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length % 64 !== 0 || word < 0 || (word + 1) * 64 > hex.length) return undefined;

  const offsetHex = hex.slice(word * 64, word * 64 + 64);
  const offset = Number.parseInt(offsetHex, 16);
  if (!Number.isSafeInteger(offset) || offset % 32 !== 0 || (offset + 32) * 2 > hex.length) {
    return undefined;
  }

  const length = Number.parseInt(hex.slice(offset * 2, offset * 2 + 64), 16);
  if (!Number.isSafeInteger(length) || length === 0 || length > maxLength) return undefined;
  const start = (offset + 32) * 2;
  if (start + length * 2 > hex.length) return undefined;

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(hex.slice(start, start + length * 2), 'hex'),
    );
  } catch {
    return undefined;
  }
  const trimmed = text.replace(/\0+$/g, '').trim();
  // Control bytes mean this was never a string; the rest is sanitised downstream.
  // eslint-disable-next-line no-control-regex
  if (!trimmed || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}

export type ScanResult = {
  launches: FactoryLaunch[];
  /** Last block fully covered — the next run resumes from here + 1. */
  lastIndexedBlock: number;
  requests: number;
  rateLimitHits: number;
  /** Windows abandoned after shrinking to the floor; coverage gaps, reported. */
  unresolvedWindows: { from: number; to: number }[];
  /** Last provider error, so a degraded scan can explain itself. */
  lastError?: string;
  /** True when the request budget ran out before reaching `toBlock`. */
  truncated: boolean;
};

const logSchema = z.object({
  address: z.string(),
  topics: z.array(z.string()),
  data: z.string().optional(),
  blockNumber: z.string(),
  transactionHash: z.string(),
});

/** The strings a registry entry says the event carries, decoded from one log. */
function eventStringsOf(
  factory: LaunchFactoryConfig,
  data: string | undefined,
): Pick<FactoryLaunch, 'name' | 'symbol' | 'metadataUri' | 'imageUri'> {
  const words = factory.eventStrings;
  if (!words || !data) return {};
  const read = (word: number | undefined, max?: number) =>
    word === undefined ? undefined : decodeEventString(data, word, max);
  const name = read(words.name);
  const symbol = read(words.symbol);
  const metadataUri = read(words.metadataUri, MAX_METADATA_STRING_LENGTH);
  const imageUri = read(words.imageUri, MAX_EVENT_STRING_LENGTH * 4);
  return {
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
    ...(metadataUri ? { metadataUri } : {}),
    ...(imageUri ? { imageUri } : {}),
  };
}

const rpcSchema = z.object({
  result: z.array(logSchema).optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

/** One 32-byte data word as a `0x…` hex string, when the data has it; an address sits left-padded. */
const dataWord = (data: string | undefined, word: number | undefined): string | undefined => {
  if (!data || word === undefined) return undefined;
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  const slot = hex.slice(word * 64, word * 64 + 64);
  if (slot.length !== 64 || !/^0{24}[0-9a-fA-F]{40}$/.test(slot)) return undefined;
  return `0x${slot}`;
};

const MAX_CHUNK = 2_000_000;
const MIN_CHUNK = 25_000;
/**
 * Back-off after a rate limit: 3 s, then doubling to a 30 s ceiling while the
 * RPC keeps refusing, reset by the next window that succeeds. A fixed pause
 * spent the whole request budget re-asking a provider that had said "later"
 * (17 of Bankr's windows were lost that way on 2026-09-03); doubling lets one
 * hourly run ride out a burst and still make progress. A refused request
 * still counts against `maxRequests` — it was a request the RPC had to
 * answer — and after `MAX_RATE_LIMIT_HITS` of them the scan stops early,
 * resumable from `lastIndexedBlock`, rather than wait out the hour.
 */
export const RATE_LIMIT_BACKOFF_MS = 3_000;
export const RATE_LIMIT_BACKOFF_MAX_MS = 30_000;
/** Refusals tolerated in one scan before it stops and leaves the rest to the next run. */
export const MAX_RATE_LIMIT_HITS = 12;
const ADDRESS_FROM_TOPIC = (topic: string): string => `0x${topic.slice(-40)}`.toLowerCase();

export type ScanOptions = {
  rpcUrl: string;
  fromBlock: number;
  toBlock: number;
  /** Stop after this many requests so one source cannot monopolise a run. */
  maxRequests?: number;
  onProgress?: (block: number, found: number) => void;
  /** Injected in tests so a rate-limit back-off does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function scanFactory(
  factory: LaunchFactoryConfig,
  options: ScanOptions,
  ctx: SourceContext,
): Promise<ScanResult> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const launches = new Map<string, FactoryLaunch>();
  const unresolvedWindows: { from: number; to: number }[] = [];

  let from = options.fromBlock;
  let chunk = MAX_CHUNK;
  let requests = 0;
  let rateLimitHits = 0;
  let lastIndexedBlock = options.fromBlock > 0 ? options.fromBlock - 1 : 0;
  let lastError: string | undefined;
  let backoff = RATE_LIMIT_BACKOFF_MS;
  const maxRequests = options.maxRequests ?? 400;

  while (from <= options.toBlock && requests < maxRequests) {
    const to = Math.min(from + chunk, options.toBlock);

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [
        {
          address: factory.factoryAddress,
          topics: [factory.eventTopic0],
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
        },
      ],
    });

    requests += 1;
    let parsed: z.infer<typeof rpcSchema> | undefined;
    try {
      const response = await fetchImpl(options.rpcUrl, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
      // An HTTP-level rate limit does not always carry a JSON-RPC error body.
      // Reading it as a parse failure would shrink the window instead of
      // backing off — turning throttling into permanent coverage gaps.
      if (response.status === 429 || response.status === 503) {
        parsed = { error: { message: `http ${response.status} rate limited` } };
      } else {
        parsed = rpcSchema.parse(await response.json());
      }
    } catch (cause) {
      parsed = {
        error: { message: cause instanceof Error ? cause.message : 'request failed' },
      };
    }

    const error = parsed.error?.message;
    if (error) {
      lastError = error;
      // Timeouts and aborts mean "too much data", so they shrink the window.
      // Everything else that is not clearly a dense range is backed off first.
      const rateLimited = /too many|429|503|rate limit|rate limited/i.test(error);
      if (rateLimited) {
        rateLimitHits += 1;
        // Too many refusals in one run is the provider's answer: stop here
        // (resumable from `lastIndexedBlock`) rather than wait out the hour.
        if (rateLimitHits > MAX_RATE_LIMIT_HITS) break;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, RATE_LIMIT_BACKOFF_MAX_MS);
        continue;
      }
      // A timeout means the window was too dense, not that it was empty.
      if (chunk > MIN_CHUNK) {
        chunk = Math.floor(chunk / 2);
        continue;
      }
      unresolvedWindows.push({ from, to });
      from = to + 1;
      lastIndexedBlock = to;
      chunk = MIN_CHUNK * 4;
      continue;
    }

    for (const log of parsed.result ?? []) {
      const topic =
        factory.tokenTopicIndex === 'data'
          ? dataWord(log.data, factory.tokenDataWord)
          : log.topics[factory.tokenTopicIndex];
      if (!topic) continue;
      const contractAddress = ADDRESS_FROM_TOPIC(topic);
      if (!/^0x[a-f0-9]{40}$/.test(contractAddress)) continue;
      if (contractAddress === '0x0000000000000000000000000000000000000000') continue;

      launches.set(contractAddress, {
        sourceId: factory.id,
        chainId: factory.chainId,
        contractAddress,
        blockNumber: Number.parseInt(log.blockNumber, 16),
        txHash: log.transactionHash,
        factoryAddress: factory.factoryAddress.toLowerCase(),
        ...(factory.version ? { version: factory.version } : {}),
        ...eventStringsOf(factory, log.data),
      });
    }

    lastIndexedBlock = to;
    from = to + 1;
    options.onProgress?.(to, launches.size);
    // Grow back once a window succeeds, so a single dense patch does not pin
    // the whole scan at the minimum chunk size; and the provider answered, so
    // the next refusal starts the back-off from the bottom again.
    if (chunk < MAX_CHUNK) chunk = Math.min(chunk * 2, MAX_CHUNK);
    backoff = RATE_LIMIT_BACKOFF_MS;
    await sleep(150);
  }

  return {
    launches: [...launches.values()],
    lastIndexedBlock,
    requests,
    rateLimitHits,
    unresolvedWindows,
    truncated: from <= options.toBlock,
    ...(lastError ? { lastError } : {}),
  };
}
