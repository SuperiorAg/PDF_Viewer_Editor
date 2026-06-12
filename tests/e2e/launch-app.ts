// Phase 7.3 candidate — shared Electron launch helpers (Diego).
//
// This module hosts the two e2e launch shapes the harness supports:
//
//   1. launchApp(opts)           — DEV shape. Launches `_electron.launch({
//      args: ['.'] })` against the repo root so Electron reads
//      package.json `main` -> dist/main/index.js. Used by every existing
//      spec in tests/e2e/ via in-spec duplicates (those will be migrated
//      to this shared helper opportunistically; this commit only ADDS the
//      module, it does NOT refactor the existing specs — keeping blast
//      radius small per Phase 7.3 candidate scope).
//
//   2. launchPackagedApp(opts)   — PROD shape. Launches a fully-packaged
//      `win-unpacked/PDF Viewer & Editor.exe` produced by
//      `electron-builder --win` (or `--dir`). Resolves to the most-recent
//      `release/smoke-v<X.Y.Z>/win-unpacked/` by default, with an
//      explicit override. Seeds tessdata defensively into the per-test
//      userData dir so OCR-bearing specs can run without relying on the
//      bundled-resources copy.
//
// L-006 IMPORTANT — test-channel availability in packaged binaries:
//
//   The prod-mode bundle (`npm run build`, which `dist:win` uses) applies
//   the Vite `prodNodeEnvDefine` constant fold that DCEs every
//   `__test:*` channel registration site (whichBridge, seedOcrJob,
//   seedSignatureAudit, listSignatureAudit). A binary produced by the
//   default `npm run dist:win` therefore does NOT expose any of those
//   channels at runtime EVEN IF you launch it with env NODE_ENV=test —
//   the gate code physically does not exist in dist/main/index.js or
//   dist/preload/index.js.
//
//   Consequence: specs that drive `__test.*` (e.g. ocr-integration,
//   signed-pdf-ocr-invalidation) cannot be run against a default
//   `dist:win` artifact. To exercise those specs against a packaged
//   binary, an artifact built via `npm run build:test && electron-builder
//   --win` (test-mode bundle, runtime gate live) is required. That is
//   out-of-band of the standard release ceremony — keep the test-mode
//   artifacts strictly local to the e2e harness and NEVER ship them.
//
//   The canonical packaged-smoke spec (tests/e2e/packaged-smoke.spec.ts)
//   intentionally does NOT depend on any `__test.*` channel — it only
//   probes the production empty-state, which works against either
//   bundle. That is the "default smoke" against the release artifact;
//   bridge-introspection specs against a test-bundle packaged binary are
//   a release-ceremony bonus, not a default CI gate (see Change 4 in
//   this commit's scope).
//
// L-002 IMPORTANT — packaged-binary specs are NOT a substitute for the
//   operator-level screenshot. L-002 mandates an operator-level
//   screenshot of the actual rendered UI for every packaging wave; this
//   helper does NOT capture or assert against that artifact. The
//   release ceremony's existing pwsh-based screenshot path remains the
//   load-bearing L-002 evidence.

import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const RELEASE_DIR = resolve(REPO_ROOT, 'release');
const BUNDLED_ENG_GZ = resolve(
  REPO_ROOT,
  'node_modules',
  '@tesseract.js-data',
  'eng',
  '4.0.0',
  'eng.traineddata.gz',
);

export interface ConsoleCollector {
  errors: string[];
}

/**
 * Attach a console listener to a Page that records every 'error'-severity
 * message. Exact-match 'error' — do not loosen to include 'warn' (React
 * DevTools-detection emits a benign log on launch).
 */
