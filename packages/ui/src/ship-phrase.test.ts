import { describe, expect, it } from 'vitest';

import { CARD_SHIP_WHAT_MAX, cardShipPhrase, displayShipTitle } from './ship-phrase';

const now = new Date('2026-09-28T12:00:00Z'); // a Monday

describe('cardShipPhrase (public UX review, 2026-09-28)', () => {
  it('names a release by its version', () => {
    expect(cardShipPhrase({ eventType: 'GITHUB_RELEASE', title: 'v0.2.14', publishedAt: new Date('2026-09-26T12:00:00Z') }, { now })).toEqual({ what: 'Release v0.2.14', when: '2d ago' });
    expect(cardShipPhrase({ eventType: 'GITHUB_RELEASE', title: 'ProjectVex v0.2.14 — agent runtime', publishedAt: new Date('2026-09-26T12:00:00Z') }, { now })?.what).toBe('Release v0.2.14');
    expect(cardShipPhrase({ eventType: 'SDK_RELEASE', title: 'Agent **SDK** v0.4', publishedAt: new Date('2026-09-26T12:00:00Z') }, { now })?.what).toBe('SDK v0.4');
    expect(cardShipPhrase({ eventType: 'GITHUB_RELEASE', title: 'Release 2.3.0-beta.1', publishedAt: now }, { now })?.what).toBe('Release 2.3.0-beta.1');
  });

  it('does not read a product name ("Family V1") as a version', () => {
    const phrase = cardShipPhrase({ eventType: 'GITHUB_RELEASE', title: 'Catch Family V1 — cCATCH source record', publishedAt: now }, { now });
    expect(phrase?.what).not.toMatch(/^Release V1/);
    expect(phrase?.what.length).toBeLessThanOrEqual(CARD_SHIP_WHAT_MAX);
  });

  // Not the title's rolling count (2026-10-02): "100+ commits · this week" claimed a hundred commits in one week.
  it('names a code week by its kind, dated by its week — never the rolling window’s count', () => {
    const at = new Date('2026-09-28T02:00:00Z');
    expect(cardShipPhrase({ eventType: 'CODE_ACTIVITY', title: 'Active development: 100+ commits since 2026-09-16 across 1 contributor', publishedAt: at }, { now })).toEqual({ what: 'Code changes', when: 'this week' });
    expect(cardShipPhrase({ eventType: 'CODE_ACTIVITY', title: 'Active development: 6 commits in the last 90 days across 1 contributor', publishedAt: new Date('2026-09-09T12:00:00Z') }, { now })).toEqual({ what: 'Code changes', when: '3 weeks ago' });
    expect(cardShipPhrase({ eventType: 'CODE_ACTIVITY', title: 'Active development: 1 commit in the last 90 days across 1 contributor', publishedAt: new Date('2026-09-24T12:00:00Z') }, { now })).toEqual({ what: 'Code changes', when: 'last week' });
  });

  it('names a deploy by its kind', () => {
    expect(cardShipPhrase({ eventType: 'CONTRACT_DEPLOY', title: 'Deployed 0x0000000000000000000000000000000000000001', publishedAt: new Date('2026-09-25T12:00:00Z') }, { now })).toEqual({ what: 'Contract deployed', when: '3d ago' });
    expect(cardShipPhrase({ eventType: 'CONTRACT_DEPLOY_FOLLOWUP', title: 'x', publishedAt: now }, { now })?.what).toBe('New contract deployed');
  });

  it('cuts a long title at a word, never inside one', () => {
    const phrase = cardShipPhrase({ eventType: 'FOUNDER_BUILD_UPDATE', title: 'Shipped the new portfolio rebalancing engine with limit orders', publishedAt: now }, { now });
    expect(phrase?.what).toBe('Shipped the new portfolio…');
    expect(phrase!.what.length).toBeLessThanOrEqual(CARD_SHIP_WHAT_MAX);
  });

  it('uses the kind of ship when the title is one unbreakable token', () => {
    expect(cardShipPhrase({ eventType: 'DOCS_UPDATE', title: 'a'.repeat(60), publishedAt: now }, { now })?.what).toBe('Docs update');
  });

  it('says nothing when all it could say is the status', () => {
    expect(cardShipPhrase({ eventType: 'CODE_ACTIVITY', title: 'Active development', publishedAt: now }, { now })).toBeUndefined();
    expect(cardShipPhrase({ eventType: 'OTHER', title: 'Shipping', publishedAt: now }, { now, statusLabel: 'Shipping' })).toBeUndefined();
    expect(cardShipPhrase({ eventType: 'OTHER', title: 'Still building!', publishedAt: now }, { now })).toBeUndefined();
    expect(cardShipPhrase({ eventType: 'OTHER', title: 'Resumed', publishedAt: now }, { now, statusLabel: 'Resumed' })).toBeUndefined();
  });

  it('keeps every phrase short enough for a phone card', () => {
    const titles = [
      ['CODE_ACTIVITY', 'Active development: 1,204+ commits since 2026-06-01 across 12 contributors'],
      ['GITHUB_RELEASE', 'hey-research-open v12.104.3-rc.12 with a very long description'],
      ['PRODUCT_LAUNCH', 'Launch of the lending market on Robinhood Chain mainnet today'],
    ] as const;
    for (const [eventType, title] of titles) {
      const phrase = cardShipPhrase({ eventType, title, publishedAt: now }, { now });
      expect(phrase, title).toBeDefined();
      expect(phrase!.what.length, title).toBeLessThanOrEqual(CARD_SHIP_WHAT_MAX);
      expect(phrase!.what, title).not.toMatch(/\w…\w/);
    }
  });

  it('dates a ship by UTC calendar day from a day on, and a code week by its UTC week (final production review, 2026-09-28)', () => {
    const morning = new Date('2026-09-28T08:50:00Z'); // a Monday
    // The reviewed ship: 19:56 on Sunday. A release under a day old is an elapsed time; a code week is last week.
    expect(cardShipPhrase({ eventType: 'GITHUB_RELEASE', title: 'v1.2.0', publishedAt: new Date('2026-09-27T19:56:00Z') }, { now: morning })?.when).toBe('12h ago');
    expect(cardShipPhrase({ eventType: 'CODE_ACTIVITY', title: 'Active development: 12 commits since 2026-09-21 across 2 contributors', publishedAt: new Date('2026-09-27T19:56:00Z') }, { now: morning })?.when).toBe('last week');
    // 33 hours and two UTC dates back: "2d ago", as the MCP and the summary say "2 days ago".
    expect(cardShipPhrase({ eventType: 'GITHUB_RELEASE', title: 'v1.1.0', publishedAt: new Date('2026-09-26T23:50:00Z') }, { now: morning })?.when).toBe('2d ago');
  });
});

