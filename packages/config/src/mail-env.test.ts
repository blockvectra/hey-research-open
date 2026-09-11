import { describe, expect, it } from 'vitest';

import { isMailEnabled, parseServerEnv, safeParseServerEnv } from './env';

/**
 * Email configuration (2026-09-05).
 *
 * The rule these pin down: mail is off unless it is switched on *and* fully
 * configured, and a half-configured mail block refuses to start rather than
 * failing silently at the first send — which, with email, means finding out
 * from a reader who never got their message.
 */
const minimalEnv = { DATABASE_URL: 'postgresql://hey:hey@localhost:5432/hey_research' };

const enabled = {
  ...minimalEnv,
  HEY_MAIL_ENABLED: 'true',
  RESEND_API_KEY: 're_testkey_00000000',
  HEY_MAIL_FROM: 'HEY Research Lab <updates@send.heyresearch.xyz>',
};

describe('email configuration', () => {
  it('is off by default, with no key and no address', () => {
    const env = parseServerEnv(minimalEnv);

    expect(env.mail.enabled).toBe(false);
    expect(env.mail.apiKey).toBeUndefined();
    expect(env.mail.from).toBeUndefined();
    expect(isMailEnabled(env)).toBe(false);
  });

  it('ignores a key and an address while it is off', () => {
    // A leftover block in a developer .env must not start sending.
    expect(isMailEnabled(parseServerEnv({ ...enabled, HEY_MAIL_ENABLED: 'false' }))).toBe(false);
  });

  it('accepts a complete, valid configuration', () => {
    const env = parseServerEnv(enabled);

    expect(isMailEnabled(env)).toBe(true);
    expect(env.mail.from).toBe('HEY Research Lab <updates@send.heyresearch.xyz>');
  });

  it('refuses to start when enabled without a key', () => {
    const result = safeParseServerEnv({ ...enabled, RESEND_API_KEY: '' });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.issues.join(' ')).toContain('RESEND_API_KEY');
  });

  it('refuses a key that is not a Resend key', () => {
    // The usual mistake: pasting some other provider's secret into the slot.
    const result = safeParseServerEnv({ ...enabled, RESEND_API_KEY: 'sk-live-abcdefgh' });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.issues.join(' ')).toContain('re_');
  });

  it('never echoes the key in a validation message', () => {
    const wrongSecret = 'sk-live-do-not-print-me';
    const result = safeParseServerEnv({ ...enabled, RESEND_API_KEY: wrongSecret });

    expect(result.ok ? '' : result.issues.join(' ')).not.toContain(wrongSecret);
  });

  it.each([
    ['a bare address', 'updates@send.heyresearch.xyz'],
    ['a domain with no dot', 'HEY Research Lab <updates@localhost>'],
    ['angle brackets missing', 'HEY Research Lab updates@send.heyresearch.xyz'],
    ['an empty display name', '<updates@send.heyresearch.xyz>'],
  ])('refuses a From that is not `Name <local@domain>`: %s', (_label, from) => {
    const result = safeParseServerEnv({ ...enabled, HEY_MAIL_FROM: from });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.issues.join(' ')).toContain('HEY_MAIL_FROM');
  });

  it('reports the env keys a developer has to fix, not the schema paths', () => {
    const result = safeParseServerEnv({ ...minimalEnv, HEY_MAIL_ENABLED: 'true' });

    const issues = result.ok ? [] : result.issues;
    expect(issues.some((issue) => issue.startsWith('RESEND_API_KEY:'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('HEY_MAIL_FROM:'))).toBe(true);
  });
});
