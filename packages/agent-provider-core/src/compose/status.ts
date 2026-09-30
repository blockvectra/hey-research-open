import type { HeyExplainedFact } from '@hey-research-lab/sdk';

import { ageBucket, familyFreshness } from '../freshness';
import type { AgentClaim, AgentEvidenceRef, AgentResponseOf, AgentUnknown } from '../schema';
import { derivedText, externalText, heyText } from '../text';
import { envelope, evidenceRef, looksLikeEvidenceId, type AgentComposeContext } from './common';

/**
 * builder_status (2026-09-30): "is this project still building, and why
 * does HEY say so?" — the explain engine's own answer for `activity.status`,
 * `build.momentum` and `still_building`, restated: the status, the rule and
 * its version, the inputs, the lineage from source to public value, the
 * evidence ids, and the context the rule never reads.
 *
 * The explain engine reads persisted evaluations and never re-derives a
 * value (machine-layer rule 6); this composer adds nothing to it but the
 * contract's shape and the excluded-context list, which is the methodology's
 * own boundary written down.
 */
export type BuilderStatusInput = {
  project: { slug: string; name: string; url: string; token?: { chainId: number; address: string } };
  activity: HeyExplainedFact;
  momentum: HeyExplainedFact;
  stillBuilding: HeyExplainedFact;
  /** Gaps that bear on the status (builder sources, repositories, releases), from the canonical gap list. */
  unknowns?: AgentUnknown[];
  isEvidenceId?: (id: string) => boolean;
};

/**
 * What the activity rule never reads (product rules 2, 3 and 6; usage rule
 * 1; free-data rules 8, 9 and 13). Written as the boundary, not as a claim
 * about this project.
 */
export const EXCLUDED_FROM_BUILDER_STATUS = [
  { item: 'price', statement: 'Token price, and any change in it.' },
  { item: 'valuation', statement: 'Market cap or FDV.' },
  { item: 'liquidity_and_volume', statement: 'Liquidity, trading volume and trades.' },
  { item: 'holders', statement: 'Holder counts and supply distribution.' },
  { item: 'product_usage', statement: 'Product usage (calls, active contracts, distinct caller addresses): its own dimension.' },
  { item: 'paid_promotion', statement: 'Paid promotion or boosts seen on the token.' },
  { item: 'hey_holdings', statement: '$HEY holdings, payment, sponsorship or integration with HEY.' },
  { item: 'social_attention', statement: 'Social attention and follower counts.' },
  { item: 'security_context', statement: 'Audits, bounties and advisories: evidence, never a verdict, and never a building input.' },
  { item: 'market_integrity', statement: 'Market Integrity readings about the token market.' },
] as const;

const STATUS_WORDS: Readonly<Record<string, string>> = {
  SHIPPING: 'Shipping: a meaningful, corroborated building event within HEY’s shipping window.',
  ACTIVE: 'Active: meaningful building events within HEY’s active window.',
  QUIET: 'Quiet: the newest meaningful building event is older than the active window, on a source HEY can read.',
  DORMANT: 'Dormant: nothing meaningful for longer than the quiet window, on a source HEY can read.',
  RESUMED: 'Resumed: building activity again after a long gap.',
  UNKNOWN: 'Unknown: HEY cannot say whether anyone is building.',
};

const FRESH_TO_BUCKET = (fact: HeyExplainedFact, now: Date): AgentClaim['freshness'] => {
  if (!fact.freshness || fact.freshness.state === 'unknown' || !fact.observedAt) return 'unknown';
  if (fact.freshness.state === 'stale') return 'stale';
  return ageBucket(Math.max(0, now.getTime() - Date.parse(fact.observedAt)));
};

function factEvidence(ctx: AgentComposeContext, fact: HeyExplainedFact, isEvidenceId: (id: string) => boolean): AgentEvidenceRef[] {
  return fact.evidence.filter((entry) => isEvidenceId(entry.id)).map((entry) => evidenceRef(ctx.baseUrl, entry.id));
}

function factClaim(ctx: AgentComposeContext, id: string, fact: HeyExplainedFact, explainUrl: string, isEvidenceId: (id: string) => boolean): AgentClaim {
  const value = Array.isArray(fact.value) ? fact.value.join(', ') : fact.value;
  return {
    id,
    dimension: 'build',
    statement: derivedText(fact.reason),
    status: fact.state,
    value: typeof value === 'string' ? value.slice(0, 200) : value,
    source: fact.state === 'UNKNOWN' ? null : { name: fact.source ?? 'hey', type: 'hey_rule' },
    observedAt: fact.observedAt,
    occurredAt: null,
    precision: null,
    freshness: FRESH_TO_BUCKET(fact, ctx.now),
    evidence: factEvidence(ctx, fact, isEvidenceId).slice(0, 12),
    explainUrl,
    ...(fact.state === 'UNKNOWN' ? { reason: fact.unknownInputs[0] ?? fact.classification.toLowerCase() } : {}),
  };
}

