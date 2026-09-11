import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * Lightweight JSON-RPC reads (PRD V4 sections 20.1, 22.1).
 *
 * Used only to confirm evidence: does a contract exist, what block are we at.
 * HEY does not run a node and does not index chain history.
 */
export type RpcInput = {
  rpcUrl: string;
  address: string;
};

const rpcEnvelopeSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.number(), z.string()]).nullish(),
  result: z.string().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

export type ContractExistence = {
  address: string;
  /** Contract accounts return bytecode; externally-owned accounts return `0x`. */
  isContract: boolean;
  bytecodeSize: number;
};

const CACHE_TTL_SECONDS = 3600;

export function createRpcContractAdapter(): SourceAdapter<RpcInput, ContractExistence> {
  return {
    name: 'rpc-contract',

    canHandle(input) {
      return Boolean(input.rpcUrl) && /^0x[a-fA-F0-9]{40}$/.test(input.address);
    },

    fetch(input, ctx: SourceContext): Promise<SourceResult<ContractExistence>> {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [input.address, 'latest'],
      });

      return performSourceFetch(
        ctx,
        {
          url: input.rpcUrl,
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json' },
          // POST bodies are not cacheable; conditional headers would be meaningless.
          conditional: false,
        },
        {
          schema: rpcEnvelopeSchema.superRefine((value, context) => {
            if (value.error) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: `rpc error: ${value.error.message}`,
              });
            } else if (value.result === undefined) {
              context.addIssue({ code: z.ZodIssueCode.custom, message: 'missing rpc result' });
            }
          }),
          parse: (raw) => JSON.parse(raw) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw): ContractExistence => {
            const code = raw.result ?? '0x';
            const hex = code.startsWith('0x') ? code.slice(2) : code;
            return {
              address: input.address,
              isContract: hex.length > 0,
              bytecodeSize: Math.floor(hex.length / 2),
            };
          },
        },
      );
    },
  };
}
