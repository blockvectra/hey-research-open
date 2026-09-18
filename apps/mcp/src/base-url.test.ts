import { describe, expect, it } from 'vitest';

import { DEFAULT_BASE_URL } from '@hey-research/sdk';

import { resolveBaseUrl } from './base-url';

/**
 * Where the API key may travel (round-9 security, 2026-09-19).
 *
 * `HEY_API_URL` comes from whatever launched the server — an assistant's
 * config file, a shell profile, a shared devcontainer — and `HEY_API_KEY`
 * rides on every request the client makes, so a plaintext or foreign base URL
 * is a key handed over. The refusal happens before the transport connects.
 */
describe('resolveBaseUrl', () => {
  it('defaults to the public site', () => {
    expect(resolveBaseUrl(undefined)).toEqual({ baseUrl: DEFAULT_BASE_URL, origin: DEFAULT_BASE_URL });
    expect(resolveBaseUrl('  ')).toEqual({ baseUrl: DEFAULT_BASE_URL, origin: DEFAULT_BASE_URL });
  });

  it('accepts https anywhere, and trims the trailing slash', () => {
    expect(resolveBaseUrl('https://staging.heyresearch.xyz/')).toEqual({
      baseUrl: 'https://staging.heyresearch.xyz',
      origin: 'https://staging.heyresearch.xyz',
    });
    expect(resolveBaseUrl('https://hey.test:8443')).toEqual({ baseUrl: 'https://hey.test:8443', origin: 'https://hey.test:8443' });
  });

  it('accepts http only on the loopback host a developer runs HEY on', () => {
    expect(resolveBaseUrl('http://localhost:3000').origin).toBe('http://localhost:3000');
    expect(resolveBaseUrl('http://127.0.0.1:3000').origin).toBe('http://127.0.0.1:3000');
    expect(resolveBaseUrl('http://[::1]:3000').origin).toBe('http://[::1]:3000');
  });

  it('refuses plaintext anywhere else, and says why', () => {
    for (const value of ['http://heyresearch.xyz', 'http://192.168.1.10:3000', 'http://collector.example']) {
      expect(() => resolveBaseUrl(value), value).toThrow(/clear text/);
    }
  });

  it('refuses a scheme that is neither, and a string that is not a URL', () => {
    expect(() => resolveBaseUrl('ftp://heyresearch.xyz')).toThrow(/must be https/);
    expect(() => resolveBaseUrl('file:///etc/passwd')).toThrow(/must be https/);
    expect(() => resolveBaseUrl('localhost:3000')).toThrow(/must be https/);
    expect(() => resolveBaseUrl('not a url')).toThrow(/not a URL/);
  });
});
