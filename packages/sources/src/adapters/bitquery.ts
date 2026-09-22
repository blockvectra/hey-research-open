import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { toNumber } from '../market';

/**
 * Bitquery: decoded DEX and launchpad trades on Robinhood Chain (Market
 * Lens, 2026-09-12).
 *
 * 772 of HEY's 2,308 published tokens have no pool any aggregator indexes —
 * Pons and Clanker launches still on their curves, and pools the aggregators
 * have not picked up. Bitquery decodes those venues (Pons, Clanker, Virtuals,
 * hood.fun, Flap.sh, Uniswap v4) into one GraphQL schema, so one request
 * answers, for up to a hundred contracts: the last trade's USD price, the
 * day's USD volume and trade count, when the last trade happened, and which
 * protocol it happened on. Nothing about holders or balances is asked for,
 * ever (CLAUDE.md product rule 1).
 *
 * The dataset is no longer hardcoded (2026-09-22). `realtime` was the only one
 * the plan allowed — `combined` spans the archive and answered 403, verified
 * 2026-09-12 — and every query in this package was written against it. The
 * founder then bought the Robinhood Historical Trading Data add-on, and
 * nothing was updated: ten queries kept asking for a dataset that reaches back
 * about four days while the archive the add-on unlocked sat unread.
 *
 * Probed live on 2026-09-22 for a window in early August: `realtime` returned
 * nothing, `archive` and `combined` both returned real trades. So the default
 * is now `combined`, which spans both and is a strict superset of what these
 * queries used to see.
 *
 * The token is an OAuth access token (`ory_…`), sent as a bearer; the old
 * `X-API-KEY` header answers 402 on the v2 endpoint.
 *
 * `DEXTradeByTokens` groups by token and protocol, so a token trading on two
 * venues comes back as two rows; the normaliser sums volume and trades across
 * them and takes the price from the most recent trade. Aggregates arrive as
 * strings. A token with no trade in the window is simply absent: that is
 * "no trade since", not "no market", and the caller keeps the two apart.
 *
 * Paid, points-metered. The key travels as a bearer token; the worker alone
 * holds it (PRD V4 section 27; CLAUDE.md architecture rule 13).
 */
export const BITQUERY_DEFAULT_BASE_URL = 'https://streaming.bitquery.io/graphql';
export const BITQUERY_NETWORK = 'robinhood';
export const BITQUERY_BATCH_SIZE = 100;

/**
 * How long a caller waits between Bitquery requests (2026-09-15).
 *
 * This lived as three private constants and one inline literal across five
 * call sites, all of them 1,000 or 1,500 ms and none of them a shared ceiling.
 * The real limit is the provider's ninety a minute, now encoded once in
 * `PROVIDER_RATE_LIMITS`; this is the courtesy gap on top of it, so a single
 * sweep does not spend the whole allowance in its first ten seconds.
 */
export const BITQUERY_SPACING_MS = 1_000;

/** The day's trades are what the status reads; a reading an hour old is fine. */
const CACHE_TTL_SECONDS = 60 * 60;

/**
 * Which slice of chain history a query may see.
 *
 * `realtime` reaches back about four days and is right for a job that only
 * needs the last day. `archive` is the historical add-on. `combined` spans
 * both and is the default, so a query written for a recent window keeps
 * working and a query given an older window starts finding things.
 */
export type BitqueryDataset = 'realtime' | 'archive' | 'combined';
export const BITQUERY_DEFAULT_DATASET: BitqueryDataset = 'combined';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/*
 * Two windows in one request (2026-09-12, after the first production pass):
 * the day's trades give the volume and the trade count the market status
 * reads; the week's give the last trade's price for a token that traded
 * recently but not today — 4 of 100 unpriced launches had a trade in the
 * week, 1 in the day. A token absent from both traded in neither.
 */
/**
 * One cube, two windows (2026-09-15).
 *
 * This asked the same table twice — once over the day for trades and volume,
 * once over the week for the price of a token that did not trade today — and
 * paid for both, because Bitquery charges five points a cube and an aliased
 * repeat is a second cube. The week is a superset of the day, so the day's
 * figures are a conditional aggregate inside it: `count(if: …)` and
 * `sum(of: …, if: …)` bounded to `$since`. Half the points, same answer,
 * 880 points a day at the current cadence.
 *
 * The price and its timestamp are the week's last trade. Whether that trade
 * falls inside the day is then a comparison the caller can make, rather than
 * a second request.
 */
