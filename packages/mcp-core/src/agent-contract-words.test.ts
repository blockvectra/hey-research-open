import { describe, expect, it } from 'vitest';

import {
  agentIntelligenceResponseSchema,
  CHANGE_TYPE_NOUNS,
  changeTypeNoun,
  composeCompare,
  composeResearch,
  composeUnknowns,
  composeWhatChanged,
  countOf,
  WORD_CHANGE,
  WORD_MEANINGFUL_BUILDING_EVENT,
  WORD_MEANINGFUL_EVENT,
  WORD_THING,
  type AgentComposeContext,
  type AgentIntelligenceResponse,
  type CountNoun,
} from '@hey/agent-provider-core';
import type { HeyCompare, HeyProjectSnapshot } from '@hey-research-lab/sdk';

import * as fx from './fixtures/api';

/**
 * Every counted template in the agent contract's HEY-authored text, swept
 * with counts 0, 1 and 2 (2026-09-30). Production had answered "2 week of
 * code activitys", "12 lock.unlock_dues" and "in the last 1 days". Each
 * answer, claim and unknown sentence is read for a number followed by one of
 * the counted nouns, and the noun must agree with the number; the same input
 * must give the same words twice.
 */
const NOW = new Date('2026-09-26T12:00:00.000Z');
const BASE = 'https://hey.test';
const ctx = (selfUrl: string): AgentComposeContext => ({ baseUrl: BASE, chainId: 4663, chainName: 'Robinhood Chain', now: NOW, disclaimer: fx.snapshot.disclaimer, selfUrl, query: { chainId: 4663 } });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const COUNTS = [0, 1, 2] as const;
const project = { slug: 'agentos', name: 'AgentOS', url: `${BASE}/project/agentos` };
const ledger = { projectorRanAt: '2026-09-26T11:58:00.000Z', newestRecordedAt: '2026-09-26T11:58:00.000Z', collectionStart: '2026-09-01T00:00:00.000Z' };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOUNS: CountNoun[] = [WORD_CHANGE, WORD_THING, WORD_MEANINGFUL_BUILDING_EVENT, WORD_MEANINGFUL_EVENT, ...Object.values(CHANGE_TYPE_NOUNS), changeTypeNoun('future.kind')];

/** Every HEY-authored sentence in an answer: the answer, claims and unknowns. */
function sentences(response: AgentIntelligenceResponse): string[] {
  return [response.answer, ...response.claims.map((claim) => claim.statement), ...response.unknowns.map((unknown) => unknown.statement)].filter((text) => text.contentOrigin !== 'external_source').map((text) => text.text);
}

/** Each "<number> <counted noun>" whose noun does not agree with its number, and the known bad forms. */
function disagreements(text: string): string[] {
  const found: string[] = [];
  for (const word of NOUNS) {
    const pattern = new RegExp(`(?<![\\w.])(\\d+) (${escape(word.other)}|${escape(word.one)})(?![\\w-])`, 'g');
    for (const match of text.matchAll(pattern)) {
      const n = Number(match[1]);
      const singular = match[2] === word.one && word.one !== word.other;
      if ((n === 1) !== singular) found.push(`${match[0]} in: ${text}`);
    }
  }
  // "activitys", "the last 1 days", and a change type made plural by an appended s ("lock.unlock_dues").
  for (const bad of [/activitys/, /\b1 days\b/, /(?<![\w/.])[a-z]+\.[a-z_]+s\b/]) {
    if (bad.test(text)) found.push(`${bad} in: ${text}`);
  }
  return found;
}

function check(response: AgentIntelligenceResponse): void {
  expect(agentIntelligenceResponseSchema.safeParse(response).success).toBe(true);
  expect(sentences(response).flatMap(disagreements)).toEqual([]);
}

