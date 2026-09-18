import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

/**
 * One file anyone can run with `npx` (2026-09-05; publishable 2026-09-19).
 *
 * The server talks to HEY over HTTP through `@hey-research/sdk`, which is
 * bundled in from source rather than depended on: a user running `npx -y
 * @hey-research/mcp` gets one file and two runtime dependencies (the MCP
 * SDK and zod), and the SDK version inside is stamped here because bundling
 * from source bypasses the SDK's own build and its define.
 */
const version = (path: string): string => (JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // Node 18 and 20 are what `npx` most often finds on a laptop; nothing here needs newer.
  target: 'node18',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: [/^@hey\//, '@hey-research/sdk'],
  define: {
    __MCP_VERSION__: JSON.stringify(version('./package.json')),
    __SDK_VERSION__: JSON.stringify(version('../../packages/sdk/package.json')),
  },
  banner: { js: '#!/usr/bin/env node' },
});
