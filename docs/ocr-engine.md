# OCR Engine — Detailed Design (Phase 5)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-27 (Wave 19)
**Status:** Phase 5 design, locked at end of Wave 19. Companion to `docs/architecture-phase-5.md`. Read both together.
**Owner of implementation:** David (Wave 20, main-process) + Ravi (Wave 20, schema v5) + Riley (Wave 20, renderer modals + slices).
**Reads:** `docs/architecture-phase-5.md`, `docs/api-contracts.md §16`, `docs/data-models.md §10`, `docs/conventions.md §16`, `docs/edit-replay-engine.md`, `docs/signature-engine.md` (for the discipline pattern mirror).

---

## 1. Document scope

This document is the implementation-readable contract for Phase 5 OCR. It defines:

1. The Tesseract.js worker lifecycle — pool shape, acquire/release semantics, watchdog.
2. The language pack manager — bundled-vs-downloaded resolution, integrity check, download orchestration.
3. The text-behind-image authorship — pdf-lib `/Contents` stream extension, coordinate transformation, font handling.
4. The confidence aggregation — per-word data shape, page-level summary, threshold-based UI surfacing.
5. The image preprocessing pipeline — deskew / denoise / contrast helpers.
6. The job lifecycle — modal-driven blocking flow with progress events + cancellation.

Cross-reference: high-level architectural decisions and rationale live in `architecture-phase-5.md`. Everything below is the engine-level "how it works" detail Wave 20 implementers need.

---

## 2. Engine selection rationale

### 2.1 Why `tesseract.js` (Apache-2.0)

| Concern | `tesseract.js` (primary) | `node-tesseract-ocr` (escape hatch) |
|---|---|---|
| License | Apache-2.0 ✓ | MIT ✓ |
| Install footprint | npm install adds ~25 MB (WASM core + JS); no system deps | npm install ~50 KB BUT requires user to install Tesseract binary separately via Chocolatey / winget / manual download |
| Cross-platform (Phase 7 future) | Pure WASM + JS; works on Windows / macOS / Linux without rebuild | Calls system Tesseract; user installs it per-platform |
| Electron packaging | Vite bundles WASM + JS into `dist/main/`; needs `app.asar.unpacked` for the worker script (R-W19-A) | System Tesseract binary not in our installer; users surprised when first run says "Tesseract not found" |
| Performance | ~10-30s per page on a modern machine at 300 DPI | ~3-10s per page (native C++ vs WASM) |
| Maintenance | Active GitHub (last release v7.0.0 Dec 2025); 35k+ stars | Active (v2.2.1, MIT); thin wrapper |
| **Verdict** | **Primary** — zero-friction install + cross-platform readiness; perf is acceptable per Phase 5 risk register row 3 | Phase 5.1 escape hatch — only if perf testing shows tesseract.js is unacceptable |

### 2.2 Why NOT system Tesseract for v1

The roadmap goal is "double-click install". Asking users to install Tesseract separately is friction that destroys conversion from "downloaded the app" to "ran OCR". Documented in `architecture-phase-5.md §3.1`.

### 2.3 The Phase 5.1 escape hatch (NOT shipped in Phase 5)

If Wave 20 perf testing on representative scans (300 DPI, multi-page contracts) reveals tesseract.js is unacceptably slow (>3 min/page on typical hardware), Phase 5.1 ships a Settings toggle `ocr.engine: 'tesseract-js' | 'system-tesseract'`. The `system-tesseract` path:

- Probes for a system Tesseract binary at `tesseract.exe` in `PATH`
- If present, uses `node-tesseract-ocr` (MIT) for the engine call
- If not present, surfaces a Settings hint with the install command (`winget install tesseract` or equivalent)

This is **NOT in Phase 5**. The Phase 5 contract is single-engine.

---

## 3. Worker lifecycle

### 3.1 Pool shape

```ts
// src/main/pdf-ops/ocr-worker-pool.ts

import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

export interface OcrWorkerPool {
  /** Get-or-create a worker for the given language. */
  acquire(lang: string): Promise<TesseractWorker>;
  /** Release every worker. Called from app.before-quit. */
  releaseAll(): Promise<void>;
  /** Status snapshot. */
  status(): WorkerStatus[];
}

export interface WorkerStatus {
  lang: string;
  createdAt: number;
  lastUsedAt: number;
}
```

### 3.2 Acquire semantics

