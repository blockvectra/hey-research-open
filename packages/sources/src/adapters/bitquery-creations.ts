import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, bitqueryAnswerError } from './bitquery';

/**
 * How many contracts each of a set of deployers created in a window
 * (2026-09-27, founder decision F4: the serial-launcher flag).
 *
 * The explorer's transaction list that the deployer watch reads sees only a
 * direct deployment — a transaction with no recipient. A launchpad account
 * creates almost everything through a factory, inside its own transactions:
 * in a 15,000-creation sample 14,874 were internal (M4 probe P4). The `Calls`
 * cube records every creation, direct or internal, with the transaction's
 * sender, so one request counts them for a thousand deployers at once
 * (M4 probe P4b, 2026-09-26: 2,688 deployers in three requests, no chunk at
 * the row limit; 142 of them created 100 or more in 90 days).
 *
 * `Calls` is in the archive grant (see `BITQUERY_ARCHIVE_CUBES`), so the
 * document reads `combined` and a 90-day window is answered whole, not the
 * four-odd days realtime keeps.
 *
 * What is read: the sender of each creating transaction, only to group the
 * count by the deployer HEY already holds for a project, and the count. No
 * created address, no balance, no other account. Nothing here is stored per
 * account or kept as a history; the caller keeps a flag and the latest count
 * on each project's own deployer record.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 6 * 60 * 60;

/** Deployers per request, as probed; one row comes back per deployer that created anything. */
export const BITQUERY_CREATIONS_BATCH = 1_000;
/** The document's row limit; with one row per deployer a batch can never reach it. */
export const BITQUERY_CREATIONS_ROW_LIMIT = 5_000;

export const BITQUERY_CREATIONS_QUERY = `query HeyContractCreations($senders: [String!], $since: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: combined) {
    Calls(
      where: { Block: { Time: { since: $since } }, Call: { Create: true }, Transaction: { From: { in: $senders } } }
      limit: { count: 5000 }
    ) {
      Transaction { From }
      n: count
    }
  }
}`;

const rowSchema = z.object({
  Transaction: z.object({ From: z.string().nullish() }).nullish(),
  n: z.union([z.string(), z.number()]).nullish(),
});

const responseSchema = z.object({
  data: z.object({ EVM: z.object({ Calls: z.array(rowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryCreationsInput = { senders: readonly string[]; since: Date; apiKey: string; baseUrl?: string };

export type BitqueryCreationCounts = {
  /** Contracts created inside each asked deployer's transactions since `since`, lower-cased keys. A deployer absent here created none. */
  counts: Map<string, number>;
  /** Rows the answer carried; at the row limit the answer may be cut, and the caller must not read absence as zero. */
  rows: number;
};

/** One count per asked deployer; a row for an account nobody asked about, or with no usable count, is dropped. */
export function normalizeBitqueryCreations(rows: readonly z.infer<typeof rowSchema>[] | null | undefined, senders: readonly string[]): BitqueryCreationCounts {
  const wanted = new Set(senders.map((sender) => sender.toLowerCase()));
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const sender = row.Transaction?.From?.toLowerCase();
    if (!sender || !ADDRESS.test(sender) || !wanted.has(sender)) continue;
    const n = typeof row.n === 'number' ? row.n : row.n === null || row.n === undefined || row.n === '' ? Number.NaN : Number(row.n);
    if (!Number.isFinite(n) || n < 0) continue;
    counts.set(sender, (counts.get(sender) ?? 0) + Math.floor(n));
  }
  return { counts, rows: rows?.length ?? 0 };
}

export function createBitqueryCreationsAdapter(): SourceAdapter<BitqueryCreationsInput, BitqueryCreationCounts> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      input.senders.length > 0 &&
      input.senders.length <= BITQUERY_CREATIONS_BATCH &&
      input.senders.every((sender) => ADDRESS.test(sender)) &&
      !Number.isNaN(input.since.getTime()) &&
      input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryCreationCounts>> {
      const senders = [...new Set(input.senders.map((sender) => sender.toLowerCase()))];
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({ query: BITQUERY_CREATIONS_QUERY, variables: { senders, since: input.since.toISOString() } }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw bitqueryAnswerError(response.errors);
            return normalizeBitqueryCreations(response.data?.EVM?.Calls, senders);
          },
        },
      );
    },
  };
}
