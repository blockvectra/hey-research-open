import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import {
  BITQUERY_BATCH_SIZE,
  BITQUERY_DEFAULT_BASE_URL,
  BITQUERY_DEFAULT_DATASET,
  BITQUERY_NETWORK,
  type BitqueryDataset,
} from './bitquery';

/**
 * Bitquery, by the day (2026-09-13): the rows HEY's own daily index is built
 * from. Two adapters, one document each:
 *
 * - `createBitqueryTradeDaysAdapter`: for up to a hundred tokens, every
 *   (token, day, side) row since a moment — trades, USD volume, the day's
 *   last price — and every (token, day) transfer count. Counts of trades and
 *   transfers, never of accounts.
 * - `createBitqueryChainDaysAdapter`: the chain's own days — DEX trades,
 *   pools and tokens that traded, USD volume against the known quote assets
 *   (a conditional sum on the tokens cube rather than a cube of its own),
 *   transactions and transfers.
 *
 * The dataset is a parameter (2026-09-22). These queries were written against
 * `realtime`, which reaches back four or five days — so the callers ran daily
 * and kept what they read, and HEY's daily index could never be built for a
 * token it discovered late. The historical add-on makes the same documents
 * answer for any window. The default stays `realtime`
 * (BITQUERY_DEFAULT_DATASET), because only realtime computes USD sums;
 * `archive` and `combined` answer them as 0, so a history read keeps counts
 * and leaves volume unknown (2026-09-24).
 *
 * A flat five points a cube on the Pro plan.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CACHE_TTL_SECONDS = 30 * 60;

/**
 * The assets a trade is priced in on Robinhood Chain: the chain's dollar
 * (USDG), wrapped ether and ether itself. A day's volume counts only trades
 * against these, so one mispriced pair cannot print a trillion-dollar day —
 * the unfiltered sum did exactly that on 2026-09-11.
 */
export const ROBINHOOD_QUOTE_ASSETS = [
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  '0x0000000000000000000000000000000000000000',
] as const;

/**
 * The `breadth:` cube is a second alias of the same table, deliberately not
 * grouped by trade side (2026-09-15).
 *
 * `trades:` groups by `Side.Type`, which is what gives buys and sells their own
 * counts and volumes — but it means a distinct-address count there is a count
 * per side, and the two cannot be added: an address that bought and sold would
 * be counted twice. Asking again without the grouping is the only way to get
 * the honest union, and it also gives an exact pool count per token-day rather
 * than a per-side one. Five more points a request, sixty requests a day.
 *
 * Every figure here is a count. No address is selected, stored or named
 * (CLAUDE.md product rule 1).
 */
/**
 * The document, for a given dataset.
 *
 * The `transfers:` cube is dropped on `archive` (2026-09-22). The historical
 * add-on is granted per cube — `DEXTradeByTokens`, `DEXTrades`, `Calls`,
 * `Events` — and `Transfers` is not among them, so a single Transfers cube
 * anywhere in the document fails the whole request with a 403. The trade and
 * breadth cubes are the ones a price history is built from; transfer counts
 * are context the daily sweep already collects inside the realtime window.
 *
 * Found by running it: the first backfill attempt asked for all three cubes on
 * `archive` and the provider answered with the grant, verbatim.
 */