`acquire(lang)`:

1. If a live worker exists for `lang`, update its `lastUsedAt` and return it.
2. If the pool is at `ocr.maxConcurrentLanguages` (default 4), terminate the LRU worker first.
3. Resolve the language pack path via `languagePackManager.resolve(lang)`. If `null` → throw `'language_pack_not_installed'`.
4. Call `createWorker(lang, 1, { langPath: <dir>, gzip: true, cachePath: app.getPath('userData') + '/tessdata-cache' })`. The `langPath` is the **directory** containing `<lang>.traineddata.gz`; tesseract.js v6+ resolves the file inside.
5. Wait for the worker's init handshake (tesseract.js v6+ initialization is implicit in `createWorker`).
6. Store the worker in the pool keyed by `lang`.
7. Return the worker.

### 3.3 Release semantics

`releaseAll()`:

1. For each worker in the pool, call `worker.terminate()`. This signals the underlying Worker thread to clean up its WASM memory and exit.
2. Clear the pool map.
3. Idempotent — safe to call multiple times.

Called from:

- `app.on('before-quit', () => pool.releaseAll())` — graceful exit
- `process.on('exit', () => pool.releaseAll())` — last-line cleanup; synchronous so we use `worker.terminate()` without await
- Wave 20 manual exit paths (e.g. test fixture cleanup)

### 3.4 Persistent-per-language pattern (P5-L-3)

The design choice is **one worker per language, persisted for the app lifetime**. Rationale:

- Worker init = 2-5 seconds (WASM load + language data load). Per-page churn would dominate runtime.
- Memory cost = ~40-80 MB per worker (WASM heap + language data). 4 workers = 160-320 MB peak; acceptable on any modern machine.
- LRU eviction handles "user goes through many languages" without unbounded growth.

If Wave 20 perf testing reveals this is the wrong shape (e.g. native Worker spawn is cheaper than expected), the pool shape stays the same — only the eviction policy changes. The pool interface (`acquire` / `releaseAll`) is the stable contract.

### 3.5 Per-page memory hygiene (R-W19-C mitigation)

The engine processes pages sequentially:

```ts
for (let p = pageRange.start; p <= pageRange.end; p++) {
  if (signal.aborted) break;
  const raster = await rasterizePage(doc, p, rasterDpi);   // ~25 MB
  const preprocessed = await preprocessImage(raster, opts); // ~25 MB (in-place modify or replace)
  const pageResult = await runOcrOnPage(pool, lang, preprocessed, opts);
  // raster + preprocessed are now eligible for GC
  await onPageDone(p, pageResult);
  // Yield to event loop so GC can run; explicit gc() call if --expose-gc
}
```

Bounded transient memory: ONE page raster + ONE OcrPageResult at a time, regardless of document size.

### 3.6 Watchdog (R-W19-D mitigation)

Per-page recognition runs under a watchdog timer (`ocr.workerWatchdogSec`, default 60). If the timer fires:

1. The engine `worker.terminate()`s the hung worker
2. Removes it from the pool
3. Records a `worker_watchdog_timeout` error on the current page's OcrPageResult
4. The job's `status` transitions to `failed` with `error_message: 'worker_watchdog_timeout_page_<N>'`
5. The Wave 22 user-guide documents the recovery path (close + reopen modal; possibly lower DPI)

---

## 4. Language pack management

### 4.1 Three states

| State | Where it lives | How it got there |
|---|---|---|
| **Bundled** (`eng` only in v1) | `process.resourcesPath/tessdata/eng.traineddata.gz` (read-only) | Diego's `electron-builder.yml extraResources` |
| **Downloaded** | `app.getPath('userData')/tessdata/<lang>.traineddata.gz` | `ocr:languagePackDownload` handler |
| **Missing** | n/a | UI prompts to download |

### 4.2 Resolution algorithm

```ts
function resolve(lang: string): string | null {
  // 1. Check bundled path
  const bundled = path.join(process.resourcesPath, 'tessdata', `${lang}.traineddata.gz`);
  if (fs.existsSync(bundled)) return path.dirname(bundled);

  // 2. Check downloaded path
  const downloaded = path.join(app.getPath('userData'), 'tessdata', `${lang}.traineddata.gz`);
  if (fs.existsSync(downloaded)) return path.dirname(downloaded);

  // 3. Not installed
  return null;
}
```