export function attachConsoleCollector(page: Page): ConsoleCollector {
  const collector: ConsoleCollector = { errors: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      collector.errors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  return collector;
}

export interface LaunchOpts {
  /** Playwright-managed temp dir per-test (Chromium --user-data-dir switch). */
  userDataDir: string;
  /** Additional env vars merged on top of process.env + NODE_ENV=test. */
  env?: Record<string, string>;
  /** Launch timeout in ms. Default 30_000. */
  timeout?: number;
  /**
   * Optional override for the bundled eng pack source. Defaults to
   * node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz.
   * Pass `null` to skip tessdata seeding entirely.
   */
  tessdataSourceGzPath?: string | null;
}

export interface LaunchResult {
  app: ElectronApplication;
  window: Page;
  consoleCollector: ConsoleCollector;
}

/**
 * Seed the per-test userData/tessdata dir with the bundled eng language
 * pack. The production resolver checks `app.getPath('userData')/tessdata`
 * when the resourcesPath copy is not present (dev launch) AND as a
 * downloaded-pack fallback even when it is. Seeding takes <50 ms and
 * makes OCR-bearing specs robust against either build shape.
 *
 * Throws if the source pack is missing — that's an `npm ci` bug, not a
 * test bug, and silent-fallback would mask it.
 */
function seedTessdata(userDataDir: string, sourceGzPath: string): void {
  if (!existsSync(sourceGzPath)) {
    throw new Error(
      `[launch-app] tessdata source pack missing at ${sourceGzPath}. ` +
        'Did `npm ci` complete? @tesseract.js-data/eng is a direct dependency.',
    );
  }
  const tessdataDir = resolve(userDataDir, 'tessdata');
  mkdirSync(tessdataDir, { recursive: true });
  copyFileSync(sourceGzPath, resolve(tessdataDir, 'eng.traineddata.gz'));
}

/**
 * Wire up the debug-stderr/stdout piping if DEBUG_MAIN_STDERR=1 in the
 * spec env. Identical behaviour to the inline copies in the existing
 * specs.
 */
function attachDebugStdio(app: ElectronApplication): void {
  if (process.env['DEBUG_MAIN_STDERR'] === '1') {
    app.process().stderr?.on('data', (b: Buffer) => {
      process.stderr.write(`[main stderr] ${b.toString()}`);
    });
    app.process().stdout?.on('data', (b: Buffer) => {
      process.stderr.write(`[main stdout] ${b.toString()}`);
    });
  }
}

/**
 * DEV shape: launch Electron with the repo root as cwd. Electron reads
 * package.json `main` -> dist/main/index.js.
 *
 * Requires:
 *   - `npm run build:test` has run (Phase 7.2 — preserves __test channel
 *     gates so the OCR + signature specs can use them; per L-006).
 *   - better-sqlite3 is built for the Electron ABI (`npm run rebuild`).
 *
 * This is the shape every existing spec in tests/e2e/ uses inline. The
 * shared helper is provided so future migration is mechanical; this
 * commit does not migrate the existing specs.
 */
export async function launchApp(opts: LaunchOpts): Promise<LaunchResult> {
  if (opts.tessdataSourceGzPath !== null) {
    seedTessdata(opts.userDataDir, opts.tessdataSourceGzPath ?? BUNDLED_ENG_GZ);
  }

  // Pass --user-data-dir BEFORE the positional '.' so Electron parses it
  // as a Chromium switch (-> app.getPath('userData')) rather than an app
  // argv. Some Electron versions are order-sensitive here; keep the
  // switch first. (Same ordering as the canonical Phase 7.1 spec.)
  const app = await electron.launch({
    args: [`--user-data-dir=${opts.userDataDir}`, '.'],
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'test', ...(opts.env ?? {}) } as Record<string, string>,
    timeout: opts.timeout ?? 30_000,
  });
  attachDebugStdio(app);

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const consoleCollector = attachConsoleCollector(window);
  return { app, window, consoleCollector };
}

export interface PackagedLaunchOpts extends LaunchOpts {
  /**
   * Explicit override for the packaged exe path. Defaults to the
   * most-recent `release/smoke-v<X.Y.Z>/win-unpacked/PDF Viewer &
   * Editor.exe`. Provide this when you want to point at a specific
   * smoke directory or at the legacy `release/win-unpacked/` layout.
   */
  exePath?: string;
}

