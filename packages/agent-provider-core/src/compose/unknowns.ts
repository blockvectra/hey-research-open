import type { HeyProjectCoverage } from '@hey-research-lab/sdk';

import { familyFreshness, SNAPSHOT_SOURCE_FAMILY, type RefreshTier } from '../freshness';
import { AGENT_UNKNOWN_CATEGORIES, doNotConclude, type AgentUnknownCategory } from '../unknowns';
import type { AgentClaim, AgentFreshness, AgentResponseOf } from '../schema';
import { derivedText, externalText, heyText } from '../text';
import { countOf, WORD_THING } from '../words';
import { envelope, type AgentComposeContext } from './common';
import { coverageBuckets, projectUnknowns, type CanonicalGap, type GapFacts } from './gaps';

/**
 * unknowns (2026-09-30, readiness §5): what HEY does not know about one
 * project or token — the canonical coverage states and identity checks as
 * five categories, each with what an agent must not conclude from it — and
 * the dimensions HEY did measure, so an agent knows where it may rely on HEY
 * and where it must not.
 */
export type UnknownsInput =
  | {
      kind: 'project';
      project: { slug: string; name: string; url: string; token?: { chainId: number; address: string } };
      coverage: HeyProjectCoverage;
      gaps: readonly CanonicalGap[];
      facts: GapFacts;
      tier?: RefreshTier;
    }
  | { kind: 'contract'; chainId: number; address: string; scanUrl: string };

const zeroCounts = (): Record<AgentUnknownCategory, number> => Object.fromEntries(AGENT_UNKNOWN_CATEGORIES.map((category) => [category, 0])) as Record<AgentUnknownCategory, number>;

export function composeUnknowns(ctx: AgentComposeContext, input: UnknownsInput): AgentResponseOf<'unknowns'> {
  if (input.kind === 'contract') {
    const address = input.address.toLowerCase();
    const counts = zeroCounts();
    counts.UNKNOWN = 1;
    return envelope(ctx, {
      capability: 'unknowns',
      status: 'ok',
      subject: { kind: 'contract', contract: { chainId: input.chainId, address } },
      answer: derivedText(`HEY holds no published project for ${address}: who builds it, what shipped and every other dimension are unknown to HEY. That is not evidence against it.`),
      answerStatus: 'UNKNOWN',
      claims: [],
      unknowns: [{ category: 'UNKNOWN', dimension: 'contractAttribution', statement: heyText('HEY holds no published project for this contract, so it holds no research on it.'), doNotConclude: doNotConclude('UNKNOWN'), reason: 'no_published_project', detailUrl: input.scanUrl }],
      freshness: [],
      data: { counts, measured: [], notApplicable: [], withheld: [], coverageUrl: null },
      canonical: [`${ctx.baseUrl}/api/token/${input.chainId}/${address}`],
    });
  }

  const { project, coverage } = input;
  const api = `${ctx.baseUrl}/api/projects/${project.slug}`;
  const unknowns = projectUnknowns({ gaps: input.gaps, dimensions: coverage.dimensions, facts: input.facts, coverageUrl: `${api}/coverage`, explainUrl: (fact) => `${api}/explain?fact=${fact}` });
  const counts = zeroCounts();
  for (const unknown of unknowns) counts[unknown.category] += 1;
  const buckets = coverageBuckets(coverage.dimensions);
  const freshness: AgentFreshness[] = coverage.freshness.map((entry) =>
    familyFreshness(SNAPSHOT_SOURCE_FAMILY[entry.source], { observedAt: entry.observedAt ?? null, now: ctx.now, staleAfterHours: entry.staleAfterHours, ...(input.tier && (entry.source === 'code' || entry.source === 'market') ? { tier: input.tier } : {}) }),
  ) as AgentFreshness[];

  const claims: AgentClaim[] = [
    {
      id: 'coverage.measured',
      dimension: 'coverage',
      statement: derivedText(`HEY measured ${buckets.measured.length} of ${Object.keys(coverage.dimensions).length} coverage dimensions for ${project.slug}${buckets.measured.length > 0 ? `: ${buckets.measured.join(', ')}` : ''}. Figures there are measurements, zeros included.`),
      status: 'FACT',
      value: buckets.measured.length,
      source: { name: 'project coverage', type: 'hey_record' },
      observedAt: coverage.computedAt,
      occurredAt: null,
      precision: null,
      freshness: 'live',
      evidence: [],
      explainUrl: `${api}/coverage`,
      evidenceKind: 'coverage_state',
    },
  ];

  const summary = AGENT_UNKNOWN_CATEGORIES.filter((category) => counts[category] > 0).map((category) => `${counts[category]} ${category}`).join(', ');
  const answer =
    unknowns.length === 0
      ? derivedText(`HEY lists no gap for ${project.slug}: every applicable dimension is measured and current. Measured is not the same as complete; each figure keeps its own source and date.`)
      : derivedText(`HEY does not know ${countOf(unknowns.length, WORD_THING)} about ${project.slug} (${summary}). None of them is evidence for or against the project; each says what not to conclude.`);

  return envelope(ctx, {
    capability: 'unknowns',
    status: 'ok',
    subject: { kind: 'project', project: { slug: project.slug, name: externalText(project.name, 'project_record'), url: project.url, ...(project.token ? { token: project.token } : {}) } },
    answer,
    // The answer is a fact about HEY's own record: what it holds and what it does not.
    answerStatus: 'FACT',
    claims,
    unknowns,
    freshness,
    data: { counts, measured: buckets.measured, notApplicable: buckets.notApplicable, withheld: buckets.withheld, coverageUrl: `${api}/coverage` },
    page: project.url,
    canonical: [`${api}/coverage`, `${api}/snapshot`],
    citationProject: project.slug,
  });
}
