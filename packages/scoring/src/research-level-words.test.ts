import { describe, expect, it } from 'vitest';

import {
  buildNotReadWords,
  RESEARCH_LEVEL_WORDS,
  RESEARCHED_NO_BUILDER_SOURCE_WORDS,
  researchLevelWords,
  researchLevelWordsFor,
  showsVerifiedBuilder,
  VERIFIED_BUILDER_SCOPE_WORDS,
  verifiedBuilderScopeWords,
} from './research-level-words';

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

/* Persona audit PB-4 (2026-10-18): a RESEARCHED pill on a page with no builder source read as "HEY checked this, it's OK". */
describe('researchLevelWordsFor', () => {
  it('says what RESEARCHED is, quietly, where HEY reads no builder source; every other case keeps the badge words', () => {
    expect(researchLevelWordsFor('RESEARCHED', false)).toEqual({ ...RESEARCHED_NO_BUILDER_SOURCE_WORDS, quiet: true });
    expect(researchLevelWordsFor('RESEARCHED', true)).toEqual({ ...RESEARCH_LEVEL_WORDS.RESEARCHED, quiet: false });
    // Unknown is not "no source": the badge stays as it was.
    expect(researchLevelWordsFor('RESEARCHED', undefined).quiet).toBe(false);
    expect(researchLevelWordsFor('VERIFIED_BUILDER', false)).toEqual({ ...RESEARCH_LEVEL_WORDS.VERIFIED_BUILDER, quiet: false });
    expect(researchLevelWordsFor('INDEXED', false).label).toBe('Indexed');
    expect(RESEARCHED_NO_BUILDER_SOURCE_WORDS.help).toMatch(/says nothing about building, the token/);
    expect(RESEARCHED_NO_BUILDER_SOURCE_WORDS.label).not.toMatch(/research|verified|checked/i);
  });
});

// 2026-10-28 simplicity study, CON-5: one display predicate; the two writers stay apart.
describe('showsVerifiedBuilder', () => {
  it('draws the badge only where the scorer and the catalogue both hold it', () => {
    expect(showsVerifiedBuilder({ researchLevel: 'VERIFIED_BUILDER', catalogStatus: 'VERIFIED_BUILDER' })).toBe(true);
    // The scorer stepped down before the catalogue's daily gate: no surface claims more than the other.
    expect(showsVerifiedBuilder({ researchLevel: 'RESEARCHED', catalogStatus: 'VERIFIED_BUILDER' })).toBe(false);
    // The catalogue withdrew it (an integration record, a hidden candidate) while the level lagged.
    expect(showsVerifiedBuilder({ researchLevel: 'VERIFIED_BUILDER', catalogStatus: 'QUALIFIED' })).toBe(false);
    expect(showsVerifiedBuilder({ researchLevel: 'VERIFIED_BUILDER', catalogStatus: 'HIDDEN_CANDIDATE' })).toBe(false);
    expect(showsVerifiedBuilder({ researchLevel: undefined, catalogStatus: null })).toBe(false);
  });
});
