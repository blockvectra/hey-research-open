import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ACTIVITY,
  CONSISTENCY,
  EVENT_BASE_WEIGHTS,
  HBM_WEIGHTS,
  MARKET_CONTEXT_WEIGHTS,
  RECENCY,
  SIGNIFICANCE_DIMENSIONS,
  SOURCE_DIVERSITY,
  STILL_BUILDING,
  UNDER_THE_RADAR,
  VERIFICATION_WEIGHTS,
} from './config';
import { SCORING_VERSION, SCORING_VERSIONS } from './version';

/**
 * The version is stored with every snapshot so history stays explainable
 * (2026-09-18). Twice on 2026-09-17 a threshold changed and the tag did not,
 * so two rule sets share `hbm-v6`. The digest below is every weight, window
 * and threshold; changing any of them changes the digest, and the test then
 * demands a new tag with it.
 */
const RULES_DIGEST = createHash('sha256')
  .update(
    JSON.stringify({
      ACTIVITY,
      CONSISTENCY,
      EVENT_BASE_WEIGHTS,
      HBM_WEIGHTS,
      MARKET_CONTEXT_WEIGHTS,
      RECENCY,
      SIGNIFICANCE_DIMENSIONS,
      SOURCE_DIVERSITY,
      STILL_BUILDING,
      UNDER_THE_RADAR,
      VERIFICATION_WEIGHTS,
    }),
  )
  .digest('hex')
  .slice(0, 16);

describe('scoring version', () => {
  it('is the newest of the recorded versions', () => {
    expect(SCORING_VERSIONS.at(-1)).toBe(SCORING_VERSION);
  });

  it('changes whenever a weight, window or threshold changes', () => {
    /*
     * The pin is a literal, not a variable (round 9, 2026-09-19). It read
     * `process.env.PIN_RULES_DIGEST ?? RULES_DIGEST`, nothing in the
     * repository ever set that variable, and so the one guard whose job is to
     * force a version bump was comparing the digest to itself and could not
     * fail.
     *
     * When this fails you changed a weight, a window or a threshold. Bump
     * SCORING_VERSION, write its note in `version.ts`, and then change BOTH
     * literals below — the new tag and the new digest. Changing only the
     * digest is the bug this test exists to catch.
     */
    expect({ version: SCORING_VERSION, rules: RULES_DIGEST }).toEqual({
      version: 'hbm-v8',
      rules: 'eb3ded8555c71274',
    });
  });
});
