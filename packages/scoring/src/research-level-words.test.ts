import { describe, expect, it } from 'vitest';

import { buildNotReadWords, RESEARCH_LEVEL_WORDS, researchLevelWords } from './research-level-words';

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
