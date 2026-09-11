import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { opt } from '../optional';

/**
 * Canonical ERC-20 metadata, read from the contract itself.
 *
 * A factory log gives an address and nothing else, so a token indexed that way
 * would be displayed as `0x14b51c...` -- accurate but useless, and it makes a
 * real launch look like a broken record. The contract already holds its name
 * and symbol; two `eth_call`s are cheaper than asking an aggregator, and the
 * answer is canonical rather than an aggregator's copy of it (PRD V4 s17).
 */
export type Erc20Input = {
  rpcUrl: string;
  address: string;
  /** `name()`, `symbol()` or `decimals()` (returned as a decimal string, e.g. `6`). */
  field: 'name' | 'symbol' | 'decimals';
};

export type Erc20Value = { address: string; field: string; value?: string };

const SELECTORS = { name: '0x06fdde03', symbol: '0x95d89b41', decimals: '0x313ce567' } as const;

const envelopeSchema = z.object({
  result: z.string().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

const CACHE_TTL_SECONDS = 86_400;

/** Printable text only: control bytes mean this was never really a string. */
const isPrintable = (value: string): boolean =>
  value.length > 0 &&
  ![...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);

/**
 * Decode a Solidity `string` return value.
 *
 * Some tokens return a fixed `bytes32` rather than a dynamic string, which is
 * why the short form is handled instead of rejected.
 */
export function decodeAbiString(hex: string): string | undefined {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length === 0) return undefined;

  const clean = (value: string): string | undefined => {
    const trimmed = value.replace(/\0+$/g, '').trim();
    return isPrintable(trimmed) ? trimmed : undefined;
  };

  if (body.length === 64) {
    // bytes32: trailing zero padding, not a length prefix.
    return clean(Buffer.from(body, 'hex').toString('utf8'));
  }

  try {
    const bytes = Buffer.from(body, 'hex');
    const length = Number(BigInt(`0x${body.slice(64, 128)}`));
    if (!Number.isFinite(length) || length <= 0 || length > 1024) return undefined;
    return clean(bytes.subarray(64, 64 + length).toString('utf8'));
  } catch {
    return undefined;
  }
}

/** Decode a Solidity `uint8` return value (one 32-byte word) as a decimal string. */
export function decodeAbiUint8(hex: string): string | undefined {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length !== 64 || !/^[0-9a-fA-F]+$/.test(body)) return undefined;
  const value = BigInt(`0x${body}`);
  return value <= 255n ? value.toString() : undefined;
}

export function createErc20MetadataAdapter(): SourceAdapter<Erc20Input, Erc20Value> {
  return {
    name: 'erc20-metadata',

    canHandle(input) {
      return Boolean(input.rpcUrl) && /^0x[a-fA-F0-9]{40}$/.test(input.address);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<Erc20Value>> {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: input.address, data: SELECTORS[input.field] }, 'latest'],
      });

      return performSourceFetch(
        ctx,
        {
          url: input.rpcUrl,
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json' },
          conditional: false,
        },
        {
          schema: envelopeSchema.superRefine((value, context) => {
            // A provider error is not evidence that the token has no name.
            if (value.error) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: `rpc error: ${value.error.message}`,
              });
            }
          }),
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): Erc20Value => ({
            address: input.address,
            field: input.field,
            ...opt('value', raw.result ? (input.field === 'decimals' ? decodeAbiUint8(raw.result) : decodeAbiString(raw.result)) : undefined),
          }),
        },
      );
    },
  };
}
