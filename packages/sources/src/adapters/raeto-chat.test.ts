import { describe, expect, it } from 'vitest';

import { readFixture, stubFetch, testContext } from '../testing';
import { createRaetoChatAdapter } from './raeto-chat';

/**
 * Raeto's OpenAI-compatible chat completions contract (2026-10-29). The fixture is the
 * OpenAI response shape Raeto documents; CI never calls the provider (CLAUDE.md rule 16).
 */
const input = { apiKey: 'raeto-test-secret', model: 'raeto/auto', system: 'Answer from evidence only.', user: 'Question and evidence.', maxTokens: 800 };

describe('raeto chat completions', () => {
  it('posts a system and a user message with the key as a bearer token, and returns the text, usage and the model that answered', async () => {
    const stub = stubFetch({ status: 200, body: readFixture('raeto-chat-completions.json') });
    const result = await createRaetoChatAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    const request = stub.requests[0]!;
    expect(request.url).toBe('https://api.raeto.cc/v1/chat/completions');
    expect(request.init?.method).toBe('POST');
    expect(new Headers(request.init?.headers).get('authorization')).toBe('Bearer raeto-test-secret');
    expect(JSON.parse(String(request.init?.body))).toEqual({
      model: 'raeto/auto',
      max_tokens: 800,
      messages: [
        { role: 'system', content: 'Answer from evidence only.' },
        { role: 'user', content: 'Question and evidence.' },
      ],
    });
    expect(request.url).not.toContain('raeto-test-secret');
    expect(result.status).toBe('fresh');
    expect(result.data).toMatchObject({ model: 'openai/gpt-4o-mini', inputTokens: 1834, outputTokens: 61, stopReason: 'stop' });
    expect(JSON.parse(result.data!.text)).toMatchObject({ lines: [{ tag: 'FACT', cites: ['s2.l0', 's2.l1', 's2.l2'] }] });
  });

  it('says a refusal as the refusal stop reason the provider declines on', async () => {
    const body = JSON.stringify({
      model: 'openai/gpt-4o-mini',
      choices: [{ message: { role: 'assistant', content: null, refusal: 'I cannot help with that.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    });
    const result = await createRaetoChatAdapter().fetch(input, testContext({ fetchImpl: stubFetch({ status: 200, body }).fetchImpl }));
    expect(result.data).toMatchObject({ text: '', stopReason: 'refusal' });
  });

  it('turns a refused key into an error, never data', async () => {
    const stub = stubFetch({ status: 401, body: JSON.stringify({ error: { message: 'invalid api key' } }) });
    const result = await createRaetoChatAdapter().fetch(input, testContext({ fetchImpl: stub.fetchImpl }));
    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
  });

  it('refuses a request without a key or with an unbounded answer', () => {
    const adapter = createRaetoChatAdapter();
    expect(adapter.canHandle({ ...input, apiKey: '' })).toBe(false);
    expect(adapter.canHandle({ ...input, maxTokens: 100_000 })).toBe(false);
  });
});
