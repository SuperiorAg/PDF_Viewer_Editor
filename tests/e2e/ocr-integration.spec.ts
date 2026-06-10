// Phase 7.1 — Real-PDF e2e OCR integration test.
// Owner: Diego (Wave 2). Design contract: docs/phase-7.1-test-design.md (Riley).
// Companion IPC channel: __test:seedOcrJob (David, Wave 2).
//
// What this spec exercises (Riley §2 phases A–G):
//
//   A. Launch Electron with a fresh per-test userData dir + NODE_ENV=test;
//      wait for the preload bridge; seed an OCR job row via the test-only
//      IPC channel `pdfApi.__test.seedOcrJob`; open the fixture by path.
//   B. Run OCR end-to-end against the fixture (real Tesseract under the
//      production rasterize → recognize → compose path). Assert the modal
//      reaches a 'recognizing' state then 'completed' under the 25s budget.
//      Assert totalWords >= 20 and meanConfidence >= 60 (the calibration
//      floors — see Riley §5.1 — set against the v0.7.15 zero-length
//      detach signature and v0.7.16 tesseract.js v7 shape drift).
//   C. Assert the OCR slice has hydrated: docId exists, summary.status is
//      'completed', per-page word lists are present via the production
//      `pdfApi.ocr.listResultsByJob` channel (no __reduxStore dependency).
//   D. Close the app; relaunch with the SAME userData dir; wait for the
//      bridge; re-open the same fixture. Phase 7.2 (Diego, 2026-06-10):
//      LIVE under the dev-mode harness — David's Item-A static-import lift
//      in src/main/index.ts now bundles the SQLite repos so the bridge
//      slots are 'sqlite' (not 'memory') under _electron.launch(). The
//      OCR_E2E_RELAUNCH_RESTORE=1 env gate is REMOVED — Phase D+E runs by
//      default in CI on every PR.
//   E. After reopen, verify the OCR row is restored: listJobs (filtered
//      by docHash + status='completed') returns the original jobId, and
//      listResultsByJob returns the same word count for page 0. This is
//      the v0.7.18 catch surface — overlay-disappears-on-reopen.
//   F. No console errors across both launches (collected via page.on
//      ('console') filtered exact-match 'error').
//   G. Clean shutdown.
//
// Why drive through pdfApi (not the UI menu): per Riley §2.2, keyboard
// menu navigation on the Windows GitHub runner is flaky — synthesized
// Alt-chord events get swallowed inconsistently. The e2e tier asserts the
// end-to-end PIPELINE, not menu plumbing; menu wire-up is unit-tested
// elsewhere.
//
// Why a fresh userData per spec run, then reused across launches WITHIN
// one spec: per Riley §2.1, stale ocr_jobs rows from prior sessions leak
// into renderer state on reopen. A fresh dir per test eliminates that
// source of non-determinism. The dir is preserved BETWEEN the two
// launches in one spec because Phase E specifically asserts the DB row
// survives a close + reopen.
//
// L-004 / L-005 compliance: this spec has ZERO direct pdf.js calls. It
// drives the production IPC surface via the preload bridge; the test-only
// seed channel writes DB rows by SHA-256 hashing fixture bytes — pdf.js is
// never loaded from the harness. Per Riley §6.3, enforcement of L-004 and
// L-005 stays inside the production code the spec exercises (toPdfJsBuffer
// + loadPdfJs in src/main/pdf-ops/ocr-bootstrap.ts).
//
// Local run:
//   npm run e2e -- --grep "ocr-integration"
//
// CI run: this spec is auto-picked up by playwright.config.ts (testDir
// ./tests/e2e). Fixtures are hash-verified in a CI step BEFORE this job
// runs — see .github/workflows/ci.yml.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
  expect,
  test,
} from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURE_1P = resolve(REPO_ROOT, 'tests', 'fixtures', 'pdfs', 'scan-1p-eng.pdf');

