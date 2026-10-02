import { describe, expect, it } from 'vitest';

import {
  collapseRepeatedEvidence,
  collapseSameWeekCodeActivity,
  deriveActivityStatus,
  meaningfulEvents,
  releaseRepositoryOf,
  type ScoredEvent,
} from './activity';
import { computeHbm } from './hbm';

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

  it('counts one prerelease per week, and never collapses a full release (hbm-v11)', () => {
    const pre = (days: number) => ship(days, { verificationStatus: 'SOURCE_LINKED', prerelease: true });
    // Days 33–36 ago are one ISO week: four nightlies are one update.
    const fourNightlies = derive([pre(33), pre(34), pre(35), pre(36)]);
    expect(fourNightlies.meaningfulEventCount).toBe(1);
    expect(fourNightlies.status).toBe('QUIET');
    // Prereleases in two weeks are two updates.
    expect(derive([pre(33), pre(40)]).meaningfulEventCount).toBe(2);
    // Full releases in one week each count, and a prerelease beside them still counts once.
    expect(derive([ship(33), ship(34), pre(35), pre(36)]).meaningfulEventCount).toBe(3);
  });

  describe('a release burst is one ship (hbm-v23)', () => {
    const at = (iso: string) => new Date(iso);
    const release = (repository: string | undefined, iso: string, overrides: Partial<ScoredEvent> = {}): ScoredEvent => ({
      eventType: 'GITHUB_RELEASE',
      verificationStatus: 'PUBLICLY_VERIFIED',
      publishedAt: at(iso),
      sourceKind: 'GITHUB',
      ...(repository === undefined ? {} : { repository }),
      ...overrides,
    });
    const burstNow = new Date('2026-10-03T12:00:00Z');
    const count = (events: ScoredEvent[]) => meaningfulEvents(events, burstNow).length;

    it('counts 27 releases of one repository on one UTC day once', () => {
      const burst = Array.from({ length: 27 }, (_, index) =>
        release('bambini-tech/digitaldon-public', `2026-10-01T09:00:${String(index * 2).padStart(2, '0')}Z`),
      );
      expect(count(burst)).toBe(1);
      expect(deriveActivityStatus({ events: burst, now: burstNow, hasSourceCoverage: true }).meaningfulEventCount).toBe(1);
      // Build Momentum reads the same events: a burst earns what one release earns.
      expect(computeHbm({ events: burst, now: burstNow }).hbm).toBe(computeHbm({ events: [burst.at(-1)!], now: burstNow }).hbm);
    });

    it('counts two repositories on one day as two, and one repository on two UTC days as two', () => {
      expect(count([release('kyber/dex-lib', '2026-10-01T10:00:00Z'), release('kyber/other', '2026-10-01T10:00:01Z')])).toBe(2);
      // 23:59 and 00:01 UTC are two days.
      expect(count([release('kyber/dex-lib', '2026-09-30T23:59:00Z'), release('kyber/dex-lib', '2026-10-01T00:01:00Z')])).toBe(2);
      // The key is case-folded, as the ship id is.
      expect(count([release('Kyber/Dex-Lib', '2026-10-01T10:00:00Z'), release('kyber/dex-lib', '2026-10-01T11:00:00Z')])).toBe(1);
    });

    it('never collapses a release whose repository is not known', () => {
      expect(count([release(undefined, '2026-10-01T10:00:00Z'), release(undefined, '2026-10-01T10:00:01Z')])).toBe(2);
      expect(count([release(undefined, '2026-10-01T10:00:00Z', { repository: null }), release('a/b', '2026-10-01T10:00:01Z')])).toBe(2);
      // Another event type on the same day is never part of a release day.
      expect(count([release('a/b', '2026-10-01T10:00:00Z', { eventType: 'FEATURE_RELEASE' }), release('a/b', '2026-10-01T10:00:01Z', { eventType: 'FEATURE_RELEASE' })])).toBe(2);
    });

    it('keeps the weekly prerelease rule unchanged beside it', () => {
      const pre = (iso: string) => release('a/b', iso, { verificationStatus: 'SOURCE_LINKED', prerelease: true });
      // Monday 28 September – Sunday 4 October 2026: two prereleases on two days are one week.
      expect(count([pre('2026-09-28T10:00:00Z'), pre('2026-09-30T10:00:00Z')])).toBe(1);
      // A full release and a prerelease of one repository on one day are one each.
      expect(count([release('a/b', '2026-10-01T10:00:00Z'), pre('2026-10-01T11:00:00Z')])).toBe(2);
    });

    it('keeps the newest corroborated release of the day', () => {
      const kept = meaningfulEvents(
        [
          release('a/b', '2026-10-01T08:00:00Z'),
          release('a/b', '2026-10-01T09:00:00Z', { verificationStatus: 'ADMIN_VERIFIED' }),
          // Newer, and not corroborated: never the one kept, and never what displaces it.
          release('a/b', '2026-10-01T10:00:00Z', { verificationStatus: 'SELF_REPORTED' }),
        ],
        burstNow,
      );
      expect(kept.map((event) => event.publishedAt.toISOString())).toEqual(['2026-10-01T09:00:00.000Z']);
    });

    it('keeps the hbm-v11 name working', () => {
      const events = [release('a/b', '2026-10-01T10:00:00Z'), release('a/b', '2026-10-01T09:00:00Z')];
      expect(collapseSameWeekCodeActivity(events)).toEqual(collapseRepeatedEvidence(events));
      expect(collapseSameWeekCodeActivity(events)).toHaveLength(1);
    });

    it('reads the repository from a GitHub release ship id', () => {
      expect(releaseRepositoryOf('GITHUB_RELEASE', 'github-release:Bambini-Tech/digitaldon-public:123')).toBe('bambini-tech/digitaldon-public');
      expect(releaseRepositoryOf('GITHUB_RELEASE', 'github-release:kyber/dex-lib:9')).toBe('kyber/dex-lib');
      expect(releaseRepositoryOf('GITHUB_RELEASE', 'rss:https://x')).toBeUndefined();
      expect(releaseRepositoryOf('GITHUB_RELEASE', 'github-release::9')).toBeUndefined();
      expect(releaseRepositoryOf('GITHUB_RELEASE', null)).toBeUndefined();
      expect(releaseRepositoryOf('FEATURE_RELEASE', 'github-release:a/b:1')).toBeUndefined();
    });
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

  describe('a week of documentation or maintenance only is not building (hbm-v16, founder ruling G1)', () => {
    const code = (days: number, codeSubstance?: string | null): ScoredEvent => ({
      eventType: 'CODE_ACTIVITY',
      verificationStatus: 'SOURCE_LINKED',
      publishedAt: daysAgo(days),
      sourceKind: 'GITHUB',
      ...(codeSubstance === undefined ? {} : { codeSubstance }),
    });

    it('a README-only week no longer makes a project SHIPPING', () => {
      // RED before hbm-v16: one human commit, even a README edit, read as "Shipped 1 day ago".
      const result = derive([code(1, 'LOW_INFORMATION'), ship(40)]);
      expect(result.status).toBe('QUIET');
      expect(result.lastMeaningfulShipAt).toEqual(daysAgo(40));
      expect(result.meaningfulEventCount).toBe(1);
    });

    it('with nothing else, a documentation-only week leaves the project DORMANT on coverage, UNKNOWN without', () => {
      expect(derive([code(1, 'LOW_INFORMATION')]).status).toBe('DORMANT');
      expect(derive([code(1, 'LOW_INFORMATION')], false).status).toBe('UNKNOWN');
    });

    it('a week HEY has not read yet counts as it always has', () => {
      expect(derive([code(1, 'UNKNOWN')]).status).toBe('SHIPPING');
      expect(derive([code(1, null)]).status).toBe('SHIPPING');
      expect(derive([code(1)]).status).toBe('SHIPPING');
    });

    it('a substantive week counts', () => {
      expect(derive([code(1, 'SUBSTANTIVE')]).status).toBe('SHIPPING');
    });

    it('a documentation-only week does not hide a substantive one in the same week from another repository', () => {
      const substantive = { ...code(3, 'SUBSTANTIVE') };
      const docsOnly = { ...code(2, 'LOW_INFORMATION') };
      const result = derive([docsOnly, substantive]);
      expect(result.status).toBe('SHIPPING');
      expect(result.lastMeaningfulShipAt).toEqual(daysAgo(3));
    });
  });
});
