import { describe, expect, it } from 'vitest';

import {
  bandFrom,
  blindSpotsOf,
  buildBand,
  coverageBand,
  EVIDENCE_BANDS,
  EVIDENCE_WEIGHTS,
  identityBand,
  overallBand,
  scanEvidence,
  SCAN_EVIDENCE_VERSION,
  strengthOf,
  type EvidenceFactor,
  type ScanEvidenceInput,
} from './scan-evidence';

/** A contract HEY could read nothing about beyond its own bytecode. */
const bare: ScanEvidenceInput = {
  contractOnChain: true,
  siteDeclared: false,
  repoDeclared: false,
  channelsDeclared: false,
  recordedShips: 0,
};

/** Everything a scan can establish, established. */
const full: ScanEvidenceInput = {
  contractOnChain: true,
  sourcePublished: true,
  creationRecord: true,
  otherProjectsFromDeployer: 0,
  siteDeclared: true,
  siteAnswered: true,
  siteNamesContract: true,
  repoDeclared: true,
  repoRead: true,
  repoTiedToContract: true,
  channelsDeclared: true,
  surfaceRead: true,
  listingRead: true,
  recordedShips: 4,
  buildMomentum: { score: 81, scoringVersion: 'hbm-v8' },
};

describe('strength thresholds', () => {
  it.each([
    [0, 'limited'],
    [39, 'limited'],
    [40, 'partial'],
    [69, 'partial'],
    [70, 'strong'],
    [100, 'strong'],
  ])('%i is %s', (score, strength) => {
    expect(strengthOf(score)).toBe(strength);
  });
});

describe('a check HEY could not run', () => {
  const two = (a: EvidenceFactor['state'], b: EvidenceFactor['state']): EvidenceFactor[] => [
    { key: 'a', label: 'A', state: a, weight: 50 },
    { key: 'b', label: 'B', state: b, weight: 50 },
  ];

  /*
   * The rule the whole model rests on. A provider outage must cost the reader a
   * blind spot and cost the project nothing, so `unreadable` leaves both sides
   * of the fraction rather than scoring as a failure.
   */
  it('leaves the denominator as well as the numerator', () => {
    const met = bandFrom([...two('met', 'unreadable'), { key: 'c', label: 'C', state: 'met', weight: 50 }], 'why');
    expect(met).toMatchObject({ kind: 'measured', score: 100, readable: 100, possible: 150 });
  });

  it('is not the same as a check that came back empty', () => {
    const looked = bandFrom(two('met', 'unmet'), 'why');
    expect(looked).toMatchObject({ kind: 'measured', score: 50 });
  });

  it('reports no number at all once too little is readable', () => {
    const mostly = bandFrom(
      [
        { key: 'a', label: 'A', state: 'met', weight: 10 },
        { key: 'b', label: 'B', state: 'unreadable', weight: 90 },
      ],
      'HEY could not read enough.',
    );
    expect(mostly).toEqual({
      kind: 'insufficient',
      reason: 'HEY could not read enough.',
      readable: 10,
      possible: 100,
      factors: expect.any(Array),
    });
  });

  it('draws the line exactly at the declared share', () => {
    const half = bandFrom(
      [
        { key: 'a', label: 'A', state: 'met', weight: 50 },
        { key: 'b', label: 'B', state: 'unreadable', weight: 50 },
      ],
      'why',
    );
    expect(EVIDENCE_BANDS.minReadableShare).toBe(0.5);
    expect(half.kind).toBe('measured');
  });
});

describe('who built it', () => {
  it('reads strong when the site names the contract and the repository is tied to it', () => {
    const band = identityBand(full);
    expect(band.kind).toBe('measured');
    if (band.kind !== 'measured') throw new Error('unreachable');
    expect(band.score).toBe(100);
    expect(band.strength).toBe('strong');
  });

  /*
   * The failure this band exists to prevent: a real repository that nothing
   * ties to the contract. It must not read as strong identity evidence.
   */
  it('does not credit a repository nothing ties to the contract', () => {
    const borrowed = identityBand({ ...full, siteNamesContract: false, repoTiedToContract: false });
    expect(borrowed.kind).toBe('measured');
    if (borrowed.kind !== 'measured') throw new Error('unreachable');
    expect(borrowed.score).toBeLessThan(EVIDENCE_BANDS.strongFrom);
    expect(borrowed.factors.find((f) => f.key === 'repo-tied')?.state).toBe('unmet');
  });

  it('counts a declared thing that is simply absent, because HEY did look', () => {
    const band = identityBand(bare);
    expect(band.kind).toBe('measured');
    if (band.kind !== 'measured') throw new Error('unreachable');
    expect(band.factors.find((f) => f.key === 'site-declared')?.state).toBe('unmet');
    // Nothing was declared, so nothing could answer — still `unmet`, not unreadable.
    expect(band.factors.find((f) => f.key === 'site-answers')?.state).toBe('unmet');
  });

  it('marks a deployer that launched other tracked projects as unmet, not unreadable', () => {
    const shared = identityBand({ ...full, otherProjectsFromDeployer: 12 });
    if (shared.kind !== 'measured') throw new Error('unreachable');
    expect(shared.factors.find((f) => f.key === 'sole-deployer')?.state).toBe('unmet');
    expect(shared.score).toBeLessThan(100);
  });
});

