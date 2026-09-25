import { describe, expect, it } from 'vitest';

import { momentumMeasured } from './momentum';

describe('momentumMeasured', () => {
  it('counts any positive score as measured', () => {
    expect(momentumMeasured({ score: { hbm: 12 }, activityResearched: false, activityStatus: 'UNKNOWN' })).toBe(true);
  });

  it('keeps a researched zero on a readable, quiet project', () => {
    expect(momentumMeasured({ score: { hbm: 0 }, activityResearched: true, activityStatus: 'DORMANT' })).toBe(true);
  });

  it('does not print a zero for a project HEY found nothing readable for (A10-12, 2026-09-25)', () => {
    expect(momentumMeasured({ score: { hbm: 0 }, activityResearched: true, activityStatus: 'UNKNOWN' })).toBe(false);
    expect(momentumMeasured({ score: { hbm: 0 }, activityResearched: false, activityStatus: 'QUIET' })).toBe(false);
    expect(momentumMeasured({ score: undefined, activityResearched: true })).toBe(false);
  });
});
