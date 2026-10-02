import { z } from 'zod';

import { AGENT_CAPABILITIES } from './capabilities';
import { HEY_OWN_TOKEN_DISCLOSURE_CODE, STILL_BUILDING_STATES } from './disclosures';
import { AGENT_EVIDENCE_KINDS } from './evidence-kinds';
import { AGENT_DATA_FAMILIES, AGENT_FRESHNESS_STATUSES } from './freshness';
import { AGENT_UNKNOWN_CATEGORIES } from './unknowns';

/**
 * AgentIntelligenceResponse v1 (2026-09-30, Robinhood Agent Apps readiness
 * §3): one transport-neutral answer for each of HEY's six agent
 * capabilities.
 *
 * It is not a second truth. Every value in it is restated from a canonical
 * public API object — the snapshot and its Research Summary, the explain
 * engine, the change ledger, project coverage, peer context, the token and
 * contract reads — by the pure composers in `./compose`; REST, MCP and A2A
 * (and, when Robinhood publishes a provider specification, a Robinhood
 * adapter) only move it.
 *
 * The rules the shape carries:
 * - **Answer first.** `answer` is one sentence; `claims` are its evidence.
 * - **FACT / DERIVED / UNKNOWN** on every claim, never stronger than the
 *   explain engine gives the same fact.
 * - **Provenance.** A claim names its source and source type, when HEY read
 *   it (`observedAt`), when the source dates it (`occurredAt`) at which
 *   `precision`, its freshness, and typed evidence ids with receipt URLs.
 * - **Unknown stays unknown.** A value HEY does not hold is null with a
 *   reason, or an entry in `unknowns` — never 0, false or an empty list
 *   standing in for "not measured".
 * - **Machine-safe text.** Every human-language field is an `AgentText` that
 *   says whose words it holds (`./text.ts`).
 * - **Bounded.** Lists have hard maxima; text has a length bound.
 * - **No trading output.** No buy, sell, size, leverage, stop, target or
 *   ranking by return, anywhere; `boundaries` says so in machine form.
 *
 * Additive only: a field here never changes meaning. A semantic change is a
 * `schemaVersion: "2"` served beside this one with overlap (machine-layer
 * rule 10).
 */
export const AGENT_SCHEMA = 'hey.agent-intelligence-response' as const;
export const AGENT_SCHEMA_VERSION = '1' as const;

/** Hard maxima, so an answer's size is bounded whatever the record holds. */
export const AGENT_LIMITS = {
  claims: 60,
  unknowns: 40,
  evidence: 100,
  evidencePerClaim: 12,
  changes: 50,
  changesDefault: 25,
  freshness: 12,
  compareProjects: 4,
  lineage: 8,
  inputs: 24,
  excludedContext: 12,
  reasons: 8,
  maxResponseBytes: 64 * 1024,
} as const;

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/, 'an ISO 8601 instant');
const url = z.string().regex(/^https?:\/\/\S{1,600}$/, 'an absolute URL');
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);
const address = z.string().regex(/^0x[0-9a-f]{40}$/, 'a lower-case 0x address');
const code = z.string().regex(/^[A-Za-z0-9_.:\-/]{1,120}$/, 'a machine code');

export const agentTextSchema = z
  .object({
    text: z.string().max(620),
    contentOrigin: z.enum(['hey', 'derived', 'external_source']),
    source: code.optional(),
    sourceUrl: url.optional(),
    truncated: z.literal(true).optional(),
    instructionLike: z.literal(true).optional(),
  })
  .strict();

export const agentEvidenceRefSchema = z
  .object({
    /** A typed evidence id (`ship:`, `signal:`, `state:` …) that resolves at `receiptUrl`. */
    id: z.string().min(3).max(240),
    receiptUrl: url,
    /** The record's own public source, when it has one: data, never fetched by HEY on read. */
    sourceUrl: url.optional(),
  })
  .strict();

export const agentClaimStatusSchema = z.enum(['FACT', 'DERIVED', 'UNKNOWN']);
export const agentPrecisionSchema = z.enum(['EXACT', 'DATE', 'WEEK', 'WINDOW', 'OBSERVED', 'SCHEDULED']);
export const agentFreshnessStatusSchema = z.enum(AGENT_FRESHNESS_STATUSES);
export const agentSourceTypeSchema = z.enum(['hey_rule', 'hey_record', 'builder_source', 'chain', 'market_provider', 'registry', 'project_site']);

