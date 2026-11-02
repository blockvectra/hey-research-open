import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * Validation requests that name HEY's validator in the ERC-8004 Validation Registry (2026-11-02, founder approval: HEY
 * answers as a validator on Base and Robinhood Chain, only for a claim it can restate from its own counted ships).
 *
 * The registry is the canonical `ValidationRegistryUpgradeable` (erc-8004/erc-8004-contracts, `getVersion()` "2.0.0")
 * behind the vanity proxy `0x8004Cc84…AB58` — the address the reference repository's `scripts/addresses.ts` names as
 * `MAINNET_ADDRESSES.validationRegistry` (the README's address table lists only the Identity and Reputation registries;
 * it marks the Validation Registry "still under active update"). Read on chain 2026-11-02, on Robinhood Chain (4663),
 * Base (8453) and Ethereum (1): code at the address, the EIP-1967 implementation (`0x1b325b40…c79a` on Robinhood Chain,
 * `0xdb31f5d9…7f99` on Base and Ethereum: the same 5,876-byte code but for the implementation's own address and the
 * compiler's metadata hash), `getVersion()` "2.0.0", `getIdentityRegistry()` naming `0x8004A169…a432`, the registry
 * HEY's agent is registered in, and the four selectors and two event topics below inside the implementation's code.
 *
 * One event is read:
 *
 *   `ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI,
 *   bytes32 indexed requestHash)` — one per `validationRequest`, which only an agent's owner or operator may call.
 *
 * Every request is filtered to one validator (topic 1): HEY asks for the requests that name its own validator address,
 * never anyone else's. What survives the adapter is, per request, the block and log index it sat at, the request hash
 * and the request URI as the request carried it (or null, with its byte length, when it is too long to be a HEY claim
 * or is not UTF-8). The agent id (topic 2), the transaction and anything about who asked are read past in memory and
 * never leave this adapter. The registry does not check that the hash is the URI's; HEY's claim parser does.
 *
 * A repeated log (same block and log index) counts once; a log the node marks `removed` is not counted; a log from
 * another contract, of another event or for another validator means the answer is not the one asked for, and the whole
 * window is refused rather than half-read.
 */
export const ERC8004_VALIDATION_REGISTRY_ADDRESS = '0x8004cc8439f36fd5f9f049d9ff86523df6daab58' as const;

/** `keccak256("ValidationRequest(address,uint256,string,bytes32)")`. */
export const ERC8004_VALIDATION_REQUEST_TOPIC = '0x530436c3634a98e1e626b0898be2f1e9980cc1bd2a78c07a0aba52d0a48a5059' as const;
/** `keccak256("ValidationResponse(address,uint256,bytes32,uint8,string,bytes32,string)")`. */
export const ERC8004_VALIDATION_RESPONSE_TOPIC = '0xafddf629e874ccc3963b6a888c477bd464a6c8525024fc88759ea3b2326349ae' as const;

export const ERC8004_VALIDATION_REQUEST_EVENT =
  'ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)' as const;
export const ERC8004_VALIDATION_RESPONSE_EVENT =
  'ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)' as const;

/** The registry's functions, as the reference implementation declares them (selectors confirmed in the deployed code). */
export const ERC8004_VALIDATION_REQUEST_FUNCTION = 'validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)' as const;
export const ERC8004_VALIDATION_RESPONSE_FUNCTION = 'validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)' as const;
export const ERC8004_GET_VALIDATION_STATUS_FUNCTION =
  'getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)' as const;
/** `validationRequest` 0xaaf400c4, `validationResponse` 0x3d659a96, `getValidationStatus` 0xff2febfc. */
export const ERC8004_VALIDATION_SELECTORS = { validationRequest: '0xaaf400c4', validationResponse: '0x3d659a96', getValidationStatus: '0xff2febfc' } as const;

/**
 * The longest request URI the adapter hands on, in bytes. A HEY claim is under 200 bytes; anything longer is not one,
 * and its text never leaves the adapter (only its length does).
 */
export const ERC8004_VALIDATION_URI_READ_MAX_BYTES = 512;

export type Erc8004ValidationWindowInput = { rpcUrl: string; fromBlock: number; toBlock: number; validator: string };

/**
 * One request naming the validator asked about. `requestUri` is null when it is longer than
 * `ERC8004_VALIDATION_URI_READ_MAX_BYTES` or not UTF-8; `uriBytes` is its length either way.
 */
export type Erc8004ValidationRequestLog = { blockNumber: number; logIndex: number; requestHash: string; requestUri: string | null; uriBytes: number };

export type Erc8004ValidationWindow = { fromBlock: number; toBlock: number; requests: Erc8004ValidationRequestLog[] };

const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/;
const WORD = 64;
const ADDRESS = /^0x[0-9a-f]{40}$/;

const logSchema = z.object({
  address: z.string(),
  topics: z.array(z.string()),
  data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/),
  blockNumber: z.string().regex(HEX_QUANTITY),
  logIndex: z.string().regex(HEX_QUANTITY),
  removed: z.boolean().optional(),
});
type RequestLog = z.infer<typeof logSchema>;

