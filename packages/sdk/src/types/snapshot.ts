/**
 * A project's snapshot, coverage and explanations, and evidence receipts
 * (2026-09-26). Each is read from HEY's own tables; none calls a provider.
 * Absent means HEY does not know; a withheld figure says it is withheld.
 */
import type { HeyDiscoveryGapWithheld, HeyProject, HeyStillBuildingState, HeyStillBuildingWithheld } from './projects';
import type { HeyPeerContext } from './graph';
import type { HeyUsageSummary } from './usage';

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
  | 'timeline'
  /** The project's own site (2026-09-27): official docs, a published API description, material source changes. */
  | 'officialDocs'
  | 'apiDocs'
  | 'sourceChanges'
  /** DefiLlama fees, revenue and DEX volume for a matched protocol (2026-09-27). `NOT_APPLICABLE` when none is matched. */
  | 'protocolEconomics'
  /** Developer footprint (2026-09-27): official repositories' declared metadata and production deployments. */
  | 'gitHost'
  /** Published packages tied to the project; `NOT_APPLICABLE` for a token project with no repository and no package. */
  | 'package'
  /** OSV advisories about accepted packages, or deps.dev's Scorecard checks; context, never a verdict. */
  | 'securityContext';

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
      domain: 'build' | 'contract' | 'market' | 'token' | 'research' | 'lock' | 'market_integrity';
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
      /**
       * With `context_only`: which rule holds a follow-up deployment as context (2026-09-27) —
       * `held_by_another_project`, `shared_deployer`, `serial_launcher_deployer` (the account
       * launches contracts for many projects), `token_mismatch` or `deployer_not_tied`.
       */
      contextReason?: string;
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
      /** Present and true only for an event that counts toward activity status (2026-09-30, additive). */
      countsAsBuilding?: true;
    }
  | { id: string; revision: number; op: 'retract'; recordedAt: string };

/** One DefiLlama metric: a figure only when measured; otherwise why not — never a zero standing in for unknown. */
export type HeyEconomicsMetric =
  | { state: 'MEASURED'; valueUsd: number }
  | { state: 'NOT_TRACKED' | 'SOURCE_UNAVAILABLE' | 'NOT_ENOUGH_YET' };

/**
 * Protocol Economics (2026-09-27): what the DefiLlama registry measures of a
 * matched protocol's use on this chain. Context only — never an input to
 * activity status, Build Momentum, the Discovery Gap or the Radar.
 */
export type HeyProtocolEconomics = {
  protocols: {
    protocol: string;
    protocolName: string;
    category?: string;
    tvlUsd: number;
    tvlDay: string;
    matchedBy: string;
    fees24h: HeyEconomicsMetric;
    revenue24h: HeyEconomicsMetric;
    dexVolume24h: HeyEconomicsMetric;
    /** The day the three figures are for; absent before HEY's first read. */
    economicsDay?: string;
    /** Registry links, verbatim. Links, never verdicts. */
    auditLinks: string[];
    methodologyUrl?: string;
    parentProtocol?: string;
  }[];
  source: 'defillama';
  contextOnly: true;
};

/**
 * Paid promotion and community-takeover sightings for a token (2026-09-27).
 * `providerAt` is the provider's own date, absent when it gave none (then
 * `firstObservedAt` is HEY's observation). Never an amount or a ranking input.
 */
export type HeyMarketPromotion = {
  entries: {
    kind: 'MARKET_PROMOTION_OBSERVED' | 'COMMUNITY_TAKEOVER_PROFILE_OBSERVED';
    channel: string;
    providerAt?: string;
    firstObservedAt: string;
    lastObservedAt: string;
    source: string;
  }[];
  /** Rows in all; `entries` holds the newest ten. */
  total: number;
  contextOnly: true;
};

/**
 * The developer footprint in four lines (2026-09-27). Each carries its
 * coverage state and reason code (`gitHost`, `package`, `securityContext`);
 * a count is present only where the state says it was measured. Context: a
 * deployment record dates an environment, a package publication is never a
 * ship, and an advisory is about a published version — never a verdict.
 */
export type HeyDeveloperFootprint = {
  repositories: { state: HeyCoverageState; reason: string; asOf?: string; official: number; metadataRead: number };
  productionDeployment:
    | { state: 'MEASURED'; at: string; environment: string; readAt?: string }
    | { state: 'NONE_FOUND'; readAt?: string }
    | { state: 'NOT_READ' | 'ERROR' | 'NOT_APPLICABLE' };
  packages: { state: HeyCoverageState; reason: string; asOf?: string; accepted?: number; claimed?: number };
  advisories: { state: HeyCoverageState; reason: string; asOf?: string; current?: number; subject: 'PUBLISHED_PACKAGE' };
  contextOnly: true;
  coverageUrl: string;
};

/* ----------------------------------------------------- research summary */

