import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * One storage-slot read (2026-09-08).
 *
 * A proxy that follows EIP-1967 keeps its implementation address in a fixed
 * slot. Reading that slot now and again is how HEY notices that a live
 * contract was upgraded — a real ship for projects that build on-chain and
 * publish no repository. One `eth_getStorageAt` per contract, no logs, no
 * history: HEY still does not index the chain.
 */
export const EIP1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const EIP1967_BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
/**
 * `implementation()` (2026-09-26). A beacon proxy keeps its beacon in the
 * EIP-1967 beacon slot, and the beacon — a contract — answers this call with
 * the implementation every proxy behind it runs. Reading the implementation
 * slot alone called five published beacon-proxy tokens plain (M4 G1).
 */
export const IMPLEMENTATION_CALL = '0x5c60da1b';

/**
 * One 32-byte word from a contract: a storage slot (`slot`) or the return of
 * a no-argument view call (`call`, the four-byte selector). Exactly one.
 */
export type RpcStorageInput = {
  rpcUrl: string;
  address: string;
  slot?: string;
  call?: string;
};

export type StorageRead = {
  address: string;
  /** The slot read, or the selector called. */
  slot: string;
  /** The raw 32-byte word, `0x` + 64 hex digits. */
  value: string;
  /** The word read as an address, when it is one and not zero. */
  addressValue?: string;
};

const rpcEnvelopeSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.number(), z.string()]).nullish(),
  result: z.string().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

const CACHE_TTL_SECONDS = 3600;

export function createRpcStorageAdapter(): SourceAdapter<RpcStorageInput, StorageRead> {
  return {
    name: 'rpc-storage',

    canHandle(input) {
      const one = (input.slot === undefined) !== (input.call === undefined);
      return (
        one &&
        Boolean(input.rpcUrl) &&
        /^0x[a-fA-F0-9]{40}$/.test(input.address) &&
        (input.slot === undefined || /^0x[a-fA-F0-9]{1,64}$/.test(input.slot)) &&
        (input.call === undefined || /^0x[a-fA-F0-9]{8}$/.test(input.call))
      );
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<StorageRead>> {
      const slot = input.call ?? input.slot ?? '0x0';
      const body = JSON.stringify(
        input.call
          ? { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: input.address, data: input.call }, 'latest'] }
          : { jsonrpc: '2.0', id: 1, method: 'eth_getStorageAt', params: [input.address, slot, 'latest'] },
      );

      return performSourceFetch(
        ctx,
        { url: input.rpcUrl, method: 'POST', body, headers: { 'content-type': 'application/json' }, conditional: false },
        {
          schema: rpcEnvelopeSchema.superRefine((value, context) => {
            if (value.error) {
              context.addIssue({ code: z.ZodIssueCode.custom, message: `rpc error: ${value.error.message}` });
            } else if (value.result === undefined) {
              context.addIssue({ code: z.ZodIssueCode.custom, message: 'missing rpc result' });
            }
          }),
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): StorageRead => {
            const hex = (raw.result ?? '0x').replace(/^0x/, '').toLowerCase().padStart(64, '0');
            const value = `0x${hex}`;
            const tail = hex.slice(24);
            const isAddress = /^0{24}[0-9a-f]{40}$/.test(hex) && /[1-9a-f]/.test(tail);
            return { address: input.address, slot, value, ...(isAddress ? { addressValue: `0x${tail}` } : {}) };
          },
        },
      );
    },
  };
}
