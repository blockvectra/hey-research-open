import type { HeyChangeUpsert } from '@hey-research-lab/sdk';

import type { AgentCapability } from '../capabilities';
import { MACHINE_TEXT_VERSION, derivedText, externalText, heyText, isSafeUrl, type AgentText } from '../text';
import { AGENT_FRESHNESS_VERSION } from '../freshness';
import { recordTag, summaryIsSourceText } from '../records';
import {
  AGENT_LIMITS,
  AGENT_SCHEMA,
  AGENT_SCHEMA_VERSION,
  type AgentBoundaries,
  type AgentChange,
  type AgentClaim,
  type AgentEvidenceRef,
  type AgentFreshness,
  type AgentIntelligenceResponse,
  type AgentPrecision,
  type AgentQuery,
  type AgentResponseOf,
  type AgentResponseStatus,
  type AgentSourceType,
  type AgentSubject,
  type AgentUnknown,
} from '../schema';

/**
 * What every composer needs and nothing it could compute a second way
 * (2026-09-30): where HEY answers, which chain, when, and the canonical
 * disclaimer. `selfUrl` is the REST URL of this very answer.
 */
export type AgentComposeContext = {
  baseUrl: string;
  chainId: number;
  chainName: string;
  now: Date;
  /** The public API's own disclaimer (`API_DISCLAIMER`), restated, never reworded. */
  disclaimer: string;
  selfUrl: string;
  query: AgentQuery;
};

/** What HEY never returns, as machine codes (readiness §26): research only, never a trade. */
export const AGENT_NOT_PROVIDED = [
  'investment_recommendation',
  'buy_or_sell_signal',
  'price_prediction',
  'price_target',
  'position_size',
  'leverage',
  'stop_loss',
  'ranking_by_expected_return',
  'risk_score',
  'safety_verdict',
  'smart_money_label',
  'wallet_pnl',
  'wallet_profile',
] as const;

export function boundaries(ctx: AgentComposeContext): AgentBoundaries {
  return { notAdvice: true, notProvided: [...AGENT_NOT_PROVIDED], marketIsContextOnly: true, disclaimer: heyText(ctx.disclaimer) };
}

export const receiptUrl = (baseUrl: string, id: string): string => `${baseUrl}/api/evidence/${encodeURIComponent(id)}`;

/** A typed evidence id with its receipt URL. `sourceUrl` is the record's own public URL, carried as data. */
export function evidenceRef(baseUrl: string, id: string, sourceUrl?: string): AgentEvidenceRef {
  const absolute = sourceUrl && sourceUrl.startsWith('/') ? `${baseUrl}${sourceUrl}` : sourceUrl;
  return { id, receiptUrl: receiptUrl(baseUrl, id), ...(isSafeUrl(absolute, 600) ? { sourceUrl: absolute } : {}) };
}

