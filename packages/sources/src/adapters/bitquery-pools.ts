import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { BITQUERY_BATCH_SIZE, BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, bitqueryAnswerError } from './bitquery';

/**
 * A token's pools, and how much of it can actually be sold (2026-09-15).
 *
 * HEY's liquidity figure came from an aggregator, which reports the deepest
 * pool and calls it the token's. On PONS that read $5.87M against $24.53M
 * across its pools, and the endpoint lists thirty pools at most where the
 * chain has fifty-six. This reads the pools themselves.
 *
 * The second cube is the one worth having. `DEXPoolSlippages` publishes, per
 * pool, how much can be traded before the price moves by a fixed amount —
 * `MaxAmountIn` at 100 basis points is what can be sold for a one per cent
 * move. A reader can act on that. Nobody has ever been able to act on
 * "liquidity $5.9M", and on this chain that number was usually a single pool's
 * anyway.
 *
 * **A token is not always CurrencyA.** $HEY is CurrencyB in its only pool, so
 * a one-sided filter finds nothing for it at all — which is why both cubes
 * match on either side with `any:` and the normaliser works out which side the
 * token sits on before reading a depth from it.
 *
 * Counts, prices and pool reserves. No address beyond the pool contracts
 * themselves, which are markets rather than holders.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 30 * 60;

/** One per cent. The level a reader understands without being told what a basis point is. */
export const DEPTH_BASIS_POINTS = 100;

/*
 * Realtime only, and not a parameter: `DEXPoolEvents` and `DEXPoolSlippages`
 * are outside the historical add-on's grant, so this document can never read
 * the archive (see `BITQUERY_ARCHIVE_CUBES`).
 */
export const BITQUERY_POOLS_QUERY = `query HeyTokenPools($addresses: [String!], $since: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    pools: DEXPoolEvents(
      where: {
        Block: { Time: { since: $since } }
        any: [
          { PoolEvent: { Pool: { CurrencyA: { SmartContract: { in: $addresses } } } } }
          { PoolEvent: { Pool: { CurrencyB: { SmartContract: { in: $addresses } } } } }
        ]
      }
      limit: { count: 5000 }
    ) {
      PoolEvent {
        Pool {
          SmartContract
          CurrencyA { SmartContract }
          CurrencyB { SmartContract }
        }
        Liquidity {
          a: AmountCurrencyAInUSD(maximum: Block_Number)
          b: AmountCurrencyBInUSD(maximum: Block_Number)
        }
      }
      events: count
    }
    depth: DEXPoolSlippages(
      where: {
        Block: { Time: { since: $since } }
        Price: { SlippageBasisPoints: { eq: ${DEPTH_BASIS_POINTS} } }
        any: [
          { Price: { Pool: { CurrencyA: { SmartContract: { in: $addresses } } } } }
          { Price: { Pool: { CurrencyB: { SmartContract: { in: $addresses } } } } }
        ]
      }
      limit: { count: 5000 }
    ) {
      Price {
        Pool {
          SmartContract
          CurrencyA { SmartContract }
          CurrencyB { SmartContract }
        }
        AtoB { sellingA: MaxAmountIn(maximum: Block_Number) }
        BtoA { sellingB: MaxAmountIn(maximum: Block_Number) }
      }
    }
  }
}`;

const numberish = z.union([z.number(), z.string()]).nullish();
const poolSchema = z.object({
  SmartContract: z.string().nullish(),
  CurrencyA: z.object({ SmartContract: z.string().nullish() }).nullish(),
  CurrencyB: z.object({ SmartContract: z.string().nullish() }).nullish(),
});

const poolRowSchema = z.object({
  PoolEvent: z.object({
    Pool: poolSchema,
    Liquidity: z.object({ a: numberish, b: numberish }).nullish(),
  }),
  events: numberish,
});

const depthRowSchema = z.object({
  Price: z.object({
    Pool: poolSchema,
    AtoB: z.object({ sellingA: numberish }).nullish(),
    BtoA: z.object({ sellingB: numberish }).nullish(),
  }),
});