const EXE_BASENAME = 'PDF Viewer & Editor.exe';

/**
 * Discover the win-unpacked exe path most recently produced by the
 * release pipeline. Search order:
 *
 *   1. release/smoke-v*\/win-unpacked/<EXE_BASENAME> sorted by mtime desc
 *   2. release/win-unpacked/<EXE_BASENAME> (legacy layout)
 *
 * Returns null if no candidate exists.
 */
function discoverDefaultExePath(): string | null {
  if (!existsSync(RELEASE_DIR)) return null;

  // Candidate 1: smoke-v*\/win-unpacked
  const smokeCandidates: { path: string; mtimeMs: number }[] = [];
  for (const entry of readdirSync(RELEASE_DIR)) {
    if (!entry.startsWith('smoke-v')) continue;
    const candidate = resolve(RELEASE_DIR, entry, 'win-unpacked', EXE_BASENAME);
    if (!existsSync(candidate)) continue;
    smokeCandidates.push({ path: candidate, mtimeMs: statSync(candidate).mtimeMs });
  }
  smokeCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (smokeCandidates.length > 0) return smokeCandidates[0]!.path;

  // Candidate 2: legacy release/win-unpacked
  const legacy = resolve(RELEASE_DIR, 'win-unpacked', EXE_BASENAME);
  if (existsSync(legacy)) return legacy;

  return null;
}

/**
 * PROD shape: launch the packaged win-unpacked binary.
 *
 * The exe loads the prod-shape app from resources/app.asar (Electron
 * resolves the entry from app.asar's package.json `main`). Per the
 * L-006 module-header note, the prod-mode bundle has the `__test:*`
 * channels DCE'd; the default packaged-smoke spec deliberately does NOT
 * depend on them. Specs that need `__test.*` against a packaged binary
 * require an artifact built via `npm run build:test && electron-builder
 * --win` (test-mode bundle, runtime gate live).
 *
 * tessdata seeding: the packaged binary ships
 * `resources/tessdata/eng.traineddata.gz`, so OCR works out of the box
 * against `process.resourcesPath`. The helper STILL seeds the per-test
 * userData/tessdata dir defensively — that gives parity with the dev
 * helper and protects specs that build a test-mode artifact (which may
 * skip the resources/tessdata copy step depending on
 * electron-builder.yml `extraResources` evaluation under custom build
 * modes).
 *
 * @throws if the exe cannot be located (no smoke dir AND no legacy
 *   release/win-unpacked). The error message names the recovery step.
 */
export async function launchPackagedApp(opts: PackagedLaunchOpts): Promise<LaunchResult> {
  const exePath = opts.exePath ?? discoverDefaultExePath();
  if (exePath === null) {
    throw new Error(
      '[launch-app] No packaged binary found. Searched:\n' +
        `  - ${RELEASE_DIR}/smoke-v*/win-unpacked/${EXE_BASENAME}\n` +
        `  - ${RELEASE_DIR}/win-unpacked/${EXE_BASENAME}\n` +
        'Run `npm run dist:win` (production) or ' +
        '`npm run build:test && npx electron-builder --dir --win` (test-channel bundle) ' +
        'and then re-run this spec.',
    );
  }
  if (!existsSync(exePath)) {
    throw new Error(
      `[launch-app] launchPackagedApp: exePath does not exist: ${exePath}. ` +
        'Was the win-unpacked tree moved or deleted?',
    );
  }

  if (opts.tessdataSourceGzPath !== null) {
    seedTessdata(opts.userDataDir, opts.tessdataSourceGzPath ?? BUNDLED_ENG_GZ);
  }

  const app = await electron.launch({
    executablePath: exePath,
    args: [`--user-data-dir=${opts.userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test', ...(opts.env ?? {}) } as Record<string, string>,
    timeout: opts.timeout ?? 30_000,
  });
  attachDebugStdio(app);

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const consoleCollector = attachConsoleCollector(window);
  return { app, window, consoleCollector };
}
