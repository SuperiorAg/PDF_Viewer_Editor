# Phase 6 — Export to Office

**Author:** Main session
**Date:** 2026-05-22
**Status:** Plan-on-disk.

## Goals (locked: layout-preserving best-effort)

1. PDF → Word (.docx) — text + paragraph + heading + table extraction + image embedding
2. PDF → Excel (.xlsx) — table detection + row/column extraction
3. PDF → PowerPoint (.pptx) — one slide per page + text + image layout
4. PDF → image formats (PNG, JPEG, TIFF) — per-page rasterization
5. Quality tiers: "text-only" (fast) vs "layout-preserving" (slow, best-effort)

## Locked design constraints

- **Permissive OSS only.** Libraries: `docx` (MIT), `exceljs` (MIT), `pptxgenjs` (MIT), `sharp` (Apache-2.0) for rasterization.
- **Layout extraction algorithm:** pdf.js `getTextContent` + bounding-box clustering for paragraph detection; line-grid analysis for table boundaries. Custom layout engine in main process. Honest about failure modes (heavily designed PDFs convert poorly).
- **Quality tiers:** user selects in export modal. Default to "layout-preserving" for Word/PowerPoint; "text-only" for Excel (which is inherently tabular).
- **Image extraction:** for layout-preserving modes, embedded images are extracted and re-embedded in the Office output. Big PDFs with many images = big outputs.

## Wave structure

| Wave | Owner          | Mode                                              |
| ---- | -------------- | ------------------------------------------------- |
| 23   | Riley          | solo (architecture)                               |
| 24   | David + Riley  | parallel (implementation; no DB changes expected) |
| 25   | Diego + Julian | parallel (packaging + audit)                      |
| 26   | Nathan         | solo (docs)                                       |

## File ownership

| Owner       | Files                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Riley (23)  | `docs/architecture-phase-6.md`, `docs/office-export-engine.md`, doc amendments                                                                                                                                                                                                                                                                                                              |
| David (24)  | `src/main/export/office-export.ts` (NEW — coordinator), `src/main/export/layout-extractor.ts` (NEW — clustering algorithm), `src/main/export/docx-builder.ts`, `src/main/export/xlsx-builder.ts`, `src/main/export/pptx-builder.ts`, `src/main/export/image-rasterizer.ts`, tests for each, 4 new IPC handlers (`export:toWord`, `export:toExcel`, `export:toPowerPoint`, `export:toImage`) |
| Riley (24)  | `src/client/components/modals/office-export-modal/` (NEW — format + quality picker), `src/client/state/slices/export-slice.ts` (EXTEND — was Phase 1, gains Office formats), thunks                                                                                                                                                                                                         |
| Diego (25)  | deps (docx, exceljs, pptxgenjs, sharp — verify licenses), CI updates, electron-builder considerations (sharp has native deps)                                                                                                                                                                                                                                                               |
| Julian (25) | code-review: layout extractor algorithm (off-by-one risks, infinite-loop guards on malformed PDFs), output file validation                                                                                                                                                                                                                                                                  |
| Nathan (26) | docs                                                                                                                                                                                                                                                                                                                                                                                        |

## Risk register

1. **HIGH — Layout extraction quality varies wildly.** Designed PDFs (magazines, brochures) convert poorly. Mitigation: honest UX warning ("complex layouts may not convert faithfully"); user picks "text-only" tier for fast-and-rough.
2. **MEDIUM — Sharp native dep.** Adds another native module to electron-rebuild + dist:win. Diego prepares CI.
3. **MEDIUM — Table detection.** Line-grid analysis works on PDFs with explicit table borders; struggles on table-shaped-but-borderless layouts. Honest about it.
4. **LOW — Output file size.** Layout-preserving with embedded images can produce large Office files. Document expected size growth.

## Acceptance criteria

- [ ] Export menu: 4 format options (Word, Excel, PowerPoint, Image). Image submenu for PNG/JPEG/TIFF.
- [ ] Export modal: format + quality tier picker; output path; per-page progress
- [ ] Round-trip test: small text-heavy PDF → docx → opens in Word with readable content
- [ ] Round-trip test: PDF with explicit table → xlsx → cells populated
- [ ] PDF → PowerPoint: 1 slide per page; text + images positioned
- [ ] Image rasterization: high-DPI option in Settings
- [ ] Honest UX warnings for complex layouts
- [ ] L-001 holds
- [ ] No regression on Phases 1-5