const hex = (value: number): string => `0x${value.toString(16)}`;

/** The 32-byte topic an address is filtered on. */
export const validatorTopic = (validator: string): string => `0x${validator.toLowerCase().replace(/^0x/, '').padStart(WORD, '0')}`;

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Pure: the request URI from a `ValidationRequest` log's data — one ABI-encoded `string` (offset, length, bytes). Null
 * when the data is not one string. `uri` is null when the string is longer than the read limit or not UTF-8 (the
 * decoder is fatal and keeps a byte-order mark, so a URI that decodes re-encodes to exactly the bytes it came from).
 */
export function readRequestUri(data: string): { uri: string | null; bytes: number } | null {
  const body = data.slice(2);
  if (body.length < 2 * WORD || body.length % WORD !== 0) return null;
  const offset = BigInt(`0x${body.slice(0, WORD)}`);
  if (offset !== 32n) return null;
  const length = BigInt(`0x${body.slice(WORD, 2 * WORD)}`);
  const padded = Math.ceil(Number(length) / 32) * WORD;
  if (length > BigInt(body.length / 2) || body.length !== 2 * WORD + padded) return null;
  const bytes = Number(length);
  if (bytes > ERC8004_VALIDATION_URI_READ_MAX_BYTES) return { uri: null, bytes };
  const raw = Uint8Array.from(Buffer.from(body.slice(2 * WORD, 2 * WORD + bytes * 2), 'hex'));
  try {
    return { uri: utf8.decode(raw), bytes };
  } catch {
    return { uri: null, bytes };
  }
}

function answerSchema(input: Erc8004ValidationWindowInput) {
  const validator = validatorTopic(input.validator);
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
        if (
          log.address.toLowerCase() !== ERC8004_VALIDATION_REGISTRY_ADDRESS ||
          log.topics.length !== 4 ||
          log.topics[0]?.toLowerCase() !== ERC8004_VALIDATION_REQUEST_TOPIC ||
          log.topics[1]?.toLowerCase() !== validator ||
          !/^0x[0-9a-fA-F]{64}$/.test(log.topics[3] ?? '')
        ) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'a log that is not the registry’s validation request for the validator asked' });
          return;
        }
        if (log.removed !== true && readRequestUri(log.data) === null) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: 'a ValidationRequest log whose request URI cannot be read' });
          return;
        }
      }
    });
}

/** Pure: the requests in validated logs, oldest first. Nothing but the place, the hash and the URI survives. */
export function readValidationRequestLogs(logs: readonly RequestLog[]): Erc8004ValidationRequestLog[] {
  const seen = new Set<string>();
  const requests: Erc8004ValidationRequestLog[] = [];
  for (const log of logs) {
    if (log.removed === true) continue;
    const blockNumber = Number.parseInt(log.blockNumber, 16);
    const logIndex = Number.parseInt(log.logIndex, 16);
    if (!Number.isSafeInteger(blockNumber) || !Number.isSafeInteger(logIndex)) continue;
    const key = `${blockNumber}:${logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const uri = readRequestUri(log.data);
    // The schema refused an unreadable one; this keeps the pure function total.
    if (!uri) continue;
    requests.push({ blockNumber, logIndex, requestHash: log.topics[3]!.toLowerCase(), requestUri: uri.uri, uriBytes: uri.bytes });
  }
  return requests.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

export function createErc8004ValidationRequestAdapter(): SourceAdapter<Erc8004ValidationWindowInput, Erc8004ValidationWindow> {
  return {
    name: 'erc8004-validation-requests',

    canHandle(input) {
      return (
        Boolean(input.rpcUrl) &&
        ADDRESS.test(input.validator.toLowerCase()) &&
        !/^0x0{40}$/.test(input.validator) &&
        Number.isSafeInteger(input.fromBlock) &&
        input.fromBlock >= 0 &&
        Number.isSafeInteger(input.toBlock) &&
        input.toBlock >= input.fromBlock
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<Erc8004ValidationWindow>> {
      return performSourceFetch(
        ctx,
        {
          url: input.rpcUrl,
          method: 'POST' as const,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getLogs',
            params: [{ address: ERC8004_VALIDATION_REGISTRY_ADDRESS, topics: [ERC8004_VALIDATION_REQUEST_TOPIC, validatorTopic(input.validator)], fromBlock: hex(input.fromBlock), toBlock: hex(input.toBlock) }],
          }),
          headers: { 'content-type': 'application/json' },
          conditional: false as const,
        },
        {
          schema: answerSchema(input),
          parse: (raw) => JSON.parse(raw) as unknown,
          // A window is read once; the next run starts after it.
          cacheTtlSeconds: 0,
          normalize: (raw): Erc8004ValidationWindow => ({ fromBlock: input.fromBlock, toBlock: input.toBlock, requests: readValidationRequestLogs(raw.result ?? []) }),
        },
      );
    },
  };
}