export const BITQUERY_TRADES_QUERY = `query HeyTokenTrades($addresses: [String!], $since: DateTime, $lookback: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    week: DEXTradeByTokens(
      where: { Trade: { Currency: { SmartContract: { in: $addresses } } }, Block: { Time: { since: $lookback } } }
      limit: { count: 1000 }
    ) {
      Trade {
        Currency { SmartContract Symbol Name Decimals }
        Dex { ProtocolName ProtocolFamily }
        last_price: PriceInUSD(maximum: Block_Number)
      }
      Block { last_time: Time(maximum: Block_Number) }
      trades: count(if: { Block: { Time: { since: $since } } })
      volume_usd: sum(of: Trade_Side_AmountInUSD, if: { Block: { Time: { since: $since } } })
      week_trades: count
    }
  }
}`;

const numberish = z.union([z.number(), z.string()]).nullish();

const rowSchema = z.object({
  Trade: z.object({
    Currency: z.object({
      SmartContract: z.string(),
      Symbol: z.string().nullish(),
      Name: z.string().nullish(),
      Decimals: numberish,
    }),
    Dex: z.object({ ProtocolName: z.string().nullish(), ProtocolFamily: z.string().nullish() }).nullish(),
    last_price: numberish,
  }),
  Block: z.object({ last_time: z.string().nullish() }).nullish(),
  trades: numberish,
  volume_usd: numberish,
  week_trades: numberish,
});

