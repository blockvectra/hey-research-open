import { describe, expect, it } from 'vitest';

import { isCorroborated, isMeaningful, isStrongShip, significanceOf } from './significance';

describe('significance classification', () => {
  it('treats real deliverables as strong build signals', () => {
    for (const type of [
      'PRODUCT_LAUNCH',
      'GITHUB_RELEASE',
      'CONTRACT_UPGRADE',
      'CONTRACT_DEPLOY_FOLLOWUP',
      'SDK_RELEASE',
      'INTEGRATION',
      'GAME_RELEASE',
      'COMMUNITY_TOOL',
    ] as const) {
      expect(significanceOf(type)).toBe('STRONG');
    }
  });

  it('treats docs, demos and creative output as supporting signals', () => {
    for (const type of ['DOCS_UPDATE', 'DEMO_RELEASE', 'CREATIVE_DROP', 'CODE_ACTIVITY'] as const) {
      expect(significanceOf(type)).toBe('SUPPORTING');
    }
  });

  it('never counts announcements as building', () => {
    expect(significanceOf('ANNOUNCEMENT')).toBe('NOT_MEANINGFUL');
    expect(significanceOf('OTHER')).toBe('NOT_MEANINGFUL');
  });

  /*
   * 433 published projects held nothing but their own contract deploy, and
   * every one carried an activity status other than UNKNOWN — a token that
   * launched and did nothing since, presented as a project with strong build
   * evidence.
   */
  it('does not read a launch as evidence of building', () => {
    expect(significanceOf('CONTRACT_DEPLOY')).toBe('NOT_MEANINGFUL');
    expect(
      isMeaningful({ eventType: 'CONTRACT_DEPLOY', verificationStatus: 'PUBLICLY_VERIFIED' }),
    ).toBe(false);
  });

  it('still reads a change to a live contract as building', () => {
    // Upgrading something already deployed is work done after the launch.
    expect(significanceOf('CONTRACT_UPGRADE')).toBe('STRONG');
    expect(
      isStrongShip({ eventType: 'CONTRACT_UPGRADE', verificationStatus: 'PUBLICLY_VERIFIED' }),
    ).toBe(true);
  });

  it('recognises meme deliverables as real output', () => {
    // A meme is never required to pretend it ships software.
    expect(significanceOf('GAME_RELEASE')).toBe('STRONG');
    expect(significanceOf('COMMUNITY_TOOL')).toBe('STRONG');
    expect(significanceOf('CREATIVE_DROP')).toBe('SUPPORTING');
    expect(significanceOf('COMMUNITY_EVENT')).toBe('SUPPORTING');
  });
});

describe('verification weighting', () => {
  it('counts source-linked and above as corroborated', () => {
    expect(isCorroborated('SOURCE_LINKED')).toBe(true);
    expect(isCorroborated('PUBLICLY_VERIFIED')).toBe(true);
    expect(isCorroborated('ADMIN_VERIFIED')).toBe(true);
  });

  it('does not count self-reported, disputed or retracted', () => {
    expect(isCorroborated('SELF_REPORTED')).toBe(false);
    expect(isCorroborated('DISPUTED')).toBe(false);
    expect(isCorroborated('RETRACTED')).toBe(false);
  });
});

describe('isMeaningful', () => {
  it('accepts a corroborated build signal', () => {
    expect(
      isMeaningful({ eventType: 'GITHUB_RELEASE', verificationStatus: 'PUBLICLY_VERIFIED' }),
    ).toBe(true);
  });

  /** The anti-gaming boundary: marketing volume must never look like building. */
  it('rejects a marketing announcement however well verified', () => {
    expect(isMeaningful({ eventType: 'ANNOUNCEMENT', verificationStatus: 'ADMIN_VERIFIED' })).toBe(
      false,
    );
  });

  it('rejects a real deliverable that is only self-reported', () => {
    expect(isMeaningful({ eventType: 'PRODUCT_LAUNCH', verificationStatus: 'SELF_REPORTED' })).toBe(
      false,
    );
  });

  it('makes disputed and retracted events score-neutral rather than deleted', () => {
    expect(isMeaningful({ eventType: 'SDK_RELEASE', verificationStatus: 'DISPUTED' })).toBe(false);
    expect(isMeaningful({ eventType: 'SDK_RELEASE', verificationStatus: 'RETRACTED' })).toBe(false);
  });

  it('ignores events held back by moderation', () => {
    expect(
      isMeaningful({
        eventType: 'PRODUCT_LAUNCH',
        verificationStatus: 'PUBLICLY_VERIFIED',
        moderationStatus: 'SPAM',
      }),
    ).toBe(false);
  });

  it('separates strong ships from supporting activity', () => {
    const supporting = { eventType: 'CODE_ACTIVITY', verificationStatus: 'SOURCE_LINKED' } as const;
    expect(isMeaningful(supporting)).toBe(true);
    expect(isStrongShip(supporting)).toBe(false);
    expect(isStrongShip({ eventType: 'APP_RELEASE', verificationStatus: 'SOURCE_LINKED' })).toBe(
      true,
    );
  });
});
