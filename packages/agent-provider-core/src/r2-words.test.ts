import { describe, expect, it } from 'vitest';

import { SHIP_VERIFICATION_WORDS } from '@hey/scoring/verification-words';

import { TOKEN_REASON_WORDS } from './compose/gaps';
import { CHAIN_BRIEF_METHODS } from './compose/brief';
import { DO_NOT_CONCLUDE } from './unknowns';
import { CHANGE_TYPE_NOUNS, EVIDENCE_CLAIM_TYPE_WORDS, evidenceBackingWords, STILL_BUILDING_MEANING_SENTENCE } from './words';

/**
 * R2 (2026-10-28, founder "semua R ya"; 2026-10-31 audit L7-2, L7-3): a reader meets "verified" only in "Verified
 * Builder", and "the MCP's prose follow". The agent contract's own sentences — what not to conclude, a token's reason,
 * the Still Building meaning, the counted nouns, an evidence receipt's backing — are read here. Stored enums
 * (VERIFIED, NOT_VERIFIED, PUBLICLY_VERIFIED …) and machine keys stay (machine rule 10) and are set aside.
 */
const R2 = /\b(un)?verified\b|\bverifies\b|\bverify\b/i;
const prose = (text: string) => text.replace(/Verified Builders?/g, '').replace(/\b[A-Z][A-Z_]{3,}\b/g, '');

describe('agent contract prose says "verified" only in "Verified Builder" (R2)', () => {
  it('the sentences HEY writes', () => {
    const texts: [string, string][] = [
      ['STILL_BUILDING_MEANING_SENTENCE', STILL_BUILDING_MEANING_SENTENCE],
      ...Object.entries(DO_NOT_CONCLUDE).map(([key, text]): [string, string] => [`DO_NOT_CONCLUDE.${key}`, text]),
      ...Object.entries(TOKEN_REASON_WORDS).map(([key, text]): [string, string] => [`TOKEN_REASON_WORDS.${key}`, text]),
      ...Object.entries(CHAIN_BRIEF_METHODS).map(([key, text]): [string, string] => [`CHAIN_BRIEF_METHODS.${key}`, text]),
      ...Object.entries(EVIDENCE_CLAIM_TYPE_WORDS).map(([key, text]): [string, string] => [`EVIDENCE_CLAIM_TYPE_WORDS.${key}`, text]),
    ];
    for (const [key, text] of texts) expect(prose(text), key).not.toMatch(R2);
  });

  it('the counted nouns for HEY’s own verification events', () => {
    expect(CHANGE_TYPE_NOUNS['research.builder_verified']).toEqual({ one: 'new Verified Builder', other: 'new Verified Builders' });
    expect(prose(CHANGE_TYPE_NOUNS['research.owner_verified']!.one)).not.toMatch(R2);
    expect(prose(CHANGE_TYPE_NOUNS['research.owner_verified']!.other)).not.toMatch(R2);
  });

  it('Still Building in the page’s words', () => {
    expect(STILL_BUILDING_MEANING_SENTENCE).toBe('Still Building: counted ships during a market drawdown HEY itself tracked; a record of what happened, not a prediction and not a buy signal.');
  });
});

describe('evidenceBackingWords (2026-10-31 audit L7-2)', () => {
  it('reads a ship’s backing through the scoring table, whatever the domain', () => {
    for (const [value, words] of Object.entries(SHIP_VERIFICATION_WORDS)) {
      expect(evidenceBackingWords(value, 'CONTRACT_DEPLOY_FOLLOWUP')).toBe(words);
      expect(evidenceBackingWords(value, 'GITHUB_RELEASE')).toBe(words);
    }
    expect(evidenceBackingWords('PUBLICLY_VERIFIED', 'CONTRACT_DEPLOY_FOLLOWUP')).toBe('Source-backed');
    // Self-reported stays visibly distinct (product rule 10).
    expect(evidenceBackingWords('SELF_REPORTED', 'FEATURE_RELEASE')).toBe('Self-reported');
  });

  it('an owner proved control; a source row reads the source ladder; a confirmed signal stays confirmed', () => {
    expect(evidenceBackingWords('VERIFIED', 'owner_verified')).toBe('Owner proved control');
    expect(evidenceBackingWords('VERIFIED', 'source.github_repo')).toBe('Checked by HEY');
    expect(evidenceBackingWords('AUTHORITATIVE_LINK', 'source.website')).toBe('Official');
    expect(evidenceBackingWords('DISCOVERED', 'source.x')).toBe('Not tied yet');
    expect(evidenceBackingWords('CONFIRMED', 'development_spike')).toBe('Confirmed');
  });

  it('never prints "verified" or "linked" for any stored value', () => {
    const values = [...Object.keys(SHIP_VERIFICATION_WORDS), 'VERIFIED', 'AUTHORITATIVE_LINK', 'DISCOVERED', 'CONFIRMED'];
    for (const claimType of ['CONTRACT_DEPLOY_FOLLOWUP', 'owner_verified', 'source.website', 'builder_verified', 'uniswap_v4_hook']) {
      for (const value of values) expect(evidenceBackingWords(value, claimType), `${claimType} ${value}`).not.toMatch(/verified|\blinked\b/i);
    }
  });
});