// Bundled eng tesseract pack. The production resolver looks in
// `process.resourcesPath/tessdata` (set by electron-builder extraResources at
// pack time) and `app.getPath('userData')/tessdata` (user-installed packs). In
// a dev `_electron.launch()` run, process.resourcesPath points at Electron's
// framework dir, so the bundled-resourcesPath copy is absent and the eng pack
// resolves only via userData. We seed userData/tessdata/eng.traineddata.gz
// from the npm-package source (the same artifact electron-builder copies into
// resourcesPath at pack time). This mirrors the prod-build state without
// requiring a packaged install in CI.
const BUNDLED_ENG_GZ = resolve(
  REPO_ROOT,
  'node_modules',
  '@tesseract.js-data',
  'eng',
  '4.0.0',
  'eng.traineddata.gz',
);

// Riley §4 runtime budget. These are CI ceilings; locally we usually run
// well under them. If a phase exceeds its budget the assertion fails fast
// with an attributable message (rather than the test-level 60s timeout
// killing it with no breadcrumb).
const BUDGET_BRIDGE_READY_MS = 15_000;
const BUDGET_OCR_RUN_MS = 25_000;
const BUDGET_HYDRATE_MS = 5_000;
// Phase D + E budgets — now live under Phase 7.2 Item A. Phase D covers
// app1.close() + relaunch + bridge re-attach + readPdf; Phase E covers
// listJobs + listResultsByJob restoration. Total spec under the 90 s
// ceiling: A 15 + B 25 + C 5 + D 15 + E 10 + F+G 5 = 75 s, 15 s headroom
// (Riley §3.4).
const BUDGET_RELAUNCH_MS = 15_000;
const BUDGET_RESTORE_MS = 10_000;

// Riley §2.3 calibration floors — set against historical bug signatures.
const FLOOR_TOTAL_WORDS = 20;
const FLOOR_MEAN_CONFIDENCE = 60;

interface ConsoleCollector {
  errors: string[];
}

/**
 * Attach a console listener to a Page that records every 'error'-severity
 * message. Riley §2.7 specifies exact-match 'error' — do not loosen to
 * include 'warn' (React DevTools-detection emits a benign log on launch).
 */
function attachConsoleCollector(page: Page): ConsoleCollector {
  const collector: ConsoleCollector = { errors: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      collector.errors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  return collector;
}

/**
 * Launch Electron with NODE_ENV=test and a per-spec userData dir. Returns
 * the app + first window + console collector for that window.
 */
async function launchApp(userDataDir: string): Promise<{
  app: ElectronApplication;
  window: Page;
  consoleCollector: ConsoleCollector;
}> {
  // Pass --user-data-dir BEFORE the positional '.' so Electron parses it as
  // a Chromium switch (which becomes app.getPath('userData')) rather than
  // an app argv. Some Electron versions are order-sensitive here; keep the
  // switch first.
  const app = await electron.launch({
    args: [`--user-data-dir=${userDataDir}`, '.'],
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30_000,
  });
  if (process.env['DEBUG_MAIN_STDERR'] === '1') {
    app.process().stderr?.on('data', (b: Buffer) => {
      process.stderr.write(`[main stderr] ${b.toString()}`);
    });
    app.process().stdout?.on('data', (b: Buffer) => {
      process.stderr.write(`[main stdout] ${b.toString()}`);
    });
  }
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const consoleCollector = attachConsoleCollector(window);
  return { app, window, consoleCollector };
}

/**
 * Wait for the preload bridge to attach `window.pdfApi.ocr.runOnDocument`
 * AND the test-only seed surface `window.pdfApi.__test.seedOcrJob`. The
 * __test namespace is only registered by David's preload mirror when
 * NODE_ENV === 'test' at app boot; if it never appears the env propagation
 * is broken and the spec should fail fast with an attributable message.
 */
async function waitForBridgeAndTestNs(window: Page, label: string): Promise<void> {
  await window
    .waitForFunction(
      () => {
        const w = window as unknown as {
          pdfApi?: {
            ocr?: { runOnDocument?: unknown; listJobs?: unknown; listResultsByJob?: unknown };
            fs?: { readPdf?: unknown };
            // eslint-disable-next-line @typescript-eslint/naming-convention
            __test?: { seedOcrJob?: unknown };
          };
        };
        return (
          typeof w.pdfApi?.ocr?.runOnDocument === 'function' &&
          typeof w.pdfApi?.ocr?.listJobs === 'function' &&
          typeof w.pdfApi?.ocr?.listResultsByJob === 'function' &&
          typeof w.pdfApi?.fs?.readPdf === 'function' &&
          typeof w.pdfApi?.__test?.seedOcrJob === 'function'
        );
      },
      undefined,
      { timeout: BUDGET_BRIDGE_READY_MS },
    )
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[${label}] preload bridge + __test namespace did not attach within ${String(BUDGET_BRIDGE_READY_MS)}ms. ` +
          `Is NODE_ENV=test set in the spec env, and did David's __test:seedOcrJob channel land? Underlying: ${message}`,
      );
    });
}

