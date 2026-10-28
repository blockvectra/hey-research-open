import { describe, expect, it } from 'vitest';

import { ACTIVITY_NOT_MEASURABLE, ACTIVITY_STATUS_WORDS, activityPresentation, BUILDER_SOURCE_HELD, activityStatusLabel, NO_BUILDER_SIGNAL, projectActivityWords, unknownActivityReason } from './activity-words';

describe('activity words: one table for the chip, the summary and the API (2026-10-01)', () => {
  it('says why an UNKNOWN is unknown from three facts', () => {
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: new Date() })).toBe('no_readable_source');
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: null })).toBe('no_builder_signal');
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: true })).toBeNull();
    // A ship on record beside UNKNOWN is the scorer's no-coverage reading, whatever the flag says now (DATA-10).
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: true, lastMeaningfulShipAt: new Date() })).toBe('no_readable_source');
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', lastMeaningfulShipAt: new Date() })).toBeNull();
    // A caller that does not know keeps the plain word rather than guess.
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN' })).toBeNull();
    expect(unknownActivityReason({ activityStatus: 'SHIPPING', hasBuilderSource: false })).toBeNull();
  });

  it('maps each reason to its label and help', () => {
    expect(activityPresentation('UNKNOWN', 'no_readable_source')).toEqual(ACTIVITY_NOT_MEASURABLE);
    expect(activityPresentation('UNKNOWN', 'no_builder_signal')).toEqual(NO_BUILDER_SIGNAL);
    expect(activityPresentation('UNKNOWN', null)).toEqual(ACTIVITY_STATUS_WORDS.UNKNOWN);
    expect(activityPresentation('NOT_A_STATUS')).toEqual(ACTIVITY_STATUS_WORDS.UNKNOWN);
    expect(projectActivityWords({ activityStatus: 'UNKNOWN', hasBuilderSource: false, lastMeaningfulShipAt: '2026-08-16' }).label).toBe('Not measured — activity not measurable');
  });

  it('keeps the plain status word for a status change, where the reason is not part of the claim', () => {
    expect(activityStatusLabel('RESUMED')).toBe('Resumed building');
    expect(activityStatusLabel('UNKNOWN')).toBe('Not measured');
  });

  it('never words a status as a verdict on the project', () => {
    const all = [...Object.values(ACTIVITY_STATUS_WORDS), NO_BUILDER_SIGNAL, ACTIVITY_NOT_MEASURABLE].map((words) => `${words.label} ${words.help}`).join(' ');
    // "Dormant … Not the same as abandoned." is the one place the word appears, to deny it.
    expect(all).not.toMatch(/\b(dead|rug|scam|buy|sell)\b/i);
  });
});

/* A builder source held as context is held, not missing (persona audit PB-11, 2026-10-18). */
describe('held_as_context', () => {
  it('names a source HEY holds only as context, and never outranks a ship on record or a readable source', () => {
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false, heldBuilderSource: true })).toBe('held_as_context');
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false, heldBuilderSource: true, lastMeaningfulShipAt: new Date() })).toBe('no_readable_source');
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: true, heldBuilderSource: true })).toBeNull();
    expect(unknownActivityReason({ activityStatus: 'UNKNOWN', hasBuilderSource: false })).toBe('no_builder_signal');
    expect(activityPresentation('UNKNOWN', 'held_as_context')).toEqual(BUILDER_SOURCE_HELD);
    expect(`${BUILDER_SOURCE_HELD.label} ${BUILDER_SOURCE_HELD.help}`).not.toMatch(/\b(dead|rug|scam|buy|sell)\b/i);
  });
});