/** The questions a Research Summary answers, in order (2026-09-28). */
export type HeySummaryDimension = 'build' | 'usage' | 'market' | 'contract' | 'fundamentals' | 'security' | 'latestChange' | 'unknown';

/** FACT: a record HEY holds. DERIVED: HEY's own reading of records. UNKNOWN: HEY does not know, and `reason` says why — never a zero. */
export type HeySummaryTag = 'FACT' | 'DERIVED' | 'UNKNOWN';

export type HeySummaryFreshness = 'fresh' | 'stale' | 'unknown' | 'not_applicable';

export type HeySummaryBasis = 'evidence_record' | 'market_reading' | 'usage_reading' | 'registry_record' | 'canonical_read' | 'ledger_count' | 'coverage_state' | 'rule_output' | 'not_held';

/** One answer-first line: the same line the Terminal, the project page and the MCP print. */
export type HeySummaryLine = {
  dimension: HeySummaryDimension;
  label: string;
  tag: HeySummaryTag;
  text: string;
  /** Typed public evidence ids (`ship:`, `abi:`, `impl:`, …), each with its receipt on this API. */
  evidence: { id: string; label: string; url?: string; receiptUrl: string }[];
  /**
   * What the line rests on (additive, 2026-10-01), in the agent contract's
   * `evidenceKind` words: `evidence_record` (the ids above), or a basis no
   * evidence id family can cite — `market_reading`, `usage_reading`,
   * `registry_record`, `canonical_read`, `ledger_count`, `coverage_state` —
   * or `rule_output` (DERIVED) and `not_held` (UNKNOWN). A FACT with no
   * evidence always names one of the uncited bases.
   */
  basis: HeySummaryBasis;
  /** Where the detail behind the line is, on this API. */
  detailUrl: string;
  /** When HEY read what the line rests on; absent when it holds no reading. */
  observedAt?: string;
  freshness: HeySummaryFreshness;
  reason?: string;
  /** The human answer to the line's question; on the build line only (2026-10-01). */
  answer?: string;
  /** Why the newest counted building event matters as a build event, with the typed evidence id it is about (2026-10-01). */
  significance?: { text: string; about: string; receiptUrl: string };
};

/** The Project Research Summary: one line per dimension that applies. */
export type HeyResearchSummary = { version: string; lines: HeySummaryLine[]; computedAt: string };

/** `GET /api/projects/{slug}/snapshot`: one project's important state in one read. */
/**
 * Security context (2026-09-28): evidence, never a verdict. Each section is a
 * state — `MEASURED`, `NONE_FOUND` (a reading of the indexes in `readFrom`
 * only, never "none exists"), `NOT_READ`, `NOT_APPLICABLE` — and items exist
 * only where something was found. There is no score and no "safe": an audit
 * shows an audit took place; it is not a guarantee of safety. "No OSV
 * advisory" is a reading of OSV for the packages HEY reads, not a clean bill.
 */
export type HeySecurityFinding = {
  /** `official_site`, `official_site_sitemap`, `official_site_llms_txt` or `defillama`. */
  foundVia: string;
  foundOnUrl: string;
  firstObservedAt: string;
  lastObservedAt: string;
};
export type HeySecurityLinks<T> =
  | { state: 'MEASURED'; readFrom: string[]; items: T[] }
  | { state: 'NONE_FOUND'; readFrom: string[]; readAt: string }
  | { state: 'NOT_READ' | 'NOT_APPLICABLE'; reason: string };
export type HeySecurityAudit = {
  /** `security:<projectUuid>:audit:<16 hex>`, resolvable at `/api/evidence/{id}`. */
  id: string;
  url: string;
  /** `AUDITOR_PUBLISHED`: on the auditor's own host; `PROJECT_CLAIMED`: linked from the official site; `REGISTRY_LISTED`: DefiLlama's listing only. */
  authority: 'AUDITOR_PUBLISHED' | 'PROJECT_CLAIMED' | 'REGISTRY_LISTED';
  hostedOn: 'AUDITOR' | 'PROJECT_SITE' | 'GITHUB' | 'OTHER';
  auditor: { name: string; basis: 'AUDITOR_HOST' | 'URL_PATH' } | null;
  /** Always null: HEY links a report and never reads it. */
  date: null;
  isPdf: boolean;
  foundBy: HeySecurityFinding[];
  observedAt: string;
};
export type HeySecurityBounty = { id: string; url: string; authority: 'PLATFORM_LISTED' | 'PROJECT_CLAIMED'; platform: string | null; foundBy: HeySecurityFinding[]; observedAt: string };
export type HeySecurityContext = {
  audits: HeySecurityLinks<HeySecurityAudit>;
  bugBounty: HeySecurityLinks<HeySecurityBounty>;
  securityTxt:
    | { state: 'MEASURED'; id: string; url: string; contacts: string[] | null; policyUrls: string[]; expiresAt: string | null; expired: boolean; firstObservedAt: string; readAt: string }
    | { state: 'NONE_FOUND'; url: string; readAt: string; reason: string }
    | { state: 'NOT_READ' | 'NOT_APPLICABLE'; reason: string };
  advisories:
    | {
        state: 'MEASURED';
        packagesRead: number;
        readAt: string | null;
        stale: boolean;
        items: { advisoryId: string; aliases: string[]; ecosystem: string; packageName: string; version: string; fixedVersions: string[]; url: string; publishedAt: string | null; observedAt: string; subject: 'PUBLISHED_PACKAGE' }[];
      }
    | { state: 'NONE_FOUND'; packagesRead: number; readAt: string | null; stale: boolean }
    | { state: 'NOT_READ' | 'NOT_APPLICABLE'; reason: string };
  repositoryChecks:
    | { state: 'MEASURED'; repositories: { repo: string; url: string; date: string | null; readAt: string | null; checks: { name: string; score: number | null; documentationUrl: string | null }[] }[] }
    | { state: 'NONE_FOUND'; repositoriesRead: number; readAt: string | null }
    | { state: 'NOT_READ' | 'NOT_APPLICABLE'; reason: string };
  /** HEY reads no incident source yet: always NOT_READ, never "no incidents". */
  incidents: { state: 'NOT_READ'; reason: string };
  linksOmitted: number;
  meaning: string;
  contextOnly: true;
};

