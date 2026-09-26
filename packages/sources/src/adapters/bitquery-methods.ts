import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, bitqueryAnswerError, type BitqueryDataset } from './bitquery';

/**
 * Calls per method, per contract, per UTC day (founder decision F9, 2026-09-27).
 *
 * The contract-usage read (`bitquery-contracts.ts`) already counts, per day,
 * how many calls a contract took and how many *different* methods were
 * called. This asks the one question that count cannot answer: which ones.
 * A token being traded is `balanceOf`, `transfer`, `approve` all day; a
 * product has functions of its own, and the day one of them is called for
 * the first time — or again after a month of silence — is a fact about the
 * contract that nothing else HEY reads can date.
 *
 * One cube, `Calls`, grouped by the day, the contract and the method's
 * decoded name and 4-byte selector. Counts only. It selects no account: not
 * the caller, not the transaction's sender, not a count of either — the daily
 * distinct-caller count HEY publishes already comes from the usage read, and
 * nothing here repeats or narrows it (CLAUDE.md product rule 1).
 *
 * `Calls` is in the historical grant (`BITQUERY_ARCHIVE_CUBES`), so the same
 * document serves the forward read (`realtime`, the last few days) and the
 * one-off backfill (`combined`, back to genesis on 2026-04-30). The dataset is
 * the caller's choice for that reason, and the grant fence
 * (`bitquery-grant.test.ts`) holds the document to granted cubes only.
 *
 * Probed on 2026-09-26 (M4 P1a–P1c, P6): a hundred contracts over three days
 * came back in 2,539 rows, 2.9 % of them with no decoded name; an undecoded
 * call usually still carries its selector, and the rare one that carries
 * neither is kept as one "unknown" bucket rather than dropped. A contract
 * with no call in the window is simply absent — whether that is a silent day
 * or an unread one is the caller's coverage record to say, never this one's.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A Solidity identifier: anything else is not a name HEY will store or print. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,99}$/;
const CACHE_TTL_SECONDS = 30 * 60;

/** Contracts per request. A hundred over three days answered in ~2,500 rows (M4 P1b), well inside the row limit. */
export const BITQUERY_METHOD_BATCH = 100;

/** The document's row limit; an answer this long may be cut, and the caller must not store it as complete. */
export const BITQUERY_METHOD_ROW_LIMIT = 10_000;

export const bitqueryMethodDaysQuery = (dataset: BitqueryDataset) => `query HeyContractMethodDays($addresses: [String!], $since: DateTime, $till: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: ${dataset}) {
    Calls(
      where: { Block: { Time: { since: $since, till: $till } }, Call: { To: { in: $addresses } } }
      limit: { count: ${BITQUERY_METHOD_ROW_LIMIT} }
    ) {
      Block { Date }
      Call { To Signature { Name SignatureHash } }
      calls: count
    }
  }
}`;

const numberish = z.union([z.number(), z.string()]).nullish();

const rowSchema = z.object({
  Block: z.object({ Date: z.string().nullish() }).nullish(),
  Call: z
    .object({
      To: z.string().nullish(),
      Signature: z.object({ Name: z.string().nullish(), SignatureHash: z.string().nullish() }).nullish(),
    })
    .nullish(),
  calls: numberish,
});

const responseSchema = z.object({
  data: z.object({ EVM: z.object({ Calls: z.array(rowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryMethodDaysInput = {
  /** Contract addresses, at most `BITQUERY_METHOD_BATCH`; the caller chunks. */
  addresses: readonly string[];
  /** Calls at or after this instant. The caller passes a UTC midnight. */
  since: Date;
  /** Calls at or before this instant. The caller passes the last second of a UTC day, so no partial day is read. */
  till: Date;
  /** `realtime` for the forward read; `combined` for the archive backfill. `Calls` is granted for both. */
  dataset: BitqueryDataset;
  apiKey: string;
  baseUrl?: string;
};

/** One method of one contract on one UTC day. Counts only. */
export type BitqueryMethodDay = {
  address: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** The decoded name, when the cube decoded one and it is a plain identifier. */
  name?: string;
  /** The 4-byte selector, `0x` and eight lower-case hex digits, when the cube gave one. */
  selector?: string;
  calls: number;
};

export type BitqueryMethodDaysRead = {
  rows: BitqueryMethodDay[];
  /** The answer reached the row limit: some rows may be missing, so none of it may be stored as a complete day. */
  truncated: boolean;
};

/**
 * The selector as `0x` + eight lower-case hex digits. The cube has answered
 * with the four bytes bare and upper-case (`8071CDFA`, M4 P6); a full 32-byte
 * signature hash is cut to its first four bytes, which is what a selector is.
 */
export function normalizeSelector(value: string | null | undefined): string | undefined {
  const hex = value?.trim().toLowerCase().replace(/^0x/, '');
  if (!hex || !/^[0-9a-f]+$/.test(hex)) return undefined;
  if (hex.length === 8 || hex.length === 64) return `0x${hex.slice(0, 8)}`;
  return undefined;
}

const whole = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? Math.round(parsed) : 0;
};

/**
 * One row per (contract, day, name, selector), summed. A row with a malformed
 * address or day is dropped, never guessed; a name that is not an identifier
 * is treated as undecoded rather than stored.
 */
export function normalizeBitqueryMethodDays(rows: readonly z.infer<typeof rowSchema>[] | null | undefined, addresses: readonly string[]): BitqueryMethodDay[] {
  const wanted = new Set(addresses.map((address) => address.toLowerCase()));
  const byKey = new Map<string, BitqueryMethodDay>();
  for (const row of rows ?? []) {
    const address = row.Call?.To?.toLowerCase();
    const day = row.Block?.Date ?? '';
    if (!address || !ADDRESS.test(address) || !wanted.has(address) || !DAY.test(day)) continue;
    const calls = whole(row.calls);
    if (calls === 0) continue;
    const rawName = row.Call?.Signature?.Name?.trim();
    const name = rawName && IDENTIFIER.test(rawName) ? rawName : undefined;
    const selector = normalizeSelector(row.Call?.Signature?.SignatureHash);
    const key = `${address}|${day}|${name ?? ''}|${selector ?? ''}`;
    const current = byKey.get(key);
    if (current) current.calls += calls;
    else byKey.set(key, { address, day, ...(name ? { name } : {}), ...(selector ? { selector } : {}), calls });
  }
  return [...byKey.values()].sort(
    (a, b) => a.address.localeCompare(b.address) || a.day.localeCompare(b.day) || (a.name ?? '').localeCompare(b.name ?? '') || (a.selector ?? '').localeCompare(b.selector ?? ''),
  );
}

export function createBitqueryMethodDaysAdapter(): SourceAdapter<BitqueryMethodDaysInput, BitqueryMethodDaysRead> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      input.addresses.length > 0 &&
      input.addresses.length <= BITQUERY_METHOD_BATCH &&
      input.addresses.every((address) => ADDRESS.test(address)) &&
      input.since.getTime() <= input.till.getTime() &&
      input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryMethodDaysRead>> {
      const addresses = [...new Set(input.addresses.map((address) => address.toLowerCase()))];
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({
            query: bitqueryMethodDaysQuery(input.dataset),
            variables: { addresses, since: input.since.toISOString(), till: input.till.toISOString() },
          }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw bitqueryAnswerError(response.errors);
            const raw = response.data?.EVM?.Calls ?? [];
            return { rows: normalizeBitqueryMethodDays(raw, addresses), truncated: raw.length >= BITQUERY_METHOD_ROW_LIMIT };
          },
        },
      );
    },
  };
}
