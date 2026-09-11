import { describe, expect, it } from 'vitest';

import {
  errorCodeForStatus,
  isRetryableErrorCode,
  SOURCE_ERROR_CODES,
  SourceError,
} from './errors';

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
    expect(error.status).toBe(429);
  });
});