The function returns the **directory** containing the `.traineddata.gz` file, NOT the file path itself. Tesseract.js's `createWorker` expects a `langPath` directory; it appends `<lang>.traineddata` (with `.gz` if `gzip: true`).

### 4.3 Multi-language resolution

Tesseract supports multi-language recognition via `+`-joined codes (e.g. `eng+spa`). The resolution path:

1. Split the request lang on `+`
2. For each component, call `resolve(component)`
3. If all components are in the SAME directory, use it
4. If components are in DIFFERENT directories (bundled `eng` + downloaded `spa`), the engine **copies the downloaded packs into a tempdir** containing both bundled-symlinked and downloaded packs, returns that path

The copy is one-shot (or symlink on Linux); the tempdir is cleaned up on worker terminate.

### 4.4 Catalog file

`src/main/pdf-ops/language-pack-catalog.json` (Wave 20 author Riley):

```json
{
  "version": "2026-05-27",
  "baseUrl": "https://tessdata.projectnaptha.com/4.0.0_fast",
  "packs": [
    {
      "lang": "eng",
      "displayName": "English",
      "sizeBytes": 10422528,
      "sha256": "<TO_BE_FILLED_IN_WAVE_20>",
      "bundled": true
    },
    {
      "lang": "spa",
      "displayName": "Spanish",
      "sizeBytes": 9234112,
      "sha256": "<TO_BE_FILLED_IN_WAVE_20>"
    },
    ...
  ]
}
```

Wave 20 implementer fills in the `sha256` fields by fetching each pack from the upstream mirror and computing SHA-256. The catalog ships with the binary; updates require a new app release.

### 4.5 Download orchestration

```ts
async function download(
  lang: string,
  onProgress: (bytes: number, total: number) => void,
  signal: AbortSignal,
): Promise<LanguagePack> {
  // 1. Look up catalog entry
  const entry = catalog.packs.find(p => p.lang === lang);
  if (!entry) throw new Error('lang_not_in_catalog');

  // 2. Compute destination
  const destDir = path.join(app.getPath('userData'), 'tessdata');
  await fs.promises.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, `${lang}.traineddata.gz`);

  // 3. Stream-download from upstream
  const url = `${catalog.baseUrl}/${lang}.traineddata.gz`;
  await streamDownload(url, dest, onProgress, signal);

  // 4. Verify SHA-256
  const actualSha256 = await sha256File(dest);
  if (actualSha256 !== entry.sha256) {
    await fs.promises.unlink(dest);
    throw new Error('pack_integrity_failed');
  }

  // 5. Insert into language_packs table
  const stat = await fs.promises.stat(dest);
  const pack: LanguagePack = {
    lang,
    source: 'downloaded',
    filePath: dest,
    sizeBytes: stat.size,
    sha256: actualSha256,
    installedAt: Date.now(),
    lastUsedAt: null,
  };
  languagePacksRepo.upsert(pack);

  return pack;
}
```

The handler emits `ocr:languagePackDownload:progress` events at every `onProgress` callback (throttled to ~10/sec by the streamer).

### 4.6 Offline-after-first-use story

`tesseract.js`'s `createWorker` does NOT phone home. The `cachePath` option enables tesseract.js to cache decompressed `.traineddata` for subsequent loads, but the source is always the local `langPath`. Once a pack is in `resolve(lang)`'s resolution path, OCR works offline.

The user-facing message: "Language packs download on first use. Once installed, OCR works without internet."

### 4.7 Bundle versioning

`eng.traineddata.gz` ships from `@tesseract.js-data/eng` v4.x. The version is pinned in `package.json` so Wave 20 implementer can't accidentally bump to an incompatible version. The catalog file's `version` field bumps whenever the catalog content changes.

**Bump procedure (future):**

1. Update `@tesseract.js-data/eng` in `package.json`.
2. Re-run the catalog-builder script: `npm run build:ocr-catalog` (Wave 20 deliverable; fetches all 10 packs from the upstream, computes SHA-256, writes the catalog JSON).
3. Bump `catalog.version` to today's date.
4. Commit + release new app version. Users who upgrade will redownload non-bundled packs IF the SHA-256 changed (the resolve step finds the old downloaded file, but the next `download(lang)` re-checks the catalog hash and rejects on mismatch; the user re-clicks Download).

---

## 5. Text-behind-image authorship

