// Phase 7.2 7.2.4 — Signed-PDF + OCR invalidation backref e2e.
// Owner: Diego (dev-ops-agent). Closes Julian Phase 7.2 re-review §9.
//
// What this spec exercises:
//
//   The production path: signed PDF → OCR runs → audit rows resolved + marked.
//
//   1. PHASE A — Launch Electron with a fresh userDataDir + NODE_ENV=test;
//      probe `__test:whichBridge` to confirm SQLite is wired in all six
//      slots (same gate the canonical Phase 7.1 spec relies on); open the
//      signed-1p-eng.pdf fixture by path; seed a signature_audit_log row
//      keyed by (fixture-docHash, 'Signature1') via `__test:seedSignatureAudit`.
//
//   2. PHASE B — Read the audit row back via `__test:listSignatureAudit` and
//      assert pre-OCR state: row exists, `invalidatedByOcrJobId === null`.
//
//   3. PHASE C — Run OCR end-to-end via the production
//      `pdfApi.ocr.runOnDocument` channel with `invalidatesSignaturesConfirmed:
//      true`. The handler's PAdES pre-flight calls `detectPriorPadesSignatures`
//      against the fixture, gets `['Signature1']`, threads that through the
//      run, and on completion dispatches
//      `signatureAudit.markInvalidatedByOcrJob(docHash, ['Signature1'], jobId)`
//      via the bridge adapter at `src/main/db-bridge.ts:1785-1808`. The
//      adapter resolves the rowId by reading current rows for the doc and
//      filtering on field_name, then forwards to Ravi's repo's bulk UPDATE.
//
//   4. PHASE D — Read the audit row back AGAIN. Assert post-OCR state:
//      `invalidatedByOcrJobId === <newJobId>` (strict equality with the
//      jobId returned by runOnDocument).
//
//   5. PHASE E — Clean shutdown.
//
// Why a separate spec (not folded into ocr-integration.spec.ts):
//   Single-responsibility (Riley's Phase 7.1 design preference, §1.2): the
//   canonical OCR e2e asserts the rasterize → recognize → compose → reopen-
//   restore loop on a scanned PDF; this spec asserts ONLY the OCR-invalidation
//   back-ref on a signed PDF. Different fixtures, different assertion targets,
//   different failure-mode attribution. Keeping them separate means a future
//   regression in either path has a clear single-spec attribution.
//
// L-004 / L-005 compliance: this spec drives the production IPC surface;
// pdf.js is never loaded from the test harness. Enforcement of the locks
// stays in `src/main/pdf-ops/ocr-bootstrap.ts` (toPdfJsBuffer + loadPdfJs)
// which the production OCR run exercises.
//
// L-006 compliance: every test-only channel used here is the dot-syntax
// registration-time gate pattern (see
// `src/ipc/handlers/test-seed-signature-audit.ts`,
// `src/ipc/handlers/test-list-signature-audit.ts`). The prod-build define-
// fold DCEs all four (`seedOcrJob`, `whichBridge`, `seedSignatureAudit`,
// `listSignatureAudit`) from `dist/main/index.js` + `dist/preload/index.js`.
//
// Local run:
//   npm run e2e -- --grep "signed-PDF"
//
// CI run: this spec is auto-picked up by playwright.config.ts
// (testDir ./tests/e2e). The signed-1p-eng.pdf fixture is hash-verified in
// the same CI step as the canonical scan fixtures — see
// .github/workflows/ci.yml "Verify OCR fixture hashes".

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
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
const FIXTURE_SIGNED_1P = resolve(REPO_ROOT, 'tests', 'fixtures', 'pdfs', 'signed-1p-eng.pdf');
const BUNDLED_ENG_GZ = resolve(
  REPO_ROOT,
  'node_modules',
  '@tesseract.js-data',
  'eng',
  '4.0.0',
  'eng.traineddata.gz',
);

// The signed fixture's pre-authored signature field name. Pinned to match
// what `node-signpdf`'s `plainAddPlaceholder` writes; if the fixture-gen
// script changes the field name, update this constant in lock-step.
const EXPECTED_SIGNATURE_FIELD_NAME = 'Signature1';

/**
 * Compute the docHash the production OCR handler will see for a file on
 * disk. The OCR handler calls `deps.getDocHash(handle)` which is wired in
 * `src/ipc/register.ts:950` to `documentStore.get(h)?.fileHash`, which in
 * turn is the value `fs:readPdf` computes via `computeFileHash(path)` in
 * `src/main/pdf-ops/file-hash.ts`. That algorithm is:
 *
 *   SHA-256( first 64 KiB of file bytes  ||  ASCII string of file size )
 *
 * NOT a raw SHA-256 of the full file. Mirroring it here means the seeded
 * audit row carries the same docHash the bridge adapter will later filter
 * on when it resolves rowIds for `markInvalidatedByOcrJob`.
 */
