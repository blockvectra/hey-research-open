import { z } from 'zod';

import { errorResult, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';
import { decodeAbiString } from './erc20';

/**
 * ERC-20 names and tickers, a hundred tokens to a request (2026-09-27).
 *
 * The naming pass read `name()` and `symbol()` one `eth_call` each: two
 * requests a token, 150 tokens an hour, against Pons alone launching about
 * 300 an hour — so the unnamed backlog only grew (332,011 unnamed Pons
 * candidates on 2026-09-27, 11,187 of the last 72 hours' 21,480). An unnamed
 * launch cannot become a project.
 *
 * Multicall3's `aggregate3` runs many calls in one `eth_call`, each allowed
 * to fail on its own. It sits at the same address on every EVM chain and is
 * deployed on Robinhood Chain (probed with `eth_getCode` on 2026-09-27: 3,808
 * bytes). One request names up to a hundred tokens; the budget is metered per
 * request, honestly, because that is what the RPC answers.
 *
 * `allowFailure` keeps one broken token from failing the batch. A token whose
 * `name()` burns all the gas it is given can still sink the whole call; the
 * caller splits a failed batch in half and asks again.
 */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const AGGREGATE3_SELECTOR = '82ad56cb';
const SELECTORS = { name: '06fdde03', symbol: '95d89b41' } as const;

/** Tokens per request. Two calls each: 200 sub-calls, a few tens of kilobytes back. */
export const ERC20_BATCH_SIZE = 100;

export type Call3 = { target: string; allowFailure: boolean; callData: string };
export type Call3Result = { success: boolean; returnData: string };

const strip = (hex: string): string => (hex.startsWith('0x') ? hex.slice(2) : hex);
const word = (value: number | bigint): string => BigInt(value).toString(16).padStart(64, '0');

/** ABI-encode `aggregate3((address,bool,bytes)[])`. */
export function encodeAggregate3(calls: readonly Call3[]): string {
  const tuples = calls.map((call) => {
    const data = strip(call.callData);
    const length = data.length / 2;
    const padded = data.padEnd(Math.ceil(length / 32) * 64, '0');
    return strip(call.target).toLowerCase().padStart(64, '0') + word(call.allowFailure ? 1 : 0) + word(0x60) + word(length) + padded;
  });
  const offsets: string[] = [];
  let offset = calls.length * 32;
  for (const tuple of tuples) {
    offsets.push(word(offset));
    offset += tuple.length / 2;
  }
  return `0x${AGGREGATE3_SELECTOR}${word(0x20)}${word(calls.length)}${offsets.join('')}${tuples.join('')}`;
}

/**
 * Decode the `(bool,bytes)[]` that `aggregate3` returns. Every offset and
 * length is checked against the data; anything out of bounds returns
 * `undefined` rather than a partly read answer.
 */
export function decodeAggregate3(hex: string): Call3Result[] | undefined {
  const data = strip(hex);
  if (data.length === 0 || data.length % 64 !== 0 || !/^[0-9a-fA-F]*$/.test(data)) return undefined;
  const bytes = data.length / 2;
  const readWord = (at: number): number | undefined => {
    if (at < 0 || at + 32 > bytes) return undefined;
    const value = BigInt(`0x${data.slice(at * 2, at * 2 + 64)}`);
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? undefined : Number(value);
  };
  const base = readWord(0);
  if (base === undefined) return undefined;
  const count = readWord(base);
  if (count === undefined || count > 10_000) return undefined;
  const results: Call3Result[] = [];
  for (let index = 0; index < count; index += 1) {
    const relative = readWord(base + 32 + index * 32);
    if (relative === undefined) return undefined;
    const tuple = base + 32 + relative;
    const success = readWord(tuple);
    const bytesOffset = readWord(tuple + 32);
    if (success === undefined || bytesOffset === undefined) return undefined;
    const length = readWord(tuple + bytesOffset);
    if (length === undefined) return undefined;
    const start = tuple + bytesOffset + 32;
    if (start + length > bytes) return undefined;
    results.push({ success: success !== 0, returnData: `0x${data.slice(start * 2, (start + length) * 2)}` });
  }
  return results;
}

/**
 * The inverse pair, for stubs: read the calls out of `aggregate3` calldata and
 * encode an answer the way the contract would. Tests answer a batch with them;
 * nothing in the product path uses them.
 */
export function decodeAggregate3Calls(calldata: string): Call3[] | undefined {
  const data = strip(calldata);
  if (!data.startsWith(AGGREGATE3_SELECTOR)) return undefined;
  const body = data.slice(8);
  const at = (byte: number) => Number(BigInt(`0x${body.slice(byte * 2, byte * 2 + 64)}`));
  const base = at(0);
  const count = at(base);
  const calls: Call3[] = [];
  for (let index = 0; index < count; index += 1) {
    const tuple = base + 32 + at(base + 32 + index * 32);
    const target = `0x${body.slice(tuple * 2 + 24, tuple * 2 + 64)}`;
    const allowFailure = at(tuple + 32) !== 0;
    const bytesAt = tuple + at(tuple + 64);
    const length = at(bytesAt);
    calls.push({ target, allowFailure, callData: `0x${body.slice((bytesAt + 32) * 2, (bytesAt + 32 + length) * 2)}` });
  }
  return calls;
}

export function encodeAggregate3Result(results: readonly Call3Result[]): string {
  const tuples = results.map((result) => {
    const data = strip(result.returnData);
    const length = data.length / 2;
    return word(result.success ? 1 : 0) + word(0x40) + word(length) + data.padEnd(Math.ceil(length / 32) * 64, '0');
  });
  const offsets: string[] = [];
  let offset = results.length * 32;
  for (const tuple of tuples) {
    offsets.push(word(offset));
    offset += tuple.length / 2;
  }
  return `0x${word(0x20)}${word(results.length)}${offsets.join('')}${tuples.join('')}`;
}

export type Erc20BatchInput ={ rpcUrl: string; addresses: readonly string[] };
/** One entry per address asked, in order; a field is absent when the token did not answer it. */
export type Erc20BatchValue = { address: string; name?: string; symbol?: string };

const envelopeSchema = z.object({
  result: z.string().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

export function createErc20MetadataBatchAdapter(): SourceAdapter<Erc20BatchInput, Erc20BatchValue[]> {
  return {
    name: 'erc20-metadata',

    canHandle(input) {
      return Boolean(input.rpcUrl) && input.addresses.length > 0 && input.addresses.every((address) => /^0x[a-fA-F0-9]{40}$/.test(address));
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<Erc20BatchValue[]>> {
      if (!this.canHandle(input)) return errorResult(ctx, 'INVALID_RESPONSE', 'a batch needs well-formed addresses; nothing was asked');
      const calls: Call3[] = input.addresses.flatMap((address) => [
        { target: address, allowFailure: true, callData: SELECTORS.name },
        { target: address, allowFailure: true, callData: SELECTORS.symbol },
      ]);
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: MULTICALL3_ADDRESS, data: encodeAggregate3(calls) }, 'latest'],
      });

      return performSourceFetch(
        ctx,
        { url: input.rpcUrl, method: 'POST', body, headers: { 'content-type': 'application/json' }, conditional: false },
        {
          schema: envelopeSchema.superRefine((value, context) => {
            // A provider error is not evidence that a hundred tokens have no name.
            if (value.error) context.addIssue({ code: z.ZodIssueCode.custom, message: `rpc error: ${value.error.message}` });
            else if (!value.result || decodeAggregate3(value.result)?.length !== calls.length) {
              // `0x` means no contract answered at the Multicall3 address: a chain without it.
              context.addIssue({ code: z.ZodIssueCode.custom, message: value.result === '0x' ? 'no multicall contract answered' : 'aggregate3 answer did not decode' });
            }
          }),
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: 3_600,
          normalize: (raw): Erc20BatchValue[] => {
            const results = decodeAggregate3(raw.result ?? '') ?? [];
            const read = (entry: Call3Result | undefined) => (entry?.success ? decodeAbiString(entry.returnData) : undefined);
            return input.addresses.map((address, index) => ({
              address,
              ...opt('name', read(results[index * 2])),
              ...opt('symbol', read(results[index * 2 + 1])),
            }));
          },
        },
      );
    },
  };
}
