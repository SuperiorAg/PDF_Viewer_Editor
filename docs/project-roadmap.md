# Project Roadmap

Phased delivery for PDF_Viewer_Editor.

**Status as of 2026-06-19 (v0.8.0):** **Phase 7.5 Acrobat parity close has SHIPPED.** Phases 1–7 continue to ship; 7.1 + 7.2 + 7.3 + 7.4 B1 (Redaction) all closed. Phase 7.5 adds 35+ feature surfaces across 13 waves (Bucket A polish + Bucket B "ship now" + Bucket C accessibility / read-aloud / preflight) on top of the prior roadmap. The L-007 tool-registry lock is enforced. The bundled qpdf binary (Apache-2.0) ships for Windows; macOS falls back to system PATH (upstream gap); Linux is config-only / unverified. macOS / Linux **runtime** verification continues to wait on cert procurement + non-Windows hosts.

## Phase 1 — Walking Skeleton ✅ SHIPPED

Goal: a packaged Windows app that proves the architecture end-to-end.

- [x] Electron + React + TS scaffold (Vite, electron-builder)
- [x] Open PDF (file dialog + drag-and-drop)
- [x] Render with pdf.js (pan, zoom, thumbnails, page navigation)
- [x] Page operations: reorder (drag thumbnails), insert, delete, rotate
- [x] Combine multiple PDFs into a single document
- [x] Annotations: highlight, sticky note, text box, freehand
- [x] Save modified PDF (Save / Save As)
- [x] SQLite store for recent files, app settings, user-authored bookmarks per file
- [x] electron-builder packaging: Windows MSI + portable .exe
- [x] CI: lint, typecheck, unit tests (Vitest), e2e smoke (Playwright)

## Phase 2 — Editing & Print-to-PDF ✅ SHIPPED

- [x] Image import (place as page, or overlay on existing page)
- [x] Text editing on existing pages (where source PDF permits)
- [x] Bookmarks authoring (create, rename, nest, reorder, link to page)
- [x] Print to physical printer (system print dialog)
- [x] **Print to PDF** — render current state of document (with all edits, annotations, form fills) to a fresh PDF (hybrid: pdf-lib default + Chromium fallback with heuristic selector + manual override; ARCHITECTURE §6)
- [ ] Virtual printer driver consideration — **OUT-OF-SCOPE for v1** (per original roadmap; deferred indefinitely)
- [x] Undo/redo across all page + content operations (Redux Toolkit + history middleware)

## Phase 2.5 — Cleanup Wave ✅ SHIPPED

Plan: `docs/phase-2.5-brief.md`. All carry-overs consolidated and closed.

## Phase 3 — Forms & Mail Merge ✅ SHIPPED

- [x] Detect existing AcroForms and render fillable UI (`src/main/pdf-ops/form-engine.ts`)
- [x] Form designer: text, checkbox, radio, dropdown, signature placeholder, date fields (`src/client/components/form-designer/`)
- [x] Save form templates (project-local schema; reuses bookmarks-like pattern)
- [x] Mail merge: import CSV / Excel, map columns to fields, batch-produce filled PDFs (`src/main/pdf-ops/mail-merge-runner.ts`)
- [x] Flatten forms on export (`src/client/components/flatten-on-export-checkbox/`)

Plan: `docs/phase-3-plan.md`.

## Phase 4 — Fill, Sign & Annotate ✅ SHIPPED

**Decided 2026-05-22:** signatures are **visual + PAdES cryptographic** (both). PAdES = PDF Advanced Electronic Signatures (ETSI EN 319 142). `node-signpdf` MIT.

