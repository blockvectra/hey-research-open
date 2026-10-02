import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';
import { BITQUERY_BATCH_SIZE, BITQUERY_DEFAULT_BASE_URL, BITQUERY_NETWORK, BITQUERY_POINTS, bitqueryAnswerError, withBitqueryPoints } from './bitquery';
import { ROBINHOOD_QUOTE_ASSETS } from './bitquery-days';

/**
 * Quarter-hour bars from decoded trades (2026-10-03).
 *
 * The Terminal chart's intraday bars came only from GeckoTerminal's per-pool
 * OHLCV, and GeckoTerminal is HEY's tightest provider (five calls a minute,
 * 7,000 a day across four lanes): its intraday lane can keep about 180 tokens,
 * and on 2026-10-02 none of the 960 live markets had an hour bar newer than
 * two hours. Bitquery — the plan HEY already pays for — decodes every DEX and
 * launchpad trade on the chain, and its realtime dataset charges five points a
 * cube whatever the cube returns, so one request can answer the bars of a
 * hundred tokens at once.
 *
 * One cube, `DEXTradeByTokens`, grouped by token and fifteen-minute block:
 *
 *   open   the price of the bar's first trade   PriceInUSD(minimum: Block_Number)
 *   close  the price of its last trade          PriceInUSD(maximum: Block_Number)
 *   high   the highest trade price              PriceInUSD(maximum: Trade_PriceInUSD)
 *   low    the lowest trade price               PriceInUSD(minimum: Trade_PriceInUSD)
 *   volume the quote side's USD amount, summed  sum(of: Trade_Side_AmountInUSD)
 *
 * Only trades against the chain's quote assets (USDG, WETH, ETH) are read —
 * the same filter the daily index uses, so a token-for-token pair priced off
 * another thin token cannot print a wick a thousand times the market. USD sums
 * are computed on `realtime` only (`archive` answers them as 0), so the
 * document is pinned to `realtime`, which reaches back about four days.
 *
 * Counts and prices only. No address is selected, stored or counted (CLAUDE.md
 * product rule 1). A bucket with no trade is absent — "no trade", never a bar
 * of zeros — and a volume the provider did not give as a number is unknown.
 */
export const BITQUERY_OHLC_INTERVAL_MINUTES = 15;
/** Rows one request may return; an answer that fills it may be cut and is never stored as whole. */
export const BITQUERY_OHLC_ROW_LIMIT = 10_000;
/** Contracts one request may name: the batch every other Bitquery read here uses. */
export const BITQUERY_OHLC_BATCH_SIZE = BITQUERY_BATCH_SIZE;

export const BITQUERY_OHLC_QUERY = `query HeyIntradayBars($addresses: [String!], $quotes: [String!], $since: DateTime, $till: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    bars: DEXTradeByTokens(
      where: {
        Trade: { Currency: { SmartContract: { in: $addresses } }, Side: { Currency: { SmartContract: { in: $quotes } } } }
        Block: { Time: { since: $since, till: $till } }
      }
      limit: { count: ${BITQUERY_OHLC_ROW_LIMIT} }
    ) {
      Block { bucket: Time(interval: { in: minutes, count: ${BITQUERY_OHLC_INTERVAL_MINUTES} }) }
      Trade {
        Currency { SmartContract }
        open: PriceInUSD(minimum: Block_Number)
        close: PriceInUSD(maximum: Block_Number)
        high: PriceInUSD(maximum: Trade_PriceInUSD)
        low: PriceInUSD(minimum: Trade_PriceInUSD)
      }
      trades: count
      volume_usd: sum(of: Trade_Side_AmountInUSD)
    }
  }
}`;

const numberish = z.union([z.number(), z.string()]).nullish();

const rowSchema = z.object({
  Block: z.object({ bucket: z.string().nullish() }).nullish(),
  Trade: z.object({
    Currency: z.object({ SmartContract: z.string() }),
    open: numberish,
    close: numberish,
    high: numberish,
    low: numberish,
  }),
  trades: numberish,
  volume_usd: numberish,
});

