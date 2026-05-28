# ARCHITECTURE — Phase 6 Additions (Export to Office)

**Author:** Riley (front-end-architect)
**Date:** 2026-05-27 (Wave 23)
**Status:** Phase 6 design, locked at end of Wave 23. Additions to Phase-1 `ARCHITECTURE.md`, Phase-2 `docs/architecture-phase-2.md`, Phase-3 `docs/architecture-phase-3.md`, Phase-4 `docs/architecture-phase-4.md`, and Phase-5 `docs/architecture-phase-5.md` — all five frozen per the P5-L-FREEZE rule (architecture-phase-5.md §14), extended below as P6-L-FREEZE.
**Scope:** Architectural deltas needed for Phase 6 features — PDF → Word (.docx), PDF → Excel (.xlsx), PDF → PowerPoint (.pptx), and PDF → image formats (PNG, JPEG, TIFF). Layout-preserving best-effort quality tier (locked 2026-05-22) via pdf.js text-content extraction + bounding-box clustering + line-grid table detection + image extraction.
**Reads:** `ARCHITECTURE.md`, `docs/architecture-phase-2.md`, `docs/architecture-phase-3.md`, `docs/architecture-phase-4.md`, `docs/architecture-phase-5.md`, `docs/edit-replay-engine.md`, `docs/form-engine.md`, `docs/signature-engine.md`, `docs/ocr-engine.md`, `docs/phase-6-plan.md`.

> **Companion document.** This file describes the system additions. The detailed
> design of the export engine (pdf.js text-content extraction, bounding-box
> clustering algorithm, table detection via line-grid analysis, image
> extraction via operator stream, per-format output writers for docx / xlsx /
> pptx / png / jpeg / tiff, quality-tier selection, job lifecycle) lives in
> [`docs/export-engine.md`](export-engine.md). Read both together.

---

## 0. Scope

Phase 6 lights up the **Export to Office** surface. Specifically:

1. **PDF → Word (.docx)** — extract text + cluster into paragraphs + detect headings + detect tables + embed images. Authored via the `docx` package (MIT).
2. **PDF → Excel (.xlsx)** — extract tables via line-grid analysis; populate rows / columns / cells with simple alignment + numeric coercion. Authored via the existing `exceljs` (MIT, already in deps from Phase 3 mail merge).
3. **PDF → PowerPoint (.pptx)** — one slide per source page; text positioned by bounding box; images embedded at their PDF coords. Authored via `pptxgenjs` (MIT).
4. **PDF → image formats (PNG / JPEG / TIFF)** — per-page rasterization at user-chosen DPI. PNG via the main-process pdfjs `canvas` render pipeline (already used by Phase 4.1 + Phase 5 OCR); JPEG via the same canvas with quality slider; TIFF via `utif` (already in deps from Phase 5 raster import). Multi-page bundling supported for TIFF.
5. **Quality tiers — locked 2026-05-22:** the headline tier is **layout-preserving best-effort**. A `text-only` fast tier ships alongside (one-text-block-per-paragraph; no clustering, no images, no tables). Locked default per-format: Word + PowerPoint default to `layout-preserving`; Excel defaults to `text-only` because Excel input is inherently row/col-structured (cells come from line-grid analysis regardless of tier; the tier only controls whether non-table text is also extracted as a sidebar sheet). Image formats have no tier (rasterization is a single path).
6. **Export-job lifecycle** — background queue with progress UI (mirrors Phase 5 OCR job lifecycle pattern; modal-blocking is too brittle for multi-format batch exports). Per-page progress + cancel; job persistence across app restarts is NOT in Phase 6 (Phase 7+ if demand).
7. **Phase-1-to-Phase-5 interaction** — annotations default INCLUDE in export, with user toggle in modal; signed PDFs are READ-only (export does NOT mutate the source signed PDF, so signatures stay valid on the original; the exported docx/xlsx/etc. has no signature semantics — trust-floor obligation surfaces this); filled form fields (Phase 3 flat or AcroForm) export as native text via the same pdf.js `getTextContent` path that consumes them post-flattening; OCR'd text (Phase 5 text-behind-image) exports as native text because pdf.js sees the invisible BT/ET blocks as text content.

Each section below describes the architectural delta. Phase 1 / 2 / 3 / 4 / 5 chapters that aren't amended remain authoritative.

---

## 1. Locked decisions encoded (Wave 23 self-check)

| ID | Decision | Encoded where in this doc | Cross-ref |
|---|---|---|---|
| **P6-L-1** | Quality tier: **layout-preserving best-effort** (locked roadmap decision 2026-05-22). Algorithm: pdf.js `getTextContent` → bounding-box clustering for paragraphs/headings → line-grid analysis for tables → image extraction via operator stream. `text-only` fast tier ships alongside as opt-in toggle. | §4.1 (single-funnel), §4.2 (tier selector), §4.3 (layout algorithm) | `export-engine.md §2` |
| **P6-L-2** | **DOCX library: `docx` (MIT) v9.7+.** Scope in v1: `Paragraph`, `TextRun`, `HeadingLevel`, `Table` / `TableRow` / `TableCell`, `ImageRun`. Deferred to Phase 6.1: `Footnote`, `Comment`, revision tracking, custom styles beyond `Heading1..6`. Per Q-A. | §3.1 (libs), §4.4.1 (docx writer scope) | `export-engine.md §4` |
| **P6-L-3** | **XLSX library: `exceljs` (MIT, already in deps from Phase 3 mail merge).** Phase 6 use is read-compatible-with mail-merge use (both author workbooks; no shared state). The line-grid table detector feeds `worksheet.addRow(...)`; cell text alignment + numeric coercion happens at the writer boundary. | §3.1 (libs), §4.4.2 (xlsx writer scope) | `export-engine.md §5` |
| **P6-L-4** | **PPTX library: `pptxgenjs` (MIT) v4+.** One slide per source PDF page; text positioned by EMU-converted bounding box; images embedded at their PDF coords; slide size = source page size scaled to 16:9 if no source aspect match (with letterboxing). | §3.1 (libs), §4.4.3 (pptx writer scope) | `export-engine.md §6` |
| **P6-L-5** | **Image rasterization: reuse the existing pdfjs-in-main render pipeline** (Phase 4.1.1 metadata loader + Phase 5 OCR rasterizer already established the pattern). PNG = browser-native canvas `toBuffer('image/png')`; JPEG = `toBuffer('image/jpeg', { quality })` with default 0.9; TIFF = `utif.encodeImage(...)` over the same canvas RGBA, single-page or multi-page bundled. NO new rasterization library. | §3.1 (libs), §4.4.4 (image writer scope) | `export-engine.md §7` |
| **P6-L-6** | **Export-job scheduling: background queue with progress UI** (Q-E). Per-format job picked from a queue; concurrency cap = 1 (single export at a time; multi-format batch enqueues sequentially). Modal-driven entry; progress surfaces in a non-blocking status-bar widget + an "Export jobs" sidebar tab. Job persistence across restarts deferred to Phase 7+. | §4.5 (lifecycle), §4.6 (queue) | `export-engine.md §8` |
| **P6-L-7** | **Trust-floor honesty obligations (fifth instance after H-3 + Phase 3 forms + Phase 4 PAdES + Phase 5 OCR — strong pattern).** Five Phase-6 obligations enumerated §8 — surface at three locations per the four-times-proven Nathan Wave 18 pattern. | §8 (trust-floor) | `ui-spec.md` Phase-6 amendment §15.13 |
| **P6-L-8** | **Annotations export interaction: include by default; user toggle in modal.** Per `ui-spec.md §13` annotation summary export expectations, Phase 6 default INCLUDES rendered annotations in the rasterized output (PNG/JPEG/TIFF render the visible page including annots) AND surfaces text annotations (sticky notes, text boxes) as inline text in docx/pptx. Highlight + strikethrough are preserved visually via the rasterized image embedding for layout-preserving tier. Excel: annotations are excluded (cells are data, not visual). | §4.7 (annotation interaction) | `data-models.md` Phase-6 amendment §11.4 |
| **P6-L-9** | **Signed PDFs: export is READ-only on the source.** The export engine reads pdf.js text + operator stream + page raster from the source; it never mutates the source bytes. PAdES signatures on the source remain valid. The exported docx/xlsx/etc. is a NEW file with no signature semantics — trust-floor obligation #4 makes this explicit. | §6 (Phase-1-to-Phase-5 interaction), §8 obligation #4 | `architecture-phase-4.md §10.3` |
| **P6-L-10** | **Schema delta: ONE new table (`export_jobs`) for in-progress + historical tracking.** No new per-format defaults table — per-format defaults fold into the existing `settings` key-value store (keys `export.docx.*`, `export.xlsx.*`, `export.pptx.*`, `export.image.*`). Forward-only migration v6. No Phase 1-5 table touched. | §5 (schema v6), data-models.md §11 | `data-models.md §11` |

**Cross-check against Phase 4.1 sentinel-default lesson (global JSONL 2026-05-26 + Wave 19 P5-L-7 callout):** Phase 6 design uses **nullable + late-init** for `ExportJobSummary.perPageProgress` (initially `null`, hydrated as pages export). Bounding-box rectangles in the layout extractor use `LayoutRect: { x: number; y: number; w: number; h: number } | null` for empty / unmeasured pages — never the sentinel `{0,0,0,0}` that has bitten this project three times in prior phases. See §4.3.3.