describe('what is being built', () => {
  /*
   * The canonical measure is reused, never recomputed. A contract with no
   * recorded ship has no Build Momentum, and zero would read as "this team does
   * nothing" when the truth is that HEY has nothing registered to read from.
   */
  it('reports no number for a contract HEY holds no ship for', () => {
    const band = buildBand(bare);
    expect(band.kind).toBe('insufficient');
    if (band.kind !== 'insufficient') throw new Error('unreachable');
    expect(band.reason).toMatch(/no recorded ship/i);
    expect(band.reason).toMatch(/A scan does not create one/);
  });

  it('carries the canonical score and its version through untouched', () => {
    const band = buildBand(full);
    expect(band).toMatchObject({ kind: 'measured', score: 81, strength: 'strong' });
    if (band.kind !== 'measured') throw new Error('unreachable');
    expect(band.factors[0]?.label).toBe('Build Momentum (hbm-v8)');
  });

  it('says HEY has not finished when there are ships but no stored score', () => {
    const band = buildBand({ ...bare, recordedShips: 3 });
    if (band.kind !== 'insufficient') throw new Error('unreachable');
    expect(band.reason).toMatch(/not finished measuring/i);
  });
});

describe('what HEY can see', () => {
  it('is measurable even when almost nothing was found', () => {
    const band = coverageBand(bare);
    // Coverage is about HEY's reach, so it answers where the other bands cannot.
    expect(band.kind).toBe('measured');
    if (band.kind !== 'measured') throw new Error('unreachable');
    expect(band.score).toBeLessThan(EVIDENCE_BANDS.partialFrom);
  });

  it('reads full when every channel answered', () => {
    const band = coverageBand(full);
    expect(band).toMatchObject({ kind: 'measured', score: 100 });
  });
});

describe('the overall reading', () => {
  it('renormalises over the bands that could be measured', () => {
    const identity = identityBand(full);
    const coverage = coverageBand(full);
    const build = buildBand(bare); // unmeasured
    const overall = overallBand(identity, build, coverage);
    if (overall.kind !== 'measured' || identity.kind !== 'measured' || coverage.kind !== 'measured') throw new Error('unreachable');
    const total = EVIDENCE_WEIGHTS.identity + EVIDENCE_WEIGHTS.coverage;
    const expected = Math.round((identity.score * EVIDENCE_WEIGHTS.identity + coverage.score * EVIDENCE_WEIGHTS.coverage) / total);
    expect(overall.score).toBe(expected);
    expect(overall.readable).toBe(2);
  });

  it('reports nothing when only one band could be measured', () => {
    const overall = overallBand(
      { kind: 'insufficient', reason: 'a', readable: 0, possible: 10, factors: [] },
      { kind: 'insufficient', reason: 'b', readable: 0, possible: 10, factors: [] },
      coverageBand(bare),
    );
    expect(overall.kind).toBe('insufficient');
    if (overall.kind !== 'insufficient') throw new Error('unreachable');
    expect(overall.reason).toMatch(/overall reading/i);
  });

  /*
   * Build evidence read through an unestablished repository is evidence about
   * somebody else's work, so a weak identity tie holds the word back even when
   * the arithmetic clears the threshold.
   */
  it('does not call a reading strong when the identity tie is weak', () => {
    const weakIdentity = identityBand({
      ...bare,
      sourcePublished: false,
      creationRecord: false,
      otherProjectsFromDeployer: 9,
      surfaceRead: true,
      listingRead: true,
    });
    if (weakIdentity.kind !== 'measured') throw new Error('unreachable');
    expect(weakIdentity.strength).toBe('limited');
    const overall = overallBand(weakIdentity, buildBand(full), coverageBand(full));
    if (overall.kind !== 'measured') throw new Error('unreachable');
    expect(overall.strength).not.toBe('strong');
  });
});

describe('blind spots', () => {
  it('names only what this scan actually could not see', () => {
    expect(blindSpotsOf(full)).toEqual([]);
  });

  it('names a repository nothing ties to the contract, distinctly from having none', () => {
    const untied = blindSpotsOf({ ...full, repoTiedToContract: false });
    expect(untied.join(' ')).toMatch(/whether the repository belongs to this contract/i);
    const none = blindSpotsOf({ ...full, repoDeclared: false, repoRead: undefined, repoTiedToContract: undefined });
    expect(none.join(' ')).toMatch(/no repository is declared/i);
  });

  it('separates a site that did not answer from a site that was never declared', () => {
    expect(blindSpotsOf({ ...full, siteAnswered: false }).join(' ')).toMatch(/did not answer/);
    expect(blindSpotsOf({ ...full, siteDeclared: false }).join(' ')).toMatch(/none is declared/);
  });
});

describe('the whole breakdown', () => {
  it('is deterministic', () => {
    expect(scanEvidence(full)).toEqual(scanEvidence(full));
  });

  it('carries its model version', () => {
    expect(scanEvidence(bare).model).toBe(SCAN_EVIDENCE_VERSION);
    expect(SCAN_EVIDENCE_VERSION).toBe('scan-evidence-v1');
  });

  /*
   * The product boundary, asserted on the model itself: this measures HEY's
   * evidence, so none of its own words may read as a verdict on a token.
   */
  it('never uses verdict vocabulary anywhere in its output', () => {
    for (const input of [bare, full, { ...full, repoTiedToContract: false, siteNamesContract: false }]) {
      const json = JSON.stringify(scanEvidence(input));
      expect(json).not.toMatch(/\brug(ged)?\b|scam|\bsafe\b|risky|legit|trustworthy|suspicious/i);
      expect(json).not.toMatch(/"rating"|"grade"|risk|quality|danger|warning/i);
    }
  });

  it('never reports zero for a contract it simply has not read', () => {
    const breakdown = scanEvidence(bare);
    // Build must refuse a number rather than print 0 for "nothing registered".
    expect(breakdown.build.kind).toBe('insufficient');
    expect(breakdown.blindSpots.length).toBeGreaterThan(0);
  });
});
