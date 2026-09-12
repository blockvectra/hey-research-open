import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { BITQUERY_BATCH_SIZE, BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK } from './bitquery';

/**
 * Bitquery, by the day (2026-09-13): the rows HEY's own daily index is built
 * from. Two adapters, one document each:
 *
 * - `createBitqueryTradeDaysAdapter`: for up to a hundred tokens, every
 *   (token, day, side) row since a moment — trades, USD volume, the day's
 *   last price — and every (token, day) transfer count. Counts of trades and
 *   transfers, never of accounts.
 * - `createBitqueryChainDaysAdapter`: the chain's own days — DEX trades,
 *   pools and tokens that traded, USD volume against the known quote assets,
 *   transactions and transfers.
 *
 * The realtime dataset holds four or five days, so the callers run daily and
 * keep what they read; a flat five points a cube on the Pro plan.
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

export const BITQUERY_TRADE_DAYS_QUERY = `query HeyTradeDays($addresses: [String!], $since: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    trades: DEXTradeByTokens(
      where: { Trade: { Currency: { SmartContract: { in: $addresses } } }, Block: { Time: { since: $since } } }
      limit: { count: 5000 }
    ) {
      Block { Date }
      Trade { Currency { SmartContract } Side { Type } close: PriceInUSD(maximum: Block_Number) }
      trades: count
      volume_usd: sum(of: Trade_Side_AmountInUSD)
    }
    transfers: Transfers(
      where: { Transfer: { Currency: { SmartContract: { in: $addresses } } }, Block: { Time: { since: $since } } }
      limit: { count: 2000 }
    ) {
      Block { Date }
      Transfer { Currency { SmartContract } }
      transfers: count
    }
  }
}`;

export const BITQUERY_CHAIN_DAYS_QUERY = `query HeyChainDays($since: DateTime, $quotes: [String!]) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    trades: DEXTrades(where: { Block: { Time: { since: $since } } }, limit: { count: 100 }) {
      Block { Date }
      trades: count
      pools: count(distinct: Trade_Dex_SmartContract)
    }
    tokens: DEXTradeByTokens(where: { Block: { Time: { since: $since } } }, limit: { count: 100 }) {
      Block { Date }
      tokens: count(distinct: Trade_Currency_SmartContract)
    }
    volume: DEXTradeByTokens(
      where: { Block: { Time: { since: $since } }, Trade: { Side: { Currency: { SmartContract: { in: $quotes } } } } }
      limit: { count: 100 }
    ) {
      Block { Date }
      volume_usd: sum(of: Trade_Side_AmountInUSD)
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

const numberish = z.union([z.number(), z.string()]).nullish();
const dayBlock = z.object({ Date: z.string() });

const tradeRowSchema = z.object({
  Block: dayBlock,
  Trade: z.object({ Currency: z.object({ SmartContract: z.string() }), Side: z.object({ Type: z.string().nullish() }).nullish(), close: numberish }),
  trades: numberish,
  volume_usd: numberish,
});
const transferRowSchema = z.object({ Block: dayBlock, Transfer: z.object({ Currency: z.object({ SmartContract: z.string() }) }), transfers: numberish });

const tradeDaysResponseSchema = z.object({
  data: z.object({ EVM: z.object({ trades: z.array(tradeRowSchema).nullish(), transfers: z.array(transferRowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

const chainDaysResponseSchema = z.object({
  data: z
    .object({
      EVM: z
        .object({
          trades: z.array(z.object({ Block: dayBlock, trades: numberish, pools: numberish })).nullish(),
          tokens: z.array(z.object({ Block: dayBlock, tokens: numberish })).nullish(),
          volume: z.array(z.object({ Block: dayBlock, volume_usd: numberish })).nullish(),
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
  /** The day's last trade price in USD, when any trade carried one. */
  closeUsd?: number;
  transfers?: number;
};

export type BitqueryChainDaysInput = { since: Date; apiKey: string; baseUrl?: string; quoteAssets?: readonly string[] };

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
    if (d) d.tokensTraded = whole(row.tokens);
  }
  for (const row of data.volume ?? []) {
    const d = at(row.Block.Date);
    if (d) d.dexVolumeUsd = money(row.volume_usd);
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
      return performSourceFetch(ctx, post(input, BITQUERY_TRADE_DAYS_QUERY, { addresses, since: input.since.toISOString() }), {
        schema: tradeDaysResponseSchema,
        parse: (body) => JSON.parse(body),
        cacheTtlSeconds: CACHE_TTL_SECONDS,
        normalize: (response) => {
          if (response.errors?.length) throw new Error(response.errors.map((error) => error.message).join('; '));
          return normalizeBitqueryTokenDays(response.data?.EVM?.trades ?? [], response.data?.EVM?.transfers ?? []);
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
      return performSourceFetch(ctx, post(input, BITQUERY_CHAIN_DAYS_QUERY, { since: input.since.toISOString(), quotes }), {
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
