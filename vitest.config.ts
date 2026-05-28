// Root vitest config. Picks up tests in both src/main/** (node env) and
// src/client/** (jsdom env) via per-file environment hints, plus the global
// jsdom-by-default for renderer specs which are the majority. Diego owns.
//
// Coverage: ~166 tests expected at Wave-3 entry (David 84 + Ravi 32 + Riley 50).

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const r = (...p: string[]): string => resolve(__dirname, ...p);

export default defineConfig({
  resolve: {
    alias: {
      '@main': r('src/main'),
      '@preload': r('src/preload'),
      '@client': r('src/client'),
      '@ipc': r('src/ipc'),
      '@db': r('src/db'),
      '@shared': r('src/shared'),
    },
  },
  test: {
    // jsdom is the default — most tests are renderer-side React. Main-process
    // tests opt out per-file via `// @vitest-environment node` at the top.
    environment: 'jsdom',
    globals: true,
    setupFiles: [r('vitest.setup.ts')],
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'tests/e2e/**', // Playwright owns e2e
    ],
    // Workers + native modules (better-sqlite3) work best in a forked process pool.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    // Reporters
    reporters: ['default'],
    // No file watching by default in CI; `npm test` calls `vitest run` so this
    // honors that.
  },
});
