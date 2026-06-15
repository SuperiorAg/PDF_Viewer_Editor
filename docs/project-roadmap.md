# Project Roadmap

Phased delivery for PDF_Viewer_Editor.

**Status as of 2026-06-15 (v0.7.20):** Phases 1–7 shipped end-to-end on Windows. Phase 7.1 + 7.2 hardening waves (real-PDF e2e OCR integration test, Ubuntu CI unblock, dev-mode SQLite repo bundling, PAdES indirect-`/V` detector fix, signed-PDF audit-row e2e) all closed. macOS / Linux configs land but verification on those hosts is deferred until cert procurement + non-Windows hosts are available.

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
