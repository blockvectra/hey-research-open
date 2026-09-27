import { describe, expect, it } from 'vitest';

import { tickerLabel } from './format';

/** One `$` however the token stored its symbol (review 2, 2026-09-27: Hoodlock read "$$LOCK"). */
describe('tickerLabel', () => {
  it('adds the sigil to a bare symbol', () => {
    expect(tickerLabel('AOS')).toBe('$AOS');
  });

  it('keeps one sigil when the token stored its own', () => {
    expect(tickerLabel('$LOCK')).toBe('$LOCK');
    expect(tickerLabel('$$GOLD')).toBe('$GOLD');
    expect(tickerLabel(' $CLARITY ')).toBe('$CLARITY');
  });

  it('never invents a ticker from nothing', () => {
    expect(tickerLabel('$')).toBe('$');
    expect(tickerLabel('')).toBe('');
  });
});
