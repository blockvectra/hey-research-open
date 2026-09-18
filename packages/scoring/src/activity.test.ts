import { describe, expect, it } from 'vitest';

import { deriveActivityStatus, type ScoredEvent } from './activity';

const now = new Date('2026-09-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

const ship = (days: number, overrides: Partial<ScoredEvent> = {}): ScoredEvent => ({
  eventType: 'GITHUB_RELEASE',
  verificationStatus: 'PUBLICLY_VERIFIED',
  publishedAt: daysAgo(days),
  sourceKind: 'GITHUB',
  ...overrides,
});

const derive = (events: ScoredEvent[], hasSourceCoverage = true) =>
  deriveActivityStatus({ events, now, hasSourceCoverage });

describe('activity status', () => {
  it('is SHIPPING within 7 days of a meaningful update', () => {
    expect(derive([ship(2)]).status).toBe('SHIPPING');
  });

  it('is ACTIVE between 8 and 30 days', () => {
    expect(derive([ship(20)]).status).toBe('ACTIVE');
  });

  it('does not read one day of commits across several repositories as several updates', () => {
    const code = (days: number, hour: number): ScoredEvent => ({
      eventType: 'CODE_ACTIVITY',
      verificationStatus: 'SOURCE_LINKED',
      sourceKind: 'GITHUB',
      publishedAt: new Date(daysAgo(days).getTime() + hour * 60 * 60 * 1000),
    });
    // Forty days ago, three repositories each had a commit: one update, not three.
    const result = deriveActivityStatus({ events: [code(40, 1), code(40, 2), code(40, 3)], now, hasSourceCoverage: true });
    expect(result.status).toBe('QUIET');
    expect(result.meaningfulEventCount).toBe(1);
    // Two different weeks are two updates.
    expect(deriveActivityStatus({ events: [code(40, 1), code(35, 1)], now, hasSourceCoverage: true }).status).toBe('ACTIVE');
  });

  it('does not read one week of commits across several repositories as several updates (hbm-v8)', () => {
    const code = (days: number): ScoredEvent => ({
      eventType: 'CODE_ACTIVITY',
      verificationStatus: 'SOURCE_LINKED',
      sourceKind: 'GITHUB',
      publishedAt: daysAgo(days),
    });
    /*
     * Ingestion writes one summary per repository per ISO week, dated that
     * repository's last commit (2026-09-15): four repositories are four rows
     * on four different days. Days 33–36 ago are Thursday back to Monday of
     * one ISO week (`now` is Tuesday 1 September).
     */
    const oneRow = deriveActivityStatus({ events: [code(33)], now, hasSourceCoverage: true });
    const fourRows = deriveActivityStatus({ events: [code(33), code(34), code(35), code(36)], now, hasSourceCoverage: true });
    expect(fourRows).toEqual(oneRow);
    expect(fourRows.status).toBe('QUIET');
    expect(fourRows.meaningfulEventCount).toBe(1);
    // A second week of commits is a second update.
    expect(deriveActivityStatus({ events: [code(33), code(40)], now, hasSourceCoverage: true }).status).toBe('ACTIVE');
  });

  it('is ACTIVE on two meaningful updates inside 45 days', () => {
    expect(derive([ship(40), ship(44)]).status).toBe('ACTIVE');
  });

  it('is QUIET between 31 and 60 days', () => {
    expect(derive([ship(45)]).status).toBe('QUIET');
  });

  it('is DORMANT beyond 60 days when coverage exists', () => {
    expect(derive([ship(120)]).status).toBe('DORMANT');
  });

  /** Backlog M5 test 3. */
  it('is RESUMED when building restarts after a gap of 60 days or more', () => {
    const result = derive([ship(3), ship(120)]);

    expect(result.status).toBe('RESUMED');
    expect(result.reason).toContain('Resumed building');
  });

  it('is RESUMED when the comeback ships twice on the same day (hbm-v7)', () => {
    // Measured between the two newest events, a release plus a docs update on
    // the comeback day read as SHIPPING; the gap is to the last event before
    // the comeback cluster.
    const result = derive([ship(1), ship(1, { eventType: 'DOCS_UPDATE' }), ship(108)]);
    expect(result.status).toBe('RESUMED');
    expect(result.reason).toContain('107 days');
  });

  it('is UNKNOWN, not QUIET, when HEY has no source to observe (hbm-v7)', () => {
    // "No meaningful updates for 40 days" is a claim about having looked.
    const result = derive([ship(40)], false);
    expect(result.status).toBe('UNKNOWN');
    expect(result.lastMeaningfulShipAt).toEqual(daysAgo(40));
  });

  it('does not call a short pause a resumption', () => {
    expect(derive([ship(3), ship(30)]).status).toBe('SHIPPING');
  });

  it('is UNKNOWN when HEY has no source coverage', () => {
    expect(derive([], false).status).toBe('UNKNOWN');
  });

  it('never labels a project dead, rugged or abandoned', () => {
    const statuses = [derive([]), derive([ship(400)]), derive([], false)].map((r) => r.status);

    for (const banned of ['DEAD', 'RUGGED', 'ABANDONED']) {
      expect(statuses).not.toContain(banned);
    }
  });

  /** Backlog M5 test 2: trading activity must not create project activity. */
  it('ignores marketing entirely, so a loud project with no shipping is not Active', () => {
    const announcements = Array.from({ length: 20 }, (_, index) =>
      ship(index, { eventType: 'ANNOUNCEMENT' }),
    );

    const result = derive(announcements);
    expect(result.status).toBe('DORMANT');
    expect(result.meaningfulEventCount).toBe(0);
  });

  it('ignores self-reported claims when deriving status', () => {
    expect(derive([ship(1, { verificationStatus: 'SELF_REPORTED' })]).status).toBe('DORMANT');
  });

  it('ignores disputed and retracted evidence', () => {
    expect(derive([ship(1, { verificationStatus: 'DISPUTED' })]).status).toBe('DORMANT');
    expect(derive([ship(1, { verificationStatus: 'RETRACTED' })]).status).toBe('DORMANT');
  });

  it('reports the last meaningful ship alongside the status', () => {
    const result = derive([ship(2), ship(30)]);
    expect(result.lastMeaningfulShipAt?.toISOString()).toBe(daysAgo(2).toISOString());
  });

  it('is deterministic for identical input', () => {
    const events = [ship(2), ship(19)];
    expect(derive(events)).toEqual(derive(events));
  });
});

describe('a date the clock has not reached', () => {
  /*
   * An event dated 2030-01-01, scored on 2026-09-06, made a project SHIPPING
   * with the reason "Shipped today" — and would have held that status for four
   * years. The event keeps its row; a wrong date is a fact about the source.
   * It simply cannot be evidence of shipping.
   */
  const now = new Date('2026-09-06T12:00:00Z');
  const event = (publishedAt: Date) => ({
    eventType: 'FEATURE_RELEASE' as const,
    verificationStatus: 'PUBLICLY_VERIFIED' as const,
    sourceKind: 'GITHUB' as const,
    publishedAt,
  });

  it('is not evidence of shipping', () => {
    const result = deriveActivityStatus({
      events: [event(new Date('2030-01-01T00:00:00Z'))],
      now,
      hasSourceCoverage: true,
    });

    expect(result.status).not.toBe('SHIPPING');
    expect(result.meaningfulEventCount).toBe(0);
  });

  it('still allows a release stamped a few hours ahead in another timezone', () => {
    const result = deriveActivityStatus({
      events: [event(new Date(now.getTime() + 6 * 60 * 60 * 1000))],
      now,
      hasSourceCoverage: true,
    });

    expect(result.meaningfulEventCount).toBe(1);
  });
});