export function composeBuilderStatus(ctx: AgentComposeContext, input: BuilderStatusInput): AgentResponseOf<'builder_status'> {
  const isEvidenceId = input.isEvidenceId ?? looksLikeEvidenceId;
  const { activity, momentum, stillBuilding, project } = input;
  const api = `${ctx.baseUrl}/api/projects/${project.slug}/explain`;
  const status = String(activity.value ?? 'UNKNOWN');
  const version = activity.canonicalRule.version;
  const rests = activity.inputs.find((entry) => entry.name === 'statusRestsOnCurrentEvidence');
  const supportingEvidence = factEvidence(ctx, activity, isEvidenceId);
  const scoreFresh = familyFreshness('activity_score', { observedAt: activity.observedAt, now: ctx.now, staleAfterHours: activity.freshness?.staleAfterHours ?? 24 });
  // A status its evidence no longer supports is stale whatever its age: the engine says so, and the contract keeps it.
  const freshness = activity.freshness?.state === 'stale' && scoreFresh.freshnessStatus !== 'stale' ? { ...scoreFresh, freshnessStatus: 'stale' as const } : scoreFresh;

  const claims: AgentClaim[] = [
    factClaim(ctx, 'status.activity', activity, `${api}?fact=activity.status`, isEvidenceId),
    factClaim(ctx, 'status.build_momentum', momentum, `${api}?fact=build.momentum`, isEvidenceId),
    factClaim(ctx, 'status.still_building', stillBuilding, `${api}?fact=still_building`, isEvidenceId),
  ];

  const answer =
    activity.state === 'UNKNOWN'
      ? derivedText(`HEY cannot say whether ${project.slug} is building: ${activity.reason}`)
      : derivedText(`${project.slug}: ${status} under HEY's activity rule (${version}). ${activity.reason} This is a record of development, not a view on the token.`);

  return envelope(ctx, {
    capability: 'builder_status',
    status: 'ok',
    subject: { kind: 'project', project: { slug: project.slug, name: externalText(project.name, 'project_record'), url: project.url, ...(project.token ? { token: project.token } : {}) } },
    answer,
    answerStatus: activity.state,
    claims,
    unknowns: input.unknowns ?? [],
    freshness: [freshness],
    dataEvidence: supportingEvidence,
    data: {
      status,
      statusMeaning: heyText(STATUS_WORDS[status] ?? STATUS_WORDS.UNKNOWN!),
      state: activity.state,
      methodology: { ruleId: activity.canonicalRule.id, version, rule: heyText(activity.canonicalRule.text) },
      inputs: activity.inputs.slice(0, 24).map((entry) => ({
        name: entry.name,
        value: Array.isArray(entry.value) ? entry.value.slice(0, 50).map((item) => (typeof item === 'string' ? item.slice(0, 200) : item)) : typeof entry.value === 'string' ? entry.value.slice(0, 200) : entry.value,
        source: entry.source ?? null,
        observedAt: entry.observedAt ?? null,
      })),
      lineage: activity.lineage.slice(0, 8).map((step) => ({ step: step.step, text: derivedText(step.text) })),
      supportingEvidence,
      excludedContext: EXCLUDED_FROM_BUILDER_STATUS.map((entry) => ({ item: entry.item, statement: heyText(entry.statement) })),
      unknownInputs: activity.unknownInputs.slice(0, 20),
      statusRestsOnCurrentEvidence: activity.state === 'UNKNOWN' ? null : rests ? rests.value !== false : true,
      buildMomentum: { value: typeof momentum.value === 'number' ? momentum.value : null, state: momentum.state, classification: momentum.classification, explainUrl: `${api}?fact=build.momentum` },
      stillBuilding: {
        value: typeof stillBuilding.value === 'boolean' ? stillBuilding.value : null,
        state: stillBuilding.state,
        classification: stillBuilding.classification,
        meaning: heyText('Still Building: verified activity continuing through a market drawdown HEY tracked; a record of what happened, not a prediction and not a buy signal.'),
        explainUrl: `${api}?fact=still_building`,
      },
      reason: derivedText(activity.reason),
    },
    rules: [{ id: activity.canonicalRule.id, version }],
    page: project.url,
    canonical: [`${api}?fact=activity.status`, `${api}?fact=build.momentum`, `${api}?fact=still_building`],
    citationProject: project.slug,
    scoringVersion: version,
  });
}