export const agentClaimSchema = z
  .object({
    /** Stable within a capability: `build.activity_status`, `change:<event id>`, `summary.market` … */
    id: z.string().min(1).max(260),
    dimension: code,
    statement: agentTextSchema,
    status: agentClaimStatusSchema,
    /** The machine value behind the statement (a status, a count, a date); null when HEY does not hold it. */
    value: z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
    source: z.object({ name: z.string().max(120), type: agentSourceTypeSchema }).strict().nullable(),
    /** When HEY read what the claim rests on. */
    observedAt: iso.nullable(),
    /** When the source dates the thing itself; null when only HEY's observation dates it. */
    occurredAt: iso.nullable(),
    precision: agentPrecisionSchema.nullable(),
    freshness: agentFreshnessStatusSchema,
    evidence: z.array(agentEvidenceRefSchema).max(AGENT_LIMITS.evidencePerClaim),
    /** Where "why does HEY say this?" is answered for this claim. */
    explainUrl: url.optional(),
    /** A machine code for an UNKNOWN or withheld claim. */
    reason: code.optional(),
    /** Market or usage context: never a builder judgement, never an input to one. */
    contextOnly: z.literal(true).optional(),
    /**
     * What the claim rests on (2026-09-30, round 4, additive): a published
     * record (`evidence_record`, with typed ids), a rule's output, a ledger
     * count, a coverage state, a market or usage reading, HEY's own registry,
     * one canonical read, or nothing held. Present on every claim HEY
     * composes; a claim with no evidence id says here what it is instead.
     */
    evidenceKind: z.enum(AGENT_EVIDENCE_KINDS).optional(),
  })
  .strict();

export const agentUnknownSchema = z
  .object({
    category: z.enum(AGENT_UNKNOWN_CATEGORIES),
    /** A coverage dimension (`repositories`, `marketHistory` …) or an identity check (`tokenOwnership`, `repositoryOwnership` …). */
    dimension: code,
    statement: agentTextSchema,
    /** What an agent must not conclude from this gap. */
    doNotConclude: agentTextSchema,
    /** The coverage state behind the category, when one is. */
    coverageState: code.optional(),
    reason: code,
    asOf: iso.optional(),
    detailUrl: url.optional(),
  })
  .strict();

export const agentFreshnessSchema = z
  .object({
    family: z.enum(AGENT_DATA_FAMILIES),
    /** When HEY last read the source behind this family for this subject; null when never. */
    observedAt: iso.nullable(),
    /** The moment the data describes (a scoring run, the ledger's newest arrival); null when HEY holds no reading. */
    dataAsOf: iso.nullable(),
    freshnessStatus: agentFreshnessStatusSchema,
    /** The family's own staleness limit: past it, `freshnessStatus` is `stale` whatever the age bucket. */
    staleAfterHours: z.number().int().positive(),
    /** The production schedule that refreshes it. */
    refresh: z
      .object({
        job: code,
        /** The fastest refresh the schedule allows for this subject, in minutes. */
        everyMinutes: z.number().int().positive(),
        /** The slowest: equal to `everyMinutes` unless the schedule is tiered (HOT/WARM/COOL/COLD). */
        slowestMinutes: z.number().int().positive(),
        basis: agentTextSchema,
      })
      .strict(),
    /** observedAt + the fastest cadence, when that is still ahead; null otherwise, with the reason. */
    nextExpectedRefresh: iso.nullable(),
    nextExpectedRefreshReason: z.enum(['overdue', 'variable_cadence', 'never_read']).optional(),
  })
  .strict();

const change = z
  .object({
    id: z.string().max(260),
    revision: z.number().int().min(1),
    type: code,
    domain: code,
    occurredAt: iso.nullable(),
    precision: agentPrecisionSchema,
    detectedAt: iso,
    recordedAt: iso,
    summary: agentTextSchema,
    status: agentClaimStatusSchema,
    countsAsBuilding: z.boolean(),
    /**
     * A ship's verification state as HEY records it (2026-09-30, additive):
     * `SELF_REPORTED` (the project told HEY), `SOURCE_LINKED`,
     * `PUBLICLY_VERIFIED`, `ADMIN_VERIFIED`, `DISPUTED`. Self-reported and
     * verified stay visibly distinct (product rule 10). Absent on other events.
     */
    verification: code.optional(),
    project: z.object({ slug, url }).strict(),
    evidence: z.array(agentEvidenceRefSchema).max(AGENT_LIMITS.evidencePerClaim),
    source: z.string().max(120),
  })
  .strict();
