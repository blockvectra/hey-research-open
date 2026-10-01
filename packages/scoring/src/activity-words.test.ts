import { describe, expect, it } from 'vitest';

import { ACTIVITY_NOT_MEASURABLE, ACTIVITY_STATUS_WORDS, activityPresentation, activityStatusLabel, NO_BUILDER_SIGNAL, projectActivityWords, unknownActivityReason } from './activity-words';

describe('activity words: one table for the chip, the summary and the API (2026-10-01)', () => {
  it('says why an UNKNOWN is unknown from three facts', () => {
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: new Date() })).toBe('no_readable_source');
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: null })).toBe('no_builder_signal');
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: true })).toBeNull();
    // A caller that does not know keeps the plain word rather than guess.
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN' })).toBeNull();
    expect(unknownActivityReason({ activityStatus: 'SHIPPING', hasBuilderSource: false })).toBeNull();
  });

  it('maps each reason to its label and help', () => {
    expect(activityPresentation('UNKNOWN', 'no_readable_source')).toEqual(ACTIVITY_NOT_MEASURABLE);
    expect(activityPresentation('UNKNOWN', 'no_builder_signal')).toEqual(NO_BUILDER_SIGNAL);
    expect(activityPresentation('UNKNOWN', null)).toEqual(ACTIVITY_STATUS_WORDS.UNKNOWN);
    expect(activityPresentation('NOT_A_STATUS')).toEqual(ACTIVITY_STATUS_WORDS.UNKNOWN);
    expect(projectActivityWords({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: '2026-08-16' }).label).toBe('Activity not measurable');
  });

  it('keeps the plain status word for a status change, where the reason is not part of the claim', () => {
    expect(activityStatusLabel('RESUMED')).toBe('Resumed building');
    expect(activityStatusLabel('UNKNOWN')).toBe('Activity unknown');
  });

  it('never words a status as a verdict on the project', () => {
    const all = [...Object.values(ACTIVITY_STATUS_WORDS), NO_BUILDER_SIGNAL, ACTIVITY_NOT_MEASURABLE].map((words) => `${words.label} ${words.help}`).join(' ');
    // "Dormant … Not the same as abandoned." is the one place the word appears, to deny it.
    expect(all).not.toMatch(/\b(dead|rug|scam|buy|sell)\b/i);
  });
});
