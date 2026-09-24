import { describe, expect, it } from 'vitest';

import type { ScoredEvent } from './activity';
import {
  builderConsistency,
  buildVelocity,
  discoveryLag,
  marketAttention,
  releaseCadence,
  type LagEvent,
} from './intelligence';

const now = new Date('2026-09-24T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const longAgo = ago(400);

const ship = (days: number, eventType: ScoredEvent['eventType'] = 'FEATURE_RELEASE', over: Partial<ScoredEvent> = {}): ScoredEvent => ({
  eventType,
  verificationStatus: 'PUBLICLY_VERIFIED',
  publishedAt: ago(days),
  sourceKind: 'GITHUB',
  moderationStatus: 'APPROVED',
  ...over,
});

describe('buildVelocity', () => {
  it('compares the last thirty days with the thirty before', () => {
    const events = [ship(1), ship(3), ship(5), ship(8), ship(12), ship(40), ship(45)];
    expect(buildVelocity(events, now, longAgo)).toEqual({ windowDays: 30, current: 5, previous: 2, changePct: 150, state: 'ACCELERATING' });
    const slowing = [ship(2), ship(35), ship(38), ship(41), ship(44), ship(50)];
    expect(buildVelocity(slowing, now, longAgo)).toMatchObject({ current: 1, previous: 5, changePct: -80, state: 'SLOWING' });
  });

  it('does not call one extra event a trend', () => {
    // 1 → 2 is +100%, and still nothing.
    expect(buildVelocity([ship(2), ship(9), ship(40)], now, longAgo)).toMatchObject({ changePct: 100, state: 'STABLE' });
  });

  it('never divides by zero', () => {
    expect(buildVelocity([ship(2), ship(4)], now, longAgo)).toEqual({ windowDays: 30, current: 2, previous: 0, changePct: null, state: 'ACCELERATING' });
    expect(buildVelocity([], now, longAgo)).toEqual({ windowDays: 30, current: 0, previous: 0, changePct: null, state: 'NO_RECENT_ACTIVITY' });
  });

  it('compares any aligned pair of windows the reader picks (2026-09-24)', () => {
    const events = [ship(1), ship(2), ship(3), ship(9)];
    expect(buildVelocity(events, now, longAgo, 7)).toEqual({ windowDays: 7, current: 3, previous: 1, changePct: 200, state: 'ACCELERATING' });
    // A 90-day window needs 180 days watched before it compares.
    expect(buildVelocity(events, now, ago(120), 90).state).toBe('NEW');
  });

  it('calls a project HEY has watched for under sixty days new, not accelerating', () => {
    expect(buildVelocity([ship(2), ship(4), ship(6)], now, ago(20))).toEqual({ windowDays: 30, current: 3, previous: null, changePct: null, state: 'NEW' });
  });

  it('counts only meaningful events, and a week of commits once', () => {
    const noise = [
      ship(1, 'ANNOUNCEMENT'),
      ship(2, 'CONTRACT_DEPLOY'),
      ship(3, 'FEATURE_RELEASE', { verificationStatus: 'SELF_REPORTED' }),
      ship(4, 'FEATURE_RELEASE', { moderationStatus: 'PENDING' }),
    ];
    const commits = [ship(0.1, 'CODE_ACTIVITY'), ship(0.2, 'CODE_ACTIVITY'), ship(0.3, 'CODE_ACTIVITY')];
    expect(buildVelocity([...noise, ...commits], now, longAgo).current).toBe(1);
  });
});

describe('releaseCadence', () => {
  it('needs three release days before it names a rhythm', () => {
    expect(releaseCadence([ship(10, 'GITHUB_RELEASE'), ship(30, 'GITHUB_RELEASE')], now)).toEqual({
      state: 'INSUFFICIENT_RELEASES',
      releases: 2,
      lookbackDays: 365,
      daysSinceLastRelease: 10,
    });
    expect(releaseCadence([], now)).toMatchObject({ state: 'INSUFFICIENT_RELEASES', releases: 0, daysSinceLastRelease: null });
  });

  it('takes the median interval, and counts a day of tags once', () => {
    const tags = [ship(0.1, 'GITHUB_RELEASE'), ship(0.2, 'SDK_RELEASE'), ship(0.3, 'API_RELEASE')];
    const cadence = releaseCadence([...tags, ship(10, 'GITHUB_RELEASE'), ship(30, 'APP_RELEASE')], now);
    expect(cadence).toMatchObject({ state: 'MEASURED', releases: 3, medianIntervalDays: 15, direction: null, daysSinceLastRelease: 0 });
  });

  it('says whether releases come faster or slower than before', () => {
    // Older intervals of 30 days, newer of 7.
    const days = [0, 7, 14, 21, 51, 81, 111];
    const cadence = releaseCadence(days.map((day) => ship(day, 'GITHUB_RELEASE')), now);
    expect(cadence).toMatchObject({ state: 'MEASURED', previousIntervalDays: 30, currentIntervalDays: 7, direction: 'FASTER' });
    const slower = releaseCadence([0, 30, 60, 90, 97, 104, 111].map((day) => ship(day, 'GITHUB_RELEASE')), now);
    expect(slower).toMatchObject({ direction: 'SLOWER' });
  });

  it('does not treat work toward a release as one', () => {
    expect(releaseCadence([ship(1, 'DOCS_UPDATE'), ship(5, 'CODE_ACTIVITY'), ship(9, 'INTEGRATION')], now).state).toBe('INSUFFICIENT_RELEASES');
  });
});

describe('builderConsistency', () => {
  it('counts active weeks, streaks, silences and comebacks', () => {
    // Weeks 0,1,2 active; a 100-day silence; then weeks 17,18 active.
    const events = [ship(1), ship(8), ship(15), ship(120), ship(127)];
    expect(builderConsistency(events, now, longAgo)).toEqual({
      activeWeeks: 3,
      windowWeeks: 12,
      currentStreakWeeks: 3,
      longestStreakWeeks: 3,
      daysSinceMeaningfulShip: 1,
      longestSilenceDays: 105,
      resumptions: 1,
    });
  });

  it('counts the silence still running', () => {
    expect(builderConsistency([ship(200), ship(210)], now, longAgo)).toMatchObject({ longestSilenceDays: 200, currentStreakWeeks: 0, activeWeeks: 0 });
  });

  it('does not score weeks HEY was not watching', () => {
    expect(builderConsistency([ship(2)], now, ago(30)).activeWeeks).toBeNull();
  });

  it('knows nothing rather than zero about a project with no meaningful event', () => {
    expect(builderConsistency([ship(3, 'ANNOUNCEMENT')], now, longAgo)).toMatchObject({
      daysSinceMeaningfulShip: null,
      longestSilenceDays: null,
      resumptions: 0,
      longestStreakWeeks: 0,
    });
  });
});

describe('discoveryLag', () => {
  const lag = (publishedDays: number, lagHours: number, over: Partial<LagEvent> = {}): LagEvent => {
    const event = ship(publishedDays);
    return { ...event, detectedAt: new Date(event.publishedAt.getTime() + lagHours * 3_600_000), ...over };
  };

  it('takes the median hours from publication to HEY recording it', () => {
    expect(discoveryLag([lag(1, 2), lag(5, 4), lag(9, 30)], now, longAgo)).toEqual({ state: 'MEASURED', samples: 3, windowDays: 90, medianHours: 4, maxHours: 30 });
  });

  it('leaves out what a backfill found and what was recorded before it was published', () => {
    const events = [lag(1, 2), lag(5, 4), lag(9, -3), lag(60, 2)];
    // Watched for 30 days: the 60-day-old event predates the watch.
    expect(discoveryLag(events, now, ago(30))).toEqual({ state: 'INSUFFICIENT_SAMPLES', samples: 2, windowDays: 90 });
  });
});

describe('marketAttention', () => {
  it('names the market-context percentile in five bands, and nothing without one', () => {
    expect([5, 25, 50, 70, 95].map(marketAttention)).toEqual(['VERY_LOW', 'LOW', 'TYPICAL', 'ELEVATED', 'HIGH']);
    expect(marketAttention(null)).toBeNull();
    expect(marketAttention(undefined)).toBeNull();
    expect(marketAttention(Number.NaN)).toBeNull();
  });
});
