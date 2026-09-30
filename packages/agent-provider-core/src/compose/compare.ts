import type { HeyCompare, HeyPeerContext } from '@hey-research-lab/sdk';

import { familyFreshness } from '../freshness';
import type { AgentClaim, AgentCompareProject, AgentResponseOf, AgentUnknown } from '../schema';
import { derivedText, externalText, heyText } from '../text';
import { doNotConclude } from '../unknowns';
import { envelope, type AgentComposeContext } from './common';

/**
 * compare_builders (2026-09-30): two to four projects' building records side
 * by side over HEY's 30-day windows, restated from `/api/compare` (the
 * figures each project page shows, with the same gates) and each project's
 * peer cohort (`peers-v1`).
 *
 * Builder metrics only. The comparison's market fields are left out here on
 * purpose and listed as excluded: a side-by-side of valuations is a question
 * for a market tool, not for HEY. There is no winner, no order but the one
 * the caller asked for, and no combined score; projects in different peer
 * cohorts are shown side by side and never placed against each other.
 */
export type CompareInput = {
  compare: HeyCompare;
  /** Each compared project's peer context, by slug; null when it could not be read. */
  peers: Readonly<Record<string, HeyPeerContext | null>>;
  /** When each project was last scored, by slug: the freshness of every figure here. */
  scoredAt: Readonly<Record<string, string | null>>;
};

export const EXCLUDED_FROM_COMPARISON = [
  { item: 'valuation', statement: 'Market cap and FDV: market context, never a builder comparison.' },
  { item: 'liquidity_and_volume', statement: 'Liquidity and volume.' },
  { item: 'market_attention', statement: 'Market attention and the Discovery Gap, which weigh building against a market.' },
  { item: 'expected_return', statement: 'Any view on which token would perform better. HEY compares records, not investments.' },
] as const;

