# Developer guide — PDF_Viewer_Editor

This guide gets a new contributor from `git clone` to a successful local dev loop, test pass, and Windows packaging in under 30 minutes. For end-user docs see [`user-guide.md`](user-guide.md). For the Phase 1 system design see [`../ARCHITECTURE.md`](../ARCHITECTURE.md); for Phase 2 see [`architecture-phase-2.md`](architecture-phase-2.md) and [`edit-replay-engine.md`](edit-replay-engine.md); for Phase 3 see [`architecture-phase-3.md`](architecture-phase-3.md) and [`form-engine.md`](form-engine.md); for Phase 4 see [`architecture-phase-4.md`](architecture-phase-4.md) and [`signature-engine.md`](signature-engine.md); for Phase 5 see [`architecture-phase-5.md`](architecture-phase-5.md) and [`ocr-engine.md`](ocr-engine.md); for Phase 6 see [`architecture-phase-6.md`](architecture-phase-6.md) and [`export-engine.md`](export-engine.md); **for Phase 7 (the final roadmap phase) see [`architecture-phase-7.md`](architecture-phase-7.md), [`a11y-audit.md`](a11y-audit.md), and [`i18n-strategy.md`](i18n-strategy.md)**.

**Phase 7 quick reference for contributors touching auto-update / telemetry / i18n / a11y / cross-platform code:**