**Cross-check against stub-shipped-with-TODO lesson (global JSONL 2026-05-27, Wave 18 + reaffirmed by P5-L-2 mechanism):** Phase 6's `runExportJob` function takes a REQUIRED `writer: ExportWriter` argument selected at call time from a discriminated union (`DocxWriter | XlsxWriter | PptxWriter | ImageWriter`). No optional writer fallback; no stub-default. If Wave 24 ships without wiring a writer, TypeScript fails the build. See §4.4.5.

**Cross-check against code-comment-contradiction lesson (Julian Wave 21 H-21.1, global JSONL 2026-05-27):** Phase 6's per-format writers MUST NOT use `as any` to silence library option-typing complaints. The library type-defs for `docx`, `exceljs`, `pptxgenjs` are robust and current; any TypeScript complaint about an unknown option is the type system correctly refusing a non-API path. Conventions §17 codifies this for the audit pattern. See conventions.md Phase-6 amendment §17.5.

**Cross-check against build-time-asset-copy lesson (Phase 4.1.1 vite-plugin-static-copy + Phase 5 electron-builder extraResources):** Phase 6 introduces NO new bundled binary assets — `docx`, `exceljs`, `pptxgenjs` are pure-JS libraries (no native binaries, no wasm, no data packs). The existing pdfjs `standard_fonts` copy step (Phase 4.1.1) is reused for layout-preserving text rendering; the existing tessdata copy step (Phase 5) is untouched. No new copy step. See §3.3.

---

## 2. Process model deltas

### 2.1 No new processes, no new windows

Phase 6 adds **no new BrowserWindow** and **no new long-lived OS process**. The export engine runs entirely in the main process; per-format writers compose their output buffers in memory then stream to disk via `node:fs/promises`.

**L-001 cross-check:** `enableDragDropFiles: true` on the main BrowserWindow is untouched. Phase 6 introduces:

- No new file-picker channels for OPEN — export operates on the currently-open document.
- A new file-picker channel `dialog:pickExportOutputPath` (Wave 24) for the output-file SAVE-AS dialog. Structurally identical to Phase 1 / Phase 2 / Phase 4 save-as dialog patterns; no L-001 surface change.
- No drag-drop entry points specific to export — the modal UI is the only entry.

Phase 6 does not weaken or extend L-001.

### 2.2 Main-process module additions

```
src/main/export/
  export-engine.ts                       (NEW — see export-engine.md §3 — SINGLE funnel for ALL export ops; pulls pdf.js text content + operator stream; dispatches to per-format writer)
  export-engine.test.ts                  (NEW)
  layout-extractor.ts                    (NEW — see export-engine.md §3.4 — bounding-box clustering: text-fragments→lines→paragraphs→blocks; heading detection by font-size delta)
  layout-extractor.test.ts               (NEW — golden-bytes corpus per conventions §13.6; 4 fixture PDFs: simple-text + multi-column + table-with-borders + image-heavy)
  table-detector.ts                      (NEW — see export-engine.md §3.5 — line-grid analysis via pdf.js operator stream; emits TableRegion[])
  table-detector.test.ts                 (NEW)
  image-extractor.ts                     (NEW — see export-engine.md §3.6 — operator-stream walk; OPS.paintImageXObject capture; inline image vs XObject reference; masked/transparent handling)
  image-extractor.test.ts                (NEW)
  export-queue.ts                        (NEW — see export-engine.md §8 — in-memory FIFO; concurrency=1; cancellation; status events)
  export-queue.test.ts                   (NEW)
  writers/
    docx-writer.ts                       (NEW — see export-engine.md §4 — docx library)
    docx-writer.test.ts                  (NEW — golden-bytes; 3 fixtures)
    xlsx-writer.ts                       (NEW — see export-engine.md §5 — exceljs)
    xlsx-writer.test.ts                  (NEW)
    pptx-writer.ts                       (NEW — see export-engine.md §6 — pptxgenjs)
    pptx-writer.test.ts                  (NEW)
    image-writer.ts                      (NEW — see export-engine.md §7 — png/jpeg/tiff; utif for tiff)
    image-writer.test.ts                 (NEW)

src/ipc/handlers/
  export-to-docx.ts                      (NEW)
  export-to-xlsx.ts                      (NEW)
  export-to-pptx.ts                      (NEW)
  export-to-images.ts                    (NEW — single format param: 'png' | 'jpeg' | 'tiff')
  export-cancel-job.ts                   (NEW)
  export-list-jobs.ts                    (NEW)
  export-list-formats.ts                 (NEW — returns the list of supported formats + per-format default quality tier + per-format setting keys; renderer uses this to render the format picker)
  dialog-pick-export-output-path.ts      (NEW — main-process file SAVE-AS dialog; structurally mirrors Phase 1's `dialog:pickSavePath`)
```

### 2.3 Renderer-process additions

```
src/client/components/
  modals/export-modal/                          (NEW — format picker → quality-tier picker → annotation-include toggle → output-path picker → progress)
    index.tsx
    format-picker.tsx                            (4 format cards: Word/Excel/PowerPoint/Image; Image expands to PNG/JPEG/TIFF sub-picker)
    quality-tier-picker.tsx                      (text-only vs layout-preserving radio; per-format default highlighted)
    per-format-options.tsx                       (per-format extras: DPI for images, include-annotations toggle, multi-page-TIFF bundle toggle, JPEG quality slider)
    per-format-limitations-panel.tsx             (the honesty surface — see §8 obligations; per-format trust-floor reminder)
    progress-step.tsx                            (per-page progress + cancel button; mirrors Phase 5 OCR pattern)
    export-modal.module.css
    export-modal.test.tsx
  export-jobs-sidebar-tab/                      (NEW — sidebar tab "Exports" alongside Pages / Bookmarks / Forms / Signatures / Annotations)
    index.tsx
    job-row.tsx
    job-status-badge.tsx
    export-jobs-sidebar-tab.module.css
    export-jobs-sidebar-tab.test.tsx
  status-bar-export-progress/                    (NEW — non-blocking progress indicator in the bottom status bar while an export job is running)
    index.tsx
    status-bar-export-progress.module.css
    status-bar-export-progress.test.tsx

src/client/state/
  slices/export-slice.ts                         (EXTEND from Phase 1 — Phase 1 created the stub for image-export of single pages; Phase 6 extends to four formats + job queue + per-format defaults)
  slices/export-selectors.ts                     (NEW)
  thunks-phase6.ts                               (NEW — exportToDocxThunk, exportToXlsxThunk, exportToPptxThunk, exportToImagesThunk, cancelExportJobThunk, listExportJobsThunk, listExportFormatsThunk, pickExportOutputPathThunk)

src/client/hooks/
  use-app-shortcuts.ts                           (EDIT — wire Ctrl+Shift+E (open Export modal) per ui-spec.md Phase-6 amendment §15.9)
```

### 2.4 Boundary discipline (extends Phase 1 / 2 / 3 / 4 / 5)

Conventions §10 (`renderer never holds Uint8Array of document bytes`) still holds. Phase 6 adds TWO new corollaries baked into the new conventions §17 amendment:

1. **Export output bytes stay in main; the renderer never receives a Uint8Array of docx/xlsx/pptx/image bytes.** The export engine writes the output directly to the user-chosen path via `node:fs/promises` in main; the renderer receives only `{ jobId, outputPath, sizeBytes, durationMs }` on completion. No "render the file inline" affordance in v1.

2. **Extracted text + layout metadata flow main → renderer ONLY as job-summary statistics, never as the full content.** `ExportJobSummary` carries `pagesProcessed`, `paragraphsExtracted`, `tablesDetected`, `imagesEmbedded`, `meanConfidenceOfExtractedText` (if OCR-applied source) — NOT the actual extracted text. The renderer never reconstructs the export content; for preview, it shows the source PDF (which is the same content the export reads from). See conventions §17.2.

These corollaries are NOT as risky as Phase 4's cert-bytes discipline (no secrets), but they preserve the §10 boundary that has held since Phase 1, and they prevent a tempting-but-wrong "show me the docx preview in the renderer" UX in v1.

### 2.5 IPC surface growth

8 new channels (full spec in `api-contracts.md §17`):

| Channel | Purpose | Stream events? |
|---|---|---|
| `export:toDocx` | Run a PDF→Word export job. Long-running; emits `export:progress` events. Returns `{ jobId, summary: ExportJobSummary }` on completion. | yes (`export:progress`) |
| `export:toXlsx` | Run a PDF→Excel export job. Long-running. | yes |
| `export:toPptx` | Run a PDF→PowerPoint export job. Long-running. | yes |
| `export:toImages` | Run a PDF→image export job. Multi-page emits per-page progress; supports `format: 'png' \| 'jpeg' \| 'tiff'`. | yes |
| `export:cancelJob` | Cancel an in-flight job. Idempotent. Worker / pdf.js context not torn down (reusable for next job). | no |
| `export:listJobs` | List rows from `export_jobs` (for the Exports sidebar). | no |
| `export:listFormats` | Returns `{ formats: ExportFormatDescriptor[] }` — per-format default quality tier + per-format setting keys. Renderer-cached. | no |
| `dialog:pickExportOutputPath` | Main-process file SAVE-AS dialog. Returns `{ outputPath: string \| null }`. | no |

Plus ONE new event stream (`export:progress`) following the same `mail-merge:progress` (Phase 3) / `ocr:progress` (Phase 5) pattern. The Phase 1-5 surface (api-contracts §1-§16) remains FROZEN. No existing channel's contract changes.

### 2.6 Zod validation discipline (extends conventions §0.1)

Every Phase 6 IPC handler validates payload with zod. Phase-6-specific shapes that need extra care:

