import { describe, expect, it } from 'vitest';
import type { ScoredEvent } from './activity';
import { deriveActivityStatus } from './activity';
import { computeHbm, shippingConsistency } from './hbm';

const DAY = 86_400_000;
const at = (iso: string): Date => new Date(iso);
const ev = (iso: string, o: Partial<ScoredEvent> = {}): ScoredEvent => ({
  eventType: 'GITHUB_RELEASE',
  verificationStatus: 'PUBLICLY_VERIFIED',
  publishedAt: at(iso),
  sourceKind: 'GITHUB',
  ...o,
});

describe('F: consistency buckets are rolling, not calendar weeks', () => {
  it('counts two ships inside ONE calendar week as two of six weeks', () => {
    // Thu 2026-09-17 12:00Z. Mon 2026-09-07 and Sun 2026-09-13 are both ISO week 2026-W37.
    const now = at('2026-09-17T12:00:00Z');
    const sameCalendarWeek = [ev('2026-09-07T12:00:00Z'), ev('2026-09-13T12:00:00Z')];
    const r = shippingConsistency(sameCalendarWeek, now);
    console.log('same calendar week W37 ->', r);
    expect(r.activeWeeks).toBe(2);
  });

  it('counts two ships in TWO calendar weeks as one of six weeks', () => {
    const now = at('2026-09-17T12:00:00Z');
    // Sun 2026-09-13 (W37) and Wed 2026-09-16 (W38).
    const twoCalendarWeeks = [ev('2026-09-13T12:00:00Z'), ev('2026-09-16T12:00:00Z')];
    const r = shippingConsistency(twoCalendarWeeks, now);
    console.log('two calendar weeks W37+W38 ->', r);
    expect(r.activeWeeks).toBe(1);
  });

  it('the same evidence scores differently depending on the hour of the rescore', () => {
    const events = [ev('2026-09-10T00:00:00Z'), ev('2026-09-03T12:00:00Z')];
    const a = shippingConsistency(events, at('2026-09-17T06:00:00Z'));
    const b = shippingConsistency(events, at('2026-09-17T18:00:00Z'));
    console.log('06:00 ->', a, ' 18:00 ->', b);
    expect(a.activeWeeks).not.toBe(b.activeWeeks);
  });
});

describe('F: HBM has an unreachable band between 0 and 16.3', () => {
  it('min non-zero HBM is 16.3', () => {
    const now = at('2026-09-17T00:00:00Z');
    const weakest = [ev(new Date(now.getTime() - 41 * DAY).toISOString(), {
      eventType: 'DOCS_UPDATE',
      verificationStatus: 'SOURCE_LINKED',
    })];
    const r = computeHbm({ events: weakest, now });
    console.log('weakest possible non-zero HBM:', r.hbm, r.components);
    expect(r.hbm).toBe(16.3);
    expect(r.components.verification).toBe(70);
  });

  it('verification component is never below 70 for any scored project', () => {
    const now = at('2026-09-17T00:00:00Z');
    for (const status of ['SELF_REPORTED', 'DISPUTED', 'RETRACTED'] as const) {
      const r = computeHbm({ events: [ev('2026-09-16T00:00:00Z', { verificationStatus: status })], now });
      console.log(status, '->', r.hbm, r.components.verification);
      expect(r.hbm).toBe(0); // dropped entirely, never weighted at 0.35 or 0
    }
  });
});

describe('F: RESUMED is masked by a same-day sibling event', () => {
  const now = at('2026-09-17T00:00:00Z');
  const base = { now, hasSourceCoverage: true };

  it('is RESUMED after a 90-day gap when the comeback is one event', () => {
    const r = deriveActivityStatus({
      ...base,
      events: [ev('2026-09-16T10:00:00Z'), ev('2026-06-01T10:00:00Z')],
    });
    console.log('single comeback event ->', r.status, r.reason);
    expect(r.status).toBe('RESUMED');
  });

  it('is NOT RESUMED when the comeback day carries two ships', () => {
    const r = deriveActivityStatus({
      ...base,
      events: [
        ev('2026-09-16T10:00:00Z'),
        ev('2026-09-16T09:00:00Z', { eventType: 'FEATURE_RELEASE' }),
        ev('2026-06-01T10:00:00Z'),
      ],
    });
    console.log('two comeback events ->', r.status, r.reason);
    expect(r.status).toBe('SHIPPING');
  });
});

describe('F: QUIET asserts "we looked" without coverage', () => {
  it('claims no updates for 40 days with no observable source at all', () => {
    const r = deriveActivityStatus({
      now: at('2026-09-17T00:00:00Z'),
      hasSourceCoverage: false,
      events: [ev('2026-08-08T00:00:00Z')],
    });
    console.log('no coverage, 40-day-old ship ->', r.status, '|', r.reason);
    expect(r.status).toBe('QUIET');
  });
});