- [x] Signature capture: typed, drawn (canvas), image upload (`signature-capture-modal/`)
- [x] Signature placement (drag onto field or freeform position; size/rotate) (`signature-placement-overlay/`)
- [x] **PAdES cryptographic signatures**: PFX/P12 cert import, signature dictionary, byte-range hashing, RFC 3161 timestamping (`pades-signature.ts`, `cert-store.ts`)
- [x] Date stamp, initials, check marks for contracts
- [x] Full annotation toolset (shapes, arrows, callouts, measure tools) (`src/client/components/shape-tools/`, `annotation-layer/`)
- [x] Annotation summary / export (`annotation-summary-panel/`)
- [x] PAdES detector hardening: indirect-`/V` PDFRef handling (Phase 7.2 7.2.5, commit `ac8a098`) + signed-PDF audit-row e2e (Phase 7.2 7.2.4, commit `8e32b0c`)

Plan: `docs/phase-4-plan.md`.

## Phase 5 — Scan & OCR ✅ SHIPPED

**Decided 2026-05-22:** ship **both paths** — file-import + OCR (Tesseract) AND native WIA integration.

- [x] File-import path: drag-drop scanned PDFs/images → run Tesseract OCR → produce searchable PDF (text-behind-image)
- [x] Native scanner integration: WIA (Windows) (`src/main/pdf-ops/wia-scanner.ts`); TWAIN deferred (no clean MIT binding identified — out-of-scope until one surfaces)
- [x] Multi-page scan into a single PDF (`scan-to-pdf.ts`)
- [x] OCR via tesseract.js (with bundled language pack)
- [x] Make scanned PDFs searchable (OCR layer behind image)
- [x] Language pack selection for OCR (`language-pack-manager-modal/`, `language-pack-catalog.json`)
- [x] OCR confidence reporting + low-confidence highlighting (`ocr-confidence-overlay/`)
- [x] Phase 7.1 hardening: real-PDF e2e integration test + fixture corpus + CI hash gate (v0.7.19)
- [x] Phase 7.2 hardening: dev-mode SQLite repo bundling closes the v0.7.18 reopen-restore class at e2e tier (v0.7.20)

Plan: `docs/phase-5-plan.md`.

## Phase 6 — Export to Office ✅ SHIPPED

**Decided 2026-05-22:** quality tier is **layout-preserving best-effort**.

- [x] PDF → Word (.docx) using `docx` — text + paragraph + heading + table extraction + image embedding
- [x] PDF → Excel (.xlsx) using `exceljs` — table detection + row/column extraction
- [x] PDF → PowerPoint (.pptx) using `pptxgenjs` — one slide per page + text + image layout
- [x] PDF → image formats (PNG, JPEG, TIFF) — per-page rasterization
- [x] Quality tiers ("text-only" fast vs "layout-preserving" slow-best-effort)

Plan: `docs/phase-6-plan.md`.

## Phase 7 — Polish & Cross-Platform ✅ SHIPPED (Windows verified; mac/Linux unverified)

**Decided 2026-05-22:** **configure cross-platform; verify Windows only.** CI matrix exercises Windows packaging only.

- [x] macOS packaging config (DMG + universal binary) — config-only, **UNVERIFIED on hosts**
- [x] Linux packaging config (AppImage, deb) — config-only, **UNVERIFIED on hosts**
- [x] Auto-update via electron-updater (`update-status-area/`)
- [x] Telemetry framework (opt-in, anonymous; `telemetry-debug-panel/`)
- [x] Accessibility audit (`docs/a11y-audit.md`, ARIA labels across critical paths)
- [x] Localization framework (i18next + en-US + es-ES sample locale; `src/client/i18n/`)

Plan: `docs/phase-7-plan.md`.

## Phase 7.1 — Real-PDF e2e OCR integration test ✅ SHIPPED (v0.7.19)

Plan: `docs/phase-7.1-plan.md`. Test design: `docs/phase-7.1-test-design.md`. Closes OCR-chain arc v0.7.13 → v0.7.19.

## Phase 7.2 — CI Coverage Restoration + dev-mode SQLite bundling ✅ SHIPPED (v0.7.20)

Plan: `docs/phase-7.2-plan.md`. Test design: `docs/phase-7.2-test-design.md`. Both-OS CI green on first attempt; first CI run of the Phase 7.1 spec; six-adapter audit + PAdES indirect-`/V` fix + signed-PDF e2e + L-006 (Vite define-fold) lock.

