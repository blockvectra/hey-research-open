import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { BITQUERY_BATCH_SIZE, BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, bitqueryAnswerError } from './bitquery';

/**
 * Contract usage, a hundred contracts at a time (2026-09-14).
 *
 * HEY already asks the chain "is anyone using this contract?", one
 * `eth_getLogs` a contract, a day at a time. That read is slow, it covers
 * about 2,000 of the 5,000 published tokens a day, and the public node
 * refuses some windows outright, which is why rows can come back truncated.
 *
 * Bitquery answers the same question for a hundred contracts in one request,
 * per UTC day, and adds two facts the node read cannot give cheaply: how many
 * distinct methods were called, and how many distinct event types were
 * emitted. Those two are the difference between a contract that is only an
 * ERC-20 being traded — `balanceOf`, `transfer`, `approve`, `Transfer`,
 * `Approval` — and a project whose contract has real functions people call.
 *
 * What this asks for: counts, and the day they fall on. What it never asks
 * for: addresses, balances, holders, or who called. `Calls` and `Events` can
 * both group by the sending account on this chain; HEY does not, and the
 * absence is deliberate (CLAUDE.md product rule 1, PRD V4 §10.1).
 *
 * `callers` (2026-09-15) is `count(distinct: Transaction_From)` — how many
 * different addresses called the contract that day, as a number. It is the
 * most direct answer HEY has to its own question, is anyone actually using
 * this, and it separates the two shapes a big call count can have: PONS took
 * 544,469 calls from 7,835 addresses; a contract with the same volume from six
 * would read very differently. It selects no address and costs nothing extra —
 * it is one more aggregate on a cube this request already buys.
 *
 * Verified against `network: robinhood` on 2026-09-14: the three cubes answer
 * for a batch of a hundred, and a contract with no activity in the window is
 * simply absent, which is "not used since", not "no contract". The realtime
 * dataset is the only one this plan allows and it reaches back about five
 * days, so the caller runs daily and keeps what it reads. Flat five points a
 * cube: fifteen points a batch, about 765 for every published token.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 30 * 60;

/*
 * Not a parameter: this document asks for a cube the historical add-on does
 * not cover, so it can only ever read `realtime` (see `BITQUERY_ARCHIVE_CUBES`).
 */
export const BITQUERY_CONTRACT_ACTIVITY_QUERY = `query HeyContractActivity($addresses: [String!], $since: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    calls: Calls(
      where: { Block: { Time: { since: $since } }, Call: { To: { in: $addresses } } }
      limit: { count: 5000 }
    ) {
      Block { Date }
      Call { To }
      calls: count
      methods: count(distinct: Call_Signature_Name)
      callers: count(distinct: Transaction_From)
    }
    events: Events(
      where: { Block: { Time: { since: $since } }, Log: { SmartContract: { in: $addresses } } }
      limit: { count: 5000 }
    ) {
      Block { Date }
      Log { SmartContract }
      events: count
      kinds: count(distinct: Log_Signature_Name)
    }
    transactions: Transactions(
      where: { Block: { Time: { since: $since } }, Transaction: { To: { in: $addresses } } }
      limit: { count: 5000 }
    ) {
      Block { Date }
      Transaction { To }
      transactions: count
    }
  }
}`;

const numberish = z.union([z.number(), z.string()]).nullish();
const dayBlock = z.object({ Date: z.string() });

const callRowSchema = z.object({ Block: dayBlock, Call: z.object({ To: z.string().nullish() }), calls: numberish, methods: numberish, callers: numberish });
const eventRowSchema = z.object({ Block: dayBlock, Log: z.object({ SmartContract: z.string().nullish() }), events: numberish, kinds: numberish });
const txRowSchema = z.object({ Block: dayBlock, Transaction: z.object({ To: z.string().nullish() }), transactions: numberish });

const responseSchema = z.object({
  data: z
    .object({
      EVM: z
        .object({
          calls: z.array(callRowSchema).nullish(),
          events: z.array(eventRowSchema).nullish(),
          transactions: z.array(txRowSchema).nullish(),
        })
        .nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryContractActivityInput = {
  /** Contract addresses, at most `BITQUERY_BATCH_SIZE`; the caller chunks. */
  addresses: readonly string[];
  /** Activity at or after this moment is counted, grouped by the UTC day it fell on. */
  since: Date;
  apiKey: string;
  baseUrl?: string;
};

/** One contract's one UTC day, as the decoded chain saw it. Counts only. */
export type BitqueryContractDay = {
  address: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** Calls into the contract, top-level and internal. */
  calls: number;
  /** How many different method names were called. A plain ERC-20 sits at three or four. */
  methods: number;
  /** How many different addresses called it. A count, never an address (2026-09-15). */
  callers: number;
  /** Logs the contract emitted. */
  events: number;
  /** How many different event names it emitted. */
  eventKinds: number;
  /** Transactions sent directly to the contract, as opposed to reaching it through a router. */
  transactions: number;
};

const whole = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? Math.round(parsed) : 0;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Three cubes, one row per (contract, day). A malformed address or day is dropped, never guessed. */
export function normalizeBitqueryContractDays(data: NonNullable<NonNullable<z.infer<typeof responseSchema>['data']>['EVM']>): BitqueryContractDay[] {
  const byKey = new Map<string, BitqueryContractDay>();
  const at = (rawAddress: string | null | undefined, day: string): BitqueryContractDay | undefined => {
    const address = rawAddress?.toLowerCase();
    if (!address || !ADDRESS.test(address) || !DAY.test(day)) return undefined;
    const key = `${address}:${day}`;
    const current = byKey.get(key) ?? { address, day, calls: 0, methods: 0, callers: 0, events: 0, eventKinds: 0, transactions: 0 };
    byKey.set(key, current);
    return current;
  };
  for (const row of data.calls ?? []) {
    const entry = at(row.Call.To, row.Block.Date);
    if (!entry) continue;
    entry.calls += whole(row.calls);
    entry.methods = Math.max(entry.methods, whole(row.methods));
    entry.callers = Math.max(entry.callers, whole(row.callers));
  }
  for (const row of data.events ?? []) {
    const entry = at(row.Log.SmartContract, row.Block.Date);
    if (!entry) continue;
    entry.events += whole(row.events);
    entry.eventKinds = Math.max(entry.eventKinds, whole(row.kinds));
  }
  for (const row of data.transactions ?? []) {
    const entry = at(row.Transaction.To, row.Block.Date);
    if (!entry) continue;
    entry.transactions += whole(row.transactions);
  }
  return [...byKey.values()].sort((a, b) => a.address.localeCompare(b.address) || a.day.localeCompare(b.day));
}

export function createBitqueryContractActivityAdapter(): SourceAdapter<BitqueryContractActivityInput, BitqueryContractDay[]> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      input.addresses.length > 0 &&
      input.addresses.length <= BITQUERY_BATCH_SIZE &&
      input.addresses.every((address) => ADDRESS.test(address)) &&
      input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryContractDay[]>> {
      const addresses = [...new Set(input.addresses.map((address) => address.toLowerCase()))];
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({ query: BITQUERY_CONTRACT_ACTIVITY_QUERY, variables: { addresses, since: input.since.toISOString() } }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw bitqueryAnswerError(response.errors);
            return normalizeBitqueryContractDays(response.data?.EVM ?? {});
          },
        },
      );
    },
  };
}
