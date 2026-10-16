import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, BITQUERY_POINTS, bitqueryAnswerError, withBitqueryPoints } from './bitquery';

/**
 * Contracts HEY's watched token deployers created in the last hours
 * (2026-10-16): a trigger for the follow-up deploy path, never its source of
 * truth.
 *
 * The follow-up path reads each deployer's transaction list from the explorer
 * on a daily or weekly turn, so a counted follow-up deploy reached HEY 8.2 h
 * after its block at the median and 54 h at p90 (production, 2026-10-16). The
 * `Calls` cube answers "which of these thousand accounts created a contract
 * since then?" in one request, so the deployers that did are read at once
 * through the same explorer path; the explorer read decides everything, and
 * nothing this adapter returns is stored.
 *
 * The same cube and filter as `HeyContractCreations` (`bitquery-creations.ts`,
 * the serial-launcher count), on `realtime` rather than `combined`: an hour's
 * window needs no archive, and a realtime document is five points a cube
 * whatever it returns. Realtime keeps about four days, so a caller asking
 * further back than that gets less than the window holds — the caller clamps.
 *
 * What is read, per creation: its block and time, the creating transaction's
 * hash and sender (only to match it to a deployer HEY already holds), and the
 * created contract. No other account, no count, no balance. A row for a sender
 * nobody asked about is dropped. An answer whose row count reaches the limit
 * may be cut and is refused whole: never a partial read.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
/** The window moves every hour, so a cached answer is only ever a retry's. */
const CACHE_TTL_SECONDS = 5 * 60;

/** Deployers per request, as the serial-launcher read probed (M4 P4b). */
export const BITQUERY_RECENT_CREATIONS_BATCH = 1_000;
/** The document's row limit: an answer that reaches it may be cut, and is refused. */
export const BITQUERY_RECENT_CREATIONS_ROW_LIMIT = 1_000;

export const BITQUERY_RECENT_CREATIONS_QUERY = `query HeyRecentContractCreations($senders: [String!], $since: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    Calls(
      where: { Block: { Time: { since: $since } }, Call: { Create: true }, Transaction: { From: { in: $senders } } }
      limit: { count: ${BITQUERY_RECENT_CREATIONS_ROW_LIMIT} }
      orderBy: { ascending: Block_Time }
    ) {
      Block { Number Time }
      Transaction { Hash From }
      Call { To }
    }
  }
}`;

const rowSchema = z.object({
  Block: z.object({ Number: z.union([z.string(), z.number()]).nullish(), Time: z.string().nullish() }).nullish(),
  Transaction: z.object({ Hash: z.string().nullish(), From: z.string().nullish() }).nullish(),
  Call: z.object({ To: z.string().nullish() }).nullish(),
});

const responseSchema = z.object({
  data: z.object({ EVM: z.object({ Calls: z.array(rowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryRecentCreationsInput = { senders: readonly string[]; since: Date; apiKey: string; baseUrl?: string };

export type BitqueryRecentCreation = {
  /** The created contract, lower-cased. */
  address: string;
  /** The account that sent the creating transaction: one of the asked senders, lower-cased. */
  sender: string;
  txHash: string;
  blockNumber: number;
  createdAt: Date;
};

export type BitqueryRecentCreations = {
  /** One per created contract, oldest first. */
  creations: BitqueryRecentCreation[];
  /** Rows the answer carried, kept or dropped. */
  rows: number;
  /**
   * The answer reached the row limit and may be cut: it is refused whole, so
   * `creations` is empty and the caller asks again in smaller pieces. Absence
   * from a refused answer means nothing.
   */
  truncated: boolean;
};

/** Creations by the asked senders only; a malformed row, or one for an account nobody asked about, is dropped, never patched. */
export function normalizeBitqueryRecentCreations(rows: readonly z.infer<typeof rowSchema>[] | null | undefined, senders: readonly string[]): BitqueryRecentCreations {
  const wanted = new Set(senders.map((sender) => sender.toLowerCase()));
  const byAddress = new Map<string, BitqueryRecentCreation>();
  for (const row of rows ?? []) {
    const sender = row.Transaction?.From?.toLowerCase();
    const address = row.Call?.To?.toLowerCase();
    const txHash = row.Transaction?.Hash?.toLowerCase();
    if (!sender || !ADDRESS.test(sender) || !wanted.has(sender)) continue;
    if (!address || !ADDRESS.test(address) || !txHash || !TX_HASH.test(txHash)) continue;
    const block = typeof row.Block?.Number === 'number' ? row.Block.Number : row.Block?.Number ? Number(row.Block.Number) : Number.NaN;
    const createdAt = row.Block?.Time ? new Date(row.Block.Time) : undefined;
    if (!Number.isSafeInteger(block) || block <= 0 || !createdAt || Number.isNaN(createdAt.getTime())) continue;
    // A contract is created once; a repeated row keeps the first.
    if (!byAddress.has(address)) byAddress.set(address, { address, sender, txHash, blockNumber: block, createdAt });
  }
  const count = rows?.length ?? 0;
  // A cut answer cannot tell a quiet deployer from one past the cut: refused whole, never kept in part.
  if (count >= BITQUERY_RECENT_CREATIONS_ROW_LIMIT) return { creations: [], rows: count, truncated: true };
  const creations = [...byAddress.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.address.localeCompare(b.address));
  return { creations, rows: count, truncated: false };
}

export function createBitqueryRecentCreationsAdapter(): SourceAdapter<BitqueryRecentCreationsInput, BitqueryRecentCreations> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      input.senders.length > 0 &&
      input.senders.length <= BITQUERY_RECENT_CREATIONS_BATCH &&
      input.senders.every((sender) => ADDRESS.test(sender)) &&
      !Number.isNaN(input.since.getTime()) &&
      input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryRecentCreations>> {
      const senders = [...new Set(input.senders.map((sender) => sender.toLowerCase()))];
      return withBitqueryPoints(await performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({ query: BITQUERY_RECENT_CREATIONS_QUERY, variables: { senders, since: input.since.toISOString() } }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw bitqueryAnswerError(response.errors);
            return normalizeBitqueryRecentCreations(response.data?.EVM?.Calls, senders);
          },
        },
      ), BITQUERY_POINTS.perRealtimeCube);
    },
  };
}