## Phase 7.4 B1 — Redaction (R1 rasterize-redact) ✅ SHIPPED (v0.7.x interim)

Plan: `docs/phase-7.4-b1-redaction-design.md`. Acrobat-parity destructive redaction tool. Mark rectangle → Apply → redacted pages become rasterized images with marked content burned out + 17 categories of hidden information stripped via rebuild-from-scratch. PAdES signatures invalidated; signature audit log records invalidation. R2 content-stream walker variant + Mark Text (selection-based) deferred to a future phase.

## Phase 7.5 — Acrobat parity close ✅ SHIPPED (v0.8.0 — June 2026)

Plan: `docs/project-plan.md`. 13 waves; ~152 engineering hours across the swarm. Closes the parity gap surfaced in `docs/acrobat-parity-audit.md` and the principal-facing `docs/acrobat-comparison.html`. Includes the L-007 tool-registry lock + ratchet.

### Bucket A — polish (Wave 2)

- [x] A1 Stale tooltip cleanup + dishonest `phase3()` toast removal + Insert menu wiring + Shapes button → sub-toolbar
- [x] A2 i18n-wrapped shape sub-toolbar (en-US complete; es-ES partial)
- [x] A3 Shortcut suffix hygiene + Alt+B / Alt+O / Alt+C chords
- [x] A4 Menu mirrors for 9 toolbar-only items
- [x] A5 Cursor / Hand-tool button (V)
- [x] A6 Ctrl+1 (Fit width) / Ctrl+2 (Fit page) wired to real handlers
- [x] A7 "Find a tool…" palette (Ctrl+/) — surfaces every ToolDef

### Bucket B — ship now (Waves 2–7)

- [x] B2 Compare Files (text + visual diff) — sequential pairing (content-hash matching deferred to v0.9.0); fixed 1600 px visual render width; per-page LRU eviction deferred
- [x] B3 Find / Search (Ctrl+F, F3 / Shift+F3, match counter, case + whole-word)
- [x] B4 Watermark / Header & Footer / Background
- [x] B5 Crop Pages
- [x] B6 Compress / Optimize PDF
- [x] B7 Stamps + Stamp library (SQLite-backed)
- [x] B8 Password encryption + permission flags — bundled qpdf 11.9.1 (Apache-2.0)
- [x] B9 Action Wizard — record / replay / save / import / export. **Edit on saved actions is rename-only**; **custom destination folder deferred to v0.9.0** (runner writes next to source)
- [x] B10 Extract / Split / Replace pages
- [x] B11 Insert pages from another PDF
- [x] B12 Page-content Cut/Copy/Paste
- [x] B13 Hyperlinks (add / edit / remove)
- [x] B14 Spell check (`nspell` + Hunspell en-US). **es-ES NOT shipped** — Hunspell dictionary licensed GPL-3 / LGPL-3 / MPL-1.1, non-permissive; future locales tracked
- [x] B15 Page Display modes (single / two-up / scroll / facing)
- [x] B16 View-only rotation + chromeless Read Mode (F11)
- [x] B17 Area measure tool (8th shape)
- [x] B18 Edit text & images — font swap. **Whole-document scope only in v0.8.0**; finer-grained scope (this run / this page / whole document) tracked
- [x] B19 Auto-bookmarks from headings
- [x] B20 Remove hidden information / sanitize (rebuild-from-scratch per P7.5-L-12)
- [x] B21 Document Properties dialog (Description / Fonts / Custom / Security)

### Bucket C — accessibility / read-aloud / preflight (Waves 5a–5e)

