import type { HeyChangeUpsert } from '@hey-research-lab/sdk';

import type { AgentCapability } from '../capabilities';
import { MACHINE_TEXT_VERSION, derivedText, externalText, heyText, isSafeUrl, type AgentText } from '../text';
import { AGENT_FRESHNESS_VERSION } from '../freshness';
import { HEY_OWN_TOKEN_DISCLOSURE, HEY_OWN_TOKEN_DISCLOSURE_CODE, type OwnProject } from '../disclosures';
import type { AgentEvidenceKind } from '../evidence-kinds';
import { recordTag, summaryIsSourceText } from '../records';
import {
  AGENT_LIMITS,
  AGENT_SCHEMA,
  AGENT_SCHEMA_VERSION,
  type AgentBoundaries,
  type AgentCandidate,
  type AgentChange,
  type AgentClaim,
  type AgentDisclosure,
  type AgentEvidenceRef,
  type AgentFreshness,
  type AgentIntelligenceResponse,
  type AgentPrecision,
  type AgentQuery,
  type AgentResolvedFrom,
  type AgentResponseOf,
  type AgentResponseStatus,
  type AgentSourceType,
  type AgentSubject,
  type AgentUnknown,
} from '../schema';
import { citationText } from '../words';

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
  /**
   * Where HEY's own project is (round 4, 2026-09-30): its published slugs and
   * `$HEY`'s contract, from the canonical `$HEY` configuration. Absent, no
   * disclosure is added. It changes nothing else in the answer.
   */
  own?: OwnProject;
  /**
   * How the subject was found when the caller sent `q` or `address` instead
   * of a slug (2026-10-14, AG-01): carried onto `subject.resolvedFrom` by
   * every composer that answers about one project. Absent when the caller
   * named the slug.
   */
  resolvedFrom?: AgentResolvedFrom;
  /**
   * The integration the request declared (`x-hey-integration`, 2026-10-14,
   * AG-02): the only case in which `links.pageAttributed` is written, as the
   * clean page plus `utm_source=hey-agent&utm_medium=<this>`. Shape-checked
   * by the request's own label parser before it reaches here.
   */
  attributionMedium?: string;
};

/** The `utm_source` of a page link an agent integration opened (AG-02). */
export const AGENT_ATTRIBUTION_SOURCE = 'hey-agent';
const ATTRIBUTION_MEDIUM = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The clean page with HEY's attribution labels, for a client that declared itself; nothing for one that did not. */
export function attributedPageUrl(page: string | undefined, medium: string | undefined): string | undefined {
  if (!page || !medium || !ATTRIBUTION_MEDIUM.test(medium)) return undefined;
  const url = new URL(page);
  url.searchParams.set('utm_source', AGENT_ATTRIBUTION_SOURCE);
  url.searchParams.set('utm_medium', medium);
  return url.toString();
}

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
/**
 * Every typed evidence id family `/api/evidence/{id}` resolves, for the
 * packages that cannot import the domain (MCP, pure callers). The web app's
 * `agent-contract-parity.test.ts` holds it equal to the domain's
 * `EVIDENCE_FAMILIES` (`evidence/ids.ts`), the one definition, so the MCP
 * `get_evidence` description and llms.txt cannot list fewer (full audit
 * 2026-10-03: they listed 11 and 9 of 14). `integrity` resolves only while
 * HEY publishes Market Integrity.
 */
export const HEY_EVIDENCE_FAMILIES = ['ship', 'signal', 'abi', 'impl', 'lock', 'source', 'claim', 'state', 'integrity', 'narrative', 'method', 'sourcechange', 'security', 'v4hook', 'v4pool', 'ponsgrad'] as const;
/** The families as a reader lists them: `integrity:` only where Market Integrity is public. */
export function evidenceFamiliesFor(options: { marketIntegrityPublic: boolean }): readonly string[] {
  return HEY_EVIDENCE_FAMILIES.filter((family) => options.marketIntegrityPublic || family !== 'integrity');
}
const EVIDENCE_FAMILIES: ReadonlySet<string> = new Set(HEY_EVIDENCE_FAMILIES);
export function looksLikeEvidenceId(id: string): boolean {
  const family = id.split(':')[0] ?? '';
  return EVIDENCE_FAMILIES.has(family) && /^[a-z][a-z0-9]*:[A-Za-z0-9:._-]{1,220}$/.test(id) && !/:(added|removed|restored|unavailable|changed)$/.test(id);
}

