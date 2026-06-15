// Phase 7.3 candidate — packaged-binary smoke spec (Diego).
//
// What this spec does:
//
//   1. Locate the most-recent `release/smoke-v<X.Y.Z>/win-unpacked/PDF
//      Viewer & Editor.exe` via `launchPackagedApp`'s default discovery
//      (or fall back to `release/win-unpacked/` legacy layout).
//   2. Launch it through Playwright's Electron driver against a
//      Playwright-managed per-test userData dir.
//   3. Wait for the renderer DOM to load, assert the empty-state copy
//      is visible (Riley's "Open a PDF to get started" string), and
//      assert the production preload bridge has attached
//      `window.pdfApi.fs.readPdf`.
//
// What this spec deliberately does NOT do:
//
//   - Probe any `__test:*` channel. The default `npm run dist:win`
//     build mode constant-folds `process.env.NODE_ENV` to "production"
//     and Rollup DCEs every test-channel registration site (per
//     L-006). A binary produced by the standard release ceremony
//     therefore does not expose `__test.whichBridge`,
//     `__test.seedOcrJob`, `__test.seedSignatureAudit`, or
//     `__test.listSignatureAudit` — even when launched with
//     `NODE_ENV=test`. This spec is calibrated against the standard
//     release-ceremony artifact and only exercises the production
//     surface.
//
//   - Run OCR. The OCR-bearing flows are covered by
//     `tests/e2e/ocr-integration.spec.ts` against the dev launch shape
//     (`_electron.launch({ args: ['.'] })` + `npm run build:test`).
//     Running them against a packaged binary requires a test-mode
//     `electron-builder --win` invocation (`npm run build:test &&
//     npx electron-builder --dir --win`), which is out-of-band of the
//     standard release pipeline. That is a release-ceremony bonus, not
//     a default gate.
//
// CI gating (Change 4 of the Phase 7.3 candidate scope):
//
//   This spec is NOT part of the default `npm run e2e` gate. The CI
//   workflow's `e2e` job builds a test-mode bundle and launches via
//   the dev shape against the repo root; it does not produce a
//   win-unpacked artifact at that point (the `build` job runs after
//   `e2e` and is the only job that runs `dist:win`). Adding this spec
//   to the `e2e` job would create a circular dependency: the spec
//   needs an artifact from the `build` job, but the `build` job's
//   gate is the green `e2e` run.
//
//   Operationally this spec is run:
//     a) Locally by Diego (or any release engineer) during the smoke
//        ceremony as a sanity gate on the win-unpacked tree, with
//        `npm run e2e -- --grep "packaged-smoke"`.
//     b) As a future post-build CI job that consumes the
//        `windows-installers` artifact from the `build` job and runs
//        this spec against the unpacked tree. Tracked as a Phase 7.3
//        follow-up; not in scope for this commit.
//
// Local run:
//   npm run e2e -- --grep "packaged-smoke"
//
// Prerequisites:
//   - `release/smoke-v<X.Y.Z>/win-unpacked/` exists (produced by
//     `npm run dist:win` and the smoke ceremony).
//   - better-sqlite3 has been rebuilt for the Electron ABI (the
//     packaged binary already carries this from the build).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { discoverDefaultExePath, launchPackagedApp } from './launch-app';

const BUDGET_BRIDGE_READY_MS = 15_000;

/**
 * Wait for the production preload bridge to attach `window.pdfApi.fs.readPdf`.
 * That property is mounted by `src/preload/index.ts` and is present in BOTH
 * prod and test bundles — it's the load-bearing renderer-side entry to the
 * `fs:readPdf` IPC channel and a reliable post-bootstrap sentinel.
 */
async function waitForProdBridge(window: Page, label: string): Promise<void> {
  await window
    .waitForFunction(
      () => {
        const w = window as unknown as {
          pdfApi?: { fs?: { readPdf?: unknown } };
        };
        return typeof w.pdfApi?.fs?.readPdf === 'function';
      },
      undefined,
      { timeout: BUDGET_BRIDGE_READY_MS },
    )
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[${label}] production preload bridge did not attach within ` +
          `${String(BUDGET_BRIDGE_READY_MS)}ms. Is the win-unpacked tree intact ` +
          `(preload script present + signed)? Underlying: ${message}`,
      );
    });
}

// CI gating: this spec runs ONLY when a packaged binary exists on disk.
// Default CI `e2e` job runs BEFORE `build`, so no `release/.../win-unpacked/`
// exists and the spec is skipped — preserving Diego's "release-ceremony bonus"
// intent without turning the e2e job red. Locally and during the smoke
// ceremony the v0.7.X smoke dir is present and the spec runs.
function probePackagedBinaryExists(): boolean {
  try {
    return discoverDefaultExePath() !== null;
  } catch {
    return false;
  }
}

test.describe('Phase 7.3 candidate — packaged-binary smoke', () => {
  let userDataDir: string;

  test.skip(
    !probePackagedBinaryExists(),
    'No packaged binary found under release/smoke-v*/win-unpacked/ — ' +
      'run `npm run dist:win` (or the release smoke ceremony) to enable this spec.',
  );

  test.beforeEach(() => {
    userDataDir = mkdtempSync(resolve(tmpdir(), 'pdfve-packaged-smoke-'));
  });

  test.afterEach(() => {
    if (process.env['DEBUG_PRESERVE_USERDATA'] === '1') {
      console.log(`[afterEach] preserving userData at ${userDataDir}`);
      return;
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // ignore lingering Electron file locks; OS will clean the temp dir
    }
  });

  test('packaged win-unpacked binary launches and renders the empty state', async () => {
    // Single-purpose smoke: prove the helper resolves a packaged exe,
    // Playwright drives it, and the renderer reaches a healthy
    // empty-state. No __test channel probes — those would be DCE'd
    // out of the standard release artifact (L-006).
    test.setTimeout(45_000);

    const { app, window, consoleCollector } = await launchPackagedApp({
      userDataDir,
      // tessdata seeding is harmless against a prod artifact (resources
      // tessdata wins), but keep it on for parity with the dev shape and
      // so this spec doesn't go stale if someone later adds an OCR probe.
    });

    try {
      // 1. Production preload bridge attached.
      await waitForProdBridge(window, 'packaged-smoke launch');

      // 2. Empty-state copy renders. Same gold-standard string used by
      //    smoke.spec.ts (Riley's component, ui-spec §3).
      await expect(window.getByText(/Open a PDF to get started/i)).toBeVisible({
        timeout: 10_000,
      });

      // 3. No console errors during the launch + empty-state render.
      //    Exact-match 'error' filter (consistent with the canonical
      //    Phase 7.1 spec — React DevTools-detection logs at 'log', not
      //    'error', so this gate is not over-strict).
      expect(
        consoleCollector.errors,
        `Console errors during packaged-smoke launch: ${consoleCollector.errors.join(' | ')}`,
      ).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
