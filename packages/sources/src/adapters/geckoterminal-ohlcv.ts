import { z } from 'zod';

import { requireData, type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { GECKOTERMINAL_DEFAULT_BASE_URL } from './geckoterminal';

/**
 * Daily candles for one pool (2026-09-08).
 *
 * HEY's own market snapshots start on 1 September 2026, so the "tracked
 * high" behind Still Building was a week old at best and almost nothing
 * qualified. GeckoTerminal serves up to ninety daily candles per pool for
 * free; one read per pool gives the drawdown a real high to be measured
 * against. Prices only: market cap history is derived by the caller from
 * today's FDV and today's price, and labelled as an estimate.
 *
 * Intraday (2026-09-29): the same endpoint serves hour and minute bars, which
 * the Terminal chart's 15m and 1H timeframes read from HEY's own table. The
 * provider lists only bars that traded — a quiet quarter hour is absent, not
 * a zero — so the caller never fills a missing bar in.
 */
const candleSchema = z.tuple([
  z.number(), // unix seconds, start of day
  z.union([z.string(), z.number()]), // open
  z.union([z.string(), z.number()]), // high
  z.union([z.string(), z.number()]), // low
  z.union([z.string(), z.number()]), // close
  z.union([z.string(), z.number()]), // volume usd
]);

export const geckoterminalOhlcvSchema = z.object({
  data: z.object({
    attributes: z.object({ ohlcv_list: z.array(candleSchema) }),
  }),
});

export type DailyCandle = {
  /** The bar's start: a UTC midnight for `day`, the hour or quarter hour for the intraday timeframes. */
  day: Date;
  openUsd: number;
  highUsd: number;
  lowUsd: number;
  closeUsd: number;
  volumeUsd: number;
};

/**
 * A candle of any timeframe (2026-09-29): the same tuple, the same parse. The
 * daily shape keeps its old name for the history backfill.
 */
export type OhlcvCandle = DailyCandle;

/** The timeframes GeckoTerminal serves: `day` (aggregate 1), `hour` (1, 4, 12) and `minute` (1, 5, 15). */
export type OhlcvTimeframe = 'day' | 'hour' | 'minute';

const AGGREGATES: Readonly<Record<OhlcvTimeframe, readonly number[]>> = {
  day: [1],
  hour: [1, 4, 12],
  minute: [1, 5, 15],
};

export type GeckoterminalOhlcvInput = {
  network: string;
  poolAddress: string;
  /** Candles to ask for, at most 1000 on the provider side; ninety is the tracked window. */
  days?: number;
  baseUrl?: string;
  /**
   * Intraday candles (2026-09-29, the Terminal chart's 15m and 1H). Absent is
   * the daily read, whose URL stays exactly what it was: `/ohlcv/day?limit=N`.
   */
  timeframe?: OhlcvTimeframe;
  /** Bars merged into one: `hour` with 1 is an hour, `minute` with 15 a quarter hour. */
  aggregate?: number;
  /** Only bars that start before this instant (unix seconds): how an older page is read. */
  beforeTimestamp?: number;
  /** Bars to ask for on an intraday read, at most 1000. */
  limit?: number;
};

const CACHE_TTL_SECONDS = 6 * 60 * 60;
/** An intraday page is stale within the hour it was read. */
const INTRADAY_CACHE_TTL_SECONDS = 15 * 60;
const POOL_PATTERN = /^0x[a-fA-F0-9]{40,64}$/;

const num = (value: string | number): number => (typeof value === 'number' ? value : Number(value));

export function createGeckoterminalOhlcvAdapter(): SourceAdapter<GeckoterminalOhlcvInput, DailyCandle[]> {
  return {
    name: 'geckoterminal-ohlcv',

    canHandle(input) {
      if (input.timeframe && input.aggregate !== undefined && !AGGREGATES[input.timeframe].includes(input.aggregate)) return false;
      return input.network.length > 0 && POOL_PATTERN.test(input.poolAddress);
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<DailyCandle[]>> {
      const url = ohlcvUrl(input);
      const intraday = input.timeframe !== undefined && input.timeframe !== 'day';
      const ttl = intraday ? INTRADAY_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS;

      const result = await performSourceFetch(
        ctx,
        { url },
        {
          schema: geckoterminalOhlcvSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: ttl,
          normalize: (raw): DailyCandle[] | undefined => {
            const candles = raw.data.attributes.ohlcv_list
              .map(([at, open, high, low, close, volume]) => ({
                day: new Date(at * 1000),
                openUsd: num(open),
                highUsd: num(high),
                lowUsd: num(low),
                closeUsd: num(close),
                volumeUsd: num(volume),
              }))
              .filter((c) => Number.isFinite(c.highUsd) && c.highUsd > 0 && !Number.isNaN(c.day.getTime()))
              .sort((a, b) => a.day.getTime() - b.day.getTime());
            return candles.length > 0 ? candles : undefined;
          },
        },
      );

      return requireData(result, ctx, 'no candles for pool', { sourceUrl: url, cacheTtlSeconds: ttl });
    },
  };
}

/**
 * The request URL. The daily read is byte-identical to what it has always
 * been; an intraday read names its timeframe, its aggregate, its limit and,
 * for an older page, `before_timestamp`.
 */
export function ohlcvUrl(input: GeckoterminalOhlcvInput): string {
  const base = (input.baseUrl ?? GECKOTERMINAL_DEFAULT_BASE_URL).replace(/\/$/, '');
  const pool = `${base}/networks/${input.network}/pools/${input.poolAddress}/ohlcv`;
  if (input.timeframe === undefined || (input.timeframe === 'day' && input.aggregate === undefined && input.beforeTimestamp === undefined)) {
    const limit = Math.min(1000, Math.max(1, input.days ?? 90));
    return `${pool}/day?limit=${limit}`;
  }
  const aggregate = input.aggregate ?? 1;
  const limit = Math.min(1000, Math.max(1, Math.floor(input.limit ?? input.days ?? 100)));
  const before = input.beforeTimestamp !== undefined && Number.isFinite(input.beforeTimestamp) ? `&before_timestamp=${Math.floor(input.beforeTimestamp)}` : '';
  return `${pool}/${input.timeframe}?aggregate=${aggregate}&limit=${limit}${before}`;
}
