import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // The server talks to HEY over HTTP, so it shares no workspace code and
  // ships as a single file anyone can run without the monorepo.
  noExternal: [/^@hey\//],
  banner: { js: '#!/usr/bin/env node' },
});