- Phase 7 is the **polish phase** (v0.7.0; v0.7.1 is the backlog-fix point release) — it adds no document-editing capability. It adds the auto-update client, opt-in telemetry, WCAG 2.1 AA accessibility, the i18next localization framework, and macOS + Linux build config. The full design lives in [`architecture-phase-7.md`](architecture-phase-7.md) (8 locked decisions P7-L-1..P7-L-8); the a11y remediation map in [`a11y-audit.md`](a11y-audit.md); the localization design in [`i18n-strategy.md`](i18n-strategy.md). The architecture is FROZEN (P7-L-FREEZE) — extend behavior, not architecture. The 0.7.1 backlog-fix wave resolved the image-export glyph defect, multi-language OCR download, the deep modal i18n (816 keys), the annotation-layer a11y name, the better-sqlite3 Node-20 baseline (L-003), and the unsaved-work install gate (in source). See [Auto-update architecture](#auto-update-architecture-phase-7) for the honest binary-vs-source note on the install gate.
- **Telemetry has no PII slot by construction.** The IPC request zod schema is `.strict()` — it rejects any property beyond `{ name, dayBucket }`, so a leak cannot be introduced by a careless call site. Opt-in defaults OFF and the gate is a silent no-op that returns *before* buffering. The transport is an in-memory ring buffer; there is no `telemetry_events` table, no network transport, no third-party SDK. Read [Telemetry framework](#telemetry-framework-phase-7) before touching `src/main/telemetry.ts`, `src/ipc/handlers/telemetry-*.ts`, or `src/client/telemetry/**`. **This is the project's exemplar privacy pattern — do not relax it.**
- **Auto-update is library-injected, not direct-imported.** `electron-updater` is loaded via a runtime `require` *inside* `loadElectronUpdaterModule`, but that loader + `createAutoUpdateController` are STATICALLY imported into `src/main/index.ts` — the deliberate fix for the Phase-6.1 vite-tree-shake trap (see [Common pitfalls → Runtime `require()`](#runtime-require-of-in-tree-modules--vite-tree-shake--electron-30-esm-rejection)). The publish target is a placeholder; the controller returns the honest `update_not_configured`, never a fake "up to date". Read [Auto-update architecture](#auto-update-architecture-phase-7).
- **i18n keys are typed.** `t('toolbar:open')` is compile-checked against the en-US JSON via `CustomTypeOptions` augmentation; a typo is a compile error, not a raw key on screen. `fallbackLng: 'en-US'` + `returnEmptyString: false` guarantee a missing es-ES key renders English. **No `as any` on `t()`.** Read [i18n framework](#i18n-framework-phase-7).
- **a11y patterns are three shared hooks.** `useTablistKeys` (WAI-ARIA tab roving + arrow nav), `useFocusTrap` (modal focus trap + restore), `useRovingToolbar` (single-Tab-stop toolbar). The `jsx-a11y/aria-proptypes` ESLint rule was restored from `warn` to `error` in Wave 29 — the ratchet that prevents the Phase-1 tab-semantics regression. Read [a11y patterns](#a11y-patterns-phase-7).
- **The structural-PII-guard is the project's SIXTH hard-won ratchet.** See [Structural engineering discipline — the six ratchets](#structural-engineering-discipline--the-six-ratchets). The trust-floor honesty pattern held across all six phases (H-3 → forms → PAdES → OCR → export → Phase-7 polish).

**Phase 6 quick reference for contributors touching export / writers / layout-extract / image-extract code:**

- Export engine discipline lives in [`conventions.md §17`](conventions.md) — three read-only-on-source non-negotiables, two export-bytes-stay-in-main corollaries, anti-stub-shipped-with-TODO required-on-interface (no `?`, no default), no-as-any in writers, quality-tier defaults per locked decision Q-D, mechanical greps Julian's Wave 25 audit verified. Read before touching `src/main/export/**`, `src/main/export/writers/**`, or `src/ipc/handlers/export-*.ts`.
- `src/main/export/export-bootstrap.ts` is the **single funnel** for the export engine's dependencies. Library injection (via DI factory `createDocxLibrary` / `createXlsxLibrary` / `createPptxLibrary` / `createImageLibrary`) keeps `docx`, `pptxgenjs`, `exceljs`, `@napi-rs/canvas`, and `utif` reachable from one bootstrap module only. ESLint `no-restricted-imports` keeps these libraries unreachable from anywhere outside `src/main/export/**`. See [`export-engine.md §2`](export-engine.md).
- `createProdSourceLoader` in `export-bootstrap.ts` is **wired to pdf.js as of 0.7.1** (`getDocument().getPage(i).getTextContent() / getOperatorList()`), and the image-export standard-font glyph defect is fixed. **All six formats (docx / xlsx / pptx / PNG / JPEG / TIFF) now produce valid output end-to-end.** See the [worked example — the standard-font glyph fix](#worked-example--the-standard-font-glyph-fix-file-url-vs-fsreadfile-the-asarunpack-seam) for the `file://`-vs-`fs.readFile` + asarUnpack seam.
- The `ExportQueue` from [`architecture-phase-6.md §4.6`](architecture-phase-6.md) (concurrency=1 FIFO; `queue_full` at the 50th waiter) is **documented but not implemented** (Julian H-25.1). The engine currently runs IPC calls inline. A later follow-up ships the ~50 LOC queue module. Concurrent exports against the same `outputPath` can race the `.export-temp` file until the queue lands.
- Read-only-on-source: export handlers MUST NOT call any `pdf-lib` write API against the source doc; MUST NOT update `signature_audit_log`; MUST NOT insert `edit_history` rows. ESLint `no-restricted-imports` enforces the boundary. Mechanical greps in `conventions.md §17.8`.
- Bytes-stay-in-main: output buffers (docx / xlsx / pptx / image) live in the main process only. The renderer never receives a `Uint8Array` of export output. The DTO `ExportJobRowDto` strips the absolute path to `outputBasename` + `outputDirHint`; show-in-folder dispatches by `jobId`, not raw path. See [`conventions.md §17.2`](conventions.md).
- Required-on-interface DI: `RegisterExportOptions.layoutExtractor / tableDetector / imageExtractor / writers.{docx,xlsx,pptx,image}` are all REQUIRED (no `?`, no default stub). The type system fails any wave that tries to ship without wiring a writer. Encoded structurally per [`conventions.md §17.4.1`](conventions.md).
- The Phase 6 Export trust-floor obligations (see [`user-guide.md` → Export trust floor](user-guide.md#export-trust-floor--what-the-app-does-and-doesnt-promise)) are mirrored in code by the conventions §17 discipline. The per-format limitations panel (`src/client/components/modals/export-modal/per-format-limitations.ts`) is the UI surface; the user-guide section is the docs surface. Tests pin every obligation; do NOT relax without updating the locked instructions.
- Runtime `require()` of an in-tree path in `src/main/**` is a packaging anti-pattern. See [Common pitfalls → Runtime `require()` of in-tree modules](#runtime-require-of-in-tree-modules--vite-tree-shake--electron-30-esm-rejection) — this is now the second instance (Phase 5 language-pack-catalog.json + Phase 6 export-bootstrap.ts). Prefer top-level static `import` for main-process module loading; use `await import('./path.js')` (dynamic import) at the call site if lazy-loading is required.

**Phase 5 quick reference for contributors touching OCR / language-pack / searchable-PDF code:**

- OCR engine discipline lives in [`conventions.md §16`](conventions.md) — five worker-lifecycle non-negotiables, anti-stub-shipped-with-TODO encoded structurally (required-on-interface + nullable late-init + word-rect), bytes-stay-in-main corollaries, mechanical greps Julian's Wave 21 audit verified. Read before touching `src/main/pdf-ops/ocr-*.ts`, `language-pack-manager.ts`, `searchable-pdf-builder.ts`, or `ocr-text-layer.ts`.
- `ocr-worker-pool.ts` is the **single funnel** for `tesseract.js.createWorker`. Every other module accepts the opaque `OcrWorkerPool` interface. ESLint `no-restricted-imports` keeps `tesseract.js` reachable from one module only. See [`ocr-engine.md §3`](ocr-engine.md).
- The OCR engine is **`tesseract.js` v7+** (Apache-2.0, primary). `node-tesseract-ocr` (MIT, requires system Tesseract binary) is documented in `ocr-engine.md §2.3` as a Phase 5.1 escape hatch but NOT shipped. See [`ocr-engine.md §2`](ocr-engine.md).
- Worker pool `releaseAll()` is wired to BOTH `app.before-quit` AND `process.on('exit')`. Orphan worker threads are a real defect class; the dual-hook is non-negotiable (conventions §16.1 rule 2).
- Text-behind-image authoring uses `page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible))` from pdf-lib, NOT the `renderMode` option on `page.drawText` (see [Common pitfalls → Code-comment contradictions](#code-comment-contradictions-when-the-comment-says-x-but-the-type-system-drops-x)). The `renderMode` key is SILENTLY DROPPED by pdf-lib's drawText options type without a TypeScript error — Julian's Wave 21 H-21.1.
- The Phase 5 OCR trust-floor obligations (see [`user-guide.md` → OCR trust floor](user-guide.md#ocr-trust-floor--what-the-app-does-and-doesnt-promise)) are mirrored in code by the conventions §16 discipline. Tests pin every obligation; do NOT relax without updating the locked instructions.

**Phase 4 quick reference for contributors touching signing or annotation code:**

- Cert + password discipline lives in [`conventions.md §15`](conventions.md) — five non-negotiable rules, six anti-patterns, mechanical greps Julian's Wave 17 audit verified. Read before touching `src/main/pdf-ops/cert-store.ts` or any `signatures-*.ts` IPC handler.
- The cert-store is the **single funnel** for PFX bytes / password buffers / private-key references. Every other module accepts only the opaque `CertHandle`. See [`signature-engine.md §4`](signature-engine.md).
- The PAdES engine is `node-signpdf` (MIT) by default; a `node-forge` + `pkijs` (MIT / BSD-3-Clause) manual engine ships as a fallback behind `signatures.padesEngine`. See [`signature-engine.md §3`](signature-engine.md).
- The Phase 4 trust-floor obligations (see [`user-guide.md` → PAdES trust floor](user-guide.md#pades-trust-floor--what-the-app-does-and-doesnt-promise)) are mirrored in code by the conventions §15 discipline. Tests pin every obligation; do NOT relax without updating the locked instructions.

---

## Prerequisites

| Tool | Required version | Notes |
|---|---|---|
| **Node.js** | **20 LTS** (20.10+), enforced | **Node 20 is the locked baseline (L-003).** A `pretest` guard (`scripts/check-node.mjs`) stops the suite with a recovery message if the host Node can't load `better-sqlite3`; `engines.node` is `">=20.10.0 <21"` so Node 24 emits a loud `EBADENGINE` warning on install. On a Node-24-only host, use the non-destructive escape hatch `node scripts/rebuild-native-for-node.mjs && npm test` (then `--electron` to restore the packaging binary). **Never** trigger a from-source `better-sqlite3` rebuild on Node 24 (node-gyp + Python 3.14 fails, and a prior failed rebuild deleted the working Electron-ABI binding). See [Common pitfalls → Node 24 vs Electron 30 ABI](#node-24-vs-electron-30-abi). The CI matrix locks Node 20. |
| npm | 10+ | Ships with Node 20. |
| Python | 3.13 or earlier | Only needed if `better-sqlite3` falls back to source build. Python 3.14 removed `distutils`, which `node-gyp` still depends on. |
| Visual Studio Build Tools | Latest with "Desktop development with C++" workload | Windows only; needed for native module compilation. |
| Git | any modern | — |

macOS and Linux can run `lint`, `typecheck`, and `vitest` (the same as the Linux CI matrix job). Only Windows can produce the packaged `.exe` or run the Playwright Electron e2e — the release target is Windows.

Phase 2 added one runtime dependency: `utif@^3.1.0` (MIT) for TIFF first-page decoding. Phase 3 added one more runtime dependency: `exceljs@^4.4.0` (MIT) for the mail-merge wizard's XLSX data-source path. Phase 4 added four runtime dependencies: `node-signpdf@^3` (MIT), `node-forge@^1.3` (BSD-3-Clause arm), `pkijs@^3` (MIT), and `asn1js@^3` (BSD-3-Clause). Phase 5 added three runtime dependencies: `tesseract.js@^7` (Apache-2.0), `@tesseract.js-data/eng@^1` (Apache-2.0 trained data; package wrapper is MIT), and `@napi-rs/canvas@^1` (MIT) for Skia-backed page rasterization. **Phase 6 added two runtime dependencies: `docx@^9.7.1` (MIT) for Word document writing and `pptxgenjs@^4.0.1` (MIT) for PowerPoint writing.** Phase 6 reuses Phase-3 `exceljs` for xlsx writing, Phase-5 `@napi-rs/canvas` for image-format rasterization, and Phase-2 `utif` for multi-page TIFF encoding (symmetric use of libraries acquired in earlier phases — Riley Wave 23 design). Phase 4.1.1 added one devDependency: `vite-plugin-static-copy@^4.1.0` (MIT) for the build-time pdfjs font + cmap asset copy; Phase 5 reuses it for the OCR language-pack-catalog copy. **Phase 6 Wave 25 bumped `vitest` and `@vitest/ui` from 1.6.x to 2.1.9** (MIT) to resolve a Node 24 test-discovery regression (see [Common pitfalls → vitest 2.x and Node 24](#vitest-2x-and-node-24--why-the-bump-landed-in-phase-6-wave-25)); CI continues on Node 20 LTS. Diego's Wave 25 license walk confirms 817 packages, zero AGPL/GPL/LGPL/EPL ingress. Full audit in [`LICENSES.md`](../LICENSES.md).

### A note on Node version (L-003)

**The supported runtime is Node 20.** The recommended path is `nvm use 20 && npm ci && npm test` — Node 20 has a published `better-sqlite3` prebuild for BOTH the Node-20 ABI (v115, what plain-Node Vitest needs) AND the Electron 30 ABI (v123, what packaging needs), so the full suite runs green with no intervention.

If you are stuck on a Node-24-only host (no Node 20, no nvm), use the documented non-destructive escape hatch:

```bash
node scripts/rebuild-native-for-node.mjs      # swap in the Node-ABI binding from the npm cache (backs up first)
npm test                                       # pretest guard passes -> vitest runs
node scripts/rebuild-native-for-node.mjs --electron   # restore the Electron-ABI binding before packaging
```

`scripts/check-node.mjs` runs as `pretest` (and `npm run check:node` standalone): on a host that can't load the binding it exits 1 with the exact recovery commands instead of letting Vitest emit ~350 cryptic `ERR_DLOPEN_FAILED` failures. **Do not run a from-source rebuild on Node 24** — `node-gyp` fails (Python 3.14 dropped `distutils`) and a prior failed rebuild deleted the working binding. Full background under [Common pitfalls → Node 24 vs Electron 30 ABI](#node-24-vs-electron-30-abi).

---

## Clone and install

```bash
git clone <repo-url>
cd PDF_Viewer_Editor
npm install
```

`postinstall` runs `electron-builder install-app-deps` automatically, which rebuilds native modules (`better-sqlite3`) against the bundled Electron version. `prepare` runs `husky` to install the git pre-commit + pre-push hooks (see [Git hooks](#git-hooks-pre-commit--pre-push)). First install takes 2–3 minutes.

If `npm install` fails on `better-sqlite3`, you have two options:

1. Reinstall with the workaround: `npm install --ignore-scripts && npm run rebuild`
2. Confirm you are on Node 20 (L-003) and Python ≤ 3.13, then re-run `npm install`

---

## Project layout

```
PDF_Viewer_Editor/
├── ARCHITECTURE.md           Phase 1 system design — read first
├── CLAUDE.md                 project rules and file ownership
├── README.md                 public front door
├── LICENSES.md               OSS dependency licenses
├── docs/
│   ├── api-contracts.md      IPC channel spec (Riley, Wave 1 frozen P1+P2; §13 Phase 3 amend; §14 Phase 4 amend; §15 Phase 4.1 amend; §16 Phase 5 amend; §17 Phase 6 amend)
│   ├── api-reference.md      developer-facing IPC reference card
│   ├── architecture-phase-2.md  Phase 2 system design (Riley, Wave 6, frozen)
│   ├── architecture-phase-3.md  Phase 3 system design (Riley, Wave 11, frozen)
│   ├── architecture-phase-4.md  Phase 4 system design — signatures + annotations + audit log (Riley, Wave 15, frozen)
│   ├── architecture-phase-5.md  Phase 5 system design — OCR engine, language packs, scan-deferral story (Riley, Wave 19, frozen)
│   ├── architecture-phase-6.md  Phase 6 system design — Export to Office, per-page streaming engine, layout extractor, table detector, image extractor, four writers, background queue (Riley, Wave 23, frozen)
│   ├── edit-replay-engine.md  edit-replay engine deep dive (Riley, Wave 6, frozen)
│   ├── form-engine.md        form-engine deep dive (Riley, Wave 11, frozen)
│   ├── signature-engine.md   signature-engine deep dive — cert lifecycle, byte-range, CMS, TSA (Riley, Wave 15, frozen)
│   ├── ocr-engine.md         OCR-engine deep dive — worker lifecycle, language packs, text-behind-image, confidence (Riley, Wave 19, frozen)
│   ├── export-engine.md      Export-engine deep dive — single-funnel pipeline, layout-detect, table-detect, image-extract, four writers, atomic write, trust-floor obligations (Riley, Wave 23, frozen)
│   ├── conventions.md        cross-cutting code conventions (§14 Phase 3 form-state; §15 Phase 4 cert+password discipline; §16 Phase 5 OCR engine discipline; §17 Phase 6 export-job discipline)
│   ├── data-models.md        SQLite schema + TS types (§7.5 W8.5; §8 P3; §9 P4 incl. schema v4 signature_audit_log; §10 P5 incl. schema v5 ocr_jobs/ocr_results/language_packs; §11 P6 incl. schema v6 export_jobs)
│   ├── ui-spec.md            UI behavior reference (§12 P3; §13 P4; §13 P4.1.1 measure-dim refresh; §14 P5 OCR modals + confidence overlay; §15 P6 Export modal + Exports sidebar tab + status-bar widget)
│   ├── developer-guide.md    this file
│   ├── user-guide.md         end-user manual
│   ├── phase-2-release-notes.md  0.2.0 changelog
│   ├── phase-3-release-notes.md  0.3.0 changelog
│   ├── project-roadmap.md    phased plan
│   └── build-report.md       wave-by-wave build history
├── migrations/               SQL migrations (run on app launch)
│   ├── 0001_init.sql                  schema v1 (Phase 1)
│   ├── 0002_phase2_bookmarks.sql      schema v2 — adds parent_id + sort_order
│   ├── 0003_phase3_forms.sql          schema v3 — adds form_templates table (cross-file)
│   ├── 0004_phase4_signatures.sql     schema v4 — adds signature_audit_log table (P4-L-6)
│   ├── 0005_phase5_ocr.sql            schema v5 — adds ocr_jobs + ocr_results + language_packs; additive nullable column invalidated_by_ocr_job_id on signature_audit_log (P5-L-9)
│   └── 0006_phase6_export.sql         schema v6 — adds export_jobs table + 17 INSERT OR IGNORE INTO settings seed rows for per-format defaults (P6-L-10); NO existing-table touches (Phase 6 is read-only on source)
├── src/
│   ├── shared/               cross-process utilities (Result type)
│   ├── ipc/
│   │   ├── contracts.ts      single typed IPC surface (David)
│   │   ├── register.ts       wires every channel to its handler
│   │   └── handlers/         one file per channel (or domain) — Phase 3 adds forms-* handlers
│   ├── main/                 Electron main process
│   │   ├── index.ts          bootstrap (DB init, IPC, window)
│   │   ├── window-manager.ts BrowserWindow construction + L-001 floor
│   │   ├── db-bridge.ts      camelCase wrapper over snake_case repos
│   │   ├── print-window.ts   offscreen BrowserWindow for print + Chromium export (L-001 preserved)
│   │   ├── pdf-ops/          edit-replay engine, image cache, text edit, tiff decode, form engine, signature engine
│   │   │   ├── replay-engine.ts          the Phase 2 lynchpin (replay() pure function; P3 step 3.6 form ops; P4 step 3.7 PAdES invalidation abort)
│   │   │   ├── document-store.ts         per-handle bytes + image cache (P2-L-2)
│   │   │   ├── image-embed.ts            embedImage handler core
│   │   │   ├── text-replace.ts           replace-only text edit
│   │   │   ├── tiff-decoder.ts           utif wrapper for TIFF first-page decoding
│   │   │   ├── form-engine.ts            Phase 3 — detect / fill / flatten / create form fields
│   │   │   ├── field-dict-authoring.ts   Phase 3 — manual PDFDict for /Sig signature placeholders
│   │   │   ├── mail-merge-runner.ts      Phase 3 — sequential per-row runner; streams progress; atomic per-row write
│   │   │   ├── csv-excel-parser.ts       Phase 3 — built-in RFC 4180 CSV tokenizer + exceljs dynamic-import for XLSX
│   │   │   ├── pdf-metadata-loader.ts    Phase 4.1 — pdf-lib metadata loader (permanent replacement for Phase-1 stub)
│   │   │   ├── cert-store.ts             Phase 4 — in-memory cert handle; STRICT no-persist + zero-on-finally discipline (conventions §15)
│   │   │   ├── signature-engine.ts       Phase 4 — orchestrator over visual + PAdES paths
│   │   │   ├── visual-signature.ts       Phase 4 — typed / drawn / image appearance composition
│   │   │   ├── pades-signature.ts        Phase 4 — node-signpdf primary CMS engine
│   │   │   ├── pades-signature-manual.ts Phase 4 — node-forge + pkijs fallback engine (signatures.padesEngine='manual')
│   │   │   ├── signature-appearance.ts   Phase 4 — PDF /AP /N appearance stream authorship
│   │   │   ├── tsa-client.ts             Phase 4 — RFC 3161 over HTTPS (hand-rolled DER encoder)
│   │   │   ├── annotations/              Phase 4 — per-subtype shape annotation authorship
│   │   │   │   ├── shape-annotations.ts          Square / Circle / Polygon / PolyLine / Line / FreeTextCallout
│   │   │   │   └── measure-calibration-store.ts  per-doc /Measure dict authorship + calibration cache
│   │   │   ├── ocr-engine.ts             Phase 5 — single funnel; orchestrates worker pool + preprocess + recognition
│   │   │   ├── ocr-worker-pool.ts        Phase 5 — one tesseract.js worker per language, persisted; LRU eviction; releaseAll on quit
│   │   │   ├── ocr-text-layer.ts         Phase 5 — text-behind-image authoring via pdf-lib pushOperators(setTextRenderingMode(Invisible))
│   │   │   ├── searchable-pdf-builder.ts Phase 5 — coordinate transform (image-pixel → PDF user-space) + multi-page composition
│   │   │   ├── image-preprocess.ts       Phase 5 — pure helpers: deskew / denoise / contrastBoost over Uint8Array raster bytes
│   │   │   ├── language-pack-manager.ts  Phase 5 — bundled-vs-downloaded resolution + SHA-256 integrity + download orchestration
│   │   │   ├── language-pack-catalog.json Phase 5 — shipped catalog of language packs (eng SHA real + non-eng sentinels until 5.1.x)
│   │   │   ├── ocr-confidence.ts         Phase 5 — pure helpers: per-word + per-page + job summary aggregation
│   │   │   ├── ocr-bootstrap.ts          Phase 5 — synchronous catalog loader; fails loudly on missing JSON (Julian H-21.2)
│   │   │   ├── pades-detect.ts           Phase 5 — fast pre-flight: detect prior PAdES signatures via /Sig field /V /Contents probe
│   │   │   └── h3-retirement.test.ts     integration test pinning the Save round-trip
│   │   ├── export/           Phase 6 — Export to Office engine
│   │   │   ├── export-bootstrap.ts       Phase 6 — single funnel for engine + writer DI; createDocxLibrary / createXlsxLibrary / createPptxLibrary / createImageLibrary factories; createProdSourceLoader TYPED-THROWING STUB (Julian M-25.4 — David Wave 25.1 wires pdf.js binding)
│   │   │   ├── engine.ts                 Phase 6 — per-page streaming pipeline (extract text → detect tables → extract images → dispatch writer → release intermediates → atomic .export-temp → rename)
│   │   │   ├── export-shared.ts          Phase 6 — shared types + job-id allocator (M-25.1: synthetic-negative jobId returned when Ravi repo not wired — David Wave 25.1 tightens)
│   │   │   ├── layout-extract.ts         Phase 6 — 8-step layout extraction pipeline (X-clustering for columns, Y-clustering for paragraphs, MODE-of-bucketed-sizes for headings, density threshold rejects outer-border-only rects)
│   │   │   ├── table-detect.ts           Phase 6 — 5-step line-grid table detector (horizontal + vertical line segments → row × column matrix → cell content extraction → fails-soft on diagonal-only / borderless inputs)
│   │   │   ├── image-extract.ts          Phase 6 — OPS.paintImageXObject walk + CTM stack tracking (save / restore / cm / Q / q operators); MIN_AREA_PT2=16 skip threshold; CTM-aware rect computation
│   │   │   └── writers/
│   │   │       ├── docx-writer.ts        Phase 6 — docx library composer (Paragraph / Table / ImageRun); layout-preserving uses extracted layout; text-only uses flat reading-order paragraph stream
│   │   │       ├── xlsx-writer.ts        Phase 6 — exceljs streaming writer (useSharedStrings: true + useStyles: true); sheet-per-page for layout-preserving; one sheet for text-only
│   │   │       ├── pptx-writer.ts        Phase 6 — pptxgenjs writer; one slide per page; 16:9 widescreen with letterboxing; SLIDE_W_IN / SLIDE_H_IN scale factor + PDF-bottom-up → PPTX-top-down Y-flip
│   │   │       └── image-writer.ts       Phase 6 — @napi-rs/canvas page raster + utif multi-page TIFF encode; PNG / JPEG single-page write per format
│   │   └── security/         path sanitizer, CSP
│   ├── preload/              contextBridge that exposes window.pdfApi
│   ├── db/                   better-sqlite3 connection + repos (Ravi)
│   └── client/               renderer (React + Redux Toolkit; Riley)
│       ├── state/
│       │   ├── middleware/
│       │   │   └── history-middleware.ts  undo/redo with two-state model
│       │   └── slices/
│       │       ├── document-slice-apply.ts  applyOperationToDocument (PageModel mutator)
│       │       └── document-inverses.ts     inverseOf(op) for undo
│       └── types/
│           └── ipc-contract.ts            gatekeeper re-export (ESLint-enforced)
├── tests/                    Playwright e2e + fixtures
├── electron-builder.yml      packaging config (Diego)
├── electron.vite.config.ts   electron-vite multi-process build (Diego)
└── package.json              scripts + deps
```

Wave ownership is documented in [`../CLAUDE.md`](../CLAUDE.md). When you change a file, default to staying inside its owner's domain unless you have a good reason to cross the boundary.

---

## Architecture overview

PDF_Viewer_Editor is a standard Electron app with three processes:

```
+-------------------+   IPC (typed contracts)   +-------------------+
|  Main process     |<------------------------->|  Renderer         |
|  - Node + Electron|                           |  - React 18 + RTK |
|  - SQLite         |                           |  - pdf.js render  |
|  - pdf-lib + utif |                           |  - pdf-lib (P1)   |
|  - Edit-replay    |                           |  - History mw     |
|  - Image cache    |                           |                   |
|  - File I/O       |                           |                   |
+-------------------+                           +-------------------+
         |                                              ^
         | contextBridge.exposeInMainWorld('pdfApi')    |
         v                                              |
+-------------------+                                   |
|  Preload          |-----------------------------------+
|  - typed PdfApi   |
+-------------------+
```

**Key patterns (Phase 1 + Phase 2):**

- **Single typed IPC surface.** All channels are declared in [`src/ipc/contracts.ts`](../src/ipc/contracts.ts) with `Result<T, ChannelError>` discriminated unions. Main, preload, and renderer all import from this one file; the renderer routes through the gatekeeper re-export at [`src/client/types/ipc-contract.ts`](../src/client/types/ipc-contract.ts). See [`api-reference.md`](api-reference.md) for the channel-by-channel reference.
- **Path-opacity.** The renderer never sees absolute paths. Main issues opaque `destinationToken` strings for save flows. See ARCHITECTURE.md §2 and api-contracts.md §3.2 for the rationale.
- **DbBridge single translation surface.** Ravi's repos return snake_case rows. David's IPC contract uses camelCase. [`src/main/db-bridge.ts`](../src/main/db-bridge.ts) is the only place those translate.
- **Command-pattern undo.** Redux Toolkit slices funnel every page/annotation/image/text mutation through `applyEdit()` in [`src/client/state/slices/document-slice.ts`](../src/client/state/slices/document-slice.ts). The history middleware computes the inverse from the pre-state and pushes it on a history stack. Phase 2 activated this fully across all op kinds.
- **Security floor (L-001).** `enableDragDropFiles` must not be set to `false` in `BrowserWindow` `webPreferences` — Electron's `true` default is load-bearing for the drag-drop open flow. Enforced by [`src/main/window-manager.test.ts`](../src/main/window-manager.test.ts) and reaffirmed in every Phase 2 BrowserWindow construction (Chromium export, print dispatch). This is the locked instruction enforced as a test.

For Phase 1 architecture, read [`../ARCHITECTURE.md`](../ARCHITECTURE.md). For Phase 2, read [`architecture-phase-2.md`](architecture-phase-2.md) and [`edit-replay-engine.md`](edit-replay-engine.md).

### The edit-replay engine (Phase 2)

The Phase 2 lynchpin is a pure function `replay(input: ReplayInput): Promise<ReplayResult>` in [`src/main/pdf-ops/replay-engine.ts`](../src/main/pdf-ops/replay-engine.ts). It applies a list of `EditOperation` values in order against an in-progress `pdf-lib` `PDFDocument`, then emits annotations into the result. The pipeline is "fold then emit" — page-structure ops fold into the document, annotations emit last so their object references resolve against the final page tree. See [`edit-replay-engine.md`](edit-replay-engine.md) for the full design (§3 algorithm, §4 op-by-op semantics, §10 atomic save, §12 fidelity matrix).

The save flow:

```
+----------------+    fs:applyEditOps    +-----------------+    replay()     +---------------+
| Renderer       | -- ops + annotations -> Main handler    | -- pure fn -->  | new PDF bytes |
| (history mw)   |                       | (atomic save)   |                 +---------------+
+----------------+                       +-----------------+                       |
                                              ^                                    |
                                              | original bytes                     v
                                              |                          +--------------------+
                                              +------------------------- | temp file → rename |
                                                                         | (destination path) |
                                                                         +--------------------+
```

**Why this works:** main keeps the original bytes per handle (lynchpin decision P2-L-2). The renderer ships only the op log and annotation list (no bytes). On save, the engine parses `originalBytes` into a fresh `PDFDocument` (lazily — only when an op needs them), applies every op via pdf-lib's structural API, emits annotations, and writes via atomic temp-rename. Partial failures roll the whole save back; the destination file is never partially written.

**The image cache.** Image ops carry their bytes through IPC once. The engine SHA-256-hashes them, stores `(contentHash → bytes)` in main's per-handle image cache, and reuses cached bytes for re-emits. Renderer history compaction (see below) plays into this — see [Common pitfalls](#common-pitfalls) item 5.

### The history middleware (Phase 2)

[`src/client/state/middleware/history-middleware.ts`](../src/client/state/middleware/history-middleware.ts) implements undo/redo for every `EditOperation` variant — rotate, delete, insert, image-insert, image-overlay (+ edit + delete), text-replace, reorder, annotation ops, bookmark ops. The middleware:

1. Catches each `applyEdit(op)` action with `meta.undoable === true`.
2. Calls `inverseOf(op, preState)` to compute the inverse.
3. Stores **both** the compacted op (zero-bytes image ops to keep the history footprint bounded) AND the raw op (bytes intact) on the history entry — Wave 8.6 N-1 fix. On undo, the middleware dispatches the raw op; the compacted form is the storage-friendly view for footprint accounting.

The re-entrancy flag (`meta.__history: true`) prevents the middleware from pushing inverses of its own dispatched inverses into a loop.

### The renderer-gatekeeper boundary

Renderer code must NEVER import from `src/ipc/contracts.ts` directly. All contract types route through [`src/client/types/ipc-contract.ts`](../src/client/types/ipc-contract.ts), a pure re-export module. The boundary is **ESLint-enforced** (Wave 8.5 H-2): `.eslintrc.cjs` `no-restricted-imports` flags any `src/client/**` file that imports `'../../ipc/contracts'` (with any variant of relative dots or aliases) with the message "Renderer must route through src/client/types/ipc-contract.ts".

Why: the renderer's import surface is the audit point for what shapes it touches. A single gatekeeper file is one place to read instead of N files. Drift across the renderer was a Phase 1 problem that Wave 8.5 closed mechanically.

### Forms architecture (Phase 3)

Phase 3 layers AcroForm support on top of the Phase 2 edit-replay engine without touching the engine's contract surface. Two architectural pillars worth understanding:

**Form-state vs document-state (conventions §14).** Phase 3 introduces a third state-management pattern alongside the Phase 1 dirtyOps funnel and the Phase 2 bookmarks-via-SQLite track. Form-fill values live in `formsSlice.values` as **transient renderer state**; only the explicit commit boundary produces an EditOperation. Form-design ops (add / remove / edit field) use the standard per-op pattern.

| Pattern | Storage | Saves through | Undo |
|---|---|---|---|
| Document mutations (rotate, delete, annotate, text-replace, image overlay) | `dirtyOps[]` | `replay()` step 3 | Per-op inverse |
| Bookmarks | SQLite | Direct IPC, engine NOT invoked | Per-op inverse on bookmarks slice |
| **Form-fill values** | `formsSlice.values` (transient) → batched into one `form-commit` op at commit boundary | `replay()` step 3.6 | Whole-form-batch undo |
| **Form-design** (add/remove/edit field) | `dirtyOps[]` (per-op) | `replay()` step 3.6 | Per-op inverse |

**The HYBRID commit boundary.** Form fills accumulate as transient values in `formsSlice.values`. Saves auto-commit before writing; users can also commit explicitly via a "Commit form values" button in the Forms sidebar. The single `form-commit` EditOperation carries `fieldValues` (the changed values) + `previousValues` (for undo). This is why Ctrl+Z unwinds the whole form-fill batch, not each keystroke — matching Word/Acrobat semantics. Rationale: see `architecture-phase-3.md §5` and `conventions.md §14.2`.

**The form engine.** [`src/main/pdf-ops/form-engine.ts`](../src/main/pdf-ops/form-engine.ts) exports pure functions `detectForms`, `fillForm`, `flattenForms`, `createField`, `removeField`, `editField`. They follow the same purity contract as `replay()`'s `applyOp`: no FS I/O, no DB I/O, no mutation of input bytes. The replay engine's new step 3.6 calls these helpers within the engine's load+save shell:

```
3.6 applyFormOps:
    if (anyFormCommitInOps OR anyFormDesignInOps OR anyFormFlattenInOps):
      const form = doc.getForm()                                    // may be empty
      for op of formDesignAddOps:    formEngine.createField(form, op.fieldDefinition)
      for op of formDesignEditOps:   formEngine.editField(form, op.fieldName, op.after)
      for op of formDesignRemoveOps: formEngine.removeField(form, op.fieldName)
      const mergedValues = mergeCommits(formCommitOps)              // last-write-wins per field name
      formEngine.fillForm(form, mergedValues, { flatten: anyFlattenInOps })
      form.updateFieldAppearances(font)                              // unless flatten phase will run next
```

Order matters: design-add → design-edit → design-remove → fill. This way the user can author a field, edit it, then fill it within the same commit.

**No JavaScript form actions (P3-L-2).** Saved documents never contain JavaScript. The engine strips two surfaces:
- Field-level `/AA` (additional actions) dicts — stripped in `emitField`.
- Document-level `/Names /JavaScript` — stripped in `stripDocLevelJavaScript`.

A warning is appended to the engine's `ctx.warnings` when JS is found, surfaced as a renderer toast. The Phase 3 lock is enforced by tests, not by a CI-blocking floor like L-001; future contributors who relax it must update tests + locked-instructions.

### Mail-merge runner (Phase 3)

[`src/main/pdf-ops/mail-merge-runner.ts`](../src/main/pdf-ops/mail-merge-runner.ts) is a plain async function in the main process. It does NOT spawn a worker or a new BrowserWindow (L-001 untouched). Architectural properties:

- **Template parsed once.** The template `PDFDocument` bytes are loaded once; per-row work clones the bytes and re-parses into a fresh `PDFDocument` so per-row fills don't bleed.
- **Sequential per-row.** Each row goes through fill → optional flatten → atomic temp+rename write. Yields to the event loop between rows so the renderer stays responsive.
- **Progress streaming.** The runner emits `mail-merge:progress` events via `webContents.send`. The renderer subscribes through `window.pdfApi.events.onMailMergeProgress(handler)`. The progress modal updates from these events.
- **Atomic per-row write.** Each output file is written to `<path>.tmp` then renamed to `<path>`. Power-loss or process-kill mid-write never corrupts a target file. Wave 13.5 H-3.3 closed this gap with a wrapper at [`src/ipc/register.ts:513-527`](../src/ipc/register.ts): the production injection of `writeFile` wraps the standard `fs/promises.writeFile` in `write(tempPath, bytes) → rename(tempPath, finalPath)`, with a `try/catch` that calls `fs.unlink(tempPath)` on rename failure (swallowing the unlink error to surface the underlying write/rename error to the runner's `fs_write_failed` path honestly). The runner itself stays pure — it calls `deps.writeFile(path, bytes)` and trusts the dep to be atomic; the temp+rename detail lives at the dependency-injection boundary where the real filesystem lives. The runner's JSDoc at [`mail-merge-runner.ts:56`](../src/main/pdf-ops/mail-merge-runner.ts) declares the atomic contract; the Wave 13.5 audit habit (see [Permissive test stubs](#permissive-test-stubs-mask-production-failures)) is to trace the JSDoc claim back to the call site.
- **Cancellation.** Renderer fires `forms:runMailMerge:cancel` with the job ID; the runner checks a `cancelRequested` flag between rows and returns the partial result.
- **Concat mode.** Each filled row's bytes are kept in an array; final concatenation via pdf-lib's `copyPages`. Peak memory ≈ N × per-row-bytes.
- **CSV parser.** Built-in RFC 4180 tokenizer in `csv-excel-parser.ts` — 60 lines, no dependency, handles BOM + quoted fields with embedded commas + CRLF/LF + three delimiters + ragged rows + duplicate header rename.
- **XLSX parser.** Dynamic-imports `exceljs` (`const specifier = 'exceljs'; const mod = await import(specifier)`) so absent installs fail with a clean error.

Path sanitization is critical and load-bearing: the runner uses two production sanitizers injected via `MailMergeRunDeps` (`sanitizePath` for file outputs, `sanitizeDirectoryPath` for folder outputs). Folder-mode sanitization specifically allows `['', '.pdf']` extensions (empty for the folder itself). Wave 13.5 B-3.1 BLOCKER fix landed this; production tests inject the REAL sanitizers, not permissive stubs.

### Signatures architecture (Phase 4)

Phase 4 lights up visual + PAdES cryptographic signatures on top of the Phase 3 form-engine. Three architectural pillars worth understanding:

**The cert-store single funnel (conventions §15).** Every byte of a PFX file + every character of its password lives in exactly one place: the in-memory `Map<CertHandle, ParsedCertEntry>` at [`src/main/pdf-ops/cert-store.ts`](../src/main/pdf-ops/cert-store.ts). All other modules (`signature-engine.ts`, `pades-signature.ts`, every `signatures-*.ts` IPC handler) accept only the opaque `CertHandle` string. The cert-store is the SOLE module that:

- Imports `node-forge` (for PFX parsing).
- Touches raw `pfxBytes: Buffer` or `passwordBuffer: Buffer`.
- Calls `Buffer.fill(0)` on either buffer.

The cert-store's `releaseHandle(handle)` function is the **canonical zeroer** for the happy path (the Wave 17 B-17.1 closure changed this — until Phase 4.1, the cert-store zeroed in `loadCert`'s finally, breaking the PAdES sign path which needed the buffers later). After B-17.1, the lifecycle is:

```
loadCert:    pfxBytes + passwordBuffer ownership transferred to entry
                                                       ↓
                          [retained for the sign operation]
                                                       ↓
releaseHandle:                                  ENTRY ZEROED + DROPPED
  (called by orchestrator's try/finally;
   OR autoRelease=true; OR modal cleanup; OR app.before-quit)
```

Every failure path inside `loadCert` ALSO zeroes — the `!ownershipTransferred` guard at [`cert-store.ts:262`](../src/main/pdf-ops/cert-store.ts) is the load-bearing branch. Julian's Wave 17 mechanical greps verify the discipline:

```
rg "log\.(info|debug|warn|error)" src/main/pdf-ops/cert-store.ts src/ipc/handlers/signatures-*.ts | rg -i "password|pfx|privateKey"  → 0 hits
rg "writeFile|writeFileSync|createWriteStream" src/main/pdf-ops/cert-store.ts src/main/pdf-ops/pades-*.ts src/ipc/handlers/signatures-*.ts  → 0 hits
rg "settings\.|electronStore\." src/main/pdf-ops/cert-store.ts src/ipc/handlers/signatures-*.ts  → 0 hits
rg "passwordBuffer|pfxBytes" | rg "fill\(0\)"  → matches in BOTH cert-store.ts:262 (loadCert failure) AND cert-store.ts:287-296 (releaseHandle — canonical zeroer)
```

**The PAdES engine plug architecture.** Two engines satisfy the same `applySignature(input) → result` external contract: `node-signpdf` (primary, MIT) and `node-forge` + `pkijs` (fallback, MIT / BSD-3-Clause). Choice is controlled by the `signatures.padesEngine: 'signpdf' | 'manual'` Setting + the `PADES_ENGINE` env var. Both engines dynamic-import their respective libs so a missing dep produces a clean `engine_not_available` error rather than a module-load crash. See [`signature-engine.md §3`](signature-engine.md) for the full library decision walkthrough. Locked decision P4-L-3.

**The signature audit log (schema v4, P4-L-6).** Every PAdES (or visual) sign inserts a row into `signature_audit_log` capturing fingerprint + signed-at + doc-hash + sig-bytes-offset + byte-range. The table is local-only, tamper-vulnerable, and **NOT a notarization service** — see [`user-guide.md` → PAdES trust floor](user-guide.md#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #4. The `signatures:verify` channel re-hashes the byte-range against the audit row and confirms bytes match; it does NOT validate cert trust chains or check CRLs/OCSP. Schema:

```sql
CREATE TABLE signature_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash TEXT NOT NULL,                         -- SHA-256 of the saved (signed) bytes
  pre_sign_doc_hash TEXT NOT NULL,                -- SHA-256 of the bytes BEFORE the signature was embedded
  signed_at INTEGER NOT NULL,                     -- ms epoch from the engine
  signature_kind TEXT NOT NULL,                   -- 'visual' | 'pades' | 'pades-tsa'
  signed_by_fingerprint TEXT,                     -- SHA-256 hex of the cert (null for visual)
  signed_by_subject_cn TEXT,
  signed_by_issuer_cn TEXT,
  cert_not_before INTEGER,
  cert_not_after INTEGER,
  tsa_url TEXT,
  tsa_response_status TEXT,                       -- 'ok' | 'failed' | null
  sig_bytes_offset INTEGER,                       -- offset of /Contents in the saved file
  sig_bytes_length INTEGER,
  byte_range TEXT,                                -- JSON array [start1, len1, start2, len2]
  reason TEXT,
  location TEXT,
  field_name TEXT,
  created_at INTEGER NOT NULL
);
```

See [`data-models.md §9.4`](data-models.md) for the full DDL + indexes.

**Replay-engine step 3.7 — PAdES invalidation abort.** A subsequent edit AFTER a PAdES signature was applied in the same session is detected at save time and ABORTS with `pades_invalidated_by_subsequent_edit`. The post-sign edit would change the signed byte-range; producing a structurally-invalid signed PDF would be worse than refusing to save. Wave 17 Julian's H-17.3 flagged the original "warn but continue" posture; Phase 4.1 David closed it to abort. Regression test pins three cases: abort on reorder-after-pades, abort on multi-mutator, no-abort when pades is the LAST op. See [`src/main/pdf-ops/replay-engine-pades-invalidation.test.ts`](../src/main/pdf-ops/replay-engine-pades-invalidation.test.ts).

### OCR architecture (Phase 5)

Phase 5 lights up local OCR via Tesseract.js on top of the Phase 2 edit-replay engine + Phase 4 PAdES interaction. Four architectural pillars worth understanding:

**The OCR worker pool single funnel (conventions §16.1).** Every call to `tesseract.js`'s `createWorker(...)` lives in exactly one module: [`src/main/pdf-ops/ocr-worker-pool.ts`](../src/main/pdf-ops/ocr-worker-pool.ts). All other modules (`ocr-engine.ts`, every `ocr-*.ts` IPC handler, `searchable-pdf-builder.ts`) accept only the opaque `OcrWorkerPool` interface. ESLint `no-restricted-imports` enforces that `tesseract.js` is reachable from `ocr-worker-pool.ts` and nowhere else. Five rules from conventions §16.1, in priority order:

1. One worker per active language, persisted for the app lifetime (no spawn-per-page churn — worker init is 2–5 seconds).
2. `releaseAll()` on `app.before-quit` AND `process.on('exit')` — orphan worker threads are a real defect class on some Electron versions.
3. No `createWorker` outside `ocr-worker-pool.ts`.
4. Watchdog per page (`ocr.workerWatchdogSec`, default 60).
5. LRU eviction at the worker pool cap (`ocr.maxConcurrentLanguages`, default 4) — prevents unbounded RAM growth when the user runs OCR in 5+ different languages in a session.

The pool's `acquire(lang)` is idempotent — it reuses a live worker for `lang` or creates a new one. The lifecycle hooks are wired at [`src/main/index.ts`](../src/main/index.ts) bootstrap; tests assert `pool.status().length === 0` after `pool.releaseAll()` for every test that calls `pool.acquire(...)` (no orphan-worker leak).

**Language pack management (conventions §16.2 + §16.5).** The bundled English pack lands at `process.resourcesPath/tessdata/eng.traineddata.gz` (read-only, via Diego's `electron-builder.yml extraResources`). Downloaded packs live at `app.getPath('userData')/tessdata/<lang>.traineddata.gz` (writable). The resolver in [`src/main/pdf-ops/language-pack-manager.ts`](../src/main/pdf-ops/language-pack-manager.ts) checks bundled-first, downloaded-second, returns `null` if neither. Multi-language recognition (`eng+spa` syntax) is supported by copying packs into a tempdir when components live in different directories.

Every download is SHA-256-verified against the catalog file at [`src/main/pdf-ops/language-pack-catalog.json`](../src/main/pdf-ops/language-pack-catalog.json) BEFORE the pack is inserted into the `language_packs` table. Defense-in-depth against a poisoned mirror — if the hash mismatches, the file is unlinked and `pack_integrity_failed` is surfaced. HTTPS is enforced; `tessdata.projectnaptha.com` is the canonical mirror (the same one Tesseract.js itself uses); lang codes pass `/^[a-z]{3}(_[a-z]+)?$/i` validation to prevent path traversal.

**Text-behind-image layer authoring (conventions §16.6 + see Common pitfalls below).** The searchable-PDF output uses **PDF rendering mode 3 (invisible)** text blocks at recognized word coordinates, NOT ActualText + MarkedContent. The page's existing visual content (the scanned image as a `/XObject`) is preserved verbatim; text-block bytes are appended to the page's `/Contents` stream. Authoring lives in [`src/main/pdf-ops/ocr-text-layer.ts`](../src/main/pdf-ops/ocr-text-layer.ts) — see the dedicated **Code-comment contradictions** pitfall below for the H-21.1 fix (the `renderMode` cast trap).

Coordinate transformation: Tesseract returns word boxes in image-pixel coordinates (top-left origin, integer pixels); PDFs use user-space coordinates (bottom-left origin, points). The helper `imageToPdfRect(imgRect, imgDimsPx, pageDimsPts)` in [`src/main/pdf-ops/searchable-pdf-builder.ts`](../src/main/pdf-ops/searchable-pdf-builder.ts) does the conversion. The `pageDimsPts` input MUST come from the canonical pdf-lib metadata path (Phase 4.1 `loadPdfMetadata`); sentinel 612×792 defaults would silently produce wrong word positions on non-Letter PDFs — exactly the defect class the 2026-05-26 global JSONL entry warns against.

**Replay-engine step 3.9 OCR ABORT.** The Phase 5 `ocr-text-behind-applied` EditOperation is handled at replay step 3.9 — after page-structure ops, forms, and shape annotations, but before the global emit-annots step. The step mirrors the Phase 4.1 H-17.3 PAdES invalidation discipline: the carrying op's `invalidatesSignatures` flag reflects the user's confirm-at-OCR-modal-time acknowledgement. The signature-audit-log backref (`invalidated_by_ocr_job_id`) is written by the IPC handler (not the replay engine) so the audit row exists even if Save fails. Regression test pins the abort: [`src/main/pdf-ops/replay-engine-ocr-pades.test.ts`](../src/main/pdf-ops/replay-engine-ocr-pades.test.ts).

**The OCR results data flow.** Per conventions §16.2 (Bytes-stay-in-main extensions to §10), raster bytes flow renderer → main ONLY when the user imports a standalone image; for OCR on the currently-open PDF, no renderer-side raster bytes are involved. OCR results flow main → renderer as STRUCTURED data — `OcrPageResult.words: OcrWord[]` carries `{ text, confidence, imgRect, pdfRect }` per word, NOT raw recognized-image bytes. The renderer paints the confidence overlay from `OcrWord.pdfRect` alone. The `LanguagePack.filePath` field is stripped at the IPC bridge — the renderer-facing `LanguagePackDto` carries `lang` + `source` + `sizeBytes` + `sha256` only.

The signature audit log schema-v5 amendment: one nullable column `invalidated_by_ocr_job_id INTEGER REFERENCES ocr_jobs(id)` is added to `signature_audit_log` (additive — pre-Phase-5 rows have it NULL = "not invalidated by OCR"). Three new tables ship: `ocr_jobs` (per-run state), `ocr_results` (per-page summary + words JSON), `language_packs` (installed-pack manifest). Full DDL in [`data-models.md §10`](data-models.md) and the migration at [`migrations/0005_phase5_ocr.sql`](../migrations/0005_phase5_ocr.sql).

### Release-engineering responsibility — language-pack catalog SHA-256 (B-21.1)

Before each release that adds new bundled or downloadable languages, the release-build script MUST fetch the real `.traineddata.gz` for every catalog entry from `https://tessdata.projectnaptha.com/4.0.0_fast/<lang>.traineddata.gz`, compute SHA-256, and inject the real SHA values into [`src/main/pdf-ops/language-pack-catalog.json`](../src/main/pdf-ops/language-pack-catalog.json) BEFORE running `npm run dist:win`.

**Current state (RESOLVED in 0.7.1):**
- `eng` row has real SHA `ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468` (10,923,060 bytes; bundled from `node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz`). Note the bundled `eng` is a DIFFERENT artifact from the downloadable packs — it ships via the npm package (10.9 MB) per `electron-builder.yml`, NOT from the `4.0.0_fast` CDN (1.98 MB). Bundled packs resolve by file-existence, not hash.
- The other 9 rows (spa / fra / deu / por / ita / rus / chi_sim / chi_tra / jpn) now carry **real SHA-256 hashes**, computed over the exact `${baseUrl}/<lang>.traineddata.gz` bytes the download path consumes (`baseUrl = https://tessdata.projectnaptha.com/4.0.0_fast`). The `TBD-FILL-AT-RELEASE` sentinels are gone, and the placeholder `sizeBytes` (which were ~10x too large) were corrected to actual gz sizes. **Multi-language download works.**
- The `language-pack-manager.ts` download handler still rejects hash mismatches via `pack_integrity_failed` — the integrity posture is unchanged; only the catalog values became real. `language-pack-catalog.test.ts` pins no-sentinel + 64-hex + positive-size + the bundled `eng` hash + ≥8 distinct downloadable.

**Durable mechanism (still a follow-up).** The catalog was hand-populated + test-pinned in the 0.7.1 backlog-fix wave, so multi-language OCR works now. A release-time `scripts/build-ocr-catalog.mjs` (per `ocr-engine.md §4.7`) that re-fetches + re-hashes at build time remains the durable automation for future tessdata refreshes — it reads the catalog, fetches each non-bundled row over HTTPS, verifies (HTTP 200 + Content-Length + valid gzip), computes SHA-256, and writes the hash back. Adding a new language is then a one-line catalog edit + a single script re-run.

### Phase 5 IPC channels

Nine new IPC channels under two new namespaces — `ocr:*` (seven) and `scan:*` (two Phase 5.1 placeholders). All `ocr:*` channels are LIVE in 0.5.0; `scan:*` returns `not_implemented_phase_5_1`. Full contract types: [`api-contracts.md §16`](api-contracts.md). Quick reference card:

| Channel | What it does |
|---|---|
| `ocr:detectLanguages` | List installed + downloadable packs. Renderer calls this on OCR wizard open. |
| `ocr:runOnPage` | OCR a single page. Short-running; no progress events. Returns `OcrPageResult`. |
| `ocr:runOnDocument` | OCR a page range. Long-running; emits `ocr:progress` event stream. Returns `{ jobId, summary, op }`. |
| `ocr:cancelJob` | Graceful cancellation (between pages, not mid-page). Idempotent. |
| `ocr:listJobs` | List rows from `ocr_jobs` (debugging + audit panel). |
| `ocr:languagePackDownload` | Download a pack from `tessdata.projectnaptha.com`; verify SHA-256; emit progress events. |
| `ocr:languagePackRemove` | Remove a downloaded pack. Refuses to remove bundled `eng`. |
| `scan:listDevices` | Phase 5.1 placeholder; returns `not_implemented_phase_5_1`. |
| `scan:acquire` | Phase 5.1 placeholder; same. |
| `ocr:progress` (event stream) | Per-page progress: `starting / rasterizing / preprocessing / recognizing / composing-text-behind-image / writing-output / completed / cancelled / failed`. |
| `ocr:languagePackDownload:progress` (event stream) | Download progress: `starting / downloading / verifying / completed / cancelled / failed`. |

See [`api-reference.md`](api-reference.md) for request/response shapes + error variants + renderer examples.

### Export engine architecture (Phase 6)

Phase 6 lights up Export to Office and image formats on top of the read-only-on-source discipline (export NEVER mutates the source PDF). Six architectural pillars worth understanding. Full design: [`architecture-phase-6.md`](architecture-phase-6.md) + [`export-engine.md`](export-engine.md).

**The export-engine single funnel + library-injection pattern (conventions §17.4).** All writer-library imports (`docx`, `pptxgenjs`, `exceljs`, `@napi-rs/canvas`, `utif`) live behind DI factories in [`src/main/export/export-bootstrap.ts`](../src/main/export/export-bootstrap.ts) — `createDocxLibrary` / `createXlsxLibrary` / `createPptxLibrary` / `createImageLibrary`. The engine ([`src/main/export/engine.ts`](../src/main/export/engine.ts)) accepts the opaque `RegisterExportOptions` interface; ESLint `no-restricted-imports` keeps the writer libraries reachable from `src/main/export/**` only. **Library-injection-over-direct-imports** is the Phase 6 generalization of the Phase 4 cert-store / Phase 5 worker-pool single-funnel patterns — it makes the engine testable with synthetic writers AND avoids the code-comment-contradiction class (no `as any` casts around library options, because each writer wraps its library in a typed adapter). The writer deps are **required-on-interface** (no `?`, no default stub) so the type system fails any wave that ships without wiring a writer — the anti-stub-shipped-with-TODO discipline encoded structurally.

**Per-page streaming pipeline (R-W23-B mitigation).** The engine streams pages one at a time: extract one page's text + operators + images → dispatch to the writer → release the page's intermediates → move to the next page. Bounded transient memory: ONE page's intermediates at a time, never the whole document's operator-lists (which can be ~50K ops per complex page). The pipeline per page: `extracting-text` → `detecting-tables` → `extracting-images` → (`rasterizing` for image formats) → `writing-output`. Each phase emits an `export:progress` event (throttled to ≤10/sec to avoid renderer rerender storms).

**Layout-detect algorithm (conventions §17 + `export-engine.md §3.4`).** [`src/main/export/layout-extract.ts`](../src/main/export/layout-extract.ts) runs an 8-step pipeline on pdf.js's `getTextContent()` fragments:

1. Collect text fragments with their transforms (X, Y, font size, font name).
2. Empty-page short-circuit — returns `null` (anti-sentinel; NOT an empty `LayoutRect` at 0,0,0,0).
3. Bucket fragments into Y-rows by clustering Y-coordinates within `export.layout.lineEpsilonPt` (default 2pt).
4. **Detect columns by X-clustering** — fragments whose X-gap exceeds `export.layout.columnGapPt` (default 40pt) split into columns; fragments are re-ordered per column (R-W23-A mitigation for pdf.js content-stream interleaving on multi-column layouts).
5. Group rows into paragraphs by line-gap / median-line-height ratio exceeding `export.layout.paragraphBreakRatio` (default 1.5).
6. **Classify headings by font-size delta vs the MODE-of-bucketed-body-sizes** — a fragment whose font size exceeds `headingRatio × mode-body-size` (default 1.3×) is a heading (David's refinement; honestly documented as heuristic, not semantic).
7. Density-threshold rejection — a bounding rect that contains only an outer border (no internal text density) is rejected, NOT treated as a paragraph.
8. Emit `LayoutRect[]` (each `T | null` per the anti-sentinel discipline — empty regions are `null`, never a zeroed rect).

**Table-detect algorithm (`export-engine.md §3.4.2`).** [`src/main/export/table-detect.ts`](../src/main/export/table-detect.ts) runs a 5-step line-grid analysis on the page's operator-list:

1. Extract horizontal AND vertical line segments from the path-construction operators.
2. Filter diagonal lines (a table requires axis-aligned segments).
3. Build a row × column grid from the intersection points.
4. Extract cell content by intersecting the layout paragraphs with grid cells.
5. **Fail-soft** — borderless / diagonal-only / whitespace-aligned tables produce ZERO `TableRegion` (NOT a fabricated wrong table). This is trust-floor obligation #2 enforced at the algorithm level.

**Image extraction with CTM tracking (`export-engine.md §3.4.3`).** [`src/main/export/image-extract.ts`](../src/main/export/image-extract.ts) walks the operator list (`OPS.paintImageXObject`, `OPS.paintInlineImageXObject`) while maintaining a CTM (current transformation matrix) stack — pushing on `OPS.save` (`q`) and popping on `OPS.restore` (`Q`), composing on `OPS.transform` (`cm`). The image's on-page rect is computed from the active CTM at the paint operator. A `MIN_AREA_PT2 = 16` skip threshold drops sub-pixel decorative images. The test at `image-extract.test.ts` verifies the CTM reset honestly with a non-identity post-restore transform (Julian Wave 25 remediation).

**Per-format writers ([`src/main/export/writers/`](../src/main/export/writers/)).**

| Writer | Library | Layout-preserving behavior | Text-only behavior |
|---|---|---|---|
| [`docx-writer.ts`](../src/main/export/writers/docx-writer.ts) | `docx` (MIT) | `Paragraph` + `Table` + `ImageRun` from the extracted layout | Flat reading-order `Paragraph` stream, no tables/images |
| [`xlsx-writer.ts`](../src/main/export/writers/xlsx-writer.ts) | `exceljs` (MIT) | Sheet-per-page; detected tables → cell grids (streaming write API `useSharedStrings: true` for large workbooks, R-W23-C) | One sheet, all text rows |
| [`pptx-writer.ts`](../src/main/export/writers/pptx-writer.ts) | `pptxgenjs` (MIT) | One slide per page; 16:9 widescreen + letterboxing; `SLIDE_W_IN / pageWIn` scale factor + PDF-bottom-up → PPTX-top-down Y-flip (R-W23-D — `pres.write()` wrapped in a Promise to avoid blocking the event loop) | One slide per page, text only |
| [`image-writer.ts`](../src/main/export/writers/image-writer.ts) | `@napi-rs/canvas` + `utif` (both MIT) | n/a (image formats have no quality tier) | Raster at chosen DPI; PNG/JPEG one file per page; `utif` multi-page TIFF bundling |

**Export-job lifecycle (conventions §17 + Julian Wave 25 H-25.1 gap).** Per-job state lives in an `ActiveJob` map; the `export_jobs` row transitions `queued` → `running` → `completed` / `cancelled` / `failed`. Per-page cancel checkpoints at 3 points (start / after layout extract / after table detect) via an `AbortController` wired into `export:cancelJob`. Output is written atomically: `<output>.export-temp` → rename to `<output>` on success; the temp file is unlinked on cancel/failure (no orphan partial output).

> **H-25.1 gap (honest):** the documented `ExportQueue` from [`architecture-phase-6.md §4.6`](architecture-phase-6.md) (concurrency=1 FIFO; `queue_full` returned at the 50th waiter) is **NOT implemented in v0.6.0.** The engine runs every IPC call INLINE; `getActiveJobCount` only enforces the `queue_full` HARD CAP, not serial execution. Concurrent requests for the same `outputPath` can race the `.export-temp` file. Phase 6.1 ships the ~50 LOC queue module. Until then, the modal warns "An export to this path is already running" as a best-effort guard.

**Source-loader + font-factory (RESOLVED in 0.7.1 — all six formats live end-to-end).** `createProdSourceLoader` in [`src/main/export/export-bootstrap.ts`](../src/main/export/export-bootstrap.ts) was a typed-THROWING stub at the Phase-6 close (Julian M-25.4); it is now wired to pdf.js's `getDocument().getPage(i).getTextContent() / getOperatorList()`. The remaining defect — image export rendered embedded images but left **standard-font text blank** — was fixed in the 0.7.1 backlog-fix wave. See the worked example below; it is the canonical instance of the dev-works/packaged-breaks path-resolution class. Diego's 0.7.1 packaged-binary proof (`scripts/wave-fix-v071-png-text-evidence.cts`) renders a Helvetica/Times/Courier page through the production engine against the SHIPPED `app.asar.unpacked` font tree and counts **25,688 dark pixels** (0 / blank in 0.6.1).

#### Worked example — the standard-font glyph fix (`file://` URL vs `fs.readFile`, the asarUnpack seam)

This is worth studying because it generalizes to every "works in dev, breaks in the packaged binary" asset-path bug. Two layers had to be fixed:

1. **Font-resolution ordering.** `rasterize()` called `page.render()` without first forcing font resolution. The fix awaits `page.getOperatorList()` before `render()` — it walks the content stream to completion so pdf.js resolves every font and builds its glyph-path generators BEFORE painting. (A unit test pins the `['getOperatorList', 'render']` call order even when the native canvas binding is absent.)
2. **The load-bearing bug — `file://` URL vs filesystem path.** Node's `fetch` cannot read `file://` URLs, AND pdf.js v4's `NodeStandardFontDataFactory` does `fs.promises.readFile(url)` on the **verbatim `file://` URL string** it is handed via `standardFontDataUrl` — which fails, because a `file://` string is not a filesystem path. So the standard-14 fonts never loaded and all standard-font text came out blank. The fix supplies an explicit Node-safe `StandardFontDataFactory` + `CMapReaderFactory` to `getDocument` that read font/cmap bytes via `fs.readFile` from a **resolved absolute directory** — sidestepping the url-vs-path ambiguity entirely and working regardless of pdf.js's environment-fragile `isNodeJS` autodetection.

**The path-resolution seam that makes it work in BOTH dev and the packaged binary:**

```
resolveExportFontData()                         // src/main/export/export-bootstrap.ts
  root = dirname(require.resolve('pdfjs-dist/package.json'))
  factory reads fs.readFile(join(root, 'standard_fonts', filename))   // absolute path, not file://
```

```
electron-builder.yml  asarUnpack:               // Diego's domain
  - node_modules/pdfjs-dist/package.json
  - node_modules/pdfjs-dist/standard_fonts/**/*
  - node_modules/pdfjs-dist/cmaps/**/*
```

In dev, `require.resolve('pdfjs-dist/package.json')` lands in `node_modules/`. In the packaged binary, Electron's asar shim redirects that same `require.resolve` to `app.asar.unpacked/node_modules/pdfjs-dist/...` **precisely because that target file is unpacked** — so `root` points at the unpacked tree and the sibling `standard_fonts/` + `cmaps/` (also unpacked) are real on-disk files that `fs.readFile` can open. The seam holds because **each side documents the other's load-bearing line**: David's `resolveExportFontData` comment cites the asarUnpack dependency; the `electron-builder.yml` comment cites the `require.resolve` anchor. When two agents share a packaged-binary path contract, each file must name the other's exact resolution mechanism — that is the discipline that prevents this class of bug. The general rule: **never hand a `file://` URL string to a Node `fs` API, and verify any `require.resolve`-anchored asset path against the asarUnpack list before declaring a packaged feature done.**

**No EditOperation, no replay-engine integration.** Export does NOT produce an `EditOperation`; the replay engine is unchanged. Export reads from the source via `documentStore.getBytes(handle)`, composes a NEW output buffer, and writes it to the user-chosen path. No `signature_audit_log` update, no `edit_history` insert — read-only on source (P6-L-9).

### Auto-update architecture (Phase 7)

Auto-update uses **`electron-updater` (MIT)** with the GitHub-releases provider. The full design is in [`architecture-phase-7.md §3`](architecture-phase-7.md); the controller is [`src/main/auto-update.ts`](../src/main/auto-update.ts); the three IPC handlers are `src/ipc/handlers/update-{check,download,install}.ts`.

**Library injection, not direct import (the Phase-6.1 lesson applied).** `electron-updater` is loaded by a runtime `require` *inside* `loadElectronUpdaterModule()`, which returns `null` if the package is absent. But that loader **and** `createAutoUpdateController` are **statically imported** into `src/main/index.ts`. This is deliberate: a runtime `require` of the *factory module itself* would get vite-tree-shaken out of the main bundle (the exact trap that cost two Diego vite-config patches in Phase 6.1 — see [Common pitfalls → Runtime `require()`](#runtime-require-of-in-tree-modules--vite-tree-shake--electron-30-esm-rejection)). **Do not add a vite safety-net plugin for auto-update; the static import keeps it in the main bundle.**

**The placeholder publish target → honest `update_not_configured`.** `electron-builder.yml` carries a `publish: { provider: github, owner: PLACEHOLDER, repo: PLACEHOLDER }` block. The controller reads the emitted `app-update.yml` from `process.resourcesPath` via `isPublishConfiguredFromAppUpdateYml()`, which returns `false` on `PLACEHOLDER`. `ensureUpdater()` returns `null` when EITHER the publish target is a placeholder OR `electron-updater` is not installed — both route every update call to a `Result<never, 'update_not_configured'>`. The controller **never throws across the IPC boundary** and **never fakes a "you're up to date"**. When a real channel is configured (Phase 7.1), the controller auto-detects the live feed with **zero code change**.

**Graceful + safe by construction:**

- `autoDownload = false` always — no silent background downloads. Every download is user-initiated after a check reports `available`.
- `update.lastCheckedAt` is stamped + persisted **only** when a check actually runs (nullable + late-init; **no sentinel `0`** — a `0` would render "Jan 1 1970" in the About modal).
- Signature verification is **not disabled** — an unsigned bundle surfaces `signature_verification_failed` (the cert dependency, P7-L-2 §3.5). This is correct security behavior, not a bug.
- `update:install` schedules `quitAndInstall()` on the next tick and returns `ok({ quitting: true })` *before* the process exits, so the renderer observes the ok first. The request carries an optional `confirmedDiscardUnsaved?: boolean`; the controller refuses with `unsaved_work_blocks_install` when there is unsaved work and the flag is not set (see the unsaved-work gate below).

> **Unsaved-work install gate (H-29.1 / H-FIX.1 — FIXED IN SOURCE; honest binary-vs-source note).** The gate that prevents `quitAndInstall` from discarding unsaved edits is **correct in the source code**, end-to-end:
> - **Main-process gate** (`auto-update.ts`): after the configured + version-match guards but before the irreversible quit, if `hasUnsavedWork()` and NOT `confirmedDiscardUnsaved`, it returns `unsaved_work_blocks_install` and schedules no quit. The contract gained `confirmedDiscardUnsaved?: boolean` + the `unsaved_work_blocks_install` error variant.
> - **Renderer dirty-state gate** (`update-status-area/index.tsx`, H-FIX.1): production wires `hasUnsavedWork: () => false` (dirty state is renderer-owned, mirroring `app:quit`), so the renderer is the live trigger — it checks its own `selectIsDirty` before calling `install` and opens a Save / Discard / Cancel confirm dialog when dirty; the main gate is defense-in-depth. This closes the subtle "test-green gate wired to a constant-false probe" data-loss bug.
>
> **The honest nuance — do NOT claim the 0.7.1 binary has the gate active.** The H-FIX.1 renderer fix landed during the parallel repack, so the **v0.7.1 packaged binary likely predates it**. **Functional impact is ZERO:** the auto-update install code path is unreachable until a real GitHub publish target is configured (a [deferred item](../README.md#deferred--requires-external-resources) — the placeholder returns `update_not_configured`), so the install button never renders and the gate is never reached in 0.7.1. The fix **self-resolves at the next packaging pass** — the first build produced after a real update channel exists ships the gate active in the binary, exactly when the code path first becomes reachable. The source is correct now; the binary activates it later, with no functional gap in between. (This binary-vs-source honesty — never claiming a fix is shipped in the binary when only the source has it — is a trust-floor-adjacent discipline; see the [`code-review.md`](code-review.md) Backlog-Fix section for the audit reasoning.)

### Telemetry framework (Phase 7)

Telemetry is a **hand-rolled, zero-new-dependency** framework: opt-in, default OFF, anonymous counts only, no third-party SDK, no network transport. The design is in [`architecture-phase-7.md §4`](architecture-phase-7.md); the main-process service is [`src/main/telemetry.ts`](../src/main/telemetry.ts); the renderer hook + transport are in `src/client/telemetry/**`; the IPC handlers are `src/ipc/handlers/telemetry-{record-event,set-opt-in,get-status}.ts`.

**The `.strict()` zod schema is a STRUCTURAL PII barrier — the project's exemplar privacy pattern.** Three independent, test-pinned barriers make the absence of personal data a *property of the type system + schema*, not a discipline that can be forgotten:

1. **The IPC request schema is `.strict()`** ([`telemetry-record-event.ts`](../src/ipc/handlers/telemetry-record-event.ts)). It accepts only `{ name, dayBucket }` and **rejects any additional property** at `safeParse`. There is physically no field for `userId`, `filePath`, `docTitle`, `value`, or an error string — so a leak cannot be introduced by a careless call site; it fails as `invalid_payload`. Test it directly: `recordEvent({ name, dayBucket, userId: 'x' })` → `invalid_payload`. The `dayBucket` regex `^\d{4}-\d{2}-\d{2}$` also rejects sub-day timestamps (anti-fingerprinting).
2. **The event interface has no PII slot, and the transport is REQUIRED on the interface** (no optional + stub fallback — the anti-stub discipline). The call site passes only the event *name*; the hook adds the count + day bucket. A future maintainer cannot quietly add a free-text field without changing the schema *and* the type *and* the tests.
3. **Opt-in defaults OFF and the gate is a SILENT no-op that returns BEFORE buffering** (`telemetry.ts`). When opt-in is OFF the event is not even stored (`not_opted_in`, `transport.size() === 0`), re-checked server-side. Turning opt-in OFF clears the buffer (`bufferCleared: true`).

Plus: timestamps are **day-bucketed** (defeats session fingerprinting); the buffer is an **in-memory bounded ring** (`NoOpRingBufferTransport`, default 500, oldest evicted at capacity) — **no SQLite table** (a persisted table would be a forensic/tamper surface; the migration header explicitly forbids a future maintainer from adding one); **no event payload is ever logged** (channel + ok/dropped only); **no third-party phone-home SDK**.

**Audit grep suite** (run on any telemetry surface, in any project — this generalizes):

```bash
rg 'filePath|docTitle|userId|content'    src/client/telemetry/ src/main/telemetry.ts   # expected: ZERO
rg 'fetch|http|net|socket|sendBeacon'    src/client/telemetry/ src/main/telemetry.ts   # expected: ZERO
rg '@sentry|google-analytics|posthog|mixpanel|amplitude'  src/                          # expected: ZERO
rg '\.strict\(\)'  src/ipc/handlers/telemetry-record-event.ts                          # expected: >= 1
rg 'console|log\.(info|debug|warn|error)'  src/ipc/handlers/telemetry-record-event.ts   # expected: ZERO
```

Phase 7.1 may add a self-hosted `NetworkBatchTransport implements TelemetryTransport` behind the SAME interface; the allowlist, opt-in UI, and `.strict()` guard do not change.

### i18n framework (Phase 7)

Localization uses **`i18next` (MIT)** + **`react-i18next` (MIT)** + **`i18next-resources-to-backend` (MIT)**. The full strategy is in [`i18n-strategy.md`](i18n-strategy.md); the renderer init is [`src/client/i18n/index.ts`](../src/client/i18n/index.ts); the typed-key augmentation is `src/client/i18n/i18next.d.ts`; the store-reactive hook is `src/client/i18n/use-t.ts`.

- **8 namespaces, 816 keys (en-US, measured) as of 0.7.1.** `common`, `toolbar`, `menu`, `sidebar`, `modals`, `settings`, `errors`, `trustfloor`. The Phase-7 baseline was 482 keys (first-paint + high-traffic + honesty surfaces); the 0.7.1 backlog-fix wave swept the deep modal-step bodies (28c — see below) and grew it to 816. Namespaces map to lazy-load boundaries and keep each JSON file small. `errors.json` is keyed by the `Result` error code so the error→message map is auditable. `trustfloor.json` carries the multi-phase honesty copy (Phase 4/5/6/7 obligations) — including the canonical Phase-7 obligation strings consumed by this doc set.
- **`fallbackLng: 'en-US'` + `returnEmptyString: false` + `returnNull: false`.** A missing es-ES key renders the English value, never a raw `ns:key` on screen. The structural defense against the half-extracted-mix problem.
- **Typed keys via `CustomTypeOptions`.** The `i18next.d.ts` augmentation types `resources` from the en-US JSON, so `t('toolbar:open')` is compile-checked — a typo or missing key is a **compile error**, not a runtime raw key. **No `as any` on `t()`** (if the type system complains, the key is missing from en-US — add it, don't cast).
- **Lazy-load story.** es-ES is intended to be a Vite code-split chunk loaded only when selected (via the resources-to-backend template-literal dynamic import). In the v0.7.0 packaged build, the es-ES strings were **inlined into the main renderer chunk** rather than split into a separate chunk (functionally identical — the strings ship and the live switch works; the per-locale initial-chunk-size optimization did not materialize). Converting to an `import.meta.glob` map to restore the code-split is a non-blocking follow-up (Diego Wave 29 note).
- **The 28c gap — RESOLVED in 0.7.1.** The deep Phase-4..6 modal-*step* bodies (multi-step OCR-invalidate confirm prose, signature-capture sub-step instructions, the export / mail-merge / PAdES step components) are now `t()`-extracted across 25 components. en-US baseline 482 → 816 keys (measured by `coverage.test.ts`, not estimated); es-ES translates the high-frequency new surface (modal titles, step labels, buttons, honesty headings) at ~68% (558/816), with the rest falling back to English (never a raw key — `coverage.test.ts` proves every en-US key resolves to a non-raw es-ES string). `extraction-regression.test.ts` has a `SWEPT_28C` group asserting no literal `aria-label/title/placeholder` survives and each component consumes `useT`.
- **No new date/number-formatting dependency** — relative times, file sizes, and counts route through the platform `Intl` API keyed to the active locale. No `date-fns` / `moment` / `numeral`.

### a11y patterns (Phase 7)

The accessibility audit + remediation map is in [`a11y-audit.md`](a11y-audit.md). Wave 28a closed all ten remediation items (R-1..R-10) and the deferred Phase-1 ARIA-tab debt. The reusable infrastructure is **three shared hooks** in [`src/client/hooks/`](../src/client/hooks/):

| Hook | Purpose |
|---|---|
| `use-tablist-keys.ts` | WAI-ARIA tab pattern: roving tabindex (only the active tab is in the tab order) + Arrow/Home/End keyboard nav. Used by the sidebar tablist (vertical) and the Settings tablist (horizontal). |
| `use-focus-trap.ts` | Modal focus management: focus-in on mount, Tab/Shift+Tab cycle within, Esc escapes (no keyboard trap), focus restored to the trigger on close. Applied via the shared `ModalShell` all modals route through. (Deliberately does NOT filter focusables by `offsetParent`/visibility — jsdom never computes layout, so that filter would empty the list and break the trap in tests.) |
| `use-roving-toolbar.ts` | Toolbar single-Tab-stop + arrow traversal, disabled-button skip, remembers last-focused. `aria-pressed` emitted only for toggle buttons (momentary actions like Open/Save omit it). |

The WAI-ARIA tab pattern (applied identically to sidebar + settings): `role="tablist"` + per-tab `role="tab"` + `aria-selected` + `aria-controls`/`aria-labelledby` tabpanel + roving tabindex. All `aria-label` strings go through `t()` (a Spanish-speaking Narrator user must hear Spanish labels — conventions §18.4.9).

> **The restored-to-error ESLint rule (the a11y ratchet).** Phase 1 dropped `jsx-a11y/aria-proptypes` to `warn` to work around eslint-plugin-jsx-a11y 6.9's rejection of dynamic boolean ARIA. The installed plugin is now **6.10.2**, which handles `aria-selected={isActive}` cleanly, so Wave 28a removed every literal-branch workaround and Wave 29 (Diego) flipped the rule back to **`error`** — verified 0 violations across `src/client`. This rule is the ratchet that prevents the tab-semantics regression; **do not weaken it back to `warn`.** (IDE-vs-CLI skew caveat: some editors' bundled a11y analyzer false-positives on `aria-selected={expression}`; the authoritative gate is `npx eslint`, which reports 0 — trust the CLI, do not reintroduce literal-branch workarounds.)

### Cross-platform build (Phase 7)

`electron-builder.yml` (Diego) gained `mac` (dmg + zip, `arch: [universal]`, `hardenedRuntime: true`) and `linux` (AppImage + deb, `category: Office`) blocks alongside the existing `win` block. Per locked decision **P7-L-1: configure all, verify Windows only** — the CI matrix builds Windows packaging only; mac/linux are config-only and **UNVERIFIED on real hardware** (see [`architecture-phase-7.md §2`](architecture-phase-7.md) + [README → Platform support](../README.md#platform-support)).

**The native-module rebuild story is the riskiest unverified surface** ([`architecture-phase-7.md §6`](architecture-phase-7.md)):

| Native dep | Cross-platform handling | mac/linux risk |
|---|---|---|
| `better-sqlite3` (N-API SQLite) | `electron-rebuild` compiles against the target platform + Electron ABI (per-platform prebuild or from-source). Needs the platform toolchain (Xcode CLT / build-essential) on the build host — **cross-compile from Windows is unsupported; you must build ON a mac/linux host.** | **HIGH** — a failed rebuild crashes the DB layer on launch (white-screen app), invisible to a green CI package step |
| `@napi-rs/canvas` (Skia, raster pipeline) | Per-platform prebuilt `.node` binaries; the universal-mac target needs BOTH darwin-x64 AND darwin-arm64 merged | **MEDIUM** — the universal merge must include both prebuilds |
| `tesseract.js-core` (WASM + traineddata) | WASM is platform-agnostic; tessdata copied via the existing asarUnpack | **LOW** |

The top-level `asarUnpack` globs sit OUTSIDE the `win:` block, so they apply to mac/linux too. Verifying mac + Linux on real hosts (build + launch + an L-002-equivalent screenshot) is the headline **Phase 7.1** work item — when a host appears, no design work remains, only `electron-builder --mac` / `--linux` + the screenshot drill.

### Phase 7 IPC channels

Eight new channels under three new domains, all designed in [`api-contracts.md §18`](api-contracts.md). Quick reference card:

| Channel | Status | What it does |
|---|---|---|
| `update:check` | LIVE controller, placeholder feed | Check the release feed. Returns honest `update_not_configured` while the publish target is a placeholder. |
| `update:download` | LIVE controller, placeholder feed | Download an available update (user-initiated only). Surfaces `signature_verification_failed` for unsigned bundles. |
| `update:install` | LIVE controller, placeholder feed | `quitAndInstall`. Returns `ok({ quitting: true })` before exit. (No unsaved-work gate yet — H-29.1.) |
| `update:onProgress` (event) | LIVE | Download-progress events to the active window. |
| `telemetry:recordEvent` | LIVE | `.strict()` PII guard; opt-in re-checked server-side; allowlist re-validated; never logs the payload. |
| `telemetry:setOptIn` | LIVE | Persist the opt-in flag; turning OFF clears the buffer. |
| `telemetry:getStatus` | LIVE | Opt-in state + buffer snapshot (`includeBuffer: true` for the debug panel). |
| `i18n:setLocale` | LIVE | Persist `settings.i18n.locale`; rejects unsupported locales. The renderer applies the live switch via i18next. |
| `i18n:getAvailableLocales` | LIVE | Static descriptor list with a `complete` flag (the proof locale's `complete: false` drives the picker's "translation sample" subtext). |

See [`api-reference.md`](api-reference.md) for request/response shapes + error variants + renderer examples.

### Phase 4 IPC channels (signatures + annotations)

Eleven new IPC channels under two new namespaces — `signatures:*` (seven) and `annotations:*` (three plus `addShape`). All channels are LIVE in 0.4.2 and end-to-end after the Phase 4.1 B-17.1 closure. Full contract types: [`api-contracts.md §14`](api-contracts.md). Quick reference card:

| Channel | What it does |
|---|---|
| `signatures:certLoad` | Load PFX + password; return opaque handle. Buffer-wraps password in ≤5 lines, drops JS string, transfers ownership to cert-store. |
| `signatures:certRelease` | Idempotent zero + release. Renderer fires on modal close; app.before-quit fires for retained handles. |
| `signatures:applyVisual` | Visual signature (placeholder or freeform). Appearance only; writes empty `/V <<>>` marker. No audit row. |
| `signatures:applyPades` | PAdES cryptographic signature (placeholder or freeform). Auto-release default true. Inserts audit row. |
| `signatures:requestTimestamp` | Standalone TSA request. Used internally by applyPades; also exposed for Settings "Test TSA URL". |
| `signatures:verify` | Re-hash byte-range; compare to audit row. Informational (NOT trust-chain validation). |
| `signatures:listAudit` | List rows from `signature_audit_log` with optional filters (file hash, fingerprint, date range). |
| `annotations:addShape` | Author Square / Circle / Polygon / PolyLine / Line / FreeTextCallout. Returns `annot-add-shape` EditOperation. |
| `annotations:setMeasureCalibration` | Set per-document calibration (unit + scale). |
| `annotations:getMeasureCalibration` | Get current calibration or null. |
| **`fs:readBytesByHandle`** (Phase 4.1) | Renderer fetches validated document bytes by handle for pdf.js rendering. NEVER accepts a path; trust derives from the opaque handle. |

See [`api-reference.md`](api-reference.md) for request/response shapes + error variants + renderer examples.

### Phase 4.1 — the `fs:readBytesByHandle` channel and the renderer-bytes story

The pdfjs renderer needs document bytes to render pages + thumbnails. Phase-1 wired this through a `pdf-render.ts` stub that was scheduled to be wired up by Diego in Wave 2 but bled through 13+ subsequent waves because every consumer test mocked it. Phase 4.1's permanent fix:

- [`src/ipc/handlers/fs-read-bytes-by-handle.ts`](../src/ipc/handlers/fs-read-bytes-by-handle.ts) — main-side handler. Takes only `{ handle: DocumentHandle }`. Looks up the document record in main's `documentStore` by handle and returns the validated bytes verbatim.
- [`src/client/services/pdf-loader.ts`](../src/client/services/pdf-loader.ts) — renderer-side wrapper. The SOLE caller of `api.fs.readBytesByHandle` in `src/client/`. Maintains a per-handle proxy cache + in-flight de-duplication. Module-scope `Map<DocumentHandle, LoadedEntry>` (safe because there's exactly one consumer — PdfCanvas via PdfViewer).
- [`src/client/services/pdf-render.ts`](../src/client/services/pdf-render.ts) — calls `getDocument({ data: bytes, standardFontDataUrl, cMapUrl, cMapPacked: true })` with the URLs pointing at `/pdfjs/standard_fonts/` and `/pdfjs/cmaps/` (Vite-asset-copied at build time via `vite-plugin-static-copy`).

**Security floor:** no path crosses the IPC boundary. The bytes were validated at open time by `dialog:openPdf` / `fs:readPdf` (sanitizePath + size cap + `%PDF-` header sniff via `loadPdfMetadata`). The renderer cannot escalate to disk through this channel.

### Phase 4.1.1 — `measurePageDimensionsThunk` (Option Y root-cause fix)

Phase 1 hardcoded `PageModel.width = 612` + `PageModel.height = 792` (Letter) for every page of every document. The Wave 2 Phase 1 stub of pdf-render meant no real measurement ever happened, and the hardcode bled silently for 13+ waves. Pages of A4 / Legal / arbitrary-size PDFs rendered at the wrong scale.

Phase 4.1.1 root-fixed via Option Y — a centralized thunk that fires after every `setDocument` action (open, dropped-open, combine):

```ts
// src/client/state/thunks.ts
export const measurePageDimensionsThunk =
  (handle: DocumentHandle): AppThunk =>
  async (dispatch) => {
    // dedupe by handle via module-scope Set
    if (measureInflight.has(handle)) return;
    measureInflight.add(handle);
    try {
      const doc = await loadDocumentByHandle(handle);
      const updates: Array<{ pageIndex: number; width: number; height: number }> = [];
      for (let i = 0; i < doc.numPages; i++) {
        // eslint-disable-next-line no-await-in-loop -- sequential by design (memory bound)
        const page = await doc.getPage(i);
        const view = page.getViewport({ scale: 1 });
        updates.push({ pageIndex: i, width: view.width, height: view.height });
        page.cleanup(); // memory hygiene
      }
      dispatch(setPageDimensions(updates));
    } finally {
      measureInflight.delete(handle);
    }
  };
```

Why Option Y vs Option X (per-consumer measurement):

- `PageModel.width/height` has **14 consumers** in `src/client/`: `pdf-canvas/`, `thumbnail-strip/thumbnail-item.tsx`, `pdf-coords.ts` (annotation screen-to-PDF transforms — used by every annotation, shape, signature, form-field overlay), `page-metadata/index.tsx`, `viewportForPage` helper, `annotation-layer/index.tsx`, etc.
- Option X would require 14 component-local `measuredDims` wirings + 14 eventual desync risks.
- Option Y closes the rot class at the source. One source of truth (Redux `PageModel`), populated within one tick of document open.

**Lesson promoted to the Common pitfalls section below**: prefer nullable + late-init over sentinel defaults; sentinel defaults are silently wrong while nullables fail loudly at the consumer.

### Phase 4.1.1 — pdfjs assets via build-time copy (Option Q)

pdfjs-dist ships `standard_fonts/` (16 files, ~700 KB) and `cmaps/` (169 files, ~1.5 MB) under `node_modules/pdfjs-dist/`. The renderer's `pdf-render.ts` requires both at runtime via `standardFontDataUrl` + `cMapUrl`. Three deployment options were considered:

- **Option P — commit the 185 binary files under `src/client/public/pdfjs/`.** Rejected: ~2 MB binary in the repo + guaranteed staleness vector on every pdfjs-dist bump.
- **Option Q — build-time copy via `vite-plugin-static-copy` (MIT).** Accepted. The plugin matches `node_modules/pdfjs-dist/standard_fonts/**` and `node_modules/pdfjs-dist/cmaps/**` and emits them flat under `dist/renderer/pdfjs/` at every renderer build.
- **Option R — runtime fetch from a CDN.** Rejected: violates the offline-first floor + CSP `worker-src 'self' blob:`.

The bump procedure becomes trivial: `npm install pdfjs-dist@<new>` + `npm run build` syncs the assets automatically. If the pdfjs-dist layout ever changes, the build fails loudly (fast-glob returns no matches).

### The schema-v3 migration

`migrations/0003_phase3_forms.sql` adds the `form_templates` table:

```sql
CREATE TABLE form_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  fields_json TEXT NOT NULL,           -- JSON-encoded FormFieldDefinition[]
  source_doc_hash TEXT,                -- optional; null for from-scratch templates
  last_column_mappings TEXT,           -- JSON-encoded Record<columnName, fieldName>; null until first merge
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_form_templates_name ON form_templates(name);
CREATE INDEX idx_form_templates_updated_at ON form_templates(updated_at DESC);
```

Templates are keyed by `id`, not by `file_hash` — they're cross-file by design. A template authored against one PDF can be applied to any other PDF. The migration is idempotent and forward-only (no rollback), consistent with Phase 1 + Phase 2 policy.

---

## Development loop

### Run the app in dev mode

```bash
npm run dev
```

This launches `electron-vite dev`:

- Vite serves the renderer with HMR on a local port
- Electron's main process is rebuilt with `tsc` watch and restarted on change
- The preload bundle is rebuilt with `tsc` watch

The dev window opens DevTools by default. Edit any `src/client/**/*.tsx` file and the renderer hot-reloads. Edits to `src/main/**` or `src/preload/**` restart Electron (the renderer state is lost — this is normal).

### Typecheck

```bash
npm run typecheck         # all three: main + preload + renderer
npm run typecheck:main
npm run typecheck:preload
npm run typecheck:renderer
```

Each process has its own `tsconfig.*.json` because the module and DOM environments differ. The Phase 1.1 TS4023 cascade in `tsconfig.renderer.json` is closed (the `composite: true` drop) — cold renderer typecheck reports 0 errors. New code must keep that clean.

### Lint

```bash
npm run lint              # blocks at any warning
npm run lint:fix          # autofix what's autofixable
```

Configured in `.eslintrc.cjs`. Includes `@typescript-eslint`, `react`, `react-hooks`, `jsx-a11y`, `import`. The `--max-warnings 0` flag means new code must be warning-free. The Phase 2 H-2 ESLint patch adds the renderer-gatekeeper enforcement (see [renderer-gatekeeper boundary](#the-renderer-gatekeeper-boundary)). Wave 29 restored `jsx-a11y/aria-proptypes` from `warn` to **`error`** — the a11y ratchet (see [a11y patterns](#a11y-patterns-phase-7)).

#### CI lint debt (Phase 7 status)

At the v0.7.0 release, Diego flagged that `npm run lint` (the CI gate, `--max-warnings 0` over `src/**` + `tests/**`) was **RED — 46 errors, 402 warnings (448 problems)**, independent of Phase 7. The bulk were `lint:fix`-able import-order + unused-var cleanups. The Wave-30 sweep cleared the debt; the 0.7.1 backlog-fix wave then added a **husky pre-commit hook** (see [Git hooks](#git-hooks-pre-commit--pre-push)) so the debt cannot silently re-accumulate. `typecheck`, `test`, and the packaged binary are all green; lint is now enforced at commit time.

### Git hooks (pre-commit + pre-push)

The 0.7.1 backlog-fix wave wired `husky@9` + `lint-staged@17` (both MIT, build/test-only — they do NOT ship in the binary) to prevent lint-debt re-accumulation. `prepare: husky` installs the hooks on `npm install`.

- **`.husky/pre-commit`** runs `npx lint-staged` (per the `lint-staged` config in `package.json`: `eslint --fix --max-warnings 0` + `prettier --write` on staged `*.{ts,tsx}`), **then** a `tsc` safeguard (`npx tsc -p tsconfig.main.json --noEmit`).
- **`.husky/pre-push`** runs the full three-tsconfig `npm run typecheck` + the full-repo `npm run lint` (mirrors the CI gate).

**Why the pre-commit hook also runs `tsc` (the load-bearing safeguard).** `eslint --fix` for `@typescript-eslint/consistent-type-imports` aggressively collapses mixed value+type imports into `import type {}`. For modules that import a pdf-lib **class** and use it as a runtime value (e.g. `PDFDict`), that autofix goes **lint-GREEN but tsc-RED** (`TS1361: '…' cannot be used as a value because it was imported using 'import type'`). A lint-only hook would therefore *introduce* type breakage on commit. Running `tsc` after the autofix catches it. The pre-commit typecheck is scoped to `tsconfig.main.json` (fastest; pdf-lib is a main-only dep, so the hazard lives entirely there) to keep commits fast; the full three-tsconfig sweep is on pre-push.

(If you do not have a git repo initialized, husky cannot bind `core.hooksPath` and the hooks are inert until `git init` + `npm install`. They are still correct — the logic was proven by running the exact hook commands directly.)

### Format

```bash
npm run format            # writes Prettier output
npm run format:check      # CI mode (read-only)
```

Prettier covers `.ts/.tsx/.css/.json` plus `docs/**/*.md`.

### Test

```bash
npm test                  # vitest run (CI mode, runs once)
npm run test:watch        # vitest watch
npm run test:ui           # vitest UI
```

Vitest covers `src/**/*.test.ts(x)`. Current verified counts (**0.7.1 backlog-fix close, 2026-05-28, vitest 2.1.9**):

**Aggregate: 1765 passing / 5 pre-existing failures.** The 0.7.1 backlog-fix wave improved the count from the Phase-7 baseline (~1718) — the 3 image-export standard-font glyph regressions (David's font-factory fix) and 3 of Riley's i18n string-assertion tests now pass. **The 5 remaining failures are PRE-EXISTING jsdom-environment limitations, none backlog-fix-related and all reproduced verbatim before and after the wave:** `use-signature-canvas` (jsdom `blob.arrayBuffer` polyfill gap), and duplicate-element ambiguities in `annotation-summary-panel`, `signature-audit-panel`, and `pades-sign-modal` (×2, RTL timing/structural). These are Riley-domain renderer test-debt, not runtime defects.

The Phase-7 telemetry tests are the privacy proof: `telemetry-record-event.test.ts` asserts `{ name, dayBucket, userId: 'x' }` / `filePath` / `docTitle` / sub-day-timestamp all → `invalid_payload` (the `.strict()` guard), that opt-in OFF is a silent no-op that doesn't even buffer, and that the rejected payload is never echoed in the error message. The i18n `coverage.test.ts` (816-key baseline as of 0.7.1) proves every en-US key resolves to a non-raw string in es-ES via fallback.

**Historical:** Phase 7 close (Wave 29) ~1718 / 5; Phase 6 close (2026-05-27) ~1520 / 1527.

| Suite | Test count | What's covered |
|---|---|---|
| `src/main` + `src/ipc` + `src/preload` (Vitest) | **~880** | Everything from Phase 1-5 (engine round-trips, all IPC handlers, db-bridge, replay golden bytes, atomic save, L-001, cert-store + PAdES + TSA + shape-annotations, **Phase 5 OCR engine + worker-pool + language-pack-manager + searchable-pdf-builder + ocr-text-layer + image-preprocess + ocr-confidence + pades-detect**) PLUS **Phase 6 export: engine (per-page pipeline + job lifecycle + cancel checkpoints), layout-extract (8-step pipeline incl. empty-page-returns-null + column X-clustering + heading MODE-bucketing + density-rejection), table-detect (5-step line-grid + fails-soft on borderless), image-extract (CTM stack tracking + MIN_AREA_PT2 skip), four writers (docx / xlsx-streaming / pptx Y-flip / image raster + multi-page-TIFF), export-shared, the 8 `export:*` handlers + `dialog:pickExportOutputPath`**. 2 Phase-6 tests currently failing (pptx Y-flip + image-extract CTM-restore; David Wave 25.1). |
| `src/client` (Vitest) | **~370 pass / 5 pre-existing fail** | Phase 1-5 slices + selectors + history middleware + components + thunks PLUS **Phase 6 export-slice (modal step + draft + in-flight job + recent-jobs + last-chosen-format + format catalog, nullable + late-init throughout), export-selectors (incl. `selectResolvedQualityTier`), thunks-phase6 (listFormats / pickOutputPath / startExport format-discriminated dispatch / cancel / refresh / dismiss), export-modal (format-picker / quality-tier-picker / per-format-options / per-format-limitations-panel / running-step), exports-panel sidebar tab (job-row), status-bar export-progress widget**. 5 documented pre-existing failures (Wave 16 carry-over: annotation-summary-panel, pades-sign-modal ×2, signature-audit-panel, use-signature-canvas — jsdom-canvas + `getByText` ambiguity). |
| `src/db` (Vitest) | **~290** | Phase 1-5 repos PLUS **Phase 6 `export_jobs` repo (insert / status transitions / list-with-filters / stats columns; schema v6) + 17 new `export.*` setting keys**. NO Phase 1-5 table touched. Requires better-sqlite3 ABI matching host Node (see [Common pitfalls → Node 24 vs Electron 30 ABI](#node-24-vs-electron-30-abi)). |
| `tests/e2e` (Playwright Electron) | 1 smoke + 1 H-3-closure | Launches the app, asserts main window mounts, asserts the Phase 1+2+3+4+5+6 channels are attached on `window.pdfApi`. |
| **Total** | **1520 / 1527 pass** + 2 e2e | Per-suite splits are approximate (the authoritative aggregate is the 1520/1527 from Diego's Wave 25 `npm test` run). |

**Phase 4 test gaps** (cited honestly):

- **No real-PFX integration test for PAdES sign.** Production PFX certificates are per-user assets, not CI fixtures. The B-17.1 production-path test at [`signature-engine.test.ts:146-204`](../src/main/pdf-ops/signature-engine.test.ts) pins the seam — the engine reaches `signpdf.sign()` without `cert_handle_not_found`, which proves the B-17.1 architectural defect is closed. The actual signing call fails on a synthetic PFX in the test; with a real PFX in a manual smoke run, it produces a valid signed PDF.
- **No automated cross-viewer PAdES verification test** (against Adobe Reader DC, EU DSS, Foxit). Phase 4 produces structurally-correct PAdES output per the spec; cross-viewer compatibility was sanity-checked manually during Wave 16/17 but is not in CI.
- **`signatures:verify` does NOT validate the cert's trust chain.** This is by design (see [`user-guide.md` → PAdES trust floor](user-guide.md#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #4) — but it does mean an `ok: true` verify result is a weaker claim than third-party PAdES validators provide. Tests pin only the byte-range hash match, not chain validity.
- **5 pre-existing renderer tests failing on jsdom/canvas/blob.arrayBuffer polyfill gaps.** Carry-over from Wave 16 (use-signature-canvas, annotation-summary-panel, signature-audit-panel, pades-sign-modal). Riley + David tracked them; they will clear when jsdom is upgraded or swapped for happy-dom.
- **No automated process-kill mid-write test for the atomic-rename invariant** (would require a sub-process harness — Wave 13.5 closed the code path with `tmp+rename` + best-effort cleanup; an actual SIGKILL test is Phase 7+ infra).
- `pdf:identifyTextSpan` real content-stream walker remains stubbed — channel returns `no_text_at_point` and renderer-cached metrics carry the text-edit UX. Phase 5+ absorb.

**Phase 6 test gaps** (cited honestly):

- **No end-to-end in-app export test for docx / pptx / image** because `createProdSourceLoader` is a typed-throwing stub (Julian M-25.4). The engine + writers are tested against synthetic source loaders; the xlsx end-to-end path is proven via Diego's packaged-binary evidence script (`scripts/wave25-xlsx-bytes-evidence.mjs`), but docx/pptx/image require David's Wave 25.1 source-loader wire before they succeed against the live UI.
- **No ExportQueue serialization test** because the queue isn't implemented yet (Julian H-25.1). The inline-execution path is tested; the FIFO concurrency=1 contract is documented but not exercised. Phase 6.1 deliverable.
- **2 Phase-6 main-process tests currently failing under vitest 2.1.9** — `writers.test.ts` pptx Y-flip assertion + `image-extract.test.ts` CTM-restore assertion. Julian Wave 25 attempted remediation (line 441-449 + line 89-127); the rewrites either didn't take or still have wrong expectations. David Wave 25.1 re-investigates.
- **No live-UI export trigger evidence** (desktop-operator-driven Ctrl+Shift+E → see the .xlsx land). Diego Wave 25 proved the engine path against the packaged binary's app.asar bytes but the desktop-operator MCP was not surfaced in the dev-ops agent's tool set; the PowerShell SendKeys fallback failed with "Access is denied" in the non-interactive shell. Phase 6.1 / Phase 7 should enable a Playwright `_electron.launch({ args: ['.'] })` headed-Windows-runner job per the L-002 "to unlock" criteria.

### End-to-end test

```bash
npm run e2e:install       # one-time, downloads Chromium
npm run e2e               # runs Playwright against the built Electron bundle
```

The e2e harness launches Electron via Playwright's `_electron.launch` API and runs the smoke spec at `tests/e2e/smoke.spec.ts`. Currently asserts the empty-state UI is reachable. Phase 3 adds open → edit → save assertions.

### Build for production (no packaging)

```bash
npm run build             # typecheck + electron-vite build into dist/
npm run start:built       # runs the built bundle without packaging
```

### Package for Windows

```bash
npm run dist:win          # build + electron-builder --win
```

Produces:

- `release/PDF Viewer & Editor-0.5.0-x64.exe` — NSIS installer (~133 MB)
- `release/PDF Viewer & Editor-0.5.0-x64-portable.exe` — portable executable (~133 MB)
- `release/PDF Viewer & Editor-0.5.0-x64.exe.blockmap` — for delta-update support (Phase 7)
- `release/win-unpacked/` — unpacked staging directory (useful for inspecting what shipped)
- `release/win-unpacked/resources/migrations/` contains `0001_init.sql` through `0005_phase5_ocr.sql` — all five migrations ship.
- `release/win-unpacked/resources/tessdata/eng.traineddata.gz` — the bundled English language pack (~10 MB), copied at packaging time via `electron-builder.yml extraResources` (Diego Wave 21).
- `release/win-unpacked/resources/app.asar.unpacked/node_modules/tesseract.js-core/` — the unpacked tesseract.js-core WASM blobs (asarUnpack is required because Node Workers + dlopen need real-FS files).
- `release/win-unpacked/resources/app.asar.unpacked/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node` — the Skia native binary (~3 MB) for OCR page rasterization.

**Native binaries that ship in `app.asar.unpacked/` in v0.5.0:**

- `better-sqlite3/build/Release/better_sqlite3.node` (Phase 2)
- `@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node` (Phase 5 — for OCR rasterization)
- `pdfjs-dist/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node` (pre-existing pdfjs-dist transitive)

Phase 5 size delta from Phase 4.2 (105 MB → 133 MB): +27 MB. Breakdown:
- ~10 MB: bundled `eng.traineddata.gz` (extraResources)
- ~10–12 MB: tesseract.js-core WASM blobs (5 variants: lstm, simd-lstm, relaxedsimd-lstm, simd, relaxedsimd) in `app.asar.unpacked/`
- ~3 MB: `@napi-rs/canvas-win32-x64-msvc` Skia native binary
- ~3 MB: remaining tesseract.js JS code + worker scripts

The blockmap is 138 KB. Build time: 90–150 seconds on a modern Windows machine. Electron-builder caches the unpacked Electron runtime in `%LOCALAPPDATA%/electron-builder/Cache/` — first run takes longer.

Code-signing is configured but **disabled by default** (no `WIN_CSC_LINK` env). To sign a release, set the env vars per the [CI workflow](../.github/workflows/ci.yml). Phase 5 still ships unsigned (code-signing is Phase 7).

---

## Testing strategy

| Layer | Tool | Pattern |
|---|---|---|
| IPC handlers (main) | Vitest + injected fakes | Each handler is a pure function taking a `deps` object. Tests pass in-memory fakes for `readFile`, `showOpenDialog`, repos, etc. No real Electron, no real FS. |
| Edit-replay engine | Vitest + golden bytes | `replay()` runs against fixture PDFs; tests assert structural properties (page count, widths, rotations) and golden bytes for byte-stable cases. |
| Repos (db) | Vitest + in-memory SQLite | `connection.ts` accepts a `:memory:` path for tests; the same migrations run against an in-memory DB. Each test starts fresh. |
| Slices / selectors (renderer) | Vitest + jsdom | RTK slices are pure reducers; tested by dispatching actions and asserting the next state. Selectors are tested for reference-equality on repeat calls (H-2 lesson). |
| History middleware | Vitest + jsdom | Round-trip tests dispatch op → undo → assert state matches initial; raw vs compacted dispatch verified via byte assertions. |
| Components (renderer) | Vitest + jsdom + @testing-library/react | Tests render the component with a wrapping `<Provider>` and assert on the accessible DOM. Mock `api` at the module boundary, not below. |
| End-to-end | Playwright + `_electron.launch` | Boots a real Electron, drives it via Chromium devtools protocol, asserts on screenshots and selectors. Windows only. |

**Key rules** (from [`conventions.md`](conventions.md) §8):

- Mock at process boundaries (IPC, FS, time) — not internal modules.
- Tests live next to source (`foo.ts` and `foo.test.ts` in the same folder).
- One `describe` per public function or component.
- Test names start with "should…".

### The expectErr helper

Many handler tests today have the shape:

```ts
const res = handler(req, deps);
if (!res.ok) expect(res.error).toBe('invalid_payload');
```

The `if (!res.ok)` silently passes when a regression turns the failure into an `ok`. The fix is a tiny helper:

```ts
function expectErr<E extends string>(res: Result<unknown, E>, e: E): void {
  if (res.ok) throw new Error(`Expected failure ${e} but got ok`);
  expect(res.error).toBe(e);
}
```

When you add a new handler test, prefer this shape over the silent-pass `if` pattern.

---

## Adding a new IPC channel — worked example

This is one of the two most common tasks. Here's the end-to-end walkthrough using a hypothetical `app:getRuntimeInfo` channel.

### 1. Add the contract types

Edit [`src/ipc/contracts.ts`](../src/ipc/contracts.ts):

```ts
export interface AppGetRuntimeInfoRequest { /* no args */ }
export interface AppGetRuntimeInfoValue {
  uptime: number;
  memoryUsage: number;
}
export type AppGetRuntimeInfoError = 'failed';
export type AppGetRuntimeInfoResponse = Result<AppGetRuntimeInfoValue, AppGetRuntimeInfoError>;
```

Then register the channel name in the `Channels` object near the bottom of the file:

```ts
export const Channels = {
  // ...existing...
  AppGetRuntimeInfo: 'app:getRuntimeInfo',
} as const;
```

And add the method to the `PdfApi` interface:

```ts
app: {
  // ...existing...
  getRuntimeInfo: () => Promise<AppGetRuntimeInfoResponse>;
}
```

### 2. Write the handler

Create `src/ipc/handlers/app-get-runtime-info.ts`:

```ts
import { fail, ok } from '../../shared/result.js';
import type {
  AppGetRuntimeInfoRequest,
  AppGetRuntimeInfoResponse,
  AppGetRuntimeInfoError,
} from '../contracts.js';

export interface AppGetRuntimeInfoDeps {
  getUptime: () => number;
  getMemoryUsage: () => number;
}

export function handleAppGetRuntimeInfo(
  _req: AppGetRuntimeInfoRequest,
  deps: AppGetRuntimeInfoDeps,
): AppGetRuntimeInfoResponse {
  try {
    return ok({
      uptime: deps.getUptime(),
      memoryUsage: deps.getMemoryUsage(),
    });
  } catch (e) {
    return fail<AppGetRuntimeInfoError>('failed', (e as Error).message);
  }
}
```

Conventions:

- The handler is a pure function taking `(req, deps)`. Never `import { app } from 'electron'` directly — that goes through `deps`.
- Validate `req` shape with `zod` before doing any work (see existing handlers for the pattern).
- Return `Result<T, E>` via `ok()` / `fail<E>()` helpers from `src/shared/result.ts`. Never throw across the channel.

### 3. Write the handler test

Create `src/ipc/handlers/app-get-runtime-info.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleAppGetRuntimeInfo } from './app-get-runtime-info';

describe('handleAppGetRuntimeInfo', () => {
  it('should return uptime and memory on success', () => {
    const res = handleAppGetRuntimeInfo({}, {
      getUptime: () => 1234,
      getMemoryUsage: () => 567890,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ uptime: 1234, memoryUsage: 567890 });
  });

  it('should return failed when getUptime throws', () => {
    const res = handleAppGetRuntimeInfo({}, {
      getUptime: () => { throw new Error('boom'); },
      getMemoryUsage: () => 0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('failed');
  });
});
```

### 4. Wire the handler into the registrar

Edit [`src/ipc/register.ts`](../src/ipc/register.ts):

```ts
import { handleAppGetRuntimeInfo } from './handlers/app-get-runtime-info.js';

// inside registerIpcHandlers(opts):
ipcMain.handle(Channels.AppGetRuntimeInfo, (_evt, payload) =>
  handleAppGetRuntimeInfo(payload ?? {}, {
    getUptime: () => process.uptime(),
    getMemoryUsage: () => process.memoryUsage().heapUsed,
  }),
);
```

### 5. Expose in the preload

Edit [`src/preload/index.ts`](../src/preload/index.ts) — find the `app:` group inside the `pdfApi` object and add the method:

```ts
app: {
  // ...existing...
  getRuntimeInfo: () => ipcRenderer.invoke(Channels.AppGetRuntimeInfo),
},
```

### 6. Add to the renderer's typed wrapper

Edit [`src/client/services/api.ts`](../src/client/services/api.ts). The `makeBridgeUnavailableFallback()` function needs a fallback entry for tests where `window.pdfApi` is absent:

```ts
app: {
  // ...existing...
  getRuntimeInfo: unavailable,
},
```

### 7. Consume from a component or thunk

```ts
import { api } from '../services/api';

const res = await api.app.getRuntimeInfo();
if (res.ok) {
  console.log('Uptime:', res.value.uptime);
} else {
  // toast based on res.error variant
}
```

### Quick checklist

When you add a channel, you touch six files:

- [ ] `src/ipc/contracts.ts` — types, `Channels` registry, `PdfApi` interface
- [ ] `src/ipc/handlers/<name>.ts` — handler implementation
- [ ] `src/ipc/handlers/<name>.test.ts` — handler unit tests
- [ ] `src/ipc/register.ts` — wires handler to channel with real deps
- [ ] `src/preload/index.ts` — exposes the method on `window.pdfApi`
- [ ] `src/client/services/api.ts` — fallback shape for missing-bridge case

Same six files in the same order. If your channel needs SQLite, wrap the repo access through [`src/main/db-bridge.ts`](../src/main/db-bridge.ts); never let a handler reach into Ravi's repos directly.

---

## Adding a new `EditOperation` variant — worked example

This is the other most common task post-Phase 2. New op kinds extend the edit-replay engine; you touch both the renderer (state + history) and main (op handler + IPC). Use the existing `text-replace` variant as a reference if you want a worked path through the code.

### Touch-point checklist

| # | File | Why | Owner |
|---|---|---|---|
| 1 | `docs/data-models.md` §7.1 | Add the new variant to the `EditOperation` discriminated union | Riley (data-models is frozen; flag for amendment via Marcus) |
| 2 | `docs/data-models.md` §7.1.3 | Add forward + reverse inverse rows. The Wave 8.5 lesson: asymmetric inverse tables hide ship-blockers — both directions required. | Riley (frozen; amendment flag) |
| 3 | `src/ipc/contracts.ts` | Add the variant to the `EditOperation` union (TypeScript mirror of data-models §7.1). If the variant requires a NEW IPC channel (e.g. `pdf:replaceText`), define the request/response types here. | David |
| 4 | `src/main/pdf-ops/replay-engine.ts` | Add an `apply<Variant>(...)` handler that mutates the in-progress `PDFDocument`. Wire into the `applyOp` dispatcher's switch statement. | David |
| 5 | `src/main/pdf-ops/replay-engine.test.ts` | Tests: (a) forward apply, (b) round-trip with delete-then-insert, (c) error path with `op_apply_failed`. Use width-tagged fixture PDFs for byte-stable assertions (pdf-lib's `useObjectStreams: true` compresses content streams, so byte-grep is unreliable). | David |
| 6 | `src/client/state/slices/document-slice-apply.ts` | Add a renderer-side branch in `applyOperationToDocument`. Variants that DON'T mutate the PageModel (e.g. text-replace, image overlays) get an empty case with an explicit `// PRESENTATIONAL — main engine resolves at save` comment. | Riley |
| 7 | `src/client/state/slices/document-inverses.ts` | Add an `inverseOf` branch. Both directions if the variant produces or consumes a `delete`/`insert` pair (image-insert variant inverse is `delete`; the inverse of THAT delete must round-trip back to `image-insert`, not generic `insert` — Wave 8.5 B-2 lesson). | Riley |
| 8 | `src/client/state/middleware/history-middleware.ts` | If the new variant carries `Uint8Array` (image bytes), add a `compactImageOpForHistory`-equivalent compaction to keep the redux store under conventions §10's ban. The Wave 8.6 two-state model (raw on dispatch, compacted in storage) is the contract. | Riley |
| 9 | Renderer UI affordance | Wire a toolbar button, menu item, shortcut, or modal that dispatches the new op via `applyEdit(...)`. Add to `use-app-shortcuts.ts` if it's a shortcut. | Riley |
| 10 | Round-trip test | `src/client/state/slices/document-inverses.test.ts` — dispatch the op, dispatch its inverse, assert the next state matches the initial state. The Wave 8.5 lesson: image-bearing variants need an explicit byte-presence assertion on the inverse dispatch (not just shape equality). | Riley |

### What's "presentational" vs "model-mutating"

The renderer's `PageModel` represents the page tree as the user sees it. Page-structure ops (rotate, delete, insert, reorder) mutate `PageModel` directly so the thumbnail strip and viewer reflect the edit immediately. Op kinds like `text-replace` and `image-overlay` are **presentational at the renderer** — they don't mutate `PageModel`; instead the renderer's canvas overlay reads from `dirtyOps` until the next save round-trip. The engine resolves them at save time.

### How to test a new variant

Three layers of test coverage:

1. **Engine forward-apply** (`replay-engine.test.ts`) — fixture PDF → apply op → assert structural property (page count, page width, rotation, etc.).
2. **Engine round-trip with inverse** (`replay-engine.test.ts`) — fixture PDF → apply op → apply inverse → assert engine produces a PDF structurally identical to the original.
3. **Renderer round-trip** (`document-inverses.test.ts`) — dispatch action → dispatch undo → assert state matches initial, with explicit byte-presence assertions for image-bearing variants.

---

## Adding a new form field type — worked example

Phase 3 ships six field types (text, checkbox, radio, dropdown, date, signature). Adding a seventh (e.g. a Phase 3.1 list-box, an explicit numeric-text variant, or a Phase 4 signed-signature flavor) follows a fixed pattern. Use the existing **date** field — which is a text field with a `/TU` marker rather than a distinct PDF construct — as the closest reference path; **signature** is the inverse reference path for variants needing manual PDFDict authorship.

### Touch-point checklist

| # | File | Why | Owner |
|---|---|---|---|
| 1 | [`docs/data-models.md` §8.1](data-models.md#8-phase-3-additions) | Extend the `FormFieldType` union (e.g. add `'listbox'`) and the `FormFieldValue` discriminated union if the new type carries a distinct value shape. | Riley (data-models frozen; flag for amendment via Marcus) |
| 2 | [`docs/form-engine.md` §3.4](form-engine.md#34-createfield) | Document the create-path branch for the new type — high-level pdf-lib API vs manual PDFDict authorship. | Riley (form-engine frozen; flag for amendment via Marcus) |
| 3 | `src/ipc/contracts.ts` | Mirror the data-models §8.1 union extension. The renderer gatekeeper at [`src/client/types/ipc-contract.ts`](../src/client/types/ipc-contract.ts) re-exports automatically; no manual edit needed there. | David |
| 4 | `src/db/types.ts` | Mirror the same union extension. Per conventions §4.3 the db and IPC layers maintain structurally-identical types via the shared spec, not via a shared module (no deep cross-process imports). | Ravi |
| 5 | [`src/main/pdf-ops/form-engine.ts`](../src/main/pdf-ops/form-engine.ts) | Add a `case '<type>':` branch in `createField`, `applyValueToField` (used by `fillForm`), and `extractFieldDefinition` (used by `detectForms`). For types that map to a pdf-lib high-level construct (text / checkbox / radio / dropdown), wire to the existing helper. For types that need a manual PDFDict (like `signature`), extend [`field-dict-authoring.ts`](../src/main/pdf-ops/field-dict-authoring.ts) with a `createXxxPlaceholder()` function. | David |
| 6 | `src/main/pdf-ops/form-engine.test.ts` | Tests: (a) create round-trip — author the field, save, reload, assert it's detected with the right `FormFieldType`, (b) fill round-trip — fill a value, save, reload, assert `/V` carries the expected representation, (c) value-validation — assert the right `'field_type_mismatch'` / `'invalid_field_definition'` errors for malformed inputs. | David |
| 7 | `src/client/state/slices/forms-slice.ts` | If the new type carries renderer-side transient state distinct from existing types (e.g. a multi-select listbox needs `selectedOptions: string[]` instead of `selectedValue: string`), extend the slice's `values` shape. Most variants map cleanly to existing FormFieldValue shapes and don't need slice changes. | Riley |
| 8 | `src/client/components/form-designer/` and `src/client/components/form-fill-overlay/` | UI affordances: a new entry in the field-type selector (designer mode), a new render branch in the fill overlay, inspector property rows for any type-specific config. | Riley |
| 9 | [`docs/user-guide.md`](user-guide.md) | Add the new type to the "Field types supported" table under [Working with forms](user-guide.md#field-types-supported). | Nathan |
| 10 | [`docs/api-reference.md`](api-reference.md) | Update the `FormFieldDefinition` referenced under `forms:designAdd` if the union changed at the wire surface. | Nathan |

### What's "high-level pdf-lib API" vs "manual PDFDict"

pdf-lib exposes high-level constructors for `PDFTextField`, `PDFCheckBox`, `PDFRadioGroup`, `PDFDropdown`, and `PDFOptionList`. These cover the common case — text / checkbox / radio / dropdown / list-box. Date in Phase 3 piggybacks on text (the `/TU` tooltip carries a `(date)` marker; the in-app date picker is renderer-side only — Acrobat shows the field as text).

For anything else (signature being the canonical Phase 3 example), pdf-lib has no constructor and you author the field dict + widget annotation by hand via the patterns in [`field-dict-authoring.ts`](../src/main/pdf-ops/field-dict-authoring.ts) — see [`form-engine.md §3.7`](form-engine.md#37-signature-placeholder-authorship-manual-pdfdict-path) for the worked example.

If your new type **could** use pdf-lib's API but the PDF spec requires field-dict tweaks beyond what pdf-lib exposes (e.g. setting a specific `/Ff` flag bit, or attaching a custom `/MK` appearance characteristics dict), do the high-level construction first, then mutate the underlying `pdfField.acroField` dict to add the extras. Don't fork into pure manual-dict construction if the high-level path already gets you 90% of the way — that path duplicates the appearance-stream + widget-annotation work pdf-lib already does.

### Honesty obligation for the new field type

Phase 3's H-3 honesty obligation (see [`user-guide.md` → status banner](user-guide.md#forms-sidebar-status-banner--three-honesty-warnings)) requires that any per-field behavior that differs across viewers is documented. If your new field type:

- Renders differently in Acrobat than in the app (like Phase 3's date field — date-picker in-app, text input in Acrobat), document the renderer-vs-PDF asymmetry in the user-guide field-type table.
- Triggers a save-time strip or rewrite (like signature fields with `/V`, which Phase 3 drops), document it as a status-banner row.
- Cannot be authored cross-PDF (e.g. requires a specific font that not all documents carry), document it under "Form-template fields whose font/size aren't available …" in the limitations table.

The trust-floor pattern: the user reads the warning before saving, knows exactly what will land on disk, and makes an informed choice. Don't ship a field type whose save-time behavior isn't documented up-front.

---

## Adding a new Redux slice

Same pattern as existing slices in [`src/client/state/slices/`](../src/client/state/slices/). The minimum:

1. Create `src/client/state/slices/<name>-slice.ts` with `createSlice({ name, initialState, reducers })`.
2. Create `src/client/state/slices/<name>-selectors.ts`. Plain projections are arrow functions; derived values use `createSelector` from `@reduxjs/toolkit`.
3. Register the reducer in [`src/client/state/store.ts`](../src/client/state/store.ts).
4. Write tests in `<name>-slice.test.ts` (dispatch actions, assert next state) and `<name>-selectors.test.ts` (assert reference-equality on repeat calls).

### Parameterized selectors — the H-2 lesson

If your selector takes a runtime argument (e.g. "annotations for page N"), **do not write a factory**. The pattern that defeats memoization is:

```ts
// WRONG — factory returns a fresh createSelector per call,
// useAppSelector(selectAnnotationsForPage(props.index)) re-runs every render
export const selectAnnotationsForPage = (pageIndex: number) =>
  createSelector([selectAnnotations], (annotations) =>
    annotations.filter(a => a.pageIndex === pageIndex)
  );
```

Write a parameterized selector instead:

```ts
// RIGHT — parameterized createSelector with (state, arg) signature
const selectPageIndexArg = (_state: RootState, pageIndex: number) => pageIndex;

export const selectAnnotationsForPage = createSelector(
  [selectAnnotations, selectPageIndexArg],
  (annotations, pageIndex): AnnotationModel[] =>
    annotations.filter(a => a.pageIndex === pageIndex),
);

// Consumer:
// useAppSelector(s => selectAnnotationsForPage(s, props.index))
```

Every parameterized selector must carry at least one Vitest case asserting reference-equality on repeat calls: `selector(state, arg) === selector(state, arg)`.

---

## IPC contract reference card (Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6 channels)

Cross-link: full request/response details with error variants live in [`api-reference.md`](api-reference.md#phase-2-channels). The contract module is [`src/ipc/contracts.ts`](../src/ipc/contracts.ts).

### Phase 2 channels

| Channel | Direction | Request | Response | Status |
|---|---|---|---|---|
| `fs:applyEditOps` | R → M | `{ handle, ops, annotations, outputPath?, destinationToken?, engine? }` | `Result<{ bytesWritten, newFileHash, annotationRefAssignments, warnings }, FsApplyEditOpsError>` | LIVE — replay-engine entry point |
| `pdf:embedImage` | R → M | `{ handle, image: { bytes, mimeType, width, height }, placement }` | `Result<{ op, contentHash, warnings }, PdfEmbedImageError>` | LIVE — PNG/JPEG/TIFF (first page); content-hash dedup |
| `pdf:replaceText` | R → M | `{ handle, pageIndex, objectId, newText }` | `Result<{ op, willClip, overflowPt? }, PdfReplaceTextError>` | LIVE — replace-only; `clipped` + `missing_glyph` failure modes |
| `pdf:identifyTextSpan` | R → M | `{ handle, pageIndex, x, y }` | `Result<{ objectId, runBoundingRect, currentText, font }, PdfIdentifyTextSpanError>` | LIVE channel; scanner returns `no_text_at_point`; real content-stream walker is Phase 4 absorb |
| `pdf:print` | R → M | `{ handle, ops, annotations, printerName?, pageRange?, options? }` | `Result<{ jobDispatched, engineUsed, warnings }, PdfPrintError>` | LIVE — Electron `webContents.print()` dispatch |
| `pdf:export` | R → M | `{ handle, preference: 'auto' \| 'pdf-lib' \| 'chromium', flattenForms? }` | `Result<{ engine, reason, forcedBy, warnings, outputBytes }, PdfExportError>` | LIVE — both engines; Phase 3 added `flattenForms?: boolean` additive field |
| `bookmarks:listTree` | R → M | `{ fileHash }` | `Result<{ tree: BookmarkNode[] }, BookmarksListTreeError>` | LIVE |
| `bookmarks:move` | R → M | `{ id, newParentId, newSortOrder }` | `Result<{}, BookmarksMoveError>` | LIVE |
| `bookmarks:rename` | R → M | `{ id, title }` | `Result<{}, BookmarksRenameError>` | LIVE |

### Phase 3 channels

| Channel | Direction | Request | Response | Status |
|---|---|---|---|---|
| `forms:detect` | R → M | `{ handle }` | `Result<{ fields, hasAcroForm, hasXfaForm, hasJavaScriptActions, warnings }, FormsDetectError>` | LIVE |
| `forms:fill` | R → M | `{ handle, fieldName, value }` | `Result<{ fieldName, normalizedValue, warnings }, FormsFillError>` | LIVE — validates value; commit boundary produces the EditOperation |
| `forms:flatten` | R → M | `{ handle }` | `Result<{ op, flattenedFieldCount, warnings }, FormsFlattenError>` | LIVE — returns `form-flatten` EditOperation |
| `forms:designAdd` | R → M | `{ handle, fieldDefinition }` | `Result<{ op, normalizedFieldDefinition, warnings }, FormsDesignAddError>` | LIVE — clamps rect to page bounds |
| `forms:designRemove` | R → M | `{ handle, fieldName }` | `Result<{ op, warnings }, FormsDesignRemoveError>` | LIVE — op carries full `before` for inverse |
| `forms:listTemplates` | R → M | `{}` | `Result<{ items: FormTemplateListItem[] }, FormsListTemplatesError>` | LIVE — summary only (id, name, fieldCount, dates) |
| `forms:saveTemplate` | R → M | `{ handle, name, fields, columnMappings? }` | `Result<{ id, warnings }, FormsSaveTemplateError>` | LIVE — `name_in_use` on duplicate |
| `forms:loadTemplate` | R → M | `{ templateId }` | `Result<{ id, name, fields, lastColumnMappings }, FormsLoadTemplateError>` | LIVE |
| `forms:runMailMerge` | R → M | `{ job: MailMergeJob }` | `Result<{ jobId, outputPath, rowsWritten, totalRows, wasCancelled, warnings }, FormsRunMailMergeError>` | LIVE — streams `mail-merge:progress` |
| `forms:runMailMerge:cancel` | R → M | `{ jobId }` | `Result<{}, 'job_not_found'>` | LIVE — flips cancelRequested flag |
| `mail-merge:progress` | M → R (event) | — | `{ jobId, phase, currentRow, totalRows, percent, latestWarning? }` | LIVE — subscribe via `window.pdfApi.events.onMailMergeProgress(h)` |

**`MailMergeJob` includes the Phase 3.1 (Wave 13.5) `flattenForms?: boolean` field** — when `true`, each per-row fill output is `form.flatten()`-ed before the atomic write, producing non-interactive PDFs. Renderer-side this is the wizard step 4 "Flatten forms in output" checkbox.

### Phase 4 channels — `signatures:*` + `annotations:*`

Phase 4 adds 10 IPC channels under two new namespaces plus `fs:readBytesByHandle` (Phase 4.1). All channels are LIVE in 0.4.2 end-to-end after the Phase 4.1 B-17.1 closure. Full contract types at [`api-contracts.md §14`](api-contracts.md) (Phase 4) and [`api-contracts.md §15`](api-contracts.md) (Phase 4.1).

| Channel | Direction | Request | Response | Status |
|---|---|---|---|---|
| `signatures:certLoad` | R → M | `{ pfxBytes, password }` | `Result<{ handle, subjectCN, issuerCN, notBefore, notAfter, fingerprint, isExpired }, SignaturesCertLoadError>` | LIVE — Buffer-wraps password ≤5 lines; zero-on-finally |
| `signatures:certRelease` | R → M | `{ handle }` | `Result<{ released }, 'invalid_payload'>` | LIVE — idempotent |
| `signatures:applyVisual` | R → M | `{ handle, placement, appearance }` | `Result<{ op, warnings }, SignaturesApplyVisualError>` | LIVE — placeholder OR freeform |
| `signatures:applyPades` | R → M | `{ handle, placement, certHandle, appearance, tsaUrl, reason?, location?, placeholderSize?, autoRelease? }` | `Result<{ op, auditLogRowId, signerSubjectCN, certFingerprint, signedAt, tsaResponseStatus, warnings }, SignaturesApplyPadesError>` | LIVE end-to-end (B-17.1 closed) — `node-signpdf` primary; manual fallback via `signatures.padesEngine='manual'` |
| `signatures:requestTimestamp` | R → M | `{ tsaUrl, hash, timeoutMs? }` | `Result<{ tsrBytes, tsTokenBytes, genTime, serialNumber }, SignaturesRequestTimestampError>` | LIVE — hand-rolled DER over node:https |
| `signatures:verify` | R → M | `{ handle, auditLogRowId }` | `Result<{ valid, tamperedSinceSign, certInfo, tsaInfo }, SignaturesVerifyError>` | LIVE — informational; NOT trust-chain validation |
| `signatures:listAudit` | R → M | `{ fileHash?, signedByFingerprint?, since?, until?, limit?, offset? }` | `Result<{ items: SignatureAuditItem[], total }, SignaturesListAuditError>` | LIVE — reads `signature_audit_log` (schema v4) |
| `annotations:addShape` | R → M | `{ handle, annotation: ShapeAnnotationModel }` | `Result<{ op, warnings }, AnnotationsAddShapeError>` | LIVE — covers all 7 subtypes (Square/Circle/Polygon/PolyLine/Line/FreeTextCallout + Line/PolyLine with /Measure) |
| `annotations:setMeasureCalibration` | R → M | `{ handle, calibration: { unit, customUnitLabel?, scale } }` | `Result<{}, AnnotationsSetMeasureCalibrationError>` | LIVE — per-doc in-memory store |
| `annotations:getMeasureCalibration` | R → M | `{ handle }` | `Result<{ calibration: MeasureCalibration \| null }, 'handle_not_found'>` | LIVE |
| **`fs:readBytesByHandle`** | R → M | `{ handle: DocumentHandle }` | `Result<{ bytes: Uint8Array }, FsReadBytesByHandleError>` | LIVE (Phase 4.1) — never accepts a path; renderer cannot escalate to disk |

### Phase 5 channels — `ocr:*` + `scan:*`

Phase 5 adds 9 IPC channels under two new namespaces plus 2 event streams. All `ocr:*` channels are LIVE end-to-end in 0.5.0; `scan:*` returns `not_implemented_phase_5_1`. Full contract types at [`api-contracts.md §16`](api-contracts.md).

| Channel | Direction | Request | Response | Status |
|---|---|---|---|---|
| `ocr:detectLanguages` | R → M | `{}` | `Result<{ installed: LanguagePack[]; downloadable: LanguagePackCatalogEntry[]; defaultLang: string }, OcrDetectLanguagesError>` | LIVE |
| `ocr:runOnPage` | R → M | `{ handle, pageIndex, langs, preprocess, invalidatesSignaturesConfirmed? }` | `Result<{ pageResult, durationMs }, OcrRunOnPageError>` | LIVE — short-running; no progress events |
| `ocr:runOnDocument` | R → M | `{ handle, pageRange, langs, preprocess, invalidatesSignaturesConfirmed? }` | `Result<{ jobId, summary, op }, OcrRunOnDocumentError>` | LIVE — streams `ocr:progress` |
| `ocr:cancelJob` | R → M | `{ jobId }` | `Result<{ cancelled, pagesCompleted }, OcrCancelJobError>` | LIVE — graceful (between pages); idempotent |
| `ocr:listJobs` | R → M | `{ filters?, limit?, offset? }` | `Result<{ jobs, total }, 'invalid_payload'>` | LIVE |
| `ocr:languagePackDownload` | R → M | `{ lang }` | `Result<{ pack }, OcrLanguagePackDownloadError>` | LIVE — SHA-256 verified; streams `ocr:languagePackDownload:progress`. **v0.5.0 ships English-only; non-English rows fail with `pack_integrity_failed` until Phase 5.1.x catalog-builder lands.** |
| `ocr:languagePackRemove` | R → M | `{ lang }` | `Result<{ removed }, OcrLanguagePackRemoveError>` | LIVE — refuses to remove bundled `eng` (`cannot_remove_bundled`) |
| `scan:listDevices` | R → M | `{}` | `Result<never, 'not_implemented_phase_5_1'>` | STUB — Phase 5.1 |
| `scan:acquire` | R → M | `{ deviceId?, resolution?, colorMode? }` | `Result<never, 'not_implemented_phase_5_1'>` | STUB — Phase 5.1 |
| `ocr:progress` | M → R (event) | — | `OcrProgressEvent` — `{ jobId, phase, ... }` | LIVE — subscribe via `window.pdfApi.ocr.onProgress(h)` |
| `ocr:languagePackDownload:progress` | M → R (event) | — | `OcrLanguagePackDownloadProgressEvent` | LIVE — subscribe via `window.pdfApi.ocr.onLanguagePackDownloadProgress(h)` |

**Phase 5 setting keys added in schema v5** (see [`data-models.md §10`](data-models.md) and [`src/db/types.ts:381`](../src/db/types.ts) `SettingKey`):

```ts
type SettingKey =
  // ...P1+P2+P3+P4 keys...
  | 'ocr.defaultLang'                       // string; default 'eng'
  | 'ocr.lowConfidenceThreshold'            // number 0..100; default 60 (P5-L-6)
  | 'ocr.rasterDpi'                         // number 72..600; default 300
  | 'ocr.maxConcurrentLanguages'            // number 1..8; default 4 (LRU eviction)
  | 'ocr.workerWatchdogSec'                 // number 10..600; default 60 (per-page timeout)
  | 'ocr.preprocess.deskew'                 // boolean; default true
  | 'ocr.preprocess.denoise'                // boolean; default false
  | 'ocr.preprocess.contrastBoost'          // boolean; default false
  | 'ocr.denoise.kernel'                    // number 3..9 (odd); default 3
  | 'ocr.showConfidenceOverlayByDefault'    // boolean; default false
  | 'ocr.confirmInvalidateSignaturesOnce';  // boolean; default false (per-session only; see conventions §16.5)
```

**New EditOperation variants** in Phase 5 (mirrored across `data-models.md §10.3` + `src/ipc/contracts.ts`):

- `ocr-text-behind-applied` — produced by `ocr:runOnDocument` / `ocr:runOnPage` on success
- `ocr-text-behind-removed` — inverse for undo (drops the BT/ET blocks the prior op added)

Phase 1–4 channels remain unchanged. See [`api-reference.md`](api-reference.md) for the full reference card.

### Phase 6 channels — `export:*` + `dialog:pickExportOutputPath`

Phase 6 adds 8 new IPC channels under the new `export:*` namespace plus 1 dialog channel and 1 event stream. Full contract types at [`api-contracts.md §17`](api-contracts.md#17-phase-6-additions-2026-05-27-riley).

| Channel | Direction | Request | Response | Status |
|---|---|---|---|---|
| `export:toDocx` | R → M | `{ handle, pageRange, qualityTier, includeAnnotations, pageSize, outputPath }` | `Result<{ jobId, summary: ExportJobSummary }, ExportToDocxError>` | **LIVE engine; LIVE-pending source-loader wire** — engine runs end-to-end against synthetic data; production `createProdSourceLoader` is a typed-throwing stub (Julian M-25.4; David Wave 25.1 wires) |
| `export:toXlsx` | R → M | `{ handle, pageRange, qualityTier, includeAnnotations, outputPath }` | `Result<{ jobId, summary }, ExportToXlsxError>` | **LIVE end-to-end** — Diego Wave 25 packaged-binary evidence at `release/wave-25-v060-xlsx-output.xlsx` (7097 bytes, ZIP signature 504b0304, 2 sheets readable via exceljs) |
| `export:toPptx` | R → M | `{ handle, pageRange, qualityTier, includeAnnotations, outputPath }` | `Result<{ jobId, summary }, ExportToPptxError>` | LIVE engine; LIVE-pending source-loader wire (same gap as docx) |
| `export:toImages` | R → M | `{ handle, pageRange, format: 'png'\|'jpeg'\|'tiff', dpi, jpegQuality?, multiPageTiff?, includeAnnotations, outputPath }` | `Result<{ jobId, summary, outputPaths }, ExportToImagesError>` | LIVE engine; LIVE-pending source-loader wire (same gap) |
| `export:cancelJob` | R → M | `{ jobId }` | `Result<{ cancelled, pagesCompleted }, ExportCancelJobError>` | LIVE — graceful (between per-page steps); idempotent; partial output unlinked via atomic `.export-temp` cleanup |
| `export:listJobs` | R → M | `{ filters?, limit?, offset? }` | `Result<{ jobs: ExportJobRowDto[], total }, 'invalid_payload'>` | LIVE — feeds Exports sidebar tab |
| `export:listFormats` | R → M | `{}` | `Result<{ formats: ExportFormatDescriptor[] }, 'never'>` | LIVE — static catalog (no DB read); 6 entries (docx / xlsx / pptx / png / jpeg / tiff) |
| `dialog:pickExportOutputPath` | R → M | `{ defaultBasename, format }` | `Result<{ outputPath: string \| null }, 'invalid_payload'>` | LIVE — Electron native save-as; default extension derived from format |
| `export:progress` | M → R (event) | — | `ExportProgressEvent` — `{ jobId, format, phase, ... }` | LIVE — phases: `starting` / `extracting-text` / `detecting-tables` / `extracting-images` / `rasterizing` (image only) / `writing-output` / `completed` / `cancelled` / `failed`. Subscribe via `window.pdfApi.export.onProgress(h)` |

**Error variants** (per channel, channel-specific string-literal unions):

- `ExportTo{Docx,Xlsx,Pptx}Error`: `'invalid_payload'` / `'handle_not_found'` / `'page_range_out_of_range'` / `'output_path_unwritable'` / `'queue_full'` / `'extraction_failed'` / `'writer_failed'` / `'output_write_failed'` / `'cancelled'`
- `ExportToImagesError`: `'invalid_payload'` / `'handle_not_found'` / `'page_range_out_of_range'` / `'output_path_unwritable'` / `'queue_full'` / `'rasterize_failed'` / `'encode_failed'` / `'output_write_failed'` / `'cancelled'`
- `ExportCancelJobError`: `'invalid_payload'` / `'job_not_found'` / `'job_already_terminal'`

**Phase 6 setting keys added in schema v6** (see [`data-models.md §11.6`](data-models.md) and [`src/db/types.ts:502-518`](../src/db/types.ts) `SettingKey`):

```ts
type SettingKey =
  // ...P1+P2+P3+P4+P5 keys...
  | 'export.docx.qualityTier'                // 'text-only' | 'layout-preserving'; default 'layout-preserving' (Q-D)
  | 'export.docx.pageSize'                   // 'letter' | 'a4' | 'auto'; default 'auto'
  | 'export.docx.includeAnnotations'         // boolean; default true
  | 'export.xlsx.qualityTier'                // 'text-only' | 'layout-preserving'; default 'text-only' (Q-D)
  | 'export.xlsx.includeAnnotations'         // boolean; default false
  | 'export.pptx.qualityTier'                // 'text-only' | 'layout-preserving'; default 'layout-preserving' (Q-D)
  | 'export.pptx.includeAnnotations'         // boolean; default true
  | 'export.image.format'                    // 'png' | 'jpeg' | 'tiff'; default 'png'
  | 'export.image.dpi'                       // number 72..600; default 150
  | 'export.image.jpegQuality'               // number 0.1..1.0; default 0.9
  | 'export.image.multiPageTiff'             // boolean; default false
  | 'export.image.includeAnnotations'        // boolean; default true
  | 'export.layout.lineEpsilonPt'            // number; default 2 (paragraph clustering)
  | 'export.layout.paragraphBreakRatio'      // number; default 1.5
  | 'export.layout.headingRatio'             // number; default 1.3
  | 'export.layout.columnGapPt'              // number; default 40
  | 'export.maxQueueSize';                   // number; default 50 (Phase 6.1 ExportQueue uses same cap)
```

**Phase 6 schema v6 amendments** (additive only):

| Table | Change |
|---|---|
| `export_jobs` | NEW — per-job state (`format`, `quality_tier`, `page_range_*`, `dpi`, `jpeg_quality`, `multi_page_tiff`, `output_path`, `output_size_bytes`, `status`, `started_at`, `completed_at`, `duration_ms`, `pages_processed`, `paragraphs_extracted`, `tables_detected`, `images_embedded`, `error_message`, `created_at`). Three indexes on `doc_hash` / `status` / `format`. Nullable fields throughout (anti-sentinel: NULL means "not yet" or "not applicable to this format") |
| `settings` | 17 INSERT OR IGNORE rows for per-format defaults (see setting keys above). NO column changes |
| All Phase 1-5 tables | UNCHANGED — Phase 6 is read-only on the source PDF; no new column on any prior table (cross-checked against P6-L-9) |

**EditOperation union** — **NOT extended in Phase 6.** Export does not produce an edit; the `EditOperation` discriminated union is frozen by Phase 6. The replay engine is unchanged.

**Phase 4 setting keys added in schema v4** (see [`data-models.md §9.9`](data-models.md)):

```ts
type SettingKey =
  // ...P1+P2+P3 keys...
  | 'signatures.tsaUrl'                   // string; default ''
  | 'signatures.tsaEnabled'               // boolean; default false (P4-L-2)
  | 'signatures.tsaTimeoutMs'             // number; default 30000
  | 'signatures.placeholderSize'          // number (/Contents hex chars); default 16384
  | 'signatures.defaultShowDate'          // boolean; default true
  | 'signatures.defaultShowSubjectCN'     // boolean; default true (PAdES only)
  | 'signatures.padesEngine'              // 'signpdf' | 'manual'; default 'signpdf' (P4-L-3)
  | 'annotations.defaultBorderWidth'      // number, pt; default 1
  | 'annotations.defaultBorderStyle'      // 'solid' | 'dashed' | 'dotted'; default 'solid'
  | 'annotations.defaultFillEnabled'      // boolean; default false
  | 'annotations.defaultLineEndStyle';    // 'None' | 'OpenArrow' | 'ClosedArrow'; default 'OpenArrow'
```

**New EditOperation variants** in Phase 4 (mirrored across `data-models.md §9.5` + `src/ipc/contracts.ts`):

- `signature-visual-place` — produced by `signatures:applyVisual`
- `signature-pades-applied` — produced by `signatures:applyPades`; NOT undoable (the cryptographic envelope is final)
- `annot-add-shape` — produced by `annotations:addShape`
- `annot-edit-shape` — produced by Inspector edits to shape annotations
- `annot-delete-shape` — produced by Delete on a selected shape annotation

Phase 1 channels (`dialog:*`, `fs:readPdf`, `fs:writePdf`, `fs:closePdf`, `recents:*`, `settings:*`, `bookmarks:list`/`upsert`/`delete`, `pdf:combine`, `pdf:getOutline`, `app:*`, `window:*`) are unchanged. See [`api-reference.md`](api-reference.md) for the full reference card.

---

## Common pitfalls

### Structural engineering discipline — the six ratchets

Over seven phases the swarm converted six recurring, expensive failure modes from "remember not to do this" into **structural barriers** — type-system, schema, lint-rule, or required-on-interface constraints that fail the build (or fail loudly at runtime) rather than rotting silently. Julian's Wave 29 review confirmed all six held for the **sixth consecutive wave**. This is the project's hard-won engineering-discipline section; read it before adding any new feature surface.

| # | Ratchet | The failure it prevents | How it's enforced | Reference |
|---|---|---|---|---|
| 1 | **No permissive test stubs** | A handler's test injects a no-op / passthrough fake (`sanitizePath: (r) => r`) that accepts inputs the real production function rejects → CI green, production 100% broken | Tests for DI'd handlers inject the **real** sanitizer/writer/byte-producer; stub only at the OS/SQL/clock boundary. Compare test-deps vs `register.ts` line-by-line. | [Permissive test stubs](#permissive-test-stubs-mask-production-failures) |
| 2 | **No sentinel defaults** | `pageCount: -1` / `width: 612` / `lastCheckedAt: 0` silently consumed downstream (a `0` renders "Jan 1 1970" in the About modal) | **Nullable + late-init** (`T | null`), never a sentinel. Consumers pattern-match `null` for the "not yet" state. Phase 7: `availableVersion`, `lastCheckedAt`, `lastEventAt` all `T | null`; migration seeds `update.lastCheckedAt = null`. | [Stubs-shipped-with-TODO](#stubs-shipped-with-todo-comments-become-structural-debt-invisible-to-typecheck--mock-cover) |
| 3 | **No stub-with-TODO past a wave boundary** | A `// TODO: next wave wires this` stub returns a sentinel; typecheck + mocked consumer tests pass; only the packaged binary on a real doc reveals the break | If a dep MUST be provided in production, make it **REQUIRED on the interface** (no optional + fallback). The type system fails the wave that ships without wiring it. Phase 7: telemetry `transport` + auto-update/telemetry injected options are required. | [Stubs-shipped-with-TODO](#stubs-shipped-with-todo-comments-become-structural-debt-invisible-to-typecheck--mock-cover) |
| 4 | **No code-comment contradictions** | The comment says X but the type system silently drops X (the Wave-21 `renderMode`-cast-on-`drawText` trap; an `as any` masking a dropped library option) | Verify the code achieves what the comment claims; library options go through **typed adapters** (the library-injection pattern), not `as any`. Phase 7: zero `as any` on `t()`, telemetry, or the auto-update controller. | [Code-comment contradictions](#code-comment-contradictions-when-the-comment-says-x-but-the-type-system-drops-x) |
| 5 | **No layout/best-effort claims without visual proof** | A doc or test asserts "the layout converts faithfully" / "the binary launches" without pixels-on-screen evidence | L-002 visual verification (operator-level screenshot of the running binary) is the last-line check; process-metadata is the floor, not the ceiling. Phase 7: Diego's Wave 29 pixel-level launch + Settings + live-Spanish-switch + About screenshots. | `.learnings/locked-instructions.md` L-002 |
| 6 | **Structural PII guard (NEW in Phase 7)** | An "anonymous telemetry" feature leaks PII because the absence of personal data is a *discipline* (a habit) rather than a *property* | Make the absence of PII a **type + schema property**: a `.strict()` zod request schema that rejects any field beyond `{ name, dayBucket }`; an event interface with no PII slot; a silent opt-in gate that returns before buffering; an in-memory transport with no DB table. | [Telemetry framework](#telemetry-framework-phase-7) |

**The trust-floor honesty pattern is the connective tissue across all six.** Every phase that introduced a security-sensitive, cryptographic, destructive, or best-effort capability documented its honesty obligations at the same five-to-six surfaces (top-of-guide preamble + dedicated trust-floor section + inline reminders + README known-limitations + the point-of-action UI). The pattern held for **all seven phases** — H-3 walking-skeleton (Save doesn't preserve edits) → Phase 3 forms (JS-strip / XFA / signed-fields) → Phase 4 PAdES (invalidate / zero-on-finally / no-default-TSA / informational-verify) → Phase 5 OCR (low-confidence / no-cloud / text-becomes-PDF / re-OCR-duplicates) → Phase 6 export (best-effort / borderless-tables / XFA-no-export / signed-source-stays-valid / OCR-determines-fidelity) → **Phase 7 polish (telemetry-OFF-by-default / update-placeholder / mac-linux-unverified / es-ES-sample)**. The doc structure is now mechanical; the obligations are phase-specific. When you add a feature with limitations, copy the structure and swap the obligation list.

### Runtime `require()` of in-tree modules + vite tree-shake + Electron 30 ESM rejection

**This is the most expensive packaging defect class the swarm has paid time on; it is now a SECOND-instance pattern and a top-of-pitfalls promotion candidate. If a third instance appears in Phase 7+, this lesson lands in the `backend-engineer` agent's Hard-Won Playbook as a hard ban on runtime `require()` of in-tree paths.**

The structural failure mode (Phase 6 Wave 25 RCA — `.learnings/failures/2026-05-27-runtime-require-vite-tree-shake-packaging-gap.md`):

A main-process source file uses `require('./relative/path.js')` at module-evaluation time, intending lazy module loading. The code:

```ts
// src/main/index.ts:273 (Phase 6 Wave 24 — runtime require)
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const exportBootstrap = require('./export/export-bootstrap.js') as {
  bootstrapExportEngine: typeof import('./export/export-bootstrap.js').bootstrapExportEngine;
  createProdSourceLoader: typeof import('./export/export-bootstrap.js').createProdSourceLoader;
};
```

1. **Vite tree-shakes** `export-bootstrap.ts` into the main `dist/main/index.js` bundle (everything reachable from a static-import graph gets inlined).
2. **No sibling file** at `dist/main/export/export-bootstrap.js` is emitted.
3. **The runtime require fails ENOENT** when the packaged binary launches: `Cannot find module './export/export-bootstrap.js'`.
4. **The unhandled rejection cascades** to `app.whenReady()` never resolving → main window never created → renderer process never spawned → **3-process Electron family tree** (main + GPU + utility, no renderer). The packaging tooling reports SUCCESS (electron-builder assembles the package without running it); only an L-002 launch screenshot catches the defect.
5. **Even with an emitted ESM sibling, Electron 30 (Node 20) rejects** synchronous `require()` of ESM with `ERR_REQUIRE_ESM`. The `--experimental-require-module` flag is Node 22+.
6. **Even with a CJS-format emit**, the project root `package.json` declares `"type": "module"` which makes Node interpret every `.js` file in the tree as ESM unless overridden by a closer `package.json`. A CJS file in an ESM scope is read as ESM and the same `ERR_REQUIRE_ESM` fires. The emit MUST include a sibling `package.json` declaring `{"type":"commonjs"}` to override the scope for that subdirectory.

**Recommended fix (David Wave 25.1 — proper source-level fix):** Convert the runtime `require()` to a top-level static `import` at the top of [`src/main/index.ts`](../src/main/index.ts), matching the actual OCR-bootstrap precedent at line 60:

```ts
// At top of src/main/index.ts (the right pattern — mirrors ocr-bootstrap):
import { bootstrapExportEngine, createProdSourceLoader } from './export/export-bootstrap.js';
// Then use them directly at the existing line 273 site without the require + assertion shape.
```

This lets vite handle the module graph naturally — the bootstrap can be inlined into the main bundle without needing a separately-emitted sibling file, AND the production code uses a single canonical import pattern instead of an inconsistent mix.

**Diego's safety-net plugin (currently in [`electron.vite.config.ts`](../electron.vite.config.ts)):** Until David's source-level fix lands, the `emitExportBootstrapCjs()` closeBundle plugin esbuild-compiles `src/main/export/export-bootstrap.ts` directly to CJS at `dist/main/export/export-bootstrap.js` and writes a sibling `dist/main/export/package.json` containing `{"type":"commonjs"}` to override the root ESM scope. The plugin is Diego-domain and lives in the vite config so the production build works in the meantime. It is REDUNDANT once David converts the call site to a static import.

**Why this is a SECOND instance (history):**

- **Phase 5 Wave 21 (first instance):** `src/main/pdf-ops/ocr-bootstrap.ts:loadCatalogSync` used `require('./language-pack-catalog.json')`. Vite preserved the require call but did NOT emit the JSON file next to the bundle. Diego fixed it with `vite-plugin-static-copy` in [`electron.vite.config.ts:22-66`](../electron.vite.config.ts). The fix mechanism: copy a JSON file.
- **Phase 6 Wave 25 (second instance):** `src/main/index.ts:273` uses `require('./export/export-bootstrap.js')`. Vite tree-shakes the module INTO the main bundle leaving nothing at the require target. Diego fixed it with the `emitExportBootstrapCjs` closeBundle plugin in [`electron.vite.config.ts`](../electron.vite.config.ts). The fix mechanism: esbuild-compile a CJS bundle + write a sibling `package.json`.

**Root pattern is identical:** runtime `require()` of an in-tree path that vite either doesn't preserve OR preserves with the wrong asset shape. The fix mechanism varies with the target's nature (JSON vs source vs binary), but the root cause is the same.

**Audit pattern:** when you write or review a main-process source file, GREP for `\brequire\s*\(\s*['"]\./` patterns. Any hit is a packaging defect waiting to surface. The correct alternatives:

1. **Static top-level `import`** — the default. Vite has a stable contract: "this is part of the module graph; emit it OR inline it, but never silently delete the path."
2. **`await import('./path.js')`** — dynamic import — if you genuinely need lazy evaluation. Vite emits dynamic imports as separate chunks next to the bundle (the chunking warning printed at every build references this exact behavior). Works against both CJS AND ESM targets under Electron 30's Node 20.
3. **Runtime `require()` of an in-tree path** — NEVER do this. There is no scenario where this is the right choice; static import + dynamic import cover the full surface.

**Where this fix lives (file:line for reference):**

- [`src/main/index.ts:273`](../src/main/index.ts) — the current runtime `require()` site (David Wave 24); awaiting Wave 25.1 conversion to a static import
- [`src/main/index.ts:60`](../src/main/index.ts) — the actual OCR-bootstrap precedent (a top-level static `import`); the David Wave 24 require pattern claimed to "mirror ocr-bootstrap's lazy-load" but actually invented a novel pattern
- [`electron.vite.config.ts`](../electron.vite.config.ts) `emitExportBootstrapCjs` — Diego's safety-net plugin; REDUNDANT once David converts the call site
- [`electron.vite.config.ts:22-66`](../electron.vite.config.ts) — Diego's Phase 5 first-instance fix (`vite-plugin-static-copy` for `language-pack-catalog.json`)
- [`.learnings/failures/2026-05-27-runtime-require-vite-tree-shake-packaging-gap.md`](../.learnings/failures/2026-05-27-runtime-require-vite-tree-shake-packaging-gap.md) — full RCA with symptom + root cause + how L-002 caught it + 3-CI-ratchet promotion candidates

**Promotion ratchet (when the third instance appears):**

1. `~/.claude/agents/backend-engineer.md` Hard-Won Playbook entry: "Prefer static top-level imports for all main-process module loading. Runtime `require()` of in-tree paths is a packaging anti-pattern under Vite/Rollup."
2. `.learnings/locked-instructions.md` as `L-003`: a pre-commit (or CI) check that greps `src/main/**/*.ts` for `\brequire\s*\(\s*['"]\./` and fails the build.
3. ESLint `no-restricted-syntax` rule for `CallExpression[callee.name='require'][arguments.0.value=/^\.\//]` in `src/main/`.

### Node 24 vs Electron 30 ABI

`better-sqlite3` ships Electron-ABI prebuilds and Node-ABI prebuilds in separate channels. The `postinstall` script (`electron-builder install-app-deps`) fetches the Electron prebuild — that's what production needs (the packaged binary runs against Electron's bundled Node ABI, not the host Node ABI). Node-only Vitest runs may fail with `ERR_DLOPEN_FAILED` (or the equivalent `NODE_MODULE_VERSION 123 ... requires NODE_MODULE_VERSION 137` ABI-mismatch error) on hosts that bumped to Node 22+ or Node 24+.

**This has bitten the project across six waves** (13, 21, 24, 28a, 30, and the backlog-fix wave). The pattern is structural — it recurs on every dev host bumped past Node 20 until `better-sqlite3` ships v11.x prebuilds for Node 24+. `better-sqlite3` 11.10.0 publishes prebuilds only up to Node 22 (v131) plus the Electron ABI (v123); Node 24 (v137) has neither, and `node-gyp` fails (Python 3.14 dropped `distutils`). Node 20 (v115) is the **single version where a published prebuild exists AND it matches the CI matrix** — this is why **L-003 makes Node 20 the enforced baseline**.

The fix paths (enforced by `scripts/check-node.mjs`, wired into `pretest`):

- **CI (authoritative):** runs Node 20 LTS; the `check` job runs `npm rebuild better-sqlite3` (fetches the node-v115 prebuild) before the db tests — the latent CI bug fixed in the backlog-fix wave was that it previously only built the Electron ABI (v123), which does not load under plain Node 20. The e2e + build jobs keep `npm run rebuild` (Electron ABI) because they launch/package.
- **Local on Node 20 (recommended):** `nvm use 20 && npm ci && npm test` — both prebuilds present, full suite green, no action needed.
- **Local on Node 24-only (escape hatch):** `node scripts/rebuild-native-for-node.mjs` swaps in the Node-ABI binding from the npm cache (it backs up the current binary first and verify-loads before declaring success — **non-destructive**, never a from-source compile); then `npm test`; then `node scripts/rebuild-native-for-node.mjs --electron` restores the Electron-ABI binary for packaging. The packaging step (`electron-builder install-app-deps`) also re-rebuilds against the Electron ABI before the asar package, so what ships in `release/win-unpacked/` is the correct Electron-ABI binary regardless.
- **Never** run a from-source rebuild on Node 24 — `node-gyp` fails on Python 3.14, and a prior failed rebuild **deleted the working Electron-ABI binding** and corrupted the packaging tree.

To unlock L-003: a `better-sqlite3` release with Node 24 prebuilds (or a migration to a pure-JS / WASM SQLite binding), demonstrated by a green full-suite run on Node 24 without the rebuild script.

### vitest 2.x and Node 24 — why the bump landed in Phase 6 Wave 25

Phase 6 Wave 24 (David) tried to ship a vitest run against Node 24.14.1 and got "No test suite found" for every one of the 138 test files (0 tests collected, 0 passed). The RCA stub at the time pointed at vitest 1.6.x's `tinypool` worker bootstrap silently failing under Node 24's worker_thread API changes.

**Phase 6 Wave 25 (Diego) bumped vitest 1.6.x → 2.1.9.** Post-bump verification: `npm test` against Node 24.14.1 + vitest 2.1.9 → 1520 / 1527 PASS (99.5%); 7 pre-existing or David-domain failures (5 Riley Wave 24 brittle tests + 2 David Phase 6 writer/CTM assertions). None are vitest-API-drift failures.

**What the bump means for you:**

- **CI** runs Node 20 LTS where both vitest 1.6 AND 2.x would work; the bump costs nothing for CI.
- **Local hosts on Node 20:** unchanged.
- **Local hosts on Node 22+ / 24+:** vitest 2.x now works. The "no test suite found" symptom is gone.
- **`.nvmrc`** stays at `20` as defense-in-depth (signals intent to new contributors).
- **`engines.node`** stays at `>=20.10.0` — no upper bound, since vitest 2.x supports Node 24.

The CI workflow comment block documents the rebuild-order requirement explicitly: rebuild for Electron's Node ABI for packaging; tests run under host Node so a single rebuild covers both when host Node == Electron Node, which is the CI case.

**Cross-reference:** the partially-obsolete RCA at [`.learnings/failures/2026-05-27-vitest-node24-discovery-regression.md`](../.learnings/failures/2026-05-27-vitest-node24-discovery-regression.md) — Julian Wave 25 found `node_modules/vitest/package.json` already at 2.1.9 by the time the audit ran (env-state shifted between David's run and the audit); Diego Wave 25 re-pinned the bump in `package.json`.

### L-001 — `enableDragDropFiles` must stay default

`webPreferences.enableDragDropFiles` is `true` by default in Electron, and the drag-drop open flow depends on it. **Do not set it to `false`** in [`src/main/window-manager.ts`](../src/main/window-manager.ts) or [`src/main/print-window.ts`](../src/main/print-window.ts) (the offscreen BrowserWindow used by both print dispatch and the Chromium export engine). The enforcement test [`src/main/window-manager.test.ts`](../src/main/window-manager.test.ts) asserts this and fails CI if you regress. Locked in [`.learnings/locked-instructions.md`](../.learnings/locked-instructions.md) as L-001. Every Phase 2 BrowserWindow construction (offscreen Chromium, print dispatch) reaffirms the floor.

### Renderer-gatekeeper boundary is ESLint-enforced

Direct imports of `src/ipc/contracts` from `src/client/**` are blocked by `no-restricted-imports` in `.eslintrc.cjs`. All contract types route through [`src/client/types/ipc-contract.ts`](../src/client/types/ipc-contract.ts). The gatekeeper file is in `excludedFiles` so its three legitimate re-export imports stay legal. Wave 8.5 H-2 closed this — Wave 7 had a manual catch; Phase 2 makes it mechanical.

If you see an ESLint error pointing at the gatekeeper message, you've added an import of `'../../ipc/contracts'` (any relative-dot variant or future alias). Move the import to `src/client/types/ipc-contract.ts` first, then import from there.

### Discriminated unions with downstream consumers — don't collapse to boolean

When a repo method (e.g. `BookmarksRepo.move()`) returns a discriminated union like `MoveBookmarkResult`, the downstream adapter / bridge / handler MUST preserve the union all the way to the IPC boundary. Collapsing to boolean and re-inferring the variant via a heuristic is the H-1 anti-pattern (Wave 8 BLOCKER + Wave 8.5 fix). See [`src/main/db-bridge.ts`](../src/main/db-bridge.ts) `adaptBookmarksRepo.move()` for the correct pattern — it forwards Ravi's union verbatim. The handler ([`src/ipc/handlers/bookmarks-phase2.ts`](../src/ipc/handlers/bookmarks-phase2.ts) `handleBookmarksMove`) switches on the variant with an exhaustiveness `never`-guard so forgotten future variants fail at compile time.

### History middleware: the dual-store and the `meta.__history` re-entrancy flag

The history middleware does two things that are easy to get wrong:

1. **Two-state model (Wave 8.6 N-1 fix).** Each `HistoryEntry` carries BOTH the compacted op (image bytes zeroed for storage footprint) AND the raw op (bytes intact for dispatch). On undo, the middleware dispatches `entry.rawInv`; on redo, `entry.rawFwd`. Do NOT collapse the two — the compacted-only model breaks image-undo-of-delete (the `embedImage` handler rejects empty bytes). See [`src/client/state/middleware/history-middleware.ts`](../src/client/state/middleware/history-middleware.ts) header doc.
2. **Re-entrancy flag.** When undo dispatches the inverse op, the middleware re-enters. Without `meta.__history: true` on the dispatched inverse, the middleware tries to push the inverse-of-the-inverse and loops infinitely. Pattern documented in `conventions.md` §6.5.

### `text-replace` and image overlay variants are PRESENTATIONAL at the renderer

These variants don't mutate `PageModel`; the engine resolves them at save time. Don't try to render the replacement in the renderer's `PageModel` — the canvas overlay reads from `dirtyOps` until the next save round-trip. Adding a `text-replace` op to `applyOperationToDocument` and trying to update the page text in-place would defeat the round-trip contract.

### `originalBytes` lazy-load in the replay engine

The replay engine parses `originalBytes` into a second `PDFDocument` only when an op needs them (specifically `insert{source.kind:'original'}`). The parsed copy is memoized on `ReplayContext.originalDoc` so a multi-op chain with N original-page inserts incurs only ONE parse cost. Do not eagerly parse the original bytes — the contract is "lazy, memoized, one-per-replay". See [`src/main/pdf-ops/replay-engine.ts`](../src/main/pdf-ops/replay-engine.ts) `applyInsert`.

### Image bytes lifecycle: pass through to IPC, cache by hash in main

Per conventions §10, image bytes don't sit in the Redux store. The renderer ships bytes to main once via `pdf:embedImage`; main hashes them, stores `(contentHash → bytes)` in the per-handle image cache (see [`src/main/pdf-ops/document-store.ts`](../src/main/pdf-ops/document-store.ts)), and returns the `op` shape (containing the `contentHash`) to the renderer. Subsequent re-emits (on undo/redo, on save) carry the full bytes via the two-state history model — main looks up by contentHash on the engine side. The Wave 8.5 Riley contract-observation: don't rely on the renderer to ship bytes; rely on main's cache. The Wave 8.6 N-1 fix made this contract honest end-to-end by ensuring undo dispatches with bytes intact.

### `composite: true` and TS4023 cascades

The Phase 1.1 fix dropped `composite: true` from `tsconfig.renderer.json` — the cascade is closed. If you re-introduce `composite: true` (e.g. for a future project-references setup), the Reselect-5 / composite interaction will surface again on every `createSelector` export that transits a slice boundary. Default to `composite: false` (the TS default) on any renderer-only tsconfig.

### electron-builder rejects `//` keys in package.json

Do not add a `"//": "comment"` key inside the `package.json` `build` block — electron-builder schema rejects unknown keys there. Use a sibling key like `_build_note` or move the config to `electron-builder.yml`.

### Code-comment contradictions — when the comment says X but the type system drops X

This is the Phase 5 Julian H-21.1 finding, promoted to a permanent pitfall. The structural failure mode:

A piece of code wants to do **X**. The developer writes the obvious-looking call with **X** as an option:

```ts
// src/main/pdf-ops/ocr-text-layer.ts (pre-H-21.1 — WRONG)

// We need rendering mode 3 (invisible) so OCR text overlays the image without showing visibly.
page.drawText(word.text, {
  x, y,
  size: fontSize,
  font: helvetica,
  // PDF rendering mode 3 = invisible (per spec § 9.3.6)
  renderMode: 3,  // ← TypeScript accepts; pdf-lib SILENTLY DROPS this key
} as any);
```

The code:
1. Has a comment claiming `renderMode: 3` makes the text invisible.
2. Uses an `as any` cast to silence TypeScript's "renderMode does not exist on PDFPageDrawTextOptions" error.
3. Compiles cleanly. Tests pass (text shows up where expected; word selection works; the test fixtures don't paint the visible rendering, only assert structural properties).
4. **Production fails visibly:** the OCR text paints VISIBLY on top of the scanned image. Users see overlapping text + image. Selection works (because the text IS in `/Contents`, just at rendering mode 0 = fill), but the visual is broken.

**The defect class:** the comment claims behavior `X`; the type system's actual contract drops `X`; the runtime behavior matches the type system (not the comment). The `as any` cast that silenced TypeScript is the load-bearing trap — it made the type system's correct refusal look like a developer-level "I know better" override.

**The fix (per Julian's Wave 21 H-21.1):**

```ts
// src/main/pdf-ops/ocr-text-layer.ts (post-H-21.1 — CORRECT)

import { setTextRenderingMode, TextRenderingMode } from 'pdf-lib';

// Push the rendering-mode-3 operator BEFORE the drawText loop.
page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));

for (const word of pageWords) {
  page.drawText(word.text, {
    x, y,
    size: fontSize,
    font: helvetica,
    // (no renderMode option — invisible is set via the operator push above)
  });
}

// Restore Fill at the end so subsequent draw operations behave normally.
page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
```

This uses pdf-lib's actual API for the rendering-mode operator (`setTextRenderingMode`), which IS in the type surface. The `Tr` operator (`3 Tr` for invisible) gets emitted into the content stream correctly. No `as any`. No silent drop.

**Audit pattern.** When you write or review code that uses a typed library's `as any` cast OR an `// @ts-ignore` directive to suppress a TypeScript error AND the suppression is around a "this option does X" path, treat it as a defect class:

1. **Read the type definition** of the function you're calling. If the option you're passing isn't in the type, that's the type system telling you the option isn't honored — not a bug in the types.
2. **Check the library's documentation** for the actual API to achieve the behavior. Most libraries expose the operation through a different method or constructor; the missing-in-type option is usually a path the library no longer supports.
3. **Test the runtime behavior**, not just the structural properties. If your code says "this text is invisible", a test should `getOperators()` on the page and assert `setTextRenderingMode(Invisible)` is in the stream BEFORE the text-show op — not just "the text is at coordinates X, Y".
4. **Do NOT use `as any` to silence "option does not exist" errors.** That's exactly the trap.

**Other forms of the same defect class to watch for:**

- A comment claiming "this is async" on a function whose return type is `T`, not `Promise<T>`. The await is a no-op; the caller sees stale data.
- A comment claiming "this swallows errors" on a path that has no try/catch. The error throws; the caller sees an unhandled rejection.
- A comment claiming "this writes to disk" on a function whose body only mutates an in-memory `Map`. The data never persists; tests pass because the same `Map` is queried in the same test.
- A comment claiming "this validates the input" on a function whose first line is `// TODO: add validation`. (See the next pitfall — Stubs-shipped-with-TODO.)

**Where the H-21.1 fix lives** (file:line for reference):

- [`src/main/pdf-ops/ocr-text-layer.ts:42`](../src/main/pdf-ops/ocr-text-layer.ts) — `page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible))` before the drawText loop
- [`src/main/pdf-ops/ocr-text-layer.ts:71`](../src/main/pdf-ops/ocr-text-layer.ts) — `page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill))` at the end (restore)
- [`src/main/pdf-ops/ocr-text-layer.test.ts`](../src/main/pdf-ops/ocr-text-layer.test.ts) — 16 tests; the operator-presence assertion is the structural test that would have caught the pre-H-21.1 defect

This sits alongside the existing **Permissive test stubs mask production failures** and **Stubs-shipped-with-TODO comments** pitfalls — three structural failure modes the swarm has paid real time to fix; the code-comment-contradiction is the newest member of the family.

### Stubs-shipped-with-TODO comments become structural debt invisible to typecheck + mock-cover

This is the most expensive **structural** failure mode in the swarm's history — paired with the permissive-test-stub anti-pattern below, but distinct from it. Three Phase 1 stubs bled across 13+ subsequent waves before being root-fixed in Phase 4.1:

1. **`src/ipc/register.ts` `defaultPdfMetadata` returning `pageCount: -1`** — wave 2 left a `// Wave-N will wire the real loader` comment; typecheck passed (`loadPdfMetadata` was OPTIONAL on `RegisterIpcOptions` with a sentinel-returning fallback); every IPC handler test mocked `loadPdfMetadata` to return a real page count; production failed silently with `pageCount: -1` on every open. Closed in Phase 4.1 by deleting the fallback + making `loadPdfMetadata` REQUIRED (non-optional) — see [`src/main/pdf-ops/pdf-metadata-loader.ts`](../src/main/pdf-ops/pdf-metadata-loader.ts) and [`src/ipc/register.ts:115`](../src/ipc/register.ts) (the stub is gone).
2. **`src/client/services/pdf-render.ts` stub** — wave 2 wrote a `getDocument` stub returning fake page data; every consumer test mocked pdf-render at the module boundary; production was a blank canvas. Closed in Phase 4.1 by Riley wiring real `pdfjsLib.getDocument(...)` — see [`pdf-render.ts:165`](../src/client/services/pdf-render.ts).
3. **`PageModel.width = 612 / height = 792` hardcode** — wave 1 baked the Letter default into the renderer-side Redux PageModel; every test fixture happened to be Letter-sized; non-Letter PDFs rendered at the wrong scale silently. Closed in Phase 4.1.1 by `measurePageDimensionsThunk` (see [Phase 4.1.1 — `measurePageDimensionsThunk`](#phase-411--measurepagedimensionsthunk-option-y-root-cause-fix) above).

**The structural failure mode (read this twice):**

A handler / module / state slice ships a stub with a `// TODO: the next wave will wire this` comment. The stub returns a sentinel value (`-1` for page count, `612` for page width, `new Uint8Array(0)` for bytes). The stub's CONTRACT shape matches production — typecheck passes. Every downstream consumer test **mocks the stub at the module boundary** with the expected production return value — so consumer tests also pass. The production failure mode appears **only** when a real user runs the packaged binary against a real document. By then, the stub has shipped through 5+ waves, every wave passed CI, every wave passed Julian's audit (which audits source, not runtime behavior), and the rot is invisible to every diagnostic short of actually launching the binary on a real document.

**The fix has three parts:**

1. **Prefer nullable + late-init over sentinel defaults.** `pageCount: number | null` (initialize null, populate after measurement) catches the consumer failing loudly with `null` instead of silently consuming `-1`. `PageModel.width: number | null` catches the renderer failing loudly. This is the Phase 4.1.1 Option Y discipline.
2. **Ban optional-with-stub-fallback at the type level.** If a dependency MUST be provided in production (the pdf-lib metadata loader, the pdf.js render service, etc.), make it REQUIRED on the interface. The type system then fails the wave that tries to ship without wiring it. This is what Phase 4.1 did to `RegisterIpcOptions.loadPdfMetadata`.
3. **Visual-verification of the packaged binary is the last-line check.** Diego's L-002 (revised after the Wave 17 false alarm) requires an operator-level screenshot of the running binary showing rendered UI, not just process-metadata. The Phase 4.1.2 verification screenshot at `release/wave-4-1-2-v041-rendered-pdf.png` is the first build where the cascade (pdf-lib metadata loader real → fs:readBytesByHandle wired → pdfjs render real → PageModel dims real → standardFontDataUrl path resolves in the asar) was end-to-end verified.

**Audit habit.** When you write or review a stub-with-TODO, ask: "what is the production behavior if no follow-up wave wires this?" If the answer is "the user sees broken UI", you have to either (a) ship the real impl now, (b) make the consumer fail loudly, or (c) put a lock in `.learnings/locked-instructions.md` that the next wave MUST wire it. The thing you must NOT do is ship the stub with the expectation that "the next wave will get to it" — the next wave never does, because the failure is invisible from inside the swarm.

**Pointer to source:** the structural lesson is encoded in the post-Phase-4.1 file shape:
- [`src/ipc/register.ts`](../src/ipc/register.ts) — `loadPdfMetadata` is REQUIRED (no fallback).
- [`src/main/pdf-ops/pdf-metadata-loader.ts`](../src/main/pdf-ops/pdf-metadata-loader.ts) — real impl, permanent.
- [`src/client/services/pdf-render.ts`](../src/client/services/pdf-render.ts) — real pdfjs wiring at `:43` (worker import) + `:165` (getDocument call).
- [`src/client/state/thunks.ts`](../src/client/state/thunks.ts) — `measurePageDimensionsThunk` populates `PageModel.width/height` from real pdfjs measurements.

If you ever see a file with a `// TODO: next wave wires this` comment in production code, treat it as a P0 ship-blocker. Three instances cost the project 13+ waves of silent rot before Phase 4.1's structural cleanup.

### Permissive test stubs mask production failures

This is the most expensive recurring failure mode in the swarm's history — it has shipped a BLOCKER in three waves (8.5 B-1, 8.5 B-2, 13.5 B-3.1) following the same structural pattern.

**The shape of the bug.** A handler or runner that takes injected dependencies for testability — `sanitizePath`, `writeFile`, `getBytes`, etc. — has its test suite inject **no-op** or **passthrough** fakes:

```ts
// In a *.test.ts file — WRONG
const deps = {
  sanitizePath: (raw: string) => raw,            // permissive passthrough
  writeFile:    async () => undefined,           // no-op
  getBytes:     async () => new Uint8Array(0),   // empty
};
```

CI goes 100% green. The handler's branches under test exercise the happy path because the fake accepts everything. **Production wiring** in `register.ts` (or wherever the deps are constructed) uses the REAL `sanitizePath` / `writeFile` / etc. — and those reject inputs the test fake silently passed. The handler then fails 100% in production on the first user invocation.

**The Wave 13.5 B-3.1 case.** `register.ts:509` wired the mail-merge runner with the default `sanitizePath` (a Wave 1 module that only accepts `.pdf` extensions). The runner tests at `mail-merge-runner.test.ts:109, 126, 176, 211, 254, 269, 337` injected `sanitizePath: (raw) => raw`. Folder-mode mail-merge passed CI because the folder path skipped the extension check; in production it always failed because the folder has no extension and got rejected. Same shape as Wave 8.5's B-1 (`writeFile` no-op masking a downstream FS error) and B-2 (`getBytes` empty masking a decode failure).

**The fix.** Tests for any dependency-injected handler whose deps include sanitizers, FS writers, or byte producers **must inject the REAL production function**, not a permissive fake. The Wave 13.5 closure pinned the wire with real sanitizers across 21 new tests (mail-merge-runner: 7 cases; forms-run-mail-merge: 2 cases; path-sanitizer: 12 cases including the dedicated `sanitizeDirectoryPath` whitelist test). Imitate that pattern — if your handler accepts a `sanitize*` or `write*` dep, your tests construct the deps object by importing the real function from `src/main/security/path-sanitizer.ts` (or `node:fs/promises`) and only stub at the OS / SQL / clock boundary.

**The audit habit.** When you write or review a handler test, GREP the same test file for every injected dep, then GREP `src/ipc/register.ts` for the production injection of that dep, and **compare line-by-line.** If the test fake would return `null` / `undefined` / passthrough on an input where the real function would reject — that gap is the bug. Promoted to a future Diego CI lint candidate (regex for `sanitizePath: () => raw` / `writeFile: () => undefined` etc. in `*.test.ts` files); see [`build-report.md` Wave 13.5 Soft followups](build-report.md#soft-followups-phase-32--phase-4).

---

## Debugging

### Main process

Add `--inspect-brk=9229` to the Electron launch (via `electron-vite dev` config) and attach a debugger to localhost:9229. Or use the VS Code "Electron Main" launch config (not yet committed; lift from `electron-vite` docs if needed).

### Renderer

Open DevTools with **Ctrl+Shift+I** in a development build. Production builds disable DevTools.

### Edit-replay engine

The engine is a pure function — easy to debug in isolation. Construct a `ReplayInput` with your op list, call `replay()`, and inspect `result.value.bytes` (or `result.error` on failure). See [`src/main/pdf-ops/replay-engine.test.ts`](../src/main/pdf-ops/replay-engine.test.ts) for the test harness pattern.

### Logs

In Phase 2, main logs go to stdout in dev / `%APPDATA%/PDF Viewer & Editor/logs/main.log` in production. Renderer logs are console-only (open DevTools in a dev build).

### SQLite

`%APPDATA%/PDF Viewer & Editor/db.sqlite`. Inspect with any SQLite client. Migrations are in [`migrations/`](../migrations/) and run on every launch via [`src/db/migrate.ts`](../src/db/migrate.ts). Phase 2 added `0002_phase2_bookmarks.sql` which adds `parent_id` + `sort_order` columns to the `user_bookmarks` table.

---

## Release process

Release is still **manual** in 0.7.0. Phase 7 wired the auto-update *client* (electron-updater) and added the `publish` block to `electron-builder.yml`, but the publish target is a **placeholder** (`owner: PLACEHOLDER`, `repo: PLACEHOLDER`) — the client routes to the honest `update_not_configured` until a real channel exists. Configuring a real GitHub release channel + a code-signing cert is the **Phase 7.1** step that turns auto-update live (with zero code change in the controller).

1. Bump the version in `package.json` (e.g. `0.7.0` → `0.7.1`).
2. Update [`docs/build-report.md`](build-report.md) with the wave history if relevant.
3. Clear `ELECTRON_RUN_AS_NODE` from the environment (`Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`) before building — see [`.learnings/locked-instructions.md`](../.learnings/locked-instructions.md) L-002.
4. Tag the commit: `git tag v0.7.0 && git push --tags`.
5. Run `npm run dist:win` locally on a Windows host. (If packaging fails with "Access is denied" on a `.dll`, kill any lingering `PDF Viewer & Editor` processes holding the win-unpacked lock, then retry.)
6. **L-002 visual verification (mandatory before marking a packaging wave GREEN):** capture an operator-level screenshot of the running packaged binary showing the rendered UI — not just process metadata. Embed the path + a description in the build report. See [`.learnings/locked-instructions.md`](../.learnings/locked-instructions.md) L-002.
7. Upload the contents of `release/*.exe` plus `latest.yml` (the electron-updater feed metadata) and the blockmap to GitHub Releases.

**Code-signing** is the Phase 7.1 prerequisite for auto-update to *apply* downloaded bundles (electron-updater verifies a bundle's signature before applying it). When the cert is available, set `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` as GitHub secrets and uncomment the env entries in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Until then, binaries are unsigned and trigger SmartScreen / Gatekeeper warnings on first launch.

**Cross-platform packaging.** `electron-builder.yml` is configured for macOS (`dmg` + `zip`, universal) and Linux (`AppImage` + `deb`), but CI builds Windows only (P7-L-1) and the mac/linux configs are **UNVERIFIED on real hardware**. Building them requires running `electron-builder --mac` / `--linux` **on a mac/linux host** (cross-compile from Windows is unsupported — `better-sqlite3` must rebuild against the target toolchain). See [Cross-platform build](#cross-platform-build-phase-7) + [README → Platform support](../README.md#platform-support). Verifying on real hosts (with an L-002-equivalent screenshot) is the Phase 7.1 work item.

---

## Where to learn more

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — Phase 1 system design, security floor, render pipeline, export engine selector
- [`architecture-phase-2.md`](architecture-phase-2.md) — Phase 2 system design — lynchpin, channel matrix, fidelity
- [`architecture-phase-3.md`](architecture-phase-3.md) — Phase 3 system design — HYBRID commit boundary, mail-merge runner, 7 locked decisions
- [`architecture-phase-4.md`](architecture-phase-4.md) — Phase 4 system design — signatures + annotations + audit log, 7 locked decisions, R-W15-A through F risk register
- [`architecture-phase-5.md`](architecture-phase-5.md) — Phase 5 system design — OCR engine, language packs, text-behind-image authorship, scan-deferral story, 10 locked decisions (P5-L-1 through P5-L-10), R-W19-A through F risk register
- [`architecture-phase-6.md`](architecture-phase-6.md) — Phase 6 system design — Export to Office + image formats, per-page streaming engine, layout extractor, table detector, image extractor, four writers, background queue, schema v6, 10 locked decisions (P6-L-1 through P6-L-10), R-W23-A through F risk register
- [`architecture-phase-7.md`](architecture-phase-7.md) — **Phase 7 system design (the FINAL roadmap phase) — cross-platform build config (unverified), auto-update via electron-updater (placeholder publish target), opt-in/default-OFF telemetry, WCAG 2.1 AA a11y, i18next localization, schema v7 (settings-keys-only), the sixth trust-floor instance, 8 locked decisions (P7-L-1 through P7-L-8)**
- [`a11y-audit.md`](a11y-audit.md) — **Phase 7 accessibility audit — eight critical paths, the ARIA tab-pattern remediation map (R-1..R-10), WCAG 2.1 AA success-criteria coverage, Windows Narrator drill, honest known gaps**
- [`i18n-strategy.md`](i18n-strategy.md) — **Phase 7 localization strategy — i18next + react-i18next, 8 namespaces, typed keys, lazy loading, the es-ES proof locale, pluralization + Intl formatting, RTL deferral**
- [`edit-replay-engine.md`](edit-replay-engine.md) — edit-replay engine deep dive — `replay()` signature, op handlers, fold-then-emit, atomic save (Phase 5 amends with step 3.9 OCR apply; Phase 6 does NOT extend the EditOperation union — export is read-only)
- [`form-engine.md`](form-engine.md) — form-engine deep dive — detect / fill / flatten / create
- [`signature-engine.md`](signature-engine.md) — signature-engine deep dive — cert lifecycle, byte-range arithmetic, CMS envelope, TSA client, library decision walkthrough
- [`ocr-engine.md`](ocr-engine.md) — OCR-engine deep dive — worker pool lifecycle, language pack management, text-behind-image authorship, confidence aggregation, preprocessing helpers, job lifecycle, PAdES interaction
- [`export-engine.md`](export-engine.md) — **Export-engine deep dive — single-funnel pipeline, layout-detect algorithm (X-clustering for columns, MODE-of-bucketed-sizes for headings), table-detect (5-step line-grid), image-extract (OPS.paintImageXObject walk + CTM stack), four writers, atomic .export-temp → rename, job lifecycle, trust-floor obligations**
- [`api-reference.md`](api-reference.md) — every IPC channel as a developer reference (Phase 1 + 2 + 3 + 4 + 5 + 6 + **7**: `update:*` / `telemetry:*` / `i18n:*`)
- [`api-contracts.md`](api-contracts.md) — the architect's frozen IPC spec with rationale (§§1-13 Phase 1+2+3; §14 Phase 4; §15 Phase 4.1; §16 Phase 5; §17 Phase 6; **§18 Phase 7 — update + telemetry + i18n; the `.strict()` telemetry privacy contract**)
- [`conventions.md`](conventions.md) — naming, lint, test, Redux, performance (§14 Phase 3 form-state; §15 Phase 4 cert+password discipline; §16 Phase 5 OCR engine discipline; §17 Phase 6 export-job discipline; **§18 Phase 7 — telemetry-no-PII / a11y rules / i18n no-as-any-on-t() / trust-floor honest-vs-forbidden phrasing**)
- [`data-models.md`](data-models.md) — SQLite schema + TypeScript types (§7.5 Wave 8.5 amendment; §8 Phase 3; §9 Phase 4 incl. schema v4 `signature_audit_log`; §10 Phase 5 incl. schema v5 `ocr_jobs` / `ocr_results` / `language_packs`; §11 Phase 6 incl. schema v6 `export_jobs` + 17 setting keys; **§12 Phase 7 — schema v7 settings-keys-only, NO new table, the deliberate no-`telemetry_events`-table**)
- [`ui-spec.md`](ui-spec.md) — component tree, shortcuts, modal flows (§13 Phase 4 signature capture + PAdES wizard + signature audit panel; §14 Phase 5 OCR wizard + language pack manager + confidence overlay + scan-modal placeholder; §15 Phase 6 Export modal + Exports sidebar tab + status-bar widget; **§16 Phase 7 Settings General tab + telemetry toggle + locale picker + update controls + About modal**)
- [`build-report.md`](build-report.md) — wave-by-wave build history with verdicts (Phase 7 starts at Wave 27 Riley architecture; closes at Wave 30 Nathan docs)
- [`code-review.md`](code-review.md) — Julian's reviews, every finding tracked (**Wave 29 Phase 7 audit, GREEN — the final roadmap-phase review**: telemetry-privacy + trust-floor both PASS unconditionally; H-29.1 quitAndInstall gate [latent → Phase 7.1]; M-29.1 aria-proptypes flip [done Wave 29]; M-29.2 28c deep-modal i18n)
- [`a11y-audit.md`](a11y-audit.md) — Phase 7 accessibility audit + remediation map
- [`i18n-strategy.md`](i18n-strategy.md) — Phase 7 localization strategy

If you're new to the codebase, read in this order: `README.md` → `ARCHITECTURE.md` → `architecture-phase-2.md` → `architecture-phase-3.md` → `architecture-phase-4.md` → `architecture-phase-5.md` → `architecture-phase-6.md` → `architecture-phase-7.md` → this file → `signature-engine.md` (if touching signing) → `ocr-engine.md` (if touching OCR) → `export-engine.md` (if touching export) → `a11y-audit.md` + `i18n-strategy.md` (if touching a11y/i18n) → `api-reference.md`. That should give you enough to ship a contained change.
