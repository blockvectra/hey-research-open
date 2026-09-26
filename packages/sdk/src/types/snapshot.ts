/**
 * A project's snapshot, coverage and explanations, and evidence receipts
 * (2026-09-26). Each is read from HEY's own tables; none calls a provider.
 * Absent means HEY does not know; a withheld figure says it is withheld.
 */
import type { HeyProject } from './projects';

/* ------------------------------------------------------------- coverage */

/**
 * What HEY knows about one dimension of a project. States, never a score:
 * `MEASURED` (figures elsewhere are measurements, zeros included),
 * `NO_SOURCE`, `NOT_ENOUGH_YET`, `STALE`, `SOURCE_UNAVAILABLE`,
 * `NOT_APPLICABLE`, `NOT_RESEARCHED`, `ERROR`, `WITHHELD` (measured and not
 * published on this surface).
 */
export type HeyCoverageState = 'MEASURED' | 'NO_SOURCE' | 'NOT_ENOUGH_YET' | 'STALE' | 'SOURCE_UNAVAILABLE' | 'NOT_APPLICABLE' | 'NOT_RESEARCHED' | 'ERROR' | 'WITHHELD';

export type HeyCoverageDimension =
  | 'identity'
  | 'builderEvidence'
  | 'repositories'
  | 'releases'
  | 'marketCurrent'
  | 'marketHistory'
  | 'contractDeployment'
  | 'contractActivity'
  | 'contractSource'
  | 'contractInterface'
  | 'distribution'
  | 'locks'
  | 'marketIntegrity'
  | 'timeline';

export type HeyCoverageEntry = {
  state: HeyCoverageState;
  /** How far back HEY's record of this dimension reaches. */
  since?: string;
  /** The newest reading behind it. */
  asOf?: string;
  /** A machine code for why the state is what it is (`hoodlock_only_none_found`, `no_builder_source`, …). */
  reason?: string;
  /** Where the figures are, on this API. */
  detailUrl?: string;
};

export type HeySourceFreshness = {
  source: 'code' | 'market' | 'contracts' | 'locks' | 'score';
  label: string;
  state: 'fresh' | 'stale' | 'unknown';
  /** Absent when HEY has never read it. */
  observedAt?: string;
  staleAfterHours: number;
};

/** `GET /api/projects/{slug}/coverage`. */
export type HeyProjectCoverage = {
  project: { slug: string; name: string; url: string };
  dimensions: Record<HeyCoverageDimension, HeyCoverageEntry>;
  freshness: HeySourceFreshness[];
  computedAt: string;
  /** What each state means. */
  states: Record<HeyCoverageState, string>;
  disclaimer: string;
};

/* -------------------------------------------------------------- explain */

export type HeyExplainFact =
  | 'market.valuation'
  | 'market.status'
  | 'activity.status'
  | 'build.momentum'
  | 'discovery_gap'
  | 'still_building'
  | 'research.level'
  | 'token.verification'
  | 'source.counted'
  | 'market_integrity.state';

export type HeyExplainInputValue = string | number | boolean | null | (string | number)[];

/** `GET /api/projects/{slug}/explain?fact=`: why HEY publishes a fact. */
export type HeyExplainedFact = {
  project: { slug: string; name: string; url: string };
  fact: string;
  /** The published value, exactly as the API sends it; null when not published (see `classification`). */
  value: HeyExplainInputValue;
  /** FACT: a recorded value. DERIVED: a rule HEY applied. UNKNOWN: HEY does not hold enough to say. */
  state: 'FACT' | 'DERIVED' | 'UNKNOWN';
  classification: string;
  canonicalRule: { id: string; version: string; text: string };
  source: string | null;
  observedAt: string | null;
  freshness: { state: 'fresh' | 'stale' | 'unknown'; staleAfterHours: number } | null;
  inputs: { name: string; value: HeyExplainInputValue; source?: string; observedAt?: string }[];
  /** SOURCE → SANITATION → SELECTION → DERIVATION → PUBLIC. */
  lineage: { step: 'source' | 'sanitation' | 'selection' | 'derivation' | 'public'; text: string }[];
  /** Typed ids that resolve at `/api/evidence/{id}`. */
  evidence: { id: string; url: string }[];
  unknownInputs: string[];
  reason: string;
  disclaimer: string;
};

/** A bare `GET /api/projects/{slug}/explain`: the facts HEY can explain. */
export type HeyExplainIndex = {
  project: { slug: string; name: string; url: string };
  facts: { fact: string; description: string; url: string }[];
  disclaimer: string;
};

/* ------------------------------------------------------------- evidence */

export type HeyEvidenceMetadataValue = string | number | boolean | null | (string | number | boolean | null)[] | Record<string, unknown>[];

/**
 * `GET /api/evidence/{id}`: one published record by its typed id
 * (`ship:<uuid>`, `signal:<uuid>`, `abi:<uuid>`, `lock:<chainId>:<lockId>`,
 * `source:<uuid>`, `claim:<uuid>`, `state:…`, `impl:…`). A withdrawn or hidden
 * record answers with its id and why; for a project that is not public, not
 * even the slug.
 */