const responseSchema = z.object({
  data: z
    .object({
      EVM: z.object({ pools: z.array(poolRowSchema).nullish(), depth: z.array(depthRowSchema).nullish() }).nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryPoolsInput = {
  /** Token contracts, at most `BITQUERY_BATCH_SIZE`; the caller chunks. */
  addresses: readonly string[];
  /** Pool state at or after this moment; the newest reading in the window wins. */
  since: Date;
  apiKey: string;
  baseUrl?: string;
};

/** One token's pools as the chain last reported them. */
export type BitqueryTokenPools = {
  tokenAddress: string;
  /** How many distinct pools the token has state in. */
  pools: number;
  /** Both sides of every pool, in USD — the token's whole market, not its deepest pool. */
  liquidityUsd?: number;
  /**
   * How much of the token can be sold before the price moves one per cent,
   * in whole tokens, added up across its pools. The caller prices it.
   */
  depthOnePctBase?: number;
  /** Pool events seen in the window; a pool with none is quiet, not absent. */
  events: number;
};

const money = (value: number | string | null | undefined): number | undefined => {
  const parsed = toNumber(value);
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Which side of the pool the token sits on, or nothing if it is neither. */
const sideOf = (pool: z.infer<typeof poolSchema>, wanted: ReadonlySet<string>): 'a' | 'b' | undefined => {
  const a = pool.CurrencyA?.SmartContract?.toLowerCase();
  const b = pool.CurrencyB?.SmartContract?.toLowerCase();
  if (a && wanted.has(a)) return 'a';
  if (b && wanted.has(b)) return 'b';
  return undefined;
};
const tokenOf = (pool: z.infer<typeof poolSchema>, side: 'a' | 'b'): string | undefined =>
  (side === 'a' ? pool.CurrencyA?.SmartContract : pool.CurrencyB?.SmartContract)?.toLowerCase();

export function normalizeBitqueryPools(
  data: NonNullable<NonNullable<z.infer<typeof responseSchema>['data']>['EVM']>,
  addresses: readonly string[],
): BitqueryTokenPools[] {
  const wanted = new Set(addresses.map((address) => address.toLowerCase()));
  const byToken = new Map<string, BitqueryTokenPools & { seen: Set<string>; seenDepth: Set<string>; seenLiquidity?: Set<string>; sawEmpty?: boolean }>();
  const at = (token: string) => {
    const current = byToken.get(token) ?? { tokenAddress: token, pools: 0, events: 0, seen: new Set<string>(), seenDepth: new Set<string>() };
    byToken.set(token, current);
    return current;
  };

  for (const row of data.pools ?? []) {
    const side = sideOf(row.PoolEvent.Pool, wanted);
    if (!side) continue;
    const token = tokenOf(row.PoolEvent.Pool, side);
    const pool = row.PoolEvent.Pool.SmartContract?.toLowerCase();
    if (!token || !ADDRESS.test(token)) continue;
    const entry = at(token);
    if (pool && !entry.seen.has(pool)) {
      entry.seen.add(pool);
      entry.pools += 1;
    }
    entry.events += toNumber(row.events) ?? 0;
    /*
     * A pool's liquidity is both of its sides. The token side alone would
     * halve a balanced pool and mislead on an unbalanced one, and every
     * aggregator quotes the whole pool.
     */
    const total = (money(row.PoolEvent.Liquidity?.a) ?? 0) + (money(row.PoolEvent.Liquidity?.b) ?? 0);
    // Once per pool (2026-09-18): the provider returns one row per event and
    // the sum ran over all of them — yolo's one pool read $5,078 against the
    // card's $1, and 16 of 608 tokens were ten times their own market reading.
    // A pool the provider priced at nothing is an empty pool, not an unread one (2026-09-25).
    const raw = [row.PoolEvent.Liquidity?.a, row.PoolEvent.Liquidity?.b].filter((value) => value !== undefined && value !== null);
    if (total === 0 && raw.length > 0 && raw.every((value) => Number(value) === 0)) entry.sawEmpty = true;
    if (total > 0 && (!pool || !entry.seenLiquidity?.has(pool))) {
      entry.liquidityUsd = (entry.liquidityUsd ?? 0) + total;
      if (pool) (entry.seenLiquidity ??= new Set<string>()).add(pool);
    }
  }

  for (const row of data.depth ?? []) {
    const side = sideOf(row.Price.Pool, wanted);
    if (!side) continue;
    const token = tokenOf(row.Price.Pool, side);
    if (!token || !ADDRESS.test(token)) continue;
    // Selling the token means A→B when it is A, and B→A when it is B; taking
    // the wrong direction would quote the depth of the quote asset instead.
    const amount = money(side === 'a' ? row.Price.AtoB?.sellingA : row.Price.BtoA?.sellingB);
    if (amount === undefined) continue;
    const entry = at(token);
    // Once per pool, like liquidity (2026-09-18): summed over every returned
    // slippage row, apple-robinhood-token's 1% depth came to 4,900× its supply.
    const depthPool = row.Price.Pool.SmartContract?.toLowerCase();
    if (depthPool && entry.seenDepth.has(depthPool)) continue;
    if (depthPool) entry.seenDepth.add(depthPool);
    entry.depthOnePctBase = (entry.depthOnePctBase ?? 0) + amount;
  }

  return [...byToken.values()]
    // Every priced reading empty and none with liquidity: the pools hold nothing, so say 0 rather than
    // leave the figure unknown — an unknown kept the pre-drain total in the index all day.
    .map(({ seen: _seen, seenDepth: _seenDepth, seenLiquidity: _seenLiquidity, sawEmpty, ...rest }) =>
      rest.liquidityUsd === undefined && sawEmpty ? { ...rest, liquidityUsd: 0 } : rest,
    )
    .sort((a, b) => a.tokenAddress.localeCompare(b.tokenAddress));
}

export function createBitqueryPoolsAdapter(): SourceAdapter<BitqueryPoolsInput, BitqueryTokenPools[]> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      input.addresses.length > 0 &&
      input.addresses.length <= BITQUERY_BATCH_SIZE &&
      input.addresses.every((address) => ADDRESS.test(address)) &&
      input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryTokenPools[]>> {
      const addresses = [...new Set(input.addresses.map((address) => address.toLowerCase()))];
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({ query: BITQUERY_POOLS_QUERY, variables: { addresses, since: input.since.toISOString() } }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (response) => {
            if (response.errors?.length) throw bitqueryAnswerError(response.errors);
            return normalizeBitqueryPools(response.data?.EVM ?? {}, addresses);
          },
        },
      );
    },
  };
}