export function composeCompare(ctx: AgentComposeContext, input: CompareInput): AgentResponseOf<'compare_builders'> {
  const rows = input.compare.projects.slice(0, 4);
  const projects: AgentCompareProject[] = rows.map((row) => {
    const peer = input.peers[row.slug] ?? null;
    const velocityMeasured = row.velocity !== undefined && row.velocity.state !== 'NOT_MEASURED';
    return {
      slug: row.slug,
      name: externalText(row.name, 'project_record'),
      url: row.url,
      activityStatus: row.activityStatus,
      lastMeaningfulShipAt: row.lastMeaningfulShipAt ?? null,
      meaningfulEvents30d: velocityMeasured ? (row.velocity?.current ?? null) : null,
      meaningfulEventsPrevious30d: velocityMeasured ? (row.velocity?.previous ?? null) : null,
      velocityState: row.velocity?.state ?? null,
      releaseCadence: row.cadence ? { state: row.cadence.state, medianIntervalDays: row.cadence.medianIntervalDays ?? null } : null,
      activeWeeks: row.consistency ? { weeks: row.consistency.activeWeeks, windowWeeks: row.consistency.windowWeeks } : null,
      buildMomentum: row.buildMomentum ?? null,
      verifiedBuilder: row.verifiedBuilder,
      sources: { verified: row.sources.verified, total: row.sources.total },
      peer: peer ? { rulesVersion: peer.rulesVersion, state: peer.state, cohort: peer.cohort?.key ?? null, reason: peer.reason } : null,
      explainUrl: `${ctx.baseUrl}/api/projects/${row.slug}/explain?fact=activity.status`,
    };
  });

  const cohorts = projects.map((project) => (project.peer?.state === 'COMPUTED' ? project.peer.cohort : undefined));
  const sameCohort = projects.length < 2 || cohorts.some((cohort) => !cohort) ? null : new Set(cohorts).size === 1;

  const claims: AgentClaim[] = projects.flatMap((project): AgentClaim[] => {
    const observedAt = input.scoredAt[project.slug] ?? null;
    const fresh = familyFreshness('activity_score', { observedAt, now: ctx.now }).freshnessStatus;
    const explainUrl = project.explainUrl;
    return [
      {
        id: `compare.${project.slug}.activity_status`,
        dimension: 'build',
        statement: derivedText(`${project.slug}: activity status ${project.activityStatus}.`),
        status: project.activityStatus === 'UNKNOWN' ? 'UNKNOWN' : 'DERIVED',
        value: project.activityStatus,
        source: { name: 'hey', type: 'hey_rule' },
        observedAt,
        occurredAt: null,
        precision: null,
        freshness: fresh,
        evidence: [],
        explainUrl,
      },
      project.meaningfulEvents30d === null
        ? { id: `compare.${project.slug}.meaningful_events_30d`, dimension: 'build', statement: derivedText(`${project.slug}: meaningful events in 30 days are not measured.`), status: 'UNKNOWN', value: null, source: null, observedAt, occurredAt: null, precision: 'WINDOW', freshness: fresh, evidence: [], explainUrl, reason: 'activity_not_measured' }
        : {
            id: `compare.${project.slug}.meaningful_events_30d`,
            dimension: 'build',
            statement: derivedText(`${project.slug}: ${project.meaningfulEvents30d} meaningful event${project.meaningfulEvents30d === 1 ? '' : 's'} in the last 30 days${project.meaningfulEventsPrevious30d === null ? '' : `, ${project.meaningfulEventsPrevious30d} in the 30 before`}.`),
            status: 'DERIVED',
            value: project.meaningfulEvents30d,
            source: { name: 'hey', type: 'hey_rule' },
            observedAt,
            occurredAt: null,
            precision: 'WINDOW',
            freshness: fresh,
            evidence: [],
            explainUrl,
          },
      project.lastMeaningfulShipAt
        ? { id: `compare.${project.slug}.last_meaningful_ship`, dimension: 'build', statement: derivedText(`${project.slug}: newest meaningful ship dated ${project.lastMeaningfulShipAt.slice(0, 10)}.`), status: 'FACT', value: project.lastMeaningfulShipAt, source: { name: 'builder sources', type: 'builder_source' }, observedAt, occurredAt: project.lastMeaningfulShipAt, precision: null, freshness: fresh, evidence: [], explainUrl }
        : { id: `compare.${project.slug}.last_meaningful_ship`, dimension: 'build', statement: derivedText(`${project.slug}: no meaningful ship recorded, or building not measured.`), status: 'UNKNOWN', value: null, source: null, observedAt, occurredAt: null, precision: null, freshness: fresh, evidence: [], explainUrl, reason: 'no_meaningful_ship_recorded' },
    ];
  });

  const unknowns: AgentUnknown[] = [
    ...projects.filter((project) => project.meaningfulEvents30d === null).map((project) => ({ category: 'NOT_MEASURED' as const, dimension: `meaningfulEvents30d:${project.slug}`, statement: derivedText(`HEY does not measure ${project.slug}'s building events over 30 days.`), doNotConclude: doNotConclude('NOT_MEASURED'), reason: 'activity_not_measured', detailUrl: project.explainUrl })),
    ...input.compare.missing.slice(0, 4).map((slug) => ({ category: 'UNKNOWN' as const, dimension: `project:${slug.replace(/[^a-z0-9-]/g, '').slice(0, 80) || 'unknown'}`, statement: derivedText(`HEY holds no published project "${slug.slice(0, 80)}".`), doNotConclude: doNotConclude('UNKNOWN'), reason: 'not_found' })),
  ];

  const oldest = Object.values(input.scoredAt).filter((at): at is string => Boolean(at)).sort()[0] ?? null;
  const lines = projects.map((project) => `${project.slug} ${project.activityStatus}${project.meaningfulEvents30d === null ? ', events not measured' : `, ${project.meaningfulEvents30d} meaningful events in 30 days`}`);
  const answer = projects.length === 0 ? heyText('HEY found none of these projects published, so there is nothing to compare.') : derivedText(`Side by side over 30 days: ${lines.join('; ')}. No winner: HEY compares building records, not investments.`);

  return envelope(ctx, {
    capability: 'compare_builders',
    status: 'ok',
    subject: { kind: 'projects', projects: projects.map((project) => ({ slug: project.slug, name: project.name, url: project.url })) },
    answer,
    answerStatus: projects.length === 0 ? 'UNKNOWN' : 'DERIVED',
    claims,
    unknowns,
    freshness: projects.length > 0 ? [familyFreshness('activity_score', { observedAt: oldest, now: ctx.now })] : [],
    data: {
      windowDays: 30,
      projects,
      missing: input.compare.missing.slice(0, 8).map((slug) => slug.slice(0, 120)),
      ignored: input.compare.ignoredSlugs.slice(0, 8).map((slug) => slug.slice(0, 120)),
      sameCohort,
      order: 'as_requested',
      method: heyText('The figures each project page shows, side by side, with the same gates: builder metrics only. No winner, no ranking, no combined score. Projects in different peer cohorts are shown side by side and never placed against each other (peers-v1).'),
      excludedContext: EXCLUDED_FROM_COMPARISON.map((entry) => ({ item: entry.item, statement: heyText(entry.statement) })),
    },
    rules: [{ id: 'peers', version: projects.find((project) => project.peer)?.peer?.rulesVersion ?? 'peers-v1' }],
    canonical: [`${ctx.baseUrl}/api/compare?slugs=${projects.map((project) => project.slug).join(',')}`],
  });
}