describe('counted words in the agent contract, swept with 0, 1 and 2', () => {
  it('what_changed: every change type, the fallback type and the window, in agreement', () => {
    const types = [...Object.keys(CHANGE_TYPE_NOUNS), 'future.kind'];
    for (const days of [1, 7]) {
      for (const type of types) {
        for (const count of COUNTS) {
          const input = { scope: 'project' as const, project, window: { days, from: '2026-09-19T12:00:00.000Z', to: NOW.toISOString() }, types: null, items: [], total: count, byType: count === 0 ? [] : [{ type, count }], ledger, moreUrl: `${BASE}/api/changes?project=agentos` };
          const response = composeWhatChanged(ctx(`${BASE}/api/agent/what_changed?project=agentos&days=${days}`), input);
          check(response);
          const when = days === 1 ? 'in the last day' : `in the last ${days} days`;
          expect(response.answer.text).toContain(when);
          if (count > 0) expect(response.answer.text).toContain(`${countOf(count, WORD_CHANGE)} recorded for agentos ${when} (${countOf(count, changeTypeNoun(type))})`);
          // Deterministic: the same input, the same words.
          expect(composeWhatChanged(ctx(`${BASE}/api/agent/what_changed?project=agentos&days=${days}`), input).answer).toEqual(response.answer);
        }
      }
    }
  });

  it('what_changed: the answers production got wrong now read right', () => {
    const answer = (days: number, byType: { type: string; count: number }[], total: number) =>
      composeWhatChanged(ctx(`${BASE}/api/agent/what_changed?days=${days}`), { scope: 'chain', window: { days, from: '2026-09-25T12:00:00.000Z', to: NOW.toISOString() }, types: null, items: [], total, byType, ledger, moreUrl: `${BASE}/api/changes` }).answer.text;
    expect(answer(7, [{ type: 'build.code_activity', count: 2 }, { type: 'build.status_changed', count: 1 }], 3)).toBe('3 changes recorded for Robinhood Chain projects in the last 7 days (2 weeks of code activity, 1 activity status change); showing the newest 0.');
    expect(answer(1, [{ type: 'build.release', count: 10 }], 10)).toBe('10 changes recorded for Robinhood Chain projects in the last day (10 releases); showing the newest 0.');
    expect(answer(7, [{ type: 'lock.unlock_due', count: 12 }, { type: 'market_integrity.event', count: 12 }, { type: 'lock.observed', count: 6 }, { type: 'lock.withdrawn', count: 3 }, { type: 'research.source_added', count: 2 }], 35)).toBe('35 changes recorded for Robinhood Chain projects in the last 7 days (12 scheduled unlocks, 12 market-integrity events, 6 locks observed, 3 lock withdrawals, …); showing the newest 0.');
    expect(answer(7, [{ type: 'future.kind', count: 2 }], 2)).toContain('(2 future.kind events)');
    expect(answer(1, [], 0)).toMatch(/^HEY’s ledger recorded no change for Robinhood Chain projects in the last day\./);
  });

  it('research_project: meaningful events and the unknowns count', () => {
    const gapsOf = (n: number) => Array.from({ length: n }, (_, index) => ({ dimension: ['package', 'apiDocs'][index % 2]!, state: 'NO_SOURCE' as const, sentence: 'No source HEY found for it.', reason: 'none_found' }));
    for (const events of COUNTS) {
      for (const gaps of COUNTS) {
        const snapshot = clone(fx.snapshot) as HeyProjectSnapshot;
        snapshot.evidenceSummary.meaningfulEvents30d = events;
        const response = composeResearch(ctx(`${BASE}/api/agent/research_project?project=agentos`), { snapshot, gaps: gapsOf(gaps), tier: 'HOT' });
        check(response);
        expect(response.answer.text).toContain(`${countOf(events, WORD_MEANINGFUL_EVENT)} in 30 days`);
        expect(response.answer.text).toContain(`HEY lists ${countOf(response.unknowns.length, WORD_THING)} it does not know`);
        expect(response.claims.find((claim) => claim.id === 'build.meaningful_events_30d')?.statement.text).toBe(`${countOf(events, WORD_MEANINGFUL_BUILDING_EVENT)} in the last 30 days.`);
      }
    }
  });

  it('compare_builders: each project\'s meaningful events', () => {
    for (const events of COUNTS) {
      const compare = clone(fx.compare) as HeyCompare;
      compare.projects = compare.projects.map((row) => ({ ...row, velocity: { state: 'STEADY', current: events, previous: events } })) as HeyCompare['projects'];
      const response = composeCompare(ctx(`${BASE}/api/agent/compare_builders?projects=agentos,quiet-token`), { compare, peers: {}, scoredAt: {} });
      check(response);
      expect(response.answer.text).toContain(`agentos SHIPPING, ${countOf(events, WORD_MEANINGFUL_EVENT)} in 30 days`);
    }
  });

  it('unknowns: the count of things HEY does not know', () => {
    const facts = { activityStatus: 'SHIPPING', tokenVerification: { status: 'VERIFIED' as const }, ownerVerified: true, buildMomentum: 71, usage: null, ledger: { available: true } };
    const seen = new Set<number>();
    for (const gaps of [0, 1, 2, 3]) {
      const gapList = Array.from({ length: gaps }, (_, index) => ({ dimension: ['package', 'apiDocs', 'repositories'][index]!, state: 'NO_SOURCE' as const, sentence: 'No source HEY found for it.', reason: 'none_found' }));
      const response = composeUnknowns(ctx(`${BASE}/api/agent/unknowns?project=agentos`), { kind: 'project', project, coverage: fx.coverage, gaps: gapList, facts });
      check(response);
      seen.add(response.unknowns.length);
      if (response.unknowns.length > 0) expect(response.answer.text).toContain(`HEY does not know ${countOf(response.unknowns.length, WORD_THING)} about agentos`);
    }
    // The sweep reached one and more than one.
    expect([...seen].some((n) => n === 1) || [...seen].some((n) => n >= 2)).toBe(true);
  });
});
