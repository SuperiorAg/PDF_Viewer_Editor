# ARCHITECTURE — Phase 5 Additions (Scan & OCR)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-27 (Wave 19)
**Status:** Phase 5 design, locked at end of Wave 19. Additions to Phase-1 `ARCHITECTURE.md`, Phase-2 `docs/architecture-phase-2.md`, Phase-3 `docs/architecture-phase-3.md`, and Phase-4 `docs/architecture-phase-4.md` — all four frozen per the P4-L-FREEZE rule recorded in `architecture-phase-4.md §13`, extended below.
**Scope:** Architectural deltas needed for Phase 5 features — file-import OCR via Tesseract.js, text-behind-image searchable-PDF authoring, language pack distribution, confidence reporting, OCR job lifecycle, and the deferral story for native scanner integration (WIA / TWAIN).
**Reads:** `ARCHITECTURE.md` (full), `docs/architecture-phase-2.md`, `docs/architecture-phase-3.md`, `docs/architecture-phase-4.md`, `docs/edit-replay-engine.md`, `docs/form-engine.md`, `docs/signature-engine.md`, `docs/phase-5-plan.md`.

> **Companion document.** This file describes the system additions. The detailed
> design of the OCR engine (worker lifecycle, image preprocessing, language
> pack management, confidence-per-word data shape, text-behind-image insertion
> via pdf-lib) lives in [`docs/ocr-engine.md`](ocr-engine.md). Read both together.

---

## 0. Scope

Phase 5 lights up the **scan-and-OCR** surface. Specifically:

1. **File-import OCR (the ship-this-wave path)** — drag-drop / file-pick a scanned PDF or raster image (PNG/JPEG/TIFF), run Tesseract.js OCR per page, produce a searchable PDF by composing an invisible text-behind-image layer aligned to recognized word coordinates.
2. **OCR job lifecycle** — modal-driven for v1 (per Q-C decision below). Per-page progress events, cancellable, bounded memory.
3. **Language pack management** — English (`eng.traineddata`, ~10 MB) bundled with the installer. Additional packs lazy-download-on-first-use from Tesseract's official `tessdata_fast` repo to a per-user app-data directory. Offline-after-first-use story documented.
4. **Confidence reporting** — per-word `confidence: 0-100` (Tesseract default scale). Words below `ocr.lowConfidenceThreshold` (default 60) are highlightable in the renderer via an overlay tied to the recognized rect.
5. **OCR audit + caching (modest schema delta)** — `ocr_jobs` (in-progress tracking + per-page status) + `ocr_results` (per-page summary stored alongside the file hash to avoid re-OCR of unchanged pages within a session) + `language_packs` (installed-pack manifest). Schema v5.
6. **Native scanner integration — DEFERRED to Phase 5.1.** Per locked decision Q-E (this wave), no MIT/Apache-2.0/BSD WIA Node binding exists at the maturity bar this project requires. The Phase 5 surface ships the **menu entry disabled** with a tooltip pointing at Phase 5.1; the IPC channel placeholders are reserved in the contract so Wave 20 implementation does not need to redo `contracts.ts` when Phase 5.1 lands.
7. **OCR + Phase 4 PAdES interaction** — running OCR on a previously-signed PDF invalidates the signature. The replay engine and the sign-modal pre-flight ABORT per Phase 4.1 H-17.3 discipline; the OCR modal pre-flight surfaces a confirm-and-acknowledge prompt before the user can proceed. See §6.

Each section below describes the architectural delta. Phase 1/2/3/4 chapters that aren't amended remain authoritative.

---

## 1. Locked decisions encoded (Wave 19 self-check)

| ID          | Decision                                                                                                                                                                                                                                                                                                                                                          | Encoded where in this doc                                        | Cross-ref                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| **P5-L-1**  | OCR library: **`tesseract.js` v7+ (Apache-2.0)** as the primary engine. **`node-tesseract-ocr` (MIT) is documented but NOT shipped** — it requires a system Tesseract binary which contradicts the "double-click install" goal.                                                                                                                                   | §3.1 (library inventory), §4.1 (engine path)                     | `ocr-engine.md §2`                                              |
| **P5-L-2**  | OCR runs in the **main process**, NOT the renderer. Tesseract.js spawns Web Worker(s) under main's Node runtime via `createWorker`. The renderer never instantiates tesseract.js.                                                                                                                                                                                 | §2.2, §4.2 (worker lifecycle), conventions §16                   | `ocr-engine.md §3`                                              |
| **P5-L-3**  | One worker per active language, persisted for the app lifetime, released on `app.before-quit`. No spawn-per-page churn.                                                                                                                                                                                                                                           | §4.2 (worker pool)                                               | `ocr-engine.md §3.4`                                            |
| **P5-L-4**  | Language packs: **ship `eng.traineddata` bundled**; lazy-download additional packs from `https://tessdata.projectnaptha.com/4.0.0_fast/<lang>.traineddata` (the upstream mirror Tesseract.js itself uses) to `app.getPath('userData')/tessdata/`. NO bundle-all. NO CDN-only.                                                                                     | §4.3 (language pack delivery + offline story)                    | `ocr-engine.md §4`                                              |
| **P5-L-5**  | OCR output format: **text-behind-image** via pdf-lib `/Contents` stream containing `BT/ET` text blocks at the recognized word coordinates, rendering mode **3 (invisible)**. Not `ActualText` + MarkedContent (more complex, no broader reader support for the search use case).                                                                                  | §4.4 (text-behind-image), `ocr-engine.md §5`                     | `ocr-engine.md §5`                                              |
| **P5-L-6**  | Confidence default: words with `confidence < 60` are "low". Configurable via `ocr.lowConfidenceThreshold`. Default chosen to match Tesseract's own internal "good enough" threshold.                                                                                                                                                                              | §4.5, ui-spec.md §14.4 overlay, conventions §16.4                | `ocr-engine.md §6`                                              |
| **P5-L-7**  | Job scheduling v1: **modal-driven, blocking** (Q-C). Multi-page docs render a progress bar + cancel button inside the modal. Background-queue + tray-progress is Phase 5.2+.                                                                                                                                                                                      | §4.6 (job lifecycle)                                             | `ocr-engine.md §7`                                              |
| **P5-L-8**  | Native scanner integration: **DEFERRED to Phase 5.1** per Q-E library survey (§7). The menu item ships disabled with a tooltip; the contract reserves `scan:listDevices` / `scan:acquire` channel names so Phase 5.1 is additive, not breaking.                                                                                                                   | §7 (native-scanner survey + deferral), api-contracts §16.5       | n/a                                                             |
| **P5-L-9**  | Schema v5 = three new tables (`ocr_jobs`, `ocr_results`, `language_packs`). Forward-only. No Phase 4 table touched.                                                                                                                                                                                                                                               | §5 (schema v5), data-models.md Phase-5 amendment §10             | `data-models.md §10`                                            |
| **P5-L-10** | **OCR-on-signed-PDF is REJECTED at the engine boundary.** Mirrors Phase 4.1 H-17.3 PAdES-invalidates-on-edit discipline. The OCR modal pre-flight detects existing PAdES signatures and surfaces a hard confirm; if the user proceeds, the signature widget is recorded as invalidated in `signature_audit_log.invalidated_by_ocr_job_id` (new column, additive). | §6 (Phase 4 interaction), data-models.md Phase-5 amendment §10.4 | `architecture-phase-4.md §4.6`, `code-review.md` Wave 17 H-17.3 |

