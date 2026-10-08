import { describe, expect, it } from 'vitest';

import {
  valuationDisplay,
  valuationDisplayLabel,
  valuationHiddenSentence,
  VALUATION_HIDDEN_WORDS,
} from './valuation-display';
import {
  VALUATION_CHAIN_EVIDENCE,
  VALUATION_IMPLAUSIBLE_REASONS,
  VALUATION_IMPLAUSIBLE_WORDS,
  VALUATION_NOT_PLAUSIBLE_WORDS,
  VALUATION_PLAUSIBILITY,
  valuationImplausibleReason,
  valuationNotPlausibleSentence,
  valuationPlausibility,
  valuationUnderTest,
} from './valuation-plausibility';

const RH = VALUATION_PLAUSIBILITY.chainId;

describe('the valuation plausibility gate (round 4, 2026-09-30)', () => {
  it('holds the founder thresholds in one place', () => {
    expect(VALUATION_PLAUSIBILITY).toEqual({
      maxLiquidityMultiple: 10_000,
      unlistedCeilingUsd: 10_000_000_000,
      chainId: 4663,
    });
    // Rule 3 apart (2026-10-09): not a scorer input until hbm-v26 is ruled on.
    expect(VALUATION_CHAIN_EVIDENCE).toEqual({ contradictionMultiple: 10, maxAgeDays: 2, indexMaxTurnover: 0.001 });
  });

  describe('rule 1: at least 10,000× the same reading’s liquidity', () => {
    it('trips at exactly the multiple and not a dollar below', () => {
      expect(valuationPlausibility({ marketCapUsd: 10_000_000, liquidityUsd: 1_000 })).toEqual({
        plausible: false,
        reason: 'valuation_over_liquidity',
      });
      expect(valuationPlausibility({ marketCapUsd: 9_999_999, liquidityUsd: 1_000 })).toEqual({
        plausible: true,
      });
    });

    it('reads production shapes: CUPCAKE’s $27.9B on $19k and a $72M cap over a $2.65 pool', () => {
      expect(
        valuationPlausibility({
          marketCapUsd: 27_947_141_890,
          fdvUsd: 27_947_141_890,
          liquidityUsd: 19_366.9,
          chainId: RH,
          listing: 'not_listed',
        }).plausible,
      ).toBe(false);
      expect(
        valuationPlausibility({ fdvUsd: 72_081_189, liquidityUsd: 2.65, chainId: RH }),
      ).toEqual({ plausible: false, reason: 'valuation_over_liquidity' });
    });

    it('is silent without a liquidity reading: missing is never zero', () => {
      for (const liquidityUsd of [undefined, null, 0, -5, Number.NaN]) {
        expect(
          valuationPlausibility({ marketCapUsd: 5_000_000, liquidityUsd, chainId: RH }),
          String(liquidityUsd),
        ).toEqual({ plausible: true });
      }
    });

    it('tests the reading’s largest valuation: an FDV the pool cannot support takes its market cap with it', () => {
      expect(valuationUnderTest({ marketCapUsd: 1_000, fdvUsd: 50_000 })).toBe(50_000);
      expect(valuationUnderTest({ marketCapUsd: 1_000 })).toBe(1_000);
      expect(valuationUnderTest({ marketCapUsd: 0, fdvUsd: null })).toBeUndefined();
      expect(
        valuationPlausibility({ marketCapUsd: 5_000, fdvUsd: 20_000_000, liquidityUsd: 1_000 }),
      ).toEqual({ plausible: false, reason: 'valuation_over_liquidity' });
    });

    it('has nothing to say about a reading with no valuation', () => {
      expect(valuationPlausibility({ liquidityUsd: 1 })).toEqual({ plausible: true });
      expect(valuationPlausibility({})).toEqual({ plausible: true });
    });
  });

  describe('rule 2: above $10B on a Robinhood Chain token no listing HEY reads carries', () => {
    const big = { marketCapUsd: 10_000_000_001, liquidityUsd: 5_000_000, chainId: RH };

    it('trips only when HEY read the listing and the token is not on it', () => {
      expect(valuationPlausibility({ ...big, listing: 'not_listed' })).toEqual({
        plausible: false,
        reason: 'unlisted_over_ceiling',
      });
      expect(valuationPlausibility({ ...big, listing: 'listed' })).toEqual({ plausible: true });
      // A read HEY does not hold is not a listing HEY found missing.
      expect(valuationPlausibility({ ...big, listing: 'unknown' })).toEqual({ plausible: true });
      expect(
        valuationPlausibility({
          marketCapUsd: big.marketCapUsd,
          liquidityUsd: big.liquidityUsd,
          chainId: RH,
        }),
      ).toEqual({ plausible: true });
    });

    it('is strictly above the ceiling', () => {
      expect(
        valuationPlausibility({ ...big, marketCapUsd: 10_000_000_000, listing: 'not_listed' }),
      ).toEqual({ plausible: true });
    });

    it('is about Robinhood Chain only', () => {
      expect(valuationPlausibility({ ...big, chainId: 1, listing: 'not_listed' })).toEqual({
        plausible: true,
      });
      expect(valuationPlausibility({ ...big, chainId: undefined, listing: 'not_listed' })).toEqual({
        plausible: true,
      });
    });

    it('lets the liquidity rule speak first when both apply', () => {
      expect(
        valuationPlausibility({
          marketCapUsd: 78_611_128_211,
          liquidityUsd: 0.13,
          chainId: RH,
          listing: 'not_listed',
        }),
      ).toEqual({ plausible: false, reason: 'valuation_over_liquidity' });
    });
  });

  describe('rule 3: HEY’s own chain evidence contradicts the reading more than 10× (2026-10-09 audit E2/E3)', () => {
    // Production's readings on 2026-10-08.
    const usdb = {
      fdvUsd: 10_416_055_051,
      liquidityUsd: 82_460_100.99,
      volume24hUsd: 10.69,
      priceUsd: 1.0416,
      chainId: RH,
      listing: 'listed' as const,
    };

    it('withholds USDB: its decoded trades price it 80× lower', () => {
      expect(valuationPlausibility({ ...usdb, chainTradePriceUsd: 0.01294 })).toEqual({
        plausible: false,
        reason: 'chain_evidence_contradicts',
      });
    });

    it('withholds USDB on the index alone: a thirtieth of its liquidity on a day it barely traded', () => {
      expect(valuationPlausibility({ ...usdb, chainIndexLiquidityUsd: 2_765_826 })).toEqual({
        plausible: false,
        reason: 'chain_evidence_contradicts',
      });
    });

    it('trips in either direction, only past 10×', () => {
      expect(valuationPlausibility({ marketCapUsd: 1_000_000, priceUsd: 1, chainTradePriceUsd: 10.01 }).plausible).toBe(false);
      expect(valuationPlausibility({ marketCapUsd: 1_000_000, priceUsd: 10.01, chainTradePriceUsd: 1 }).plausible).toBe(false);
      expect(valuationPlausibility({ marketCapUsd: 1_000_000, priceUsd: 10, chainTradePriceUsd: 1 }).plausible).toBe(true);
    });

    it('never lets the index decide beside a market that trades: openzaps, $125K a day on a pool the index holds $2 of', () => {
      expect(
        valuationPlausibility({
          fdvUsd: 503_057,
          liquidityUsd: 194_084,
          volume24hUsd: 125_367,
          priceUsd: 0.00000503,
          chainTradePriceUsd: 0.00000417,
          chainIndexLiquidityUsd: 2.38,
          chainId: RH,
        }),
      ).toEqual({ plausible: true });
    });

    it('leaves atlantis-coin alone: its trades price it 1.6× higher and the index holds more than the reading', () => {
      expect(
        valuationPlausibility({
          fdvUsd: 2_489_661_474,
          liquidityUsd: 1_423_504,
          volume24hUsd: 29.51,
          priceUsd: 24.89,
          chainTradePriceUsd: 39.65,
          chainIndexLiquidityUsd: 2_767_714,
          chainId: RH,
          listing: 'listed',
        }),
      ).toEqual({ plausible: true });
    });

    it('unknown is never a trip wire: no evidence, no price or no volume leaves it silent', () => {
      expect(valuationPlausibility({ ...usdb })).toEqual({ plausible: true });
      expect(valuationPlausibility({ ...usdb, priceUsd: undefined, chainTradePriceUsd: 0.01294 })).toEqual({ plausible: true });
      expect(valuationPlausibility({ ...usdb, volume24hUsd: undefined, chainIndexLiquidityUsd: 2_765_826 })).toEqual({ plausible: true });
      expect(valuationPlausibility({ ...usdb, chainTradePriceUsd: 0, chainIndexLiquidityUsd: 0 })).toEqual({ plausible: true });
    });

    it('only withholds: a reading with no valuation is never touched', () => {
      expect(valuationPlausibility({ priceUsd: 1, chainTradePriceUsd: 0.001 })).toEqual({ plausible: true });
    });
  });

  it('reads back only its own reason codes', () => {
    for (const reason of VALUATION_IMPLAUSIBLE_REASONS)
      expect(valuationImplausibleReason(reason)).toBe(reason);
    for (const other of ['readings_implausible', 'no_reading', '', null, undefined, 42])
      expect(valuationImplausibleReason(other)).toBeUndefined();
  });

  it('says what it withholds in plain words that name its thresholds and never a verdict', () => {
    expect(VALUATION_NOT_PLAUSIBLE_WORDS).toBe('Valuation not plausible from the readings HEY has');
    expect(VALUATION_IMPLAUSIBLE_WORDS.valuation_over_liquidity).toContain('10,000×');
    expect(VALUATION_IMPLAUSIBLE_WORDS.unlisted_over_ceiling).toContain('$10B');
    expect(VALUATION_IMPLAUSIBLE_WORDS.chain_evidence_contradicts).toContain('10×');
    for (const reason of VALUATION_IMPLAUSIBLE_REASONS) {
      const sentence = valuationNotPlausibleSentence(reason);
      expect(sentence.startsWith(VALUATION_NOT_PLAUSIBLE_WORDS)).toBe(true);
      expect(sentence).not.toMatch(/\b(scam|rug|fake|safe|buy|sell|undervalued|overvalued)\b/i);
    }
  });
});

