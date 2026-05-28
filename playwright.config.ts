// Playwright config. Electron e2e smoke test under tests/e2e/. Diego owns.
// The Electron launch fixture lives inline in tests/e2e/smoke.spec.ts via
// `import { _electron as electron } from '@playwright/test'`.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false, // Electron e2e is heavy; single-worker is safer.
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['junit', { outputFile: 'test-results/playwright-junit.xml' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: 'test-results/',
});
