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
 * The `realtime` dataset is the one the Pro plan allows (`combined` spans the
 * archive and is refused with a 403 on that plan — verified 2026-09-12); it
 * holds recent history, which is all a 24 h window needs. The token is an
 * OAuth access token (`ory_…`), sent as a bearer; the old `X-API-KEY` header
 * answers 402 on the v2 endpoint.
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

/** The day's trades are what the status reads; a reading an hour old is fine. */
const CACHE_TTL_SECONDS = 60 * 60;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const BITQUERY_TRADES_QUERY = `query HeyTokenTrades($addresses: [String!], $since: DateTime) {
  EVM(network: ${BITQUERY_NETWORK}, dataset: realtime) {
    DEXTradeByTokens(
      where: { Trade: { Currency: { SmartContract: { in: $addresses } } }, Block: { Time: { since: $since } } }
      limit: { count: 1000 }
    ) {
      Trade {
        Currency { SmartContract Symbol Name Decimals }
        Dex { ProtocolName ProtocolFamily }
        last_price: PriceInUSD(maximum: Block_Number)
      }
      Block { last_time: Time(maximum: Block_Number) }
      trades: count
      volume_usd: sum(of: Trade_Side_AmountInUSD)
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
});

const responseSchema = z.object({
  data: z.object({ EVM: z.object({ DEXTradeByTokens: z.array(rowSchema).nullish() }).nullish() }).nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

export type BitqueryTradesInput = {
  /** Contract addresses, at most `BITQUERY_BATCH_SIZE`; the caller chunks. */
  addresses: readonly string[];
  /** Trades at or after this moment are counted (the day's window). */
  since: Date;
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
  /** Trades and USD volume since `since`, summed across venues. */
  trades: number;
  volumeUsd: number;
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
    const lastAt = row.Block?.last_time ? Date.parse(row.Block.last_time) : Number.NaN;
    const venue = row.Trade.Dex?.ProtocolName ?? undefined;
    const price = positive(row.Trade.last_price);

    const current = byToken.get(address) ?? {
      reading: { contractAddress: address, trades: 0, volumeUsd: 0 },
      venueTrades: new Map<string, number>(),
      lastAt: Number.NEGATIVE_INFINITY,
    };
    current.reading.trades += trades;
    current.reading.volumeUsd += volume > 0 ? volume : 0;
    if (row.Trade.Currency.Symbol && !current.reading.symbol) current.reading.symbol = row.Trade.Currency.Symbol;
    if (row.Trade.Currency.Name && !current.reading.name) current.reading.name = row.Trade.Currency.Name;
    const decimals = toNumber(row.Trade.Currency.Decimals);
    if (decimals !== undefined && current.reading.decimals === undefined) current.reading.decimals = Math.round(decimals);
    if (venue) current.venueTrades.set(venue, (current.venueTrades.get(venue) ?? 0) + trades);
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
          body: JSON.stringify({ query: BITQUERY_TRADES_QUERY, variables: { addresses, since: input.since.toISOString() } }),
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
            return normalizeBitqueryTrades(raw.data?.EVM?.DEXTradeByTokens ?? []);
          },
        },
      );
    },
  };
}
