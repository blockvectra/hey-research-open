import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

/**
 * The published bundle (2026-09-19): ESM and CommonJS with declarations for
 * each, targeting a neutral platform because the client leans on nothing
 * but `fetch`, `URL` and `AbortController`. The version is stamped in so the
 * user-agent names the release exactly; see src/version.ts.
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2022',
  platform: 'neutral',
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
});
