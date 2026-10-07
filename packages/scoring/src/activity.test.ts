import { describe, expect, it } from 'vitest';

import {
  collapseRepeatedEvidence,
  collapseSameWeekCodeActivity,
  deriveActivityStatus,
  meaningfulEvents,
  releaseRepositoryOf,
  utcSecondIndex,
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

  describe('a deploy batch is one ship (hbm-v24, founder ruling 2026-10-03)', () => {
    const deploy = (iso: string, overrides: Partial<ScoredEvent> = {}): ScoredEvent => ({
      eventType: 'CONTRACT_DEPLOY_FOLLOWUP',
      verificationStatus: 'PUBLICLY_VERIFIED',
      publishedAt: new Date(iso),
      sourceKind: 'CONTRACT',
      ...overrides,
    });
    const batchNow = new Date('2026-10-03T12:00:00Z');
    const count = (events: ScoredEvent[]) => meaningfulEvents(events, batchNow).length;

    it('counts four follow-up deploys of one second once, in status and in Build Momentum', () => {
      // universal-high-income's shape in production: four contracts, one deployer, one second.
      const batch = ['2026-09-30T16:02:38Z', '2026-09-30T16:02:38Z', '2026-09-30T16:02:38Z', '2026-09-30T16:02:38Z'].map((iso) => deploy(iso));
      expect(count(batch)).toBe(1);
      expect(deriveActivityStatus({ events: batch, now: batchNow, hasSourceCoverage: true }).meaningfulEventCount).toBe(1);
      expect(computeHbm({ events: batch, now: batchNow }).hbm).toBe(computeHbm({ events: [batch[0]!], now: batchNow }).hbm);
      // A sub-second stamp is still its second.
      expect(count([deploy('2026-09-30T16:02:38.000Z'), deploy('2026-09-30T16:02:38.900Z')])).toBe(1);
    });

    it('no longer holds ACTIVE on one batch alone past 30 days', () => {
      // Two contracts in one second, 35 days back: two meaningful updates in 45 days before hbm-v24, one now.
      const at = new Date(batchNow.getTime() - 35 * DAY).toISOString();
      const result = deriveActivityStatus({ events: [deploy(at), deploy(at)], now: batchNow, hasSourceCoverage: true });
      expect(result.status).toBe('QUIET');
      expect(result.meaningfulEventCount).toBe(1);
      // Two deploys a second apart are two deployments, and still ACTIVE.
      const next = new Date(Date.parse(at) + 1000).toISOString();
      expect(deriveActivityStatus({ events: [deploy(at), deploy(next)], now: batchNow, hasSourceCoverage: true }).status).toBe('ACTIVE');
    });

    it('counts seconds apart, and never folds another event type into a batch', () => {
      // deepstate's 1 September run: 20:24:01, 20:24:03 and two at 20:24:04 are three seconds.
      expect(count([deploy('2026-09-01T20:24:01Z'), deploy('2026-09-01T20:24:03Z'), deploy('2026-09-01T20:24:04Z'), deploy('2026-09-01T20:24:04Z')])).toBe(3);
      // 16:02:38.999 and 16:02:39.000 are two seconds.
      expect(count([deploy('2026-09-30T16:02:38.999Z'), deploy('2026-09-30T16:02:39.000Z')])).toBe(2);
      // An upgrade, or a release, in the same second is its own ship.
      expect(count([deploy('2026-09-30T16:02:38Z'), deploy('2026-09-30T16:02:38Z', { eventType: 'CONTRACT_UPGRADE' })])).toBe(2);
      expect(count([deploy('2026-09-30T16:02:38Z', { eventType: 'CONTRACT_UPGRADE' }), deploy('2026-09-30T16:02:38Z', { eventType: 'CONTRACT_UPGRADE' })])).toBe(2);
      expect(count([deploy('2026-09-30T16:02:38Z'), deploy('2026-09-30T16:02:38Z', { eventType: 'GITHUB_RELEASE', sourceKind: 'GITHUB' })])).toBe(2);
    });

    it('keeps a corroborated deploy for the batch; an uncorroborated one never displaces it', () => {
      const kept = meaningfulEvents([deploy('2026-09-30T16:02:38Z'), deploy('2026-09-30T16:02:38.500Z', { verificationStatus: 'SELF_REPORTED' })], batchNow);
      expect(kept).toHaveLength(1);
      expect(kept[0]!.verificationStatus).toBe('PUBLICLY_VERIFIED');
      // A withdrawn or unapproved deploy is no part of the count either way.
      expect(count([deploy('2026-09-30T16:02:38Z', { moderationStatus: 'PENDING' })])).toBe(0);
    });

    it('keys on whole UTC seconds', () => {
      expect(utcSecondIndex(new Date('1970-01-01T00:00:01.999Z'))).toBe(1);
      expect(utcSecondIndex(new Date('2026-09-30T16:02:38.000Z'))).toBe(utcSecondIndex(new Date('2026-09-30T16:02:38.999Z')));
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
    // The source was read from before the gap began (hbm-v25).
    const result = derive([ship(3, { coveredFrom: daysAgo(200) }), ship(120)]);

    expect(result.status).toBe('RESUMED');
    expect(result.reason).toContain('Resumed building');
    expect(result.resumedWithheld).toBeUndefined();
  });

  it('is RESUMED when the comeback ships twice on the same day (hbm-v7)', () => {
    // Measured between the two newest events, a release plus a docs update on
    // the comeback day read as SHIPPING; the gap is to the last event before
    // the comeback cluster.
    const covered = daysAgo(200);
    const result = derive([ship(1, { coveredFrom: covered }), ship(1, { eventType: 'DOCS_UPDATE', coveredFrom: covered }), ship(108)]);
    expect(result.status).toBe('RESUMED');
    expect(result.reason).toContain('107 days');
  });

  describe('resumed only inside HEY coverage (hbm-v25, 2026-10-07)', () => {
    const code = (days: number, coveredFrom: Date | null | undefined): ScoredEvent => ({
      eventType: 'CODE_ACTIVITY',
      verificationStatus: 'SOURCE_LINKED',
      sourceKind: 'GITHUB',
      publishedAt: daysAgo(days),
      ...(coveredFrom === undefined ? {} : { coveredFrom }),
    });

    it('is not RESUMED when the comeback came from a source attached during the gap', () => {
      // agent-wormhole's shape: a deploy 61 days back, a repository attached 8 days ago, its first code read as a return.
      const events = [code(5, daysAgo(8)), ship(66, { eventType: 'CONTRACT_DEPLOY_FOLLOWUP', sourceKind: 'CONTRACT', coveredFrom: null })];
      const result = derive(events);
      expect(result.status).toBe('SHIPPING');
      expect(result.reason).toBe('Shipped 5 days ago.');
      expect(result.resumedWithheld).toBe('coverage_began_during_gap');
      expect(result.lastMeaningfulShipAt).toEqual(daysAgo(5));
      expect(result.meaningfulEventCount).toBe(2);
    });

    it('is still RESUMED for a genuine gap inside coverage', () => {
      const result = derive([code(5, daysAgo(300)), code(120, daysAgo(300))]);
      expect(result.status).toBe('RESUMED');
      expect(result.reason).toBe('Resumed building after 115 days without observed activity.');
      expect(result.resumedWithheld).toBeUndefined();
    });

    it('counts coverage that began on the day of the last update before the gap', () => {
      expect(derive([code(5, daysAgo(120)), code(120, daysAgo(300))]).status).toBe('RESUMED');
      expect(derive([code(5, daysAgo(119)), code(120, daysAgo(300))]).status).toBe('SHIPPING');
    });

    it('is not RESUMED when HEY cannot say when it began reading the comeback source', () => {
      for (const unknown of [null, undefined, new Date(Number.NaN)]) {
        const result = derive([code(5, unknown), code(120, daysAgo(300))]);
        expect(result.status).toBe('SHIPPING');
        expect(result.resumedWithheld).toBe('coverage_unknown');
      }
    });

    it('needs every ship of the comeback covered, before the weekly collapse', () => {
      // Two repositories in one ISO week (5 and 6 days back are Thursday and Wednesday of one week): the
      // collapse keeps one row, but the repository HEY began reading late still withholds the comeback.
      const old = daysAgo(300);
      const late = daysAgo(10);
      const both = derive([code(5, old), code(6, late), code(120, old)]);
      expect(both.status).toBe('SHIPPING');
      expect(both.resumedWithheld).toBe('coverage_began_during_gap');
      // Anywhere in the 14-day comeback window, not only the newest day.
      const spread = derive([code(2, old), ship(13, { coveredFrom: null }), code(120, old)]);
      expect(spread.resumedWithheld).toBe('coverage_unknown');
      // A source that began during the gap is named before an unknown one.
      expect(derive([code(2, null), code(9, late), code(120, old)]).resumedWithheld).toBe('coverage_began_during_gap');
    });

    it('falls through to ACTIVE when the withheld comeback is older than a week', () => {
      const result = derive([code(12, daysAgo(14)), code(100, daysAgo(300))]);
      expect(result.status).toBe('ACTIVE');
      expect(result.resumedWithheld).toBe('coverage_began_during_gap');
    });

    it('never looks at coverage when there is no comeback to judge', () => {
      expect(derive([code(5, null), code(20, null)]).resumedWithheld).toBeUndefined();
      expect(derive([code(40, null)]).resumedWithheld).toBeUndefined();
      expect(derive([code(5, null)]).status).toBe('SHIPPING');
    });

    it('ignores coverage of ships that do not count', () => {
      // A low-information code week is not building, so it is not part of the comeback either.
      const result = derive([code(5, daysAgo(300)), { ...code(4, null), codeSubstance: 'LOW_INFORMATION' }, code(120, daysAgo(300))]);
      expect(result.status).toBe('RESUMED');
    });
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
