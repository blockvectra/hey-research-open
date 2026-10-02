import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { stubFetch, testContext } from '../testing';
import { performSourceFetch } from './perform';

const options = {
  schema: z.array(z.unknown()),
  parse: (body: string): unknown => JSON.parse(body),
  normalize: (raw: unknown[]) => raw.length,
  cacheTtlSeconds: 60,
};

describe('performSourceFetch on a 304', () => {
  it('reports the URL that answered, so a redirect before an unchanged body is still seen (OA-A, 2026-10-02)', async () => {
    const stub = stubFetch([
      { status: 301, headers: { location: 'https://api.github.com/repositories/1369635198/releases' } },
      { status: 304 },
    ]);
    const result = await performSourceFetch(
      testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"abc"' }),
      { url: 'https://api.github.com/repos/odaiin/assetfare-mcp/releases', enforceUrlSafety: false },
      options,
    );

    expect(result.status).toBe('not_modified');
    expect(result.sourceUrl).toBe('https://api.github.com/repositories/1369635198/releases');
    expect(result.etag).toBe('W/"abc"');
    expect(result.data).toBeUndefined();
  });

  it('keeps the requested URL when nothing redirected', async () => {
    const stub = stubFetch({ status: 304 });
    const result = await performSourceFetch(
      testContext({ fetchImpl: stub.fetchImpl, etag: 'W/"abc"' }),
      { url: 'https://api.github.com/repos/agentos/core/releases' },
      options,
    );

    expect(result.status).toBe('not_modified');
    expect(result.sourceUrl).toBe('https://api.github.com/repos/agentos/core/releases');
  });
});