export const agentChangeSchema = change;

const subjectProject = z.object({ slug, name: agentTextSchema, url, token: z.object({ chainId: z.number().int(), address }).strict().optional() }).strict();

const researchData = z
  .object({
    identity: z
      .object({
        slug,
        name: agentTextSchema,
        symbol: agentTextSchema.nullable(),
        projectKind: code,
        researchLevel: code,
        catalogStatus: code,
        narrative: z.object({ slug: code, name: agentTextSchema }).strict().nullable(),
        firstRecordedByHeyAt: iso,
        websiteUrl: url.nullable(),
        url,
      })
      .strict(),
    builderState: z
      .object({
        activityStatus: code,
        activityMeasured: z.boolean().nullable(),
        lastMeaningfulShipAt: iso.nullable(),
        meaningfulEvents30d: z.number().int().min(0).nullable(),
        buildMomentum: z.number().nullable(),
        buildMomentumReason: code.optional(),
        stillBuilding: z.boolean(),
        /** Why Still Building was not measured (2026-09-30, additive): beside `stillBuilding: false`, as the API sends it. */
        stillBuildingWithheld: code.optional(),
        /** Round 4 (2026-09-30, additive): HELD, NOT_HELD (measured, not met) or NOT_MEASURED — what `stillBuilding: false` cannot say. */
        stillBuildingState: z.enum(STILL_BUILDING_STATES).optional(),
        scoringVersion: code.nullable(),
        explainUrl: url,
      })
      .strict(),
    latestMeaningfulChange: change.nullable(),
    /**
     * Why `latestMeaningfulChange` is null (ux-data audit, 2026-10-01, additive):
     * `not_in_recent_changes` — HEY holds meaningful building, but none of it is
     * among the newest changes this answer lists, so null is "not listed here",
     * never "none"; `none_recorded` — HEY records no meaningful building;
     * `changes_unavailable` — the ledger could not be read.
     */
    latestMeaningfulChangeReason: z.enum(['not_in_recent_changes', 'none_recorded', 'changes_unavailable']).optional(),
    recentChanges: z
      .object({ available: z.boolean(), reason: code.optional(), items: z.array(change).max(AGENT_LIMITS.changes), url })
      .strict(),
    contractIdentity: z
      .object({
        token: z.object({ chainId: z.number().int(), address, verification: code.nullable(), verificationReason: code.nullable() }).strict().nullable(),
        ownerVerified: z.boolean(),
        contractsUrl: url,
      })
      .strict(),
    marketContext: z
      .object({
        contextOnly: z.literal(true),
        valuation: z.object({ usd: z.number(), kind: z.enum(['marketCap', 'fdv', 'unspecified']), source: z.string().max(80), observedAt: iso.nullable() }).strict().nullable(),
        valuationWithheld: code.nullable(),
        liquidityUsd: z.number().nullable(),
        /** The API's qualifier on the liquidity figure (2026-09-30, additive): `launch_inventory` is a launch pool's supply, not a market's depth. */
        liquidityKind: code.optional(),
        volume24hUsd: z.number().nullable(),
        tokenMarketStatus: code.nullable(),
        url,
      })
      .strict()
      .nullable(),
    usageContext: z
      .object({
        contextOnly: z.literal(true),
        state: code,
        reason: code,
        windowDays: z.number().int().nullable(),
        calls: z.number().int().min(0).nullable(),
        activeContracts: z.number().int().min(0).nullable(),
        watchedContracts: z.number().int().min(0),
        observedAt: iso.nullable(),
        url,
      })
      .strict()
      .nullable(),
  })
  .strict();