**Cross-check against Phase 4.1 PAdES discipline (H-17.3):** verified at `code-review.md` Wave 17 (Julian's PAdES-replay-on-edit-after-sign abort logic finding) — Phase 5's `ocr:runOnDocument` handler runs the SAME widget-detection pre-flight before mutating bytes. No Phase 4 surface changes; we extend `signature_audit_log` additively with the `invalidated_by_ocr_job_id` nullable column.

**Cross-check against the stub-shipped-with-TODO lesson (global JSONL 2026-05-27):** Phase 5 design explicitly **bans optional-with-stub-fallback parameters** on the OCR engine interface. The `runOcrOnPage` function takes a REQUIRED `worker: TesseractWorker` argument; there is no default-fallback worker. If Wave 20 ships without wiring the worker pool, typecheck fails. See §4.2.2.

**Cross-check against sentinel-default lesson (Phase 4.1.1 measurePageDimensionsThunk):** Phase 5's `OcrResult` shape uses **nullable + late-init** for `pageResults` (initially `null` until OCR finishes per page), never a sentinel default like `confidence: 0` or `words: []`. Consumers read `pageResults === null` as "not yet OCR'd" and display the placeholder UI; non-null means real data. See §4.5.

**Cross-check against build-time-asset-copy lesson (Phase 4.1.1 vite-plugin-static-copy):** Phase 5's bundled `eng.traineddata` is **NOT committed** to the repo. Diego's Wave 21 packaging adds an `electron-builder.yml extraResources:` entry that copies from `node_modules/@tesseract.js-data/eng/4.0.0_best/eng.traineddata.gz` (or the equivalent at install time) into `resources/tessdata/eng.traineddata.gz`. Same staleness-vector logic as pdfjs fonts. See §3.3 + Diego Wave 21 handoff in §9.

---

## 2. Process model deltas

### 2.1 No new processes, no new windows

Phase 5 adds **no new BrowserWindow** and **no new long-lived OS process**. Tesseract.js spawns its own Web Worker(s) under main's V8 runtime — these are NOT separate OS processes, they are Worker threads with their own V8 isolate inside the main Electron process. The thread pool lives entirely inside main.

**L-001 cross-check:** `enableDragDropFiles: true` on the main BrowserWindow is untouched. Phase 5 introduces:

- Scanned-PDF + raster-image drag-drop into the OCR modal — uses the SAME `File.path` Electron property as Phase 1 PDF drops, Phase 2 image drops, Phase 3 CSV/Excel drops, Phase 4 PFX drops. L-001 is EXTENDED, not weakened.
- No new file-picker channels — the OCR modal reuses the existing `dialog:openPdf` for PDFs and a new `dialog:openImageForOcr` (Wave 20; structurally identical to `dialog:openPdf` with a different filter set) for standalone raster import.

Phase 5.1 (deferred) WILL introduce a new IPC surface (`scan:listDevices`, `scan:acquire`) and possibly a native addon, both of which need their own L-001-style review in the Phase 5.1 design wave. Phase 5 itself does not.

### 2.2 Main-process module additions

```
src/main/pdf-ops/
  ocr-engine.ts                    (NEW — see ocr-engine.md §3 — Tesseract.js worker orchestration; SINGLE funnel for ALL OCR ops)
  ocr-engine.test.ts               (NEW)
  ocr-worker-pool.ts               (NEW — see ocr-engine.md §3.4 — one worker per loaded language; lifetime-bound)
  ocr-worker-pool.test.ts          (NEW)
  searchable-pdf-builder.ts        (NEW — see ocr-engine.md §5 — text-behind-image /Contents stream authorship; pdf-lib)
  searchable-pdf-builder.test.ts   (NEW — golden-bytes corpus per conventions §13.6)
  image-preprocess.ts              (NEW — see ocr-engine.md §6.5 — deskew/denoise/contrast helpers; pure functions over Uint8Array of raster bytes)
  image-preprocess.test.ts         (NEW)
  language-pack-manager.ts         (NEW — see ocr-engine.md §4 — bundled-vs-downloaded resolution, integrity check, download orchestration)
  language-pack-manager.test.ts    (NEW)
  ocr-confidence.ts                (NEW — see ocr-engine.md §6 — confidence aggregation + low-confidence detection helpers; pure)
  ocr-confidence.test.ts           (NEW)

src/ipc/handlers/
  ocr-detect-languages.ts          (NEW — lists installed + downloadable language packs)
  ocr-run-on-page.ts               (NEW — runs OCR on a single page; primarily used by ad-hoc "re-OCR this page" affordance)
  ocr-run-on-document.ts           (NEW — multi-page; emits ocr:progress events; cancellable)
  ocr-cancel-job.ts                (NEW — cancels a running job; releases its rasterized-page memory)
  ocr-list-jobs.ts                 (NEW — for the audit / debugging panel)
  ocr-language-pack-download.ts    (NEW — downloads a tessdata pack; updates language_packs table)
  ocr-language-pack-remove.ts      (NEW — removes a downloaded pack; en-US bundled cannot be removed)
  scan-list-devices.ts             (NEW — Phase 5.1 placeholder; Wave 20 handler returns Result<never, 'not_implemented_phase_5_1'>)
  scan-acquire.ts                  (NEW — Phase 5.1 placeholder; same)
```

### 2.3 Renderer-process additions

```
src/client/components/
  modals/ocr-run-modal/                  (NEW — choose language, page range, preprocessing toggles; progress bar; cancel)
    index.tsx
    language-picker.tsx                   (lists installed packs + "Download more…")
    page-range-picker.tsx
    preprocess-options.tsx                (deskew / denoise / contrast checkboxes)
    progress-step.tsx                     (per-page progress + cancel button)
    ocr-run-modal.module.css
    ocr-run-modal.test.tsx
  modals/language-pack-manager-modal/    (NEW — list installed, download additional, remove non-default)
    index.tsx
    pack-row.tsx
    download-progress-bar.tsx
    language-pack-manager-modal.module.css
    language-pack-manager-modal.test.tsx
  modals/scan-modal/                     (NEW — Phase 5.1 placeholder UI; renders "Coming in Phase 5.1" empty state)
    index.tsx
    scan-modal.module.css
  ocr-confidence-overlay/                (NEW — renders low-confidence-word boxes over the page in the viewer)
    index.tsx
    confidence-box.tsx
    ocr-confidence-overlay.module.css
    ocr-confidence-overlay.test.tsx

src/client/state/
  slices/ocr-slice.ts                    (NEW — installed-language-packs list, in-flight-job state, confidence-overlay-visibility flag, current-document's OcrResult)
  slices/ocr-selectors.ts                (NEW)
  thunks.ts                              (EDIT — new thunks: detectLanguagesThunk, runOcrThunk, cancelOcrThunk,
                                                  downloadLanguagePackThunk, removeLanguagePackThunk,
                                                  toggleConfidenceOverlayThunk)
src/client/hooks/
  use-app-shortcuts.ts                   (EDIT — wire Ctrl+Shift+R (Run OCR), Ctrl+Shift+H (toggle confidence overlay) per ui-spec.md Phase-5 amendment §14.3)
```

### 2.4 Boundary discipline (extends Phase 1/2/3/4)

Conventions §10 (`renderer never holds Uint8Array of document bytes`) still holds. Phase 5 strengthens with TWO new corollaries baked into the new conventions §16 amendment:

1. **Raster bytes flow renderer → main when (and only when) the user imports a standalone image.** The renderer's `dialog:openImageForOcr` ships the file path (renderer side) and main reads bytes via the existing path-trusted handle pattern (Phase 1 `dialog:openPdf` shape). For OCR on the currently-open PDF, no renderer-side raster bytes are involved — main rasterizes pages using the existing pdfjs-in-main pattern (or pdf-lib `getEmbeddedImages` if the page is already image-only). No renderer Uint8Array.

2. **OCR results flow main → renderer as STRUCTURED DATA, never as raster bytes.** `OcrPageResult` (defined in `data-models.md` Phase-5 amendment §10.6) carries `words: OcrWord[]` with `{ text, confidence, rect: PdfRect }` per word — no raw recognized-image bytes. The renderer paints the confidence overlay from `OcrWord.rect` alone; the underlying raster stays in main / pdfjs.

These two corollaries get their own conventions §16 entries with anti-patterns. They are NOT as risky as Phase 4's cert-bytes discipline (no secrets), but they preserve the §10 boundary that has held since Phase 1.

### 2.5 IPC surface growth

9 new channels (full spec in `api-contracts.md §16`):

| Channel                    | Purpose                                                                                                                                            | Stream events?                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ocr:detectLanguages`      | List installed + downloadable packs. Returns `{ installed: LanguagePack[]; downloadable: LanguagePackCatalogEntry[] }`.                            | no                                        |
| `ocr:runOnPage`            | Run OCR on a single page of the currently-open document. Returns `OcrPageResult`. Short-running (≤30s); no progress events.                        | no                                        |
| `ocr:runOnDocument`        | Run OCR on a page range. Long-running; emits `ocr:progress` event stream. Returns `{ jobId, summary: OcrJobSummary }` on completion.               | yes (`ocr:progress`)                      |
| `ocr:cancelJob`            | Cancel an in-flight job. Idempotent. The handler tears down the per-job state but does NOT terminate the worker (workers are persistent per §4.2). | no                                        |
| `ocr:listJobs`             | List jobs from `ocr_jobs` table (for debugging + audit).                                                                                           | no                                        |
| `ocr:languagePackDownload` | Download a pack from the upstream `tessdata_fast` mirror. Emits `ocr:languagePackDownload:progress` events. Returns `{ pack: LanguagePack }`.      | yes (`ocr:languagePackDownload:progress`) |
| `ocr:languagePackRemove`   | Remove a previously-downloaded pack. Returns `{ removed: boolean }`. Refuses to remove the bundled `eng` pack.                                     | no                                        |
| `scan:listDevices`         | **Phase 5.1 placeholder.** Returns `Result<never, 'not_implemented_phase_5_1'>`. Contract reserved so Phase 5.1 is additive.                       | no                                        |
| `scan:acquire`             | **Phase 5.1 placeholder.** Same.                                                                                                                   | no                                        |

Plus TWO new event streams (`ocr:progress`, `ocr:languagePackDownload:progress`) following the same `mail-merge:progress` pattern from Phase 3. The Phase 1/2/3/4 surface (`api-contracts.md §1-§15`) remains FROZEN. No existing channel's contract changes.

### 2.6 Zod validation discipline (extends conventions §0.1)

Every Phase 5 IPC handler validates payload with zod. Phase 5-specific shapes that need extra care:

1. `OcrRunOnDocumentRequest.pageRange` — `{ start: number, end: number }` with `start >= 0`, `end >= start`, `end < doc.pageCount`. Out-of-range = `invalid_payload`.

2. `OcrLanguagePackDownloadRequest.lang` — `z.string().regex(/^[a-z]{3}(_[a-z]+)?$/i)` (lowercase 3-letter ISO 639-2 code + optional `_variant`). The handler additionally checks against the upstream catalog (`tessdata_fast`'s top-level filenames) before attempting the download. Unknown code = `lang_not_in_catalog`.

3. `OcrRunOnDocumentRequest.preprocess` — discriminated record `{ deskew: boolean, denoise: boolean, contrastBoost: boolean }`. Defaults via the request schema; renderer is not allowed to send sparse partial.

The `zod` dependency is already in the project; no new dep.

---

## 3. Library inventory deltas

### 3.1 New runtime dependencies

| Library                  | Version                                                        | License           | Process           | Purpose                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------- | ----------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tesseract.js`           | 7.x (current at Wave 19 dispatch; v7.0.0 published 2025-12-15) | Apache-2.0        | Main              | Primary OCR engine. WASM + Web Worker; supports `createWorker(lang, oem, { langPath, gzip, cachePath })` in Node/Electron main since v6+. **Recommended primary** — see `ocr-engine.md §2` rationale. |
| `tesseract.js-core`      | 7.x                                                            | Apache-2.0        | Main              | Transitive of `tesseract.js`; the actual WASM-bundled Tesseract C++ engine. Pinned in `package.json` so Diego's Wave 21 license walk surfaces it explicitly.                                          |
| `@tesseract.js-data/eng` | 4.x                                                            | Apache-2.0 (data) | Build-time / Main | English `eng.traineddata.gz` data file. Apache-2.0 license applies to the Tesseract trained data per `tessdata`'s own LICENSE.                                                                        |

**License verification (Wave 19, against npm registry 2026-05-27):**

- `tesseract.js` → `npm view tesseract.js license` → `Apache-2.0` (verified live; v7.0.0)
- `tesseract.js-core` → transitive of `tesseract.js`; same license (Apache-2.0; verified via repo `LICENSE`)
- `@tesseract.js-data/eng` → trained data pack; per `tessdata`'s top-level LICENSE the data files are Apache-2.0

All three are PERMISSIVE. None are AGPL. None are commercial. Compliant with project policy.

**Native binding NOT added (Q-A decision):**

| Library              | Version | License | Why NOT primary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-tesseract-ocr` | 2.2.1   | MIT     | Requires a system-installed Tesseract binary (the user has to install Tesseract separately via Chocolatey / winget / manual). Contradicts the "double-click install" goal. MIT license is fine, but the runtime dependency is a UX-breaking install step. Documented in `ocr-engine.md §2.3` as the "perf escape hatch" — if Wave 20 perf testing shows tesseract.js is unacceptably slow (>3 min/page on a typical scan), Phase 5.1 can ship an optional toggle that calls a system Tesseract if available. Not a Phase 5 ship blocker. |

**Diego's Wave 21 packaging notes (preview):**

- The transitive subtree from `tesseract.js` brings ~15-20 small JS packages (idb-keyval, is-url, node-fetch, wasm-feature-detect, zlibjs, etc.). All previously vetted MIT/Apache-2.0. Per the Wave 13 license-walk lesson, Diego still walks the full subtree post-install and updates `LICENSES.md` with any UNKNOWN entries.
- The `tesseract.js-core` WASM bundle (~6 MB compressed, ~17 MB uncompressed) lands in `node_modules`. Vite's electron-main config bundles it into `dist/main/` automatically; no static-copy plugin needed.
- The Web Worker file (`tesseract.js/src/worker-script/node/index.js`) is invoked via Node `Worker` (`require('worker_threads')`) from main, NOT via a `new Worker(URL)` browser-style call. Verify in Wave 20 implementation that the worker URL resolution works inside the packaged ASAR (extract-on-demand if not).

**Explicitly NOT added (locked decision P5-L-1 / scope):**

- PDFTron / Apryse OCR module (commercial)
- ABBYY OCR (commercial)
- Google Cloud Vision API (cloud service; out-of-scope for this app's local-first promise)
- AWS Textract (cloud; same)
- `node-tesseract-ocr` (MIT, but requires system binary — see above)
- Native WIA / TWAIN bindings (no MIT-compatible candidate at sufficient maturity — see §7)

### 3.2 Existing libraries — extended use

| Library                                             | New Phase 5 use                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pdf-lib`                                           | Authors the text-behind-image `/Contents` stream + invisible-rendering-mode-3 text blocks for searchable-PDF output. The page's existing visual content (scanned image as `/XObject`) is preserved verbatim; we append text-block bytes to `/Contents` and re-encode the page. See `ocr-engine.md §5.3`.           |
| `pdfjs-dist` (already used by renderer for display) | Rasterizes pages for OCR input when the source PDF is text-bearing but the user is forcing a re-OCR. Reuses the existing main-side pdfjs init (Phase 4.1: `loadPdfMetadata` already imports pdfjs in main). Rendering to `OffscreenCanvas` at the user-chosen DPI (default 300; configurable via `ocr.rasterDpi`). |
| `better-sqlite3`                                    | Schema v5 migration `0005_phase5_ocr.sql` adds three tables (`ocr_jobs`, `ocr_results`, `language_packs`). See §5 + `data-models.md §10`.                                                                                                                                                                          |
| `zod`                                               | New schemas for the 9 IPC channels in §2.5.                                                                                                                                                                                                                                                                        |
| `node:worker_threads` (Node built-in)               | Tesseract.js uses this under the hood; we don't `require` it directly. Documented for the audit trail.                                                                                                                                                                                                             |
| `node:fs/promises` + `node:crypto`                  | Language pack download + SHA-256 integrity check. No new deps.                                                                                                                                                                                                                                                     |
| `node:https` (Node built-in)                        | Language pack download from the tessdata mirror. No new deps.                                                                                                                                                                                                                                                      |

### 3.3 Bundled language pack — build-time asset copy (Diego Wave 21)

**Pattern (per the build-time-asset-copy lesson):**

Diego adds an `electron-builder.yml extraResources:` entry that copies the bundled English pack at packaging time:

```yaml
extraResources:
  - from: 'node_modules/@tesseract.js-data/eng/4.0.0_fast/eng.traineddata.gz'
    to: 'tessdata/eng.traineddata.gz'
```

At runtime, `language-pack-manager.ts` resolves the bundled pack at `process.resourcesPath + '/tessdata/eng.traineddata.gz'` (read-only). Downloaded packs live at `app.getPath('userData') + '/tessdata/<lang>.traineddata.gz'` (writable).

**Rationale:** the binary file MUST match the tesseract.js-core ABI in use. Committing the file creates a guaranteed staleness vector on every tesseract.js version bump. The build-time copy makes the pack version follow the npm-resolved version automatically. See Phase 4.1.1 `vite-plugin-static-copy` precedent for pdfjs assets.

**Size impact:** `eng.traineddata.gz` is ~10 MB. NSIS installer grows from ~105 MB (v0.4.2 baseline) to ~115 MB (estimate). Acceptable; documented in Diego's Wave 21 packaging notes.

### 3.4 Phase 5.1+ libraries (NOT added in Phase 5)

| Library                    | Phase                       | Purpose                                                                      |
| -------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| Native WIA Node addon      | 5.1                         | Scanner integration (Q-E deferred)                                           |
| `node-twain` (ISC)         | 5.2 (deferred further)      | TWAIN bridge — drivers widely deprecated per Marcus's roadmap decision       |
| `node-tesseract-ocr` (MIT) | 5.1 (optional escape hatch) | Perf path if tesseract.js is unacceptable; requires system Tesseract install |

---

## 4. OCR engine — high-level architecture

> Detailed design in [`docs/ocr-engine.md`](ocr-engine.md). This section
> describes the SHAPE of the engine and its integration points with the rest
> of the system.

### 4.1 Single engine path

The OCR engine is a **single funnel** — `ocr-engine.ts` is the only module that interacts with tesseract.js. The IPC layer, the searchable-PDF builder, and the worker pool all sit either above or beside it; no parallel paths into tesseract.js.

```
                       ┌──────────────────────────┐
   run request    ──→  │ ocr-engine.ts            │  ──→ OcrPageResult / OcrJobSummary
                       │ (single funnel)          │  ──→ searchable PDF bytes (via searchable-pdf-builder)
                       └──────────┬───────────────┘      ──→ ocr_jobs / ocr_results rows (SQLite)
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
         ┌──────────────┐  ┌─────────────┐  ┌─────────────┐
         │ worker-pool  │  │ image-      │  │ confidence  │
         │ (per-lang    │  │ preprocess  │  │ aggregation │
         │  workers)    │  │ (pure)      │  │ (pure)      │
         └──────┬───────┘  └─────────────┘  └─────────────┘
                │
                ▼
         ┌──────────────────┐
         │ tesseract.js     │
         │ createWorker(...)│
         │ (Worker thread)  │
         └──────────────────┘
```

### 4.2 Worker lifecycle (P5-L-2 + P5-L-3)

#### 4.2.1 Pool shape

`ocr-worker-pool.ts` exposes:

```ts
export interface OcrWorkerPool {
  /** Get-or-create a worker for the given language. Idempotent; reuses a live worker. */
  acquire(lang: string): Promise<TesseractWorker>;
  /** Release every worker. Called from app.before-quit; safe to call multiple times. */
  releaseAll(): Promise<void>;
  /** Status snapshot (for debugging / `ocr:listJobs`). */
  status(): { lang: string; createdAt: number; lastUsedAt: number }[];
}
```

**One worker per language, persisted for the app lifetime, released on `app.before-quit`.** No spawn-per-page churn. If the user runs `eng` then `fra` then `eng` again, the first `eng` worker is reused for the third call.

**Memory cap:** the pool holds ≤ 4 concurrent workers (configurable via `ocr.maxConcurrentLanguages`, default 4). If a 5th language is acquired, the LRU worker is `.terminate()`'d first. This prevents an unbounded RAM growth scenario in a multilingual session.

#### 4.2.2 Required-on-interface (no stub-with-TODO)

The `runOcrOnPage` function signature is:

```ts
export async function runOcrOnPage(
  pool: OcrWorkerPool, // REQUIRED — no default
  lang: string, // REQUIRED
  rasterBytes: Uint8Array, // REQUIRED
  preprocess: PreprocessOptions, // REQUIRED — sparse partial NOT permitted
): Promise<OcrPageResult>;
```

There is **no optional pool fallback**. If Wave 20 wires the handler without injecting the pool, TypeScript fails the build. This is the structural fix from the stub-shipped-with-TODO lesson — never permit a "ship now, wire later" optional + stub-default arrangement.

#### 4.2.3 Worker init cost — log it once

Initializing a tesseract.js worker (load WASM + load language data + initialize) takes 2-5 seconds on a modern machine. The pool's `acquire` warms a worker on first request; subsequent requests for the same lang are near-instant. The UI must surface this — the OCR modal's Step 2 (running) shows a "Loading language…" sub-status during the first acquire.

### 4.3 Language pack delivery (P5-L-4)

Three states for a language pack:

| State                    | Where it lives                                           | How it got there                                        |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------- |
| **Bundled** (`eng` only) | `process.resourcesPath/tessdata/eng.traineddata.gz`      | Diego's `electron-builder.yml extraResources` (§3.3)    |
| **Downloaded**           | `app.getPath('userData')/tessdata/<lang>.traineddata.gz` | `ocr:languagePackDownload` handler                      |
| **Missing**              | n/a                                                      | UI prompts to download; OCR run blocks until downloaded |

The `language-pack-manager.ts` module exposes:

```ts
export interface LanguagePackManager {
  /** All known pack states (bundled + downloaded + missing-but-in-catalog). */
  list(): Promise<{ installed: LanguagePack[]; downloadable: LanguagePackCatalogEntry[] }>;
  /** Resolve a lang code to an absolute file path (bundled OR downloaded). null if not installed. */
  resolve(lang: string): string | null;
  /** Download a pack from the upstream mirror. Verifies SHA-256 against the catalog. */
  download(
    lang: string,
    onProgress: (bytes: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<LanguagePack>;
  /** Remove a downloaded pack. Refuses to remove the bundled `eng` pack. */
  remove(lang: string): Promise<{ removed: boolean }>;
}
```

#### 4.3.1 Upstream catalog source

The catalog of downloadable packs is a small JSON resource shipped with the app:

```
src/main/pdf-ops/language-pack-catalog.json
```

Each entry: `{ lang: string; displayName: string; sha256: string; sizeBytes: number; url: string }`. URLs all point at `https://tessdata.projectnaptha.com/4.0.0_fast/<lang>.traineddata.gz` (the same mirror tesseract.js itself uses). The catalog is updated at compile time by a Wave 20 build script that fetches the upstream index; for v1 a small (~10-language) seed catalog ships:

| `lang`    | Display               |
| --------- | --------------------- |
| `eng`     | English               |
| `spa`     | Spanish               |
| `fra`     | French                |
| `deu`     | German                |
| `por`     | Portuguese            |
| `ita`     | Italian               |
| `rus`     | Russian               |
| `chi_sim` | Chinese (Simplified)  |
| `chi_tra` | Chinese (Traditional) |
| `jpn`     | Japanese              |

Adding more = a doc + catalog file edit; no engine change. Phase 5.1 can ship a UI to browse the full upstream catalog (100+ languages).

#### 4.3.2 Offline-after-first-use story

Once a pack is downloaded (or bundled), OCR runs without internet. The `language-pack-manager` does NOT phone home at OCR run time; it only contacts the network when the user explicitly triggers `ocr:languagePackDownload`. If the user is offline and tries to OCR in an unbundled language, the modal shows "Language pack not installed. Connect to the internet and click Download." with no auto-retry.

**Tested-offline check:** Diego's Wave 21 includes a manual smoke step: download `eng` (no-op — already bundled), then download `spa`, then disconnect WiFi, then run OCR in `spa` — should complete without network. Documented in `ocr-engine.md §4.4`.

#### 4.3.3 Integrity check

Every download is SHA-256-verified against the catalog. If the hash mismatches, the file is rejected and the download fails with `pack_integrity_failed`. Defense-in-depth against a poisoned mirror.

### 4.4 Text-behind-image (P5-L-5)

The searchable-PDF output uses **PDF rendering mode 3 (invisible)** text blocks at the recognized word coordinates. The page's existing visual content (the scanned image as a `/XObject`) is unchanged; we append text-block bytes to the page's `/Contents` stream.

#### 4.4.1 Why not ActualText + MarkedContent

ActualText + MarkedContent (PDF spec §14.9.3) is the "semantically richer" alternative — readers can use it for accessibility text. It's more complex to author and not uniformly supported by older PDF readers for search. Render-mode-3 text is the broadly-supported pattern used by Acrobat's own OCR feature and by Adobe's open-source OCR documentation. P5-L-5 picks the simpler path.

Phase 6+ may add ActualText as a richer-export option; the engine boundary supports it cleanly via a new `OutputFormat` parameter on `searchable-pdf-builder.ts`.

#### 4.4.2 Coordinate transformation

Tesseract.js returns word bounding boxes in **image-pixel coordinates** (top-left origin). PDFs use **user-space coordinates** (bottom-left origin, points = 1/72 inch). The transformation is:

```
pdfX = imgX * (pageWidthPts / imgWidthPx)
pdfY = pageHeightPts - (imgY * (pageHeightPts / imgHeightPx)) - wordHeightPts
```

Encoded in `searchable-pdf-builder.ts` as a pure helper `imageToPdfRect(imgRect, imgDimsPx, pageDimsPts)`. Golden-bytes-tested with three corpus PDFs (US Letter portrait, US Legal portrait, A4 portrait) per `conventions.md §13.6`.

**A note on the Phase 4.1.1 nullable-dims pattern:** the `pageWidthPts / pageHeightPts` inputs MUST come from the canonical `measurePageDimensionsThunk`-populated values (or the equivalent pdf-lib metadata in main). Sentinel 612x792 inputs would silently produce wrong word positions on non-Letter PDFs — exactly the defect class the 2026-05-26 global JSONL entry warns against.

#### 4.4.3 Text-block authorship

For each recognized word, the engine emits:

```
BT
3 Tr             % rendering mode 3 = invisible
/<Font> <Size> Tf
<X> <Y> Td
(<escaped-text>) Tj
ET
```

Font is `/Helvetica` (built-in PDF standard 14 — no font embedding needed). Size is computed from the word's bounding box height. Text is escaped per PDF spec (parens, backslashes). Unicode beyond Latin-1 uses `Tj` with a `<hex>` string + a `/ToUnicode` CMap if needed (the engine ships with a minimal CMap helper; full multi-script handling is Phase 5.1+).

**Phase 5 scope-fence:** Latin-script languages render with the built-in `/Helvetica`. CJK + Cyrillic + Arabic render with positioned hex strings that _are searchable_ but may not be visually correct if the user copy-pastes (no font embedding for those glyphs in v1). The user-guide surfaces this honestly (Nathan Wave 22). Phase 5.1 can add proper CJK font embedding if user demand.

### 4.5 Confidence reporting (P5-L-6 + nullable + late-init)

Tesseract returns confidence per word in the 0-100 range (Tesseract's internal `LSTM confidence`). The engine surfaces this as `OcrWord.confidence`.

Aggregation (in `ocr-confidence.ts`):

```ts
export interface OcrPageConfidence {
  /** Total recognized words on the page. */
  totalWords: number;
  /** Words with confidence < threshold (default 60). */
  lowConfidenceWords: number;
  /** Mean confidence across all recognized words. */
  meanConfidence: number;
  /** Words sorted by confidence ascending (lowest first); cap at 100 entries to bound size. */
  worstWords: OcrWord[];
}
```

`OcrPageResult.pageResults: OcrPageResult[] | null` — **null until the OCR job completes for that page**. The renderer guard:

```tsx
if (state.ocr.currentResult?.pageResults == null) return <Placeholder />;
return <OcrConfidenceOverlay results={state.ocr.currentResult.pageResults} />;
```

No sentinel defaults. The placeholder paint is a separate UI branch, not a default-valued render — per the 2026-05-26 sentinel-default lesson.

### 4.6 Job lifecycle (P5-L-7)

#### 4.6.1 Modal-driven, blocking

The OCR modal is the ONLY entry point for `ocr:runOnDocument` in v1. The modal:

1. Step 1 — language picker, page-range picker, preprocess toggles
2. Step 2 — confirm + start
3. Step 3 — progress bar with per-page increments; cancel button always visible
4. Step 4 — done; summary (mean confidence, low-confidence count, total time, output path)

No background scheduling, no tray-icon progress. If the user closes the modal mid-run, the cancel handler fires and the job is torn down.

#### 4.6.2 Progress event shape

`ocr:progress` emits `{ jobId, pageIndex, totalPages, phase: 'rasterizing' | 'preprocessing' | 'recognizing' | 'composing-text-behind-image' | 'writing-output', confidenceSoFar: number | null }`. The renderer's `<ProgressStep>` component listens via the existing event-stream pattern from Phase 3 mail-merge (`ipc-event-bridge.ts`).

#### 4.6.3 Cancellation semantics

`ocr:cancelJob` is **graceful, not aggressive**. It:

1. Sets a `cancelled` flag on the per-job state.
2. The engine checks the flag between pages (NOT mid-page). Once the current page finishes recognition, the job exits.
3. The worker is NOT terminated (workers are persistent).
4. Any partial output is discarded — no half-OCR'd PDF is written.
5. The `ocr_jobs` row's `status` transitions `running → cancelled`.

Mid-page cancel is Phase 5.2+ (requires plumbing the abort signal through tesseract.js's Worker, which is feasible but adds wave-time).

### 4.7 EditOperation integration

Phase 5 adds ONE new `EditOperation` variant (full list in `data-models.md` Phase-5 amendment §10.3):

```ts
// Phase 5 addition to the EditOperation union — append-only

type EditOperation =
  // ...Phase 1-4 variants...

  {
    kind: 'ocr-text-behind-applied';
    meta: EditMeta;
    jobId: number; // FK to ocr_jobs.id
    pageRange: { start: number; end: number };
    langs: string[]; // languages used (multi-lang via Tesseract `eng+fra` syntax)
    meanConfidence: number;
    totalWordsRecognized: number;
    invalidatesSignatures: boolean; // true if any PAdES widget was present pre-OCR (see §6)
  };
```

The inverse:

```ts
  | { kind: 'ocr-text-behind-removed';
      meta: EditMeta;
      before: {
        jobId: number;
        pageRange: { start: number; end: number };
        langs: string[];
        meanConfidence: number;
        totalWordsRecognized: number;
      };
    };
```

These are companion variants matching the Phase 4 `signature-pades-applied` + `signature-pades-removed` pattern. Undoing an OCR pass:

1. Mid-session (before Save) — replay engine drops the text-behind-image text blocks from `/Contents`; the visual page is restored. The `ocr_jobs` row is marked `superseded_by_undo: true`.
2. Post-Save — the on-disk file is replaced with the pre-OCR bytes on the next Save. The user is shown a confirmation: "Undoing OCR removes the searchable-text layer from the saved file. Continue?"

### 4.8 Replay-engine integration

The `replay()` function (`edit-replay-engine.md §3`, extended Phase 3 step 3.6, Phase 4 step 3.7) is extended Phase 5 with step **3.9** (between Phase 4's step 3.8 shape-and-callout-ops and the global step 4 emit-annots):

```
3.9 applyOcrOps:
    const ocrOps = ops.filter(op => isOcrOp(op))
    if (ocrOps.length === 0) yield to step 4
    for op of ocrOps where op.kind === 'ocr-text-behind-applied':
      // pre-flight: detect existing PAdES signatures on affected pages
      if (op.invalidatesSignatures):
        // The op carries the user's confirm-at-OCR-modal-time acknowledgement.
        // The engine still records the invalidation in signature_audit_log via the IPC handler;
        // this step just applies the text-behind-image bytes.
      // delegate to searchable-pdf-builder.ts; append BT/ET blocks to /Contents
      applyTextBehindImage(doc, ctx, op)
    for op of ocrOps where op.kind === 'ocr-text-behind-removed':
      removeTextBehindImage(doc, ctx, op)
    yield progress { phase: 'pdflib-applying-ocr', percent: 70-75% }
```

**One new `ReplayError` variant:**

- `'ocr_job_missing'` — the EditOperation references an `ocr_jobs.id` that no longer exists (e.g. DB was edited externally). Replay aborts; user is shown a recovery toast.

The existing `op_apply_failed` covers the rest.

---

## 5. Schema additions (P5-L-9)

### 5.1 New tables — `ocr_jobs`, `ocr_results`, `language_packs`

Full DDL in `data-models.md` Phase-5 amendment §10.4. Summary:

```sql
-- ocr_jobs — one row per OCR run (in-progress + historical)
CREATE TABLE ocr_jobs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash                 TEXT NOT NULL,
  page_range_start         INTEGER NOT NULL,
  page_range_end           INTEGER NOT NULL,
  langs                    TEXT NOT NULL,             -- '+'-joined Tesseract lang codes
  preprocess_json          TEXT NOT NULL,             -- JSON-encoded PreprocessOptions
  status                   TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed', 'superseded_by_undo')),
  started_at               INTEGER NOT NULL,
  completed_at             INTEGER,                   -- null until done
  mean_confidence          REAL,                      -- null until done
  total_words              INTEGER,                   -- null until done
  error_message            TEXT,                      -- non-null only on status='failed'
  invalidated_signatures   INTEGER NOT NULL DEFAULT 0, -- 0 or 1; true if PAdES widget was present pre-run
  created_at               INTEGER NOT NULL
);
CREATE INDEX idx_ocr_jobs_doc_hash ON ocr_jobs(doc_hash);
CREATE INDEX idx_ocr_jobs_status   ON ocr_jobs(status);

-- ocr_results — one row per page per completed job
CREATE TABLE ocr_results (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id                   INTEGER NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  page_index               INTEGER NOT NULL,
  total_words              INTEGER NOT NULL,
  low_confidence_words     INTEGER NOT NULL,
  mean_confidence          REAL    NOT NULL,
  /** Word-level data as JSON. Stored compactly; renderer parses on demand. */
  words_json               TEXT    NOT NULL,
  created_at               INTEGER NOT NULL,
  UNIQUE (job_id, page_index)
);
CREATE INDEX idx_ocr_results_job_id ON ocr_results(job_id);

-- language_packs — installed-pack manifest (bundled + downloaded)
CREATE TABLE language_packs (
  lang                     TEXT PRIMARY KEY,
  source                   TEXT NOT NULL CHECK (source IN ('bundled', 'downloaded')),
  file_path                TEXT NOT NULL,                 -- absolute path on disk
  size_bytes               INTEGER NOT NULL,
  sha256                   TEXT NOT NULL,
  installed_at             INTEGER NOT NULL,
  last_used_at             INTEGER                        -- null if never used; updated by worker pool
);

-- Additive amendment to existing Phase-4 signature_audit_log:
ALTER TABLE signature_audit_log ADD COLUMN invalidated_by_ocr_job_id INTEGER REFERENCES ocr_jobs(id);

INSERT INTO schema_migrations (version, applied_at) VALUES (5, strftime('%s', 'now') * 1000);
```

### 5.2 Migration behavior

- Forward-only. No rollback (consistent with Phase 1-4 policy).
- Idempotent — `migrate.ts` skips applied versions.
- Clean migration from schema v4 — three new tables + one additive column on `signature_audit_log`. No existing data touched.
- The `signature_audit_log.invalidated_by_ocr_job_id` column is **nullable**; pre-Phase-5 rows have it NULL, which means "not invalidated by OCR". Same nullable-late-init pattern as elsewhere in Phase 5.

### 5.3 Repository interface

```ts
// src/db/repositories/ocr-jobs-repo.ts (Ravi Wave 20)
interface OcrJobsRepo {
  insert(row: Omit<OcrJobRow, 'id' | 'created_at'> & { created_at?: number }): number;
  get(id: number): OcrJobRow | null;
  updateStatus(
    id: number,
    status: OcrJobStatus,
    completedAt?: number,
    meanConfidence?: number,
    totalWords?: number,
    errorMessage?: string,
  ): boolean;
  listByDocHash(docHash: string, limit?: number, offset?: number): OcrJobRow[];
  listByStatus(status: OcrJobStatus, limit?: number, offset?: number): OcrJobRow[];
  delete(id: number): boolean;
}

interface OcrResultsRepo {
  insert(row: Omit<OcrResultRow, 'id' | 'created_at'> & { created_at?: number }): number;
  listByJobId(jobId: number): OcrResultRow[];
  getByJobAndPage(jobId: number, pageIndex: number): OcrResultRow | null;
}

interface LanguagePacksRepo {
  upsert(pack: LanguagePackRow): void;
  list(): LanguagePackRow[];
  get(lang: string): LanguagePackRow | null;
  remove(lang: string): boolean; // refuses to remove source='bundled'
  touchLastUsed(lang: string, when: number): void;
}
```

`db-bridge.ts` (David's adapter) translates snake_case rows ↔ camelCase DTOs at the IPC boundary, parsing/serializing `preprocess_json` + `words_json`.

---

## 6. Phase 4 PAdES interaction (P5-L-10)

OCR on a previously-signed PDF mutates page bytes. Per Phase 4's invalidate-on-edit discipline (architecture-phase-4.md §10.3 + Julian Wave 17 H-17.3), this invalidates any existing PAdES signature on the doc.

### 6.1 Pre-flight detection

`ocr:runOnDocument` (and `ocr:runOnPage`) pre-flight checks the doc bytes for `/Sig` field widgets with a non-empty `/V /Contents` entry — that is the signature of a previously-applied PAdES signature (vs a Phase-3 placeholder or Phase-4 visual signature). The check is a fast read-only pass via pdf-lib's `getForm().getSignatures()` (or equivalent).

If any such widget is present, the handler returns `Result<never, 'signed_pdf_requires_confirm'>` with the affected field names in the error payload. The OCR modal surfaces a "This PDF has 1 cryptographic signature. Running OCR will invalidate it. Continue?" prompt; the user must click "Continue and invalidate" before the modal re-issues the run with `invalidatesSignaturesConfirmed: true`.

### 6.2 Audit log update

When the user proceeds:

- The OCR handler computes the `signature_audit_log` rows that match the doc-hash for the existing signatures.
- After the OCR job completes successfully, the handler updates those rows: `UPDATE signature_audit_log SET invalidated_by_ocr_job_id = ?  WHERE doc_hash = ? AND id IN (...)`.
- The `signature_audit_log` panel surfaces this in the UI: each invalidated row gets a "Invalidated by OCR (job #N)" badge.

### 6.3 Replay-engine guard

Per §4.8, replay step 3.9's `ocr-text-behind-applied` handler trusts the carried `invalidatesSignatures` flag (set at OCR run time). The engine does NOT re-prompt at replay; the user already confirmed at modal time. The audit log row remains the durable record.

### 6.4 What this is NOT

- We do NOT re-sign the doc after OCR. The user must re-sign manually via the Phase 4 sign modal (which is now a fresh sign over the post-OCR bytes).
- We do NOT preserve the original signed bytes alongside the OCR'd bytes. The Save flow replaces the file. The user can use OS-level versioning / a manual copy if they want both.
- We do NOT silently invalidate. The pre-flight prompt is non-skippable.

Documented in conventions.md §16.5 + user-guide §OCR (Nathan Wave 22).

---

## 7. Native scanner — go/no-go (Q-E)

Per the locked roadmap decision (2026-05-22) and Q-E in Wave 19's brief, Riley evaluates WIA Node binding candidates and recommends GO or DEFER.

### 7.1 Library survey

| Library                                                      | License                                               | Version              | Last commit                 | Stars / Activity | Verdict                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------- | -------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wia` (npm)                                                  | MIT                                                   | 2.0.0-local.1        | published "over a year ago" | low              | **REJECT** — this package is an **IoT cloud SDK** (wia.io); name collides but unrelated. Not a Windows-Image-Acquisition binding.                                                                                                                                                                                                                                                           |
| `node-wia` (npm)                                             | n/a                                                   | n/a                  | n/a                         | n/a              | **REJECT** — does not exist in npm registry (404 on `npm view`).                                                                                                                                                                                                                                                                                                                            |
| `wia-scanner` (npm)                                          | n/a                                                   | n/a                  | n/a                         | n/a              | **REJECT** — does not exist in npm registry (404 on `npm view`).                                                                                                                                                                                                                                                                                                                            |
| `scanner-wia` (npm)                                          | n/a                                                   | n/a                  | n/a                         | n/a              | **REJECT** — does not exist in npm registry (404 on `npm view`).                                                                                                                                                                                                                                                                                                                            |
| `node-imageacquisition` (npm)                                | n/a                                                   | n/a                  | n/a                         | n/a              | **REJECT** — does not exist.                                                                                                                                                                                                                                                                                                                                                                |
| `sh-navid/NodeWiaScanner` (GitHub)                           | n/a (no LICENSE file in repo)                         | n/a (no npm release) | sporadic                    | low              | **REJECT** — uses VBS-script bridging via `cscript`, not a real Node addon. No npm package. License unverified. Not a maturity match for a production app.                                                                                                                                                                                                                                  |
| `yushulx/docscan4nodejs` (GitHub)                            | requires Dynamic Web TWAIN Service                    | commercial           | active                      | medium           | **REJECT** — wraps Dynamsoft Web TWAIN Service which is a **commercial product** (commercial license + service fees). License-policy fail.                                                                                                                                                                                                                                                  |
| `node-twain` (npm)                                           | ISC                                                   | 0.0.16               | sporadic                    | low              | **REJECT for Phase 5** — TWAIN drivers are widely deprecated per Marcus's roadmap; project policy is WIA-first. License is OK (ISC is permissive). Re-evaluate for Phase 5.2 if WIA-first lands and demand exists.                                                                                                                                                                          |
| `scanner-js` (Asprise, npm)                                  | MIT (wrapper) but requires commercial Asprise backend | 2.10.3               | published "over a year ago" | low              | **REJECT** — wraps a commercial product; the wrapper is MIT but the backend is paid.                                                                                                                                                                                                                                                                                                        |
| `Dynamsoft Service Client` (npm)                             | commercial                                            | active               | active                      | medium-high      | **REJECT** — commercial license.                                                                                                                                                                                                                                                                                                                                                            |
| Custom Node-API addon over Windows WIA COM (build ourselves) | we'd own the code (MIT)                               | n/a                  | n/a                         | n/a              | **OUT OF SCOPE for Phase 5** — building a native C++ Node-API addon wrapping the WIA COM interface is a 1-2-week solo effort (Windows COM, IDispatch, image format conversion). Diego's electron-rebuild CI complexity would double (Phase 5 risk register row 2). The Phase 5 brief explicitly allows deferral to Phase 5.1 if no clean binding exists; ROI does not justify it this wave. |

### 7.2 Verdict — DEFER to Phase 5.1

**No MIT/Apache-2.0/BSD WIA Node binding exists at the maturity bar this project requires.** Every candidate either:

- Doesn't exist (404 on npm — `node-wia`, `wia-scanner`, etc.)
- Is unrelated (name collision — `wia` is an IoT SDK)
- Wraps a commercial product (Dynamsoft, Asprise)
- Is a hobby script bridge with no LICENSE (`sh-navid/NodeWiaScanner`)

**Per the locked roadmap decision: native scanner integration is DEFERRED to Phase 5.1.**

Phase 5 ships with:

- The Tools menu **"Scan from device…" item present but disabled**, tooltip: "Scanner integration arrives in Phase 5.1 (Phase 5 ships file-import + OCR only)".
- The IPC channels `scan:listDevices` and `scan:acquire` are **defined in the contract** (`api-contracts.md §16.5`) but the handlers return `Result<never, 'not_implemented_phase_5_1'>` (the same pattern Phase 1 used for `app:pickPdfPath`). This means Phase 5.1 is purely additive — David doesn't have to touch `contracts.ts` then, only swap the handler bodies.
- Phase 5.1's design wave (whenever scheduled) re-runs this survey. If the landscape changed (a viable MIT WIA binding lands), use it. Otherwise, write a Node-API addon wrapping the WIA COM interface ourselves — Diego scopes that as a 1-2-week solo dev-ops wave + CI matrix expansion.

### 7.3 Workaround in Phase 5

Users who need to scan today have two paths:

1. **Use the OS-bundled scanner tool** (Windows Scan app, Windows Fax and Scan) → save as PDF → drag-drop the PDF into our app → run OCR. This is the well-trodden path for users who scan documents.
2. **Wait for Phase 5.1.** Documented in user-guide (Nathan Wave 22).

Documented honestly per the trust-floor pattern. Not a regression — Phase 4 didn't ship scanner integration either; Phase 5 closes the OCR half of the OCR-and-scan story.

---

## 8. Trust-floor honesty obligations (third instance after H-3 + Phase 4 PAdES)

Per the proven Phase 1 H-3 + Phase 3 forms + Phase 4 PAdES pattern (Nathan Wave 18 lesson, global JSONL 2026-05-27), Phase 5 introduces a new set of trust-floor obligations that MUST be surfaced at the three documented locations: top-of-guide preamble + dedicated section + inline at every OCR-touching subsection.

### 8.1 The four Phase 5 obligations

1. **OCR text accuracy depends on scan quality; low-confidence words may be incorrect.** Tesseract returns a confidence score per word; words below the threshold are highlightable but their text MAY be wrong. The user must review before relying on the extracted text for legal / regulatory purposes.

2. **OCR runs locally; no cloud upload. Language packs are downloaded from Tesseract's official upstream repository (https://tessdata.projectnaptha.com) on first use.** No PDF bytes ever leave the user's machine. The only outbound network traffic is the language-pack download itself.

3. **OCR-extracted text becomes part of the saved PDF and cannot be silently un-applied.** Once the user clicks Save, the text-behind-image layer is written to disk. Undoing OCR before Save reverts cleanly; undoing after Save requires re-Saving (the file on disk does NOT auto-revert).

4. **Re-running OCR adds another text layer; multiple OCR passes may produce duplicate selectable text.** The engine does NOT detect "this page was already OCR'd". If the user re-runs OCR on an already-OCR'd page, the new text-behind-image blocks stack on top of the old. Users can avoid this by undoing the prior OCR first; the user-guide makes the distinction explicit.

### 8.2 Where these obligations are surfaced

Per the three-location pattern (Phase 4 PAdES precedent + Nathan Wave 18 lesson):

| Location                                    | Wave 22 (Nathan) owner                                                                              | What must be present                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Top-of-guide preamble**                   | `docs/user-guide.md:5-12` (extends Phase 4 preamble additively)                                     | Enumerate all 4 obligations in 4-6 bullets at top of guide. User sees before scrolling.    |
| **Dedicated trust-floor section**           | New section "OCR trust floor — what the app does and doesn't promise" in `docs/user-guide.md`       | Full enumeration + "What the trust floor IS / IS NOT" sub-sections per Wave 18 pattern.    |
| **Inline at every OCR-touching subsection** | Capturing→Running OCR / Reviewing low-confidence words / Saving OCR'd PDF / Re-running OCR sections | "Honesty reminder" callout + direct anchor link back to the dedicated trust-floor section. |
| **README front-door**                       | `README.md` Known Limitations section gets the 4 headlines                                          | Same headline bullets as the user-guide preamble.                                          |

Documented in conventions.md §16.3 so Wave 20 implementation and Wave 22 docs surface them at the trust-floor — three-location ratchet, not buried in an appendix.

### 8.3 What the trust floor IS NOT

For honesty parity with Phase 4 §10.2 disclosures:

- We do NOT defend against an attacker who modifies the local SQLite DB (same tamper-vulnerability disclosure as `signature_audit_log` per Phase 4 §10.2; `ocr_jobs` lives in the same DB).
- We do NOT claim OCR output is publication-quality. Confidence scores surface, but a 95% mean confidence is still ~5% wrong words on average.
- We do NOT preserve original raster bitmaps after OCR — the visual page IS the OCR'd page's underlying image; we add text behind it. The image is unchanged but is now married to a text layer that may have errors.
- We do NOT translate. The recognized text is in the source language(s); we don't auto-translate.

What we DO promise:

- Per-word confidence scores surface in the renderer and persist in `ocr_results.words_json`.
- Language packs are SHA-256-verified at download time against a shipped catalog.
- Cancellation tears down any partial output (no half-OCR'd file on disk).
- The "re-OCR adds duplicate text" footgun is documented at point-of-action, not buried.
- PAdES-signed PDFs require an explicit confirm before OCR (§6).

---

## 9. Risk register (extends `phase-5-plan.md §risk-register`)

Each of the 5 risks from the phase plan, addressed in the design:

| #   | Risk                                    | Severity | Mitigation in this design                                                                                                                                                                                                                                                |
| --- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **No clean MIT WIA binding**            | HIGH     | §7 survey done; locked decision: DEFER native scanner to Phase 5.1. Menu item ships disabled with tooltip; contract reserves channels for additive Phase 5.1 wire-up.                                                                                                    |
| 2   | **Native module CI complexity**         | HIGH     | Phase 5 ships ZERO native modules. tesseract.js uses pure WASM + Worker threads. Diego's electron-rebuild remains single-target (better-sqlite3 only).                                                                                                                   |
| 3   | **Tesseract.js perf for large PDFs**    | MEDIUM   | §4.2 (worker pool reuse) + §4.6 (cancellable progress) + UI surfaces estimated time in Step 2. User-guide sets expectations: 200-page scan = ~30 min on typical hardware. Phase 5.1 escape hatch: `node-tesseract-ocr` toggle for users with a system Tesseract install. |
| 4   | **OCR quality vs source image quality** | MEDIUM   | §4.5 (confidence per word) + §8 (trust-floor obligations) + image preprocessing toggles (deskew/denoise/contrast). Confidence overlay lets user spot errors before saving.                                                                                               |
| 5   | **Language pack distribution**          | LOW      | §4.3 (bundled `eng` + lazy-download via official upstream + SHA-256 integrity + offline-after-first-use). Catalog file is small (~10 langs seed) and ships in `src/main/pdf-ops/language-pack-catalog.json`.                                                             |

### 9.1 Additional risks Riley uncovered during Wave 19 design

These are NOT in the original 5-risk register; flagged here for Wave 20 awareness:

- **R-W19-A — tesseract.js Worker path resolution in packaged ASAR.** tesseract.js spawns workers via `new Worker(workerPath)` where `workerPath` is computed at runtime. Inside a packaged Electron ASAR (`app.asar`), file paths look like `/app.asar/node_modules/tesseract.js/src/worker-script/node/index.js` which Node's `Worker` constructor MAY not be able to read (ASAR is a virtual filesystem; Worker creation reads from the real FS in some Node versions). Mitigation: Diego's Wave 21 packaging adds `app.asar.unpacked` entries for `node_modules/tesseract.js/src/worker-script/**` AND `node_modules/tesseract.js-core/**` to ensure those files are on disk for Worker creation. Verify via Wave 20 smoke test that runs OCR in the packaged binary, not just `npm run dev`. Per L-002, capture a screenshot of a real OCR run end-to-end.

- **R-W19-B — Language pack download MITM.** A user on an untrusted network downloading a pack could be served a poisoned `.traineddata.gz`. Mitigation: SHA-256 integrity check against the shipped catalog (§4.3.3). The catalog itself ships with the app binary (not downloaded), so the trust anchor is "Diego's Wave 21 packaging signs the binary, and the binary contains the catalog, and the catalog hashes lock in the upstream pack contents". Catalog refresh in future versions = a regular app update.

- **R-W19-C — Per-page memory for large PDFs.** Rasterizing a 200-page scan at 300 DPI = ~25 MB per page = 5 GB total if held all at once. Mitigation: §4.6 processes pages one-at-a-time (sequential), releases the raster ImageData after each page completes recognition. Bounded transient memory: ONE page raster + ONE OcrPageResult at a time. Documented in `ocr-engine.md §3.5`.

- **R-W19-D — Worker leaks under crash.** If the engine crashes mid-recognition (V8 OOM, native segfault inside tesseract-core WASM), the Worker thread may leak. Mitigation: `app.on('before-quit', () => pool.releaseAll())` AND `process.on('exit', () => pool.releaseAll())` AND a per-worker watchdog timer (60s/page; configurable via `ocr.workerWatchdogSec`) that `terminate()`s and re-creates on hang.

- **R-W19-E — Confidence threshold gaming.** A user could set `ocr.lowConfidenceThreshold` to `0` and then claim every word is high-confidence. The app records the actual confidence values in `ocr_results.words_json` regardless of the threshold; the threshold only affects rendering. Documented for the audit trail; the per-word raw confidence is the durable record.

- **R-W19-F — pdf.js + pdf-lib double-rasterize.** Some "scanned PDFs" already contain text behind the image (other tools' OCR output). Running our OCR on top adds duplicate text. P5-L-10 obligation #4 surfaces this; we don't auto-detect because the heuristic is unreliable (we'd need to scan for non-empty text content beneath visible images, which has false positives on text-bearing pages with watermark images). Phase 5.2 candidate: a "this page already has text — re-OCR anyway?" detector.

### 9.2 Risks that DON'T apply to Phase 5 (explicitly excluded)

- Cloud OCR fallback (we don't ship one)
- OCR translation (out of scope)
- OCR on streaming sources (video frame OCR; out of scope)
- TWAIN scanner integration (Phase 5.2+; WIA-first per roadmap)
- ABBYY-quality output (we use Tesseract, not commercial OCR; user-guide is honest about quality differences)

---

## 10. Extension points for Phase 5.1+, Phase 6+

### 10.1 In Phase 5 (Wave 20)

- File-import OCR via tesseract.js (drag-drop PDFs / images + run OCR)
- Searchable-PDF output via text-behind-image + render-mode 3
- Language pack management (bundled `eng` + lazy-download)
- Confidence reporting + low-confidence overlay
- OCR job lifecycle (modal-driven, cancellable, progress events)
- Schema v5 (`ocr_jobs`, `ocr_results`, `language_packs` + additive `signature_audit_log.invalidated_by_ocr_job_id`)

### 10.2 Phase 5.1 (post-ship; addresses Q-E deferral)

- Native scanner integration (WIA-first; custom Node-API addon over WIA COM if no MIT binding exists by then)
- Optional `node-tesseract-ocr` toggle for users with a system Tesseract install (perf escape hatch)
- Mid-page cancellation (plumbing the abort signal through tesseract.js Worker)
- Background-queue + tray-progress for very-long jobs
- Full upstream tessdata catalog browser (instead of the seeded 10-language list)

### 10.3 Phase 5.2+

- TWAIN scanner integration (if WIA-first lands and demand exists)
- CJK / Cyrillic / Arabic proper font embedding for visual fidelity of selectable text
- "Already has text — re-OCR anyway?" auto-detector (R-W19-F)
- OCR translation pipeline (out of scope still in Phase 5.2; flagged for future evaluation)

### 10.4 Phase 6+ (Export to Office)

| Phase | Feature          | Extension point                                                                                                                                     |
| ----- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6     | OCR'd PDF → DOCX | Existing OCR'd text becomes the document text; image becomes the background. Cross-references `searchable-pdf-builder.ts`'s word-coordinate output. |
| 6     | OCR'd PDF → XLSX | Cell detection over OCR'd words via line-grid analysis. Reuses `ocr-results.words_json`.                                                            |
| 7     | OCR a11y output  | ActualText + MarkedContent variant of the text-behind-image authorship (Phase 5's pure-text-behind-image is the v1; v2 adds semantic tagging).      |

---

## 11. Phase 5 fidelity boundary

Per the H-3 lesson (third proven instance after Phase 4), documented loudly.

### 11.1 Boundaries Phase 5 closes

| Phase 4 limitation                                                                  | Phase 5 reality                                                                  | Doc update target                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| "OCR — Phase 5" (annotation summary CSV / Search shows nothing for image-only PDFs) | Live; image-only PDFs become searchable after OCR                                | user-guide.md (Nathan Wave 22) — Save section + Search section |
| Scanned image import → only available via drag-drop as a PDF                        | Phase 5 adds standalone image import (PNG/JPEG/TIFF) directly into the OCR modal | user-guide §OCR (Nathan Wave 22)                               |

### 11.2 New Phase 5 boundaries

| Boundary                                                                                                                         | Description                                                                                               | Where to surface                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| OCR accuracy ≠ perfect                                                                                                           | Per-word confidence; trust-floor obligation #1                                                            | user-guide preamble + OCR section + dedicated trust-floor section + Settings tooltip |
| No cloud, but does download packs                                                                                                | Trust-floor obligation #2                                                                                 | user-guide + Settings → Languages                                                    |
| Save commits OCR text to disk                                                                                                    | Trust-floor obligation #3                                                                                 | user-guide §Saving (additive Phase-5 amendment to existing Save warnings)            |
| Re-OCR stacks text layers                                                                                                        | Trust-floor obligation #4                                                                                 | user-guide §OCR + Honesty reminder at the "Run OCR" button tooltip                   |
| Native scanner deferred                                                                                                          | Tools menu item disabled with tooltip; user-guide explains the workaround (use OS Scan app then drag PDF) | UI: tooltip on disabled menu item + user-guide                                       |
| Tamper-vulnerable OCR audit                                                                                                      | `ocr_jobs` lives in the same SQLite DB as `signature_audit_log`; no tamper-evidence                       | user-guide §OCR → "About the OCR audit log" (mirrors Phase 4 §10.2 disclosure)       |
| OCR invalidates existing PAdES signature                                                                                         | §6; non-skippable confirm                                                                                 | user-guide §OCR + sign modal cross-reference                                         |
| Multi-language uses `+`-joined Tesseract syntax (e.g. `eng+spa`)                                                                 | Language picker UI surfaces this; the engine plumbs it through to tesseract.js verbatim                   | user-guide §OCR → "Multiple languages on one page"                                   |
| Latin scripts render with built-in `/Helvetica`; non-Latin renders selectable but may copy-paste oddly without proper font embed | §4.4.3 scope-fence                                                                                        | user-guide §OCR → "About non-Latin scripts"                                          |
| Tessdata download requires internet on first use of a non-bundled language                                                       | §4.3 + R-W19-B                                                                                            | user-guide §OCR → "Adding more languages"                                            |

### 11.3 Round-trip fidelity matrix delta

Extends Phase 4 §10.3 round-trip matrix:

| PDF feature in source                        | Phase 4 behavior                                                      | Phase 5 behavior                                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing text layer (from another OCR tool)  | Preserved on resave (Phase 4 doesn't mutate non-OCR text)             | **STILL PRESERVED**, BUT: re-running our OCR appends a second text layer on top. Trust-floor obligation #4 surfaces this.                                 |
| Existing PAdES signature `/V Contents <...>` | Invalidated on any content-mutating save (Phase 4 already documented) | OCR is a content-mutating save → still invalidated. §6 adds the explicit confirm dialog. Signature_audit_log is updated with `invalidated_by_ocr_job_id`. |
| Image-only page (no text layer)              | Search returns nothing; selectable text is empty                      | After OCR: search works; selectable text returns the recognized words (visually invisible, behind the image)                                              |
| Text-bearing page (already has text)         | Search works                                                          | After OCR: search works on EITHER layer (the original + our added invisible layer). Word duplication may surface to copy-paste consumers — documented.    |
| Document-level JS                            | Phase 4 §4.8 ensures EVERY save strips it; Phase 5 inherits           | Same — `replay-engine.ts` strips before our step 3.9 fires                                                                                                |

---

## 12. What's NOT in Phase 5

Hard scope-fence per `phase-5-plan.md`. Listed here to absorb any Phase-5 brief drift:

- Native WIA scanner integration — DEFERRED to Phase 5.1 (§7)
- Native TWAIN scanner integration — Phase 5.2+ (TWAIN deprecated per roadmap)
- Mid-page OCR cancellation — Phase 5.1+
- Background-queue + tray-progress OCR — Phase 5.2+
- "Already-OCR'd — re-OCR anyway?" auto-detector — Phase 5.2+
- OCR translation (Tesseract output → another language) — out of scope
- Full upstream tessdata catalog browser (100+ languages) — Phase 5.1 (seed of 10 ships in Phase 5)
- ABBYY-quality output — out of scope; we use Tesseract
- Cloud OCR fallback — out of scope; local-first policy
- HSM-protected OCR runs (n/a; OCR has no secret material)
- Mobile-side OCR — out of scope
- Real-time OCR-on-paste — out of scope
- OCR a11y output via ActualText + MarkedContent — Phase 7

If a Phase-5 wave brief or implementation pulls toward any of these, the agent stops and surfaces to Marcus.

---

## 13. L-001 cross-check

**L-001 status: unchanged.** Phase 5 introduces:

- OCR run modal — pure renderer overlay; no new BrowserWindow.
- Language pack manager modal — same.
- Scan modal (Phase 5.1 placeholder) — same.
- PDF / image / language-pack drag-drop into the OCR modal — uses the SAME `File.path` Electron property as Phase 1+2+3+4 drops. Phase 5 EXTENDS the L-001 pathway; does not weaken it.
- Confidence overlay — pure renderer canvas; no main-process window changes.

Wave 20 implementers (David / Ravi / Riley) MUST NOT touch `src/main/window-manager.ts`. If Wave 20 surfaces a need for a new lock (e.g. "OCR worker termination on quit"), that's a Marcus call after Julian's Wave 21 audit.

---

## 14. Phase 1 + 2 + 3 + 4 freeze rule extends to Phase 5

Per the analogous Phase 4 freeze rule (`architecture-phase-4.md §13`):

**P5-L-FREEZE (implicit, recorded here):** `ARCHITECTURE.md`, `docs/architecture-phase-2.md`, `docs/architecture-phase-3.md`, `docs/architecture-phase-4.md`, `docs/edit-replay-engine.md`, `docs/form-engine.md`, `docs/signature-engine.md` are FROZEN by Phase 5. Phase 5 design lives in THIS doc and `docs/ocr-engine.md` exclusively. The api-contracts / data-models / ui-spec / conventions docs are AMENDED with Phase 5 sections (not edited in their Phase 1 / 2 / 3 / 4 sections).

If Wave 20 implementation needs a Phase-1/2/3/4 contract change, the agent stops and surfaces to Marcus — same protocol as the Phase 2/3/4 freezes.

---

## 15. Cross-reference checklist (Wave 19 self-verification)

- [x] All 10 locked decisions encoded (§1)
- [x] No new processes; no new BrowserWindow; L-001 untouched (§2.1, §13)
- [x] 9 new IPC channels listed + cross-ref to api-contracts (§2.5)
- [x] Library inventory delta with license verification (§3.1)
- [x] Build-time language-pack copy mirrors Phase 4.1.1 pattern (§3.3)
- [x] Single-funnel OCR engine pattern (§4.1)
- [x] Worker pool lifecycle (§4.2) + required-on-interface anti-stub-shipped-with-TODO (§4.2.2)
- [x] Language pack delivery + offline story (§4.3)
- [x] Text-behind-image design + coordinate transform + Phase 4.1.1 nullable-dims callout (§4.4)
- [x] Confidence reporting with nullable + late-init (§4.5)
- [x] Job lifecycle modal-driven (§4.6)
- [x] EditOperation extension + inverse companion (§4.7)
- [x] Replay-engine integration step 3.9 (§4.8)
- [x] Schema v5 DDL + additive Phase-4 column (§5)
- [x] Phase 4 PAdES interaction (P5-L-10) — pre-flight + audit-log update + scope (§6)
- [x] Native scanner library survey + DEFER verdict (Q-E) (§7)
- [x] Trust-floor honesty obligations — third proven instance (§8)
- [x] Phase 5 risk register addressed + Riley's additional risks R-W19-A through R-W19-F (§9)
- [x] Phase 5.1+ deferral list (§10.2)
- [x] Phase 5 fidelity boundary matrix (§11)
- [x] Phase 5 scope fence (§12)
- [x] L-001 unchanged (§13)
- [x] Phase 5 freeze rule recorded (§14)

End of Phase-5 architecture amendment.
