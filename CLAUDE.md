# PDF_Viewer_Editor — Project Rules

A cross-platform desktop PDF viewer + editor built with **Electron + TypeScript + React**, using **permissive open-source PDF libraries only** (MIT / Apache-2.0 / BSD). No AGPL or commercial SDKs.

The build is run by the agent swarm defined in `d:\Projects\CLAUDE.md`. **Marcus (orchestration-manager) is the entry point — always invoke Marcus first.**

## Goal

A completely original desktop program that can:

**Viewing**
- Open and render PDF files (single + multi-page, smooth pan/zoom, thumbnails)
- Bookmarks (read existing + author new)
- Print to physical printer
- **Print to PDF** (export current document, including edits/annotations, back out to PDF)

**Editing**
- Rearrange, add, and remove pages
- Combine multiple PDFs into one
- Import images and place them as pages or overlays
- Full content editing (text, images, shapes) where the source PDF permits
- Annotations (highlight, strikethrough, sticky notes, freehand, shapes, text boxes)
- Bookmarks authoring

**Forms**
- Detect and fill existing AcroForms
- Create new forms (text fields, checkboxes, radios, dropdowns, signature fields)
- Mail-merge data from CSV/Excel into form templates → batch-produce filled PDFs

**Signing**
- Fill & sign contract paperwork (typed, drawn, image-based signatures)
- Apply signatures to specific fields or freeform positions

**OCR + Scan**
- Scan from a connected scanner (TWAIN / WIA on Windows)
- Run OCR on scanned or image-only PDFs (Tesseract via `tesseract.js` or native binding)
- Make scanned PDFs searchable

**Export**
- PDF → Word (.docx)
- PDF → Excel (.xlsx)
- PDF → PowerPoint (.pptx)
- PDF → image formats (PNG, JPEG, TIFF)
- PDF → searchable PDF (post-OCR)

## Stack

| Layer | Choice | License |
|---|---|---|
| Shell | Electron 30+ | MIT |
| UI | React 18 + TypeScript | MIT |
| Rendering | pdf.js | Apache-2.0 |
| Editing / page ops | pdf-lib | MIT |
| OCR | tesseract.js | Apache-2.0 |
| Office export | `docx`, `exceljs`, `pptxgenjs` | MIT |
| State | Zustand or Redux Toolkit | MIT |
| Build | Vite + electron-builder | MIT |
| Tests | Vitest + Playwright | MIT / Apache-2.0 |

**Excluded by policy:** PyMuPDF (AGPL), iText (AGPL), Ghostscript (AGPL), PDFTron/Apryse, Foxit, Syncfusion.

## Wave Plan

Standard swarm waves from `d:\Projects\CLAUDE.md`:

```
Wave 1 (sequential)   →  Riley            ARCHITECTURE.md, docs/api-contracts.md, docs/data-models.md, UI design
Wave 2 (parallel)     →  David + Ravi + Riley   Electron main / preload / IPC, SQLite for recents+settings+bookmarks, React UI
Wave 3 (parallel)     →  Diego + Julian   electron-builder packaging (MSI + portable), code review
Wave 4 (sequential)   →  Nathan           README, user guide, developer guide
```

## First Milestone — Walking Skeleton

Ship a working app that can:

1. Launch on Windows (electron-builder MSI + portable .exe)
2. Open a PDF from disk (file dialog + drag-and-drop)
3. Render pages with pan, zoom, thumbnails
4. Reorder pages by drag
5. Add / remove pages
6. Combine two or more PDFs into a new file
7. Add basic text + highlight annotations
8. Save the modified PDF

Everything else (forms, mail merge, sign, OCR, Office export, scan, Print-to-PDF) is scoped into later phases — see `docs/project-roadmap.md` for the phased plan.

## File Ownership

Per swarm rules. Each file belongs to exactly one agent:

| Path | Owner |
|---|---|
| `ARCHITECTURE.md`, `docs/api-contracts.md`, `docs/data-models.md`, `docs/ui-spec.md`, `src/client/**` | Riley |
| `src/main/**` (Electron main), `src/preload/**`, `src/ipc/**` | David |
| `src/db/**`, `migrations/**` | Ravi |
| `Dockerfile` (none — desktop app), `electron-builder.yml`, `.github/workflows/**`, `scripts/**` | Diego |
| `docs/code-review.md` | Julian |
| `README.md`, `docs/user-guide.md`, `docs/developer-guide.md` | Nathan |
| `docs/project-plan.md`, `docs/build-report.md` | Marcus |

## Conventions

- `feat(scope):` / `fix(scope):` / `refactor(scope):` commit format
- TypeScript strict mode, no `any` without a comment explaining why
- ESLint + Prettier enforced in CI
- All IPC channels typed via a shared contract module
- No file > 200 lines without justification (per repo modularization rule)
- Permissive OSS only — every new dependency must have its license verified before merge

## Knowledge persistence

Per `d:\Projects\CLAUDE.md`, durable project knowledge goes in the Obsidian vault:

- Decisions → `D:\Vault\Agents\Projects\PDF_Viewer_Editor\Decisions\YYYY-MM-DD-title.md`
- Runbooks → `D:\Vault\Agents\Projects\PDF_Viewer_Editor\Runbooks\<topic>.md`
- Integrations (TWAIN, scanners, OCR) → `D:\Vault\Agents\Projects\PDF_Viewer_Editor\Integrations\<system>.md`
- Per-project lessons → `.learnings/learnings.jsonl` in this repo
- Cross-project lessons → `D:\Vault\Agents\Learnings\YYYY-MM-DD-title.md`

Secrets, if any (e.g. cloud OCR keys, signing certs) → **Azure Key Vault**, never `.env` or vault.
