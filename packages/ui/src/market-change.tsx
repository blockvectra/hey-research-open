import type { JSX } from 'react';

import { cn } from './cn';

/**
 * A measured price move, printed one way everywhere (Terminal redesign,
 * 2026-09-26; CLAUDE.md UI rule 13).
 *
 * Market direction may be green and red, but only for a direction HEY
 * measured, and never by colour alone: up carries ▲ and a plus, down carries
 * ▼ and a true minus (U+2212), and every case has a sentence for a screen
 * reader. A move that rounds to zero is flat and uncoloured; a missing figure
 * is a dash, never 0; a stale reading keeps its arrow and sign but loses its
 * colour, because an old move is not the current one.
 *
 * Server-safe: no state, no effects, no `'use client'`. Every surface other
 * than the chart prints a move through this component rather than reaching
 * for a `text-market-*` class itself.
 */
export type MarketDirection = 'up' | 'down' | 'flat' | 'unknown';

export type MarketChangeSize = 'meta' | 'ui' | 'title';

export type MarketChangeProps = {
  /** The move in per cent (4.2 means +4.2%). Absent or not finite prints a dash. */
  pct?: number | undefined;
  /** '24h' | '1D' | '7D' | '30D' | '90D' | '1Y' | 'All' | 'since event' */
  window: string;
  /** An old reading, e.g. `{ age: '3d' }`: no colour, then "· 3d old". */
  stale?: { age: string } | undefined;
  /** Print the window label after the figure. Default true. */
  showWindow?: boolean | undefined;
  /** Type step for the figure. Default 'ui'. */
  size?: MarketChangeSize | undefined;
  className?: string | undefined;
};

const MINUS = '−';

const measured = (pct: number | undefined): pct is number => pct !== undefined && Number.isFinite(pct);

/** The magnitude as printed: grouped integer from 100, else `decimals` places. */
const magnitude = (abs: number, decimals: number): string =>
  abs >= 100 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(decimals);

/**
 * The direction of a move, decided after rounding to what is printed: a move
 * of −0.04% prints `0.0%`, so it is flat, never a red "down 0.0".
 */
export function changeDirection(pct: number | undefined, decimals = 1): MarketDirection {
  if (!measured(pct)) return 'unknown';
  if (Number(magnitude(Math.abs(pct), decimals).replace(/,/g, '')) === 0) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

const WINDOW_WORDS: Readonly<Record<string, string>> = {
  '24h': 'over 24 hours',
  '1D': 'over the day',
  '7D': 'over 7 days',
  '30D': 'over 30 days',
  '90D': 'over 90 days',
  '1Y': 'over 1 year',
  All: 'over all recorded history',
  'since event': 'since the event',
};

/** The window as a spoken phrase: "over 24 hours", "since the event". */
export function marketWindowPhrase(window: string): string {
  const days = /^(\d+)D$/.exec(window);
  if (!WINDOW_WORDS[window] && days) return `over ${days[1]} day${days[1] === '1' ? '' : 's'}`;
  return WINDOW_WORDS[window] ?? `over ${window}`;
}

export type MarketChangeText = {
  direction: MarketDirection;
  /** What is printed: `▲ +4.2%`, `▼ −4.2%`, `0.0%` or `—`. */
  text: string;
  /** What a screen reader hears: "up 4.2 percent over 24 hours". */
  spoken: string;
};

/**
 * The words of a move without the markup, for a caption, an `aria-label` or
 * a sentence. `MarketChange` renders exactly this.
 */
export function describeMarketChange(
  pct: number | undefined,
  window: string,
  options: { stale?: { age: string } | undefined; decimals?: number } = {},
): MarketChangeText {
  const decimals = options.decimals ?? 1;
  const direction = changeDirection(pct, decimals);
  const age = options.stale ? `, reading ${options.stale.age} old` : '';
  if (direction === 'unknown' || !measured(pct)) {
    return {
      direction: 'unknown',
      text: '—',
      spoken: window === 'since event' ? 'change since the event not reported' : `${window} change not reported`,
    };
  }
  if (direction === 'flat') {
    return { direction, text: `${(0).toFixed(decimals)}%`, spoken: `unchanged ${marketWindowPhrase(window)}${age}` };
  }
  const value = magnitude(Math.abs(pct), decimals);
  return direction === 'up'
    ? { direction, text: `▲ +${value}%`, spoken: `up ${value} percent ${marketWindowPhrase(window)}${age}` }
    : { direction, text: `▼ ${MINUS}${value}%`, spoken: `down ${value} percent ${marketWindowPhrase(window)}${age}` };
}

const TONE: Readonly<Record<MarketDirection, string>> = {
  up: 'text-market-up',
  down: 'text-market-down',
  flat: 'text-market-flat',
  unknown: 'text-hey-unavailable',
};

const SIZE: Readonly<Record<MarketChangeSize, string>> = {
  meta: 'text-t-meta',
  ui: 'text-t-ui',
  title: 'text-t-title',
};

export function MarketChange({
  pct,
  window,
  stale,
  showWindow = true,
  size = 'ui',
  className,
}: MarketChangeProps): JSX.Element {
  const { direction, text, spoken } = describeMarketChange(pct, window, { stale });
  const isStale = stale !== undefined && direction !== 'unknown';
  return (
    <span
      data-direction={direction}
      {...(isStale ? { 'data-stale': 'true' } : {})}
      className={cn('inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums', className)}
    >
      <span aria-hidden="true" className={cn(SIZE[size], 'font-medium', isStale ? 'text-hey-unavailable' : TONE[direction])}>
        {text}
      </span>
      {showWindow ? (
        <span aria-hidden="true" className="text-t-meta text-hey-secondary">
          {window}
        </span>
      ) : null}
      {isStale ? (
        <span aria-hidden="true" className="text-t-meta text-hey-unavailable">
          · {stale.age} old
        </span>
      ) : null}
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
