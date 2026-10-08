import { z } from 'zod';

import { chainCheckedFallbackUrl } from '../http/rpc-failover';

import type { SourceContext } from '../adapter';
import type { LaunchFactoryConfig } from './registry';

/**
 * What the scanner needs to read one contract's creation events: a launch
 * factory, or a DEX factory whose event names two tokens (2026-09-30).
 */
export type ScannableFactory = Pick<
  LaunchFactoryConfig,
  'id' | 'chainId' | 'factoryAddress' | 'eventTopic0' | 'tokenTopicIndex' | 'tokenDataWord' | 'eventStrings' | 'version'
> & {
  /**
   * Every indexed topic that carries a token (a DEX pool pairs two). When
   * set it replaces `tokenTopicIndex`.
   */
  pairTokenTopics?: readonly (1 | 2 | 3)[];
  /** Lowercase addresses never recorded as a launch (a pool's quote asset). */
  skipTokens?: readonly string[];
  /**
   * The data word that holds a Uniswap v4 pool's hook (2026-10-01): set only
   * on the PoolManager's `Initialize`, where it is word 2 (fee, tickSpacing,
   * hooks, sqrtPriceX96, tick). When set, every log in a window read — a
   * pool between two quote assets included — is also returned as a
   * `V4PoolInit`, from the same answer: no extra request.
   */
  hookDataWord?: number;
  /**
   * Where a launch protocol's creation event names the contracts that may be
   * a v4 hook (2026-10-01): Doppler's Airlock `Create(address asset, address
   * indexed numeraire, address initializer, address poolOrHook)` — asset word
   * 0, initializer word 1, poolOrHook word 2.
   */
  launchHook?: { protocol: string; assetWord: number; initializerWord: number; poolOrHookWord: number };
};

/**
 * One Uniswap v4 `Initialize` log (2026-10-01): the pool id, both currencies
 * (the zero address is native ETH) and the hook (the zero address when the
 * pool has none). Returned for every log, so a quote-only pool's hook is not
 * lost because its currencies are not launches.
 */
export type V4PoolInit = {
  poolId: string;
  currency0: string;
  currency1: string;
  hook: string;
  blockNumber: number;
  txHash: string;
  /** Null when the RPC did not say. */
  logIndex: number | null;
};

/**
 * A contract a launch protocol's own event names as possibly its v4 hook
 * (2026-10-01). Only a claim: HEY marks it only on a hook it has already read
 * in an `Initialize` log, so a v3 pool or a token named in the same slot is
 * never taken for a hook.
 */
export type LaunchHookClaim = {
  protocol: string;
  hook: string;
  asset: string;
  blockNumber: number;
  txHash: string;
};

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
  /** Every v4 `Initialize` read, when the factory has a `hookDataWord`; otherwise empty. */
  poolInits: V4PoolInit[];
  /** Hook claims from a launch protocol's event, when the factory has a `launchHook`; otherwise empty. */
  launchHookClaims: LaunchHookClaim[];
  /** Last block fully covered — the next run resumes from here + 1. */
  lastIndexedBlock: number;
  requests: number;
  rateLimitHits: number;
  /** Windows abandoned after shrinking to the floor; coverage gaps, reported. */
  unresolvedWindows: { from: number; to: number }[];
  /** Last provider error, so a degraded scan can explain itself. */
  lastError?: string;
  /** True when the scan stopped before reaching `toBlock`, for whatever reason. */
  truncated: boolean;
  /**
   * Why it stopped short, when it did (2026-09-27): the request budget ran
   * out (`request_cap`), the provider kept refusing (`rate_limited`), or it
   * kept failing (`provider_error`). In every case `lastIndexedBlock` is the
   * last block actually read, so the next run resumes there.
   */
  stopReason?: 'request_cap' | 'rate_limited' | 'provider_error';
  /** Failed requests that were not rate limits (gateway errors, resets, malformed answers). */
  errors: number;
};

const logSchema = z.object({
  address: z.string(),
  topics: z.array(z.string()),
  data: z.string().optional(),
  blockNumber: z.string(),
  transactionHash: z.string(),
  logIndex: z.string().optional(),
});