- [x] C1 Read Aloud / TTS — SAPI on Windows; `say` on macOS; `espeak` on Linux (GPL-3 subprocess-only — user-installed via system package manager; we shell out, we don't link, we don't bundle)
- [x] C2 Preflight (PDF/X-1a + PDF/X-4 + PDF/A-1b + PDF/A-2b — **compliant subset, ~30 rules**; Acrobat ships hundreds)
- [x] C3 Tag PDF tree editor — sidebar Accessibility tab; auto-tag heuristic
- [x] C4 Reading Order overlay — drag-to-reorder. **Auto-detect from layout falls back to tag-tree order with a permanent honest banner** until the layout extractor is wired (same wiring as the C6 extractor-dependent rules)
- [x] C5 Alt Text inspector — pHash-based bulk-set for similar figures
- [x] C6 Accessibility Checker — **12-rule SUBSET of WCAG 2.1 + PDF/UA-1**; four-state outcome model (pass / warn / fail / unevaluated); color-contrast spot-sample permanently `unevaluated` under pdf-lib; Export Report dialog (HTML default + JSON)

### Marking foundation (Wave 2 + Wave 11)

- [x] R1 `src/client/tools/registry.ts` declarative ToolDef registry
- [x] R2 Four contract tests in `src/client/tools/registry.contract.test.ts`
- [x] R3 `docs/conventions.md` §X "Well-marked tools" definition
- [x] **L-007 lock + ratchet** (`scripts/ratchet-tool-registry-coverage.mjs`) — pre-commit + CI; every user-facing tool surface MUST appear in the registry or be allowlisted with a justifying reason

## Phase 7.5 deferred — tracked follow-ups (filed; not v0.8.0)

These items are tracked honestly and will land in subsequent waves / phases:

- **es-ES Hunspell dictionary licensing** — Hunspell Spanish is GPL-3 / LGPL-3 / MPL-1.1 (non-permissive). Future locales tracked; will ship when a permissive es-ES dictionary surfaces upstream.
- **Compare Files per-page LRU eviction** (v0.9.0 candidate).
- **Compare Files content-hash page matching** (v0.9.0 candidate).
- **Action Wizard custom destination folder** (v0.9.0 candidate — open questions: `destinationFolderToken` field on `actions:runScript`, OR a new `dialog:pickPlainDirectoryPath` channel returning a sanitized path string).
- **Action Wizard full op editor** (currently rename-only).
- **Font swap finer-grained scope** (this run / this page / whole document — engine extension).
- **Color-contrast Accessibility Checker rule** — needs a raster engine. Future enhancement; Vault decision note tracked.
- **Color-contrast / non-text-tagged extractor wiring** — Diego's R12 follow-up; same extractor shape as the C4 Reading Order auto-detect path.
- **R12 regression test against an externally-authored tagged PDF** — Julian's Wave 11 HIGH finding; ensures structure-tree round-trip preserves an Acrobat-authored tagged document end-to-end.
- **macOS qpdf bundling** — upstream qpdf 11.9.1 publishes no macOS binary (verified 2026-06-18). Phase 7.6 candidate when a permissive macOS binary source surfaces.
- **Linux qpdf bundling verification** — config-only / unverified per P7-L-1 until a real Linux host is available.
- **TWAIN direct scanner integration** — per audit §6.9 defer. Workflow remains: scan in your OS first, then File → Open / drag-and-drop into PDF Viewer Editor.

## Phase 7.3 candidates (filed; not yet a wave)

- [x] `launchPackagedApp()` e2e harness against `win-unpacked/` (commit `1eeccc9`)
- [ ] Packaged-binary CI gating — post-`build` job consuming the `windows-installers` artifact (deferred; documented in `tests/e2e/launch-app.ts` module header)
- [ ] **macOS host verification** — produce + sign DMG on actual macOS host (gated on cert procurement)
- [ ] **Linux host verification** — AppImage + .deb on actual Linux host
- [ ] **Code-signing certs** — procurement is the gating step for both above

## Out-of-scope (for now)

- Cloud sync / collaboration
- Mobile (iOS / Android)
- Redaction (Phase 4 candidate — flagged for revisit if user demand surfaces)
- TWAIN native scanner binding (deferred until a permissive-OSS binding surfaces; WIA covers the Windows path)
- Virtual printer driver (Phase 2 line; deferred indefinitely)
- Verified macOS/Linux binary distribution (Phase 7 configures only; verification requires hosts + signing certs)
