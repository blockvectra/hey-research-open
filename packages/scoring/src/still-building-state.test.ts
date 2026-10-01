import { describe, expect, it } from 'vitest';

import { STILL_BUILDING_STATES, STILL_BUILDING_WITHHELD_REASONS, STILL_BUILDING_WITHHELD_WORDS, stillBuildingState, stillBuildingWithheldOf } from './discovery-gap';
import { SCORING_VERSION } from './version';

/**
 * `stillBuildingState` (round 4, 2026-09-30): the three states sent beside the
 * v1 boolean, derived only from what the scorer persisted.
 */
describe('stillBuildingState', () => {
  it('lists exactly three states', () => {
    expect(STILL_BUILDING_STATES).toEqual(['HELD', 'NOT_HELD', 'NOT_MEASURED']);
  });

  it('HELD when the badge is held, whatever a stale reason says', () => {
    expect(stillBuildingState(true, {})).toBe('HELD');
    expect(stillBuildingState(true, { stillBuildingWithheld: 'market_too_thin' })).toBe('HELD');
  });

  it('NOT_MEASURED when there is no score row', () => {
    expect(stillBuildingState(undefined, undefined)).toBe('NOT_MEASURED');
    expect(stillBuildingState(null, {})).toBe('NOT_MEASURED');
  });

  it('NOT_MEASURED beside every reason the scorer writes', () => {
    for (const reason of STILL_BUILDING_WITHHELD_REASONS) expect(stillBuildingState(false, { stillBuildingWithheld: reason })).toBe('NOT_MEASURED');
  });

  it('NOT_MEASURED when the valuation gate withheld the current valuation (hbm-v20, 2026-09-30)', () => {
    expect(STILL_BUILDING_WITHHELD_REASONS).toContain('valuation_not_plausible');
    expect(stillBuildingState(false, { stillBuildingWithheld: 'valuation_not_plausible', marketValuationWithheld: 'valuation_over_liquidity' })).toBe('NOT_MEASURED');
  });

  it('NOT_HELD when measured and not held, and for a score whose version the reader does not hold', () => {
    expect(stillBuildingState(false, { stillBuildingWithheld: null })).toBe('NOT_HELD');
    expect(stillBuildingState(false, {})).toBe('NOT_HELD');
    expect(stillBuildingState(false, null)).toBe('NOT_HELD');
    expect(stillBuildingState(false, {}, SCORING_VERSION)).toBe('NOT_HELD');
    // A gap-only reason is not a Still Building reason.
    expect(stillBuildingState(false, { stillBuildingWithheld: 'no_build_momentum' })).toBe('NOT_HELD');
  });

  /*
   * hbm-v21, founder ruling F2 (2026-10-01): a project HEY never measured is
   * NOT_MEASURED, never NOT_HELD — no tracked token, no current market
   * reading, building HEY cannot read, or a score from superseded rules.
   */
  it('NOT_MEASURED for no token, no market reading, unknown activity and a rescued market with no reading (hbm-v21)', () => {
    for (const reason of ['no_token', 'no_market_reading', 'activity_unknown', 'active_pool_not_read'] as const) {
      expect(STILL_BUILDING_WITHHELD_REASONS).toContain(reason);
      expect(stillBuildingState(false, { stillBuildingWithheld: reason }, SCORING_VERSION)).toBe('NOT_MEASURED');
      expect(STILL_BUILDING_WITHHELD_WORDS[reason]).toMatch(/^Not measured — /);
    }
  });

  it('NOT_MEASURED for a score from superseded rules, whose badge the cohort rebuild withdrew (hbm-v21)', () => {
    expect(stillBuildingState(false, {}, 'hbm-v3')).toBe('NOT_MEASURED');
    expect(stillBuildingWithheldOf(false, {}, 'hbm-v3')).toBe('not_scored');
    // A held badge is held until the rebuild withdraws it.
    expect(stillBuildingState(true, {}, 'hbm-v3')).toBe('HELD');
    expect(stillBuildingWithheldOf(true, {}, 'hbm-v3')).toBeUndefined();
  });

  it('reads the reason back: not_scored without a score, the persisted reason, else nothing', () => {
    expect(stillBuildingWithheldOf(undefined, undefined)).toBe('not_scored');
    expect(stillBuildingWithheldOf(false, { stillBuildingWithheld: 'no_token' }, SCORING_VERSION)).toBe('no_token');
    expect(stillBuildingWithheldOf(false, { stillBuildingWithheld: 'thin' }, SCORING_VERSION)).toBeUndefined();
    expect(stillBuildingWithheldOf(false, {}, SCORING_VERSION)).toBeUndefined();
  });

  it('only grows: the hbm-v19 and hbm-v20 reasons keep their place, and every reason has words', () => {
    expect(STILL_BUILDING_WITHHELD_REASONS.slice(0, 4)).toEqual(['market_not_live', 'token_not_the_projects', 'market_too_thin', 'valuation_not_plausible']);
    expect(Object.keys(STILL_BUILDING_WITHHELD_WORDS).sort()).toEqual([...STILL_BUILDING_WITHHELD_REASONS].sort());
    for (const words of Object.values(STILL_BUILDING_WITHHELD_WORDS)) expect(words).not.toMatch(/\b0\b|zero|undervalued|cheap|buy|gem/i);
  });
});
