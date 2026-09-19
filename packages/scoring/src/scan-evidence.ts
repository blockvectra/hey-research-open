/**
 * Scan evidence breakdown (`scan-evidence-v1`, 2026-09-19).
 *
 * This measures **HEY's evidence**, never the project. The question it answers
 * is "how much of this could HEY actually verify from public sources?" and not
 * "is this project good", "is it safe" or "should anyone buy it". A reader who
 * takes a low number here as a verdict on the token has been misled, so every
 * band carries its own words, the copy names what is missing, and a band HEY
 * could not measure says so instead of reporting zero.
 *
 * Three bands, each 0-100 or explicitly unmeasured:
 *
 *   identity  — how firmly the contract is tied to a named builder
 *   build     — reuses Build Momentum; never recomputed here (see `build.ts`
 *               note below), and unmeasured whenever HEY holds no recorded ship
 *   coverage  — how much of what HEY tries to read it could actually read
 *
 * The rule that makes this honest is `EvidenceState`. A check HEY could not run
 * is `unreadable`: it leaves the denominator as well as the numerator, so a
 * provider outage can never be scored against a project. A check HEY ran and
 * that came back empty is `unmet` and does count — HEY looked, and there was
 * nothing there. That is the scoring form of the product rule that absent means
 * unknown, never zero.
 *
 * Pure and deterministic: the same evidence always produces the same numbers.
 * `packages/scoring` cannot read the database, so the caller assembles the
 * input.
 */

/** The published model name. Bump whenever a weight, a threshold or a factor changes. */
export const SCAN_EVIDENCE_VERSION = 'scan-evidence-v1' as const;

/** Every model this codebase can read back. */
export const SCAN_EVIDENCE_VERSIONS = ['scan-evidence-v1'] as const;

export type ScanEvidenceVersion = (typeof SCAN_EVIDENCE_VERSIONS)[number];

/**
 * How one check came back.
 *
 * `unreadable` is the load-bearing one: HEY could not look, so the check is
 * dropped from both sides of the fraction rather than counted as a failure.
 */
export type EvidenceState = 'met' | 'unmet' | 'unreadable';

/** Evidence strength, which is a statement about HEY's reading and not about the project. */
export type EvidenceStrength = 'strong' | 'partial' | 'limited';

/** The bands a reader sees. */
export type EvidenceBandKey = 'identity' | 'build' | 'coverage';

export type EvidenceFactor = {
  key: string;
  /** Plain words, in HEY's voice. Rendered as-is. */
  label: string;
  state: EvidenceState;
  /** What this check is worth inside its own band. */
  weight: number;
};

export type EvidenceBand =
  | {
      kind: 'measured';
      /** 0-100, rounded. What share of the evidence HEY could read is actually there. */
      score: number;
      strength: EvidenceStrength;
      /** Weight HEY could read, and weight the band defines in total. */
      readable: number;
      possible: number;
      factors: readonly EvidenceFactor[];
    }
  | {
      kind: 'insufficient';
      /** One sentence saying why there is no number, in HEY's voice. */
      reason: string;
      readable: number;
      possible: number;
      factors: readonly EvidenceFactor[];
    };

export type ScanEvidence = {
  identity: EvidenceBand;
  build: EvidenceBand;
  coverage: EvidenceBand;
  overall: EvidenceBand;
  /** What HEY specifically could not see here. Only real blind spots, never boilerplate. */
  blindSpots: readonly string[];
  model: ScanEvidenceVersion;
};

/**
 * Thresholds. Deliberately not named after verdicts: a band is a reading of
 * HEY's evidence, so the words are `limited`, `partial` and `strong` rather
 * than anything a reader could hear as a rating.
 */
export const EVIDENCE_BANDS = {
  /** Below this, HEY has read little. */
  partialFrom: 40,
  /** At or above this, HEY has read most of what it looks for. */
  strongFrom: 70,
  /**
   * A band needs this share of its own weight to be readable before it reports
   * a number at all. Below it the answer is "not enough evidence", because a
   * fraction over two readable checks is noise wearing a number.
   */
  minReadableShare: 0.5,
  /** Overall needs at least this many measured bands, or it reports nothing. */
  minMeasuredBands: 2,
} as const;

/**
 * Weights for the final reading.
 *
 * Identity outweighs build, which inverts the first proposal (35/45/20), and
 * the reason is the failure this score exists to prevent: build evidence read
 * through a repository that is not established as this contract's is evidence
 * about somebody else's work. A strong build reading resting on a weak identity
 * tie is the single most misleading thing this panel could show, so identity
 * carries the most weight and `identityFloor` below caps the rest.
 */