/** The fields of a ledger event the contract reads: `/api/changes`'s upsert and the snapshot's latest changes both carry them. */
export type ChangeLike = Pick<HeyChangeUpsert, 'id' | 'revision' | 'occurredAt' | 'detectedAt' | 'recordedAt' | 'summary' | 'evidence' | 'source'> & {
  /** The API's summary in today's words, when it restates the stored one (`HeyChangeUpsertRead`, 2026-10-16). */
  summaryCurrent?: string;
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
  // The summary in today's words when the API restates it (`summaryCurrent`, 2026-10-16): a frozen "this week" dated, a running week by its days.
  const words = event.summaryCurrent ?? event.summary;
  const summary: AgentText = summaryIsSourceText(event.id, event.type) ? externalText(words, 'source_title', firstUrl) : derivedText(words);
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

/**
 * Change domains and types whose events are context, never building (2026-09-30): market readings, market integrity, product usage,
 * and new Uniswap v4 pools on a project's attributed hook (2026-10-15: the hook's use, not the project's work).
 */
const CONTEXT_DOMAINS: ReadonlySet<string> = new Set(['market', 'market_integrity']);
const CONTEXT_TYPES: ReadonlySet<string> = new Set(['contract.usage_changed', 'contract.method_first_observed', 'contract.method_resumed', 'contract.v4_pool_initialized']);
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
/**
 * A claim's basis when its composer did not name one (round 4): cited records,
 * nothing held, or one canonical read. A composer names the rest itself (a
 * rule's output, a ledger count, a coverage state, a market reading).
 */
export function withEvidenceKind(claim: AgentClaim): AgentClaim {
  if (claim.evidenceKind) return claim;
  const kind: AgentEvidenceKind = claim.evidence.length > 0 ? 'evidence_record' : claim.status === 'UNKNOWN' ? 'not_held' : 'canonical_read';
  return { ...claim, evidenceKind: kind };
}

/**
 * An UNKNOWN claim names no source (AgentIntelligenceResponse v1, the published
 * `checkAgentInvariants`): a rule that could not decide is not the claim's source.
 * The envelope applies it to every claim, so no composer can break it.
 */
export function unknownNamesNoSource(claim: AgentClaim): AgentClaim {
  return claim.status === 'UNKNOWN' && claim.source !== null ? { ...claim, source: null } : claim;
}

/** Every project slug and contract an answer names, for the own-token disclosure. */
function namedSubjects(subject: AgentSubject, data: unknown): { slugs: Set<string>; contracts: Set<string> } {
  const slugs = new Set<string>();
  const contracts = new Set<string>();
  if (subject?.project) {
    slugs.add(subject.project.slug);
    if (subject.project.token) contracts.add(subject.project.token.address.toLowerCase());
  }
  for (const project of subject?.projects ?? []) slugs.add(project.slug);
  if (subject?.contract) contracts.add(subject.contract.address.toLowerCase());
  const payload = data as { items?: readonly { project?: { slug?: unknown } }[]; recordedProject?: { slug?: unknown } | null; projects?: readonly { slug?: unknown }[] } | null;
  for (const item of payload?.items ?? []) if (typeof item.project?.slug === 'string') slugs.add(item.project.slug);
  if (typeof payload?.recordedProject?.slug === 'string') slugs.add(payload.recordedProject.slug);
  for (const project of payload?.projects ?? []) if (typeof project.slug === 'string') slugs.add(project.slug);
  return { slugs, contracts };
}

/**
 * The `$HEY` disclosure (round 4, 2026-09-30): when HEY's own project or
 * token is anywhere in the answer, the answer says so, in the founder's words.
 * Nothing else changes: no figure, order or tag.
 */
export function ownTokenDisclosures(ctx: AgentComposeContext, subject: AgentSubject, data: unknown): AgentDisclosure[] {
  const own = ctx.own;
  if (!own) return [];
  const named = namedSubjects(subject, data);
  const projects = own.slugs.filter((slug) => named.slugs.has(slug));
  const contract = own.token !== null && named.contracts.has(own.token.address.toLowerCase());
  if (projects.length === 0 && !contract) return [];
  return [{ code: HEY_OWN_TOKEN_DISCLOSURE_CODE, statement: heyText(HEY_OWN_TOKEN_DISCLOSURE), projects: projects.slice(0, 8) }];
}

/** A project subject with how it was found (AG-01), when the caller sent a name, ticker or contract rather than the slug. */
export function subjectWithResolution(ctx: AgentComposeContext, subject: AgentSubject): AgentSubject {
  return subject && ctx.resolvedFrom && subject.kind === 'project' ? { ...subject, resolvedFrom: ctx.resolvedFrom } : subject;
}

export function envelope<C extends AgentCapability>(ctx: AgentComposeContext, parts: EnvelopeParts<C>): AgentResponseOf<C> {
  const claims = (parts.claims ?? []).slice(0, AGENT_LIMITS.claims).map(withEvidenceKind).map(unknownNamesNoSource);
  const subject = subjectWithResolution(ctx, parts.subject);
  const disclosures = ownTokenDisclosures(ctx, subject, parts.data);
  const unknowns = (parts.unknowns ?? []).slice(0, AGENT_LIMITS.unknowns);
  const asOf = ctx.now.toISOString();
  const attributed = attributedPageUrl(parts.page, ctx.attributionMedium);
  // The citation's rules: the scoring version the answer rests on, else the capability's own first rule (AG-02).
  const firstRule = parts.rules?.[0];
  const response = {
    schema: AGENT_SCHEMA,
    schemaVersion: AGENT_SCHEMA_VERSION,
    capability: parts.capability,
    status: parts.status,
    query: ctx.query,
    chain: { chainId: ctx.chainId, name: ctx.chainName },
    subject,
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
    links: { self: ctx.selfUrl, ...(parts.page ? { page: parts.page } : {}), ...(attributed ? { pageAttributed: attributed } : {}), canonical: (parts.canonical ?? []).slice(0, 12) },
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
            text: citationText({ chainName: ctx.chainName, url: parts.page ?? ctx.selfUrl, asOf, rules: parts.scoringVersion ?? (firstRule ? `${firstRule.id} ${firstRule.version}` : null) }),
          }
        : null,
    boundaries: boundaries(ctx),
    ...(parts.error ? { error: parts.error } : {}),
    ...(disclosures.length > 0 ? { disclosures } : {}),
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

/** The error code and words when a name or ticker matched several published projects (AG-01). */
export const AMBIGUOUS_CODE = 'ambiguous';
/** The error code when a name, ticker or contract matched no published project (AG-01). */
export const NOT_PUBLISHED_CODE = 'not_published';

/** One candidate an ambiguous name or ticker could mean: HEY's identity row and its building state, never a market figure. */
export type AmbiguousCandidate = {
  slug: string;
  name: string;
  url: string;
  token?: { chainId: number; address: string };
  symbol?: string;
  activityStatus?: string;
  catalogStatus?: string;
};

/**
 * A name or ticker that several published projects could be (AG-01): an
 * `invalid_request` that lists the candidates — slug, name as a source's
 * words, the tracked token, its ticker, activity status and catalog status
 * (2026-10-17, AG-3) — in the order the caller gave (research readiness,
 * then activity), and picks none. `total` is how many matched, so a list of
 * eight says it is eight of how many. The message names HEY's own slugs,
 * never the caller's text.
 */
export function ambiguousRefusal<C extends AgentCapability>(ctx: AgentComposeContext, capability: C, candidates: readonly AmbiguousCandidate[], total?: { count: number; atLeast: boolean }): AgentResponseOf<C> {
  const listed: AgentCandidate[] = candidates.slice(0, 8).map((candidate) => ({
    slug: candidate.slug,
    name: externalText(candidate.name, 'project_record', undefined, 120),
    url: candidate.url,
    ...(candidate.token ? { token: { chainId: candidate.token.chainId, address: candidate.token.address.toLowerCase() } } : {}),
    ...(candidate.symbol ? { symbol: externalText(candidate.symbol, 'project_record', undefined, 40) } : {}),
    ...(candidate.activityStatus ? { activityStatus: candidate.activityStatus } : {}),
    ...(candidate.catalogStatus ? { catalogStatus: candidate.catalogStatus } : {}),
  }));
  const count = Math.max(total?.count ?? listed.length, listed.length);
  const of = count > listed.length ? ` (the first ${listed.length} of ${total?.atLeast ? 'at least ' : ''}${count}, verified builders and active builders first)` : '';
  /*
   * Worded by count (2026-10-16, audit finding 114): a single prefix match read "More than one published project
   * matches … courier-world". One candidate is the closest match, not a crowd; the code stays `ambiguous`, since HEY
   * still picks nothing for the caller.
   */
  const message =
    listed.length === 1 && count === 1
      ? `No published project has exactly that name or ticker; the closest is ${listed[0]!.slug}. HEY does not guess: send it as project, or the contract as address.`
      : `More than one published project matches that name or ticker: ${listed.map((candidate) => candidate.slug).join(', ')}${of}. HEY does not guess: send one of them as project, or the contract as address.`;
  const base = refusal(ctx, capability, 'invalid_request', AMBIGUOUS_CODE, message);
  return { ...base, error: { ...base.error!, candidates: listed, ...(total ? { candidatesTotal: { count, atLeast: total.atLeast } } : {}) } } as AgentResponseOf<C>;
}

/** No published project for the name, ticker or contract asked about (AG-01): a statement about HEY's index, never about the project. */
export function notPublishedRefusal<C extends AgentCapability>(ctx: AgentComposeContext, capability: C, by: 'q' | 'address'): AgentResponseOf<C> {
  const message =
    by === 'address'
      ? 'HEY holds no published project for that contract. That is a statement about HEY’s index, not about the token; verify_project says what HEY recorded about the contract itself.'
      : 'HEY holds no published project matching that name or ticker. That is a statement about HEY’s index, not about the project.';
  return refusal(ctx, capability, 'not_found', NOT_PUBLISHED_CODE, message);
}

/** The slug-only URL of a project's API resource. */
export const projectApi = (ctx: AgentComposeContext, slug: string, path = ''): string => `${ctx.baseUrl}/api/projects/${slug}${path}`;
export const projectPage = (ctx: AgentComposeContext, slug: string): string => `${ctx.baseUrl}/project/${slug}`;
