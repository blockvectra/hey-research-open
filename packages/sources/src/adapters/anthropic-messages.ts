import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';

/**
 * The Anthropic Messages API (2026-09-24), for the one optional use HEY makes
 * of a model: composing an Ask HEY answer from evidence lines HEY already
 * holds. Off unless `AI_PROVIDER=anthropic`, a key and a daily budget are set
 * (`isAiEnabled`); never called from a page request, only from the worker.
 *
 * The request carries no reader data beyond the question and the evidence
 * lines; the response is validated here for shape and by the caller for
 * content — every line it keeps must cite evidence that exists.
 */
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

export type MessagesInput = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
};

export type MessagesOutput = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
};

const responseSchema = z.object({
  model: z.string(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
  stop_reason: z.string().nullish(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).passthrough(),
});

export function createAnthropicMessagesAdapter(): SourceAdapter<MessagesInput, MessagesOutput> {
  return {
    name: 'anthropic',
    canHandle(input) {
      return Boolean(input.apiKey) && Boolean(input.model) && input.maxTokens > 0 && input.maxTokens <= 4096;
    },
    async fetch(input, ctx: SourceContext): Promise<SourceResult<MessagesOutput>> {
      return performSourceFetch(
        ctx,
        {
          url: ANTHROPIC_MESSAGES_URL,
          method: 'POST',
          conditional: false,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-api-key': input.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model: input.model,
            max_tokens: input.maxTokens,
            system: input.system,
            messages: [{ role: 'user', content: input.user }],
          }),
          maxBytes: 512 * 1024,
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 0,
          normalize: (raw): MessagesOutput => ({
            text: raw.content
              .filter((block) => block.type === 'text' && typeof block.text === 'string')
              .map((block) => block.text)
              .join(''),
            model: raw.model,
            inputTokens: raw.usage.input_tokens,
            outputTokens: raw.usage.output_tokens,
            ...(raw.stop_reason ? { stopReason: raw.stop_reason } : {}),
          }),
        },
      );
    },
  };
}
