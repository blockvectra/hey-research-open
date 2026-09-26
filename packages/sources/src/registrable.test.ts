import { describe, expect, it } from 'vitest';

import { registrableHost, SHARED_HOSTING_SUFFIXES, sharedHostingSuffix } from './registrable';

describe('registrableHost', () => {
  it('keeps the last two labels of an ordinary domain', () => {
    expect(registrableHost('docs.agentos.xyz')).toBe('agentos.xyz');
    expect(registrableHost('www.AgentOS.xyz')).toBe('agentos.xyz');
    expect(registrableHost('agentos.xyz.')).toBe('agentos.xyz');
  });

  it('takes three labels under a multi-part public suffix (2026-09-17)', () => {
    expect(registrableHost('blog.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableHost('co.uk')).toBeUndefined();
  });

  /*
   * Audit G finding 2 (2026-09-27): every *.vercel.app site had the registrable
   * domain `vercel.app`, so a repository whose homepage was any Vercel site
   * counted as pointing back at every Vercel project. Nine official repository
   * matches on Verified Builder pages in production named another tenant.
   */
  it('treats each tenant of a shared host as its own site', () => {
    expect(registrableHost('layer0-robinhood.vercel.app')).toBe('layer0-robinhood.vercel.app');
    expect(registrableHost('veyra-sigma-ten.vercel.app')).toBe('veyra-sigma-ten.vercel.app');
    expect(registrableHost('layer0-robinhood.vercel.app')).not.toBe(registrableHost('veyra-sigma-ten.vercel.app'));
    expect(registrableHost('docs.mine.vercel.app')).toBe('mine.vercel.app');
    expect(registrableHost('wooyang.github.io')).toBe('wooyang.github.io');
    expect(registrableHost('app.lovable.app')).toBe('app.lovable.app');
    expect(registrableHost('site.netlify.app')).toBe('site.netlify.app');
    expect(registrableHost('team.gitbook.io')).toBe('team.gitbook.io');
  });

  it('reads the longest suffix: a multi-label shared suffix keeps the tenant, not the platform', () => {
    expect(registrableHost('divstream-production.up.railway.app')).toBe('divstream-production.up.railway.app');
    expect(registrableHost('cash85eth.cash85official.workers.dev')).toBe('cash85official.workers.dev');
    expect(registrableHost('beta.walletbeat.eth.limo')).toBe('walletbeat.eth.limo');
    expect(registrableHost('app.on.fleek.co')).toBe('app.on.fleek.co');
  });

  it('has no registrable domain for a bare shared suffix, so it matches nothing', () => {
    for (const suffix of ['vercel.app', 'github.io', 'up.railway.app', 'eth.limo']) {
      expect(registrableHost(suffix)).toBeUndefined();
    }
  });

  it('only makes matching stricter: every suffix is lower-case, dot-free at the ends and listed once', () => {
    expect(new Set(SHARED_HOSTING_SUFFIXES).size).toBe(SHARED_HOSTING_SUFFIXES.length);
    for (const suffix of SHARED_HOSTING_SUFFIXES) {
      expect(suffix).toBe(suffix.toLowerCase());
      expect(suffix.startsWith('.') || suffix.endsWith('.')).toBe(false);
      expect(suffix.split('.').length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('sharedHostingSuffix', () => {
  it('names the platform a tenant lives on, and nothing for an own domain', () => {
    expect(sharedHostingSuffix('robinhood-score.vercel.app')).toBe('vercel.app');
    expect(sharedHostingSuffix('x.up.railway.app')).toBe('up.railway.app');
    expect(sharedHostingSuffix('agentos.xyz')).toBeUndefined();
    expect(sharedHostingSuffix('acme.co.uk')).toBeUndefined();
  });
});
