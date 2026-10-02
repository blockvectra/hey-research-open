import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ACTIVITY,
  CONSISTENCY,
  DISCOVERY_GAP,
  EVENT_BASE_WEIGHTS,
  HBM_WEIGHTS,
  MARKET_CONTEXT_WEIGHTS,
  RECENCY,
  RELEASE_BURST,
  SIGNIFICANCE_DIMENSIONS,
  SOURCE_DIVERSITY,
  STILL_BUILDING,
  UNDER_THE_RADAR,
  VERIFICATION_WEIGHTS,
} from './config';
import { AUTOMATION } from './commit-automation';
import { BURST, COMMIT_SUBSTANCE_VERSION } from './commit-substance';
import { VALUATION_PLAUSIBILITY } from './valuation-plausibility';
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
      COMMIT_SUBSTANCE_VERSION,
      // What counts in a code week (hbm-v22): the burst sample and the automated-stream rule.
      BURST,
      AUTOMATION,
      DISCOVERY_GAP,
      // The valuation gate decides which valuations the Discovery Gap and Still Building read (hbm-v20).
      VALUATION_PLAUSIBILITY,
      // A repository's full releases of one UTC day count once (hbm-v23).
      RELEASE_BURST,
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
      version: 'hbm-v23',
      rules: '12cb1a6ee806d255',
    });
  });
});
