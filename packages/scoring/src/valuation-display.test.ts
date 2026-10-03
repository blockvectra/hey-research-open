import { describe, expect, it } from 'vitest';

import { DEAD_MARKET_REASONS, DEAD_MARKET_STATUSES, marketIsLive, TOKEN_MARKET_REASONS } from './token-market';
import { UNSETTLED_MARKET_REASONS, VALUATION_HIDDEN_WORDS, valuationDisplay, valuationDisplayLabel } from './valuation-display';
import { valuationKindOf } from './valuation-kind';

/**
 * One rule for whether a valuation prints and under which name
 * (data-correctness pass, 2026-09-28).
 *
 * Regression: cards printed "Market cap · No active market" beside
 * "Valuation · No active market" — the kind of a figure they then hid.
 */
describe('valuationDisplay', () => {
  it('prints a live reading under the kind rule', () => {
    expect(valuationDisplay({ valueUsd: 24_000, fdvUsd: 24_000, marketStatus: 'ACTIVE_MARKET' })).toEqual({ shown: true, usd: 24_000, kind: 'fdv' });
    expect(valuationDisplay({ valueUsd: 22_085, fdvUsd: 29_616, marketStatus: 'ACTIVE_MARKET' })).toEqual({ shown: true, usd: 22_085, kind: 'marketCap' });
    // No token status at all is not a dead market (a tokenless read).
    expect(valuationDisplay({ valueUsd: 5_000 }).shown).toBe(true);
  });

  it('agrees with marketIsLive on every status and reason the classifier writes', () => {
    const statuses = [...DEAD_MARKET_STATUSES, 'ACTIVE_MARKET', 'LOW_LIQUIDITY', 'TRADING_INACTIVE', 'INSUFFICIENT_DATA'];
    for (const status of statuses) {
      for (const reason of [...TOKEN_MARKET_REASONS, null]) {
        const display = valuationDisplay({ valueUsd: 10_000, fdvUsd: 10_000, marketStatus: status, marketReason: reason });
        // A rescued market is live, and its valuation still unconfirmed: the reading follows the thin pool (2026-10-03, F1).
        expect(display.shown, `${status}/${reason}`).toBe(marketIsLive(status as never, reason) && reason !== 'liquidity_in_another_pool');
      }
    }
  });

  it('never lends a hidden figure its kind: every hidden state reads "Valuation"', () => {
    const hidden = [
      valuationDisplay({ valueUsd: 22_085, fdvUsd: 29_616, marketStatus: 'TRADING_INACTIVE', marketReason: 'launch_pool_no_trades' }),
      valuationDisplay({ valueUsd: 24_000, fdvUsd: 24_000, marketStatus: 'TRADING_INACTIVE', marketReason: 'launch_pool_no_trades' }),
      valuationDisplay({ valueUsd: 24_000, fdvUsd: 24_000, marketStatus: 'INSUFFICIENT_DATA', marketReason: 'readings_implausible' }),
      valuationDisplay({ valueUsd: undefined, marketStatus: 'ACTIVE_MARKET' }),
      valuationDisplay({ valueUsd: 0 }),
    ];
    for (const display of hidden) {
      expect(display.shown).toBe(false);
      for (const style of ['card', 'long', 'short'] as const) expect(valuationDisplayLabel(display, style)).toBe('Valuation');
    }
  });

  it('separates a dead market from an unsettled one and from no reading', () => {
    const state = (input: Parameters<typeof valuationDisplay>[0]) => {
      const display = valuationDisplay(input);
      return display.shown ? 'shown' : display.state;
    };
    expect(state({ valueUsd: 1, marketStatus: 'NO_LIQUIDITY' })).toBe('no_active_market');
    expect(state({ valueUsd: 1, marketStatus: 'TRADING_INACTIVE', marketReason: 'launch_pool_no_trades' })).toBe('no_active_market');
    expect(state({ valueUsd: 1, marketStatus: 'INSUFFICIENT_DATA', marketReason: 'pool_readings_disagree' })).toBe('unconfirmed');
    // A dead status outranks an unsettled reason: HEY did record the market gone.
    expect(state({ valueUsd: 1, marketStatus: 'LIQUIDITY_REMOVED', marketReason: 'removal_unconfirmed' })).toBe('no_active_market');
    expect(state({ valueUsd: undefined, marketStatus: 'ACTIVE_MARKET' })).toBe('no_reading');
    expect(VALUATION_HIDDEN_WORDS.no_reading).toBe('Unavailable');
  });

  it('keeps the unsettled reasons inside the dead list, so neither rule can drift', () => {
    for (const reason of UNSETTLED_MARKET_REASONS) expect((DEAD_MARKET_REASONS as readonly string[]).includes(reason)).toBe(true);
  });

  it('names a shown figure as valuationKindOf does, in every style', () => {
    const fdv = valuationDisplay({ valueUsd: 9, fdvUsd: 9 });
    const cap = valuationDisplay({ valueUsd: 9, fdvUsd: 12 });
    expect(fdv.shown && fdv.kind).toBe(valuationKindOf({ valueUsd: 9, fdvUsd: 9 }));
    expect([valuationDisplayLabel(fdv, 'card'), valuationDisplayLabel(fdv, 'long'), valuationDisplayLabel(fdv, 'short')]).toEqual(['Valuation', 'Fully diluted valuation', 'FDV']);
    expect([valuationDisplayLabel(cap, 'card'), valuationDisplayLabel(cap, 'long'), valuationDisplayLabel(cap, 'short')]).toEqual(['Market cap', 'Market cap', 'Market cap']);
  });
});
