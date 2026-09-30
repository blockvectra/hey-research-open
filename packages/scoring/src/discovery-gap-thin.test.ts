import { describe, expect, it } from 'vitest';

import { DISCOVERY_GAP } from './config';
import { DISCOVERY_GAP_WITHHELD_REASONS, DISCOVERY_GAP_WITHHELD_WORDS, discoveryGapWithheldReason } from './discovery-gap';
import { discoveryGapMarketMeasurable, TOKEN_MARKET_REASONS, type TokenMarketStatusValue } from './token-market';
import { SCORING_VERSION, SCORING_VERSIONS } from './version';

/*
 * Discovery Gap on thin markets (hbm-v18, founder decision, 2026-09-30): only
 * an active market that is more than a launch curve is measured; every other
 * missing gap says why, never a zero.
 */
const STATUSES: TokenMarketStatusValue[] = ['ACTIVE_MARKET', 'LOW_LIQUIDITY', 'NO_LIQUIDITY', 'TRADING_INACTIVE', 'LIQUIDITY_REMOVED', 'MARKET_ABANDONED', 'INSUFFICIENT_DATA'];

describe('Discovery Gap on thin markets', () => {
  it('is measured only on an active market that is more than a launch curve', () => {
    for (const status of STATUSES) {
      expect(discoveryGapMarketMeasurable(status, 'DEX')).toBe(status === 'ACTIVE_MARKET');
      expect(discoveryGapMarketMeasurable(status, null)).toBe(status === 'ACTIVE_MARKET');
      expect(discoveryGapMarketMeasurable(status, 'GRADUATED')).toBe(status === 'ACTIVE_MARKET');
      // A launch curve is never a market a gap is measured on, whatever its status says.
      expect(discoveryGapMarketMeasurable(status, 'CURVE')).toBe(false);
    }
    expect(discoveryGapMarketMeasurable(null, 'DEX')).toBe(false);
    expect(discoveryGapMarketMeasurable(undefined, undefined)).toBe(false);
    expect(DISCOVERY_GAP.measuredMarketStatuses).toEqual(['ACTIVE_MARKET']);
  });

  it('gives every missing gap a reason in words, and reads back only the listed ones', () => {
    expect(Object.keys(DISCOVERY_GAP_WITHHELD_WORDS).sort()).toEqual([...DISCOVERY_GAP_WITHHELD_REASONS].sort());
    expect(DISCOVERY_GAP_WITHHELD_WORDS.market_too_thin).toBe('Not measured — market too thin');
    for (const reason of DISCOVERY_GAP_WITHHELD_REASONS) {
      expect(DISCOVERY_GAP_WITHHELD_WORDS[reason]).toMatch(/^Not measured — /);
      expect(discoveryGapWithheldReason(reason)).toBe(reason);
    }
    for (const junk of [undefined, null, 0, '', 'MARKET_TOO_THIN', 'market_not_active', { reason: 'market_too_thin' }]) {
      expect(discoveryGapWithheldReason(junk)).toBeUndefined();
    }
    // A missing gap is never phrased as a figure or a verdict.
    for (const words of Object.values(DISCOVERY_GAP_WITHHELD_WORDS)) expect(words).not.toMatch(/\b0\b|zero|undervalued|cheap|buy|gem/i);
  });

  it('is a methodology change with its own version', () => {
    expect(SCORING_VERSIONS).toContain('hbm-v18');
    expect(SCORING_VERSIONS).toContain('hbm-v17');
    expect(SCORING_VERSIONS.indexOf(SCORING_VERSION)).toBeGreaterThanOrEqual(SCORING_VERSIONS.indexOf('hbm-v18'));
    // The token market vocabulary is untouched by it: the rule reads the status, never a reason of its own.
    expect(TOKEN_MARKET_REASONS).not.toContain('market_too_thin');
  });
});