export const tradeDaysQuery = (
  dataset: BitqueryDataset = BITQUERY_DEFAULT_DATASET,
): string => `query HeyTradeDays($addresses: [String!], $since: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: ${dataset}) {
    trades: DEXTradeByTokens(
      where: { Trade: { Currency: { SmartContract: { in: $addresses } } }, Block: { Time: { since: $since } } }
      limit: { count: 5000 }
    ) {
      Block { Date }
      Trade { Currency { SmartContract } Side { Type } close: PriceInUSD(maximum: Block_Number) }
      trades: count
      volume_usd: sum(of: Trade_Side_AmountInUSD)
    }
    breadth: DEXTradeByTokens(
      where: { Trade: { Currency: { SmartContract: { in: $addresses } } }, Block: { Time: { since: $since } } }
      limit: { count: 5000 }
    ) {
      Block { Date }
      Trade { Currency { SmartContract } }
      addresses: count(distinct: Transaction_From)
      buyers: count(distinct: Transaction_From, if: { Trade: { Side: { Type: { is: buy } } } })
      sellers: count(distinct: Transaction_From, if: { Trade: { Side: { Type: { is: sell } } } })
      pools: count(distinct: Trade_Dex_SmartContract)
    }
    ${
      dataset === 'realtime'
        ? `transfers: Transfers(
      where: { Transfer: { Currency: { SmartContract: { in: $addresses } } }, Block: { Time: { since: $since } } }
      limit: { count: 2000 }
    ) {
      Block { Date }
      Transfer { Currency { SmartContract } }
      transfers: count
    }`
        : ''
    }
  }
}`;

/** The default document, kept as a constant for the contract tests. */
export const BITQUERY_TRADE_DAYS_QUERY = tradeDaysQuery();

/*
 * Realtime only, and not a parameter: this document reads `Transactions` and
 * `Transfers`, neither of which the historical add-on covers.
 */
export const chainDaysQuery = (): string => `query HeyChainDays($since: DateTime, $quotes: [String!]) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    trades: DEXTrades(where: { Block: { Time: { since: $since } } }, limit: { count: 100 }) {
      Block { Date }
      trades: count
      pools: count(distinct: Trade_Dex_SmartContract)
    }
    tokens: DEXTradeByTokens(where: { Block: { Time: { since: $since } } }, limit: { count: 100 }) {
      Block { Date }
      tokens: count(distinct: Trade_Currency_SmartContract)
      volume_usd: sum(of: Trade_Side_AmountInUSD, if: { Trade: { Side: { Currency: { SmartContract: { in: $quotes } } } } })
    }
    transactions: Transactions(where: { Block: { Time: { since: $since } } }, limit: { count: 100 }) {
      Block { Date }
      transactions: count
    }
    transfers: Transfers(where: { Block: { Time: { since: $since } } }, limit: { count: 100 }) {
      Block { Date }
      transfers: count
    }
  }
}`;

export const BITQUERY_CHAIN_DAYS_QUERY = chainDaysQuery();

const numberish = z.union([z.number(), z.string()]).nullish();
const dayBlock = z.object({ Date: z.string() });

const tradeRowSchema = z.object({
  Block: dayBlock,
  Trade: z.object({ Currency: z.object({ SmartContract: z.string() }), Side: z.object({ Type: z.string().nullish() }).nullish(), close: numberish }),
  trades: numberish,
  volume_usd: numberish,
});
const breadthRowSchema = z.object({
  Block: dayBlock,
  Trade: z.object({ Currency: z.object({ SmartContract: z.string() }) }),
  addresses: numberish,
  buyers: numberish,
  sellers: numberish,
  pools: numberish,
});
const transferRowSchema = z.object({ Block: dayBlock, Transfer: z.object({ Currency: z.object({ SmartContract: z.string() }) }), transfers: numberish });

