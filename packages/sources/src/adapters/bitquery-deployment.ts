import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK,
  BITQUERY_DEFAULT_DATASET,
  type BitqueryDataset,
} from './bitquery';

/**
 * Who deployed a contract, read from the chain's own calls (2026-09-15).
 *
 * HEY asked the explorer this and the explorer stopped answering: the
 * Blockscout instance sits behind Cloudflare's bot protection and 403s a good
 * share of every route, so the scan's most valuable line — who built this —
 * read "HEY could not read the creation record" almost every time.
 *
 * A contract creation is a `Call` with `Create: true` whose `To` is the new
 * address, and the decoded chain carries two accounts for it, which the
 * explorer's single `contractCreator` does not separate:
 *
 *  - `Call.From` is what executed the creation. For a launchpad token this is
 *    the factory, and naming it is how HEY says "a service made this".
 *  - `Transaction.From` is the account that sent the transaction — the person
 *    or bot who pressed the button. It is the same address the explorer would
 *    have called the creator on a direct deploy, and the one it hides behind
 *    the factory on an indirect one.
 *  - `Transaction.To` is the contract that account called, which on a launchpad
 *    is the public factory. Probed 2026-09-15: every Pons launch runs its
 *    creation through an inner deployer at `0x3711cea4…`, and the factory whose
 *    name anyone would recognise — and which HEY's launch registry watches —
 *    only appears here. Clanker, Virtuals and PAIR are shaped the same way, so
 *    reading `Call.From` alone names an implementation detail instead of a
 *    launchpad.
 *
 * Probed against `network: robinhood` on 2026-09-15: a Pons launch came back
 * with the factory at `Call.From`, the deployer at `Transaction.From`, and the
 * block time of the creation, in one cube at five points.
 *
 * **The realtime dataset reaches back about four days**, which is the shape
 * this is for: the scan exists to answer for a launch that just happened. An
 * older contract returns nothing, and nothing means "not in the window HEY can
 * read" — never "this was not deployed".
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** A creation never changes, so the only reason to re-ask is a cache that expired. */
const CACHE_TTL_SECONDS = 6 * 60 * 60;

export const deploymentQuery = (
  dataset: BitqueryDataset = BITQUERY_DEFAULT_DATASET,
): string => `query HeyDeployment($address: String!) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: ${dataset}) {
    Calls(
      where: { Call: { Create: true, To: { is: $address } } }
      limit: { count: 1 }
      orderBy: { ascending: Block_Time }
    ) {
      Block { Time Number }
      Call { From To }
      Transaction { From Hash To }
    }
  }
}`;

const rowSchema = z.object({
  Block: z.object({ Time: z.string().nullish(), Number: z.union([z.string(), z.number()]).nullish() }).nullish(),
  Call: z.object({ From: z.string().nullish(), To: z.string().nullish() }).nullish(),
  Transaction: z
    .object({
      From: z.string().nullish(),
      Hash: z.string().nullish(),
      To: z.string().nullish(),
    })
    .nullish(),
});

const responseSchema = z.object({
  data: z.object({ EVM: z.object({ Calls: z.array(rowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryDeploymentInput = {
  /** Which slice of history to read. Defaults to `combined`. */
  dataset?: BitqueryDataset;
  address: string;
  apiKey: string;
  baseUrl?: string;
};

export type BitqueryDeployment = {
  address: string;
  /** What executed the creation: a factory for a launchpad token, the deployer for a direct one. Lower-cased. */
  creator: string;
  /** The account that sent the creating transaction. Lower-cased; absent when the chain did not carry one. */
  origin?: string;
  /** The contract that account called — on a launchpad, the public factory. Lower-cased. */
  entryPoint?: string;
  txHash?: string;
  blockNumber?: number;
  createdAt?: Date;
};

const address = (value: string | null | undefined): string | undefined => {
  const lower = value?.toLowerCase();
  return lower && ADDRESS.test(lower) ? lower : undefined;
};

/** The first creation of this address, or nothing. A malformed row is dropped, never patched. */
export function normalizeBitqueryDeployment(
  rows: readonly z.infer<typeof rowSchema>[] | null | undefined,
  wanted: string,
): BitqueryDeployment | undefined {
  for (const row of rows ?? []) {
    const to = address(row.Call?.To);
    const creator = address(row.Call?.From);
    if (to !== wanted || !creator) continue;
    const at = row.Block?.Time ? new Date(row.Block.Time) : undefined;
    const block = row.Block?.Number === null || row.Block?.Number === undefined ? undefined : Number(row.Block.Number);
    const origin = address(row.Transaction?.From);
    const entryPoint = address(row.Transaction?.To);
    return {
      address: to,
      creator,
      ...(origin && origin !== creator ? { origin } : {}),
      ...(entryPoint && entryPoint !== creator ? { entryPoint } : {}),
      ...(row.Transaction?.Hash ? { txHash: row.Transaction.Hash } : {}),
      ...(block !== undefined && Number.isFinite(block) ? { blockNumber: block } : {}),
      ...(at && !Number.isNaN(at.getTime()) ? { createdAt: at } : {}),
    };
  }
  return undefined;
}

export function createBitqueryDeploymentAdapter(): SourceAdapter<
  BitqueryDeploymentInput,
  BitqueryDeployment | undefined
> {
  return {
    name: 'bitquery',
    canHandle: (input) => ADDRESS.test(input.address) && input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryDeployment | undefined>> {
      const wanted = input.address.toLowerCase();
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
          body: JSON.stringify({ query: deploymentQuery(input.dataset), variables: { address: wanted } }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw new Error(response.errors.map((error) => error.message).join('; '));
            return normalizeBitqueryDeployment(response.data?.EVM?.Calls, wanted);
          },
        },
      );
    },
  };
}

/** The default document, kept as a constant for the contract tests. */
export const BITQUERY_DEPLOYMENT_QUERY = deploymentQuery();