/** The strings a registry entry says the event carries, decoded from one log. */
function eventStringsOf(
  factory: ScannableFactory,
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

/**
 * What a failed `eth_getLogs` means (2026-09-27).
 *
 * Only an answer that says the range was too much — a timeout, a result or
 * response ceiling, a range limit — is a reason to ask for a smaller window.
 * Everything else (a 502 page, a reset connection, a body that is not
 * JSON-RPC, an answer with no result at all) is the provider failing, which
 * says nothing about the blocks. Reading those as "too dense" is what lost
 * 2026-09-25 17:05–18:07 UTC: a brief outage halved every factory's window
 * to the floor in a dozen back-to-back requests and stepped over it.
 */
export function classifyLogsError(message: string): 'rate_limited' | 'dense' | 'transient' {
  if (/too many requests|429|503|rate limit|rate limited/i.test(message)) return 'rate_limited';
  if (/timeout|timed out|aborted|more than \d+ results|too many results|results? (set )?(limit|size)|response (is )?too (large|big)|response size|exceed|block range|range (is )?too (large|wide)|query returned/i.test(message)) {
    return 'dense';
  }
  return 'transient';
}

/** One 32-byte data word as a `0x…` hex string, when the data has it; an address sits left-padded. */
const dataWord = (data: string | undefined, word: number | undefined): string | undefined => {
  if (!data || word === undefined) return undefined;
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  const slot = hex.slice(word * 64, word * 64 + 64);
  if (slot.length !== 64 || !/^0{24}[0-9a-fA-F]{40}$/.test(slot)) return undefined;
  return `0x${slot}`;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS_FROM_TOPIC = (topic: string): string => `0x${topic.slice(-40)}`.toLowerCase();
const BYTES32 = /^0x[0-9a-f]{64}$/;

/** The address a left-padded data word holds, lower-cased; undefined when the word is not one. */
export const dataWordAddress = (data: string | undefined, word: number): string | undefined => {
  const slot = dataWord(data, word);
  return slot ? `0x${slot.slice(-40)}`.toLowerCase() : undefined;
};

/** A v4 `Initialize` log as a pool init, or undefined when the log is not shaped like one. */
export function decodeV4PoolInit(
  log: { topics: string[]; data?: string | undefined; blockNumber: string; transactionHash: string; logIndex?: string | undefined },
  hookDataWord: number,
): V4PoolInit | undefined {
  const poolId = log.topics[1]?.toLowerCase();
  const currency0 = log.topics[2];
  const currency1 = log.topics[3];
  const hook = dataWordAddress(log.data, hookDataWord);
  if (!poolId || !BYTES32.test(poolId) || !currency0 || !currency1 || !hook) return undefined;
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(currency0) || !/^0x0{24}[0-9a-fA-F]{40}$/.test(currency1)) return undefined;
  const blockNumber = Number.parseInt(log.blockNumber, 16);
  const logIndex = log.logIndex === undefined ? null : Number.parseInt(log.logIndex, 16);
  if (!Number.isSafeInteger(blockNumber)) return undefined;
  return {
    poolId,
    currency0: ADDRESS_FROM_TOPIC(currency0),
    currency1: ADDRESS_FROM_TOPIC(currency1),
    hook,
    blockNumber,
    txHash: log.transactionHash.toLowerCase(),
    logIndex: logIndex !== null && Number.isSafeInteger(logIndex) ? logIndex : null,
  };
}

/**
 * The hook a launch protocol's creation event names, if any (2026-10-01).
 *
 * Doppler's Airlock emits `Create(asset, numeraire, initializer, poolOrHook)`
 * where `poolOrHook` is whatever the initializer returned: a v4 hook for the
 * dynamic-auction initializer, a v3 pool for the v3 one, and the asset itself
 * for the multicurve initializer — which is then its own pools' hook. Read on
 * Robinhood Chain 2026-10-01: every one of 2,386 sampled Creates (ten 100k-block
 * windows from block 740,000 to 70.1M) has poolOrHook equal to the asset and
 * the initializer as the hook of the `Initialize` in the same transaction. So
 * the claim is `poolOrHook` when it is neither zero nor the asset, else the
 * initializer; HEY marks it only on a contract it has seen as a hook.
 */
export function decodeLaunchHookClaim(
  log: { data?: string | undefined; blockNumber: string; transactionHash: string },
  launchHook: NonNullable<ScannableFactory['launchHook']>,
): LaunchHookClaim | undefined {
  const asset = dataWordAddress(log.data, launchHook.assetWord);
  const initializer = dataWordAddress(log.data, launchHook.initializerWord);
  const poolOrHook = dataWordAddress(log.data, launchHook.poolOrHookWord);
  if (!asset || !initializer || !poolOrHook) return undefined;
  const hook = poolOrHook !== ZERO_ADDRESS && poolOrHook !== asset ? poolOrHook : initializer;
  if (hook === ZERO_ADDRESS) return undefined;
  const blockNumber = Number.parseInt(log.blockNumber, 16);
  if (!Number.isSafeInteger(blockNumber)) return undefined;
  return { protocol: launchHook.protocol, hook, asset, blockNumber, txHash: log.transactionHash.toLowerCase() };
}

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
/**
 * A provider failure that is not a rate limit waits before the same window is
 * asked again, and after this many in one scan the scan stops where it last
 * read (2026-09-27). Four attempts over about seven seconds ride out a blip;
 * a longer outage costs one run's progress, never a window.
 */
export const TRANSIENT_ERROR_BACKOFF_MS = 1_000;
export const MAX_TRANSIENT_ERRORS = 4;

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
  factory: ScannableFactory,
  options: ScanOptions,
  ctx: SourceContext,
): Promise<ScanResult> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const launches = new Map<string, FactoryLaunch>();
  const poolInits: V4PoolInit[] = [];
  const launchHookClaims: LaunchHookClaim[] = [];
  const unresolvedWindows: { from: number; to: number }[] = [];

  let from = options.fromBlock;
  let chunk = MAX_CHUNK;
  let requests = 0;
  let rateLimitHits = 0;
  let lastIndexedBlock = options.fromBlock > 0 ? options.fromBlock - 1 : 0;
  let lastError: string | undefined;
  let backoff = RATE_LIMIT_BACKOFF_MS;
  let errors = 0;
  let stopReason: ScanResult['stopReason'];
  const maxRequests = options.maxRequests ?? 400;
  const skip = new Set((factory.skipTokens ?? []).map((address) => address.toLowerCase()));

  while (from <= options.toBlock) {
    if (requests >= maxRequests) {
      stopReason = 'request_cap';
      break;
    }
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
      const post = (url: string) =>
        fetchImpl(url, {
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(ctx.timeoutMs),
        });
      let response: Response;
      try {
        response = await post(options.rpcUrl);
      } catch (cause) {
        // A dropped connection or a timeout is a refusal too: the fallback node is asked once (2026-10-09).
        const fallbackUrl = await chainCheckedFallbackUrl(options.rpcUrl, ctx);
        if (!fallbackUrl) throw cause;
        requests += 1;
        response = await post(fallbackUrl);
      }
      /*
       * The public node refuses the launch scans in bursts (a Cloudflare 403 or a 429/5xx: 837 of 3,781
       * log reads on 2026-10-08), and this scanner posts with its own fetch, so it never reached the
       * fallback node every other chain read already fails over to (2026-10-09, overnight audit C5).
       * Asked once more of the chain-checked fallback, exactly as it was.
       */
      if (response.status === 403 || response.status === 429 || response.status >= 500) {
        const fallbackUrl = await chainCheckedFallbackUrl(options.rpcUrl, ctx);
        if (fallbackUrl) {
          requests += 1;
          response = await post(fallbackUrl);
        }
      }
      // An HTTP-level rate limit does not always carry a JSON-RPC error body.
      // Reading it as a parse failure would shrink the window instead of
      // backing off — turning throttling into permanent coverage gaps.
      if (response.status === 429 || response.status === 503) {
        parsed = { error: { message: `http ${response.status} rate limited` } };
      } else if (!response.ok) {
        // A gateway page is not JSON-RPC; its status is the whole answer.
        parsed = { error: { message: `http ${response.status}` } };
      } else {
        parsed = rpcSchema.parse(await response.json());
        // An envelope with neither is not "no logs here" (2026-09-27).
        if (!parsed.result && !parsed.error) parsed = { error: { message: 'answer carried neither a result nor an error' } };
      }
    } catch (cause) {
      parsed = {
        error: { message: cause instanceof Error ? cause.message : 'request failed' },
      };
    }

    const error = parsed.error?.message;
    if (error) {
      lastError = error;
      const kind = classifyLogsError(error);
      if (kind === 'rate_limited') {
        rateLimitHits += 1;
        // Too many refusals in one run is the provider's answer: stop here
        // (resumable from `lastIndexedBlock`) rather than wait out the hour.
        if (rateLimitHits > MAX_RATE_LIMIT_HITS) {
          stopReason = 'rate_limited';
          break;
        }
        await sleep(backoff);
        backoff = Math.min(backoff * 2, RATE_LIMIT_BACKOFF_MAX_MS);
        continue;
      }
      if (kind === 'transient') {
        // The provider failed; the window is as it was. Wait, ask again, and
        // after a few failures stop where the last read ended.
        errors += 1;
        if (errors >= MAX_TRANSIENT_ERRORS) {
          stopReason = 'provider_error';
          break;
        }
        await sleep(TRANSIENT_ERROR_BACKOFF_MS * 2 ** (errors - 1));
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
      // Every log of a window read, before any token filter: a quote-only pool still names its hook.
      if (factory.hookDataWord !== undefined) {
        const init = decodeV4PoolInit(log, factory.hookDataWord);
        if (init) poolInits.push(init);
      }
      if (factory.launchHook) {
        const claim = decodeLaunchHookClaim(log, factory.launchHook);
        if (claim) launchHookClaims.push(claim);
      }
      const topics = factory.pairTokenTopics
        ? factory.pairTokenTopics.map((index) => log.topics[index])
        : [factory.tokenTopicIndex === 'data' ? dataWord(log.data, factory.tokenDataWord) : log.topics[factory.tokenTopicIndex]];
      for (const topic of topics) {
        if (!topic) continue;
        const contractAddress = ADDRESS_FROM_TOPIC(topic);
        if (!/^0x[a-f0-9]{40}$/.test(contractAddress)) continue;
        if (contractAddress === '0x0000000000000000000000000000000000000000') continue;
        if (skip.has(contractAddress)) continue;
        // The first sighting in the window is the one kept: a token's earliest pool.
        if (factory.pairTokenTopics && launches.has(contractAddress)) continue;

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
    poolInits,
    launchHookClaims,
    lastIndexedBlock,
    requests,
    rateLimitHits,
    unresolvedWindows,
    truncated: from <= options.toBlock,
    ...(from <= options.toBlock && stopReason ? { stopReason } : {}),
    errors,
    ...(lastError ? { lastError } : {}),
  };
}