/** Evidence refs from a change event's evidence list: typed ids only, once each, bounded. */
export function changeEvidence(baseUrl: string, evidence: readonly { id: string; url?: string }[], isEvidenceId: (id: string) => boolean): AgentEvidenceRef[] {
  const seen = new Set<string>();
  const out: AgentEvidenceRef[] = [];
  for (const entry of evidence) {
    if (!isEvidenceId(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(evidenceRef(baseUrl, entry.id, entry.url));
    if (out.length >= AGENT_LIMITS.evidencePerClaim) break;
  }
  return out;
}

/**
 * A typed evidence id, by shape (`family:rest`), for the families HEY resolves
 * at `/api/evidence/{id}`. An event id with a suffix (`source:<uuid>:added`)
 * is not one: the resolver refuses it, so it is never offered as evidence.
 * The web app passes the domain's own parser; this is the fallback shape
 * check for a pure caller.
 */
const EVIDENCE_FAMILIES = new Set(['ship', 'signal', 'abi', 'impl', 'lock', 'source', 'claim', 'state', 'integrity', 'narrative', 'method', 'sourcechange', 'security']);
export function looksLikeEvidenceId(id: string): boolean {
  const family = id.split(':')[0] ?? '';
  return EVIDENCE_FAMILIES.has(family) && /^[a-z]+:[A-Za-z0-9:._-]{1,220}$/.test(id) && !/:(added|removed|restored|unavailable|changed)$/.test(id);
}

/** The fields of a ledger event the contract reads: `/api/changes`'s upsert and the snapshot's latest changes both carry them. */
export type ChangeLike = Pick<HeyChangeUpsert, 'id' | 'revision' | 'occurredAt' | 'detectedAt' | 'recordedAt' | 'summary' | 'evidence' | 'source'> & {
  type: string;
  domain: string;
  precision: string;
  countsAsBuilding?: true;
  /** The ledger's plain facts beside the summary; a ship's `verification` is read from them. */
  facts?: Record<string, string | number | boolean>;
};

/** One ledger event as the agent contract carries it: its summary typed by whose words it holds, its tag by the record rule. */
export function agentChange(event: ChangeLike, project: { slug: string; url: string }, baseUrl: string, isEvidenceId: (id: string) => boolean = looksLikeEvidenceId): AgentChange {
  const firstUrl = event.evidence.find((entry) => entry.url)?.url;
  const summary: AgentText = summaryIsSourceText(event.id, event.type) ? externalText(event.summary, 'source_title', firstUrl) : derivedText(event.summary);
  // A ship's verification state (2026-09-30, product rule 10): self-reported and verified stay visibly distinct.
  const verification = typeof event.facts?.verification === 'string' && /^[A-Z_]{1,40}$/.test(event.facts.verification) ? event.facts.verification : undefined;
  return {
    id: event.id,
    revision: event.revision,
    type: event.type,
    domain: event.domain,
    occurredAt: event.occurredAt,
    precision: event.precision as AgentPrecision,
    detectedAt: event.detectedAt,
    recordedAt: event.recordedAt,
    summary,
    status: recordTag(event.id),
    countsAsBuilding: event.countsAsBuilding === true,
    ...(verification ? { verification } : {}),
    project: { slug: project.slug, url: project.url },
    evidence: changeEvidence(baseUrl, event.evidence, isEvidenceId),
    source: event.source.slice(0, 120),
  };
}

/** Change domains and types whose events are context, never building (2026-09-30): market readings, market integrity, product usage. */
const CONTEXT_DOMAINS: ReadonlySet<string> = new Set(['market', 'market_integrity']);
const CONTEXT_TYPES: ReadonlySet<string> = new Set(['contract.usage_changed', 'contract.method_first_observed', 'contract.method_resumed']);
export const isContextChange = (change: { domain: string; type: string }): boolean => CONTEXT_DOMAINS.has(change.domain) || CONTEXT_TYPES.has(change.type);

/** The source type a ledger domain's record comes from. */
export function sourceTypeOfDomain(domain: string, id: string): AgentSourceType {
  if (recordTag(id) === 'DERIVED') return 'hey_rule';
  switch (domain) {
    case 'build':
      return 'builder_source';
    case 'contract':
    case 'token':
    case 'lock':
      return 'chain';
    case 'market':
      return 'market_provider';
    default:
      return 'hey_record';
  }
}

/** Every evidence id the answer cites, once each, in first-seen order, bounded. */
export function collectEvidence(groups: readonly (readonly AgentEvidenceRef[])[]): AgentEvidenceRef[] {
  const seen = new Set<string>();
  const out: AgentEvidenceRef[] = [];
  for (const group of groups) {
    for (const ref of group) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      out.push(ref);
      if (out.length >= AGENT_LIMITS.evidence) return out;
    }
  }
  return out;
}

export type EnvelopeParts<C extends AgentCapability> = {
  capability: C;
  status: AgentResponseStatus;
  subject: AgentSubject;
  answer: AgentText;
  answerStatus: AgentClaim['status'];
  claims?: AgentClaim[];
  unknowns?: AgentUnknown[];
  freshness?: AgentFreshness[];
  data: AgentResponseOf<C>['data'];
  /** Evidence refs carried in `data` (changes, supporting evidence) as well as the claims'. */
  dataEvidence?: readonly AgentEvidenceRef[];
  rules?: { id: string; version: string }[];
  page?: string;
  canonical?: string[];
  citationProject?: string;
  scoringVersion?: string | null;
  error?: AgentIntelligenceResponse['error'];
};

/** The whole answer around one capability's parts: boundaries, methodology, links, the receipt citation, bounds applied. */
export function envelope<C extends AgentCapability>(ctx: AgentComposeContext, parts: EnvelopeParts<C>): AgentResponseOf<C> {
  const claims = (parts.claims ?? []).slice(0, AGENT_LIMITS.claims);
  const unknowns = (parts.unknowns ?? []).slice(0, AGENT_LIMITS.unknowns);
  const asOf = ctx.now.toISOString();
  const response = {
    schema: AGENT_SCHEMA,
    schemaVersion: AGENT_SCHEMA_VERSION,
    capability: parts.capability,
    status: parts.status,
    query: ctx.query,
    chain: { chainId: ctx.chainId, name: ctx.chainName },
    subject: parts.subject,
    answer: parts.answer,
    answerStatus: parts.answerStatus,
    claims,
    unknowns,
    freshness: (parts.freshness ?? []).slice(0, AGENT_LIMITS.freshness),
    evidence: collectEvidence([...claims.map((claim) => claim.evidence), parts.dataEvidence ?? []]),
    data: parts.data,
    methodology: {
      rules: [...(parts.rules ?? []), { id: 'agent_freshness', version: AGENT_FRESHNESS_VERSION }, { id: 'machine_text', version: MACHINE_TEXT_VERSION }].slice(0, 12),
      url: `${ctx.baseUrl}/methodology`,
    },
    links: { self: ctx.selfUrl, ...(parts.page ? { page: parts.page } : {}), canonical: (parts.canonical ?? []).slice(0, 12) },
    citation:
      parts.status === 'ok'
        ? {
            kind: 'hey_agent_answer' as const,
            capability: parts.capability,
            schemaVersion: AGENT_SCHEMA_VERSION,
            url: ctx.selfUrl,
            asOf,
            ...(parts.citationProject ? { project: parts.citationProject } : {}),
            ...(parts.scoringVersion ? { scoringVersion: parts.scoringVersion } : {}),
          }
        : null,
    boundaries: boundaries(ctx),
    ...(parts.error ? { error: parts.error } : {}),
    asOf,
  };
  return response as unknown as AgentResponseOf<C>;
}

/** An answer that could not be given: not found, moved, invalid or switched off. No claim, no citation. */
export function refusal<C extends AgentCapability>(
  ctx: AgentComposeContext,
  capability: C,
  status: Exclude<AgentResponseStatus, 'ok'>,
  code: string,
  message: string,
  movedTo?: string,
): AgentResponseOf<C> {
  return envelope(ctx, {
    capability,
    status,
    subject: null,
    answer: derivedText(message),
    answerStatus: 'UNKNOWN',
    data: null as AgentResponseOf<C>['data'],
    error: { code, message: derivedText(message), ...(movedTo ? { movedTo } : {}) },
  });
}

/** The slug-only URL of a project's API resource. */
export const projectApi = (ctx: AgentComposeContext, slug: string, path = ''): string => `${ctx.baseUrl}/api/projects/${slug}${path}`;
export const projectPage = (ctx: AgentComposeContext, slug: string): string => `${ctx.baseUrl}/project/${slug}`;
