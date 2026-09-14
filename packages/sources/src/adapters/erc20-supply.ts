import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * A token's total supply, read from the token itself (2026-09-14).
 *
 * Written because the distribution sweep had no denominator and derived one
 * from the market reading: fully diluted valuation divided by price. That is
 * wrong on this chain, and wrong in a direction that flatters nobody. DEX
 * Screener's `fdv` here is supply *net of the burn address*, so on a token
 * that burned a quarter of its supply the derived denominator was a quarter
 * too small and every share of supply HEY published was a quarter too large.
 * Twenty-eight token-days summed to more than 100% of supply; MAD reached
 * 124%. The gap matched the burn balance to the token.
 *
 * `totalSupply()` and `decimals()` are two `eth_call`s in one batched request,
 * asked of the token contract, and they are the ground truth the balances are
 * already denominated in. HEY stores decimals for fewer than a third of its
 * tokens, so both are read together rather than trusting the cached column.
 *
 * Counts and a denominator. No address, no account, no balance.
 */
export type Erc20SupplyInput = {
  rpcUrl: string;
  /** The token contract. */
  address: string;
};

export type Erc20Supply = {
  address: string;
  /** Whole tokens, decimals applied — the unit balances arrive in. */
  totalSupply: number;
  decimals: number;
};

/** `keccak(signature)[0:4]`. */
const SELECTORS = { totalSupply: '0x18160ddd', decimals: '0x313ce567' } as const;
/** Supply changes slowly and a wrong denominator is expensive; an hour is generous enough. */
const CACHE_TTL_SECONDS = 3600;

const envelopeSchema = z.object({
  id: z.union([z.number(), z.string()]).nullish(),
  result: z.string().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});
const batchSchema = z.array(envelopeSchema);

const resultFor = (rows: readonly z.infer<typeof envelopeSchema>[], id: number): string | undefined =>
  rows.find((row) => Number(row.id) === id)?.result;

/**
 * A uint256 return word as a whole-token number. `Number` loses precision
 * above 2^53, which for an 18-decimal token is a supply of 9 quintillion
 * whole tokens; nothing on this chain is close, and the division happens in
 * bigint before the conversion so the whole part is exact.
 */
export function wholeTokens(raw: string, decimals: number): number | undefined {
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (hex.length === 0 || !/^[0-9a-fA-F]+$/.test(hex)) return undefined;
  const units = BigInt(`0x${hex}`);
  if (units <= 0n) return undefined;
  const scale = 10n ** BigInt(decimals);
  const whole = Number(units / scale);
  const remainder = Number(units % scale) / Number(scale);
  return whole + remainder;
}

/**
 * Addresses per batched request (2026-09-14).
 *
 * Each address costs two `eth_call`s and the public node counts the calls
 * inside a batch, not the batches: fifty addresses (a hundred calls) is
 * answered with a 429, twenty-five (fifty calls) in half a second. Twenty
 * leaves margin for the other jobs sharing the node, and turns a sweep of the
 * ten thousand tokens that have a reader from four hours into ten minutes.
 */
export const ERC20_SUPPLY_BATCH = 20;

export type Erc20SupplyBatchInput = {
  rpcUrl: string;
  /** At most `ERC20_SUPPLY_BATCH` token contracts; the caller chunks. */
  addresses: readonly string[];
};

/**
 * The same two calls for several tokens at once. A contract that answers
 * nothing usable is absent from the result rather than guessed at, so the
 * caller can tell which ones it asked about and never heard back.
 */
export function createErc20SupplyBatchAdapter(): SourceAdapter<Erc20SupplyBatchInput, Erc20Supply[]> {
  return {
    name: 'erc20-supply',

    canHandle(input) {
      return (
        /^https?:\/\//.test(input.rpcUrl) &&
        input.addresses.length > 0 &&
        input.addresses.length <= ERC20_SUPPLY_BATCH &&
        input.addresses.every((address) => /^0x[a-fA-F0-9]{40}$/.test(address))
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<Erc20Supply[]>> {
      const addresses = input.addresses.map((address) => address.toLowerCase());
      const body = JSON.stringify(
        addresses.flatMap((address, index) => [
          { jsonrpc: '2.0', id: 2 * index + 1, method: 'eth_call', params: [{ to: address, data: SELECTORS.totalSupply }, 'latest'] },
          { jsonrpc: '2.0', id: 2 * index + 2, method: 'eth_call', params: [{ to: address, data: SELECTORS.decimals }, 'latest'] },
        ]),
      );

      return performSourceFetch(
        ctx,
        { url: input.rpcUrl, method: 'POST', body, headers: { 'content-type': 'application/json' }, conditional: false },
        {
          schema: batchSchema,
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (rows): Erc20Supply[] => {
            const out: Erc20Supply[] = [];
            addresses.forEach((address, index) => {
              const supplyWord = resultFor(rows, 2 * index + 1);
              const decimalsWord = resultFor(rows, 2 * index + 2);
              if (supplyWord === undefined || decimalsWord === undefined) return;
              let decimals: number;
              try {
                decimals = Number(BigInt(decimalsWord));
              } catch {
                return;
              }
              if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return;
              const totalSupply = wholeTokens(supplyWord, decimals);
              if (totalSupply === undefined) return;
              out.push({ address, totalSupply, decimals });
            });
            return out;
          },
        },
      );
    },
  };
}

export function createErc20SupplyAdapter(): SourceAdapter<Erc20SupplyInput, Erc20Supply> {
  return {
    name: 'erc20-supply',

    canHandle(input) {
      return /^https?:\/\//.test(input.rpcUrl) && /^0x[a-fA-F0-9]{40}$/.test(input.address);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<Erc20Supply>> {
      const body = JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: input.address, data: SELECTORS.totalSupply }, 'latest'] },
        { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: input.address, data: SELECTORS.decimals }, 'latest'] },
      ]);

      return performSourceFetch(
        ctx,
        { url: input.rpcUrl, method: 'POST', body, headers: { 'content-type': 'application/json' }, conditional: false },
        {
          schema: batchSchema.superRefine((rows, context) => {
            const failed = rows.find((row) => row.error);
            if (failed?.error) context.addIssue({ code: z.ZodIssueCode.custom, message: `rpc error: ${failed.error.message}` });
            else if (resultFor(rows, 1) === undefined || resultFor(rows, 2) === undefined)
              context.addIssue({ code: z.ZodIssueCode.custom, message: 'missing rpc result' });
          }),
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (rows): Erc20Supply => {
            const rawDecimals = Number(BigInt(resultFor(rows, 2) ?? '0x0'));
            // A token answering something absurd is refused, not clamped: a
            // guessed denominator is exactly the failure this file exists for.
            if (!Number.isInteger(rawDecimals) || rawDecimals < 0 || rawDecimals > 36) throw new Error(`implausible decimals: ${rawDecimals}`);
            const totalSupply = wholeTokens(resultFor(rows, 1) ?? '0x', rawDecimals);
            if (totalSupply === undefined) throw new Error('no total supply');
            return { address: input.address.toLowerCase(), totalSupply, decimals: rawDecimals };
          },
        },
      );
    },
  };
}
