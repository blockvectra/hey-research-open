import { z } from 'zod';

import { errorResult, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { decodeAggregate3, encodeAggregate3, MULTICALL3_ADDRESS, type Call3 } from './multicall';

/**
 * A Pons V2 launch's own record, a hundred launches to a request (2026-10-30, founder "ok buat simpan fee recipient
 * per launch tu").
 *
 * The factory keeps one record per launch, `getLaunchedToken(address)` (selector `0x3cf28b5a`, confirmed on chain
 * 4663 on 2026-10-29), a tuple of fifteen static words: token, curve, deployer, creatorFeeRecipient, pairToken,
 * graduationThreshold, poolFee, tickSpacing, creatorTaxBps, buybackEnabled, phase, sweptQuote, sweptTokens, sweptAt,
 * exists. Only four are read here: the token (it must be the one asked), the launcher the factory records
 * (`deployer`), the creator-fee recipient, and `exists`. The fee recipient is in no launch event (its three indexed
 * fields are the token, the curve and the deployer), so the record is the only place it is.
 *
 * Batched through Multicall3's `aggregate3` (`multicall.ts`), each call allowed to fail on its own: one request names
 * up to a hundred launches of one factory, metered per request. A provider error is an error for the whole batch and
 * nothing is read from it; a call that failed, or a record that does not decode, is that launch's `unread`, never a
 * guess. Saved answer: `fixtures/rpc-pons-launch-records.json`.
 */
export const PONS_GET_LAUNCHED_TOKEN_SELECTOR = '0x3cf28b5a';
export const PONS_LAUNCH_RECORD_BATCH_SIZE = 100;

/** Words in the record the factory returns. */
const RECORD_WORDS = 15;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export type PonsLaunchRecordBatchInput = { rpcUrl: string; factory: string; tokens: readonly string[] };

/** One entry per launch asked, in order. */
export type PonsLaunchRecord =
  | { token: string; read: true; exists: true; launcher: string; feeRecipient: string }
  | { token: string; read: true; exists: false }
  | { token: string; read: false; reason: string };

/** The `getLaunchedToken(token)` call data. */
export const ponsGetLaunchedTokenCall = (token: string): string => `${PONS_GET_LAUNCHED_TOKEN_SELECTOR}${token.slice(2).toLowerCase().padStart(64, '0')}`;

const addressWord = (word: string): string | undefined => (/^0{24}[0-9a-fA-F]{40}$/.test(word) ? `0x${word.slice(24).toLowerCase()}` : undefined);
const boolWord = (word: string): boolean | undefined => (/^0{63}[01]$/.test(word) ? word.endsWith('1') : undefined);

/**
 * Decode one record for `token`. Undefined when it is not exactly the factory's tuple: the wrong length, an address
 * word that is not an address, a flag that is not 0 or 1, or a record for another token.
 */
export function decodePonsLaunchRecord(token: string, returnData: string): { exists: true; launcher: string; feeRecipient: string } | { exists: false } | undefined {
  const data = returnData.startsWith('0x') ? returnData.slice(2) : returnData;
  if (data.length !== RECORD_WORDS * 64 || !/^[0-9a-fA-F]*$/.test(data)) return undefined;
  const word = (index: number) => data.slice(index * 64, (index + 1) * 64);
  const exists = boolWord(word(14));
  if (exists === undefined) return undefined;
  if (!exists) return { exists: false };
  const recordToken = addressWord(word(0));
  const launcher = addressWord(word(2));
  const feeRecipient = addressWord(word(3));
  if (!recordToken || !launcher || !feeRecipient || recordToken !== token.toLowerCase()) return undefined;
  return { exists: true, launcher, feeRecipient };
}

const envelopeSchema = z.object({
  result: z.string().optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

export function createPonsLaunchRecordBatchAdapter(): SourceAdapter<PonsLaunchRecordBatchInput, PonsLaunchRecord[]> {
  return {
    name: 'pons-launch-records',

    canHandle(input) {
      return (
        Boolean(input.rpcUrl) &&
        ADDRESS.test(input.factory) &&
        input.tokens.length > 0 &&
        input.tokens.length <= PONS_LAUNCH_RECORD_BATCH_SIZE &&
        input.tokens.every((token) => ADDRESS.test(token))
      );
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<PonsLaunchRecord[]>> {
      if (!this.canHandle(input)) return errorResult(ctx, 'INVALID_RESPONSE', 'a batch needs a factory and one to a hundred well-formed token addresses; nothing was asked');
      const calls: Call3[] = input.tokens.map((token) => ({ target: input.factory, allowFailure: true, callData: ponsGetLaunchedTokenCall(token) }));
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MULTICALL3_ADDRESS, data: encodeAggregate3(calls) }, 'latest'] });

      return performSourceFetch(
        ctx,
        { url: input.rpcUrl, method: 'POST', body, headers: { 'content-type': 'application/json' }, conditional: false },
        {
          schema: envelopeSchema.superRefine((value, context) => {
            // A provider error says nothing about a hundred launches.
            if (value.error) context.addIssue({ code: z.ZodIssueCode.custom, message: `rpc error: ${value.error.message}` });
            else if (!value.result || decodeAggregate3(value.result)?.length !== calls.length) {
              context.addIssue({ code: z.ZodIssueCode.custom, message: value.result === '0x' ? 'no multicall contract answered' : 'aggregate3 answer did not decode' });
            }
          }),
          parse: (raw) => JSON.parse(raw) as unknown,
          // Read once and stored; a retry within the hour may reuse the answer.
          cacheTtlSeconds: 3_600,
          normalize: (raw): PonsLaunchRecord[] => {
            const results = decodeAggregate3(raw.result ?? '') ?? [];
            return input.tokens.map((asked, index): PonsLaunchRecord => {
              const token = asked.toLowerCase();
              const entry = results[index];
              if (!entry?.success) return { token, read: false, reason: 'the factory call failed' };
              const record = decodePonsLaunchRecord(token, entry.returnData);
              if (!record) return { token, read: false, reason: 'the launch record did not decode' };
              return record.exists ? { token, read: true, exists: true, launcher: record.launcher, feeRecipient: record.feeRecipient } : { token, read: true, exists: false };
            });
          },
        },
      );
    },
  };
}
