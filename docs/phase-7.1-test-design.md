# Phase 7.1 — Test-Harness Contract Design

**Owner:** Riley (front-end-architect)
**Status:** Wave 1 draft, 2026-06-05. Hands off to David (IPC slice) + Diego (spec + fixtures + CI).
**Brief:** `docs/phase-7.1-plan.md` §Wave 1
**Target spec file (Diego):** `tests/e2e/ocr-integration.spec.ts`

This is a **design-only** document. No code in `src/` or `tests/` is touched by Riley in Wave 1. The contracts below are the source of truth Wave 2 implements; any divergence is a Julian-blocker in Wave 3.

---

## 1. Fixture selection

### 1.1 Required fixtures (Wave 2 must ship)

| Slug              | Pages | Why                                                                                                                                       |
| ----------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `scan-1p-eng.pdf` | 1     | Scanned-image-only (no embedded text layer). Smallest fixture that exercises the full rasterize → tesseract → overlay → DB → reopen path. |
| `scan-2p-eng.pdf` | 2     | Multi-page scanned-image-only. Forces the "Recognizing page 1 of 2 → Recognizing page 2 of 2" path and the per-page `ocr_results` row.    |

Both ship under `tests/fixtures/pdfs/`. README ships alongside per the plan §Wave 2 (Diego).

### 1.2 Stretch fixtures (defer to Phase 7.2 unless trivial)

| Slug                   | Risk                                                                                                                                                                  | Recommendation                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `scan-rotated-270.pdf` | Catches v0.7.18's rotation-handling regression class. **Recommended if budget permits;** generate from `scan-1p-eng.pdf` by re-rasterizing into a `/Rotate 270` page. | Ship if Diego's CI budget has slack. |
| `mixed-text-1p.pdf`    | Tests the "page has embedded text AND an image region needing OCR" path. Overlap with `ocr-bootstrap.test.ts` mocks — low marginal value at e2e tier.                 | **Defer.**                           |
| `scan-cmyk-1p.pdf`     | CMYK rasterize is exercised by `ocr-bootstrap.font-rasterize.test.ts`. The e2e tier shouldn't re-prove what the unit tier already proves.                             | **Defer.**                           |

Riley's call: ship the two required fixtures in Wave 2. The rotation stretch fixture is the highest-value add and should land if Diego's <90s budget has 10–15s of slack; otherwise it lands in a Phase 7.2 follow-up.

### 1.3 Provenance hard rule

**Every fixture is originally authored by the project.** No copyrighted documents, no PII, no third-party logos. Each fixture has a deterministic generator script committed alongside it, so the byte-identical PDF can be re-emitted from public-domain source material.

**Generation recipe** (Diego owns the script; Riley specifies the contract):

1. Source content is a **public-domain Lorem Ipsum block** (canonical English Lorem text, ca. 1500 — no living author, no copyrightable selection). Exact text frozen in `tests/fixtures/pdfs/source/lorem.txt` (Diego commits).
2. Render to a 200 DPI PNG via `@napi-rs/canvas` (same library the project already uses for production rasterize — no new dependency). Font: bundled DejaVu Sans (the project ships this for export §10 already; license OFL 1.1, embeddable). The font choice is deliberate — Tesseract recognizes DejaVu Sans cleanly at 200 DPI with ≥85% mean confidence in calibration runs, which gives the assertion floor headroom (§2.3 below).
3. Embed the PNG into a single-page PDF via `pdf-lib` (`PDFDocument.create()` + `embedPng()` + `drawImage()`). For multi-page, repeat with a second deterministic block. For rotated, set `page.setRotation(degrees(270))` before save.
4. Save with `useObjectStreams: false` and a fixed `Producer`/`Creator` string so the file hash is deterministic across hosts.

**License declaration** (Diego writes this verbatim into `tests/fixtures/pdfs/README.md`):

> All PDFs in this directory are originally authored by the PDF_Viewer_Editor project for test purposes. Source text is public-domain Lorem Ipsum (canonical, ca. 1500). Source font is DejaVu Sans (SIL OFL 1.1, embeddable). Generated via `tests/fixtures/pdfs/scripts/generate.ts`. Re-run that script after upgrading `@napi-rs/canvas` or `pdf-lib` to refresh the deterministic hash; commit the regenerated file alongside the regenerated `expected-hashes.json` lockfile.