export const EVIDENCE_WEIGHTS = {
  identity: 0.45,
  build: 0.35,
  coverage: 0.2,
} as const;

/**
 * When identity is `limited`, the overall reading cannot be reported as
 * `strong` however well the other bands read. The number is still shown; only
 * the word is held back, because the word is what a reader remembers.
 */
export const EVIDENCE_IDENTITY_FLOOR = true;

/** The heading each band carries, wherever it is rendered. */
export const BAND_LABEL: Record<EvidenceBandKey, string> = {
  identity: 'Who built it',
  build: 'What is being built',
  coverage: 'What HEY can see',
};

export function strengthOf(score: number): EvidenceStrength {
  if (score >= EVIDENCE_BANDS.strongFrom) return 'strong';
  if (score >= EVIDENCE_BANDS.partialFrom) return 'partial';
  return 'limited';
}

/** The words that travel with a strength, so the API and the page never disagree. */
export const EVIDENCE_STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  strong: 'Strong evidence',
  partial: 'Partial evidence',
  limited: 'Limited evidence',
};

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

const sumWeight = (factors: readonly EvidenceFactor[], states: readonly EvidenceState[]): number =>
  factors.reduce((total, factor) => (states.includes(factor.state) ? total + factor.weight : total), 0);

/**
 * Turn a set of checks into a band.
 *
 * The fraction is met over readable — `unreadable` leaves both sides, so a
 * provider that did not answer costs the reader a blind spot and costs the
 * project nothing.
 */
export function bandFrom(factors: readonly EvidenceFactor[], reason: string): EvidenceBand {
  const possible = sumWeight(factors, ['met', 'unmet', 'unreadable']);
  const readable = sumWeight(factors, ['met', 'unmet']);
  const met = sumWeight(factors, ['met']);
  if (possible === 0 || readable / possible < EVIDENCE_BANDS.minReadableShare) {
    return { kind: 'insufficient', reason, readable, possible, factors };
  }
  const score = clamp(Math.round((met / readable) * 100));
  return { kind: 'measured', score, strength: strengthOf(score), readable, possible, factors };
}

/** A band HEY deliberately did not measure, with the sentence explaining why. */
export function unmeasured(reason: string, factors: readonly EvidenceFactor[] = []): EvidenceBand {
  return { kind: 'insufficient', reason, readable: 0, possible: sumWeight(factors, ['met', 'unmet', 'unreadable']), factors };
}

/**
 * What the caller hands in. Every field is a fact the scan or HEY's own tables
 * already establish; nothing here is inferred from a name or a ticker, because
 * a matching name is not evidence of anything.
 */
export type ScanEvidenceInput = {
  /**
   * Which reading produced this (2026-09-19).
   *
   * A live `scan` asks the chain, the explorer, the decoded calls and the
   * declared links, so any of those can come back unreadable. A `catalogue`
   * reading answers from HEY's own tables and never asks them at all — and
   * reporting a channel as one HEY "could not see" when HEY never looked
   * there erases the distinction this model exists to keep. Those channels
   * are left out of coverage and out of the blind spots instead.
   */
  source?: 'scan' | 'catalogue' | undefined;
  /** Code was read at the address. False only in paths that never reach here. */
  contractOnChain: boolean;
  /** Explorer says the source is published and matches the bytecode. `undefined` = HEY could not reach it. */
  sourcePublished?: boolean | undefined;
  /** A creation record was readable (the decoded chain holds a short window). */
  creationRecord?: boolean | undefined;
  /** Other tracked projects launched by the same account. `undefined` = no account resolved. */
  otherProjectsFromDeployer?: number | undefined;
  /** A website is declared anywhere HEY can read. */
  siteDeclared: boolean;
  /** The declared site answered. `undefined` = declared but HEY could not read it. */
  siteAnswered?: boolean | undefined;
  /** The site's own page names this contract. The strongest tie a scan can establish. */
  siteNamesContract?: boolean | undefined;
  /** A repository is declared, or the site linked one. */
  repoDeclared: boolean;
  /** HEY read the repository. `undefined` = declared but unreadable. */
  repoRead?: boolean | undefined;
  /** The repository is established as this contract's, not merely present. */
  repoTiedToContract?: boolean | undefined;
  /** Channels declared anywhere HEY can read. Declared is not verified. */
  channelsDeclared: boolean;
  /** Decoded contract calls were readable. `undefined` = HEY could not read them. */
  surfaceRead?: boolean | undefined;
  /** A token listing profile answered. */
  listingRead?: boolean | undefined;
  /** Ships HEY has recorded for this project. Zero at scan time by construction. */
  recordedShips: number;
  /**
   * The canonical Build Momentum, when HEY holds one. Never computed here: this
   * is read from `project_score_current` so /scan and the project page cannot
   * disagree. Absent means HEY has not scored this project.
   */
  buildMomentum?: { score: number; scoringVersion: string } | undefined;
};