### 5.1 Rendering-mode 3 pattern

PDF spec § 9.3.6: text rendering modes (`Tr` operator) — mode 3 = "Neither fill nor stroke text (invisible)". Used by every text-behind-image OCR system since Acrobat shipped one.

Per locked decision P5-L-5: this is the v1 output format. Alternative `ActualText` + `BMC/EMC` is more complex and may be added in Phase 7 for a11y but is NOT in scope for Phase 5.

### 5.2 Page composition

Per page, after OCR:

1. The original page's `/Contents` stream is read (pdf-lib `getContents()`).
2. The engine appends a new text-mode-3 block at the END of `/Contents` — the visual content paints first; our invisible text overlays on top (but doesn't paint visibly).
3. The page's `/Resources/Font` dictionary is extended (if needed) to reference `/Helvetica` (standard 14 — no font bytes embedded).
4. The page object is updated; pdf-lib's save flow handles serialization.

### 5.3 Coordinate transformation

Tesseract returns word boxes as `{ x0, y0, x1, y1 }` in **image-pixel coordinates** (top-left origin, integer pixels). PDFs use **user-space coordinates** (bottom-left origin, points = 1/72 inch).

Transformation helper (`searchable-pdf-builder.ts`):

```ts
export function imageToPdfRect(
  imgRect: { x0: number; y0: number; x1: number; y1: number },
  imgDimsPx: { widthPx: number; heightPx: number },
  pageDimsPts: { widthPts: number; heightPts: number },
): { x: number; y: number; width: number; height: number } {
  const sx = pageDimsPts.widthPts / imgDimsPx.widthPx;
  const sy = pageDimsPts.heightPts / imgDimsPx.heightPx;
  return {
    x: imgRect.x0 * sx,
    // flip Y: imgY is top-down; pdfY is bottom-up; word's *top* in PDF user-space = pageH - (imgY * sy)
    // word's *bottom* in PDF user-space = pageH - (imgBottom * sy) = pageH - (imgRect.y1 * sy)
    y: pageDimsPts.heightPts - (imgRect.y1 * sy),
    width: (imgRect.x1 - imgRect.x0) * sx,
    height: (imgRect.y1 - imgRect.y0) * sy,
  };
}
```

**The `pageDimsPts` input MUST come from the canonical pdf-lib metadata path in main** (Phase 4.1 `loadPdfMetadata` already exposes this; OCR engine reads it via `documentStore.getMeta(handle)`). Sentinel 612x792 defaults would silently produce wrong word positions on non-Letter PDFs — exactly the defect class the 2026-05-26 global JSONL entry warns against.

Golden-bytes-tested at Wave 20 with three corpus PDFs:
- `tests/fixtures/ocr-corpus/letter-portrait.pdf` (US Letter, 612×792 pts)
- `tests/fixtures/ocr-corpus/legal-portrait.pdf` (US Legal, 612×1008 pts)
- `tests/fixtures/ocr-corpus/a4-portrait.pdf` (A4, 595×842 pts)

Each fixture has 5 known-position synthetic words; the test asserts `imageToPdfRect` produces the expected user-space coords within 0.5 pt tolerance.

### 5.4 Text block authorship

For each recognized word, emit:

```
BT
3 Tr                  % invisible
/F0 <fontSize> Tf     % F0 = Helvetica (added to page resources)
<x> <y> Td            % move text origin
(<escaped-text>) Tj   % paint (invisibly)
ET
```

Where:
- `fontSize` = `imgRect.height * sy` — the recognized word height in points. Tesseract's bounding box height correlates well with cap-height of the rendered glyph; this approximation makes the invisible text occupy the same vertical space as the visible image. Good enough for selection — when users drag-select over the visible image, the invisible text is selected at approximately the right vertical position.
- `x`, `y` = the PDF user-space position from `imageToPdfRect`.
- `escaped-text` = PDF string escaping: `(` → `\(`, `)` → `\)`, `\` → `\\`. For non-Latin-1 chars, use hex string `<...>` with a `/ToUnicode` CMap (v1 ships a minimal helper for BMP-only Unicode; full CMap support is Phase 5.1+).

### 5.5 Multi-page output

For a multi-page OCR job:

1. The engine produces a single output PDF containing the original visual content + the new text-behind-image layer on every recognized page.
2. The output replaces the source PDF on the next Save (the user is shown a confirmation: "OCR'd PDF will replace <filename> on Save").
3. Non-OCR'd pages in the same document are unchanged.

### 5.6 What this is NOT

- We do NOT embed the recognized text as a paragraph stream readable by accessibility tools without tagging. ActualText + MarkedContent would do that; Phase 5 defers it.
- We do NOT auto-rotate page orientation. If Tesseract detects a 90°-rotated scan, the user must rotate the page first (Phase 1 rotate-page op) then re-run OCR.
- We do NOT layout-reflow. The recognized words sit at their image positions; copy-paste of a column may interleave with the adjacent column. Phase 6 export-to-DOCX is where layout-aware reflow lives.

---

## 6. Confidence reporting

### 6.1 Per-word shape

```ts
export interface OcrWord {
  /** Recognized text (UTF-8). */
  text: string;
  /** Confidence 0-100 (Tesseract default scale). Float; usually 30-99 range. */
  confidence: number;
  /** Word bounding box in image-pixel coordinates (top-left origin). */
  imgRect: { x0: number; y0: number; x1: number; y1: number };
  /** Word bounding box in PDF user-space coordinates (bottom-left origin). Late-init. */
  pdfRect: PdfRect | null;
}
```

`pdfRect` is **null until the page is text-behind-image-composed**. Per the nullable + late-init pattern (Phase 4.1.1), consumers either get the real value or fail loudly. No sentinel default of `{ x: 0, y: 0, width: 0, height: 0 }`.

### 6.2 Page-level summary

```ts
export interface OcrPageResult {
  pageIndex: number;
  imgDimsPx: { widthPx: number; heightPx: number };
  totalWords: number;
  lowConfidenceWords: number;
  meanConfidence: number;
  /** Sorted ascending by index; one per recognized word. */
  words: OcrWord[];
  /** Recognition wall-clock time. */
  durationMs: number;
}
```

### 6.3 Job summary

```ts
export interface OcrJobSummary {
  jobId: number;
  pageRange: { start: number; end: number };
  langs: string[];
  status: 'completed' | 'cancelled' | 'failed';
  totalWords: number;
  meanConfidence: number;        // weighted mean across all words across all pages
  totalDurationMs: number;
  pageResults: OcrPageResult[] | null;   // null while job is in-flight; populated on completion
  error?: string;
}
```

`pageResults` is the canonical late-init field per §1.

### 6.4 Low-confidence threshold

Default `ocr.lowConfidenceThreshold: 60`. The threshold is applied at RENDER time, not at recognition time — the raw confidence values are preserved in `ocr_results.words_json` regardless. Changing the threshold in Settings re-renders the confidence overlay without re-running OCR.

The chosen default (60) comes from Tesseract's own documentation as the "good enough" threshold. Phase 5.1 may add a "show confidence histogram" affordance to help users tune.

### 6.5 Image preprocessing helpers

Three preprocessing toggles in the OCR modal (per ui-spec.md §14.4):

- **Deskew** — detects rotation via Hough transform on detected text lines; rotates to nearest 0/90/180/270 if confidence > 70%. Smaller deskews (< 10°) are corrected. Pure function over `Uint8Array` raster bytes.
- **Denoise** — bilateral filter (preserves edges; removes Gaussian noise). Tunable kernel size via `ocr.denoise.kernel` (default 3).
- **Contrast boost** — histogram equalization. Useful for faded scans.

Implemented as pure functions in `image-preprocess.ts`:

```ts
export function deskew(bytes: Uint8Array, width: number, height: number): Uint8Array;
export function denoise(bytes: Uint8Array, width: number, height: number, kernel: number): Uint8Array;
export function contrastBoost(bytes: Uint8Array, width: number, height: number): Uint8Array;
```

Each returns a NEW buffer (immutable; per conventions §13.2 pure-function discipline). The pipeline applies them in fixed order: deskew → contrast → denoise. Order chosen because deskew rotates, contrast prepares histogram, denoise smooths — each step builds on the prior.

**Wave 20 note:** the algorithms can use lightweight pure-JS implementations or off-the-shelf permissive libraries (e.g. `jimp` if MIT — Diego verifies in Wave 20). If implemented from scratch, perf budget is ≤500ms per page at 300 DPI on typical hardware.

---

## 7. Job lifecycle

### 7.1 IPC sequence

```
Renderer                                   Main
========                                   ====
                                           (workers idle)

ocr:runOnDocument({ handle, pageRange, langs,
                    preprocess,
                    invalidatesSignaturesConfirmed })
                       ─────────────────►
                                           1. Validate payload (zod)
                                           2. Check existing PAdES signatures
                                              If present AND
                                              !invalidatesSignaturesConfirmed:
                                                  return ok or fail (per §6)
                                           3. Insert ocr_jobs row (status=queued)
                                           4. For each lang in langs:
                                                 pool.acquire(lang)
                                           5. status = running
                                           6. For each page:
                                                 emit ocr:progress event
                                                 rasterize → preprocess → recognize
                                                 emit ocr:progress event
                                                 insert ocr_results row
                                           7. compose searchable PDF
                                           8. status = completed
                                           9. Update ocr_jobs row
                                           10. If invalidatesSignatures:
                                                  UPDATE signature_audit_log
                       ◄─────────────────  return { jobId, summary, op: EditOperationSerialized }
                       (also event stream ▲ during the run)
                       on ocr:progress events
```

### 7.2 Event stream shape

```ts
type OcrProgressEvent =
  | { jobId: number; phase: 'starting'; totalPages: number }
  | { jobId: number; phase: 'rasterizing'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'preprocessing'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'recognizing'; pageIndex: number; totalPages: number; confidenceSoFar: number | null }
  | { jobId: number; phase: 'composing-text-behind-image'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'writing-output'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'completed'; summary: OcrJobSummary }
  | { jobId: number; phase: 'cancelled'; pagesCompleted: number; totalPages: number }
  | { jobId: number; phase: 'failed'; pagesCompleted: number; totalPages: number; error: string };
```

The renderer's `<ProgressStep>` listens via `window.pdfApi.ocr.onProgress((event) => { ... })`. Same pattern as Phase 3 mail-merge.

### 7.3 Cancellation

`ocr:cancelJob({ jobId })`:

1. Look up the in-flight job.
2. Set `signal.abort()` on the AbortController.
3. The engine's per-page loop checks `signal.aborted` between pages. Once the current page completes recognition, the loop exits.
4. The worker is NOT terminated (workers persist).
5. The `ocr_jobs.status` transitions to `cancelled`.
6. Any partial output PDF is discarded — no half-OCR'd file on disk.
7. The handler returns `Result<{ cancelled: true; pagesCompleted: number }, never>`.

**Mid-page cancellation is Phase 5.1+.** Tesseract.js v7 doesn't expose a per-recognition abort signal; we'd need to wrap the worker's message handling. Punted to Phase 5.1.

### 7.4 Modal-driven blocking (P5-L-7)

Per locked decision: v1 is modal-driven. The OCR modal owns the lifecycle:

- Open modal → step 1 (config) → step 2 (running, progress bar) → step 3 (done, summary)
- Close modal → fires `ocr:cancelJob` if job in-flight
- Modal cannot be dismissed during step 2 except via the Cancel button (Esc maps to Cancel; the X button maps to "really cancel?" confirm)

**No background scheduling.** Users who want to run OCR while doing other work in the app must wait; this is acceptable for v1 per the phase plan's MEDIUM-severity risk row 3 mitigation. Phase 5.2 may add a background queue.

---

## 8. Phase 4 PAdES interaction (cross-ref architecture-phase-5.md §6)

### 8.1 Pre-flight detection

`detectPriorPadesSignatures(doc)`:

```ts
// returns the list of field names with non-empty /V /Contents (i.e. previously-signed)
export function detectPriorPadesSignatures(doc: PDFDocument): string[] {
  const form = doc.getForm();
  return form
    .getFields()
    .filter(f => f.acroField.getType() === 'Sig')
    .filter(f => {
      const v = f.acroField.dict.get(PDFName.of('V'));
      if (!v) return false;
      const contents = v.dict?.get(PDFName.of('Contents'));
      return contents != null && contents.toString().length > 0;
    })
    .map(f => f.getName());
}
```

Fast read-only pass; no doc mutation.

### 8.2 Confirm-before-proceeding

If `detectPriorPadesSignatures(doc).length > 0`:

1. The handler returns `Result<never, 'signed_pdf_requires_confirm'>` with the affected field names in the error payload.
2. The renderer's OCR modal step 2 surfaces a non-skippable prompt: "This PDF has N cryptographic signature(s). Running OCR will invalidate them. Continue?"
3. User clicks "Continue and invalidate" → renderer re-issues `ocr:runOnDocument` with `invalidatesSignaturesConfirmed: true`.
4. Handler proceeds; `ocr_jobs.invalidated_signatures` is set to 1.

### 8.3 Audit log update

After the OCR job completes successfully:

```sql
UPDATE signature_audit_log
SET invalidated_by_ocr_job_id = ?
WHERE doc_hash = ?
  AND id IN (SELECT id FROM signature_audit_log
             WHERE doc_hash = ? AND field_name IN (?, ?, ...));
```

The `signature_audit_log` panel shows: "Invalidated by OCR (job #N) on YYYY-MM-DD" alongside the original signature row.

### 8.4 Replay-engine guard

Replay step 3.9 (per architecture-phase-5.md §4.8) trusts the carried `invalidatesSignatures` flag. The engine does NOT re-prompt at replay; the user already confirmed at modal time. The audit log row is the durable record.

---

## 9. Wave 21 Julian audit checklist (mechanical greps)

Following the Phase 4 §15.5 pattern, here are the mechanical checks for Wave 21:

```bash
# (1) Every IPC handler uses zod safeParse
rg -n "safeParse" src/ipc/handlers/ocr-*.ts src/ipc/handlers/scan-*.ts
# Should produce ≥ 7 matches (one per handler).

# (2) No raster bytes echoed in renderer-facing types
rg -n "rasterBytes|imageBytes|pageBitmap" src/client/
# Should produce ZERO matches — raster bytes stay in main.

# (3) Worker pool releaseAll wired on quit
rg -n "app\.on\(['\"]before-quit" src/main/
# Should find a match that calls workerPool.releaseAll().

# (4) Language pack SHA-256 verified on download
rg -n -B 3 -A 10 "streamDownload" src/main/pdf-ops/language-pack-manager.ts | rg "sha256"
# Should produce a match (the verify-before-keep block).

# (5) No sentinel defaults in OcrPageResult shape
rg -n "pageResults: \[\]|words: \[\]|confidence: 0" src/main/pdf-ops/
# Should produce ZERO matches.

# (6) The required-on-interface pattern: runOcrOnPage takes pool as REQUIRED
rg -n "runOcrOnPage" src/main/pdf-ops/ocr-engine.ts
# The signature should NOT use `pool?:` or `pool: TesseractWorkerPool | undefined`.

# (7) PAdES pre-flight wired into the OCR handlers
rg -n "detectPriorPadesSignatures" src/ipc/handlers/ocr-*.ts
# Should produce a match in ocr-run-on-document.ts AND ocr-run-on-page.ts.

# (8) Confidence threshold applied at render time, not at recognition
rg -n "confidence < |lowConfidenceThreshold" src/main/pdf-ops/ocr-engine.ts
# The threshold is applied in src/client/, not in the engine output. Engine output = raw confidences.

# (9) Phase 5.1 placeholder handlers return the documented error variant
rg -n "not_implemented_phase_5_1" src/ipc/handlers/scan-*.ts
# Should produce ≥ 2 matches.

# (10) No worker spawned per page (anti-pattern)
rg -n "createWorker" src/main/pdf-ops/ -g '!ocr-worker-pool.ts'
# Should produce ZERO matches — only the pool calls createWorker.
```

---

## 10. Cross-reference checklist (Wave 19 self-verification)

- [x] Engine selection rationale + escape hatch (§2)
- [x] Worker lifecycle: pool shape + acquire/release + persistent-per-lang + per-page hygiene + watchdog (§3)
- [x] Language pack management: 3 states + resolution + catalog + download + offline (§4)
- [x] Text-behind-image: rendering mode 3 + coord transform + text block authorship + multi-page (§5)
- [x] Confidence reporting: per-word shape + page summary + job summary + threshold + preprocessing (§6)
- [x] Job lifecycle: IPC sequence + event stream + cancellation + modal-driven (§7)
- [x] Phase 4 PAdES interaction (cross-ref) (§8)
- [x] Wave 21 Julian audit mechanical greps (§9)
- [x] All Phase 5 locked decisions (P5-L-1 through P5-L-10) anchored back to architecture-phase-5.md §1 (this doc references them throughout)
- [x] No new BrowserWindow; L-001 untouched

End of Phase-5 OCR engine design doc.