const whatChangedData = z
  .object({
    scope: z.enum(['project', 'chain']),
    window: z.object({ days: z.number().int().min(1).max(30), from: iso, to: iso, basis: z.literal('occurred_else_detected') }).strict(),
    types: z.array(code).max(40).nullable(),
    /** Every standing event in the window, counted by the same filter the page reads: a true total, never the page size. */
    total: z.number().int().min(0),
    /**
     * How many of `total` count toward activity status, by the ledger's own
     * `countsAsBuilding` flag (2026-09-30, additive): the rest are context —
     * market readings, HEY's own records. Equal to `total` under `building=only`.
     */
    countsAsBuilding: z.number().int().min(0).optional(),
    byType: z.array(z.object({ type: code, count: z.number().int().min(0) }).strict()).max(40),
    shown: z.number().int().min(0),
    items: z.array(change).max(AGENT_LIMITS.changes),
    /** `transitionsFrom` (2026-09-30, additive): when the ledger began recording status moves and reclassifications; none earlier exist. */
    ledger: z.object({ projectorRanAt: iso.nullable(), newestRecordedAt: iso.nullable(), collectionStart: iso.nullable(), transitionsFrom: iso.nullable().optional() }).strict(),
    /** How to read further: the canonical ledger, which pages with a cursor. */
    more: url,
  })
  .strict();

const excluded = z.object({ item: code, statement: agentTextSchema }).strict();

const builderStatusData = z
  .object({
    status: code,
    statusMeaning: agentTextSchema,
    state: agentClaimStatusSchema,
    methodology: z.object({ ruleId: code, version: code, rule: agentTextSchema }).strict(),
    inputs: z.array(z.object({ name: code, value: z.union([z.string().max(200), z.number(), z.boolean(), z.null(), z.array(z.union([z.string().max(200), z.number()])).max(50)]), source: z.string().max(120).nullable(), observedAt: iso.nullable() }).strict()).max(AGENT_LIMITS.inputs),
    lineage: z.array(z.object({ step: z.enum(['source', 'sanitation', 'selection', 'derivation', 'public']), text: agentTextSchema }).strict()).max(AGENT_LIMITS.lineage),
    supportingEvidence: z.array(agentEvidenceRefSchema).max(AGENT_LIMITS.evidence),
    excludedContext: z.array(excluded).max(AGENT_LIMITS.excludedContext),
    unknownInputs: z.array(code).max(20),
    statusRestsOnCurrentEvidence: z.boolean().nullable(),
    buildMomentum: z.object({ value: z.number().nullable(), state: agentClaimStatusSchema, classification: code, explainUrl: url }).strict(),
    stillBuilding: z
      .object({
        value: z.boolean().nullable(),
        state: agentClaimStatusSchema,
        classification: code,
        /** Round 4 (2026-09-30, additive): HELD, NOT_HELD or NOT_MEASURED. */
        stillBuildingState: z.enum(STILL_BUILDING_STATES).optional(),
        meaning: agentTextSchema,
        explainUrl: url,
      })
      .strict(),
    reason: agentTextSchema,
  })
  .strict();

const verifyData = z
  .object({
    chainId: z.number().int(),
    address,
    verdict: z.enum(['VERIFIED', 'UNVERIFIED', 'CONTRACT_MISMATCH', 'UNKNOWN']),
    reasonCode: code,
    reasons: z.array(agentTextSchema).min(1).max(AGENT_LIMITS.reasons),
    /** The published project HEY records this contract under; null when none, or when several claim it equally. */
    recordedProject: z.object({ slug, url, role: z.enum(['token', 'declared', 'followup']).nullable() }).strict().nullable(),
    /** The project the caller asked about, when it named one. */
    askedProject: z.object({ slug, found: z.boolean(), url: url.nullable() }).strict().nullable(),
    tokenVerification: z.object({ status: z.enum(['VERIFIED', 'UNVERIFIED', 'MISMATCH']), reason: code.nullable() }).strict().nullable(),
    /** Whether the project's building activity may be read as this contract's; null when HEY holds no project for it. */
    activityAppliesToContract: z.boolean().nullable(),
    contractUrl: url,
    scanUrl: url,
  })
  .strict();

