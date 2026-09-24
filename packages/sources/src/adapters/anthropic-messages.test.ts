import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { ANTHROPIC_VERSION, createAnthropicMessagesAdapter } from './anthropic-messages';

/**
 * The Messages API contract (2026-09-24). The fixture is the documented
 * response shape; CI never calls the provider (CLAUDE.md rule 16).
 */
const input = { apiKey: 'sk-ant-test-secret', model: 'claude-sonnet-5', system: 'Answer from evidence only.', user: 'Question and evidence.', maxTokens: 800 };

describe('anthropic messages', () => {
  it('posts one user message with the key in a header, and returns the text and usage', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('anthropic-messages.json') });
    const result = await createAnthropicMessagesAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const request = stub.requests[0]!;
    expect(request.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request.init?.method).toBe('POST');
    const headers = new Headers(request.init?.headers);
    expect(headers.get('x-api-key')).toBe('sk-ant-test-secret');
    expect(headers.get('anthropic-version')).toBe(ANTHROPIC_VERSION);
    expect(JSON.parse(String(request.init?.body))).toEqual({ model: 'claude-sonnet-5', max_tokens: 800, system: 'Answer from evidence only.', messages: [{ role: 'user', content: 'Question and evidence.' }] });
    expect(request.url).not.toContain('sk-ant');
    expect(result.status).toBe('fresh');
    expect(result.data).toMatchObject({ model: 'claude-sonnet-5', inputTokens: 1834, outputTokens: 61, stopReason: 'end_turn' });
    expect(JSON.parse(result.data!.text)).toMatchObject({ lines: [{ tag: 'FACT', cites: ['s2.l0', 's2.l1', 's2.l2'] }] });
  });

  it('turns a refused key into an error, never data', async () => {
    const stub = stubFetch({ status: 401, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    const result = await createAnthropicMessagesAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
  });

  it('refuses a request without a key or with an unbounded answer', () => {
    const adapter = createAnthropicMessagesAdapter();
    expect(adapter.canHandle({ ...input, apiKey: '' })).toBe(false);
    expect(adapter.canHandle({ ...input, maxTokens: 100_000 })).toBe(false);
  });
});
