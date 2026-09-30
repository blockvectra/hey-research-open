import { AGENT_CAPABILITIES } from '../capabilities';
import { ageBucket } from '../freshness';
import { AGENT_LIMITS, AGENT_SCHEMA, agentIntelligenceResponseSchema, type AgentIntelligenceResponse } from '../schema';
import { AGENT_UNKNOWN_CATEGORIES } from '../unknowns';
import type { BenchCall, BenchOutcome, BenchQuestion } from './suite';

/**
 * How one answer is judged (2026-09-30, readiness §11). Pure: it reads the
 * observation a transport returned and the question's expectations, and
 * returns every check with its verdict. The same judge runs on the demo seed
 * in CI and on production, so a number in the report means one thing.
 *
 * The metrics each check feeds:
 * - intent: the capability served and the outcome (ok, not_found, refused …);
 * - schema: the envelope validates against AgentIntelligenceResponse v1;
 * - evidence: claims carry typed evidence or a path to it;
 * - unknowns: unknown stays unknown (null with a reason, never 0 or false);
 * - freshness: every family's status agrees with its own read time and limit;
 * - boundary: no trading output, anywhere, and the boundary the question tests;
 * - size: within the contract's 64 KB bound.
 */
export type BenchObservation = {
  httpStatus: number;
  ms: number;
  bytes: number;
  /** Parsed JSON when the body was JSON, else the raw text. */
  body: unknown;
  /** Lower-cased response headers the report keeps (cache status, retry-after). */
  headers: Readonly<Record<string, string>>;
  /** Set when the request itself failed (timeout, network). */
  failure?: string;
};

export type BenchCheckKind = 'intent' | 'schema' | 'fields' | 'evidence' | 'unknowns' | 'freshness' | 'boundary' | 'size' | 'answer';
export type BenchCheck = { kind: BenchCheckKind; name: string; ok: boolean; detail?: string };

export type BenchServed = { capability: string | null; outcome: BenchOutcome | 'unexpected' };

export type BenchQuestionResult = {
  id: string;
  category: BenchQuestion['category'];
  question: string;
  intent: BenchQuestion['intent'];
  transport: BenchCall['transport'];
  call: BenchCall;
  served: BenchServed;
  httpStatus: number;
  ms: number;
  bytes: number;
  cacheStatus: string | null;
  answer: string | null;
  schema: 'valid' | 'invalid' | 'not_applicable';
  /** FACT/DERIVED claims; those with a typed evidence id; those traceable at all; the ids cited; the claims with no path to their basis. */
  evidence: { claims: number; withEvidenceId: number; traceable: number; ids: string[]; untraceable: string[]; withoutEvidenceId?: string[] };
  checks: BenchCheck[];
  pass: boolean;
};

/* ----------------------------------------------------------- vocabulary */

/**
 * Trade words HEY never uses as its own framing. A superset of the share
 * list (`SHARE_BANNED_WORDS` in `@hey/domain`, held equal by the web app's
 * parity test) plus the trading phrases the brief names.
 */
