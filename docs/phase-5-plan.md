# Phase 5 — Scan & OCR

**Author:** Main session
**Date:** 2026-05-22
**Status:** Plan-on-disk. Wave 19 (Riley solo design) dispatches once Phase 4 implementation closes.

## Goals (locked)

1. File-import path: drag-drop scanned PDFs/images → run Tesseract OCR → produce searchable PDF (text-behind-image)
2. Native scanner integration: WIA (Windows Image Acquisition) first; TWAIN deferred if no clean MIT binding
3. Multi-page scan into a single PDF
4. OCR via `tesseract.js` (already in Phase 1 deps list; verify present) — native Tesseract binding optional perf escape hatch
5. Make scanned PDFs searchable (OCR layer behind image — invisible text overlay aligned with image text)
6. Language pack selection for OCR (ship en-US default; settings dropdown for installable packs)
7. OCR confidence reporting + low-confidence highlighting (UI surface for human review)

## Locked design constraints

- **Both file-import AND native scan ship**. File-import first (simpler, broader applicability); native WIA second.
- **WIA over TWAIN.** Windows Image Acquisition is the modern Microsoft path; TWAIN drivers are widely deprecated.
- **Native scanner library:** Riley evaluates in Wave 19. Candidates: `node-wia` (verify license + maintenance), `node-twain` (TWAIN; deferred path). If no MIT-compatible binding exists for WIA, Wave 20 builds a thin native addon wrapping Windows Imaging COM APIs.
- **Tesseract.js (Apache-2.0)** is the OCR engine. Already listed in Phase 1 ARCHITECTURE §3 (verify in current package.json before Wave 20).
- **Searchable-PDF output:** OCR text drawn invisibly (white text or `/Rendering Mode 3 (invisible)`) on a separate layer behind the scanned image. Standard pattern.
- **Language packs:** ship en-US bundled in the installer; user can add other packs via Settings (download from `tessdata` repo or load from disk). License: Apache-2.0 for Tesseract trained data.

## Wave structure

| Wave | Owner | Mode | Scope |
|---|---|---|---|
| 19 | Riley | solo | Phase 5 architecture |
| 20 | David + Ravi + Riley | parallel | Implementation |
| 21 | Diego + Julian | parallel | Packaging + audit (native module compilation) |
| 22 | Nathan | solo | Documentation |

## File ownership (Phase 5)

| Owner | Files |
|---|---|
| Riley (19 + 20) | `docs/architecture-phase-5.md`, `docs/ocr-engine.md`, additive doc amendments, `src/client/components/modals/scan-modal/` (NEW), `src/client/components/modals/ocr-modal/` (NEW), `src/client/state/slices/ocr-slice.ts` (NEW), thunk additions |
| David (20) | `src/main/pdf-ops/ocr-engine.ts` (NEW — wraps tesseract.js worker), `src/main/pdf-ops/searchable-pdf-builder.ts` (NEW — composes scanned image + invisible OCR text layer), `src/main/scanner/wia-bridge.ts` (NEW — native WIA invocation), `src/main/scanner/scanner-bridge.test.ts`, 4 new IPC handlers (`scan:listDevices`, `scan:acquire`, `ocr:run`, `ocr:listLanguages`), contracts.ts extension |
| Ravi (20) | `migrations/0005_phase5_ocr.sql` (optional: OCR cache table to avoid re-OCR'ing same image bytes), `src/db/repositories/ocr-cache-repo.ts` if cache table chosen |
| Diego (21) | `package.json` deps verification (tesseract.js + any native WIA binding), CI build for native module (Windows host only), electron-builder `extraResources` for tessdata language pack(s), code-signing for the bundled native addon if any |
| Julian (21) | code-review: native-module security review (any IPC bridge to native scanner = trust boundary; verify input validation), tesseract.js worker sandbox |
| Nathan (22) | docs updates + phase-5-release-notes.md |

## Risk register (Phase 5)

1. **HIGH — No clean MIT WIA binding may exist.** Native addons in this space are scarce + often abandoned. Mitigation: file-import + OCR ships in Phase 5; native WIA deferred to Phase 5.1 with the explicit user-warning. Riley evaluates in Wave 19.

2. **HIGH — Native module CI complexity.** electron-rebuild handles better-sqlite3 today; adding another native addon doubles build-machine config. Diego Wave 21 prepares CI.

3. **MEDIUM — Tesseract.js perf for large PDFs.** Multi-page OCR on a 200-page scan can take 30+ minutes. Mitigation: background worker, progress events, cancellable, batched per page.

4. **MEDIUM — OCR quality vs source image quality.** Junk scans produce junk OCR. Document honestly; surface confidence in the UI; let user discard low-confidence pages.

5. **LOW — Language pack distribution.** Tessdata files are ~10-50 MB each. Ship en-US only; let user add others via download.

## Acceptance criteria (Phase 5 close)

- [ ] Drag-drop a scanned PDF/image → modal offers "Run OCR" → produces searchable PDF
- [ ] If WIA binding available: "Scan from device..." menu lists devices, captures, OCRs, opens result
- [ ] If WIA NOT available: menu item present but disabled with "WIA scanner binding not present in this build (Phase 5.1)"
- [ ] OCR multi-page background with progress event stream + cancel button
- [ ] Confidence scores surface per-page; UI option to highlight low-confidence text
- [ ] Searchable PDF: text is selectable + searchable in any PDF reader
- [ ] en-US language pack bundled; settings dropdown shows installed languages; user can add more
- [ ] Schema v5 (if cache table chosen) migrates cleanly over v4
- [ ] L-001 holds
- [ ] No regression on Phases 1-4
- [ ] Honest limitations documented (OCR accuracy varies by source quality, WIA not TWAIN, etc.)
