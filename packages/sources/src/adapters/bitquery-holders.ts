import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK } from './bitquery';

/**
 * Token distribution: who holds a token, and which of them move it between
 * each other (2026-09-14).
 *
 * This is the one thing HEY spent its first year deliberately not building.
 * CLAUDE.md product rule 1 forbade holder tracking and wallet clustering, and
 * a schema test enforced it. The founder lifted that on 2026-09-14, in this
 * exact form: a bubble map on the market page, behind the builder story, so a
 * reader can see whether a token's supply sits in five hands before deciding
 * anything. The rule still forbids the rest — no PnL, no smart-money labels,
 * no wallet profiles, no follow-this-wallet — and the schema guard still
 * enforces that half.
 *
 * Two reads, one document:
 *
 * - `Holders`, ordered by balance: the top N addresses, what each holds, when
 *   it first and last changed, and how many times. Documented as needing the
 *   archive dataset, which this plan is refused; verified on 2026-09-14 that
 *   it answers on `realtime` for `network: robinhood` anyway.
 * - `Transfers` between those same addresses in the window: the edges. A
 *   bubble map without them is a pie chart. The realtime window reaches back
 *   about five days, so an edge means "moved recently", never "related", and
 *   the caller must not present it as a cluster.
 *
 * `uniq(of: Holder_Address)` gives the total holder count in the same request.
 * Flat five points a cube, so one token costs fifteen.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 60 * 60;

/** How many holders a bubble map draws. Past this the circles are too small to read. */
export const BITQUERY_HOLDERS_TOP_N = 50;

export const BITQUERY_HOLDERS_QUERY = `query HeyTokenHolders($token: String!, $top: Int!, $since: DateTime!) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    top: Holders(
      where: { Currency: { SmartContract: { is: $token } } }
      limit: { count: $top }
      orderBy: { descending: Balance_Amount }
    ) {
      Holder { Address }
      Balance { Amount FirstChangeTime LastChangeTime UpdateCount }
    }
    total: Holders(where: { Currency: { SmartContract: { is: $token } } }) {
      holders: uniq(of: Holder_Address)
    }
    links: Transfers(
      where: { Block: { Time: { since: $since } }, Transfer: { Currency: { SmartContract: { is: $token } } } }
      limit: { count: 2000 }
      orderBy: { descendingByField: "transfers" }
    ) {
      Transfer { Sender Receiver }
      transfers: count
      amount: sum(of: Transfer_Amount)
    }
  }
}`;

const numberish = z.union([z.number(), z.string()]).nullish();

const holderRowSchema = z.object({
  Holder: z.object({ Address: z.string() }),
  Balance: z.object({
    Amount: numberish,
    FirstChangeTime: z.string().nullish(),
    LastChangeTime: z.string().nullish(),
    UpdateCount: numberish,
  }),
});
const linkRowSchema = z.object({
  Transfer: z.object({ Sender: z.string().nullish(), Receiver: z.string().nullish() }),
  transfers: numberish,
  amount: numberish,
});

const responseSchema = z.object({
  data: z
    .object({
      EVM: z
        .object({
          top: z.array(holderRowSchema).nullish(),
          total: z.array(z.object({ holders: numberish })).nullish(),
          links: z.array(linkRowSchema).nullish(),
        })
        .nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryHoldersInput = {
  /** The token contract, lower-cased by the adapter. */
  token: string;
  /** How many holders to rank; capped at `BITQUERY_HOLDERS_TOP_N`. */
  top?: number;
  /** Transfers at or after this moment count as an edge. */
  since: Date;
  apiKey: string;
  baseUrl?: string;
};

export type BitqueryHolder = {
  address: string;
  amount: number;
  firstChangeAt?: Date;
  lastChangeAt?: Date;
  /** How many times this balance changed, as the provider counts it. */
  updateCount?: number;
};

/** A transfer edge between two of the ranked holders, inside the window. */
export type BitqueryHolderLink = {
  from: string;
  to: string;
  transfers: number;
  amount: number;
};

export type BitqueryHolders = {
  /** Ranked by balance, largest first. */
  holders: BitqueryHolder[];
  /** Every address holding a non-zero balance, as the provider counts them. */
  holdersTotal?: number;
  /** Only edges whose two ends are both in `holders`; the rest are dropped. */
  links: BitqueryHolderLink[];
};

const amountOf = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 && Number.isFinite(parsed) ? parsed : 0;
};
const whole = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? Math.round(parsed) : 0;
};
const when = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at;
};

/**
 * Rows to a map. An edge survives only when both ends are ranked holders and
 * the two are different addresses: a self-transfer is not a connection, and an
 * edge to an address the map does not draw has nothing to attach to.
 */
export function normalizeBitqueryHolders(data: NonNullable<NonNullable<z.infer<typeof responseSchema>['data']>['EVM']>): BitqueryHolders {
  const holders: BitqueryHolder[] = [];
  const ranked = new Set<string>();
  for (const row of data.top ?? []) {
    const address = row.Holder.Address.toLowerCase();
    if (!ADDRESS.test(address) || ranked.has(address)) continue;
    const amount = amountOf(row.Balance.Amount);
    if (amount <= 0) continue;
    ranked.add(address);
    holders.push({
      address,
      amount,
      ...(when(row.Balance.FirstChangeTime) ? { firstChangeAt: when(row.Balance.FirstChangeTime)! } : {}),
      ...(when(row.Balance.LastChangeTime) ? { lastChangeAt: when(row.Balance.LastChangeTime)! } : {}),
      ...(whole(row.Balance.UpdateCount) > 0 ? { updateCount: whole(row.Balance.UpdateCount) } : {}),
    });
  }

  const byPair = new Map<string, BitqueryHolderLink>();
  for (const row of data.links ?? []) {
    const from = row.Transfer.Sender?.toLowerCase();
    const to = row.Transfer.Receiver?.toLowerCase();
    if (!from || !to || from === to) continue;
    if (!ADDRESS.test(from) || !ADDRESS.test(to)) continue;
    if (!ranked.has(from) || !ranked.has(to)) continue;
    const key = `${from}>${to}`;
    const current = byPair.get(key) ?? { from, to, transfers: 0, amount: 0 };
    current.transfers += whole(row.transfers);
    current.amount += amountOf(row.amount);
    byPair.set(key, current);
  }

  const total = whole(data.total?.[0]?.holders);
  return {
    holders,
    ...(total > 0 ? { holdersTotal: total } : {}),
    links: [...byPair.values()].sort((a, b) => b.transfers - a.transfers || a.from.localeCompare(b.from)),
  };
}

export function createBitqueryHoldersAdapter(): SourceAdapter<BitqueryHoldersInput, BitqueryHolders> {
  return {
    name: 'bitquery',
    canHandle: (input) => ADDRESS.test(input.token) && input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryHolders>> {
      const top = Math.max(1, Math.min(BITQUERY_HOLDERS_TOP_N, input.top ?? BITQUERY_HOLDERS_TOP_N));
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({
            query: BITQUERY_HOLDERS_QUERY,
            variables: { token: input.token.toLowerCase(), top, since: input.since.toISOString() },
          }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw new Error(response.errors.map((error) => error.message).join('; '));
            return normalizeBitqueryHolders(response.data?.EVM ?? {});
          },
        },
      );
    },
  };
}
