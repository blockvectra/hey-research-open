import type { ZodType } from 'zod';

import { errorResult, resolveNow, type SourceContext, type SourceResult } from '../adapter';
import { SourceError } from '../errors';
import { httpRequest, type HttpRequest, type HttpResponse } from './client';

export type PerformOptions<TRaw, TOut> = {
  /** Runtime validation of the external payload (CLAUDE.md rule 15). */
  schema: ZodType<TRaw>;
  /** Text -> unknown. JSON for APIs, an XML/HTML parser for documents. */
  parse: (body: string) => unknown;
  /** Validated payload -> HEY's normalized shape. */
  normalize: (raw: TRaw, response: HttpResponse) => TOut;
  cacheTtlSeconds: number;
};

/**
 * Shared adapter body: fetch, validate, normalize, and convert every failure into
 * a `SourceResult`. Adapters do not throw, so one provider failing degrades that
 * source only (PRD V4 section 50).
 */
export async function performSourceFetch<TRaw, TOut>(
  ctx: SourceContext,
  request: HttpRequest,
  options: PerformOptions<TRaw, TOut>,
): Promise<SourceResult<TOut>> {
  try {
    const outcome = await httpRequest(request, ctx);

    if (outcome.kind === 'not_modified') {
      // Unchanged upstream: callers keep cached data and skip downstream work.
      return {
        fetchedAt: resolveNow(ctx),
        sourceUrl: request.url,
        cacheTtlSeconds: options.cacheTtlSeconds,
        status: 'not_modified',
        ...(ctx.etag === undefined ? {} : { etag: ctx.etag }),
        ...(ctx.lastModified === undefined ? {} : { lastModified: ctx.lastModified }),
      };
    }

    const { response } = outcome;

    let parsed: unknown;
    try {
      parsed = options.parse(response.body);
    } catch (error) {
      return errorResult(ctx, 'INVALID_RESPONSE', `unparseable body: ${describe(error)}`, {
        sourceUrl: request.url,
      });
    }

    const validated = options.schema.safeParse(parsed);
    if (!validated.success) {
      const detail = validated.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; ');
      return errorResult(ctx, 'INVALID_RESPONSE', `schema mismatch (${detail})`, {
        sourceUrl: request.url,
      });
    }

    return {
      data: options.normalize(validated.data, response),
      fetchedAt: resolveNow(ctx),
      sourceUrl: response.url ?? request.url,
      cacheTtlSeconds: options.cacheTtlSeconds,
      status: 'fresh',
      ...(response.etag === undefined ? {} : { etag: response.etag }),
      ...(response.lastModified === undefined ? {} : { lastModified: response.lastModified }),
    };
  } catch (error) {
    if (error instanceof SourceError) {
      return errorResult(ctx, error.code, error.message, {
        sourceUrl: request.url,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
      });
    }
    return errorResult(ctx, 'NETWORK', describe(error), { sourceUrl: request.url });
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown error';
