import { describe, expect, it } from 'vitest';

import { SOURCE_ERROR_CODES, SourceError, errorCodeForStatus, isRetryableErrorCode, isRetryableInProcess, redactSecrets } from './errors';

describe('normalized error model', () => {
  it('maps HTTP statuses onto the shared codes', () => {
    expect(errorCodeForStatus(404)).toBe('NOT_FOUND');
    expect(errorCodeForStatus(410)).toBe('NOT_FOUND');
    expect(errorCodeForStatus(429)).toBe('RATE_LIMITED');
    expect(errorCodeForStatus(500)).toBe('UPSTREAM_ERROR');
    expect(errorCodeForStatus(503)).toBe('UPSTREAM_ERROR');
    expect(errorCodeForStatus(400)).toBe('INVALID_RESPONSE');
    expect(errorCodeForStatus(403)).toBe('INVALID_RESPONSE');
  });

  it('retries only transient conditions', () => {
    expect(isRetryableErrorCode('TIMEOUT')).toBe(true);
    expect(isRetryableErrorCode('NETWORK')).toBe(true);
    expect(isRetryableErrorCode('RATE_LIMITED')).toBe(true);
    expect(isRetryableErrorCode('UPSTREAM_ERROR')).toBe(true);
  });

  it('never retries conditions a repeat request cannot change', () => {
    for (const code of [
      'NOT_FOUND',
      'INVALID_RESPONSE',
      'BLOCKED_URL',
      'DNS_UNRESOLVED',
      'TOO_LARGE',
      'UNSUPPORTED_CONTENT_TYPE',
    ] as const) {
      expect(isRetryableErrorCode(code)).toBe(false);
    }
  });

  it('classifies every declared code exactly once', () => {
    expect(new Set(SOURCE_ERROR_CODES).size).toBe(SOURCE_ERROR_CODES.length);
    for (const code of SOURCE_ERROR_CODES) {
      expect(typeof isRetryableErrorCode(code)).toBe('boolean');
    }
  });

  it('carries the provider cool-off on a SourceError', () => {
    const error = new SourceError('RATE_LIMITED', 'slow down', 429, 30);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.retryAfterMs).toBe(30_000);
    expect(error.status).toBe(429);
  });

  it('keeps a 429 out of the in-process retry set while the job layer may still retry it (round-8, 2026-09-18)', () => {
    expect(isRetryableInProcess('RATE_LIMITED')).toBe(false);
    expect(isRetryableInProcess('PACED')).toBe(false);
    for (const code of ['TIMEOUT', 'NETWORK', 'UPSTREAM_ERROR'] as const) expect(isRetryableInProcess(code)).toBe(true);
    for (const code of ['NOT_FOUND', 'INVALID_RESPONSE', 'BLOCKED_URL', 'TOO_LARGE', 'UNSUPPORTED_CONTENT_TYPE'] as const) {
      expect(isRetryableInProcess(code)).toBe(false);
    }
    expect(new SourceError('RATE_LIMITED', 'x', 429, 1).retryableInProcess).toBe(false);
  });
});

describe('a SourceError never carries a credential', () => {
  it('redacts a key from the message whoever built it', () => {
    // The real shape: the explorer's URL, with the account key as a query
    // parameter, inside a message that reached a signed-in reader (2026-09-15).
    const error = new SourceError('RATE_LIMITED', 'https://api.blockscout.com/v2/api?chain_id=4663&apikey=s3cr3t responded 429', 429);
    expect(error.message).toContain('REDACTED');
    expect(error.message).not.toContain('s3cr3t');
    expect(error.message).toContain('chain_id=4663');
  });

  it('covers the other names a credential travels under', () => {
    for (const param of ['api_key', 'key', 'token', 'access_token', 'auth', 'password']) {
      const error = new SourceError('NETWORK', `https://x.example/a?${param}=hunter2&page=2 failed`);
      expect(error.message).not.toContain('hunter2');
      expect(error.message).toContain('page=2');
    }
  });

  it('leaves a message with no credential in it alone', () => {
    expect(new SourceError('TIMEOUT', 'request to https://x.example/a?page=2 timed out').message).toBe(
      'request to https://x.example/a?page=2 timed out',
    );
  });

  it('never carries a key in a URL path segment or userinfo (S1, 2026-10-16)', () => {
    const key = 'a1B2c3D4e5F6g7H8i9J0kLmN';
    const error = new SourceError('UPSTREAM_ERROR', `request to https://eth.example-rpc.io/v2/${key} timed out`);
    expect(error.message).toBe('request to https://eth.example-rpc.io/v2/REDACTED timed out');
    expect(redactSecrets(`fetch failed for https://user:${key}@api.example.com/x?apikey=${key}`)).toBe('fetch failed for https://REDACTED@api.example.com/x?apikey=REDACTED');
    expect(redactSecrets(`wss://node.example.com/ws/${key}/stream#frag`)).toBe('wss://node.example.com/ws/REDACTED/stream#frag');
    // Short route words stay readable; text that is not a URL is untouched.
    expect(redactSecrets('https://api.github.com/repos/owner/repo/releases?per_page=10 answered 502')).toBe('https://api.github.com/repos/owner/repo/releases?per_page=10 answered 502');
    expect(redactSecrets(`a plain sentence with ${key} in it`)).toBe(`a plain sentence with ${key} in it`);
    expect(new SourceError('NETWORK', `no route to https://host.example/${key}`).message).not.toContain(key);
  });
});