export type HeyEvidenceReceipt =
  | {
      id: string;
      withdrawn: false;
      project: { slug: string; name: string; url: string };
      domain: 'build' | 'contract' | 'market' | 'token' | 'research' | 'lock';
      claimType: string;
      summary: string;
      sourceType: string;
      sourceUrl: string | null;
      /** When the source dates it; null when only HEY's observation dates it. */
      publishedAt: string | null;
      detectedAt: string;
      precision: 'EXACT' | 'DATE' | 'WEEK' | 'WINDOW' | 'OBSERVED' | 'SCHEDULED';
      verification: string | null;
      /** Present and true only when the record counts toward activity status. */
      countsAsBuilding?: true;
      recordedAt: string;
      metadata: Record<string, HeyEvidenceMetadataValue>;
      /** Every evidence row behind a ship. */
      sources?: { evidenceRowId: string; sourceType: string; sourceUrl: string; observedAt: string; metadata: Record<string, HeyEvidenceMetadataValue> }[];
      disclaimer: string;
    }
  | {
      id: string;
      withdrawn: true;
      /** `retracted`, `disputed`, `context_only`, `review_false_positive`, `announced_ship_withdrawn`, `superseded`, or `not_public`. */
      withdrawalReason: string;
      /** Present only when the project is public. */
      project?: { slug: string; name: string; url: string };
      disclaimer: string;
    };

/* ------------------------------------------------------------- snapshot */

export type HeySnapshotChange =
  | {
      id: string;
      revision: number;
      op: 'upsert';
      type: string;
      domain: string;
      occurredAt: string | null;
      precision: string;
      detectedAt: string;
      recordedAt: string;
      summary: string;
      evidence: { id: string; url?: string; label: string }[];
      source: string;
    }
  | { id: string; revision: number; op: 'retract'; recordedAt: string };

/** `GET /api/projects/{slug}/snapshot`: one project's important state in one read. */
export type HeyProjectSnapshot = {
  identity: {
    slug: string;
    name: string;
    symbol?: string;
    projectKind: string;
    researchLevel: string;
    catalogStatus: string;
    primaryNarrative?: { slug: string; name: string };
    token?: { chainId: number; contractAddress: string };
    websiteUrl?: string;
    /** When HEY first recorded the project: knowledge time. */
    firstRecordedByHeyAt: string;
    externalListedAt?: string;
    externalListedSource?: string;
    url: string;
  };
  build: {
    activityStatus: string;
    /** False without a readable builder source or on an UNKNOWN status: zeros are then not findings. */
    activityMeasured?: boolean;
    lastShippedAt?: string;
    /** Absent when not measured, as on the detail route. */
    buildMomentum?: number;
    stillBuilding: boolean;
    stillBuildingEvidence?: { drawdownPercent: number; shipsSinceDecline?: number };
    discoveryGap?: number;
    velocity?: { state: string; current: number | null; previous: number | null; windowDays: number };
    cadence?: { state: string; medianIntervalDays?: number };
    hasBuilderSource?: boolean;
  };
  /** The card's market fields with the card's gates; absent for a project without a token. */
  market?: {
    marketCap?: NonNullable<HeyProject['marketCap']>;
    /** Present when the market is not live and the valuation is withheld: the reason code. */
    valuationWithheld?: string;
    liquidity?: NonNullable<HeyProject['liquidity']>;
    volume24h?: NonNullable<HeyProject['volume24h']>;
    priceChange24hPct?: number;
    venue?: string;
    tokenMarket?: NonNullable<HeyProject['tokenMarket']>;
    launchStage?: NonNullable<HeyProject['launchStage']>;
    url: string;
  };
  onchain?: { events24h?: number; events7d?: number; calls24h?: number; daysCovered: number; daysMeasured: number; observedAt: string };
  contracts: { url: string };
  verification: {
    token?: { status: string; reason?: string; verifiedAt?: string };
    ownerVerified: boolean;
    submitted: boolean;
    sources: { total: number; own: number; verified: number; contextOnly: number };
  };
  locks: {
    tokenLock?: NonNullable<HeyProject['tokenLock']>;
    /** HoodLock only. */
    coverage?: HeyCoverageEntry;
  };
  integrity: { state: 'WITHHELD' | 'NOT_APPLICABLE' | 'MEASURED'; reason: string };
  /** The newest public change events, or why HEY cannot list them yet — never an empty list standing in for "unknown". */
  latestChanges: { available: true; items: HeySnapshotChange[]; url: string } | { available: false; reason: string; url: string };
  freshness: HeySourceFreshness[];
  coverage?: Record<HeyCoverageDimension, HeyCoverageEntry>;
  evidenceSummary: { sources: { total: number; own: number; verified: number; contextOnly: number }; meaningfulEvents30d: number | null; explainUrl: string };
  links: { page: string; detail: string; market?: string; timeline: string; intelligence: string; changes: string; coverage: string; explain: string; contracts: string };
  asOf: string;
  scoringVersion?: string;
  disclaimer: string;
};
