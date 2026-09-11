import { defineWorkspace } from 'vitest/config';

/** Unit suites only: adapters run on saved fixtures, and no test may reach the network (vitest.setup.ts). */
export default defineWorkspace([
  {
    esbuild: { jsx: 'automatic' },
    test: {
      name: 'unit',
      environment: 'node',
      setupFiles: ['./vitest.setup.ts'],
      include: ['{apps,packages}/*/src/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
      pool: 'forks',
      retry: 0,
      testTimeout: 15_000,
    },
  },
]);