**A `expected-hashes.json` lockfile** ships next to the fixtures so a fixture mutation is caught in code review (a copyrighted-PDF substitution would change the hash; Julian's Wave-3 review checks this lockfile vs. the generator output).

---

## 2. Assertion surface

The spec exercises **six phases**. Each phase has explicit DOM probes + expected outcomes. Diego translates these into Playwright calls; Riley specifies the contract.

### 2.1 Pre-flight setup (test fixture, not a phase)

- Construct a clean `userData` dir per test (`fs.mkdtempSync(os.tmpdir(), 'pdfve-ocr-e2e-')`). Pass `args: ['.', `--user-data-dir=${dir}`]` to `_electron.launch()`. **Why a fresh dir each run:** the v0.7.18 modal-mid-capture exposed that stale `ocr_jobs` rows from prior sessions leak into renderer state on reopen. A fresh `userData` per test eliminates that source of non-determinism.
- Set `NODE_ENV=test` in the launched process env (`env: { ...process.env, NODE_ENV: 'test' }`). The test-only IPC channel (§3) refuses to register unless this is set at app boot.

### 2.2 Phase A — launch, seed, open

**Action:** after `_electron.launch()`, wait for the preload bridge (`window.pdfApi.ocr.runOnDocument` is a function — same pattern as `smoke.spec.ts` Wave-8). Then call `pdfApi.__test.seedOcrJob({ fixturePath, status: 'queued', langs: ['eng'] })` and `pdfApi.fs.openPdf({ path: fixturePath })` from `page.evaluate(...)`.

**Why seed + drive-via-pdfApi (not UI menu):** keyboard menu navigation on the Windows GitHub runner is flaky — synthesized `Alt`-chord events can be swallowed — and unit tests already prove menu wire-up. The e2e tier asserts the end-to-end pipeline, not menu plumbing.

**Key probes:** `seedResult.ok === true`; `openResult.ok === true`; `openResult.value.handle` is a number.

### 2.3 Phase B — OCR run-to-completion

**Action:** invoke `pdfApi.ocr.runOnDocument({ handle, pageRange: { start: 0, end: 0 }, langs: ['eng'], preprocess: { deskew: false, denoise: false, binarize: false } })` and await its terminal promise. Concurrently assert the modal renders.

**Key probes:**

- `window.getByRole('heading', { level: 3 })` contains `/Recognizing page|Phase:/` within 30s — the running-step h3 carries `phaseLabelOf` once the first progress event lands.
- `window.getByRole('progressbar')` is visible (selector exists on running-step.tsx:74).
- `ocrResult.ok === true`; `summary.status === 'completed'`.
- `summary.totalWords >= 20` and `summary.meanConfidence >= 60` (calibration floors per §5.1).

### 2.4 Phase C — overlay paint

**Action:** assert the OCR slice has hydrated. The `setCurrentSummary` reducer populates `pageResultsByPage` from the `runOnDocument` payload on success — no further dispatch needed.

**Probe shape** (`page.evaluate` returns `{ summaryPresent, pageResultsCount, page0Words }`):

- `summaryPresent: state.ocr.currentSummary !== null` → `true`
- `pageResultsCount: Object.keys(state.ocr.pageResultsByPage).length` → `>= 1`
- `page0Words: state.ocr.pageResultsByPage[0]?.words?.length ?? 0` → `>= 20`

**Renderer-store probe approach:** Riley's design provisionally targets `window.__reduxStore` (already exposed for unit tests). If David's Wave-2 audit shows this leaks into prod builds, switch to a `pdfApi.__test.getReduxState()` mirror channel (gated identically to §3). Riley flags this to Marcus as open question §7.1.

**Note on overlay DOM directly:** `OcrConfidenceOverlay` mounts ONLY when there are low-confidence words below threshold. DejaVu Sans Lorem is high-confidence, so the overlay container may legitimately not render. We assert against slice state, not the DOM container, to avoid this false-negative.

### 2.5 Phase D — close + reopen

**Action:** `await app.close()`; re-`_electron.launch()` with the **same `userDataDir`** (and `NODE_ENV=test`); wait for preload bridge; re-`fs.openPdf` the same fixture path.

**Key probes:** second launch's `window2` reaches `domcontentloaded`; preload bridge attaches within 15s; `reopenResult.ok === true`.

### 2.6 Phase E — overlay restoration

**Action:** `loadOcrResultsThunk` (`src/client/state/thunks-phase5.ts:234`) fires on doc-open and chains `ocr:listJobs` (filter: `docHash + status='completed'`) → `ocr:listResultsByJob`. Because `userData` is preserved, the Phase-B job + results rows are still present.

**Key probes** (after `waitForFunction` on `currentSummary !== null && pageResultsByPage` non-empty, 10s budget):

- `restoredState.summaryJobId === ocrResult.value.summary.jobId` — same DB row.
- `restoredState.page0Words === overlayState.page0Words` — no drift through DB serialize.

This is the v0.7.18 catch surface (§5.2).

### 2.7 Phase F — no-console-errors

**Action:** `page.on('console', ...)` collector wired from each launch through close. After Phase E, fail if any `msg.type() === 'error'` was recorded. Filter MUST be exact-match `'error'` — do not loosen to `'warn'` (React DevTools-detection log on launch is benign but at `'log'`, not `'error'`).

**Failure message:** `Console errors during run: ${consoleErrors.join(' | ')}`.

### 2.8 Phase G — clean exit

`await app2.close()`. Playwright's 60s test timeout (`playwright.config.ts:9`) already catches a hang; no additional assertion needed.

---

## 3. Deterministic seeding — Option A (test-only IPC channel)

**Pick:** Option A.

**One-line reason:** Option B (UI-driven) introduces Windows-keyboard-menu-navigation flakiness on the CI runner; Option A reduces the per-run noise floor to "Tesseract recognition variance" which the §2.3 floors absorb.

**Channel name:** `__test:seedOcrJob`

**Structural gate (David must implement exactly this way):**

```ts
// src/ipc/handlers/test-seed-ocr-job.ts (David, Wave 2)
//
// STRUCTURAL GATE: this module's top-level register function must early-return
// when NODE_ENV !== 'test'. The check is at REGISTRATION time, not at handler
// invocation time. A renderer in a prod build that calls __test:seedOcrJob
// gets "channel not found" — no IPC handler exists.
//
// This is the strongest form of structural gating: the channel does not exist
// in the prod IPC surface at all. A hostile preload cannot reach it because
// there is nothing to reach.

export function registerTestSeedOcrJob(): void {
  if (process.env['NODE_ENV'] !== 'test') return;
  ipcMain.handle(IpcChannel.TestSeedOcrJob, async (_evt, req: TestSeedOcrJobRequest) => {
    // ... insert ocr_jobs + ocr_results rows ...
  });
}
```

**Preload mirror gate (David):** `src/preload/index.ts` exposes `pdfApi.__test.seedOcrJob` ONLY when `process.env['NODE_ENV'] === 'test'`. The `__test` namespace is intentionally underscored + bracketed so it can be grep-detected by the L-006-class ratchet (a future grep ratchet on `pdfApi\.__test` outside of `tests/`).

**Request / response shapes (David adds to `src/ipc/contracts.ts`):**

```ts
// ---- __test:seedOcrJob (Phase 7.1, test-only) -------------------------------
//
// Registered ONLY when NODE_ENV==='test' at app boot. The handler inserts a
// row into ocr_jobs and (optionally) into ocr_results so the renderer's
// loadOcrResultsThunk can re-hydrate the overlay on reopen without running
// real Tesseract.
//
// Use cases:
//   - status: 'queued'    — minimal seed; the spec then drives runOnDocument
//                           and asserts the full pipeline runs end-to-end.
//   - status: 'completed' — pre-populated job + results; the spec asserts
//                           the reopen-restore path without re-running OCR.
//
// The Phase 7.1 wave-2 spec uses 'queued' + drives the real runOnDocument
// once, then closes and reopens; the reopen path reads the now-completed
// row that runOnDocument inserted. We do NOT pre-seed 'completed' in the
// canonical run — that would short-circuit Phase B and reduce the catch
// surface (see §5).

export interface TestSeedOcrJobRequest {
  fixturePath: string; // absolute path to the fixture PDF
  status: 'queued' | 'completed';
  langs: string[]; // e.g. ['eng']
  /** Required when status === 'completed'; ignored when 'queued'. */
  seededResults?: {
    pageIndex: number;
    totalWords: number;
    meanConfidence: number;
    words: OcrWord[]; // pdfRect populated; img dims set
    imgDimsPx: { widthPx: number; heightPx: number };
  }[];
}

export type TestSeedOcrJobError =
  | 'not_in_test_mode' // structural; never returned (handler not registered)
  | 'fixture_not_found'
  | 'invalid_payload'
  | 'db_insert_failed';

export interface TestSeedOcrJobValue {
  jobId: number;
  docHash: string; // SHA-256 of the fixture bytes
}

export type TestSeedOcrJobResponse = Result<TestSeedOcrJobValue, TestSeedOcrJobError>;
```

**`docs/api-contracts.md` amendment proposal (Diego/David apply in Wave 2; Riley does NOT modify it):**

> Insert under §16.8 (after `ocr:languagePackRemove`) a new §16.9 titled "`__test:seedOcrJob` — test-only seed channel (Phase 7.1)". Mark with a header banner: **"This channel is registered ONLY when `process.env.NODE_ENV === 'test'` at app boot. It does not exist in production builds; the preload `pdfApi.__test` namespace is absent from the prod surface. See `phase-7.1-test-design.md §3` for rationale."** Body is the request/response interfaces above plus a one-paragraph "do not call from production code" warning.

---

## 4. Runtime budget

Per the plan's <90s CI delta target. CPU-bound phases are the cap; I/O-bound phases get headroom for runner variance.

| Phase                                               |  Budget | Class   | Notes                                                                                                             |
| --------------------------------------------------- | ------: | ------- | ----------------------------------------------------------------------------------------------------------------- |
| A. Launch + preload-bridge ready + seed + open      |     15s | I/O     | First-launch SQLite init + better-sqlite3 ABI bind on a cold runner.                                              |
| B. OCR run (single-page DejaVu Sans @ 200 DPI, eng) |     25s | **CPU** | Tesseract single-page on the runner: ~12-18s observed across v0.7.x dev runs; 25s absorbs noise + worker spin-up. |
| C. Overlay paint + Redux state probes               |      5s | I/O     | Slice state assertion only — no rerender wait needed.                                                             |
| D. Close + relaunch + preload-bridge ready          |     15s | I/O     | Second SQLite open is warm, but Electron relaunch is the cost.                                                    |
| E. Reopen + loadOcrResultsThunk hydrate + probe     |     10s | I/O     | Two IPC calls (`ocr:listJobs` + `ocr:listResultsByJob`) + Redux dispatch.                                         |
| F. No-console-errors global + clean shutdown        |      5s | I/O     | Already measured during phases A-E; this is the final assertion + close wait.                                     |
| **Total**                                           | **75s** |         | **15s headroom** under the 90s ceiling for runner variance.                                                       |

**Diego's escape hatches if the budget blows on the CI runner:**

1. Drop to a smaller `scan-1p-eng.pdf` (e.g. 4-line text block instead of 8) — Tesseract scales roughly linearly with text content.
2. Set `preprocess: { binarize: false, deskew: false, denoise: false }` (already specified) — these add ~3-5s each.
3. `.skip()` the two-page fixture flow with a TODO; ship the single-page flow as the gate. Plan §Wave 2 explicitly allows this.

**Riley does NOT propose to skip Phase D-E.** The reopen-restore path is the highest-value catch in the design — every v0.7.x bug after v0.7.16 was a reopen-side defect (§5).

---

## 5. Failure messages & v0.7.x bug catch-coverage

This section pre-answers Julian's Wave-3 review questions per the plan §Wave 3. For each prior v0.7.x release, Riley names whether THIS test would have caught it.

### 5.1 Failure-message inventory (each assertion → its visible failure)

| Assertion                                        | Failure message Diego writes                                                                            | False-positive risk            | False-negative risk                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| `seedResult.ok === true`                         | `__test:seedOcrJob refused — is NODE_ENV=test set in the spec env?`                                     | Low — structural check.        | None within spec scope.                             |
| `ocrResult.value.summary.status === 'completed'` | `OCR did not reach 'completed' within 25s — got ${status}, pagesCompleted=${pagesCompleted}`            | Low — Tesseract is reliable.   | Misses: a run that completes but writes wrong rows. |
| `summary.totalWords >= 20`                       | `Tesseract recognized only ${totalWords} words on Lorem fixture — expected >= 20. Engine drift?`        | **Medium** if Tesseract major. | Misses: words present but coords wrong.             |
| `summary.meanConfidence >= 60`                   | `Mean confidence ${meanConfidence} below floor 60. Engine drift or fixture mutation?`                   | **Medium** if Tesseract major. | Misses: low-conf words OK, layout broken.           |
| `overlayState.page0Words >= 20`                  | `Redux ocr.pageResultsByPage[0].words.length=${n} below floor 20. Slice dispatch broken?`               | Low — slice is deterministic.  | None.                                               |
| `restoredState.summaryJobId === originalJobId`   | `Reopen restored a different job (${restored}) vs. original (${original}). loadOcrResultsThunk broken?` | Low.                           | Misses: same job, no word rows.                     |
| `restoredState.page0Words === originalWords`     | `Reopen restored ${restored} words vs. original ${original}. listResultsByJob lost data?`               | Low.                           | None.                                               |
| `consoleErrors === []`                           | `Console errors during run: ${joinedMessages}`                                                          | **Medium** if React adds new.  | Misses: silent failures.                            |

**Floors set at 20 words / 60% confidence** — calibration runs on DejaVu Sans @ 200 DPI Lorem typically show ~80-90 words / ~85-92% confidence. The 4x word floor + 30%-point confidence floor absorbs Tesseract minor version variance without hiding real regressions.

### 5.2 Catch-coverage walk vs. v0.7.13 → v0.7.18

| Release | Bug                                                                    | Caught by this test? | Which assertion catches it                                                                                                                                     |
| ------- | ---------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.7.13 | OCR diagnostic logs + Diagnostics tile (visibility, not a runtime bug) | **NO**               | This release added observability; nothing for the spec to assert against. Diego's spec uses `console.error` collection so future log-spam regressions surface. |
| v0.7.14 | Path2D ordering crash during cold-start rasterize (L-005 ancestor)     | **YES**              | Phase B fails at `runOnDocument`: the promise rejects or `summary.status === 'failed'`. Console error gate would also fire on the uncaught Path2D throw.       |
| v0.7.15 | Buffer-detach: pdf.js detaches the rasterize input (L-004 ancestor)    | **YES**              | Phase B asserts `summary.totalWords >= 20`. The v0.7.15 signature was zero-length `tesseract.recognize` reads → 0 words returned. This is the bug class.       |
| v0.7.16 | tesseract.js v7 output-shape drift (blocks tree + PNG-IHDR dims)       | **YES**              | Phase B `summary.status` would not reach `'completed'`; the modal would stall in `recognizing` and the 25s budget would expire.                                |
| v0.7.17 | Mount-overlay + dispatch wire-up missing in production call sites      | **YES**              | Phase C asserts `pageResultsCount >= 1`. The v0.7.17 signature was successful OCR but `pageResultsByPage` stayed empty — exactly this probe.                   |
| v0.7.18 | `ocr:listResultsByJob` channel + reopen restore + rotated overlay      | **YES**              | Phase E asserts `restoredState.page0Words === originalWords`. The v0.7.18 signature was overlay-disappears-on-reopen — exactly this probe.                     |

**Five out of six** OCR-arc releases would have been caught by this single spec running on PR. The sixth (v0.7.13) was observability-only and inherently uncatchable by an integration test. This is the Phase 7.1 ROI case.

**One regression class NOT caught:** font-readiness on bundled standard fonts (Helvetica / Times). The v0.7.18 release closed this; the unit test `ocr-bootstrap.font-rasterize.test.ts` already covers it at the unit tier. A future Phase 7.2 may add a standard-font-fixture e2e test if a regression slips past the unit tier.

---

## 6. L-004 / L-005 compliance in the harness

**Both locks landed today (2026-06-05) in parallel with this design.** Riley re-reads `.learnings/locked-instructions.md` at pre-flight per the standing rule.

### 6.1 Does the harness rasterize? **No.**

The Playwright spec drives `_electron.launch()` and invokes `window.pdfApi.ocr.runOnDocument` through the preload bridge. **The spec itself does not call `pdfjs.getDocument({data})` and does not call `await import('pdfjs-dist/...')`.** All pdf.js + rasterize code paths exercised by the test live inside the Electron main process, where David's existing helpers already enforce L-004 (`toPdfJsBuffer` copy) and L-005 (`loadPdfJs` ordering inside `src/main/pdf-ops/ocr-bootstrap.ts`).

**This is the architecturally-correct posture:** the e2e tier asserts against the production rasterize/recognize code path. It does not duplicate it. Riley's design avoids opening any side-door pdf.js usage in the spec.

### 6.2 Does the test-only IPC handler touch pdf.js? **Conditional — no.**

`__test:seedOcrJob` writes `ocr_jobs` + (optionally) `ocr_results` rows directly. It does NOT load a PDF, does NOT rasterize, does NOT call pdf.js. The `docHash` field in the seeded row is computed via Node's `crypto.createHash('sha256')` over the fixture bytes read with `fs.readFile` — the bytes never reach pdf.js.

**Julian's structural check in Wave 3:** grep `tests/e2e/ocr-integration.spec.ts` and `src/ipc/handlers/test-seed-ocr-job.ts` for `pdfjs|getDocument|pdf-lib`. Zero matches expected. If David's implementation deviates (e.g. computes page count via pdf-lib for validation), the deviation must go through `toPdfJsBuffer` + `loadPdfJs` per L-004 + L-005 and Julian confirms.

### 6.3 Explicit harness L-compliance statement (for Julian to cite in Wave 3)

> **The Phase 7.1 e2e harness contains zero direct pdf.js invocations.** The spec drives the production IPC surface via the preload bridge; the test-only seed channel writes DB rows by SHA-256 hashing fixture bytes; neither path triggers `pdfjs.getDocument` or `await import('pdfjs-dist/...')`. L-004 and L-005 enforcement remains entirely the responsibility of the production code that the spec exercises — `src/main/pdf-ops/ocr-bootstrap.ts` (`toPdfJsBuffer` + `loadPdfJs`) and `src/main/export/pdfjs-source.ts` (already-copying reference per L-004). The spec is designed to fail loudly if either lock is violated: Phase B's `totalWords >= 20` assertion is exactly the v0.7.15 detach signature, and Phase B's `status === 'completed'` (vs. modal stall) is exactly the v0.7.14 polyfill-ordering signature.

---

## 7. Open questions for the Wave-2 dispatch

These are flagged to Marcus before David + Diego fire. None are blocking; all have a default Riley resolution if Marcus declines to adjudicate.

1. **`window.__reduxStore` exposure in prod (Phase 7.x concern).** §2.4 relies on it being available under `NODE_ENV === 'test'`. Riley's pre-flight read of `src/client/state/store.ts` did NOT confirm whether the prod build excludes it. **Default if unconfirmed:** David adds a `__test`-namespaced redux-state probe IPC channel as part of his Wave-2 slice (mirror of `__test:seedOcrJob`'s gating), so the spec doesn't rely on a renderer-side global at all. Cost: ~30 extra lines of IPC scaffolding.