function computeFileHashLikeProduction(path: string): string {
  const HEAD_BYTES = 64 * 1024;
  const st = statSync(path);
  const bytes = readFileSync(path);
  const head = bytes.subarray(0, Math.min(HEAD_BYTES, bytes.length));
  const h = createHash('sha256');
  h.update(head);
  h.update(String(st.size), 'ascii');
  return h.digest('hex');
}

// Budget ceilings — tighter than ocr-integration.spec.ts since this spec
// runs OCR on a 1-page fixture and skips the relaunch-restore phase.
const BUDGET_BRIDGE_READY_MS = 15_000;
const BUDGET_OCR_RUN_MS = 25_000;
const BUDGET_TOTAL_MS = 60_000;

interface ConsoleCollector {
  errors: string[];
}

function attachConsoleCollector(page: Page): ConsoleCollector {
  const collector: ConsoleCollector = { errors: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      collector.errors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  return collector;
}

async function launchApp(userDataDir: string): Promise<{
  app: ElectronApplication;
  window: Page;
  consoleCollector: ConsoleCollector;
}> {
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

async function waitForBridgeAndTestNs(window: Page, label: string): Promise<void> {
  await window
    .waitForFunction(
      () => {
        const w = window as unknown as {
          pdfApi?: {
            ocr?: { runOnDocument?: unknown };
            fs?: { readPdf?: unknown };
            // eslint-disable-next-line @typescript-eslint/naming-convention
            __test?: {
              whichBridge?: unknown;
              seedSignatureAudit?: unknown;
              listSignatureAudit?: unknown;
            };
          };
        };
        return (
          typeof w.pdfApi?.ocr?.runOnDocument === 'function' &&
          typeof w.pdfApi?.fs?.readPdf === 'function' &&
          typeof w.pdfApi?.__test?.whichBridge === 'function' &&
          typeof w.pdfApi?.__test?.seedSignatureAudit === 'function' &&
          typeof w.pdfApi?.__test?.listSignatureAudit === 'function'
        );
      },
      undefined,
      { timeout: BUDGET_BRIDGE_READY_MS },
    )
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[${label}] preload bridge + __test namespace did not attach within ${String(BUDGET_BRIDGE_READY_MS)}ms. ` +
          `Is NODE_ENV=test set? Did the seedSignatureAudit + listSignatureAudit channels land? Underlying: ${message}`,
      );
    });
}

test.describe('Phase 7.2 7.2.4 — signed-PDF OCR invalidation backref', () => {
  let userDataDir: string;

  test.beforeEach(() => {
    userDataDir = mkdtempSync(resolve(tmpdir(), 'pdfve-signed-ocr-e2e-'));
    // Mirror the canonical OCR spec's tessdata setup — the production
    // language-pack resolver looks under `app.getPath('userData')/tessdata`
    // for the eng pack when `process.resourcesPath` doesn't carry it (which
    // is the case under `_electron.launch()`).
    if (!existsSync(BUNDLED_ENG_GZ)) {
      throw new Error(
        `[signed-pdf-ocr-invalidation] bundled eng pack missing at ${BUNDLED_ENG_GZ}. ` +
          'Did `npm ci` complete? @tesseract.js-data/eng is a direct dependency.',
      );
    }
    const tessdataDir = resolve(userDataDir, 'tessdata');
    mkdirSync(tessdataDir, { recursive: true });
    copyFileSync(BUNDLED_ENG_GZ, resolve(tessdataDir, 'eng.traineddata.gz'));
  });

  test.afterEach(() => {
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

  test('OCR on signed PDF marks the prior audit row with the invalidating jobId', async () => {
    test.setTimeout(BUDGET_TOTAL_MS);
    const specStart = Date.now();

    // Pre-compute the docHash the production OCR handler will see. The
    // handler resolves it via `documentStore.get(h)?.fileHash` which is
    // the value `fs:readPdf` computes via `computeFileHash(path)` (see
    // src/main/pdf-ops/file-hash.ts). That algorithm is NOT a raw SHA-256
    // of the bytes; it's SHA-256(first 64 KiB || asciiSize). Mirror it
    // here so the seeded audit row carries the same docHash the bridge
    // adapter will later filter on.
    const fixtureDocHash = computeFileHashLikeProduction(FIXTURE_SIGNED_1P);
    const fixtureBytes = readFileSync(FIXTURE_SIGNED_1P);
    console.log(
      `[signed-ocr-e2e] fixture bytes=${String(fixtureBytes.length)} docHash=${fixtureDocHash}`,
    );

    // ============================== PHASE A ==============================
    // Launch, probe SQLite bridge, open fixture, seed audit row.
    const phaseAStart = Date.now();
    const { app, window, consoleCollector } = await launchApp(userDataDir);
    await waitForBridgeAndTestNs(window, 'phase-A launch');

    // Bridge-introspection probe — same gate the canonical Phase 7.1 spec
    // uses to fail fast when Item A static-import lift didn't take.
    const bridgeProbe = await window.evaluate(async () => {
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
    expect(bridgeProbe.ok, `whichBridge failed: ${String(bridgeProbe.error)}`).toBe(true);
    const bridgeKinds = bridgeProbe.value!;
    const memorySlots = Object.entries(bridgeKinds)
      .filter(([, kind]) => kind === 'memory')
      .map(([slot]) => slot);
    expect(
      memorySlots,
      `Expected all 6 bridge slots to be 'sqlite' under _electron.launch(); ` +
        `got memory slots: [${memorySlots.join(', ')}]. The OCR invalidation back-ref ` +
        `assertion against listByDocHash needs SQLite — the memory repo's mark behaviour ` +
        `was made congruent in Phase 7.2 7.2.4 but the test is the contract.`,
    ).toEqual([]);

    // Open the signed fixture so the production document-store knows its
    // bytes + docHash. The OCR handler then reads via `getBytes(handle)` /
    // `getDocHash(handle)` — identical to the production drag-drop path.
    const openResult = await window.evaluate(async (fixturePath: string) => {
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
    }, FIXTURE_SIGNED_1P);
    expect(openResult.ok, `fs.readPdf failed: ${String(openResult.error)}`).toBe(true);
    const handle = openResult.value?.handle;
    expect(typeof handle).toBe('number');
    expect(
      openResult.value?.fileHash,
      `production fs.readPdf returned fileHash=${String(openResult.value?.fileHash)} ` +
        `but the test pre-computed ${fixtureDocHash} from the same bytes on disk — ` +
        `hash drift would break the bridge-adapter row resolution.`,
    ).toBe(fixtureDocHash);
    expect(
      openResult.value?.pageCount,
      `expected the signed fixture to be 1 page; got ${String(openResult.value?.pageCount)}.`,
    ).toBe(1);

    // Seed the audit row keyed by (docHash, EXPECTED_SIGNATURE_FIELD_NAME).
    const seedResult = await window.evaluate(
      async (args: { docHash: string; fieldName: string }) => {
        const api = (
          window as unknown as {
            pdfApi: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              __test: {
                seedSignatureAudit: (req: { docHash: string; fieldName: string }) => Promise<{
                  ok: boolean;
                  value?: { rowId: number };
                  error?: string;
                }>;
              };
            };
          }
        ).pdfApi;
        return api.__test.seedSignatureAudit({
          docHash: args.docHash,
          fieldName: args.fieldName,
        });
      },
      { docHash: fixtureDocHash, fieldName: EXPECTED_SIGNATURE_FIELD_NAME },
    );
    expect(seedResult.ok, `seedSignatureAudit failed: ${String(seedResult.error)}`).toBe(true);
    const seededRowId = seedResult.value!.rowId;
    expect(seededRowId).toBeGreaterThan(0);
    console.log(
      `[phase A] seeded audit row id=${String(seededRowId)} in ${String(Date.now() - phaseAStart)}ms`,
    );

    // ============================== PHASE B ==============================
    // Pre-OCR readback — assert the seeded row is null on invalidatedByOcrJobId.
    const preOcr = await window.evaluate(async (docHash: string) => {
      const api = (
        window as unknown as {
          pdfApi: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            __test: {
              listSignatureAudit: (req: { docHash: string }) => Promise<{
                ok: boolean;
                value?: {
                  rows: {
                    id: number;
                    docHash: string;
                    fieldName: string | null;
                    invalidatedByOcrJobId: number | null;
                  }[];
                };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.__test.listSignatureAudit({ docHash });
    }, fixtureDocHash);
    expect(preOcr.ok, `listSignatureAudit (pre-OCR) failed: ${String(preOcr.error)}`).toBe(true);
    const preRows = preOcr.value!.rows;
    expect(
      preRows.length,
      `expected exactly 1 audit row for the seeded docHash; got ${String(preRows.length)}.`,
    ).toBe(1);
    const preRow = preRows[0]!;
    expect(preRow.id).toBe(seededRowId);
    expect(preRow.fieldName).toBe(EXPECTED_SIGNATURE_FIELD_NAME);
    expect(
      preRow.invalidatedByOcrJobId,
      `pre-OCR expectation: invalidatedByOcrJobId must be null before the OCR run dispatches markInvalidatedByOcrJob. ` +
        `Got ${String(preRow.invalidatedByOcrJobId)}.`,
    ).toBeNull();

    // ============================== PHASE C ==============================
    // Run OCR end-to-end. PAdES pre-flight reads invalidatesSignaturesConfirmed:
    // true so the handler proceeds; on completion it dispatches the back-ref
    // mark via the bridge adapter.
    const phaseCStart = Date.now();
    const ocrResult = await window.evaluate(
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
                  invalidatesSignaturesConfirmed: boolean;
                }) => Promise<{
                  ok: boolean;
                  value?: {
                    jobId: number;
                    summary: {
                      jobId: number;
                      status: 'completed' | 'cancelled' | 'failed';
                      totalWords: number;
                      meanConfidence: number;
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
          invalidatesSignaturesConfirmed: true,
        });
      },
      { handle: handle as number },
    );
    expect(
      ocrResult.ok,
      `ocr.runOnDocument failed within ${String(BUDGET_OCR_RUN_MS)}ms — error=${String(ocrResult.error)}. ` +
        `If error=='signed_pdf_requires_confirm' the invalidatesSignaturesConfirmed flag did not thread through.`,
    ).toBe(true);
    const summary = ocrResult.value?.summary;
    expect(summary).toBeDefined();
    expect(summary?.status).toBe('completed');
    const ocrJobId = ocrResult.value!.jobId;
    expect(ocrJobId).toBeGreaterThan(0);
    const phaseCMs = Date.now() - phaseCStart;
    console.log(
      `[phase C] OCR completed jobId=${String(ocrJobId)} words=${String(summary?.totalWords)} meanConf=${String(summary?.meanConfidence)} in ${String(phaseCMs)}ms`,
    );
    expect(phaseCMs).toBeLessThan(BUDGET_OCR_RUN_MS);

    // ============================== PHASE D ==============================
    // Post-OCR readback — assert the seeded row is now marked with ocrJobId.
    const postOcr = await window.evaluate(async (docHash: string) => {
      const api = (
        window as unknown as {
          pdfApi: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            __test: {
              listSignatureAudit: (req: { docHash: string }) => Promise<{
                ok: boolean;
                value?: {
                  rows: {
                    id: number;
                    docHash: string;
                    fieldName: string | null;
                    invalidatedByOcrJobId: number | null;
                  }[];
                };
                error?: string;
              }>;
            };
          };
        }
      ).pdfApi;
      return api.__test.listSignatureAudit({ docHash });
    }, fixtureDocHash);
    expect(postOcr.ok, `listSignatureAudit (post-OCR) failed: ${String(postOcr.error)}`).toBe(true);
    const postRows = postOcr.value!.rows;
    expect(
      postRows.length,
      `expected exactly 1 audit row for the docHash post-OCR; got ${String(postRows.length)}.`,
    ).toBe(1);
    const postRow = postRows[0]!;
    expect(postRow.id).toBe(seededRowId);
    expect(
      postRow.invalidatedByOcrJobId,
      `THE assertion target. Pre-OCR: null. Post-OCR: must equal the new ocrJobId=${String(ocrJobId)}. ` +
        `Got ${String(postRow.invalidatedByOcrJobId)}. ` +
        `If null, the back-ref dispatch at src/ipc/handlers/ocr-run-on-document.ts:376 silently no-op'd ` +
        `(this is the latent bug Julian flagged in §9 — the call site is wrapped in try/catch).`,
    ).toBe(ocrJobId);
    expect(postRow.fieldName, `field_name should be unchanged across the mark UPDATE.`).toBe(
      EXPECTED_SIGNATURE_FIELD_NAME,
    );

    // ============================== PHASE E ==============================
    // No console errors over the spec's lifetime — same exact-match 'error'
    // filter as ocr-integration.spec.ts.
    expect(
      consoleCollector.errors,
      `Console errors during spec: ${consoleCollector.errors.join(' | ')}`,
    ).toEqual([]);

    await app.close();

    const totalMs = Date.now() - specStart;
    console.log(`[spec totals] total=${String(totalMs)}ms (ceiling ${String(BUDGET_TOTAL_MS)}ms)`);
  });
});