describe('valuationDisplay carries the gate: never printed, never a kind', () => {
  it('withholds an implausible valuation with its reason, and names neither measure', () => {
    const display = valuationDisplay({
      valueUsd: undefined,
      marketStatus: 'ACTIVE_MARKET',
      valuationImplausible: 'valuation_over_liquidity',
    });
    expect(display).toEqual({
      shown: false,
      state: 'not_plausible',
      reason: 'valuation_over_liquidity',
    });
    expect(valuationDisplayLabel(display, 'card')).toBe('Valuation');
    expect(VALUATION_HIDDEN_WORDS[display.shown ? 'no_reading' : display.state]).toBe(
      'Not plausible',
    );
    expect(valuationHiddenSentence(display)).toBe(
      valuationNotPlausibleSentence('valuation_over_liquidity'),
    );
  });

  it('withholds it even when a caller still passes the figure', () => {
    expect(
      valuationDisplay({
        valueUsd: 27_947_141_890,
        fdvUsd: 27_947_141_890,
        marketStatus: 'ACTIVE_MARKET',
        valuationImplausible: 'unlisted_over_ceiling',
      }).shown,
    ).toBe(false);
  });

  it('a dead market is still "No active market" first: the gate never re-labels a dead one', () => {
    expect(
      valuationDisplay({
        valueUsd: undefined,
        marketStatus: 'NO_LIQUIDITY',
        valuationImplausible: 'valuation_over_liquidity',
      }),
    ).toMatchObject({ state: 'no_active_market' });
  });

  it('ignores anything that is not one of its reasons', () => {
    expect(
      valuationDisplay({
        valueUsd: 1_000,
        marketStatus: 'ACTIVE_MARKET',
        valuationImplausible: 'something_else',
      }),
    ).toMatchObject({ shown: true, usd: 1_000 });
    expect(
      valuationDisplay({
        valueUsd: 1_000,
        marketStatus: 'ACTIVE_MARKET',
        valuationImplausible: null,
      }),
    ).toMatchObject({ shown: true });
  });
});