export type HeyProjectSnapshot = {
  /** The Project Research Summary (2026-09-28): the answer first; the sections below are its evidence. */
  summary: HeyResearchSummary;
  identity: {
    slug: string;
    name: string;
    symbol?: string;
    projectKind: string;
    researchLevel: string;
    catalogStatus: string;
    primaryNarrative?: { slug: string; name: string };
    token?: { chainId: number; contractAddress: string };
    /** `true` when this is `$HEY`, HEY's own token, researched by the same rules (2026-09-30, additive); absent otherwise. */
    heysOwnToken?: true;
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
    /** `HELD`, `NOT_HELD` or `NOT_MEASURED` (2026-09-30, additive), beside the unchanged boolean. */
    stillBuildingState: HeyStillBuildingState;
    /** Why Still Building was not measured (2026-09-30, additive), beside `stillBuilding: false`; absent when measured or on an older score. */
    stillBuildingWithheld?: HeyStillBuildingWithheld;
    stillBuildingEvidence?: { drawdownPercent: number; shipsSinceDecline?: number };
    discoveryGap?: number;
    /** Why `discoveryGap` is absent (2026-09-30, additive); absent beside a gap or on an older score. */
    discoveryGapWithheld?: HeyDiscoveryGapWithheld;
    velocity?: { state: string; current: number | null; previous: number | null; windowDays: number };
    cadence?: { state: string; medianIntervalDays?: number };
    hasBuilderSource?: boolean;
  };
  /** The card's market fields with the card's gates; absent for a project without a token. */
  market?: {
    marketCap?: NonNullable<HeyProject['marketCap']>;
    /**
     * Present when the valuation is withheld: the market's reason code when it is not live, or the
     * valuation gate's `valuation_over_liquidity` / `unlisted_over_ceiling` when the valuation is not
     * plausible from the readings HEY has (round 4, 2026-09-30). The list's `valuationWithheld`.
     */
    valuationWithheld?: string;
    liquidity?: NonNullable<HeyProject['liquidity']>;
    volume24h?: NonNullable<HeyProject['volume24h']>;
    priceChange24hPct?: number;
    venue?: string;
    tokenMarket?: NonNullable<HeyProject['tokenMarket']>;
    launchStage?: NonNullable<HeyProject['launchStage']>;
    /** Absent when HEY has observed no promotion or takeover for the token. */
    promotion?: HeyMarketPromotion;
    url: string;
  };
  /** Absent when the project is matched to no DefiLlama protocol (`coverage.protocolEconomics` says why). */
  protocolEconomics?: HeyProtocolEconomics;
  /** Absent only when HEY could not read the project's coverage. */
  developerFootprint?: HeyDeveloperFootprint;
  onchain?: { events24h?: number; events7d?: number; calls24h?: number; daysCovered: number; daysMeasured: number; observedAt: string };
  /**
   * Product usage over seven days (2026-09-28): its own dimension, never a
   * building or ranking input. The state says why figures are absent; the
   * field is absent only when the read failed.
   */
  usage?: HeyUsageSummary;
  /** Security context (2026-09-28): evidence, never a verdict; absent only when the read failed. */
  security?: HeySecurityContext;
  /** Peer context (2026-09-28, `peers-v1`): each figure among comparable projects, one dimension at a time; never one score. Absent only when the read failed. */
  peerContext?: HeyPeerContext;
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
  links: { page: string; detail: string; market?: string; timeline: string; intelligence: string; changes: string; coverage: string; explain: string; contracts: string; usage: string; relationships: string };
  asOf: string;
  scoringVersion?: string;
  disclaimer: string;
};
