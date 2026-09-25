import { describe, expect, it } from 'vitest';

import { tokenLockHelp, tokenLockSchedule } from './token-lock';

/**
 * A lock's sentence names the next unlock, not only the last (audit A10-10,
 * 2026-09-25). hoodlock read "16.49% … until 25 Sep 2027" where 0.315% ran
 * that long and 8.57% opened within seven days.
 */
describe('tokenLockSchedule and tokenLockHelp', () => {
  const spread = { supplyPct: 16.49, until: '2027-09-25', nextUnlockAt: '2026-10-01', nextUnlockPct: 8.57, pairLocked: false };

  it('names the next unlock and its share before the last date', () => {
    expect(tokenLockSchedule(spread)).toBe('the next 8.57% unlocks on 1 Oct 2026, and the last on 25 Sep 2027');
    const help = tokenLockHelp(spread);
    expect(help).toBe('16.49% of the token supply is locked at HoodLock; the next 8.57% unlocks on 1 Oct 2026, and the last on 25 Sep 2027. Context HEY read from the locker, not a verdict.');
    expect(help).not.toContain('until');
  });

  it('keeps "until" when everything opens on one date, where it is true', () => {
    const single = { supplyPct: 3.8, until: '2026-12-13', nextUnlockAt: '2026-12-13', nextUnlockPct: 3.8, pairLocked: false };
    expect(tokenLockSchedule(single)).toBe('until 13 Dec 2026');
    expect(tokenLockHelp(single)).toBe('3.8% of the token supply is held in a HoodLock lock until 13 Dec 2026. Context HEY read from the locker, not a verdict.');
    // An older payload with no next date reads as before.
    expect(tokenLockSchedule({ until: '2026-12-13', pairLocked: false })).toBe('until 13 Dec 2026');
  });

  it('says "the next part" when the share is unknown, and nothing when only a pair is locked', () => {
    expect(tokenLockSchedule({ until: '2027-09-25', nextUnlockAt: '2026-10-01', pairLocked: false })).toBe('the next part unlocks on 1 Oct 2026, and the last on 25 Sep 2027');
    expect(tokenLockSchedule({ pairLocked: true })).toBe('');
    expect(tokenLockHelp({ pairLocked: true })).toContain('A pair holding this token is locked at HoodLock.');
  });
});