const factor = (key: string, label: string, state: EvidenceState, weight: number): EvidenceFactor => ({ key, label, state, weight });

/** `true` → met, `false` → unmet, `undefined` → HEY could not look. */
const readState = (value: boolean | undefined): EvidenceState =>
  value === undefined ? 'unreadable' : value ? 'met' : 'unmet';

/**
 * Who built it. Every factor is a tie between the contract and somebody, and
 * the two that actually establish one — the site naming the contract, and the
 * repository being established as this contract's — carry most of the weight.
 * A declared link is worth a little; a corroborated link is worth a lot.
 */
export function identityBand(input: ScanEvidenceInput): EvidenceBand {
  const chainSide = input.source !== 'catalogue';
  const factors: EvidenceFactor[] = [
    factor('contract', 'Code at this address', input.contractOnChain ? 'met' : 'unmet', 4),
    ...(chainSide
      ? [
          factor('source-published', 'Source published on the explorer', readState(input.sourcePublished), 8),
          factor('creation', 'Creation record readable', readState(input.creationRecord), 8),
          factor(
            'sole-deployer',
            'Deployer has launched no other project HEY tracks',
            input.otherProjectsFromDeployer === undefined
              ? 'unreadable'
              : input.otherProjectsFromDeployer === 0
                ? 'met'
                : 'unmet',
            8,
          ),
        ]
      : []),
    factor('site-declared', 'A website is declared', input.siteDeclared ? 'met' : 'unmet', 10),
    // Not declared is not unreadable: HEY looked at the listing and there was none.
    factor('site-answers', 'The declared website answers', input.siteDeclared ? readState(input.siteAnswered) : 'unmet', 10),
    factor(
      'site-names-contract',
      'The website names this contract',
      input.siteDeclared ? readState(input.siteNamesContract) : 'unmet',
      24,
    ),
    factor('repo-declared', 'A public repository is declared', input.repoDeclared ? 'met' : 'unmet', 10),
    factor(
      'repo-tied',
      'The repository is established as this contract’s',
      input.repoDeclared ? readState(input.repoTiedToContract) : 'unmet',
      24,
    ),
    factor('channels', 'Channels declared', input.channelsDeclared ? 'met' : 'unmet', 4),
  ];
  return bandFrom(factors, 'HEY could not read enough to say who built this.');
}

/**
 * What HEY can see. This is the one band that is about HEY rather than about
 * the project at all: of the places HEY looks, how many did it get an answer
 * from. A channel that does not exist and a channel that would not answer both
 * reduce visibility, and both are named underneath rather than scored against
 * anyone.
 */
export function coverageBand(input: ScanEvidenceInput): EvidenceBand {
  const seen = (value: boolean | undefined): EvidenceState => (value === true ? 'met' : 'unmet');
  const chainSide = input.source !== 'catalogue';
  const factors: EvidenceFactor[] = [
    factor('chain', 'Contract read from the chain', input.contractOnChain ? 'met' : 'unmet', 1),
    ...(chainSide
      ? [
          factor('explorer', 'Explorer source record', seen(input.sourcePublished !== undefined), 1),
          factor('creation', 'Creation record', seen(input.creationRecord), 1),
          factor('surface', 'Decoded contract calls', seen(input.surfaceRead), 1),
        ]
      : []),
    factor('site', 'A website HEY could read', seen(input.siteAnswered), 1),
    factor('repo', 'A repository HEY could read', seen(input.repoRead), 1),
    factor('listing', 'Token listing profile', seen(input.listingRead), 1),
    factor('ships', 'Ships recorded from a registered source', input.recordedShips > 0 ? 'met' : 'unmet', 1),
  ];
  return bandFrom(factors, 'HEY could not read enough to say how much it can see.');
}

/**
 * What is being built.
 *
 * Build Momentum is the canonical measure and it is **reused, never
 * recomputed** — the formula lives in `hbm.ts`, the value is read from
 * `project_score_current`, and /scan reports the same number the project page
 * does. A contract HEY has no recorded ship for has no Build Momentum, and the
 * honest answer there is that there is not enough public activity to measure,
 * not a zero that reads as "this team does nothing".
 */
