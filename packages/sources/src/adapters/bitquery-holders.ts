import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, bitqueryAnswerError } from './bitquery';

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
 * The edges are NOT read here. They were, in the first cut, as a third cube on
 * this document; but the provider can only filter both ends of an edge once it
 * knows the address set, so that version kept whichever of the token's busiest
 * transfers happened to have both ends ranked — which on a real token is almost
 * none of them. `bitquery-holder-graph.ts` asks for them properly, in a second
 * request, and this document no longer pays five points for a cube nobody reads.
 *
 * The third figure is the total holder count, and it has to be asked for
 * carefully (corrected 2026-09-14, the day after it shipped wrong). The cube
 * holds a row for every address that has **ever** held the token, so an
 * unfiltered count answers "how many have ever touched it", not "how many hold
 * it". On `$HEY` that was 2,445 against 1,040 on the block explorer — the page
 * was showing more than twice the real number under the label "Addresses
 * holding it". Counting only balances above zero gives 1,039, which is the
 * explorer's figure. `count(distinct:)` is used rather than `uniq`, which the
 * provider documents as approximate.
 *
 * Flat five points a cube, so one token costs fifteen.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 60 * 60;

/** How many holders a bubble map draws. Past this the circles are too small to read. */
export const BITQUERY_HOLDERS_TOP_N = 50;

export const BITQUERY_HOLDERS_QUERY = `query HeyTokenHolders($token: String!, $top: Int!, $exclude: [String!]) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    top: Holders(
      where: { Currency: { SmartContract: { is: $token } } }
      limit: { count: $top }
      orderBy: { descending: Balance_Amount }
    ) {
      Holder { Address }
      Balance { Amount FirstChangeTime LastChangeTime UpdateCount }
    }
    total: Holders(where: { Currency: { SmartContract: { is: $token } }, Holder: { Address: { notIn: $exclude } } }) {
      holders: count(distinct: Holder_Address, if: { Balance: { Amount: { gt: "0" } } })
      gini: gini(of: Balance_Amount)
      nakamoto: nakamoto(of: Balance_Amount, ratio: 0.5)
      median: median(of: Balance_Amount)
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

const responseSchema = z.object({
  data: z
    .object({
      EVM: z
        .object({
          top: z.array(holderRowSchema).nullish(),
          total: z.array(z.object({ holders: numberish, gini: numberish, nakamoto: numberish, median: numberish })).nullish(),
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
  /**
   * Unused by this read and kept only so the caller passes one window to both
   * adapters. It must not appear in the document: GraphQL refuses an operation
   * that declares a variable it never references, which is exactly how removing
   * the transfers cube broke every request until it was spotted.
   */
  since?: Date;
  /**
   * Addresses to leave out of the counts — pools, lockers, routers, factories
   * and burns (2026-09-15).
   *
   * They stay in the ranked list above, because the map labels them and a
   * reader should see that the pool is the largest balance. They come out of
   * the concentration figures, because on this chain one pool holds more than
   * half of almost every token and the Nakamoto coefficient came back as 1
   * everywhere until they did. The same token reads 1 with them and 34
   * without.
   */
  exclude?: readonly string[];
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

export type BitqueryHolders = {
  /** Ranked by balance, largest first. */
  holders: BitqueryHolder[];
  /** Every address holding a non-zero balance, as the provider counts them. */
  holdersTotal?: number;
  /**
   * Concentration, computed by the provider over the whole balance set
   * (2026-09-15) — not over the fifty rows above, which is why it is worth
   * asking for rather than deriving here.
   *
   * `gini` is 0 when everyone holds the same and approaches 1 as one address
   * holds everything. `nakamotoHalf` is the number of addresses holding half
   * the supply in the filtered set — the caller excludes pools, lockers, burns
   * and the token itself, so the figure is half of what is left, never half of
   * the whole supply. It answers "how few hands" in a sentence a reader does
   * not have to be taught, provided the sentence says which supply. Both are
   * numbers about a distribution; neither names anyone.
   */
  gini?: number;
  nakamotoHalf?: number;
  medianBalance?: number;
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
 * Rows to a map. A zero or negative balance is dropped: the cube keeps a row
 * for an address that has emptied itself, and that is not a holder.
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

  const total = whole(data.total?.[0]?.holders);
  /*
   * Absent means the provider did not answer, never zero. `theil_index` is in
   * the schema and returns null on this chain, which is exactly the shape a
   * silently-wrong figure would take, so it is not asked for at all.
   */
  const ratio = (value: number | string | null | undefined): number | undefined => {
    const parsed = toNumber(value);
    return parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const gini = ratio(data.total?.[0]?.gini);
  const nakamoto = whole(data.total?.[0]?.nakamoto);
  const median = ratio(data.total?.[0]?.median);
  return {
    holders,
    ...(total > 0 ? { holdersTotal: total } : {}),
    ...(gini !== undefined && gini > 0 ? { gini } : {}),
    ...(nakamoto > 0 ? { nakamotoHalf: nakamoto } : {}),
    ...(median !== undefined && median > 0 ? { medianBalance: median } : {}),
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
            variables: {
              token: input.token.toLowerCase(),
              top,
              // Never an empty list: `notIn: []` is an empty exclusion the
              // provider has no reason to honour, and the burn addresses are
              // always worth excluding anyway.
              exclude: [...new Set((input.exclude ?? []).map((address) => address.toLowerCase()).filter((address) => ADDRESS.test(address)))],
            },
          }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw bitqueryAnswerError(response.errors);
            return normalizeBitqueryHolders(response.data?.EVM ?? {});
          },
        },
      );
    },
  };
}
