import { z } from 'zod';

import { type SourceAdapter, type SourceContext, type SourceResult } from '../adapter';
import { performSourceFetch } from '../http/perform';
import { type MessagesInput, type MessagesOutput } from './anthropic-messages';

/**
 * Raeto's OpenAI-compatible chat completions (2026-10-29, founder "setuju"): the second
 * model provider behind the research layer, beside Anthropic's Messages API. Raeto routes
 * a request to a model of its choosing when the model is `raeto/auto`, and bills it from
 * a USDG-funded balance on Robinhood Chain; the reply names the model that answered.
 *
 * The same boundary as the Anthropic adapter: off unless `AI_PROVIDER=raeto`, a key and a
 * daily budget are set (`isAiEnabled`); only the worker calls it, never a page request; the
 * request carries the prompt template and HEY's public evidence lines, never reader data.
 */
export const RAETO_CHAT_COMPLETIONS_URL = 'https://api.raeto.cc/v1/chat/completions';

const responseSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z
        .object({
          message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }).passthrough(),
          finish_reason: z.string().nullish(),
        })
        .passthrough(),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).passthrough(),
});

export function createRaetoChatAdapter(): SourceAdapter<MessagesInput, MessagesOutput> {
  return {
    name: 'raeto',
    canHandle(input) {
      return Boolean(input.apiKey) && Boolean(input.model) && input.maxTokens > 0 && input.maxTokens <= 8192;
    },
    async fetch(input, ctx: SourceContext): Promise<SourceResult<MessagesOutput>> {
      return performSourceFetch(
        ctx,
        {
          url: RAETO_CHAT_COMPLETIONS_URL,
          method: 'POST',
          conditional: false,
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${input.apiKey}`,
          },
          body: JSON.stringify({
            model: input.model,
            max_tokens: input.maxTokens,
            messages: [
              { role: 'system', content: input.system },
              { role: 'user', content: input.user },
            ],
          }),
          maxBytes: 512 * 1024,
        },
        {
          schema: responseSchema,
          parse: (body) => JSON.parse(body) as unknown,
          cacheTtlSeconds: 0,
          normalize: (raw): MessagesOutput => {
            const choice = raw.choices[0]!;
            // An OpenAI-style refusal is said in its own field; it maps to the Anthropic stop reason the provider already declines on.
            const refused = Boolean(choice.message.refusal) || choice.finish_reason === 'content_filter';
            const stopReason = refused ? 'refusal' : choice.finish_reason;
            return {
              text: choice.message.content ?? '',
              model: raw.model,
              inputTokens: raw.usage.prompt_tokens,
              outputTokens: raw.usage.completion_tokens,
              ...(stopReason ? { stopReason } : {}),
            };
          },
        },
      );
    },
  };
}