const compareProject = z
  .object({
    slug,
    name: agentTextSchema,
    url,
    activityStatus: code,
    lastMeaningfulShipAt: iso.nullable(),
    meaningfulEvents30d: z.number().int().min(0).nullable(),
    meaningfulEventsPrevious30d: z.number().int().min(0).nullable(),
    velocityState: code.nullable(),
    releaseCadence: z.object({ state: code, medianIntervalDays: z.number().nullable() }).strict().nullable(),
    activeWeeks: z.object({ weeks: z.number().int().min(0).nullable(), windowWeeks: z.number().int().min(1) }).strict().nullable(),
    buildMomentum: z.number().nullable(),
    /**
     * The Build Momentum component the project page prints as "CONSISTENCY" (additive, 2026-10-02):
     * 0–100 as printed, with the weeks of Build Momentum's six-week window it counts. Null when
     * Build Momentum is not measured. `activeWeeks` above is the twelve-week intelligence window.
     */
    buildMomentumConsistency: z
      .object({ score: z.number().min(0).max(100), activeWeeks: z.number().int().min(0).nullable(), windowWeeks: z.number().int().min(1).nullable() })
      .strict()
      .nullable()
      .optional(),
    /** The category every HEY card prints (additive, 2026-10-02): "Infrastructure", "AI Agents · Utility", or "Uncategorised". */
    category: agentTextSchema.nullable().optional(),
    verifiedBuilder: z.boolean(),
    sources: z.object({ verified: z.number().int().min(0), total: z.number().int().min(0) }).strict(),
    peer: z.object({ rulesVersion: code, state: code, cohort: code.nullable(), reason: code.nullable() }).strict().nullable(),
    explainUrl: url,
  })
  .strict();

const compareData = z
  .object({
    windowDays: z.literal(30),
    projects: z.array(compareProject).max(AGENT_LIMITS.compareProjects),
    missing: z.array(z.string().max(120)).max(8),
    /**
     * Whether a comparison happened (2026-09-30, additive): `complete` — every
     * project asked for is compared; `partial` — two or more are, and `missing`
     * names the rest; `not_compared` — fewer than two were found, and the
     * answer is `status: not_found` with `error.code: too_few_projects_found`.
     */
    completeness: z.enum(['complete', 'partial', 'not_compared']).optional(),
    ignored: z.array(z.string().max(120)).max(8),
    /** Whether every project sits in one peer cohort (peers-v1); null when a cohort is unknown. Different cohorts are shown side by side, never placed against each other. */
    sameCohort: z.boolean().nullable(),
    order: z.literal('as_requested'),
    method: agentTextSchema,
    excludedContext: z.array(excluded).max(AGENT_LIMITS.excludedContext),
  })
  .strict();

const unknownsData = z
  .object({
    counts: z.object(Object.fromEntries(AGENT_UNKNOWN_CATEGORIES.map((category) => [category, z.number().int().min(0)])) as Record<(typeof AGENT_UNKNOWN_CATEGORIES)[number], z.ZodNumber>).strict(),
    /** Coverage dimensions HEY measured: figures there are measurements, zeros included. */
    measured: z.array(code).max(40),
    notApplicable: z.array(code).max(40),
    /** Measured and deliberately not published on this surface. */
    withheld: z.array(code).max(40),
    coverageUrl: url.nullable(),
  })
  .strict();

const methodology = z
  .object({
    rules: z.array(z.object({ id: code, version: code }).strict()).max(12),
    url,
  })
  .strict();

const boundaries = z
  .object({
    notAdvice: z.literal(true),
    /** What HEY never returns, as machine codes. */
    notProvided: z.array(code).max(20),
    marketIsContextOnly: z.literal(true),
    disclaimer: agentTextSchema,
  })
  .strict();

/** A reference an agent can put in an AgentResearchReceipt's `evidence` (kind `hey_agent_answer`, additive in receipt v1). */
const citation = z
  .object({
    kind: z.literal('hey_agent_answer'),
    capability: z.enum(AGENT_CAPABILITIES),
    schemaVersion: z.literal(AGENT_SCHEMA_VERSION),
    url,
    asOf: iso,
    project: slug.optional(),
    scoringVersion: code.optional(),
  })
  .strict();

const errorSchema = z.object({ code, message: agentTextSchema, movedTo: slug.optional() }).strict();

/**
 * A disclosure about the answer's own subject (2026-09-30, round 4,
 * additive): `hey_own_token` when `$HEY`'s project is in the answer. It
 * changes no figure, order or tag: HEY researches its own project by the
 * same rules as any other.
 */
export const agentDisclosureSchema = z
  .object({
    code: z.enum([HEY_OWN_TOKEN_DISCLOSURE_CODE]),
    statement: agentTextSchema,
    projects: z.array(slug).max(8),
  })
  .strict();