describe('displayShipTitle — a code week by its fixed week (2026-10-02)', () => {
  it('names the Monday–Sunday UTC week the ship is dated in, never the rolling title', () => {
    expect(displayShipTitle({ eventType: 'CODE_ACTIVITY', title: 'Active development: 100+ commits since 2026-08-22 across 1 contributor', publishedAt: new Date('2026-10-01T10:00:00Z') })).toBe('Code changes, week of 2026-09-28 – 2026-10-04');
    // Sunday 23:59 UTC is still that week.
    expect(displayShipTitle({ eventType: 'CODE_ACTIVITY', title: 'Active development: 6 commits in the last 90 days', publishedAt: new Date('2026-10-04T23:59:00Z') })).toBe('Code changes, week of 2026-09-28 – 2026-10-04');
  });

  it('keeps a title already worded by its week, and every other ship’s title', () => {
    expect(displayShipTitle({ eventType: 'CODE_ACTIVITY', title: 'Code changes, week of 2026-09-28 – 2026-10-04 · 12 commits', publishedAt: new Date('2026-10-01T10:00:00Z') })).toBe('Code changes, week of 2026-09-28 – 2026-10-04 · 12 commits');
    expect(displayShipTitle({ eventType: 'GITHUB_RELEASE', title: '**v1.2.0**', publishedAt: new Date('2026-10-01T10:00:00Z') })).toBe('v1.2.0');
  });
});
