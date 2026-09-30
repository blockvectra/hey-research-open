import type { HeyExplainedFact, HeyTokenLookup } from '@hey-research-lab/sdk';
import { describe, expect, it } from 'vitest';

import { HEY_OWN_TOKEN_DISCLOSURE, stillBuildingStateOf, stillBuildingStateOfClassification } from '../disclosures';
import { AGENT_EVIDENCE_KINDS } from '../evidence-kinds';
import { agentIntelligenceResponseSchema } from '../schema';
import { renderAgentResponseText } from '../adapters/text';
import { toA2aParts } from '../adapters/provider';
import type { AgentComposeContext } from './common';
import { composeBuilderStatus } from './status';
import { composeVerify } from './verify';

/**
 * Round 4 (2026-09-30): `evidenceKind` on every claim, `stillBuildingState`
 * beside `stillBuilding`, and the `$HEY` disclosure — all additive to v1.
 */
const NOW = new Date('2026-09-30T12:00:00.000Z');
const HEY = '0xcab100000000000000000000000000000000cb07';
const base: AgentComposeContext = { baseUrl: 'https://hey.test', chainId: 4663, chainName: 'Robinhood Chain', now: NOW, disclaimer: 'Research only.', selfUrl: 'https://hey.test/api/agent/builder_status?project=hey', query: { chainId: 4663 } };

const fact = (over: Partial<HeyExplainedFact>): HeyExplainedFact =>
  ({
    fact: 'activity.status',
    value: 'SHIPPING',
    state: 'DERIVED',
    classification: 'SHIPPING',
    canonicalRule: { id: 'activity.status', version: 'hbm-v19', text: 'From meaningful building events only.' },
    source: 'hey',
    observedAt: '2026-09-30T10:00:00.000Z',
    freshness: { state: 'fresh', staleAfterHours: 24 },
    inputs: [],
    lineage: [],
    evidence: [{ id: 'ship:2ac87a66-0000-0000-0000-000000000001' }],
    unknownInputs: [],
    reason: 'SHIPPING by the activity rule.',
    project: { slug: 'hey', name: 'HEY', url: 'https://hey.test/project/hey' },
    ...over,
  }) as unknown as HeyExplainedFact;

const status = (ctx: AgentComposeContext, still: Partial<HeyExplainedFact>) =>
  composeBuilderStatus(ctx, {
    project: { slug: 'hey', name: 'HEY', url: 'https://hey.test/project/hey', token: { chainId: 4663, address: HEY } },
    activity: fact({}),
    momentum: fact({ fact: 'build.momentum', value: 71, classification: 'MEASURED' }),
    stillBuilding: fact({ fact: 'still_building', value: false, classification: 'NOT_MET', evidence: [], ...still }),
  });

describe('evidenceKind', () => {
  it('every claim names its basis, and a rule output cites the explain engine’s own ids', () => {
    const answer = status(base, {});
    expect(agentIntelligenceResponseSchema.safeParse(answer).success).toBe(true);
    for (const claim of answer.claims) expect(AGENT_EVIDENCE_KINDS, claim.id).toContain(claim.evidenceKind);
    const activity = answer.claims.find((claim) => claim.id === 'status.activity')!;
    expect(activity.evidenceKind).toBe('rule_output');
    expect(activity.evidence.map((ref) => ref.id)).toEqual(['ship:2ac87a66-0000-0000-0000-000000000001']);
    // A rule output with no record behind it cites none, and says what it is.
    const still = answer.claims.find((claim) => claim.id === 'status.still_building')!;
    expect(still.evidence).toEqual([]);
    expect(still.evidenceKind).toBe('rule_output');
    expect(renderAgentResponseText(answer)).toContain('basis rule output');
  });

  it('a verdict rests on HEY’s registry, and no claim invents an id', () => {
    const lookup = { status: 'published', scanUrl: `https://hey.test/scan?address=${HEY}`, project: { slug: 'hey', name: 'HEY', url: 'https://hey.test/project/hey', asOf: NOW.toISOString(), tokenVerification: { status: 'VERIFIED', reason: 'site_names_contract' } } } as unknown as HeyTokenLookup;
    const answer = composeVerify(base, { chainId: 4663, address: HEY, token: lookup, contract: null });
    expect(answer.claims.find((claim) => claim.id === 'verify.verdict')?.evidenceKind).toBe('registry_record');
    expect(answer.claims.every((claim) => claim.evidence.every((ref) => /^[a-z]+:/.test(ref.id)))).toBe(true);
  });
});

