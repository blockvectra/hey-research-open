import { describe, expect, it } from 'vitest';

import { buildNotReadWords, RESEARCH_LEVEL_WORDS, researchLevelWords, VERIFIED_BUILDER_SCOPE_WORDS, verifiedBuilderScopeWords } from './research-level-words';

/* Round 2 (2026-10-01): the badge's word and the build line's word come from one table. */
describe('research level words', () => {
  it('gives the badge one word per level, and an unknown level the lowest', () => {
    expect(researchLevelWords('VERIFIED_BUILDER').label).toBe('Verified Builder');
    expect(researchLevelWords('RESEARCHED').label).toBe('Researched');
    expect(researchLevelWords('INDEXED').label).toBe('Indexed');
    expect(researchLevelWords('SOMETHING_ELSE')).toEqual(RESEARCH_LEVEL_WORDS.INDEXED);
    expect(researchLevelWords(undefined)).toEqual(RESEARCH_LEVEL_WORDS.INDEXED);
  });

  it('never says "not researched" for a level that is researched', () => {
    for (const level of ['RESEARCHED', 'VERIFIED_BUILDER']) {
      const words = buildNotReadWords(level);
      expect(words.answer).toBe('Building not checked yet');
      expect(`${words.answer} ${words.text}`).not.toMatch(/not researched|indexed this record/i);
      expect(words.reason).toBe('building_not_read');
    }
    expect(buildNotReadWords('INDEXED')).toEqual({ answer: 'Not researched yet', text: 'HEY indexed this record and has not read its sources.', reason: 'indexed_only' });
  });
});

/* Outsider audit (2026-10-02): one line under the badge says what it verified, and that ownership is a separate check. */
describe('what the Verified Builder badge verified', () => {
  it('names the shipping evidence and the claim apart, and says nothing below the badge', () => {
    expect(verifiedBuilderScopeWords({ researchLevel: 'VERIFIED_BUILDER', isClaimed: false })).toBe(VERIFIED_BUILDER_SCOPE_WORDS.unclaimed);
    expect(verifiedBuilderScopeWords({ researchLevel: 'VERIFIED_BUILDER', isClaimed: true })).toBe(VERIFIED_BUILDER_SCOPE_WORDS.claimed);
    expect(VERIFIED_BUILDER_SCOPE_WORDS.unclaimed).toMatch(/not claimed yet/);
    for (const level of ['RESEARCHED', 'INDEXED', undefined]) expect(verifiedBuilderScopeWords({ researchLevel: level, isClaimed: true })).toBeUndefined();
  });
});
