import { describe, expect, it } from 'vitest';

import { isTelegramBotEnabled, parseServerEnv, safeParseServerEnv, telegramBotUrl } from './env';

/**
 * The HEY Telegram bot's configuration (2026-09-30, docs/TELEGRAM.md): off
 * unless the flag and all three values are set; the flag with a value
 * missing, or a value of the wrong shape, refuses to start and names the
 * variable, never its value.
 */
const minimalEnv = { DATABASE_URL: 'postgresql://hey:hey@localhost:5432/hey_research' };
const TOKEN = '123456:test-token-not-a-real-bot-key-xyz';
const SECRET = 'test-webhook-secret-0123456789';
const configured = { ...minimalEnv, HEY_TELEGRAM_BOT_ENABLED: 'true', TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: 'HeyResearchBot' };

describe('telegram bot configuration', () => {
  it('is off by default and has no public link', () => {
    const env = parseServerEnv(minimalEnv);
    expect(isTelegramBotEnabled(env)).toBe(false);
    expect(telegramBotUrl(env)).toBeUndefined();
  });

  it('is on with the flag and all three values, and links to the bot', () => {
    const env = parseServerEnv(configured);
    expect(isTelegramBotEnabled(env)).toBe(true);
    expect(telegramBotUrl(env)).toBe('https://t.me/HeyResearchBot');
  });

  it('stays off with the values but without the flag', () => {
    const { HEY_TELEGRAM_BOT_ENABLED: _flag, ...rest } = configured;
    expect(isTelegramBotEnabled(parseServerEnv(rest))).toBe(false);
  });

  it('refuses the flag with a value missing, naming the variable and never a value', () => {
    for (const missing of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME'] as const) {
      const { [missing]: _gone, ...rest } = configured;
      const parsed = safeParseServerEnv(rest);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.variables).toContain(missing);
        expect(parsed.issues.join(' ')).not.toContain(TOKEN);
        expect(parsed.issues.join(' ')).not.toContain(SECRET);
      }
    }
  });

  it('refuses a malformed token, a short secret and a username that is not a bot’s', () => {
    for (const [key, value] of [
      ['TELEGRAM_BOT_TOKEN', 'not-a-token'],
      ['TELEGRAM_WEBHOOK_SECRET', 'short'],
      ['TELEGRAM_WEBHOOK_SECRET', 'has spaces in it 0123456789'],
      ['TELEGRAM_BOT_USERNAME', '@HeyResearchBot'],
      ['TELEGRAM_BOT_USERNAME', 'HeyResearch'],
    ] as const) {
      const parsed = safeParseServerEnv({ ...configured, [key]: value });
      expect(parsed.ok, `${key}=${value}`).toBe(false);
      if (!parsed.ok) expect(parsed.variables).toContain(key);
    }
  });
});