1. `ExportToImagesRequest.format` — `z.enum(['png', 'jpeg', 'tiff'])`. Unknown = `invalid_payload`.
2. `ExportToImagesRequest.dpi` — `z.number().int().min(72).max(600)`. Outside = `invalid_payload`.
3. `ExportToImagesRequest.jpegQuality` — `z.number().min(0.1).max(1.0).optional()`. Only honored when `format === 'jpeg'`. Default 0.9.
4. `Export*Request.qualityTier` — `z.enum(['text-only', 'layout-preserving'])`. Per-format defaults applied at the renderer layer (request from renderer always carries explicit tier); main rejects sparse partial.
5. `Export*Request.pageRange` — `{ start: number, end: number }` with `start >= 0`, `end >= start`, `end < doc.pageCount`. Out-of-range = `invalid_payload`.
6. `Export*Request.includeAnnotations` — `z.boolean()`. Required field; renderer never sends sparse. Per P6-L-8 the renderer-side default is true except for Excel.
7. `Export*Request.outputPath` — `z.string().min(1)`. Path-existence and writability checks happen at the writer boundary (`output_path_unwritable` error).

The `zod` dependency is already in the project; no new dep.

---

## 3. Library inventory deltas

### 3.1 New runtime dependencies

| Library | Version | License | Process | Purpose |
|---|---|---|---|---|
| `docx` | 9.7.x (current at Wave 23 dispatch; v9.7.1 published 2026-04-22 per npm) | MIT | Main | DOCX authoring. Pure-JS; tree-shake-friendly (export only the surface we use — `Document`, `Packer`, `Paragraph`, `TextRun`, `HeadingLevel`, `Table`, `TableRow`, `TableCell`, `ImageRun`, `AlignmentType`). No native deps, no wasm. Bundle impact: ~250 KB raw / ~80 KB gzipped after tree-shake. License verified live `npm view docx license` → `MIT`. |
| `pptxgenjs` | 4.0.x (current at Wave 23 dispatch; v4.0.1 published 2026-03-15) | MIT | Main | PPTX authoring. Pure-JS. Bundle impact: ~600 KB raw / ~180 KB gzipped (larger than `docx` because pptx files are themselves more complex — chart helpers, slide masters; we don't use most). License verified live `npm view pptxgenjs license` → `MIT`. |

**Bundle-size note:** Both libraries land in `dist/main/` via Vite's electron-main bundler (no renderer-side import of these — see boundary §2.4). Combined raw bundle adds ~850 KB / ~260 KB gzipped. NSIS installer growth estimate: ~1 MB. Acceptable for the feature set. Documented for Diego's Wave 25 packaging notes.

**License verification (Wave 23, against npm registry 2026-05-27):**

- `docx` → `npm view docx license` → `MIT` (verified live; v9.7.1)
- `pptxgenjs` → `npm view pptxgenjs license` → `MIT` (verified live; v4.0.1)

Both are PERMISSIVE. Neither is AGPL/GPL/LGPL or commercial. Compliant with project policy.

**Native binding NOT added (Q-A / Q-B / Q-C decision):**

| Library | License | Why NOT primary |
|---|---|---|
| Apache POI (Java) | Apache-2.0 | Java runtime requirement; contradicts "double-click install" goal. Same rejection class as `node-tesseract-ocr` requiring system Tesseract. |
| `officegen` (npm) | MIT | Older library, less-maintained alternative for docx + xlsx + pptx in ONE package. Code quality and test coverage lag behind `docx` + `exceljs` + `pptxgenjs` (the modern dedicated triad). Wave-19 lesson "DEFER verdict beats one-line 'no good options'" applied here: officegen exists, is MIT, and is technically usable, but the three-library split is cleaner and better-tested. Documented in `export-engine.md §2.5` as the "single-package alternative we considered". Not a Phase 6 ship blocker. |
| `xlsx` / `xlsx-js-style` (SheetJS) | Apache-2.0 (community ed.) / MIT (xlsx-js-style fork) | exceljs is already in deps from Phase 3 mail merge AND has better TypeScript types AND has a more idiomatic stream-to-disk API. No reason to add a parallel xlsx writer. Documented for the audit trail. |
| `sharp` (libvips bindings) | Apache-2.0 | Native dep with prebuilt binaries (electron-rebuild complexity). The pdfjs render path already produces canvas → PNG/JPEG via browser-native APIs; reusing it is cheaper than introducing a native dep. `sharp` would only add value for advanced image processing (resize, color-space conversions) which Phase 6 doesn't need. Diego's risk register entry for sharp (`phase-6-plan.md` risk #2) is closed by the rejection — no native dep, no electron-rebuild expansion. |
| PDFTron / Apryse / Aspose | commercial | Permissive-OSS-only policy. Same rejection class as Phase 4 / 5 commercial-PDF-SDK options. |

### 3.2 Existing libraries — extended use

| Library | New Phase 6 use |
|---|---|
| `exceljs` | XLSX authoring. Phase 3 used it READ-side (parse CSV/XLSX rows for mail-merge data). Phase 6 uses it WRITE-side — same library, complementary surface, no shared state. The Phase 3 import path uses `Workbook.xlsx.readFile`; Phase 6 export path uses `Workbook.xlsx.writeFile`. No version bump needed. License + version unchanged from Phase 3 (MIT, 4.4.0). |
| `pdfjs-dist` | Source-text extraction via `getTextContent()` per page (the load-bearing API for the layout-preserving tier). Operator-stream walk via `getOperatorList()` for table line-grid analysis and image extraction. Page rasterization for image export (reuses Phase 4.1.1 + Phase 5 OCR pattern). |
| `pdf-lib` | Source metadata + page geometry queries. Reused for the "include annotations" path — pdf-lib's `getForm()` / `getAnnotations()` enumerate annots that the writer then emits as inline text (sticky notes / text boxes) or visual elements (highlights → rendered with the page raster). |
| `utif` | TIFF encoding for the image-export path. Already in deps from Phase 5 (raster import for OCR). Phase 6 use is symmetric: where Phase 5 decodes TIFF for OCR input, Phase 6 encodes TIFF for image export output. Multi-page TIFF bundling uses `utif.encodeImage` per page + a wrapper that concatenates IFD entries. License + version unchanged (MIT, 3.1.0). |
| `better-sqlite3` | Schema v6 migration `0006_phase6_export.sql` adds one table (`export_jobs`). See §5 + `data-models.md §11`. |
| `zod` | New schemas for the 8 IPC channels in §2.5. |
| `node:fs/promises` + `node:path` | Output-file writes + path canonicalization for the SAVE-AS dialog. No new deps. |
| `node:canvas` (pdfjs-dist transitive — `@napi-rs/canvas` already pulled in by Phase 5) | Rasterization for image export. Already vetted in Phase 5 (LICENSES.md). |

### 3.3 Build-time asset copy (Phase 4.1.1 + Phase 5 patterns reused)

**Phase 6 introduces NO new build-time asset copy step.** The two existing patterns are sufficient:

1. **pdfjs `standard_fonts` (Phase 4.1.1)** — already copies via `viteStaticCopy` from `node_modules/pdfjs-dist/standard_fonts/*` to `dist/main/standard_fonts/`. The layout-preserving text extraction needs glyph metrics for accurate bounding-box calculation; this path is already in place.
2. **tessdata (Phase 5)** — untouched; Phase 6 does not consume the language packs.

`docx`, `exceljs`, `pptxgenjs` are pure-JS — Vite's electron-main bundler ships them as part of `dist/main/index.js`. No extraResources entry. No staleness-vector risk (per the build-time-asset-copy global lesson).

### 3.4 Phase 6.1+ libraries (NOT added in Phase 6)

| Library | Phase | Purpose |
|---|---|---|
| `sharp` | 6.1 (escape hatch) | If users report image-export performance issues vs canvas-native, `sharp` can be added as an optional native dep behind a setting toggle. Same escape-hatch pattern as `node-tesseract-ocr` in Phase 5. NOT a Phase 6 blocker. |
| `docx` extension surfaces | 6.1+ | Footnotes, comments, revision tracking, custom styles beyond Heading1..6. Q-A defers these to 6.1. The `docx` library supports them; we just don't wire them yet to keep the v1 scope tight. |
| `pptxgenjs` chart helpers | 6.1+ | The library supports charts (bar, line, pie) which could be auto-generated from detected tables. Defer until user demand. |
| `mammoth` (DOCX → HTML round-trip) | 7+ | If we add a "preview the exported docx in-app" feature, mammoth (MIT) is the candidate. v1 has no preview. |

---

## 4. Export engine — high-level architecture

> Detailed design in [`docs/export-engine.md`](export-engine.md). This section
> describes the SHAPE of the engine and its integration points with the rest
> of the system.

### 4.1 Single engine path

The export engine is a **single funnel** — `export-engine.ts` is the only module that orchestrates per-format writers. The IPC layer dispatches into the engine; the engine pulls source data (pdf.js text-content + operator stream + page rasters) once per job and dispatches to ONE writer per job.

```
                              ┌──────────────────────────────┐
   export request        ──→  │ export-engine.ts             │  ──→ output file on disk
                              │ (single funnel)              │  ──→ export_jobs row (SQLite)
                              └──────────┬───────────────────┘  ──→ export:progress events
                                         │
                  ┌──────────────────────┼──────────────────────┐
                  ▼                      ▼                      ▼
         ┌────────────────┐   ┌──────────────────┐   ┌──────────────────┐
         │ layout-        │   │ table-detector   │   │ image-extractor  │
         │ extractor      │   │ (line-grid)      │   │ (operator-stream │
         │ (clustering)   │   │                  │   │  paintImageX)    │
         └────────┬───────┘   └────────┬─────────┘   └────────┬─────────┘
                  │                    │                       │
                  └────────────┬───────┴───────────────────────┘
                               │
                               ▼
                  ┌─────────────────────────────────┐
                  │ writer dispatcher (writers/*)   │
                  │ (one writer per job; selected   │
                  │ by request.format at runtime)   │
                  └─────────────────┬───────────────┘
                          ┌─────────┼──────────────┬──────────────┐
                          ▼         ▼              ▼              ▼
                     ┌────────┐ ┌────────┐  ┌────────────┐  ┌───────────┐
                     │ docx-  │ │ xlsx-  │  │ pptx-      │  │ image-    │
                     │ writer │ │ writer │  │ writer     │  │ writer    │
                     └────────┘ └────────┘  └────────────┘  └───────────┘
```

### 4.2 Quality-tier selection (P6-L-1 + Q-D)

The renderer's Export modal exposes a radio:

- **Layout-preserving (best-effort)** — runs the full pipeline: text → cluster → tables → images. Default for Word + PowerPoint.
- **Text-only (fast)** — bypasses clustering / table detection / image extraction; emits one `Paragraph` per pdf.js text-content item. Default for Excel (which uses table detection regardless; the tier here controls whether non-table text is also extracted as a sidebar sheet).

Per Q-D the layout-preserving tier is the **default** (the locked-decision tier per the 2026-05-22 roadmap). The fast text-only toggle is opt-in. The modal surfaces an estimated-time comparison ("Layout-preserving: ~5-30s/page; Text-only: ~0.5s/page").

The engine resolves the tier at call time and runs ONE path; no per-page tier mixing.

### 4.3 Layout extraction algorithm (P6-L-1 + Q-B)

> Full algorithm in `export-engine.md §3.4-§3.6`. This sub-section summarizes the
> shape so the architecture is reviewable in isolation.

#### 4.3.1 Bounding-box clustering (paragraph detection)

Tesseract-like recipe over pdf.js `getTextContent()` output:

1. **Lines:** cluster text fragments by Y-coordinate within ε (default `2pt`); members of the same line are sorted left-to-right by X.
2. **Paragraphs:** cluster lines by paragraph-break gap — a gap > `1.5 × median(line-height)` between consecutive lines starts a new paragraph.
3. **Headings:** detect by font-size delta — a line with `fontSize > 1.3 × median(body-font-size)` is a heading candidate; further classified by size into H1 / H2 / H3 (1.8×, 1.5×, 1.3× body respectively).
4. **Columns:** if a page's text fragments form two or more disjoint X-coordinate clusters (gap > `40pt`), treat as multi-column; cluster each column independently and emit them in reading order (left-to-right per language; locale-detection is Phase 6.1).

The thresholds (`ε`, `1.5×`, `1.3×`, `40pt`) are configurable via settings (`export.layout.lineEpsilonPt`, `export.layout.paragraphBreakRatio`, `export.layout.headingRatio`, `export.layout.columnGapPt`). Defaults chosen to match common PDF layouts.

#### 4.3.2 Table detection via line-grid analysis (Q-B)

`table-detector.ts` walks pdf.js `getOperatorList()`:

1. Capture all `OPS.constructPath` + `OPS.fill` / `OPS.stroke` operations that produce horizontal or vertical line segments.
2. Build a grid: cluster horizontal segments by Y; cluster vertical segments by X.
3. A grid with ≥ 2 horizontal AND ≥ 2 vertical clusters AND the segments form a closed rectangular grid is a **TableRegion**.
4. For each cell (intersection of grid lines), capture the text fragments whose bounding box falls inside the cell rectangle (using the same `getTextContent()` output as the layout extractor).
5. Emit `TableRegion[]` with `rows × columns × cellText` per region.

**Failure modes (documented honestly per the trust-floor pattern):**

- Borderless tables (table-shaped layouts without visible grid lines) are NOT detected. The risk register row 3 calls this out; the trust-floor obligation #2 (§8) makes it user-facing.
- Merged cells (rowspan / colspan in source) are detected as separate cells per the grid; merge inference is Phase 6.1+.
- Diagonal lines / decorative rules sometimes confuse the grid detector. The detector requires both horizontal AND vertical clusters; diagonal-only inputs produce ZERO TableRegion entries (correct fail-soft).

#### 4.3.3 Anti-sentinel discipline (cross-check with 2026-05-26 lesson)

The `LayoutRect` type used throughout the layout extractor is:

```ts
export type LayoutRect = { x: number; y: number; w: number; h: number } | null;
```

A page with no extractable text (image-only, non-OCR'd) returns `LayoutRect: null` for the page's content rect — NEVER the sentinel `{x: 0, y: 0, w: 0, h: 0}`. The writer dispatcher pattern-matches on `null` to render a "blank page / image-only" placeholder rather than producing wrong-but-plausible output. This is the structural fix from the 2026-05-26 sentinel-default lesson, applied a fourth time (after Phase 4.1.1 PageModel, Phase 5 OcrWord.pdfRect, Phase 5 OcrJobSummary.pageResults).

### 4.4 Per-format writers (Q-A through Q-F)

The writer dispatcher selects ONE writer per job based on `request.format`. Each writer takes the same `ExtractedDocument` input (the output of the layout extractor + table detector + image extractor) and produces a format-specific output buffer.

#### 4.4.1 DOCX writer scope (P6-L-2 + Q-A)

```ts
// docx-writer.ts surface
export async function writeDocx(doc: ExtractedDocument, opts: DocxWriteOptions): Promise<Uint8Array>;

interface DocxWriteOptions {
  outputPath: string;
  includeAnnotations: boolean;
  pageSize: 'letter' | 'a4' | 'auto';
  qualityTier: 'text-only' | 'layout-preserving';
}
```

Surface in v1:

- `Paragraph` — one per detected paragraph from layout extractor
- `TextRun` — for inline styled text (bold/italic detected by font-name match against common bold/italic variants; e.g. `Helvetica-Bold` → `bold: true`)
- `HeadingLevel` — `Heading1..3` mapped from layout-extractor heading levels
- `Table` / `TableRow` / `TableCell` — one per detected TableRegion
- `ImageRun` — embedded at original PDF coordinates; image bytes from image-extractor's operator-stream output
- `AlignmentType` — left / center / right detected by paragraph X-offset relative to page width

Deferred to Phase 6.1: footnotes, comments, revision tracking, custom styles beyond Heading1..3 + Normal, hyperlinks (Phase 6.1 candidate — pdf.js exposes link annotations; the docx library supports `ExternalHyperlink` / `InternalHyperlink`).

#### 4.4.2 XLSX writer scope (P6-L-3)

```ts
export async function writeXlsx(doc: ExtractedDocument, opts: XlsxWriteOptions): Promise<Uint8Array>;
```

Surface in v1:

- One worksheet per detected `TableRegion` named `Page<N>_Table<M>` (1-based indices).
- Cell text from cell content; numeric coercion attempted via `Number(text.trim())` → if NaN, treat as text.
- Simple alignment: left for text, right for numeric.
- IF `qualityTier === 'layout-preserving'`, an additional `Text_PageN` worksheet per page is populated with the page's non-table text (one row per detected paragraph). IF `text-only` tier, only the text worksheets are produced — table detection is skipped.

Deferred: cell formatting (font/color/border), formulas, pivot tables, charts. exceljs supports all of these; we just don't infer them from PDFs.

#### 4.4.3 PPTX writer scope (P6-L-4)

```ts
export async function writePptx(doc: ExtractedDocument, opts: PptxWriteOptions): Promise<Uint8Array>;
```

Surface in v1:

- One slide per source PDF page.
- Slide size: 16:9 wide-screen (10in × 5.625in) — the standard pptxgenjs default. Source-page content is positioned by EMU-converted bounding box; if the source page aspect ratio differs significantly from 16:9 (>10% delta), content is letterboxed (white margins; aspect preserved).
- Text positioned via `slide.addText(text, { x, y, w, h, fontSize, bold, italic })`. Position from layout-extractor bounding box; size from font-size detected on the page.
- Images embedded via `slide.addImage({ data, x, y, w, h })`. Image bytes from image-extractor.
- Tables emitted via `slide.addTable(rows, { x, y, w, h })`. One per detected TableRegion.

Deferred: slide masters, themes, animations, speaker notes (Phase 6.1 candidate — pdf.js exposes the form-XObject "speaker-notes" page hint if present; not common).

#### 4.4.4 Image writer scope (P6-L-5 + Q-F)

```ts
export async function writeImages(doc: ExtractedDocument, opts: ImageWriteOptions): Promise<Uint8Array[]>;

interface ImageWriteOptions {
  format: 'png' | 'jpeg' | 'tiff';
  dpi: number;                            // 72-600
  jpegQuality?: number;                   // 0.1-1.0; default 0.9; honored only for jpeg
  multiPageTiff?: boolean;                // default false; if true and format='tiff', emits ONE multi-page TIFF; if false, emits one TIFF per page
  outputPath: string;                     // for multi-page: the final file path; for single-page: a basename — engine appends `-page<N>.<ext>`
}
```

Defaults per Q-F:

- **PNG** is the default for the image-export modal (lossless; no quality slider).
- **JPEG** is opt-in with a quality slider (default 0.9; range 0.1-1.0).
- **TIFF** is opt-in with a multi-page-bundle toggle (default false → one TIFF per page; true → one multi-page TIFF).

Rasterization path: pdfjs `getDocument().getPage(i).render({ canvasContext, viewport })` at the user-chosen DPI, into a main-side `@napi-rs/canvas` (already in deps from Phase 5). Then:

- PNG: `canvas.toBuffer('image/png')`
- JPEG: `canvas.toBuffer('image/jpeg', quality)`
- TIFF: extract RGBA bytes via `canvas.getContext('2d').getImageData(0, 0, w, h)` → `utif.encodeImage(rgba, w, h)` → per-page IFD, concatenated for multi-page mode

#### 4.4.5 Anti-stub-shipped-with-TODO at the writer interface

```ts
// ✓ Correct (Phase 6 pattern; required-on-interface)
export interface RegisterExportOptions {
  layoutExtractor: LayoutExtractor;       // REQUIRED — no default
  tableDetector: TableDetector;
  imageExtractor: ImageExtractor;
  writers: {
    docx: DocxWriter;                     // all four REQUIRED
    xlsx: XlsxWriter;
    pptx: PptxWriter;
    image: ImageWriter;
  };
  queue: ExportQueue;
  jobsRepo: ExportJobsRepo;
}
```

If Wave 24 ships with any writer un-wired, typecheck fails. The dispatcher's `match` over `request.format` is exhaustive (TypeScript enforces via `never` branch); a missing writer surfaces at compile time.

### 4.5 Job lifecycle (P6-L-6 + Q-E)

#### 4.5.1 Background queue with progress UI (Q-E)

The export modal is the entry point for `export:to*` channels. On click:

1. The renderer dispatches the appropriate thunk → IPC handler.
2. Main inserts an `export_jobs` row (status=`queued`) and enqueues the job.
3. The queue processes one job at a time (`concurrency = 1`). Status transitions: `queued → running → completed | cancelled | failed`.
4. The modal closes after enqueue (NOT after completion). Progress surfaces in the status-bar widget + the Exports sidebar tab. The user can navigate / open other docs / start more exports (which queue up).
5. On completion, the status-bar widget emits a clickable toast: "Export complete. Open output folder."

**Why background queue and not modal-blocking (mirror of Phase 5 lesson):** Multi-format batch is a known user need (export to ALL of docx + xlsx + pptx + png for archival). Modal-blocking would force serial user-confirm-each-modal; queue with progress lets the user fire-and-forget.

**Mirror of Phase 5 lesson, INVERTED:** Phase 5's P5-L-7 picked modal-driven blocking because there was only one OCR job per doc per session typically. Phase 6 picks background queue because batch is normal. Both decisions are correct for their feature scope; documenting the inversion explicitly so Wave 24 doesn't apply the wrong pattern by analogy.

#### 4.5.2 Progress event shape

`export:progress` emits `{ jobId, format, phase, pageIndex, totalPages, percent }`:

```ts
type ExportProgressEvent =
  | { jobId: number; phase: 'starting'; totalPages: number; format: ExportFormat }
  | { jobId: number; phase: 'extracting-text'; pageIndex: number; totalPages: number; format: ExportFormat }
  | { jobId: number; phase: 'detecting-tables'; pageIndex: number; totalPages: number; format: ExportFormat }
  | { jobId: number; phase: 'extracting-images'; pageIndex: number; totalPages: number; format: ExportFormat }
  | { jobId: number; phase: 'rasterizing'; pageIndex: number; totalPages: number; format: ExportFormat }       // image format only
  | { jobId: number; phase: 'writing-output'; bytesWritten: number; totalBytesEstimate: number | null; format: ExportFormat }
  | { jobId: number; phase: 'completed'; summary: ExportJobSummary }
  | { jobId: number; phase: 'cancelled'; pagesCompleted: number; totalPages: number }
  | { jobId: number; phase: 'failed'; pagesCompleted: number; totalPages: number; error: string };
```

Subscribed via `window.pdfApi.export.onProgress((event) => { ... })`. Throttled to ≤ 10 events/sec per phase to avoid renderer rerender storms (same pattern as Phase 5).

#### 4.5.3 Cancellation semantics

`export:cancelJob` is **graceful**:

1. Sets a `cancelled` flag on the per-job state.
2. The engine checks the flag between pages (NOT mid-page-text-extract).
3. Partial output is **deleted** from disk — no half-exported docx/xlsx/pptx is left behind.
4. The `export_jobs` row's `status` transitions `running → cancelled`.

Mid-page cancellation is Phase 6.1+ (requires plumbing the abort signal through the writer libraries' synchronous APIs).

### 4.6 Queue shape

```ts
export interface ExportQueue {
  enqueue(job: ExportJobSpec): Promise<number>;       // returns jobId
  cancel(jobId: number): Promise<{ cancelled: boolean; pagesCompleted: number }>;
  status(): { running: number | null; queued: number[] };
  releaseAll(): Promise<void>;                         // called from app.before-quit
}
```

One job at a time. New requests enqueue (FIFO). The queue holds at most 50 queued + 1 running (configurable via `export.maxQueueSize`); attempting to enqueue when full returns `queue_full`. If `app.before-quit` fires with running/queued jobs, `releaseAll` cancels them and writes the partial-output cleanup before returning — Electron's `before-quit` honors the await (per the documented Electron quit-flow). The same `process.on('exit', ...)` belt-and-suspenders pattern from Phase 5 is reused.

### 4.7 Annotation export interaction (P6-L-8)

Per the locked decision in the brief, annotations DEFAULT INCLUDE in the modal (toggle on). Per-format treatment:

| Format | Default | Treatment |
|---|---|---|
| Word (docx) | include | Text annotations (sticky notes, text boxes) appended at the end of the relevant paragraph as `[Note: <text>]` inline runs. Highlights / strikethroughs preserved visually if any embedded page image carries them; otherwise dropped (we don't author run-level highlight in this version — Phase 6.1 candidate). |
| Excel (xlsx) | **exclude** | Cells are data, not presentation. Override possible via modal toggle (rarely useful). |
| PowerPoint (pptx) | include | Same as Word — text annotations append; visual annotations preserved if embedded in raster. |
| Image (png/jpeg/tiff) | include | The rasterized page IS the export. Annotations are rendered into the canvas by pdfjs's existing annotation layer; the export captures the page with annotations visible. Toggle off = render without annotations (uses pdfjs's `renderInteractiveForms: false, annotationMode: AnnotationMode.DISABLE` path). |

Documented in `ui-spec.md` Phase-6 amendment §15.3 (per-format-options sub-component). The toggle is single-source-of-truth in the modal; per-format default at modal-open is computed from the modal's selected format.

### 4.8 Phase-1-to-Phase-5 interaction (P6-L-9 + trust-floor obligations)

Export is **read-only on the source document**. Five interaction points:

1. **Annotations (Phase 1 / Phase 4):** see §4.7 — included by default; per-format treatment differs.

2. **Filled form fields (Phase 3):** if the source PDF has filled form values, pdf.js's `getTextContent` sees them as native text after Phase-3 flattening. The export captures them as inline text. Unflattened AcroForms also expose values via pdf.js's `getFieldObjects()` API; the engine falls back to that path for non-flattened forms. Documented as trust-floor obligation #3 (§8).

3. **PAdES-signed PDFs (Phase 4):** export READS from the source bytes; it never writes back to the source. The PAdES signature on the source remains valid. The exported docx/xlsx/etc. is a NEW file with NO signature semantics — a docx file cannot carry a PAdES signature. Trust-floor obligation #4 (§8). NO pre-flight prompt; we explicitly DO NOT mirror the Phase 5 P5-L-10 OCR-on-signed-PDF prompt because export does not mutate the signed bytes. Documented in §6.

4. **OCR'd text (Phase 5):** the text-behind-image layer that Phase 5 authors is visible to pdf.js's `getTextContent` (Phase 5 used render-mode 3 / invisible, NOT excluded-from-text-content). So OCR'd text exports as native text. **However:** if the source was image-only and was NOT OCR'd, the export's text content will be empty/sparse — the Word/PowerPoint output will be mostly raster-image with no selectable text. Trust-floor obligation #5 (§8) makes this explicit.

5. **Bookmarks (Phase 2):** docx supports a Table of Contents and bookmarks via `docx.TableOfContents` + `docx.Bookmark`. Phase 6 v1 emits a flat TOC at the start of the docx output, populated from the source PDF's outline (via pdf-lib's `getOutline()`). Heading-level mapping uses the layout-extractor's heading detection. Bookmark anchors are Phase 6.1+.

### 4.9 EditOperation integration (NONE)

**Phase 6 introduces NO new EditOperation variants.** Export is a read-only operation on the source PDF — it does not produce an edit to be replayed. The output is a separate file. Consequently:

- The replay engine (`edit-replay-engine.md`) is UNCHANGED by Phase 6.
- The `edit_history` SQLite table is UNTOUCHED by Phase 6.
- The undo/redo stack does not include export operations.

The new `export_jobs` table is a SEPARATE audit-log table — it records what was exported when, not what was edited. Documented in `data-models.md` Phase-6 amendment §11.

### 4.10 Replay-engine integration (NONE)

Per §4.9, the replay engine is unchanged. No new replay step. No new `ReplayError` variant. Documented as a deliberate non-delta for the audit trail.

---

## 5. Schema additions (P6-L-10)

### 5.1 New table — `export_jobs`

Full DDL in `data-models.md` Phase-6 amendment §11. Summary:

```sql
-- export_jobs — one row per export run (in-progress + historical)
CREATE TABLE export_jobs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash                 TEXT NOT NULL,
  format                   TEXT NOT NULL CHECK (format IN ('docx', 'xlsx', 'pptx', 'png', 'jpeg', 'tiff')),
  quality_tier             TEXT NOT NULL CHECK (quality_tier IN ('text-only', 'layout-preserving', 'n/a')),
  page_range_start         INTEGER NOT NULL,
  page_range_end           INTEGER NOT NULL,
  include_annotations      INTEGER NOT NULL DEFAULT 1,
  dpi                      INTEGER,                              -- only for image formats
  jpeg_quality             REAL,                                 -- only for jpeg
  multi_page_tiff          INTEGER,                              -- only for tiff; 0 or 1
  output_path              TEXT NOT NULL,                        -- absolute path on disk
  output_size_bytes        INTEGER,                              -- null until completed
  status                   TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
  started_at               INTEGER NOT NULL,
  completed_at             INTEGER,                              -- null until done
  duration_ms              INTEGER,                              -- null until done
  pages_processed          INTEGER NOT NULL DEFAULT 0,
  paragraphs_extracted     INTEGER,                              -- null until done; null for image formats
  tables_detected          INTEGER,                              -- null until done; null for image formats
  images_embedded          INTEGER,                              -- null until done; null for image formats
  error_message            TEXT,                                 -- non-null only on status='failed'
  created_at               INTEGER NOT NULL
);
CREATE INDEX idx_export_jobs_doc_hash ON export_jobs(doc_hash);
CREATE INDEX idx_export_jobs_status   ON export_jobs(status);
CREATE INDEX idx_export_jobs_format   ON export_jobs(format);

INSERT INTO schema_migrations (version, applied_at) VALUES (6, strftime('%s', 'now') * 1000);
```

### 5.2 No new per-format defaults table

Per-format defaults fold into the existing Phase-1 `settings` key-value store. Settings keys:

| Key | Type | Default | Purpose |
|---|---|---|---|
| `export.docx.qualityTier` | `'text-only' \| 'layout-preserving'` | `'layout-preserving'` | Default tier for docx |
| `export.docx.pageSize` | `'letter' \| 'a4' \| 'auto'` | `'auto'` | Default page size for docx output |
| `export.docx.includeAnnotations` | `boolean` | `true` | Default for the docx-export include-annotations toggle |
| `export.xlsx.qualityTier` | `'text-only' \| 'layout-preserving'` | `'text-only'` | Default tier for xlsx (Q-D: Excel inherently tabular) |
| `export.xlsx.includeAnnotations` | `boolean` | `false` | Default false (cells are data, not visual) |
| `export.pptx.qualityTier` | `'text-only' \| 'layout-preserving'` | `'layout-preserving'` | Default tier for pptx |
| `export.pptx.includeAnnotations` | `boolean` | `true` | Default true |
| `export.image.format` | `'png' \| 'jpeg' \| 'tiff'` | `'png'` | Default image format in the image-export sub-picker |
| `export.image.dpi` | `number` | `150` | Default DPI for image export |
| `export.image.jpegQuality` | `number` | `0.9` | Default JPEG quality |
| `export.image.multiPageTiff` | `boolean` | `false` | Default multi-page-TIFF bundling |
| `export.image.includeAnnotations` | `boolean` | `true` | Default for image-export include-annotations toggle |
| `export.layout.lineEpsilonPt` | `number` | `2` | Y-coordinate clustering epsilon (paragraph detection) |
| `export.layout.paragraphBreakRatio` | `number` | `1.5` | Line-gap / median-line-height threshold for paragraph break |
| `export.layout.headingRatio` | `number` | `1.3` | Font-size / median-body-font ratio for heading classification |
| `export.layout.columnGapPt` | `number` | `40` | Minimum X-gap for column boundary detection |
| `export.maxQueueSize` | `number` | `50` | Max queued + 1 running |

Folding into `settings` (vs a new table) is cheaper — no new schema, no new repo, no new boundary translation. The settings table already supports typed reads via `db-bridge.ts` (Phase 1 / 2 / 3 / 4 / 5 pattern). Documented as the simpler-of-two-options choice.

### 5.3 Migration behavior

- Forward-only. No rollback (consistent with Phase 1-5 policy).
- Idempotent — `migrate.ts` skips applied versions.
- Clean migration from schema v5 — ONE new table + setting key inserts (defaults seeded via `INSERT OR IGNORE`).
- No Phase 1-5 table touched.

### 5.4 Repository interface

```ts
// src/db/repositories/export-jobs-repo.ts (Ravi Wave 24)
interface ExportJobsRepo {
  insert(row: Omit<ExportJobRow, 'id' | 'created_at'> & { created_at?: number }): number;
  get(id: number): ExportJobRow | null;
  updateStatus(id: number, status: ExportJobStatus, completedAt?: number, durationMs?: number, errorMessage?: string): boolean;
  updateProgress(id: number, pagesProcessed: number, paragraphsExtracted?: number, tablesDetected?: number, imagesEmbedded?: number, outputSizeBytes?: number): boolean;
  listByDocHash(docHash: string, limit?: number, offset?: number): ExportJobRow[];
  listByStatus(status: ExportJobStatus, limit?: number, offset?: number): ExportJobRow[];
  listRecent(limit?: number): ExportJobRow[];
  delete(id: number): boolean;
}
```

`db-bridge.ts` translates snake_case rows ↔ camelCase DTOs. Same pattern as Phase 5's `OcrJobsRepo`. **Note: Phase 6 does NOT add a `language_packs`-equivalent table** — no asset catalog.

---

## 6. Phase 1-5 interaction summary (no per-phase pre-flight prompts)

Per P6-L-9, export is read-only on the source. NO mutation, NO PAdES invalidation, NO modal-driven invalidate-confirm.

### 6.1 What this is NOT (vs Phase 5)

- We do NOT mirror Phase 5's P5-L-10 OCR-on-signed-PDF pre-flight prompt. Export doesn't mutate the source.
- We do NOT mirror Phase 4's edit-after-sign invalidation. The export operation is not an edit.
- We do NOT mirror Phase 5's `signature_audit_log.invalidated_by_ocr_job_id` column for export. There is nothing to invalidate.

### 6.2 What this IS

- The `export_jobs` row records when an export ran against which `doc_hash`. This is an audit record, not an invalidation record.
- If the user wants the export's content to reflect post-edit state (annotations added, forms filled, OCR applied), they Save the PDF FIRST and then Export. The export reads the current on-disk bytes. Documented in the user-guide (Nathan Wave 26).
- The Exports sidebar tab lists historical exports for the current doc, identified by doc_hash. If the user re-Saves (changing the doc_hash via content delta), the prior exports are still listed but flagged "older version of this doc" — UX detail documented in `ui-spec.md` §15.4.

### 6.3 Form-field export specifics

- **Phase-3-flattened AcroForms:** values are in the page text content; pdf.js `getTextContent` sees them. No special handling.
- **Unflattened AcroForms:** values are in the form-field dictionary; pdf.js's `getFieldObjects()` enumerates them. The engine reads both paths and uses whichever has the value (preferring the flattened path when both exist). Documented in `export-engine.md §3.7`.
- **Phase-3 XFA forms (read-only per Phase 3 H-XFA):** XFA values are NOT in the page text content. We make zero claim about extracting them. Trust-floor obligation #5 (§8) makes this honest.

### 6.4 OCR'd text export specifics

- **Phase-5 text-behind-image:** the render-mode-3 BT/ET blocks are visible to `getTextContent`. The export captures them. No special handling.
- **Image-only PDFs (no OCR applied):** the export's text content is empty. Word/PowerPoint outputs are mostly raster images with sparse selectable text. Trust-floor obligation #5 surfaces this.
- **Mixed: some pages OCR'd, some not:** the export reflects the source — OCR'd pages export as text; non-OCR'd pages export as embedded raster image with no text. Documented honestly.

---

## 7. No native scanner / no native dep this phase

Phase 6 introduces ZERO native modules. `docx`, `exceljs`, `pptxgenjs` are pure-JS. The rasterization path uses the existing `@napi-rs/canvas` from Phase 5 (no new native dep). Diego's `electron-rebuild` matrix remains the same as Phase 5 (better-sqlite3 + @napi-rs/canvas).

The Phase 6 risk register row 2 (`sharp` native dep) is **closed by rejection** — we use the existing canvas path, not sharp. Documented in `phase-6-plan.md` risk #2 status update (Diego's Wave 25 packaging notes will mirror).

---

## 8. Trust-floor honesty obligations (fifth instance after H-3 + Phase 3 forms + Phase 4 PAdES + Phase 5 OCR — strong pattern)

Per the four-times-proven pattern (Nathan Wave 18 lesson + Phase 5 reaffirmation + global JSONL 2026-05-27), Phase 6 introduces a new set of trust-floor obligations that MUST be surfaced at the three documented locations: top-of-guide preamble + dedicated section + inline at every export-touching subsection.

### 8.1 The five Phase 6 obligations

1. **PDF → Office conversion is layout-preserving best-effort.** Complex multi-column layouts, embedded vector graphics, intricate tables (especially borderless or with merged cells), and decorative typography may not convert faithfully. The fast `text-only` tier is even more reductive — it produces accurate text in a flat structure with no images, no tables, no headings. Users should review the output before relying on it for downstream work.

2. **Borderless or merged-cell tables may not be detected.** The line-grid analysis requires explicit horizontal AND vertical line segments to identify a table region. Tables that visually exist via whitespace alignment alone produce a flat sequence of paragraphs in the output. Documented at point-of-action.

3. **Filled form values export as text; XFA-form values do not export.** Phase-3-flattened AcroForms produce inline text in the output. Unflattened AcroForms also produce text via the form-field-object fallback. **XFA forms (Phase 3 read-only) do NOT export their values** — the engine sees only the static template, not the dynamic XFA dataset. If the user needs XFA values, they must save the PDF first with the form flattened (Phase 3 `forms:flattenForExport`) before exporting.

4. **Exporting from a signed PDF: the source signature stays valid; the exported file has no signature semantics.** Export does NOT mutate the source PDF. The PAdES signature on the source remains valid (verifiable in Acrobat / our app's signature verify panel). The exported docx/xlsx/pptx/image has NO signature — these formats either don't support PAdES (docx, xlsx, pptx) or are unsigned by definition (images). Users who need a signed Office document must sign it in Office after export (out-of-scope for this app).

5. **OCR-status determines text fidelity.** If the source PDF has been OCR'd (Phase 5), text exports as native selectable text. If the source is image-only and was NOT OCR'd, the Word/PowerPoint output is mostly raster image with no selectable text. The engine does NOT auto-OCR before export — that would be a silent mutation of the source. Users should run OCR first (Phase 5 `ocr:runOnDocument`), save the searchable PDF, then export. Trust-floor reminder surfaces at the modal step 1.

**Cross-cutting obligation carried from Phase 4 / 5 (NOT counted as a Phase-6 NEW obligation, but surfaced again per the inline-honesty pattern):**

> **Export job duration depends on document complexity.** Conversion may take 5-30 seconds per page depending on layout complexity, image count, and the chosen quality tier. A 100-page magazine with full-color images can take 30+ minutes. The cancel button is always available; partial output is cleaned up automatically.

### 8.2 Where these obligations are surfaced

Per the four-location three-location-plus-README pattern (Phase 5 precedent + Wave 18 + Wave 22 reaffirmation):

| Location | Wave 26 (Nathan) owner | What must be present |
|---|---|---|
| **Top-of-guide preamble** | `docs/user-guide.md` Phase-6 preamble | Enumerate all 5 obligations in 5-7 bullets at top of guide. User sees before scrolling. |
| **Dedicated trust-floor section** | New section "Export to Office trust floor — what the app does and doesn't promise" in `docs/user-guide.md` | Full enumeration + "What the trust floor IS / IS NOT" sub-sections. |
| **Inline at every export-touching subsection** | Each per-format export how-to subsection | "Honesty reminder" callout + direct anchor link back to the dedicated trust-floor section. |
| **README front-door** | `README.md` Phase 6 Known Limitations | Headline bullets for the 5 obligations + the duration note. |
| **Modal (UI)** | `ExportModal.PerFormatLimitationsPanel` (Riley Wave 24) | The honesty surface IN the modal, not just the docs. Per-format reminder block above the Run button. See `ui-spec.md` §15.3. |

Documented in conventions.md §17.3 so Wave 24 implementation and Wave 26 docs surface them at the trust-floor — four-location ratchet (preamble + dedicated + inline + UI modal), not buried in an appendix.

### 8.3 What the trust floor IS NOT

For honesty parity with prior phases:

- We do NOT promise faithful conversion of decorative typography (drop caps, custom kerning, ligatures).
- We do NOT promise faithful conversion of vector graphics (charts, diagrams, math equations rendered as paths). Vector graphics are extracted as embedded images via the page rasterization fallback for `layout-preserving` tier; `text-only` drops them entirely.
- We do NOT promise faithful conversion of hyperlinks in v1 (Phase 6.1).
- We do NOT promise lossless round-trip (PDF → docx → PDF would not be byte-identical or visually identical).
- We do NOT translate. Output is in the source language(s).
- We do NOT preserve PDF metadata (author, subject, keywords) — the exported Office file uses generic defaults. Phase 6.1 candidate.

What we DO promise:
- The export reads from the source PDF without mutating it.
- The output file is written atomically (write-temp → rename) so partial output is cleaned up on cancel.
- All four output formats are valid per their respective specs (docx = OOXML; xlsx = OOXML; pptx = OOXML; png/jpeg/tiff = standard image formats).
- Per-format defaults follow Q-D (layout-preserving for Word + PowerPoint; text-only for Excel; PNG default for image).
- Cancel during export deletes the partial output.

---

## 9. Risk register (extends `phase-6-plan.md §risk-register`)

Each of the 4 risks from the phase plan, addressed in the design:

| # | Risk | Severity | Mitigation in this design |
|---|---|---|---|
| 1 | **Layout extraction quality varies wildly** | HIGH | §4.3 algorithm honestly scoped; trust-floor obligation #1 (§8) makes "best-effort" user-facing; per-format limitations panel in the modal (§4.7); fast `text-only` tier as fallback for users with simple text-heavy docs. |
| 2 | **`sharp` native dep** | MEDIUM | **CLOSED BY REJECTION** — we use the existing `@napi-rs/canvas` from Phase 5 instead. No new native dep. Diego's electron-rebuild matrix unchanged. (Original risk was speculative; Phase 6 Riley closes it via the library choice.) |
| 3 | **Table detection on borderless tables** | MEDIUM | §4.3.2 honestly scoped; trust-floor obligation #2 (§8) makes this user-facing; line-grid detector fails-soft (returns ZERO TableRegion on diagonal-only / borderless inputs, NOT a wrong table). |
| 4 | **Output file size for image-heavy exports** | LOW | Document expected size growth in the user-guide (Nathan Wave 26). Per-format settings allow DPI / JPEG-quality / multi-page-TIFF tuning. Layout-preserving tier embeds images at original resolution; text-only tier omits them entirely. |

### 9.1 Additional risks Riley uncovered during Wave 23 design

These are NOT in the original 4-risk register; flagged here for Wave 24 awareness:

- **R-W23-A — pdf.js text-fragment ordering on multi-column PDFs.** pdf.js `getTextContent()` returns fragments in PDF content-stream order, which is sometimes NOT reading order on multi-column layouts (the content stream may interleave column-A line-1 / column-B line-1 / column-A line-2 / ...). Mitigation: §4.3.1 step 4 detects columns by X-clustering and re-orders fragments per column. Validate via golden-bytes corpus including a known multi-column fixture. Documented in `export-engine.md §3.4.4`.

- **R-W23-B — `getOperatorList` async API + memory.** pdf.js's operator list per page can be large (~50K ops for a complex page). Holding all pages' op-lists in memory is wasteful. Mitigation: §4.1 streams pages — extract one page's text + operators + images, dispatch to writer, release intermediate, move to next page. Bounded transient memory: ONE page's intermediates at a time. Documented in `export-engine.md §3.3`.

- **R-W23-C — exceljs streaming writer for very large workbooks.** exceljs offers a streaming write API (`xlsx.writeBuffer({ useSharedStrings: true, useStyles: true })`) which is more memory-efficient for workbooks > 10K rows. Mitigation: docx-writer (no streaming) is used for typical Office documents (< 1000 paragraphs); xlsx-writer SHOULD use the streaming API by default for safety. Documented in `export-engine.md §5.3`.

- **R-W23-D — pptxgenjs sync API + Promise wrap.** pptxgenjs's `pres.write()` is synchronous in v4 (returns Buffer/Blob/file path depending on params). The writer wraps it in `await new Promise(...)` to avoid blocking the main event loop during long jobs. Documented in `export-engine.md §6.3`.

- **R-W23-E — Output-path collisions.** If the user picks an existing file path, the engine MUST prompt before overwrite. The `dialog:pickExportOutputPath` handler uses Electron's `dialog.showSaveDialog` which natively handles the overwrite prompt; the engine itself trusts that the path is OK to write. Belt-and-suspenders: the engine writes to `<output>.export-temp` then renames to `<output>` atomically on success; if a parallel process has touched the path between dialog and rename, the rename fails with `output_path_unwritable`. Documented in `export-engine.md §8.5`.

- **R-W23-F — Concurrent export of the same doc.** If the user enqueues two export jobs for the same `doc_hash` with the same `outputPath`, the second will fail when the first's tempfile exists. The queue prevents this only when concurrency=1 (current default). Wave 24 surface: the modal warns "An export to this path is already queued" if the path is in the queue or running. Documented in `ui-spec.md` §15.3.

### 9.2 Risks that DON'T apply to Phase 6 (explicitly excluded)

- Cloud export fallback (we don't ship one)
- Auto-OCR-before-export (silent mutation of source; out-of-scope per trust-floor obligation #5)
- Office round-trip (docx → PDF re-import; out-of-scope; Phase 7+)
- Real-time export (export-as-you-edit; out-of-scope)

---

## 10. Extension points for Phase 6.1+, Phase 7+

### 10.1 In Phase 6 (Wave 24)

- PDF → Word (.docx) layout-preserving + text-only
- PDF → Excel (.xlsx) table-detection-driven + text-only
- PDF → PowerPoint (.pptx) layout-preserving + text-only
- PDF → image (PNG / JPEG / TIFF; multi-page TIFF supported)
- Background export queue + progress UI + cancel
- Schema v6 (`export_jobs` table; per-format defaults in `settings`)

### 10.2 Phase 6.1 (post-ship)

- Hyperlinks in docx (`ExternalHyperlink` / `InternalHyperlink`)
- Bookmark anchors in docx (`docx.Bookmark`)
- Footnotes / comments / revision tracking in docx
- Merged-cell detection in tables
- Chart auto-detection from tabular data → pptx chart objects
- `sharp` escape hatch for image-export performance
- Office round-trip ingest (Office → PDF; out-of-scope here but flagged for future)
- Job persistence across app restarts
- Mid-page cancellation (plumbing abort through writer libraries)

### 10.3 Phase 6.2+

- Vector-graphics extraction (SVG-in-docx, SVG-in-pptx)
- Math equation extraction (MathML / OOXML math)
- Table merge-inference heuristics
- Locale-aware reading order (RTL languages)
- PDF metadata → Office metadata mapping (Author, Subject, Keywords)

### 10.4 Phase 7+ (Polish & Cross-Platform)

- macOS export-modal accessibility audit (Phase 7 a11y scope)
- Linux NSIS-equivalent packaging includes the export engine (no new deps, so should be clean)
- Auto-update across versions preserves the `export_jobs` history (schema migrations are forward-only; v6 → v7 is additive)

---

## 11. Phase 6 fidelity boundary

Per the H-3 lesson (fifth proven instance after Phase 4 / 5), documented loudly.

### 11.1 Boundaries Phase 6 closes

| Prior limitation | Phase 6 reality | Doc update target |
|---|---|---|
| "Export to Office — Phase 6" (annotation summary export was only CSV/JSON in Phase 4) | Live; full PDF → docx / xlsx / pptx / image export | user-guide.md (Nathan Wave 26) — new Export section |
| "Save modified PDF" was the only output path | Now also Word / Excel / PowerPoint / Image output | user-guide §Saving (additive Phase-6 amendment cross-reference) |

### 11.2 New Phase 6 boundaries

| Boundary | Description | Where to surface |
|---|---|---|
| Layout-preserving is best-effort | Trust-floor obligation #1 | user-guide preamble + Export section + dedicated trust-floor section + modal limitations panel |
| Borderless tables not detected | Trust-floor obligation #2 | user-guide §Export → tables; modal limitations panel for Word + Excel |
| XFA forms do not export | Trust-floor obligation #3 | user-guide §Export → forms; modal limitations panel |
| Signed-PDF source stays valid; exported file has no signature | Trust-floor obligation #4 | user-guide §Export → signed PDFs; modal limitations panel |
| OCR status determines text fidelity | Trust-floor obligation #5 | user-guide §Export → OCR'd vs image-only sources; modal limitations panel |
| Hyperlinks not preserved in v1 | Phase 6.1 deferral | user-guide §Export → known limitations |
| Bookmark anchors not preserved in v1 | Phase 6.1 deferral | user-guide §Export → known limitations |
| Per-page conversion may take 5-30s | Cross-cutting reminder | modal Step 2 estimated-time line |
| Excel default tier is text-only (not layout-preserving) | Q-D departure from per-format defaults | modal Step 2 callout when Excel is selected |
| Tamper-vulnerable export audit | `export_jobs` lives in the same SQLite DB as `signature_audit_log` / `ocr_jobs`; no tamper-evidence | user-guide §Export → "About the export audit log" |

### 11.3 Round-trip fidelity matrix delta

Extends Phase 5 §11.3 round-trip matrix:

| PDF feature in source | Phase 5 behavior | Phase 6 export behavior |
|---|---|---|
| Native text content | Search works; selectable text returns words | Exports as paragraphs (layout-preserving) or one-paragraph-per-fragment (text-only) |
| OCR'd text (Phase-5 text-behind-image) | Search works on EITHER layer (the original + our added invisible layer) | Exports as native text (the OCR'd render-mode-3 text is visible to `getTextContent`) |
| Image-only page (no OCR) | Search returns nothing; selectable text is empty | Word/PowerPoint output is rasterized page image with NO selectable text; Excel output is empty for that page |
| AcroForm field (flattened, Phase 3) | Value is in page text content | Exports as inline text |
| AcroForm field (unflattened) | Value is in form-field dictionary | Exports as inline text via pdf.js `getFieldObjects()` fallback |
| XFA form (Phase 3 read-only) | Static template visible; values not accessible | XFA values DO NOT export; static template text DOES export |
| Highlight / strikethrough annotation | Visible in viewer | Image format: visible in raster; Word/PowerPoint: dropped in v1 (Phase 6.1 candidate) |
| Sticky note / text-box annotation | Visible in viewer | Word/PowerPoint: appended inline as `[Note: <text>]`; Image format: visible in raster |
| PAdES-signed PDF | Signature valid until content-mutating save | Export READS without mutating; source signature stays valid; exported file has no signature semantics |
| Document-level JS | Phase 4 §4.8 strips on every save; Phase 5 inherits | Export does NOT save; JS is read-only-passed-by. The exported docx/xlsx/etc. cannot host PDF-level JS — no transfer surface. |

---

## 12. What's NOT in Phase 6

Hard scope-fence per `phase-6-plan.md`. Listed here to absorb any Phase-6 brief drift:

- Office-document INGEST (Office → PDF) — Phase 7+; this phase is OUTBOUND only
- Real-time export-as-you-edit — out of scope
- Cloud export / send-to-cloud — out of scope; local-first policy
- Email-the-export — out of scope (open-the-file-in-the-OS is the v1 affordance)
- Sign-the-exported-Office-file — out of scope; user must sign in Office app
- Auto-OCR-before-export — out of scope per trust-floor obligation #5 (silent source mutation)
- Hyperlink preservation in docx — Phase 6.1
- Bookmark anchors in docx — Phase 6.1
- Footnotes / comments / revision tracking in docx — Phase 6.1
- Merged-cell detection in tables — Phase 6.1
- Charts auto-generated from tables in pptx — Phase 6.1
- Vector-graphics extraction as SVG — Phase 6.2
- Math equation extraction — Phase 6.2
- RTL / locale-aware reading order — Phase 6.2
- PDF metadata → Office metadata mapping — Phase 6.2
- Office round-trip ingest — Phase 7+
- macOS / Linux verification — Phase 7 (configs only; verification on hosts deferred)

If a Phase-6 wave brief or implementation pulls toward any of these, the agent stops and surfaces to Marcus.

---

## 13. L-001 cross-check

**L-001 status: unchanged.** Phase 6 introduces:

- Export modal — pure renderer overlay; no new BrowserWindow.
- Exports sidebar tab — added to the existing sidebar; same window.
- Status-bar progress indicator — same window.
- No drag-drop changes — export operates on the currently-open doc; no new file-drop surface.
- `dialog:pickExportOutputPath` — main-process save-as dialog; structurally identical to Phase 1's `dialog:pickSavePath`; does not touch `enableDragDropFiles`.

Wave 24 implementers (David / Ravi / Riley) MUST NOT touch `src/main/window-manager.ts`. If Wave 24 surfaces a need for a new lock, that's a Marcus call after Julian's Wave 25 audit.

---

## 14. Phase 1 + 2 + 3 + 4 + 5 freeze rule extends to Phase 6

Per the analogous Phase 5 freeze rule (`architecture-phase-5.md §14`):

**P6-L-FREEZE (implicit, recorded here):** `ARCHITECTURE.md`, `docs/architecture-phase-2.md`, `docs/architecture-phase-3.md`, `docs/architecture-phase-4.md`, `docs/architecture-phase-5.md`, `docs/edit-replay-engine.md`, `docs/form-engine.md`, `docs/signature-engine.md`, `docs/ocr-engine.md` are FROZEN by Phase 6. Phase 6 design lives in THIS doc and `docs/export-engine.md` exclusively. The api-contracts / data-models / ui-spec / conventions docs are AMENDED with Phase 6 sections (not edited in their Phase 1-5 sections).

If Wave 24 implementation needs a Phase-1-through-5 contract change, the agent stops and surfaces to Marcus — same protocol as the Phase 2 / 3 / 4 / 5 freezes.

---

## 15. Cross-reference checklist (Wave 23 self-verification)

- [x] All 10 locked decisions encoded (§1)
- [x] No new processes; no new BrowserWindow; L-001 untouched (§2.1, §13)
- [x] 8 new IPC channels listed + cross-ref to api-contracts (§2.5)
- [x] Library inventory delta with license verification (§3.1) — docx MIT 9.7.1; pptxgenjs MIT 4.0.1; exceljs already in deps from Phase 3; utif already in deps from Phase 5
- [x] No new build-time asset copy required (§3.3)
- [x] Single-funnel export engine pattern (§4.1)
- [x] Quality-tier selector (§4.2) — layout-preserving default for Word/PPT; text-only default for Excel (Q-D)
- [x] Layout extraction algorithm — bounding-box clustering + line-grid table detection + image extraction (§4.3)
- [x] Per-format writer scope — Q-A through Q-F answered (§4.4)
- [x] Anti-stub-shipped-with-TODO encoded structurally at writer interface (§4.4.5)
- [x] Background queue + progress UI (§4.5; mirrors Phase 5 OCR pattern but INVERTED from modal-blocking for batch use-case)
- [x] Annotation export interaction (§4.7) — default INCLUDE; per-format treatment differs
- [x] Phase 1-5 interaction — signed PDF READ-only; OCR'd text exports as native; XFA does not export (§4.8, §6)
- [x] NO new EditOperation; NO replay step (§4.9, §4.10)
- [x] Schema v6 — ONE new table (`export_jobs`); per-format defaults fold into `settings` (§5)
- [x] No new native deps; sharp risk closed by rejection (§7)
- [x] Trust-floor honesty obligations — fifth proven instance with FIVE Phase-6 obligations + 1 cross-cutting reminder (§8)
- [x] Risk register addressed + Riley's additional risks R-W23-A through R-W23-F (§9)
- [x] Phase 6.1+ deferral list (§10.2)
- [x] Phase 6 fidelity boundary matrix (§11)
- [x] Phase 6 scope fence (§12)
- [x] L-001 unchanged (§13)
- [x] Phase 6 freeze rule recorded (§14)

End of Phase-6 architecture amendment.
