import { describe, expect, it } from 'vitest';

import { ROBINHOOD_CHAIN_ID } from './constants';
import {
  EnvValidationError,
  isAiEnabled,
  isBuilderAuthConfigured,
  parseServerEnv,
  safeParseServerEnv,
} from './env';

const minimalEnv = {
  DATABASE_URL: 'postgresql://hey:hey@localhost:5432/hey_research',
};

describe('production secrets', () => {
  it('refuses a short SESSION_SECRET in production and accepts a generated one', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://hey:hey@localhost:5432/hey', APP_URL: 'https://hey.example' };
    expect(() => parseServerEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => parseServerEnv({ ...base, SESSION_SECRET: 'a'.repeat(64) })).not.toThrow();
    // Development keeps working with whatever is set.
    expect(() => parseServerEnv({ ...base, NODE_ENV: 'development', SESSION_SECRET: 'short' })).not.toThrow();
  });
});

describe('parseServerEnv', () => {
  it('accepts the minimal local development environment', () => {
    const env = parseServerEnv(minimalEnv);

    expect(env.databaseUrl).toBe(minimalEnv.DATABASE_URL);
    expect(env.nodeEnv).toBe('development');
    expect(env.appUrl).toBe('http://localhost:3000');
  });

  it('defaults the chain to Robinhood Chain', () => {
    expect(parseServerEnv(minimalEnv).chain.chainId).toBe(ROBINHOOD_CHAIN_ID);
    expect(parseServerEnv({ ...minimalEnv, RH_CHAIN_ID: '1' }).chain.chainId).toBe(1);
  });

  it('requires DATABASE_URL', () => {
    const result = safeParseServerEnv({});

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.join(' ')).toContain('DATABASE_URL');
    expect(() => parseServerEnv({})).toThrow(EnvValidationError);
  });

  it('treats empty strings as unset optional values', () => {
    const env = parseServerEnv({ ...minimalEnv, RH_RPC_URL: '', GITHUB_PUBLIC_API_TOKEN: '  ' });

    expect(env.chain.rpcUrl).toBeUndefined();
    expect(env.github.publicApiToken).toBeUndefined();
  });

  it('rejects malformed URLs instead of silently ignoring them', () => {
    const result = safeParseServerEnv({ ...minimalEnv, RH_BLOCKSCOUT_BASE_URL: 'not-a-url' });

    expect(result.ok).toBe(false);
  });

  /** Roles come from the users table (`data:grant-role`); the email allowlist was dead configuration. */
  it('ignores ADMIN_EMAILS entirely', () => {
    const env = parseServerEnv({ ...minimalEnv, ADMIN_EMAILS: 'A@hey.dev, b@hey.dev ,' });

    expect('adminEmails' in env).toBe(false);
  });

  it('provides public market base URLs without requiring configuration', () => {
    const env = parseServerEnv(minimalEnv);

    expect(env.market.dexscreenerBaseUrl).toMatch(/^https:\/\//);
    expect(env.market.geckoterminalBaseUrl).toMatch(/^https:\/\//);
  });
});

describe('isAiEnabled', () => {
  it('is disabled by default so the product works with no AI budget', () => {
    expect(isAiEnabled(parseServerEnv(minimalEnv))).toBe(false);
  });

  it('stays disabled when a provider is set but the budget is zero', () => {
    const env = parseServerEnv({
      ...minimalEnv,
      AI_PROVIDER: 'anthropic',
      AI_API_KEY: 'test-key',
      AI_DAILY_BUDGET_USD: '0',
    });

    expect(isAiEnabled(env)).toBe(false);
  });

  it('is enabled only with a provider, a key and a positive budget', () => {
    const env = parseServerEnv({
      ...minimalEnv,
      AI_PROVIDER: 'anthropic',
      AI_API_KEY: 'test-key',
      AI_DAILY_BUDGET_USD: '5',
    });

    expect(isAiEnabled(env)).toBe(true);
  });
});

describe('chain provider slugs', () => {
  it('defaults both market providers to the live Robinhood Chain slug', () => {
    const env = parseServerEnv(minimalEnv);

    expect(env.chain.dexscreenerSlug).toBe('robinhood');
    expect(env.chain.geckoterminalNetwork).toBe('robinhood');
  });

  it('lets each provider slug be overridden independently', () => {
    const env = parseServerEnv({
      ...minimalEnv,
      RH_DEXSCREENER_CHAIN_SLUG: 'other-dex',
      RH_GECKOTERMINAL_NETWORK: 'other-gecko',
    });

    expect(env.chain.dexscreenerSlug).toBe('other-dex');
    expect(env.chain.geckoterminalNetwork).toBe('other-gecko');
  });
});

describe('builder auth configuration', () => {
  it('is disabled when nothing is configured, so browsing still works', () => {
    expect(isBuilderAuthConfigured(parseServerEnv(minimalEnv))).toBe(false);
  });

  it('needs a session secret and a full GitHub OAuth app', () => {
    const partial = parseServerEnv({ ...minimalEnv, SESSION_SECRET: 's', GITHUB_CLIENT_ID: 'id' });
    expect(isBuilderAuthConfigured(partial)).toBe(false);

    const complete = parseServerEnv({
      ...minimalEnv,
      SESSION_SECRET: 's',
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
    });
    expect(isBuilderAuthConfigured(complete)).toBe(true);
  });
});

describe('$HEY canonical token config (M13)', () => {
  it('defaults to prelaunch with no token address', () => {
    const env = parseServerEnv(minimalEnv);
    expect(env.hey.status).toBe('prelaunch');
    expect(env.hey.tokenAddress).toBeNull();
    expect(env.hey.chainId).toBe(ROBINHOOD_CHAIN_ID);
    expect(env.hey.ponsVersion).toBe('v2');
    expect(env.hey.requestResearchEnabled).toBe(false);
  });

  it('refuses a token address while prelaunch, so a placeholder can never leak', () => {
    const result = safeParseServerEnv({
      ...minimalEnv,
      HEY_TOKEN_ADDRESS: '0x000000000000000000000000000000000000bbbb',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.join(' ')).toContain('HEY_TOKEN_ADDRESS');
  });

  it('refuses live without an address, and a malformed address', () => {
    expect(safeParseServerEnv({ ...minimalEnv, HEY_TOKEN_STATUS: 'live' }).ok).toBe(false);
    expect(
      safeParseServerEnv({ ...minimalEnv, HEY_TOKEN_STATUS: 'live', HEY_TOKEN_ADDRESS: 'HEY' }).ok,
    ).toBe(false);
    expect(
      safeParseServerEnv({ ...minimalEnv, HEY_TOKEN_STATUS: 'live', HEY_TOKEN_ADDRESS: '0x1234' }).ok,
    ).toBe(false);
  });

  it('accepts a live token with a well-formed address', () => {
    const env = parseServerEnv({
      ...minimalEnv,
      HEY_TOKEN_STATUS: 'live',
      HEY_TOKEN_ADDRESS: '0x1111111111111111111111111111111111111111',
      HEY_TREASURY_ADDRESS: '0x2222222222222222222222222222222222222222',
      HEY_PONS_FACTORY: '0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75',
      HEY_PONS_LAUNCH_CONFIG_ID: '0',
      HEY_PONS_DEX_CONFIG_ID: '0',
    });
    expect(env.hey.status).toBe('live');
    expect(env.hey.tokenAddress).toBe('0x1111111111111111111111111111111111111111');
    expect(env.hey.ponsLaunchConfigId).toBe(0);
  });

  it('keeps Request Research off until the token is live', () => {
    expect(safeParseServerEnv({ ...minimalEnv, HEY_REQUEST_RESEARCH_ENABLED: 'true' }).ok).toBe(false);
    const env = parseServerEnv({
      ...minimalEnv,
      HEY_TOKEN_STATUS: 'live',
      HEY_TOKEN_ADDRESS: '0x1111111111111111111111111111111111111111',
      HEY_TREASURY_ADDRESS: '0x2222222222222222222222222222222222222222',
      HEY_REQUEST_RESEARCH_ENABLED: 'true',
      REQUEST_RESEARCH_HEY_AMOUNT: '2500',
    });
    expect(env.hey.requestResearchEnabled).toBe(true);
    expect(env.hey.requestResearchHeyAmount).toBe(2500);
  });

  it('keeps the designed-only utilities switched off', () => {
    const env = parseServerEnv(minimalEnv);
    expect(env.hey.bountiesEnabled).toBe(false);
    expect(env.hey.scoutStakingEnabled).toBe(false);
    expect(env.hey.evidenceChallengesEnabled).toBe(false);
    expect(env.hey.apiCreditsEnabled).toBe(false);
    // Bounties are built (M13-B) but move money: refused unless the token is live with a treasury.
    const bounties = safeParseServerEnv({ ...minimalEnv, HEY_BOUNTIES_ENABLED: 'true' });
    expect(bounties.ok).toBe(false);
    expect(bounties.ok === false && bounties.issues.join(' ')).toContain('HEY_BOUNTIES_ENABLED');
    const bonds = safeParseServerEnv({ ...minimalEnv, HEY_BONDS_ENABLED: 'true' });
    expect(bonds.ok).toBe(false);
    const keys = safeParseServerEnv({ ...minimalEnv, HEY_API_CREDITS_ENABLED: 'true' });
    expect(keys.ok).toBe(false);
    for (const key of [
      'HEY_SCOUT_STAKING_ENABLED',
      'HEY_EVIDENCE_CHALLENGES_ENABLED',
    ]) {
      const result = safeParseServerEnv({ ...minimalEnv, [key]: 'true' });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.issues.join(' ')).toContain(key);
    }
  });

  it('requires a treasury recipient before Request Research can be enabled', () => {
    const result = safeParseServerEnv({
      ...minimalEnv,
      HEY_TOKEN_STATUS: 'live',
      HEY_TOKEN_ADDRESS: '0x1111111111111111111111111111111111111111',
      HEY_REQUEST_RESEARCH_ENABLED: 'true',
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.join(' ')).toContain('HEY_TREASURY_ADDRESS');
  });

  it('renders no wallet UI without a WalletConnect project id, and previews only when asked', () => {
    const env = parseServerEnv(minimalEnv);
    expect(env.hey.walletConnectProjectId).toBeUndefined();
    expect(env.hey.walletPreviewEnabled).toBe(false);
    const preview = parseServerEnv({
      ...minimalEnv,
      WALLETCONNECT_PROJECT_ID: '0123456789abcdef0123456789abcdef',
      HEY_WALLET_PREVIEW_ENABLED: 'true',
    });
    expect(preview.hey.walletConnectProjectId).toBe('0123456789abcdef0123456789abcdef');
    expect(preview.hey.walletPreviewEnabled).toBe(true);
    expect(preview.hey.status).toBe('prelaunch');
  });
});
