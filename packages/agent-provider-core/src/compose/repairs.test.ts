import type { HeyExplainedFact, HeyTokenLookup } from '@hey-research-lab/sdk';
import { describe, expect, it } from 'vitest';

import { agentIntelligenceResponseSchema } from '../schema';
import { changeTypeNoun, countOf } from '../words';
import { composeWhatChanged } from './changes';
import type { AgentComposeContext } from './common';
import { composeBuilderStatus } from './status';
import { composeVerify } from './verify';

/**
 * Contract repairs the agent benchmark found against production
 * (2026-09-30, `docs/robinhood-agent-app/07_RELIABILITY.md`). Each is
 * additive: no field changes meaning.
 */
const NOW = new Date('2026-09-30T12:00:00.000Z');
const ctx: AgentComposeContext = { baseUrl: 'https://hey.test', chainId: 4663, chainName: 'Robinhood Chain', now: NOW, disclaimer: 'Research only.', selfUrl: 'https://hey.test/api/agent/verify_project?address=0x1', query: { chainId: 4663 } };

describe('contract repairs the benchmark found (2026-09-30)', () => {
  it('a CONTRACT_MISMATCH on the tracked token says why in its answer', () => {
    // Production answered "CONTRACT_MISMATCH: HEY records this contract as the project’s tracked token." for AgentOS — the first reason only, which reads like a match.
    const lookup = {
      status: 'published',
      scanUrl: 'https://hey.test/scan?address=0xa0000000000000000000000000000000000000a1',
      project: { slug: 'agentos', name: 'AgentOS', url: 'https://hey.test/project/agentos', asOf: NOW.toISOString(), tokenVerification: { status: 'MISMATCH', reason: 'site_names_another_contract' } },
    } as unknown as HeyTokenLookup;
    const answer = composeVerify(ctx, { chainId: 4663, address: '0xa0000000000000000000000000000000000000a1', token: lookup, contract: null });
    expect(answer.data?.verdict).toBe('CONTRACT_MISMATCH');
    expect(answer.answer.text).toMatch(/^CONTRACT_MISMATCH: /);
    expect(answer.answer.text).toContain('The project’s own website names a different contract than this one.');
    expect(agentIntelligenceResponseSchema.safeParse(answer).success).toBe(true);
  });

  it('a change type is counted in words, never as its code pluralised', () => {
    // Production answered "(817 market.liquidity_moveds, …, 2 week of code activitys …)".
    const answer = composeWhatChanged(ctx, {
      scope: 'chain',
      window: { days: 7, from: '2026-09-23T12:00:00.000Z', to: NOW.toISOString() },
      types: null,
      items: [],
      total: 7,
      byType: [
        { type: 'market.liquidity_moved', count: 4 },
        { type: 'build.code_activity', count: 2 },
        { type: 'build.release', count: 1 },
      ],
      ledger: { projectorRanAt: NOW.toISOString(), newestRecordedAt: NOW.toISOString(), collectionStart: '2026-09-26T00:00:00.000Z' },
      moreUrl: 'https://hey.test/api/changes',
    });
    // One word list for every count, `words.ts` (2026-09-30): the types HEY names read as words, never a code with an s.
    expect(answer.answer.text).toContain('4 liquidity moves, 2 weeks of code activity, 1 release');
    expect(answer.answer.text).not.toMatch(/moveds|activitys/);
    expect(answer.claims.map((claim) => claim.statement.text)).toContain('2 weeks of code activity in the 7-day window (build.code_activity).');
    expect(countOf(3, changeTypeNoun('build.resumed'))).toBe('3 resumptions after dormancy');
    expect(countOf(1, changeTypeNoun('research.source_added'))).toBe('1 source added');
    // A type with no words yet reads "<type> event(s)", never the code pluralised.
    expect(countOf(2, changeTypeNoun('future.kind'))).toBe('2 future.kind events');
  });

  it('builder_status states when HEY last read the builder sources, beside the score', () => {
    const fact = (value: unknown) =>
      ({ fact: 'activity.status', value, state: 'DERIVED', classification: 'MEASURED', reason: 'Shipped today.', observedAt: '2026-09-30T09:00:00.000Z', freshness: { state: 'fresh', staleAfterHours: 24 }, canonicalRule: { id: 'activity.status', version: 'hbm-v19', text: 'rule' }, inputs: [], lineage: [], evidence: [], unknownInputs: [] }) as unknown as HeyExplainedFact;
    const project = { slug: 'agentos', name: 'AgentOS', url: 'https://hey.test/project/agentos' };
    const answer = composeBuilderStatus(ctx, { project, activity: fact('SHIPPING'), momentum: fact(80), stillBuilding: fact(false), builderSources: { observedAt: '2026-09-26T12:00:00.000Z', staleAfterHours: 72, tier: 'HOT' } });
    const sources = answer.freshness.find((entry) => entry.family === 'builder_sources');
    expect(sources?.freshnessStatus).toBe('stale');
    expect(sources?.observedAt).toBe('2026-09-26T12:00:00.000Z');
    expect(sources?.nextExpectedRefreshReason).toBe('overdue');
    expect(agentIntelligenceResponseSchema.safeParse(answer).success).toBe(true);
    // Without it, the answer is what it was: the score's freshness alone.
    expect(composeBuilderStatus(ctx, { project, activity: fact('SHIPPING'), momentum: fact(80), stillBuilding: fact(false) }).freshness.map((entry) => entry.family)).toEqual(['activity_score']);
  });
});