2. **DejaVu Sans license re-check.** Riley cited OFL 1.1 from project memory of the export §10 pipeline. **Default if uncertain:** Diego greps `node_modules/@napi-rs/canvas` and the existing `LICENSE` index for confirmation before committing the fixture-generator script. If unavailable, fall back to Tesseract's own bundled training font (whatever Lorem-friendly font ships with `eng.traineddata`'s sample corpus — likely Liberation Sans, GPL-2.0-with-font-exception).

3. **CI workflow `e2e` job inclusion.** Plan §Wave 2 says the existing job "should already pick up `tests/e2e/*.spec.ts`". Riley's read of `playwright.config.ts:8` confirms `testDir: './tests/e2e'`. **Default:** Diego confirms the CI job runs Playwright via `npm run e2e` (or equivalent) and that the new spec lands in the test set without further wiring. If not, Diego's slice grows by the wiring delta.

4. **Rotation fixture decision.** §1.2 recommended `scan-rotated-270.pdf` if budget permits. **Default if Diego prefers tight scope:** ship the two required fixtures only, file rotation as Phase 7.2.

---

## 8. Hand-off summary

| Wave | Owner  | Reads this doc §             | Produces                                                                        |
| ---- | ------ | ---------------------------- | ------------------------------------------------------------------------------- |
| 2    | David  | §3, §6.2, §7.1               | `src/ipc/handlers/test-seed-ocr-job.ts` + `contracts.ts` types + preload mirror |
| 2    | Diego  | §1, §2, §4, §5, §6, §7.2-7.4 | `tests/e2e/ocr-integration.spec.ts` + `tests/fixtures/pdfs/**` + CI wiring      |
| 3    | Julian | §5.2, §6.3                   | `docs/code-review.md` GREEN/RED verdict                                         |
| 4    | Nathan | §1.3, §2 summary             | One section added to `docs/developer-guide.md`                                  |

End of design.