export function buildBand(input: ScanEvidenceInput): EvidenceBand {
  if (input.buildMomentum === undefined) {
    return unmeasured(
      input.recordedShips > 0
        ? 'HEY has not finished measuring this project’s build activity.'
        : 'HEY has no recorded ship for this contract, so there is no public activity to measure. A scan does not create one.',
    );
  }
  const score = clamp(Math.round(input.buildMomentum.score));
  return {
    kind: 'measured',
    score,
    strength: strengthOf(score),
    readable: 100,
    possible: 100,
    factors: [factor('build-momentum', `Build Momentum (${input.buildMomentum.scoringVersion})`, 'met', 100)],
  };
}

/**
 * The weighted reading across the bands HEY could measure.
 *
 * Weights are renormalised over the measured bands, so a band HEY could not
 * measure neither counts as zero nor silently shrinks the total. Fewer than two
 * measured bands reports nothing at all: one band is not a reading.
 */
export function overallBand(identity: EvidenceBand, build: EvidenceBand, coverage: EvidenceBand): EvidenceBand {
  type Measured = Extract<EvidenceBand, { kind: 'measured' }>;
  const all: { key: EvidenceBandKey; band: EvidenceBand; weight: number }[] = [
    { key: 'identity', band: identity, weight: EVIDENCE_WEIGHTS.identity },
    { key: 'build', band: build, weight: EVIDENCE_WEIGHTS.build },
    { key: 'coverage', band: coverage, weight: EVIDENCE_WEIGHTS.coverage },
  ];
  const parts = all.filter((part): part is { key: EvidenceBandKey; band: Measured; weight: number } => part.band.kind === 'measured');

  if (parts.length < EVIDENCE_BANDS.minMeasuredBands) {
    return unmeasured('Not enough of this could be measured to give an overall reading.');
  }
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = clamp(Math.round(parts.reduce((sum, part) => sum + part.band.score * part.weight, 0) / total));
  const raw = strengthOf(score);
  // A strong overall on a weak identity tie would be the most misleading thing
  // this panel could print, so the word is held back while the number stands.
  const held = EVIDENCE_IDENTITY_FLOOR && identity.kind === 'measured' && identity.strength === 'limited' && raw === 'strong';
  return {
    kind: 'measured',
    score,
    strength: held ? 'partial' : raw,
    readable: parts.length,
    possible: 3,
    factors: parts.map((part) =>
      factor(part.key, BAND_LABEL[part.key], 'met', Math.round((part.weight / total) * 100)),
    ),
  };
}

/**
 * Every real blind spot, named. Nothing generic: a line appears only when this
 * particular scan actually could not see the thing, so the list stays worth
 * reading instead of becoming a disclaimer everyone scrolls past.
 */
export function blindSpotsOf(input: ScanEvidenceInput): string[] {
  const spots: string[] = [];
  const chainSide = input.source !== 'catalogue';
  if (chainSide && input.sourcePublished === undefined)
    spots.push('Whether the contract’s source is published — HEY could not reach the explorer.');
  if (chainSide && (input.creationRecord === undefined || input.creationRecord === false))
    spots.push('Who deployed it — the decoded chain HEY reads holds about four days, so an older contract falls outside the window.');
  if (chainSide && input.otherProjectsFromDeployer === undefined)
    spots.push('Whether the deployer has launched anything else HEY tracks.');
  if (!input.siteDeclared) spots.push('A website — none is declared anywhere HEY can read.');
  else if (input.siteAnswered !== true) spots.push('The declared website — it did not answer, so HEY could not check whether it names this contract.');
  if (!input.repoDeclared) spots.push('Code activity — no repository is declared and the site linked none.');
  else if (input.repoRead !== true) spots.push('The declared repository — HEY could not read it.');
  else if (input.repoTiedToContract !== true)
    spots.push('Whether the repository belongs to this contract — HEY counts code activity only when the project links the repository from a site that also names the contract.');
  if (chainSide && input.surfaceRead !== true) spots.push('What the contract answers — HEY could not read the decoded calls.');
  if (input.recordedShips === 0) spots.push('Any shipped work — HEY records a ship from a source a project has registered, and this contract has none.');
  return spots;
}

/** The whole breakdown, in one deterministic pass. */
export function scanEvidence(input: ScanEvidenceInput): ScanEvidence {
  const identity = identityBand(input);
  const build = buildBand(input);
  const coverage = coverageBand(input);
  return {
    identity,
    build,
    coverage,
    overall: overallBand(identity, build, coverage),
    blindSpots: blindSpotsOf(input),
    model: SCAN_EVIDENCE_VERSION,
  };
}