const responseSchema = z.object({
  data: z.object({ EVM: z.object({ week: z.array(rowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryTradesInput = {
  /** Contract addresses, at most `BITQUERY_BATCH_SIZE`; the caller chunks. */
  addresses: readonly string[];
  /** Trades at or after this moment are counted as the day's volume and trade count. */
  since: Date;
  /** Trades at or after this moment may carry the last price (the week's window). */
  lookback: Date;
  apiKey: string;
  baseUrl?: string;
};

export type BitqueryTokenTrades = {
  contractAddress: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  /** The most recent trade's USD price across venues. */
  lastPriceUsd?: number;
  lastTradeAt?: Date;
  /** Trades and USD volume since `since` (the day), summed across venues; 0 when the token traded only earlier in the week. */
  trades: number;
  volumeUsd: number;
  /** True when the price comes from a trade older than the day's window. */
  priceFromLookback: boolean;
  /** The protocol most of the trades happened on, e.g. `pons`, `uniswap_v4`. */
  venue?: string;
  venueFamily?: string;
};

const positive = (value: number | string | null | undefined): number | undefined => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

const whole = (value: number | string | null | undefined): number => {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? Math.round(parsed) : 0;
};

type Row = z.infer<typeof rowSchema>;

/** Rows grouped per token across venues → one reading per token. */
export function normalizeBitqueryTrades(rows: readonly Row[]): BitqueryTokenTrades[] {
  const byToken = new Map<string, { reading: BitqueryTokenTrades; venueTrades: Map<string, number>; lastAt: number }>();
  for (const row of rows) {
    const address = row.Trade.Currency.SmartContract.toLowerCase();
    if (!ADDRESS.test(address)) continue;
    const trades = whole(row.trades);
    const volume = toNumber(row.volume_usd) ?? 0;
    // The busiest venue is decided over the whole window, not the day: a token
    // that did not trade today would otherwise have no venue at all.
    const weekTrades = whole(row.week_trades);
    const lastAt = row.Block?.last_time ? Date.parse(row.Block.last_time) : Number.NaN;
    const venue = row.Trade.Dex?.ProtocolName ?? undefined;
    const price = positive(row.Trade.last_price);

    const current = byToken.get(address) ?? {
      reading: { contractAddress: address, trades: 0, volumeUsd: 0, priceFromLookback: false },
      venueTrades: new Map<string, number>(),
      lastAt: Number.NEGATIVE_INFINITY,
    };
    current.reading.trades += trades;
    current.reading.volumeUsd += volume > 0 ? volume : 0;
    if (row.Trade.Currency.Symbol && !current.reading.symbol) current.reading.symbol = row.Trade.Currency.Symbol;
    if (row.Trade.Currency.Name && !current.reading.name) current.reading.name = row.Trade.Currency.Name;
    const decimals = toNumber(row.Trade.Currency.Decimals);
    if (decimals !== undefined && current.reading.decimals === undefined) current.reading.decimals = Math.round(decimals);
    if (venue) current.venueTrades.set(venue, (current.venueTrades.get(venue) ?? 0) + Math.max(weekTrades, trades));
    // The newest trade across venues carries the price.
    if (Number.isFinite(lastAt) && lastAt > current.lastAt) {
      current.lastAt = lastAt;
      current.reading.lastTradeAt = new Date(lastAt);
      if (price !== undefined) current.reading.lastPriceUsd = price;
      if (row.Trade.Dex?.ProtocolFamily) current.reading.venueFamily = row.Trade.Dex.ProtocolFamily;
    } else if (current.reading.lastPriceUsd === undefined && price !== undefined) {
      current.reading.lastPriceUsd = price;
    }
    byToken.set(address, current);
  }
  const readings: BitqueryTokenTrades[] = [];
  for (const entry of byToken.values()) {
    const busiest = [...entry.venueTrades.entries()].sort((a, b) => b[1] - a[1])[0];
    if (busiest) entry.reading.venue = busiest[0];
    readings.push(entry.reading);
  }
  return readings;
}

/**
 * Rows to readings, with the price marked when it comes from before the day.
 *
 * `trades` and `volumeUsd` are already the day's, because the query bounds
 * them with `if:`. The price is the window's last trade, so a token that has
 * not traded since `since` still carries one — flagged, so the caller can say
 * "last traded three days ago" rather than presenting a stale price as today's.
 */
export function readBitqueryTrades(rows: readonly Row[], since: Date): BitqueryTokenTrades[] {
  const readings = normalizeBitqueryTrades(rows);
  const out: BitqueryTokenTrades[] = [];
  for (const reading of readings) {
    if (reading.trades === 0 && reading.lastPriceUsd === undefined) continue;
    const stale = reading.lastTradeAt !== undefined && reading.lastTradeAt.getTime() < since.getTime();
    out.push({ ...reading, priceFromLookback: stale });
  }
  return out;
}

export function createBitqueryTradesAdapter(): SourceAdapter<BitqueryTradesInput, BitqueryTokenTrades[]> {
  return {
    name: 'bitquery',
    canHandle: (input) =>
      input.addresses.length > 0 &&
      input.addresses.length <= BITQUERY_BATCH_SIZE &&
      input.addresses.every((address) => ADDRESS.test(address)) &&
      input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryTokenTrades[]>> {
      const addresses = [...new Set(input.addresses.map((address) => address.toLowerCase()))];
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
          body: JSON.stringify({ query: BITQUERY_TRADES_QUERY, variables: { addresses, since: input.since.toISOString(), lookback: input.lookback.toISOString() } }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw) => {
            // A GraphQL error is an answer HEY cannot use, and it must be legible: the message names the field.
            if (raw.errors && raw.errors.length > 0) {
              throw new Error(`bitquery: ${raw.errors.map((error) => error.message).join('; ').slice(0, 300)}`);
            }
            return readBitqueryTrades(raw.data?.EVM?.week ?? [], input.since);
          },
        },
      );
    },
  };
}

/*
 * Network-wide discovery (2026-09-12): every token that traded on Robinhood
 * Chain in a window, by USD volume, a page at a time. HEY had 1,657 tokens
 * with twenty or more traders in the week that no launchpad, registry or
 * aggregator had ever shown it, and 2,260 Pons launches it held without a
 * name; this page is how both are found and named. Symbol and name are the
 * chain's own token metadata as Bitquery decoded it.
 */
export const BITQUERY_DISCOVERY_QUERY = `query HeyTradedTokens($since: DateTime, $count: Int, $offset: Int) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    DEXTradeByTokens(
      where: { Block: { Time: { since: $since } } }
      orderBy: { descendingByField: "volume_usd" }
      limit: { count: $count, offset: $offset }
    ) {
      Trade {
        Currency { SmartContract Symbol Name Decimals }
        Dex { ProtocolName ProtocolFamily }
      }
      trades: count
      volume_usd: sum(of: Trade_Side_AmountInUSD)
      traders: count(distinct: Transaction_From)
    }
  }
}`;

const discoveryRowSchema = z.object({
  Trade: z.object({
    Currency: z.object({ SmartContract: z.string(), Symbol: z.string().nullish(), Name: z.string().nullish(), Decimals: numberish }),
    Dex: z.object({ ProtocolName: z.string().nullish(), ProtocolFamily: z.string().nullish() }).nullish(),
  }),
  trades: numberish,
  volume_usd: numberish,
  traders: numberish,
});

const discoveryResponseSchema = z.object({
  data: z.object({ EVM: z.object({ DEXTradeByTokens: z.array(discoveryRowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryDiscoveryInput = {
  since: Date;
  /** Rows per page (token × venue), at most 1,000. */
  count: number;
  offset: number;
  apiKey: string;
  baseUrl?: string;
};

export type BitqueryTradedToken = {
  contractAddress: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  /** Summed across venues in the window. */
  trades: number;
  volumeUsd: number;
  /** Distinct sending addresses on the busiest venue; a count, never a list (CLAUDE.md product rule 1). */
  traders: number;
  venue?: string;
  venueFamily?: string;
};

/** Rows grouped per token; venue = the busiest; the trader count is the largest single-venue count, never summed. */
export function normalizeBitqueryTradedTokens(rows: readonly z.infer<typeof discoveryRowSchema>[]): BitqueryTradedToken[] {
  const byToken = new Map<string, { reading: BitqueryTradedToken; venueTrades: Map<string, number> }>();
  for (const row of rows) {
    const address = row.Trade.Currency.SmartContract.toLowerCase();
    if (!ADDRESS.test(address)) continue;
    const current = byToken.get(address) ?? { reading: { contractAddress: address, trades: 0, volumeUsd: 0, traders: 0 }, venueTrades: new Map<string, number>() };
    const trades = whole(row.trades);
    current.reading.trades += trades;
    current.reading.volumeUsd += Math.max(0, toNumber(row.volume_usd) ?? 0);
    current.reading.traders = Math.max(current.reading.traders, whole(row.traders));
    if (row.Trade.Currency.Symbol && !current.reading.symbol) current.reading.symbol = row.Trade.Currency.Symbol;
    if (row.Trade.Currency.Name && !current.reading.name) current.reading.name = row.Trade.Currency.Name;
    const decimals = toNumber(row.Trade.Currency.Decimals);
    if (decimals !== undefined && current.reading.decimals === undefined) current.reading.decimals = Math.round(decimals);
    const venue = row.Trade.Dex?.ProtocolName;
    if (venue) {
      current.venueTrades.set(venue, (current.venueTrades.get(venue) ?? 0) + trades);
      if (!current.reading.venueFamily && row.Trade.Dex?.ProtocolFamily) current.reading.venueFamily = row.Trade.Dex.ProtocolFamily;
    }
    byToken.set(address, current);
  }
  const out: BitqueryTradedToken[] = [];
  for (const entry of byToken.values()) {
    const busiest = [...entry.venueTrades.entries()].sort((a, b) => b[1] - a[1])[0];
    if (busiest) entry.reading.venue = busiest[0];
    out.push(entry.reading);
  }
  return out;
}

export function createBitqueryDiscoveryAdapter(): SourceAdapter<BitqueryDiscoveryInput, BitqueryTradedToken[]> {
  return {
    name: 'bitquery-discovery',
    canHandle: (input) => input.count > 0 && input.count <= 1000 && input.offset >= 0 && input.apiKey.length > 0,
    async fetch(input, ctx: SourceContext): Promise<SourceResult<BitqueryTradedToken[]>> {
      return performSourceFetch(
        ctx,
        {
          url: input.baseUrl ?? BITQUERY_DEFAULT_BASE_URL,
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify({ query: BITQUERY_DISCOVERY_QUERY, variables: { since: input.since.toISOString(), count: input.count, offset: input.offset } }),
          allowedContentTypes: ['application/json'],
        },
        {
          schema: discoveryResponseSchema,
          parse: (body) => JSON.parse(body),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          normalize: (raw) => {
            if (raw.errors && raw.errors.length > 0) {
              throw new Error(`bitquery: ${raw.errors.map((error) => error.message).join('; ').slice(0, 300)}`);
            }
            return normalizeBitqueryTradedTokens(raw.data?.EVM?.DEXTradeByTokens ?? []);
          },
        },
      );
    },
  };
}