describe('stillBuildingState', () => {
  it('reads the API’s own field first, then stillBuilding and its withheld reason', () => {
    // The API's own state, restated; the contract derives none of its own (h5's canonical field).
    expect(stillBuildingStateOf({ apiState: 'NOT_HELD' })).toBe('NOT_HELD');
    expect(stillBuildingStateOf({ apiState: 'HELD' })).toBe('HELD');
    expect(stillBuildingStateOf({ apiState: 'NOT_MEASURED' })).toBe('NOT_MEASURED');
    // Without it the state is not known, never guessed from stillBuilding.
    expect(stillBuildingStateOf({ apiState: 'nonsense' })).toBe('NOT_MEASURED');
    expect(stillBuildingStateOf({})).toBe('NOT_MEASURED');
    expect(stillBuildingStateOfClassification('STILL_BUILDING')).toBe('HELD');
    expect(stillBuildingStateOfClassification('NOT_MET')).toBe('NOT_HELD');
    expect(stillBuildingStateOfClassification('NOT_MEASURED')).toBe('NOT_MEASURED');
    expect(stillBuildingStateOfClassification('UNKNOWN')).toBe('NOT_MEASURED');
  });

  it('builder_status carries it beside stillBuilding, which keeps its v1 meaning', () => {
    expect(status(base, {}).data?.stillBuilding.stillBuildingState).toBe('NOT_HELD');
    expect(status(base, { value: null, state: 'UNKNOWN', classification: 'NOT_MEASURED' }).data?.stillBuilding.stillBuildingState).toBe('NOT_MEASURED');
  });
});

describe("HEY's own token", () => {
  it('an answer naming HEY’s own project or token carries the disclosure, on every transport', () => {
    const own = status({ ...base, own: { slugs: ['hey'], token: { chainId: 4663, address: HEY } } }, {});
    expect(own.disclosures).toEqual([{ code: 'hey_own_token', statement: { text: HEY_OWN_TOKEN_DISCLOSURE, contentOrigin: 'hey' }, projects: ['hey'] }]);
    expect(agentIntelligenceResponseSchema.safeParse(own).success).toBe(true);
    expect(renderAgentResponseText(own)).toContain(`Disclosure: ${HEY_OWN_TOKEN_DISCLOSURE}`);
    const a2a = toA2aParts(own);
    expect(a2a.parts[0].text).toContain(HEY_OWN_TOKEN_DISCLOSURE);
    expect(a2a.metadata.disclosures).toEqual([{ code: 'hey_own_token', statement: HEY_OWN_TOKEN_DISCLOSURE }]);
    // By its token alone (a project HEY has not resolved to a slug), too.
    const byToken = status({ ...base, own: { slugs: [], token: { chainId: 4663, address: HEY.toUpperCase().replace('0X', '0x') } } }, {});
    expect(byToken.disclosures?.[0]?.code).toBe('hey_own_token');
  });

  it('another project’s answer carries none, and nothing else in the answer changes', () => {
    const other = status({ ...base, own: { slugs: ['somebody-else'], token: { chainId: 4663, address: `0x${'b'.repeat(40)}` } } }, {});
    expect(other.disclosures).toBeUndefined();
    const own = status({ ...base, own: { slugs: ['hey'], token: null } }, {});
    const { disclosures: _disclosure, ...rest } = own;
    expect(rest).toEqual(status(base, {}));
  });
});
