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
  day: Date;
  openUsd: number;
  highUsd: number;
  lowUsd: number;
  closeUsd: number;
  volumeUsd: number;
};

export type GeckoterminalOhlcvInput = {
  network: string;
  poolAddress: string;
  /** Candles to ask for, at most 1000 on the provider side; ninety is the tracked window. */
  days?: number;
  baseUrl?: string;
};

const CACHE_TTL_SECONDS = 6 * 60 * 60;
const POOL_PATTERN = /^0x[a-fA-F0-9]{40,64}$/;

const num = (value: string | number): number => (typeof value === 'number' ? value : Number(value));

export function createGeckoterminalOhlcvAdapter(): SourceAdapter<GeckoterminalOhlcvInput, DailyCandle[]> {
  return {
    name: 'geckoterminal-ohlcv',

    canHandle(input) {
      return input.network.length > 0 && POOL_PATTERN.test(input.poolAddress);
    },

    async fetch(input, ctx: SourceContext): Promise<SourceResult<DailyCandle[]>> {
      const base = (input.baseUrl ?? GECKOTERMINAL_DEFAULT_BASE_URL).replace(/\/$/, '');
      const limit = Math.min(1000, Math.max(1, input.days ?? 90));
      const url = `${base}/networks/${input.network}/pools/${input.poolAddress}/ohlcv/day?limit=${limit}`;

      const result = await performSourceFetch(
        ctx,
        { url },
        {
          schema: geckoterminalOhlcvSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
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

      return requireData(result, ctx, 'no candles for pool', { sourceUrl: url, cacheTtlSeconds: CACHE_TTL_SECONDS });
    },
  };
}
