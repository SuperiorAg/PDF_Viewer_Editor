# Project Roadmap

Phased delivery for PDF_Viewer_Editor. Phase 1 is the active milestone; later phases are scoped at this level but their detailed designs are produced by Riley when each phase opens.

## Phase 1 — Walking Skeleton (active)

Goal: a packaged Windows app that proves the architecture end-to-end.

- [ ] Electron + React + TS scaffold (Vite, electron-builder)
- [ ] Open PDF (file dialog + drag-and-drop)
- [ ] Render with pdf.js (pan, zoom, thumbnails, page navigation)
- [ ] Page operations: reorder (drag thumbnails), insert, delete, rotate
- [ ] Combine multiple PDFs into a single document
- [ ] Annotations: highlight, sticky note, text box, freehand
- [ ] Save modified PDF (Save / Save As)
- [ ] SQLite store for recent files, app settings, user-authored bookmarks per file
- [ ] electron-builder packaging: Windows MSI + portable .exe
- [ ] CI: lint, typecheck, unit tests (Vitest), e2e smoke (Playwright)

## Phase 2 — Editing & Print-to-PDF

- [ ] Image import (place as page, or overlay on existing page)
- [ ] Text editing on existing pages (where source PDF permits)
- [ ] Bookmarks authoring (create, rename, nest, reorder, link to page)
- [ ] Print to physical printer (system print dialog)
- [ ] **Print to PDF** — render current state of document (with all edits, annotations, form fills) to a fresh PDF
- [ ] Virtual printer driver consideration (out-of-scope for v1; revisit in Phase 5)
- [ ] Undo/redo across all page + content operations

## Phase 2.5 — Cleanup Wave (small, between Phase 2 and Phase 3)

Plan: `docs/phase-2.5-brief.md`. Single wave (Wave 10) — Diego + David + Riley + Julian re-audit in parallel. Consolidates accumulated carry-overs (api-contracts §12.6 amendment, ipc-contract.ts:230-234 ruling, real `pdf:identifyTextSpan` walker, `compactImageOpForHistory` delete handler, history image-bytes doubling, Phase 1 Julian MEDIUM backlog, Phase 2 Julian MEDIUM/LOW/NIT items, screenshots, code-signing cert acquisition).

## Phase 3 — Forms & Mail Merge

- [ ] Detect existing AcroForms and render fillable UI
- [ ] Form designer: text, checkbox, radio, dropdown, signature placeholder, date fields
- [ ] Save form templates (project-local schema; reuses bookmarks-like pattern)
- [ ] Mail merge: import CSV / Excel, map columns to fields, batch-produce filled PDFs
- [ ] Flatten forms on export

Plan: `docs/phase-3-plan.md`. Waves 11 (Riley design) → 12 (David + Ravi + Riley implement) → 13 (Diego + Julian) → 14 (Nathan docs).

## Phase 4 — Fill, Sign & Annotate (full)

**Decided 2026-05-22:** signatures are **visual + PAdES cryptographic** (both). PAdES = PDF Advanced Electronic Signatures (ETSI EN 319 142). Cert-backed signatures with optional RFC 3161 timestamping. Requires X.509 cert handling (PFX/P12 import), signature dictionary, byte-range hashing. Permissive-OSS library candidates: `node-signpdf` (MIT). License verified before adoption; no commercial SDKs; iText AGPL ruled out.

- [ ] Signature capture: typed, drawn (canvas), image upload
- [ ] Signature placement (drag onto field or freeform position; size/rotate)
- [ ] **PAdES cryptographic signatures**: PFX/P12 cert import (password-protected), signature dictionary, byte-range hashing, optional RFC 3161 timestamping
- [ ] Date stamp, initials, check marks for contracts
- [ ] Full annotation toolset (shapes, arrows, callouts, measure tools)
- [ ] Annotation summary / export

Plan: `docs/phase-4-plan.md`. Waves 15 (Riley design) → 16 (parallel implement) → 17 (Diego + Julian) → 18 (Nathan docs).

## Phase 5 — Scan & OCR

**Decided 2026-05-22:** ship **both paths** — file-import + OCR (Tesseract) AND native TWAIN/WIA integration. Native scanner library candidates: WIA (Windows Image Acquisition) APIs via a thin native addon. TWAIN drivers are widely deprecated. If no MIT-compatible binding exists, file-import + OCR ships in Phase 5; TWAIN native is deferred to Phase 5.1.

- [ ] File-import path: drag-drop scanned PDFs/images → run Tesseract OCR → produce searchable PDF (text-behind-image)
- [ ] Native scanner integration: WIA (Windows) first; TWAIN deferred if no clean MIT binding
- [ ] Multi-page scan into a single PDF
- [ ] OCR via tesseract.js (or native Tesseract binding for speed)
- [ ] Make scanned PDFs searchable (OCR layer behind image)
- [ ] Language pack selection for OCR
- [ ] OCR confidence reporting + low-confidence highlighting

Plan: `docs/phase-5-plan.md`. Waves 19 (Riley design) → 20 (parallel implement) → 21 (Diego + Julian) → 22 (Nathan docs).

## Phase 6 — Export to Office

**Decided 2026-05-22:** quality tier is **layout-preserving best-effort**. Heavier conversion using pdf.js `getTextContent` + bounding-box clustering for paragraph/heading detection, table detection via line-grid analysis, image extraction. Adds ~1 wave vs the text-only tier. Be honest in user-guide: complex layouts may not convert faithfully.

- [ ] PDF → Word (.docx) using `docx` — text + paragraph + heading + table extraction + image embedding
- [ ] PDF → Excel (.xlsx) using `exceljs` — table detection + row/column extraction
- [ ] PDF → PowerPoint (.pptx) using `pptxgenjs` — one slide per page + text + image layout
- [ ] PDF → image formats (PNG, JPEG, TIFF) — per-page rasterization
- [ ] Quality tiers ("text-only" fast vs "layout-preserving" slow-best-effort)

Plan: `docs/phase-6-plan.md`. Waves 23 (Riley design) → 24 (parallel implement) → 25 (Diego + Julian) → 26 (Nathan docs).

## Phase 7 — Polish & Cross-Platform

**Decided 2026-05-22:** **configure cross-platform; verify Windows only.** electron-builder.yml gains macOS .dmg (universal-binary intent) + Linux .AppImage/.deb targets. CI matrix exercises Windows packaging only. Configs are correct and reusable; actual macOS/Linux verification waits for hosts.

- [ ] macOS packaging config (DMG + universal binary) — config-only, unverified on hosts
- [ ] Linux packaging config (AppImage, deb) — config-only, unverified on hosts
- [ ] Auto-update via electron-updater (GitHub releases publisher placeholder)
- [ ] Telemetry framework (opt-in, anonymous; client-side hook + opt-in UI)
- [ ] Accessibility audit (keyboard nav for all critical paths; screen reader testing on Windows Narrator; ARIA labels)
- [ ] Localization framework (i18next or similar; en-US strings extracted; 1-2 sample locales as proof)

Plan: `docs/phase-7-plan.md`. Waves 27 (Riley design) → 28 (parallel implement) → 29 (Diego + Julian) → 30 (Nathan docs).

## Out-of-scope (for now)

- Cloud sync / collaboration
- Mobile (iOS / Android)
- Redaction (Phase 4 candidate — flagged for revisit if user demand surfaces)
- Verified macOS/Linux binary distribution (Phase 7 configures only; verification deferred to a future Phase 7.1 once non-Windows hosts are available)