const tradeDaysResponseSchema = z.object({
  data: z
    .object({
      EVM: z
        .object({
          trades: z.array(tradeRowSchema).nullish(),
          breadth: z.array(breadthRowSchema).nullish(),
          transfers: z.array(transferRowSchema).nullish(),
        })
        .nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

const chainDaysResponseSchema = z.object({
  data: z
    .object({
      EVM: z
        .object({
          trades: z.array(z.object({ Block: dayBlock, trades: numberish, pools: numberish })).nullish(),
          tokens: z.array(z.object({ Block: dayBlock, tokens: numberish, volume_usd: numberish })).nullish(),
          transactions: z.array(z.object({ Block: dayBlock, transactions: numberish })).nullish(),
          transfers: z.array(z.object({ Block: dayBlock, transfers: numberish })).nullish(),
        })
        .nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryTradeDaysInput = {
  addresses: readonly string[];
  since: Date;
  apiKey: string;
  baseUrl?: string;
  /** Which slice of history to read. Defaults to `realtime`, the only dataset that computes USD. */
  dataset?: BitqueryDataset;
};

/** One token's one UTC day, as decoded trades saw it. */
export type BitqueryTokenDay = {
  contractAddress: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  trades: number;
  buys: number;
  sells: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  /**
   * Counts of the addresses behind the day's trades (2026-09-15). Absent means
   * the provider did not answer, never zero — a token that was not traded has
   * no row at all.
   */
  distinctAddresses?: number;
  distinctBuyers?: number;
  distinctSellers?: number;
  /** How many pools the token actually traded in that day. */
  poolsTraded?: number;
  /** The day's last trade price in USD, when any trade carried one. */
  closeUsd?: number;
  transfers?: number;
};

export type BitqueryChainDaysInput = {
  since: Date;
  apiKey: string;
  baseUrl?: string;
  quoteAssets?: readonly string[];
};

export type BitqueryChainDay = {
  day: string;
  dexTrades?: number;
  poolsTraded?: number;
  tokensTraded?: number;
  dexVolumeUsd?: number;
  transactions?: number;
  transfers?: number;
};

const whole = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? Math.round(parsed) : 0;
};
const money = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 && Number.isFinite(parsed) ? parsed : 0;
};
const price = (value: number | string | null | undefined): number | undefined => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 && Number.isFinite(parsed) ? parsed : undefined;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Side rows → one row per (token, day). A malformed day is dropped, never guessed. */
export function normalizeBitqueryTokenDays(
  trades: readonly z.infer<typeof tradeRowSchema>[],
  transfers: readonly z.infer<typeof transferRowSchema>[],
  breadth: readonly z.infer<typeof breadthRowSchema>[] = [],
): BitqueryTokenDay[] {
  const byKey = new Map<string, BitqueryTokenDay>();
  const keyOf = (address: string, day: string) => `${address}:${day}`;
  for (const row of trades) {
    const address = row.Trade.Currency.SmartContract.toLowerCase();
    const day = row.Block.Date;
    if (!ADDRESS.test(address) || !DAY.test(day)) continue;
    const current = byKey.get(keyOf(address, day)) ?? { contractAddress: address, day, trades: 0, buys: 0, sells: 0, buyVolumeUsd: 0, sellVolumeUsd: 0 };
    const count = whole(row.trades);
    const volume = money(row.volume_usd);
    const side = row.Trade.Side?.Type?.toLowerCase();
    current.trades += count;
    if (side === 'sell') {
      current.sells += count;
      current.sellVolumeUsd += volume;
    } else {
      current.buys += count;
      current.buyVolumeUsd += volume;
    }
    const close = price(row.Trade.close);
    if (close !== undefined) current.closeUsd = current.closeUsd === undefined ? close : side === 'sell' ? close : current.closeUsd;
    byKey.set(keyOf(address, day), current);
  }
  /*
   * Breadth rows are one per (token, day) and only attach to a day the trade
   * rows already produced — a count with no trades behind it would be a figure
   * about nothing. A zero from the provider is stored as a zero here only
   * because a traded day with no distinct addresses is impossible; anything
   * missing stays undefined.
   */
  for (const row of breadth) {
    const address = row.Trade.Currency.SmartContract.toLowerCase();
    const day = row.Block.Date;
    if (!ADDRESS.test(address) || !DAY.test(day)) continue;
    const current = byKey.get(keyOf(address, day));
    if (!current) continue;
    const positive = (value: number | string | null | undefined): number | undefined => {
      const parsed = toNumber(value);
      return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
    };
    const addresses = positive(row.addresses);
    const buyers = positive(row.buyers);
    const sellers = positive(row.sellers);
    const pools = positive(row.pools);
    if (addresses !== undefined) current.distinctAddresses = addresses;
    if (buyers !== undefined) current.distinctBuyers = buyers;
    if (sellers !== undefined) current.distinctSellers = sellers;
    if (pools !== undefined) current.poolsTraded = pools;
  }

  for (const row of transfers) {
    const address = row.Transfer.Currency.SmartContract.toLowerCase();
    const day = row.Block.Date;
    if (!ADDRESS.test(address) || !DAY.test(day)) continue;
    const current = byKey.get(keyOf(address, day)) ?? { contractAddress: address, day, trades: 0, buys: 0, sells: 0, buyVolumeUsd: 0, sellVolumeUsd: 0 };
    current.transfers = (current.transfers ?? 0) + whole(row.transfers);
    byKey.set(keyOf(address, day), current);
  }
  return [...byKey.values()].sort((a, b) => a.contractAddress.localeCompare(b.contractAddress) || a.day.localeCompare(b.day));
}

export function normalizeBitqueryChainDays(data: NonNullable<NonNullable<z.infer<typeof chainDaysResponseSchema>['data']>['EVM']>): BitqueryChainDay[] {
  const byDay = new Map<string, BitqueryChainDay>();
  const at = (day: string): BitqueryChainDay | undefined => {
    if (!DAY.test(day)) return undefined;
    const current = byDay.get(day) ?? { day };
    byDay.set(day, current);
    return current;
  };
  for (const row of data.trades ?? []) {
    const d = at(row.Block.Date);
    if (d) Object.assign(d, { dexTrades: whole(row.trades), poolsTraded: whole(row.pools) });
  }
  for (const row of data.tokens ?? []) {
    const d = at(row.Block.Date);
    if (!d) continue;
    d.tokensTraded = whole(row.tokens);
    // Volume shares this cube (2026-09-15): it was a second alias of the same
    // table filtered to the quote assets, and a filtered sum says the same
    // thing for five points less.
    d.dexVolumeUsd = money(row.volume_usd);
  }
  for (const row of data.transactions ?? []) {
    const d = at(row.Block.Date);
    if (d) d.transactions = whole(row.transactions);
  }
  for (const row of data.transfers ?? []) {
    const d = at(row.Block.Date);
    if (d) d.transfers = whole(row.transfers);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

const post = (input: { apiKey: string; baseUrl?: string }, query: string, variables: Record<string, unknown>) => ({
  url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
  method: 'POST' as const,
  headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
  body: JSON.stringify({ query, variables }),
  allowedContentTypes: ['application/json'],
});

export function createBitqueryTradeDaysAdapter(): SourceAdapter<BitqueryTradeDaysInput, BitqueryTokenDay[]> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      input.addresses.length > 0 && input.addresses.length <= BITQUERY_BATCH_SIZE && input.addresses.every((address) => ADDRESS.test(address)) && input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryTokenDay[]>> {
      const addresses = [...new Set(input.addresses.map((address) => address.toLowerCase()))];
      return performSourceFetch(ctx, post(input, tradeDaysQuery(input.dataset), { addresses, since: input.since.toISOString() }), {
        schema: tradeDaysResponseSchema,
        parse: (body) => JSON.parse(body),
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        normalize: (response) => {
          if (response.errors?.length) throw new Error(response.errors.map((error) => error.message).join('; '));
          return normalizeBitqueryTokenDays(
              response.data?.EVM?.trades ?? [],
              response.data?.EVM?.transfers ?? [],
              response.data?.EVM?.breadth ?? [],
            );
        },
      });
    },
  };
}

export function createBitqueryChainDaysAdapter(): SourceAdapter<BitqueryChainDaysInput, BitqueryChainDay[]> {
  return {
    name: 'bitquery',
    canHandle: (input) => input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryChainDay[]>> {
      const quotes = [...(input.quoteAssets ?? ROBINHOOD_QUOTE_ASSETS)];
      return performSourceFetch(ctx, post(input, chainDaysQuery(), { since: input.since.toISOString(), quotes }), {
        schema: chainDaysResponseSchema,
        parse: (body) => JSON.parse(body),
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        normalize: (response) => {
          if (response.errors?.length) throw new Error(response.errors.map((error) => error.message).join('; '));
          return normalizeBitqueryChainDays(response.data?.EVM ?? {});
        },
      });
    },
  };
}