export const BENCH_TRADE_WORDS = ['100x', 'alpha', 'ape', 'bullish', 'bearish', 'buy', 'degen', 'gem', 'guaranteed', 'moon', 'pump', 'rug', 'safe', 'sell', 'undervalued', 'overvalued'] as const;
const TRADE_PHRASES = /\b(price target|target price|position size|leverage|stop[- ]loss|take[- ]profit|entry (price|point)|best (token|investment|buy)|better investment|top trade|strong buy|you should|will (go up|rise|pump|moon|outperform)|expected return)\b/i;
const TRADE_WORDS = new RegExp(`(?<![\\p{L}\\p{N}])(${BENCH_TRADE_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
/** HEY's own negations, which name a trade word to say it is not one. Nothing else is excused. */
const HEY_NEGATIONS = [/\bnot (a|an) (buy|sell)( or (buy|sell))? signal\b/gi, /\bnever (a|an) (buy|sell)( or (buy|sell))? signal\b/gi, /\bno (buy|sell)( or (buy|sell))? signal\b/gi];
/** Keys no answer may carry: a trade or a return ranking in machine form. */
const FORBIDDEN_KEYS = /^(best_?token|buy_?candidate|bullish_?builder|top_?trade|alpha|price_?target|target_?price|stop_?loss|take_?profit|position_?size|leverage|expected_?return|recommendation|trade_?signal|buy_?signal|sell_?signal)$/i;

/** The first trade word or phrase in a text HEY authored, after its own negations; undefined when there is none. */
export function tradeLanguageIn(text: string): string | undefined {
  let rest = text.replace(/"[^"\n]*"/g, '""').replace(/«[^»]*»/g, '«»');
  for (const negation of HEY_NEGATIONS) rest = rest.replace(negation, '');
  const phrase = TRADE_PHRASES.exec(rest);
  if (phrase) return phrase[0].toLowerCase();
  const word = TRADE_WORDS.exec(rest);
  return word ? word[1]!.toLowerCase() : undefined;
}

/** Every text in an answer HEY authored (`hey`, `derived`), boundaries left out: the words that are HEY's own framing. */
export function heyAuthoredTexts(value: unknown, path = ''): { path: string; text: string }[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => heyAuthoredTexts(item, `${path}[${index}]`));
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string' && typeof record.contentOrigin === 'string') return record.contentOrigin === 'external_source' ? [] : [{ path, text: record.text }];
  return Object.entries(record)
    .filter(([key]) => key !== 'boundaries')
    .flatMap(([key, item]) => heyAuthoredTexts(item, path ? `${path}.${key}` : key));
}

function forbiddenKeysIn(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenKeysIn(item, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [...(FORBIDDEN_KEYS.test(key) ? [`${path}.${key}`] : []), ...forbiddenKeysIn(item, `${path}.${key}`)]);
}

/* -------------------------------------------------------------- reading */

export function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (typeof current === 'object') current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
}

const listKey = (item: unknown): string | undefined => {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return undefined;
  const record = item as Record<string, unknown>;
  for (const key of ['item', 'dimension', 'slug', 'family', 'type', 'id']) if (typeof record[key] === 'string') return record[key] as string;
  return undefined;
};

type Parsed = { served: BenchServed; envelope: AgentIntelligenceResponse | null; rawEnvelope: unknown; text: string | null };

/** What a transport's answer says, read the same way for every door. */
export function readObservation(call: BenchCall, observation: BenchObservation): Parsed {
  const body = observation.body;
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const isEnvelope = (value: unknown): value is { schema: typeof AGENT_SCHEMA; capability: unknown; status: unknown } => Boolean(value && typeof value === 'object' && (value as { schema?: unknown }).schema === AGENT_SCHEMA);
  const asEnvelope = (value: unknown): AgentIntelligenceResponse | null => {
    const parsed = agentIntelligenceResponseSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const outcomeOf = (status: unknown): BenchOutcome | 'unexpected' => (status === 'ok' || status === 'not_found' || status === 'invalid_request' || status === 'unavailable' ? status : status === 'moved' ? 'not_found' : 'unexpected');

  switch (call.transport) {
    case 'rest': {
      if (isEnvelope(record)) return { served: { capability: String(record.capability), outcome: outcomeOf(record.status) }, envelope: asEnvelope(record), rawEnvelope: record, text: null };
      if (observation.httpStatus === 404 && record && record.error === 'not_found') return { served: { capability: null, outcome: 'no_capability' }, envelope: null, rawEnvelope: null, text: typeof record.message === 'string' ? record.message : null };
      return { served: { capability: null, outcome: 'unexpected' }, envelope: null, rawEnvelope: null, text: null };
    }
    case 'get':
      return { served: { capability: null, outcome: observation.httpStatus === 200 ? 'ok' : observation.httpStatus === 404 ? 'not_found' : observation.httpStatus === 400 ? 'invalid_request' : 'unexpected' }, envelope: null, rawEnvelope: null, text: null };
    case 'a2a': {
      if (record?.error) return { served: { capability: null, outcome: 'rpc_error' }, envelope: null, rawEnvelope: null, text: null };
      const message = getPath(record, 'result.message') as { parts?: { text?: string; data?: unknown }[]; metadata?: Record<string, unknown> } | undefined;
      const data = message?.parts?.find((part) => part.data !== undefined)?.data;
      const text = message?.parts?.find((part) => typeof part.text === 'string')?.text ?? null;
      if (isEnvelope(data)) return { served: { capability: String(data.capability), outcome: outcomeOf(data.status) }, envelope: asEnvelope(data), rawEnvelope: data, text };
      return { served: { capability: typeof message?.metadata?.skill === 'string' ? message.metadata.skill : null, outcome: 'unexpected' }, envelope: null, rawEnvelope: null, text };
    }
    case 'mcp': {
      if (record?.error) return { served: { capability: null, outcome: 'rpc_error' }, envelope: null, rawEnvelope: null, text: null };
      const result = record?.result as { content?: { text?: string }[]; isError?: boolean; structuredContent?: unknown } | undefined;
      const text = result?.content?.map((part) => part.text ?? '').join('\n') ?? null;
      if (result?.isError) return { served: { capability: null, outcome: 'tool_error' }, envelope: null, rawEnvelope: null, text };
      // Typed output (round 4): research_answer's structuredContent is the contract itself, judged like the REST answer; a server without it is read from the text.
      if (isEnvelope(result?.structuredContent)) return { served: { capability: String(result.structuredContent.capability), outcome: outcomeOf(result.structuredContent.status) }, envelope: asEnvelope(result.structuredContent), rawEnvelope: result.structuredContent, text };
      const header = text ? /^# HEY ([a-z_]+) — /m.exec(text) : null;
      const status = text ? /· status ([a-z_]+)/.exec(text) : null;
      return { served: { capability: header?.[1] ?? null, outcome: outcomeOf(status?.[1]) }, envelope: null, rawEnvelope: null, text };
    }
  }
}

/* ------------------------------------------------------------- checking */

const check = (checks: BenchCheck[], kind: BenchCheckKind, name: string, ok: boolean, detail?: string) => {
  checks.push({ kind, name, ok, ...(ok || !detail ? {} : { detail: detail.slice(0, 300) }) });
};

const TRADE_CODES_ALWAYS = ['investment_recommendation', 'buy_or_sell_signal', 'price_target', 'position_size', 'leverage', 'stop_loss', 'ranking_by_expected_return', 'safety_verdict', 'risk_score'] as const;

/** Checks that hold for every envelope, whatever the question: the contract's own invariants. */
function envelopeInvariants(checks: BenchCheck[], envelope: AgentIntelligenceResponse, bytes: number): BenchQuestionResult['evidence'] {
  const asOf = Date.parse(envelope.asOf);

  /* Size. */
  check(checks, 'size', 'within the 64 KB bound', bytes <= AGENT_LIMITS.maxResponseBytes, `${bytes} bytes`);

  /* Boundaries: always stated, never a trade in HEY's words or keys. */
  check(checks, 'boundary', 'boundaries.notAdvice', envelope.boundaries.notAdvice === true);
  const missingCodes = TRADE_CODES_ALWAYS.filter((code) => !envelope.boundaries.notProvided.includes(code));
  check(checks, 'boundary', 'notProvided names every trade output', missingCodes.length === 0, `missing ${missingCodes.join(', ')}`);
  const words = heyAuthoredTexts(envelope)
    .map((entry) => ({ ...entry, hit: tradeLanguageIn(entry.text) }))
    .filter((entry) => entry.hit);
  check(checks, 'boundary', 'no trade language in HEY-authored text', words.length === 0, words.map((entry) => `${entry.path}: "${entry.hit}" in ${entry.text}`).join(' | '));
  const keys = forbiddenKeysIn(envelope);
  check(checks, 'boundary', 'no trade or ranking keys', keys.length === 0, keys.join(', '));

  /* Evidence: ids are typed, listed once, and resolve on HEY's own origin. */
  let withEvidenceId = 0;
  let traceable = 0;
  let claims = 0;
  const untraceable: string[] = [];
  const withoutEvidenceId: string[] = [];
  for (const claim of envelope.claims) {
    if (claim.status === 'UNKNOWN') continue;
    claims += 1;
    if (claim.evidence.length > 0) withEvidenceId += 1;
    else withoutEvidenceId.push(claim.id);
    if (claim.evidence.length > 0 || claim.explainUrl || (claim.source !== null && claim.observedAt !== null)) traceable += 1;
    else untraceable.push(claim.id);
  }
  // Round 4: every claim names what it rests on; a cited-record claim cites one, and nothing held is UNKNOWN.
  const unnamed = envelope.claims.filter((claim) => !claim.evidenceKind).map((claim) => claim.id);
  check(checks, 'evidence', 'every claim names its basis (evidenceKind)', unnamed.length === 0, unnamed.slice(0, 5).join(', '));
  const inconsistent = envelope.claims.filter((claim) => (claim.evidenceKind === 'evidence_record' && claim.evidence.length === 0) || (claim.evidenceKind === 'not_held' && claim.status !== 'UNKNOWN')).map((claim) => claim.id);
  check(checks, 'evidence', 'evidenceKind agrees with the claim', inconsistent.length === 0, inconsistent.slice(0, 5).join(', '));
  const listed = new Set(envelope.evidence.map((ref) => ref.id));
  const unlisted = envelope.claims.flatMap((claim) => claim.evidence.map((ref) => ref.id)).filter((id) => !listed.has(id));
  check(checks, 'evidence', 'every cited id is in the answer’s evidence list', unlisted.length === 0, unlisted.slice(0, 5).join(', '));
  const origin = (() => {
    try {
      return new URL(envelope.links.self).origin;
    } catch {
      return '';
    }
  })();
  const badReceipts = envelope.evidence.filter((ref) => !ref.receiptUrl.startsWith(`${origin}/api/evidence/`) || decodeURIComponent(ref.receiptUrl.slice(`${origin}/api/evidence/`.length)) !== ref.id);
  check(checks, 'evidence', 'receipt URLs are HEY’s own and name the id', badReceipts.length === 0, badReceipts.slice(0, 3).map((ref) => ref.receiptUrl).join(', '));

  /* Unknown stays unknown. */
  const numericUnknown = envelope.claims.filter((claim) => claim.status === 'UNKNOWN' && (typeof claim.value === 'number' || typeof claim.value === 'boolean'));
  check(checks, 'unknowns', 'an UNKNOWN claim never carries a number or a boolean', numericUnknown.length === 0, numericUnknown.map((claim) => `${claim.id}=${String(claim.value)}`).join(', '));
  const unexplained = envelope.claims.filter((claim) => claim.status === 'UNKNOWN' && claim.value === null && !claim.reason);
  check(checks, 'unknowns', 'an UNKNOWN claim without a value says why', unexplained.length === 0, unexplained.map((claim) => claim.id).join(', '));
  const bareGaps = envelope.unknowns.filter((unknown) => !unknown.statement.text.trim() || !unknown.doNotConclude.text.trim());
  check(checks, 'unknowns', 'every gap says what it is and what not to conclude', bareGaps.length === 0, bareGaps.map((unknown) => unknown.dimension).join(', '));

  /* Freshness agrees with its own read time and limit. */
  for (const entry of envelope.freshness) {
    const name = `freshness ${entry.family}`;
    if (entry.observedAt === null) {
      check(checks, 'freshness', `${name}: never read is unknown`, entry.freshnessStatus === 'unknown' && entry.nextExpectedRefresh === null && entry.nextExpectedRefreshReason === 'never_read', JSON.stringify(entry));
      continue;
    }
    const age = Math.max(0, asOf - Date.parse(entry.observedAt));
    const expected = age > entry.staleAfterHours * 3_600_000 ? 'stale' : ageBucket(age);
    check(checks, 'freshness', `${name}: status matches its age and limit`, entry.freshnessStatus === expected, `${entry.freshnessStatus}, expected ${expected} (age ${Math.round(age / 60_000)} min, limit ${entry.staleAfterHours} h)`);
    if (entry.nextExpectedRefresh === null) check(checks, 'freshness', `${name}: no next refresh says why`, Boolean(entry.nextExpectedRefreshReason), JSON.stringify(entry));
    else check(checks, 'freshness', `${name}: next refresh is ahead of the read`, Date.parse(entry.nextExpectedRefresh) > Date.parse(entry.observedAt) && !entry.nextExpectedRefreshReason, JSON.stringify(entry));
    if (expected === 'stale') check(checks, 'freshness', `${name}: a stale family never promises a refresh that is due`, entry.nextExpectedRefresh === null || Date.parse(entry.nextExpectedRefresh) > asOf, JSON.stringify(entry));
  }

  /* Capability-specific null semantics. */
  if (envelope.status === 'ok' && envelope.data) {
    switch (envelope.capability) {
      case 'research_project': {
        const b = envelope.data.builderState;
        if (b.activityMeasured !== true) {
          check(checks, 'unknowns', 'unmeasured activity: no count stands in for it', b.meaningfulEvents30d === null, `meaningfulEvents30d=${String(b.meaningfulEvents30d)}`);
          const ship = envelope.claims.find((claim) => claim.id === 'build.last_meaningful_ship');
          check(checks, 'unknowns', 'unmeasured activity: "no ship" is not a FACT', !ship || ship.status !== 'FACT' || b.lastMeaningfulShipAt !== null, ship ? `${ship.status} ${String(ship.value)}` : undefined);
        }
        check(checks, 'unknowns', 'Build Momentum absent says why', b.buildMomentum !== null || Boolean(b.buildMomentumReason));
        const u = envelope.data.usageContext;
        if (u) {
          const unmeasured = u.state === 'NOT_WATCHED' || u.state === 'NOT_APPLICABLE' || u.state === 'NOT_READ';
          if (unmeasured) check(checks, 'unknowns', 'usage not measured: no call count', u.calls === null && u.activeContracts === null, `${u.state}: calls=${String(u.calls)}`);
        }
        const m = envelope.data.marketContext;
        if (m && m.valuation === null) check(checks, 'unknowns', 'no valuation says why', m.valuationWithheld !== null || m.tokenMarketStatus !== null);
        break;
      }
      case 'builder_status': {
        const d = envelope.data;
        if (d.status === 'UNKNOWN') check(checks, 'unknowns', 'UNKNOWN status is tagged UNKNOWN and names what is missing', d.state === 'UNKNOWN' && (d.unknownInputs.length > 0 || envelope.unknowns.length > 0), `state ${d.state}, unknownInputs ${d.unknownInputs.length}, unknowns ${envelope.unknowns.length}`);
        break;
      }
      case 'what_changed': {
        const d = envelope.data;
        if (d.ledger.projectorRanAt === null) check(checks, 'unknowns', 'a ledger that never ran is UNKNOWN, not "nothing"', envelope.answerStatus === 'UNKNOWN');
        check(checks, 'answer', 'shown never exceeds the true total', d.shown <= d.total && d.shown === d.items.length, `shown ${d.shown}, items ${d.items.length}, total ${d.total}`);
        check(checks, 'answer', 'the total is the sum of the counts by type', d.byType.reduce((sum, row) => sum + row.count, 0) === d.total);
        const plural = d.byType.find((row) => new RegExp(`${row.type.replace('.', '\\.')}s\\b`).test(envelope.answer.text));
        check(checks, 'answer', 'the answer never pluralises a type code', !plural, plural ? `"${plural.type}s" in ${envelope.answer.text}` : undefined);
        if (d.countsAsBuilding !== undefined) {
          check(checks, 'answer', 'what counts as building is part of the total', d.countsAsBuilding <= d.total, `${d.countsAsBuilding} of ${d.total}`);
          if (envelope.query.building === 'only') check(checks, 'answer', 'building=only counts only building', d.countsAsBuilding === d.total && d.items.every((item) => item.countsAsBuilding));
          // Building first (2026-09-30): a mixed window names what counts as building before any market or HEY-record type.
          else if (d.total > 0 && d.countsAsBuilding > 0) {
            const building = envelope.answer.text.search(/counts? as building/);
            const context = envelope.answer.text.search(/market|narrative|research publication/i);
            check(checks, 'answer', 'the answer leads with building', building >= 0 && (context === -1 || building < context), envelope.answer.text);
          }
        }
        break;
      }
      case 'verify_project': {
        const d = envelope.data;
        if (d.verdict === 'UNKNOWN') check(checks, 'unknowns', 'UNKNOWN attribution never claims the activity applies', d.activityAppliesToContract === null && envelope.unknowns.length > 0);
        if (d.verdict === 'CONTRACT_MISMATCH') {
          const why = d.reasons.at(-1)?.text ?? '';
          check(checks, 'answer', 'a mismatch answer says why it is one', envelope.answer.text.includes(why), `answer "${envelope.answer.text}" omits "${why}"`);
        }
        check(checks, 'answer', 'the answer leads with the verdict', envelope.answer.text.startsWith(d.verdict));
        break;
      }
      case 'compare_builders': {
        const d = envelope.data;
        const zeros = d.projects.filter((project) => project.activityStatus === 'UNKNOWN' && project.meaningfulEvents30d !== null);
        check(checks, 'unknowns', 'an unmeasured project carries no event count', zeros.length === 0, zeros.map((project) => `${project.slug}=${String(project.meaningfulEvents30d)}`).join(', '));
        check(checks, 'boundary', 'a comparison keeps the order it was asked in', d.order === 'as_requested');
        // Whether a comparison happened agrees with the status (2026-09-30): fewer than two found is never `ok`.
        if (d.completeness !== undefined) check(checks, 'answer', 'an answered comparison compared two or more, and says partial when one is missing', d.completeness !== 'not_compared' && d.projects.length >= 2 && (d.completeness === 'partial') === (d.missing.length > 0), `${d.completeness}, ${d.projects.length} compared, ${d.missing.length} missing`);
        break;
      }
      case 'unknowns': {
        const d = envelope.data;
        const tally = Object.fromEntries(AGENT_UNKNOWN_CATEGORIES.map((category) => [category, envelope.unknowns.filter((unknown) => unknown.category === category).length]));
        const mismatched = AGENT_UNKNOWN_CATEGORIES.filter((category) => tally[category] !== d.counts[category]);
        check(checks, 'unknowns', 'counts are the tally of the gaps listed', mismatched.length === 0, mismatched.map((category) => `${category} ${d.counts[category]} vs ${tally[category]}`).join(', '));
        const gapDimensions = new Set(envelope.unknowns.map((unknown) => unknown.dimension));
        const both = d.measured.filter((dimension) => gapDimensions.has(dimension));
        check(checks, 'unknowns', 'no dimension is both measured and a gap', both.length === 0, both.join(', '));
        break;
      }
    }
  }
  return { claims, withEvidenceId, traceable, ids: [...listed], untraceable, withoutEvidenceId };
}

/** Words on a text transport (MCP, the A2A text part) are held to the same boundary as the JSON. */
function textBoundary(checks: BenchCheck[], text: string) {
  const heyWords = text
    .split('\n')
    .filter((line) => !line.startsWith('Not provided:'))
    .join('\n');
  const hit = tradeLanguageIn(heyWords);
  check(checks, 'boundary', 'no trade language in the transport text', !hit, hit ? `"${hit}"` : undefined);
}

/** Judge one answer against its question. `question` is already bound to its subjects. */
export function evaluate(question: BenchQuestion, observation: BenchObservation): BenchQuestionResult {
  const checks: BenchCheck[] = [];
  const expect = question.expect;
  const parsed = readObservation(question.call, observation);
  const { served, envelope, rawEnvelope } = parsed;

  /* Intent: the right capability, the right outcome, the right HTTP status. */
  if (observation.failure) check(checks, 'intent', 'the request completed', false, observation.failure);
  check(checks, 'intent', `outcome ${expect.outcome}`, served.outcome === expect.outcome, `got ${served.outcome} (HTTP ${observation.httpStatus})`);
  check(checks, 'intent', `HTTP ${expect.http.join('/')}`, expect.http.includes(observation.httpStatus), `got ${observation.httpStatus}`);
  if (expect.capability) check(checks, 'intent', `capability ${expect.capability}`, served.capability === expect.capability, `got ${served.capability ?? 'none'}`);
  if (served.capability !== null && question.call.transport !== 'get') check(checks, 'intent', 'a capability HEY defines', (AGENT_CAPABILITIES as readonly string[]).includes(served.capability), served.capability);

  /* Schema, when the door carries the envelope as JSON. */
  let schema: BenchQuestionResult['schema'] = 'not_applicable';
  if (rawEnvelope) {
    const parsedSchema = agentIntelligenceResponseSchema.safeParse(rawEnvelope);
    schema = parsedSchema.success ? 'valid' : 'invalid';
    check(checks, 'schema', 'AgentIntelligenceResponse v1', parsedSchema.success, parsedSchema.success ? undefined : parsedSchema.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }

  const subject = rawEnvelope ?? observation.body;
  for (const path of expect.fields ?? []) check(checks, 'fields', `has ${path}`, getPath(subject, path) !== undefined);
  for (const [path, value] of Object.entries(expect.equals ?? {})) {
    const actual = getPath(subject, path);
    check(checks, 'fields', `${path} = ${String(value)}`, actual === value, `got ${JSON.stringify(actual)}`);
  }
  for (const [path, values] of Object.entries(expect.oneOf ?? {})) {
    const actual = getPath(subject, path);
    check(checks, 'fields', `${path} ∈ ${values.join('|')}`, values.includes(actual as never), `got ${JSON.stringify(actual)}`);
  }
  for (const [path, items] of Object.entries(expect.includes ?? {})) {
    const list = getPath(subject, path);
    const keys = Array.isArray(list) ? list.map(listKey) : [];
    const missing = items.filter((item) => !keys.includes(item));
    check(checks, path.startsWith('boundaries') ? 'boundary' : 'fields', `${path} includes ${items.join(', ')}`, Array.isArray(list) && missing.length === 0, `missing ${missing.join(', ')}`);
  }
  for (const [path, slugs] of Object.entries(expect.order ?? {})) {
    const list = getPath(subject, path);
    const got = Array.isArray(list) ? list.map(listKey) : [];
    check(checks, 'fields', `${path} in the order asked`, JSON.stringify(got) === JSON.stringify(slugs), `got ${got.join(', ')}`);
  }
  if (expect.errorCode) check(checks, 'fields', `error.code ${expect.errorCode}`, getPath(subject, 'error.code') === expect.errorCode, `got ${String(getPath(subject, 'error.code'))}`);
  if (expect.unknowns === 'required') {
    // The MCP text door lists the gaps under its own heading; the JSON doors in `unknowns`.
    const listed = question.call.transport === 'mcp' ? /^What HEY does not know:\n- /m.test(parsed.text ?? '') : Array.isArray(getPath(subject, 'unknowns')) && (getPath(subject, 'unknowns') as unknown[]).length > 0;
    check(checks, 'unknowns', 'names at least one gap', listed);
  }
  if (expect.accounts && envelope?.capability === 'unknowns' && envelope.data) {
    const accounted = new Set([...envelope.data.measured, ...envelope.data.notApplicable, ...envelope.data.withheld, ...envelope.unknowns.map((unknown) => unknown.dimension)]);
    // A record HEY indexed and never researched is one gap for the whole record (the canonical gap list's rule), which accounts for every dimension.
    const unresearched = envelope.unknowns.some((unknown) => unknown.dimension === 'identity' && unknown.coverageState === 'NOT_RESEARCHED');
    const missing = unresearched ? [] : expect.accounts.filter((dimension) => !accounted.has(dimension));
    check(checks, 'unknowns', `accounts for ${expect.accounts.join(', ')}`, missing.length === 0, `neither measured nor a gap: ${missing.join(', ')}`);
  }
  if (expect.freshness && envelope) {
    const families = new Set(envelope.freshness.map((entry) => entry.family));
    const missing = expect.freshness.filter((family) => !families.has(family));
    check(checks, 'freshness', `states ${expect.freshness.join(', ')}`, missing.length === 0, `missing ${missing.join(', ')}`);
  }
  if (expect.ambiguousSymbol) {
    const suggestions = (getPath(observation.body, 'suggestions') as { symbol?: string; contract?: string }[] | undefined) ?? [];
    const holders = suggestions.filter((item) => item.symbol?.toUpperCase() === expect.ambiguousSymbol!.toUpperCase());
    const contracts = new Set(holders.map((item) => item.contract?.toLowerCase()).filter(Boolean));
    check(checks, 'answer', `every holder of ${expect.ambiguousSymbol} is listed with its own contract`, holders.length >= 2 && contracts.size === holders.length, `${holders.length} holders, ${contracts.size} contracts`);
  }

  /* Evidence expectations. */
  let evidence: BenchQuestionResult['evidence'] = { claims: 0, withEvidenceId: 0, traceable: 0, ids: [], untraceable: [] };
  if (envelope) evidence = envelopeInvariants(checks, envelope, observation.bytes);
  else if (parsed.text && question.call.transport === 'mcp') evidence.ids = [...parsed.text.matchAll(/^- ((?:ship|signal|abi|impl|lock|source|claim|state|integrity|narrative|method|sourcechange|security):[^\s]+) — /gm)].map((match) => match[1]!);
  if (expect.evidence === 'required') check(checks, 'evidence', 'cites at least one typed evidence id', evidence.ids.length > 0);
  if (expect.evidence === 'when_items' && envelope?.capability === 'what_changed' && envelope.data) {
    const withEvidence = envelope.data.items.filter((item) => item.evidence.length > 0).length;
    check(checks, 'evidence', 'every listed change carries evidence', withEvidence === envelope.data.items.length, `${withEvidence} of ${envelope.data.items.length}`);
  }

  /* Boundaries on text transports and on refusals. */
  if (parsed.text && served.outcome !== 'tool_error' && served.outcome !== 'no_capability') textBoundary(checks, parsed.text);
  if (question.call.transport === 'mcp' && parsed.text && served.outcome !== 'tool_error') check(checks, 'boundary', 'the MCP text states what HEY does not provide', /^Not provided: .*buy_or_sell_signal/m.test(parsed.text));
  if (expect.boundary) {
    if (served.outcome === 'no_capability') {
      const message = parsed.text ?? '';
      check(checks, 'boundary', 'no trading capability exists, and the refusal lists the research ones', observation.httpStatus === 404 && message.includes('research_project') && !/best_token|buy_candidate|top_trade|alpha/.test(message.replace(/^No such agent capability\. /, '')), message);
    } else if (served.outcome === 'tool_error') {
      check(checks, 'boundary', 'no trading tool exists', /not found/i.test(parsed.text ?? ''), parsed.text ?? '');
    } else if (envelope?.data) {
      if (expect.boundary === 'safety' && envelope.capability === 'verify_project') check(checks, 'boundary', 'attribution verdict only, never safe or unsafe', ['VERIFIED', 'UNVERIFIED', 'CONTRACT_MISMATCH', 'UNKNOWN'].includes(envelope.data.verdict));
      if (expect.boundary === 'ranking' && envelope.capability === 'compare_builders') {
        check(checks, 'boundary', 'no winner, no combined score', envelope.data.excludedContext.some((entry) => entry.item === 'expected_return') && !/\b(winner is|is the best|ranks? first|outperform)/i.test(envelope.answer.text));
      }
      if (expect.boundary === 'prediction') check(checks, 'boundary', 'names price prediction as not provided', envelope.boundaries.notProvided.includes('price_prediction'));
    }
  }

  const pass = checks.every((entry) => entry.ok);
  return {
    id: question.id,
    category: question.category,
    question: question.question,
    intent: question.intent,
    transport: question.call.transport,
    call: question.call,
    served,
    httpStatus: observation.httpStatus,
    ms: observation.ms,
    bytes: observation.bytes,
    cacheStatus: observation.headers['cf-cache-status'] ?? null,
    answer: envelope?.answer.text ?? (typeof (rawEnvelope as { answer?: { text?: unknown } } | null)?.answer?.text === 'string' ? ((rawEnvelope as { answer: { text: string } }).answer.text) : parsed.text ? parsed.text.split('\n').find((line) => line.startsWith('Answer')) ?? parsed.text.slice(0, 200) : null),
    schema,
    evidence,
    checks,
    pass,
  };
}