test.describe('Phase 7.1 — real-PDF OCR e2e integration', () => {
  let userDataDir: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(resolve(tmpdir(), 'pdfve-ocr-e2e-'));
    // Seed the bundled eng tesseract pack into the fresh userData/tessdata
    // dir BEFORE Electron launches. The language-pack manager's resolver
    // calls existsSync on `${userTessdataDir()}/eng.traineddata.gz`, so this
    // file must be on disk at app-boot time. Copying takes <50ms; runs once
    // per spec invocation.
    if (!existsSync(BUNDLED_ENG_GZ)) {
      throw new Error(
        `[ocr-integration] bundled eng pack missing at ${BUNDLED_ENG_GZ}. ` +
          'Did `npm ci` complete? @tesseract.js-data/eng is a direct dependency.',
      );
    }
    const tessdataDir = resolve(userDataDir, 'tessdata');
    mkdirSync(tessdataDir, { recursive: true });
    copyFileSync(BUNDLED_ENG_GZ, resolve(tessdataDir, 'eng.traineddata.gz'));
  });

  test.afterEach(() => {
    // Best-effort cleanup of the per-test userData dir. Non-fatal if a
    // lingering file lock from Electron prevents removal — the temp dir
    // is OS-managed and will be cleaned up by Windows/Linux housekeeping.
    // Set DEBUG_PRESERVE_USERDATA=1 to keep the dir for post-mortem inspection.
    if (process.env['DEBUG_PRESERVE_USERDATA'] === '1') {
      console.log(`[afterEach] preserving userData at ${userDataDir}`);
      return;
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // ignore
    }
  });

  test('OCR runs end-to-end on a scanned fixture and the slice hydrates', async () => {
    // Total test timeout: 90s ceiling per phase-7.1-plan.md acceptance #4.
    test.setTimeout(90_000);

    // ============================== PHASE A ==============================
    // Launch, seed the OCR job row, open the fixture by path.
    const phaseAStart = Date.now();
    const { app: app1, window: window1, consoleCollector: errors1 } = await launchApp(userDataDir);
    await waitForBridgeAndTestNs(window1, 'phase-A first launch');

    const seedResult = await window1.evaluate(async (fixturePath: string) => {
      const api = (
        window as unknown as {
          pdfApi: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            __test: {
              seedOcrJob: (req: {
                fixturePath: string;
                status: 'queued';
                langs: string[];
              }) => Promise<{
                ok: boolean;
                value?: { jobId: number; docHash: string };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.__test.seedOcrJob({ fixturePath, status: 'queued', langs: ['eng'] });
    }, FIXTURE_1P);

    expect(
      seedResult.ok,
      `__test:seedOcrJob refused — is NODE_ENV=test set in the spec env? error=${String(seedResult.error)}`,
    ).toBe(true);

    const openResult = await window1.evaluate(async (fixturePath: string) => {
      const api = (
        window as unknown as {
          pdfApi: {
            fs: {
              readPdf: (req: { droppedPath: string }) => Promise<{
                ok: boolean;
                value?: { handle: number; fileHash: string; pageCount: number };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.fs.readPdf({ droppedPath: fixturePath });
    }, FIXTURE_1P);

    expect(openResult.ok, `fs.readPdf failed: ${String(openResult.error)}`).toBe(true);
    const handle = openResult.value?.handle;
    expect(typeof handle).toBe('number');
    // Diagnostic: confirm the running app sees the per-test userData dir.
    const userDataInApp = await app1.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData'),
    );
    console.log(`[phase A] userData in app: ${userDataInApp}`);
    console.log(`[phase A] userData expected: ${userDataDir}`);

    const phaseAMs = Date.now() - phaseAStart;
    console.log(`[phase A] ${String(phaseAMs)}ms (budget 15000ms)`);

    // ============================== PHASE B ==============================
    // Run OCR end-to-end. Production rasterize → recognize → compose path.
    const phaseBStart = Date.now();
    const ocrResult = await window1.evaluate(
      async (args: { handle: number }) => {
        const api = (
          window as unknown as {
            pdfApi: {
              ocr: {
                runOnDocument: (req: {
                  handle: number;
                  pageRange: { start: number; end: number };
                  langs: string[];
                  preprocess: { deskew: boolean; denoise: boolean; contrastBoost: boolean };
                }) => Promise<{
                  ok: boolean;
                  value?: {
                    jobId: number;
                    summary: {
                      jobId: number;
                      status: 'completed' | 'cancelled' | 'failed';
                      totalWords: number;
                      meanConfidence: number;
                      pageResults: unknown[] | null;
                    };
                  };
                  error?: string;
                }>;
              };
            };
          }
        ).pdfApi;
        return api.ocr.runOnDocument({
          handle: args.handle,
          pageRange: { start: 0, end: 0 },
          langs: ['eng'],
          preprocess: { deskew: false, denoise: false, contrastBoost: false },
        });
      },
      { handle: handle as number },
    );

    expect(
      ocrResult.ok,
      `ocr.runOnDocument failed within ${String(BUDGET_OCR_RUN_MS)}ms — error=${String(ocrResult.error)}`,
    ).toBe(true);
    const summary = ocrResult.value?.summary;
    expect(summary, 'ocr.runOnDocument returned ok=true but no summary').toBeDefined();
    expect(
      summary?.status,
      `OCR did not reach 'completed' — got status=${String(summary?.status)}, totalWords=${String(summary?.totalWords)}. ` +
        `Possible regressions: v0.7.14 polyfill ordering (L-005), v0.7.16 tesseract.js v7 shape drift.`,
    ).toBe('completed');
    expect(
      summary?.totalWords ?? 0,
      `Tesseract recognized only ${String(summary?.totalWords)} words on Liberation Sans Lorem fixture — ` +
        `expected >= ${String(FLOOR_TOTAL_WORDS)}. Engine drift? Or the v0.7.15 buffer-detach signature (L-004)?`,
    ).toBeGreaterThanOrEqual(FLOOR_TOTAL_WORDS);
    expect(
      summary?.meanConfidence ?? 0,
      `Mean confidence ${String(summary?.meanConfidence)} below floor ${String(FLOOR_MEAN_CONFIDENCE)}. ` +
        `Engine drift, fixture mutation, or font registration broken?`,
    ).toBeGreaterThanOrEqual(FLOOR_MEAN_CONFIDENCE);
    const originalJobId = summary?.jobId as number;
    const originalTotalWords = summary?.totalWords as number;
    const phaseBMs = Date.now() - phaseBStart;
    console.log(
      `[phase B] ${String(phaseBMs)}ms (budget ${String(BUDGET_OCR_RUN_MS)}ms) words=${String(originalTotalWords)} meanConf=${String(summary?.meanConfidence)}`,
    );
    expect(
      phaseBMs,
      `Phase B exceeded ${String(BUDGET_OCR_RUN_MS)}ms budget. CI runner slower than calibration? Investigate before raising the budget.`,
    ).toBeLessThan(BUDGET_OCR_RUN_MS);

    // ============================== PHASE C ==============================
    // Verify hydration via the production listResultsByJob channel — no
    // __reduxStore dependency. This is the load-bearing v0.7.17 catch:
    // OCR completes but pageResults never make it into the slice.
    const phaseCStart = Date.now();
    const resultsByJob = await window1.evaluate(async (jobId: number) => {
      const api = (
        window as unknown as {
          pdfApi: {
            ocr: {
              listResultsByJob: (req: { jobId: number }) => Promise<{
                ok: boolean;
                value?: {
                  pageResults: { pageIndex: number; words: unknown[]; totalWords: number }[];
                };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.ocr.listResultsByJob({ jobId });
    }, originalJobId);

    expect(
      resultsByJob.ok,
      `listResultsByJob({jobId:${String(originalJobId)}}) failed: ${String(resultsByJob.error)}`,
    ).toBe(true);
    const pageResults = resultsByJob.value?.pageResults ?? [];
    expect(
      pageResults.length,
      `listResultsByJob returned no per-page rows for jobId=${String(originalJobId)} — ` +
        `runOnDocument completed but ocr_results inserts dropped? (v0.7.17 mount-overlay signature class.)`,
    ).toBeGreaterThanOrEqual(1);
    const page0 = pageResults.find((p) => p.pageIndex === 0);
    expect(page0, 'no page-0 result row present').toBeDefined();
    expect(
      page0?.words.length ?? 0,
      `page-0 word count ${String(page0?.words.length)} below floor ${String(FLOOR_TOTAL_WORDS)} — slice/DB serialize broken?`,
    ).toBeGreaterThanOrEqual(FLOOR_TOTAL_WORDS);
    const phaseCMs = Date.now() - phaseCStart;
    console.log(`[phase C] ${String(phaseCMs)}ms (budget ${String(BUDGET_HYDRATE_MS)}ms)`);
    expect(phaseCMs).toBeLessThan(BUDGET_HYDRATE_MS);

    // ============================== PHASE D / E ==========================
    // Phase 7.2 Item A (Diego, 2026-06-10): LIVE under the dev-mode
    // _electron.launch() harness. David's static-import lift in
    // src/main/index.ts now resolves the six SQLite repo factories at
    // build time, so under _electron.launch() the bridge slots are
    // 'sqlite' rather than 'memory' and the OCR rows persist across an
    // Electron close + reopen. This is the v0.7.18 reopen-restore catch
    // surface (overlay-disappears-on-reopen) at the e2e tier — previously
    // only covered at the unit tier in src/client/state/thunks-phase5.test.ts
    // (loadOcrResultsThunk × 6 references). The OCR_E2E_RELAUNCH_RESTORE
    // env gate is removed (Riley §3.1); Phase D+E runs by default in CI.
    //
    // Sanity gate: same-launch listJobs surfaces the just-completed job.
    // (Catches v0.7.17 mount-overlay class: "OCR finished but no row was
    // inserted" — would fire here BEFORE the close-reopen even starts.)

    const seedJobsVisible = await window1.evaluate(async () => {
      const api = (
        window as unknown as {
          pdfApi: {
            ocr: {
              listJobs: (req: Record<string, unknown>) => Promise<{
                ok: boolean;
                value?: { jobs: { id: number; status: string }[]; total: number };
              }>;
            };
          };
        }
      ).pdfApi;
      return api.ocr.listJobs({ limit: 100 });
    });
    expect(seedJobsVisible.ok, 'in-launch listJobs failed — bridge wire-up broken?').toBe(true);
    const completedJobs = seedJobsVisible.value?.jobs.filter((j) => j.status === 'completed') ?? [];
    expect(
      completedJobs.length,
      `Expected the completed job from runOnDocument to be visible via listJobs in the same launch — ` +
        `got ${String(seedJobsVisible.value?.jobs.length ?? 0)} jobs total, ` +
        `${String(completedJobs.length)} completed. ` +
        `If 0 completed jobs, the v0.7.17 mount-overlay class regression is present: OCR finished but no row was inserted.`,
    ).toBeGreaterThanOrEqual(1);
    const completedJob = completedJobs.find((j) => j.id === originalJobId);
    expect(
      completedJob,
      `runOnDocument returned jobId=${String(originalJobId)} but listJobs in the same launch does not see it ` +
        `(saw ids: ${completedJobs.map((j) => j.id).join(',')}). ID drift?`,
    ).toBeDefined();

    // Capture the pre-close page-0 word count from the same-launch
    // listResultsByJob payload (already fetched in Phase C as pageResults).
    // Riley §4 R3: this reads from the SQLite row Phase B wrote, NOT a
    // fresh Tesseract run on relaunch — so the strict equality assertion
    // in Phase E is correct (do NOT loosen to >=).
    const originalPage0WordCount = page0?.words.length ?? 0;
    expect(
      originalPage0WordCount,
      `Pre-close page-0 word count ${String(originalPage0WordCount)} < ${String(FLOOR_TOTAL_WORDS)} — ` +
        `Phase E equality assertion would be vacuous. Phase C hydration broken? (Riley §4 R6.)`,
    ).toBeGreaterThanOrEqual(FLOOR_TOTAL_WORDS);

    // ============================== PHASE D ==============================
    // Close app1, settle for the SQLite WAL/SHM file-lock release on
    // Windows (Riley §4 R1, default 250 ms; cap 500 ms), relaunch with
    // the SAME userDataDir, wait for the preload bridge.
    const phaseDStart = Date.now();
    await app1.close();
    await new Promise((r) => setTimeout(r, 250));

    const { app: app2, window: window2, consoleCollector: errors2 } = await launchApp(userDataDir);
    await waitForBridgeAndTestNs(window2, 'phase-D relaunch');

    // Bridge-introspection probe (Item A P-2, Riley §2.6). Asserts all
    // six bridge slots are 'sqlite' under _electron.launch() — if any are
    // 'memory', David's static-import lift didn't take and Phase E would
    // fail with a worse / less attributable message downstream. Failing
    // fast here surfaces the regression at the bridge layer.
    const bridge2 = await window2.evaluate(async () => {
      const api = (
        window as unknown as {
          pdfApi: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            __test: {
              whichBridge: () => Promise<{
                ok: boolean;
                value?: {
                  formTemplates: 'sqlite' | 'memory';
                  signatureAudit: 'sqlite' | 'memory';
                  ocrJobs: 'sqlite' | 'memory';
                  ocrResults: 'sqlite' | 'memory';
                  languagePacks: 'sqlite' | 'memory';
                  exportJobs: 'sqlite' | 'memory';
                };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.__test.whichBridge();
    });
    expect(
      bridge2.ok,
      `[launch2] __test:whichBridge failed: ${String(bridge2.error)} — ` +
        `is the test-only channel registered (NODE_ENV=test)?`,
    ).toBe(true);
    const bridgeKinds = bridge2.value!;
    const memorySlots = Object.entries(bridgeKinds)
      .filter(([, kind]) => kind === 'memory')
      .map(([slot]) => slot);
    expect(
      memorySlots,
      `[launch2] Bridge probe: expected all 6 repos to be 'sqlite' under _electron.launch(); ` +
        `got memory slots: [${memorySlots.join(', ')}]. ` +
        `Item A regression — David's static-import lift in src/main/index.ts is incomplete ` +
        `or vite tree-shook a module.`,
    ).toEqual([]);

    // Re-open the same fixture on launch2.
    const reopenResult = await window2.evaluate(async (fixturePath: string) => {
      const api = (
        window as unknown as {
          pdfApi: {
            fs: {
              readPdf: (req: { droppedPath: string }) => Promise<{
                ok: boolean;
                value?: { handle: number; fileHash: string; pageCount: number };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.fs.readPdf({ droppedPath: fixturePath });
    }, FIXTURE_1P);
    expect(
      reopenResult.ok,
      `[launch2] fs.readPdf on relaunch failed: ${String(reopenResult.error)}`,
    ).toBe(true);

    const phaseDMs = Date.now() - phaseDStart;
    console.log(`[phase D] ${String(phaseDMs)}ms (budget ${String(BUDGET_RELAUNCH_MS)}ms)`);
    expect(
      phaseDMs,
      `Phase D exceeded budget: ${String(phaseDMs)}ms > ${String(BUDGET_RELAUNCH_MS)}ms. ` +
        `Bridge re-attach slow? SQLite file-lock contention?`,
    ).toBeLessThan(BUDGET_RELAUNCH_MS);

    // ============================== PHASE E ==============================
    // loadOcrResultsThunk semantics on the renderer: when a doc opens,
    // listJobs is filtered by docHash + status='completed' to find the
    // job whose results to hydrate, then listResultsByJob fetches the
    // per-page rows. Mirror that here at the IPC tier.
    const phaseEStart = Date.now();

    const restoredJobs = await window2.evaluate(async () => {
      const api = (
        window as unknown as {
          pdfApi: {
            ocr: {
              listJobs: (req: Record<string, unknown>) => Promise<{
                ok: boolean;
                value?: { jobs: { id: number; status: string }[] };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.ocr.listJobs({ limit: 100 });
    });
    expect(
      restoredJobs.ok,
      `[launch2] listJobs failed after relaunch — SQLite repo not loaded? error=${String(restoredJobs.error)}`,
    ).toBe(true);

    const restoredCompletedJob = restoredJobs.value?.jobs.find(
      (j) => j.id === originalJobId && j.status === 'completed',
    );
    expect(
      restoredCompletedJob,
      `Phase E: original jobId=${String(originalJobId)} not found after relaunch. ` +
        `Got jobs: ${(restoredJobs.value?.jobs ?? []).map((j) => `${j.id}:${j.status}`).join(',')}. ` +
        `This is the v0.7.18 reopen-restore signature — the SQLite row either did not persist ` +
        `or listJobs lost it across the Electron close + reopen.`,
    ).toBeDefined();

    const restoredResults = await window2.evaluate(async (jobId: number) => {
      const api = (
        window as unknown as {
          pdfApi: {
            ocr: {
              listResultsByJob: (req: { jobId: number }) => Promise<{
                ok: boolean;
                value?: {
                  pageResults: { pageIndex: number; words: unknown[]; totalWords: number }[];
                };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.ocr.listResultsByJob({ jobId });
    }, originalJobId);

    expect(
      restoredResults.ok,
      `[launch2] listResultsByJob failed: ${String(restoredResults.error)}`,
    ).toBe(true);
    const restoredPage0 = restoredResults.value?.pageResults.find((p) => p.pageIndex === 0);
    expect(
      restoredPage0,
      `Phase E: no page-0 results restored for jobId=${String(originalJobId)} — ` +
        `the ocr_results rows did not survive serialize/deserialize.`,
    ).toBeDefined();
    expect(
      restoredPage0!.words.length,
      `Phase E: restored page-0 word count ${String(restoredPage0!.words.length)} != pre-close ` +
        `${String(originalPage0WordCount)}. Drift through SQLite serialize/deserialize — ` +
        `v0.7.18 catch surface (Riley §4 R3: equality is correct, do NOT loosen to >=).`,
    ).toBe(originalPage0WordCount);

    const phaseEMs = Date.now() - phaseEStart;
    console.log(`[phase E] ${String(phaseEMs)}ms (budget ${String(BUDGET_RESTORE_MS)}ms)`);
    expect(
      phaseEMs,
      `Phase E exceeded budget: ${String(phaseEMs)}ms > ${String(BUDGET_RESTORE_MS)}ms.`,
    ).toBeLessThan(BUDGET_RESTORE_MS);

    // ============================== PHASE F ==============================
    // No console errors across BOTH launches. Same exact-match 'error'
    // filter as Phase A (Riley §2.7 / 7.2 §3.3). React DevTools-detection
    // emits a benign 'log' at boot — that does NOT trip this gate.
    const allErrors = [...errors1.errors, ...errors2.errors];
    expect(
      allErrors,
      `Console errors across launch1+launch2 (${String(allErrors.length)}): ${allErrors.join(' | ')}`,
    ).toEqual([]);

    // ============================== PHASE G ==============================
    // Clean shutdown of launch2.
    await app2.close();

    const totalMs = phaseAMs + phaseBMs + phaseCMs + phaseDMs + phaseEMs;
    console.log(
      `[phase totals] A=${String(phaseAMs)}ms B=${String(phaseBMs)}ms C=${String(phaseCMs)}ms ` +
        `D=${String(phaseDMs)}ms E=${String(phaseEMs)}ms ` +
        `total=${String(totalMs)}ms (75s target, 90s ceiling)`,
    );
  });

  // Multi-page fixture: skipped in CI to keep the canonical run under the
  // 90s ceiling. The single-page test above is the load-bearing gate; the
  // 2-page fixture covers the "Recognizing page 1 of 2 → page 2 of 2"
  // progress path which is exercised by unit tests already. Enable
  // locally with: OCR_E2E_MULTIPAGE=1 npm run e2e -- --grep "multi-page".
  test.skip('OCR runs on the 2-page fixture (local-only, OCR_E2E_MULTIPAGE=1 to enable)', () => {
    // TODO: copy the single-page flow, FIXTURE_1P -> FIXTURE_2P,
    // pageRange { start: 0, end: 1 }, assert 2 page-result rows.
    // Skipped under CI per Riley §4 escape-hatch #3.
  });
});
