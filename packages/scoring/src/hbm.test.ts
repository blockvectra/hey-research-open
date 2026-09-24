import { describe, expect, it } from 'vitest';

import type { ScoredEvent } from './activity';
import { computeHbm, shippingConsistency, shippingRecency, shippingStreak } from './hbm';
import { SCORING_VERSION } from './version';

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

describe('HEY Build Momentum', () => {
  /** Backlog M5 test 1: shipping weekly scores high regardless of market size. */
  it('gives a small project shipping every week a high score', () => {
    const events = [0, 7, 14, 21, 28].map((days) => ship(days, { eventType: 'FEATURE_RELEASE' }));

    const result = computeHbm({ events, now, sourceClasses: ['github', 'website'] });

    expect(result.hbm).toBeGreaterThan(70);
    expect(result.explanation.activeWeeks).toBeGreaterThanOrEqual(5);
  });

  /**
   * Backlog M5 test 5: the input type carries no market or wallet field, so no
   * such value can reach a score even by accident.
   */
  it('cannot be influenced by price, volume, holders or wallets', () => {
    const events = [ship(1), ship(9)];
    const baseline = computeHbm({ events, now });

    // Market-shaped fields are not part of HbmInput, so they cannot be passed
    // without an explicit cast — and even then they change nothing.
    const noisyInput = {
      events,
      now,
      priceUsd: 1_000_000,
      holders: 50_000,
      walletPnl: 42,
      volume24hUsd: 9_999_999,
    } as unknown as Parameters<typeof computeHbm>[0];
    const withMarketNoise = computeHbm(noisyInput);

    expect(withMarketNoise.hbm).toBe(baseline.hbm);
  });

  it('scores a project with no meaningful events at zero', () => {
    expect(computeHbm({ events: [], now }).hbm).toBe(0);
  });

  /**
   * Regression: registering a source used to earn a project momentum on its own,
   * and evidence quality from long-past events kept propping up a dormant one.
   */
  it('scores zero for a project that has not shipped inside the window', () => {
    expect(computeHbm({ events: [], now, sourceClasses: ['github', 'website'] }).hbm).toBe(0);
    expect(computeHbm({ events: [ship(200)], now, sourceClasses: ['github'] }).hbm).toBe(0);
  });

  it('does not let old evidence quality prop up a stalled project', () => {
    const recent = computeHbm({ events: [ship(2)], now });
    const stalled = computeHbm({
      events: [ship(2), ...[100, 120, 140].map((days) => ship(days))],
      now,
    });

    // The ancient releases add nothing; only the recent one counts.
    expect(stalled.hbm).toBe(recent.hbm);
  });

  /** Backlog M5 test 2: noise must not become momentum. */
  it('gives a project posting only marketing a score of zero', () => {
    const events = Array.from({ length: 30 }, (_, index) =>
      ship(index % 30, { eventType: 'ANNOUNCEMENT' }),
    );

    expect(computeHbm({ events, now }).hbm).toBe(0);
  });

  it('scores self-reported claims below verified evidence', () => {
    const events = [ship(2, { eventType: 'PRODUCT_LAUNCH' })];
    const verified = computeHbm({ events, now });
    const claimed = computeHbm({
      events: [{ ...events[0]!, verificationStatus: 'SOURCE_LINKED' }],
      now,
    });

    expect(claimed.hbm).toBeLessThan(verified.hbm);
  });

  it('decays older activity', () => {
    expect(shippingRecency([ship(1)], now)).toBeGreaterThan(shippingRecency([ship(25)], now));
  });

  it('ignores events beyond the recency window', () => {
    expect(shippingRecency([ship(60)], now)).toBe(0);
  });

  it('saturates so a burst cannot produce an unbounded score', () => {
    const burst = Array.from({ length: 100 }, () => ship(0, { eventType: 'PRODUCT_LAUNCH' }));
    expect(shippingRecency(burst, now)).toBe(100);
  });

  it('rewards consistency across six calendar weeks, and the clock cannot move it (hbm-v7)', () => {
    const spread = [0, 7, 14, 21, 28, 35].map((days) => ship(days));
    // `now` is Tuesday 2026-09-01: six days back reaches into the previous ISO week.
    const bunched = [0, 1, 2, 3, 4, 5].map((days) => ship(days));

    expect(shippingConsistency(spread, now).activeWeeks).toBe(6);
    expect(shippingConsistency(bunched, now).activeWeeks).toBe(2);
    // Two events in one ISO week are one week whatever hour the rescore runs.
    const sameWeek = [ship(0), ship(1)];
    const morning = new Date('2026-09-01T06:00:00Z');
    const evening = new Date('2026-09-01T18:00:00Z');
    expect(shippingConsistency(sameWeek, morning).activeWeeks).toBe(shippingConsistency(sameWeek, evening).activeWeeks);
  });

  it('rewards breadth of work over repetition in one dimension', () => {
    const repeated = [0, 1, 2, 3].map(() => ship(1, { eventType: 'DOCS_UPDATE' }));
    const varied = [
      ship(1, { eventType: 'PRODUCT_LAUNCH' }),
      ship(2, { eventType: 'CONTRACT_DEPLOY' }),
      ship(3, { eventType: 'INTEGRATION' }),
      ship(4, { eventType: 'SDK_RELEASE' }),
    ];

    expect(computeHbm({ events: varied, now }).components.significance).toBeGreaterThan(
      computeHbm({ events: repeated, now }).components.significance,
    );
  });

  it('counts a week of code activity once, however many repositories reported it (hbm-v8)', () => {
    const code = (days: number, hour: number) =>
      ship(days, {
        eventType: 'CODE_ACTIVITY',
        verificationStatus: 'SOURCE_LINKED',
        publishedAt: new Date(daysAgo(days).getTime() + hour * 60 * 60 * 1000),
      });
    // One repository committing in two weeks (the week's newest summary is the one kept).
    const oneRepo = computeHbm({ events: [code(1, 4), code(8, 4)], now });
    // Four repositories committing on the same two days: same building, more rows.
    const fourRepos = computeHbm({
      events: [code(1, 1), code(1, 2), code(1, 3), code(1, 4), code(8, 1), code(8, 2), code(8, 3), code(8, 4)],
      now,
    });

    expect(fourRepos.hbm).toBe(oneRepo.hbm);
    expect(fourRepos.components).toEqual(oneRepo.components);
    expect(fourRepos.explanation.meaningfulEvents).toBe(2);

    /*
     * Ingestion writes one summary per repository per ISO week, dated that
     * repository's last commit (2026-09-15), so four repositories are four
     * rows on four *different* days of one week. `now` is Tuesday 1 September;
     * days 2–5 ago are Sunday back to Thursday of the week before.
     */
    const oneRow = computeHbm({ events: [code(2, 4)], now });
    const fourRows = computeHbm({ events: [code(2, 4), code(3, 4), code(4, 4), code(5, 4)], now });
    expect(fourRows.hbm).toBe(oneRow.hbm);
    expect(fourRows.components).toEqual(oneRow.components);
    expect(fourRows.explanation.meaningfulEvents).toBe(1);

    // Weeks are UTC ISO weeks: a commit just after Sunday midnight is a new week, not the same one.
    const twoWeeks = computeHbm({ events: [code(2, 23), code(1, 0.5)], now });
    expect(twoWeeks.explanation.meaningfulEvents).toBe(2);
    // Releases are never collapsed: two releases in a day are two ships.
    expect(computeHbm({ events: [ship(1), ship(1)], now }).explanation.meaningfulEvents).toBe(2);
  });

  it('publishes an explanation rather than an opaque number', () => {
    const result = computeHbm({ events: [ship(2), ship(10)], now });

    expect(result.explanation.meaningfulEvents).toBe(2);
    expect(result.explanation.totalWeeks).toBe(6);
    expect(result.explanation.topEvents.length).toBeGreaterThan(0);
    expect(result.explanation.lastMeaningfulShipAt).toBeDefined();
  });

  it('stamps the scoring version onto every result', () => {
    expect(SCORING_VERSION).toBe('hbm-v11');
    expect(computeHbm({ events: [ship(1)], now }).scoringVersion).toBe(SCORING_VERSION);
  });

  it('is deterministic', () => {
    const events = [ship(1), ship(8), ship(15)];
    expect(computeHbm({ events, now })).toEqual(computeHbm({ events, now }));
  });

  it('stays within 0..100', () => {
    const events = Array.from({ length: 200 }, (_, index) =>
      ship(index % 30, { eventType: 'PRODUCT_LAUNCH' }),
    );
    const result = computeHbm({ events, now });

    expect(result.hbm).toBeGreaterThanOrEqual(0);
    expect(result.hbm).toBeLessThanOrEqual(100);
  });
});

describe('shipping streak', () => {
  it('counts consecutive recent weeks with meaningful activity', () => {
    expect(shippingStreak([ship(1), ship(8), ship(15)], now)).toBe(3);
  });

  it('stops at the first silent week', () => {
    expect(shippingStreak([ship(1), ship(20)], now)).toBe(1);
  });

  it('is zero when the current week has no meaningful activity', () => {
    expect(shippingStreak([ship(20)], now)).toBe(0);
  });
});