const base = {
  schema: z.literal(AGENT_SCHEMA),
  schemaVersion: z.literal(AGENT_SCHEMA_VERSION),
  status: z.enum(['ok', 'not_found', 'moved', 'invalid_request', 'unavailable']),
  query: z
    .object({
      chainId: z.number().int(),
      project: z.string().max(120).optional(),
      projects: z.array(z.string().max(120)).max(8).optional(),
      address: z.string().max(60).optional(),
      days: z.number().int().optional(),
      types: z.array(code).max(40).optional(),
      limit: z.number().int().optional(),
      building: z.literal('only').optional(),
    })
    .strict(),
  chain: z.object({ chainId: z.number().int(), name: z.string().max(60) }).strict(),
  subject: z
    .object({
      kind: z.enum(['project', 'contract', 'projects', 'chain']),
      project: subjectProject.optional(),
      projects: z.array(subjectProject).max(AGENT_LIMITS.compareProjects).optional(),
      contract: z.object({ chainId: z.number().int(), address }).strict().optional(),
    })
    .strict()
    .nullable(),
  /** The one-sentence answer, first (answer-first rule). */
  answer: agentTextSchema,
  answerStatus: agentClaimStatusSchema,
  claims: z.array(agentClaimSchema).max(AGENT_LIMITS.claims),
  unknowns: z.array(agentUnknownSchema).max(AGENT_LIMITS.unknowns),
  freshness: z.array(agentFreshnessSchema).max(AGENT_LIMITS.freshness),
  /** Every evidence id the answer cites, once each. */
  evidence: z.array(agentEvidenceRefSchema).max(AGENT_LIMITS.evidence),
  methodology,
  links: z.object({ self: url, page: url.optional(), canonical: z.array(url).max(12) }).strict(),
  citation: citation.nullable(),
  boundaries,
  error: errorSchema.optional(),
  /** Round 4 (2026-09-30, additive): present only when a disclosure applies. */
  disclosures: z.array(agentDisclosureSchema).max(4).optional(),
  asOf: iso,
};

const variant = <C extends (typeof AGENT_CAPABILITIES)[number], D extends z.ZodTypeAny>(capability: C, data: D) =>
  z.object({ ...base, capability: z.literal(capability), data: data.nullable() }).strict();

export const agentIntelligenceResponseSchema = z.discriminatedUnion('capability', [
  variant('research_project', researchData),
  variant('what_changed', whatChangedData),
  variant('builder_status', builderStatusData),
  variant('verify_project', verifyData),
  variant('compare_builders', compareData),
  variant('unknowns', unknownsData),
]);

export type AgentEvidenceRef = z.infer<typeof agentEvidenceRefSchema>;
export type AgentDisclosure = z.infer<typeof agentDisclosureSchema>;
export type AgentClaimStatus = z.infer<typeof agentClaimStatusSchema>;
export type AgentPrecision = z.infer<typeof agentPrecisionSchema>;
export type AgentSourceType = z.infer<typeof agentSourceTypeSchema>;
export type AgentClaim = z.infer<typeof agentClaimSchema>;
export type AgentUnknown = z.infer<typeof agentUnknownSchema>;
export type AgentFreshness = z.infer<typeof agentFreshnessSchema>;
export type AgentChange = z.infer<typeof agentChangeSchema>;
export type AgentResearchData = z.infer<typeof researchData>;
export type AgentWhatChangedData = z.infer<typeof whatChangedData>;
export type AgentBuilderStatusData = z.infer<typeof builderStatusData>;
export type AgentVerifyData = z.infer<typeof verifyData>;
export type AgentCompareData = z.infer<typeof compareData>;
export type AgentCompareProject = z.infer<typeof compareProject>;
export type AgentCompareCompleteness = NonNullable<AgentCompareData['completeness']>;
export type AgentUnknownsData = z.infer<typeof unknownsData>;
export type AgentCitation = z.infer<typeof citation>;
export type AgentBoundaries = z.infer<typeof boundaries>;
export type AgentMethodology = z.infer<typeof methodology>;
export type AgentSubject = z.infer<typeof base.subject>;
export type AgentQuery = z.infer<typeof base.query>;
export type AgentResponseStatus = z.infer<typeof base.status>;
export type AgentIntelligenceResponse = z.infer<typeof agentIntelligenceResponseSchema>;
export type AgentResponseOf<C extends AgentIntelligenceResponse['capability']> = Extract<AgentIntelligenceResponse, { capability: C }>;
