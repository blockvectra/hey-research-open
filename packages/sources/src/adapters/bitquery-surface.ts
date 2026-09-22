import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_FULL_DATASET, BITQUERY_NETWORK, type BitqueryDataset } from './bitquery';

/**
 * What a contract actually answers, from the decoded chain (2026-09-15).
 *
 * `/scan` asks whether anyone is building something. For an address with no
 * site and no repository — which is most of them — HEY had nothing to answer
 * with, and said so honestly and uselessly. But the chain itself carries the
 * one fact that bears directly on the question: **which methods the contract
 * answers, and how often each was called.**
 *
 * The distinction is stark in practice. Probed 2026-09-15:
 *
 *  - `0xa78735ba…` answers seven methods — balanceOf, transfer, transferFrom,
 *    approve, allowance, totalSupply — and emits two logs, Transfer and
 *    Approval. That is the ERC-20 standard and nothing else. There is no
 *    protocol at that address.
 *  - The Pons V2 factory answers getLaunchedToken, launchToken, launchTokenFor,
 *    createGraduatedPool, snipeTaxSeconds, memeHook, poolManager… — a surface
 *    somebody designed and maintains.
 *
 * Both are read the same way, from the same cube, with no judgement applied.
 * HEY reports what the contract answers and lets the reader draw the line —
 * a plain token is an ordinary and honest thing to be, and a team may well be
 * building elsewhere. What HEY can say is whether the code at *this* address
 * does anything beyond moving a balance.
 *
 * Nothing here touches holders, balances or wallets (product rule 1). A caller
 * count is a count of distinct senders and is never resolved to an address,
 * never stored, and never attributed to anyone.
 *
 * It ran on `realtime` — about four and a half days — which answers the wrong
 * question (2026-09-22). "Which methods does this contract answer" is a
 * property of the code, not of the last four days, so a real protocol that
 * happened to be quiet this week read as having no surface at all.
 *
 * `Calls` and `Events` are both archive-granted and this document reads no
 * USD field, so `combined` spans the chain's whole history at the same cost.
 * The counts are still "in the window HEY can read"; the window is now the
 * chain.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A contract's surface changes only when somebody deploys a new one. */
const CACHE_TTL_SECONDS = 60 * 60;
/** Enough to show the shape of an interface without paying for its long tail. */
const METHOD_LIMIT = 24;

/** Everything a standard ERC-20 answers. A contract that answers only these is only a token. */
const ERC20_SURFACE = new Set([
  'name',
  'symbol',
  'decimals',
  'totalSupply',
  'balanceOf',
  'transfer',
  'transferFrom',
  'approve',
  'allowance',
  'increaseAllowance',
  'decreaseAllowance',
]);

export const surfaceQuery = (dataset: BitqueryDataset = BITQUERY_FULL_DATASET) => `query HeySurface($address: String!, $limit: Int!) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: ${dataset}) {
    methods: Calls(
      where: { Call: { To: { is: $address } } }
      limit: { count: $limit }
      orderBy: { descendingByField: "calls" }
    ) {
      calls: count
      Call { Signature { Name } }
    }
    totals: Calls(where: { Call: { To: { is: $address } } }) {
      calls: count
      callers: count(distinct: Transaction_From)
      methods: count(distinct: Call_Signature_Name)
    }
    logs: Events(
      where: { Log: { SmartContract: { is: $address } } }
      limit: { count: $limit }
      orderBy: { descendingByField: "events" }
    ) {
      events: count
      Log { Signature { Name } }
    }
  }
}`;

/** The frozen `realtime` form, kept so a test can compare the two shapes. */
export const BITQUERY_SURFACE_QUERY = surfaceQuery('realtime');

const countOf = (value: string | number | null | undefined): number => {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const methodRow = z.object({
  calls: z.union([z.string(), z.number()]).nullish(),
  Call: z.object({ Signature: z.object({ Name: z.string().nullish() }).nullish() }).nullish(),
});
const logRow = z.object({
  events: z.union([z.string(), z.number()]).nullish(),
  Log: z.object({ Signature: z.object({ Name: z.string().nullish() }).nullish() }).nullish(),
});
const totalsRow = z.object({
  calls: z.union([z.string(), z.number()]).nullish(),
  callers: z.union([z.string(), z.number()]).nullish(),
  methods: z.union([z.string(), z.number()]).nullish(),
});

const responseSchema = z.object({
  data: z
    .object({
      EVM: z
        .object({
          methods: z.array(methodRow).nullish(),
          totals: z.array(totalsRow).nullish(),
          logs: z.array(logRow).nullish(),
        })
        .nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitquerySurfaceInput = { address: string; apiKey: string; baseUrl?: string };

export type BitqueryMethod = { name: string; calls: number };

export type BitquerySurface = {
  /** Methods called on the contract in the window, busiest first. */
  methods: BitqueryMethod[];
  /** Those of them that are not part of the ERC-20 standard. */
  beyondErc20: BitqueryMethod[];
  /** Event signatures the contract emitted, busiest first. */
  logs: BitqueryMethod[];
  calls: number;
  /** Distinct senders. A count only — never resolved, stored or attributed. */
  callers: number;
  distinctMethods: number;
  /** False when the window holds no call at all, which is not the same as none existing. */
  seen: boolean;
};

/** A signature the decoder could not name is dropped: an unnamed method says nothing to a reader. */
const named = (rows: readonly { n: unknown; name: string | null | undefined }[]): BitqueryMethod[] =>
  rows
    .map((row) => ({ name: (row.name ?? '').trim(), calls: countOf(row.n as string) }))
    .filter((row) => row.name.length > 0)
    .sort((a, b) => b.calls - a.calls);

export function normalizeBitquerySurface(
  data: z.infer<typeof responseSchema>['data'],
): BitquerySurface {
  const evm = data?.EVM;
  const methods = named(
    (evm?.methods ?? []).map((row) => ({ n: row.calls, name: row.Call?.Signature?.Name })),
  );
  const logs = named(
    (evm?.logs ?? []).map((row) => ({ n: row.events, name: row.Log?.Signature?.Name })),
  );
  const totals = evm?.totals?.[0];
  const calls = countOf(totals?.calls);

  return {
    methods,
    beyondErc20: methods.filter((method) => !ERC20_SURFACE.has(method.name)),
    logs,
    calls,
    callers: countOf(totals?.callers),
    distinctMethods: countOf(totals?.methods),
    seen: calls > 0 || methods.length > 0 || logs.length > 0,
  };
}

export function createBitquerySurfaceAdapter(): SourceAdapter<
  BitquerySurfaceInput,
  BitquerySurface
> {
  return {
    name: 'bitquery',
    canHandle: (input) => ADDRESS.test(input.address) && input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitquerySurface>> {
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${input.apiKey}`,
          },
          body: JSON.stringify({
            query: surfaceQuery(),
            variables: { address: input.address.toLowerCase(), limit: METHOD_LIMIT },
          }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length)
              throw new Error(response.errors.map((error) => error.message).join('; '));
            return normalizeBitquerySurface(response.data);
          },
        },
      );
    },
  };
}