const responseSchema = z.object({
  data: z.object({ EVM: z.object({ bars: z.array(rowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryOhlcInput = {
  /** Contract addresses, at most `BITQUERY_OHLC_BATCH_SIZE`; the caller chunks. */
  addresses: readonly string[];
  /** The window, inclusive of `since`; the caller aligns it to a whole hour so every hour inside it is complete. */
  since: Date;
  till: Date;
  apiKey: string;
  baseUrl?: string;
};

/** One token's quarter-hour bar. `volumeUsd` absent is unknown. */
export type TradeBar = {
  contractAddress: string;
  /** The bar's start, UTC, on a quarter hour. */
  start: Date;
  openUsd: number;
  highUsd: number;
  lowUsd: number;
  closeUsd: number;
  trades: number;
  volumeUsd?: number;
};

export type BitqueryOhlcRead = {
  bars: TradeBar[];
  /** Rows the provider returned, before any was dropped. */
  rows: number;
  /** The answer filled the row limit: it may be cut, and must not be stored as complete. */
  truncated: boolean;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUARTER_MS = BITQUERY_OHLC_INTERVAL_MINUTES * 60_000;

const price = (value: number | string | null | undefined): number | undefined => {
  const parsed = toNumber(value);
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * Rows to bars (pure, exported for the contract tests). A row is dropped when
 * its bucket is not a quarter-hour instant, its address is not a contract, or
 * any of its four prices is missing or not positive — a bar with a zero low is
 * a pricing gap, not a crash to nothing. High and low are widened to hold the
 * open and close, which a provider's separate aggregates can miss by a hair.
 * Two rows for one token and bucket keep the first, as the GeckoTerminal sweep
 * does: which is right cannot be known, so nothing is invented by merging.
 */
export function normalizeBitqueryOhlc(rows: readonly z.infer<typeof rowSchema>[]): TradeBar[] {
  const seen = new Set<string>();
  const bars: TradeBar[] = [];
  for (const row of rows) {
    const address = row.Trade.Currency.SmartContract.toLowerCase();
    if (!ADDRESS.test(address)) continue;
    const at = row.Block?.bucket ? Date.parse(row.Block.bucket) : Number.NaN;
    if (!Number.isFinite(at) || at % QUARTER_MS !== 0) continue;
    const open = price(row.Trade.open);
    const close = price(row.Trade.close);
    const high = price(row.Trade.high);
    const low = price(row.Trade.low);
    if (open === undefined || close === undefined || high === undefined || low === undefined) continue;
    const key = `${address}:${at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const volume = toNumber(row.volume_usd);
    const trades = toNumber(row.trades);
    bars.push({
      contractAddress: address,
      start: new Date(at),
      openUsd: open,
      closeUsd: close,
      highUsd: Math.max(high, open, close),
      lowUsd: Math.min(low, open, close),
      trades: trades !== undefined && trades > 0 ? Math.round(trades) : 0,
      ...(volume !== undefined && Number.isFinite(volume) && volume >= 0 ? { volumeUsd: volume } : {}),
    });
  }
  return bars.sort((a, b) => (a.contractAddress === b.contractAddress ? a.start.getTime() - b.start.getTime() : a.contractAddress < b.contractAddress ? -1 : 1));
}

/** Short: every read asks for a different window, and a bar still open moves. */
const CACHE_TTL_SECONDS = 60;

export function createBitqueryOhlcAdapter(): SourceAdapter<BitqueryOhlcInput, BitqueryOhlcRead> {
  return {
    name: 'bitquery-ohlc',
    canHandle: (input) =>
      input.addresses.length > 0 &&
      input.addresses.length <= BITQUERY_OHLC_BATCH_SIZE &&
      input.addresses.every((address) => ADDRESS.test(address)) &&
      input.apiKey.length > 0 &&
      input.since.getTime() < input.till.getTime(),
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryOhlcRead>> {
      const addresses = [...new Set(input.addresses.map((address) => address.toLowerCase()))];
      return withBitqueryPoints(
        await performSourceFetch(
          ctx,
          {
            url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
            body: JSON.stringify({
              query: BITQUERY_OHLC_QUERY,
              variables: { addresses, quotes: [...ROBINHOOD_QUOTE_ASSETS], since: input.since.toISOString(), till: input.till.toISOString() },
            }),
            allowedContentTypes: ['application/json'],
          },
          {
            schema: responseSchema,
            parse: (body) => JSON.parse(body),
            cacheTtlSeconds: CACHE_TTL_SECONDS,
            normalize: (raw) => {
              if (raw.errors && raw.errors.length > 0) throw bitqueryAnswerError(raw.errors);
              const rows = raw.data?.EVM?.bars ?? [];
              return { bars: normalizeBitqueryOhlc(rows), rows: rows.length, truncated: rows.length >= BITQUERY_OHLC_ROW_LIMIT };
            },
          },
        ),
        BITQUERY_POINTS.perRealtimeCube,
      );
    },
  };
}
