import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, bitqueryAnswerError } from './bitquery';

/**
 * The graph half of the bubble map: every transfer edge between a known set of
 * holders (2026-09-14).
 *
 * The first cut asked for the token's two thousand busiest transfers and then
 * kept the ones whose two ends both happened to be ranked holders. That throws
 * almost everything away. Measured on netnet: filtering only the sender, the
 * busiest edges ran to addresses outside the top ten at 2,110 and 1,940
 * transfers, while the genuine holder-to-holder pairs sat at 85, 75 and 32 and
 * never made the page. Both ends are filtered by the provider now, so every
 * row that comes back is an edge the map will actually draw.
 *
 * A cluster is then a connected component of these edges: "these addresses
 * moved this token between each other in the last few days". That is a fact
 * about transfers inside a window HEY can see, and it is all the map claims.
 *
 * A first-funder lookup was written and removed the same day. On a plan limited
 * to the realtime dataset, "the earliest inbound transfer" is the earliest one
 * still inside a roughly five-day window, which for any older address is a
 * mid-life transfer wearing the costume of a funding event — and the provider
 * returns it with a 200 rather than an error. A wrong origin drawn confidently
 * is worse than no origin.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 60 * 60;

/** Address lists this long are comfortable in one document; the caller ranks at most fifty. */
export const BITQUERY_GRAPH_MAX_ADDRESSES = 60;

export const BITQUERY_HOLDER_GRAPH_QUERY = `query HeyHolderGraph($token: String!, $addresses: [String!], $since: DateTime!) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    edges: Transfers(
      where: {
        Block: { Time: { since: $since } }
        Transfer: { Currency: { SmartContract: { is: $token } }, Sender: { in: $addresses }, Receiver: { in: $addresses } }
      }
      limit: { count: 400 }
      orderBy: { descendingByField: "transfers" }
    ) {
      Transfer { Sender Receiver }
      transfers: count
      amount: sum(of: Transfer_Amount)
    }
  }
}`;

const numberish = z.union([z.number(), z.string()]).nullish();

const edgeRowSchema = z.object({
  Transfer: z.object({ Sender: z.string().nullish(), Receiver: z.string().nullish() }),
  transfers: numberish,
  amount: numberish,
});

const responseSchema = z.object({
  data: z
    .object({
      EVM: z
        .object({ edges: z.array(edgeRowSchema).nullish() })
        .nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryHolderGraphInput = {
  token: string;
  /** The ranked holders; both ends of every edge must be in here. */
  addresses: readonly string[];
  /** Edges at or after this moment. */
  since: Date;
  apiKey: string;
  baseUrl?: string;
};

export type BitqueryHolderEdge = { from: string; to: string; transfers: number; amount: number };

export type BitqueryHolderGraph = { edges: BitqueryHolderEdge[] };

const whole = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? Math.round(parsed) : 0;
};
const amountOf = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 && Number.isFinite(parsed) ? parsed : 0;
};

export function normalizeBitqueryHolderGraph(
  data: NonNullable<NonNullable<z.infer<typeof responseSchema>['data']>['EVM']>,
  addresses: readonly string[],
): BitqueryHolderGraph {
  const known = new Set(addresses.map((address) => address.toLowerCase()));
  const byPair = new Map<string, BitqueryHolderEdge>();
  for (const row of data.edges ?? []) {
    const from = row.Transfer.Sender?.toLowerCase();
    const to = row.Transfer.Receiver?.toLowerCase();
    if (!from || !to || from === to) continue;
    if (!ADDRESS.test(from) || !ADDRESS.test(to)) continue;
    // The provider filtered both ends; this is belt and braces, not the filter.
    if (!known.has(from) || !known.has(to)) continue;
    const key = `${from}>${to}`;
    const current = byPair.get(key) ?? { from, to, transfers: 0, amount: 0 };
    current.transfers += whole(row.transfers);
    current.amount += amountOf(row.amount);
    byPair.set(key, current);
  }


  return { edges: [...byPair.values()].sort((a, b) => b.transfers - a.transfers || a.from.localeCompare(b.from)) };
}

export function createBitqueryHolderGraphAdapter(): SourceAdapter<BitqueryHolderGraphInput, BitqueryHolderGraph> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      ADDRESS.test(input.token) &&
      input.addresses.length > 0 &&
      input.addresses.length <= BITQUERY_GRAPH_MAX_ADDRESSES &&
      input.addresses.every((address) => ADDRESS.test(address)) &&
      input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryHolderGraph>> {
      const addresses = [...new Set(input.addresses.map((address) => address.toLowerCase()))];
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({
            query: BITQUERY_HOLDER_GRAPH_QUERY,
            variables: { token: input.token.toLowerCase(), addresses, since: input.since.toISOString() },
          }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw bitqueryAnswerError(response.errors);
            return normalizeBitqueryHolderGraph(response.data?.EVM ?? {}, addresses);
          },
        },
      );
    },
  };
}
