import { describe, expect, it } from 'vitest';

import { CHANGE_TYPE_NOUNS, changeTypeNoun, countOf, inTheLastDays, noun, WORD_CHANGE, WORD_MEANINGFUL_BUILDING_EVENT, WORD_MEANINGFUL_EVENT, WORD_THING } from './words';

/**
 * Counted words in HEY's answer text (2026-09-30): a plural is spelled out,
 * never an "s" appended to a phrase. Production had printed "2 week of code
 * activitys", "12 lock.unlock_dues" and "in the last 1 days".
 */
describe('counted words', () => {
  it('uses the singular for exactly one and the plural for 0 and 2', () => {
    for (const word of [WORD_CHANGE, WORD_THING, WORD_MEANINGFUL_EVENT, WORD_MEANINGFUL_BUILDING_EVENT, ...Object.values(CHANGE_TYPE_NOUNS)]) {
      expect(countOf(0, word)).toBe(`0 ${word.other}`);
      expect(countOf(1, word)).toBe(`1 ${word.one}`);
      expect(countOf(2, word)).toBe(`2 ${word.other}`);
    }
  });

  it('pluralises the head of a phrase, never its tail', () => {
    expect(countOf(2, changeTypeNoun('build.code_activity'))).toBe('2 weeks of code activity');
    expect(countOf(1, changeTypeNoun('build.code_activity'))).toBe('1 week of code activity');
    expect(countOf(3, changeTypeNoun('build.resumed'))).toBe('3 resumptions after dormancy');
    expect(countOf(2, changeTypeNoun('build.dormant'))).toBe('2 moves to dormant');
    for (const word of Object.values(CHANGE_TYPE_NOUNS)) expect(word.other, word.one).not.toMatch(/(ys|ss|activitys)$/);
  });

  it('names a type it has no words for as that type\'s events, never "<type>s"', () => {
    expect(countOf(12, changeTypeNoun('future.kind'))).toBe('12 future.kind events');
    expect(countOf(1, changeTypeNoun('future.kind'))).toBe('1 future.kind event');
    expect(countOf(12, changeTypeNoun('lock.unlock_due'))).toBe('12 scheduled unlocks');
    expect(countOf(6, changeTypeNoun('lock.observed'))).toBe('6 locks observed');
  });

  it('says "the last day", never "the last 1 days"', () => {
    expect(inTheLastDays(1)).toBe('in the last day');
    expect(inTheLastDays(0)).toBe('in the last 0 days');
    expect(inTheLastDays(2)).toBe('in the last 2 days');
    expect(inTheLastDays(30)).toBe('in the last 30 days');
  });

  it('defaults the plural to an appended s only when none is given', () => {
    expect(noun('release')).toEqual({ one: 'release', other: 'releases' });
    expect(noun('week of code activity', 'weeks of code activity').other).toBe('weeks of code activity');
  });
});
