# PDF_Viewer_Editor — Project Plan (Phase 1: Walking Skeleton)

**Author:** Marcus (Chief Delivery Officer)
**Date:** 2026-05-21
**Status:** **Approved** — user signed off on Section 5 decisions 2026-05-21. Wave 1 dispatched.

## Approval log

- 2026-05-21 — user approved the plan with four binding decisions on Section 5. Two of the four overrode Marcus's recommendation (Print-to-PDF, file-association). Section 5 has been updated in place so the locked decision is the only thing implementers see; the rationale-and-override notes record the reasoning for posterity.

This document decomposes Phase 1 of `PDF_Viewer_Editor` into the four-wave swarm execution. It is the single source of truth for who builds what, in what order, with what acceptance criteria. Phase 2+ scope (Print-to-PDF, OCR, Office export, forms, sign, scan) is **explicitly out of scope** for this plan — see Section 8.

---

## 0. Inputs read

- `d:\Projects\PDF_Viewer_Editor\CLAUDE.md` (project rules, locked stack, file ownership)
- `d:\Projects\PDF_Viewer_Editor\docs\project-roadmap.md` (Phase 1–7 roadmap)
- `d:\Projects\PDF_Viewer_Editor\README.md` (public summary)
- `d:\Projects\CLAUDE.md` (swarm orchestration rules)
- `~/.claude/learnings/global.jsonl` (last 50 lines — relevant items absorbed below)

### Cross-project lessons applied

- **PowerShell ASCII-only** (LOCK-0030, recurrence in RDPMaster 2026-05-15): any `.ps1` Diego ships must be ASCII-only. Flagged in Wave 3 brief.
- **WPF/WinForms shell icon** (RDPMaster L-010) — not directly applicable (Electron app), but Diego must set the Windows installer icon resource in `electron-builder.yml` for taskbar/Start Menu surfaces.
- **No node-pty in this app** (Conductor LOCK-0019) — confirmed; no PTY usage planned.

---

## 1. Wave 1 — Architecture (sequential, Riley only)

**Agent:** Riley (`front-end-architect`)
**Mode:** design-only. No `src/` code yet.
**Inputs:** this plan, `CLAUDE.md`, `docs/project-roadmap.md`.

### Deliverables (exact file list)

1. `ARCHITECTURE.md` — top-level architecture diagram (text/Mermaid), process boundaries (main vs renderer vs preload), data flow, library responsibilities.
2. `docs/api-contracts.md` — typed IPC contract surface. Every channel name, request/response shape (TypeScript interfaces), error mode, async semantics. Channels needed for Phase 1:
   - `dialog:openPdf` / `dialog:saveAs`
   - `fs:readPdf` / `fs:writePdf`
   - `recents:list` / `recents:add` / `recents:clear`
   - `settings:get` / `settings:set`
   - `bookmarks:list` / `bookmarks:upsert` / `bookmarks:delete` (per-file, keyed by file hash)
   - `pdf:combine` (server-side merge using pdf-lib in main process)
   - `app:getVersion` / `app:quit`
3. `docs/data-models.md` — SQLite schema (DDL + ERD): `recent_files`, `app_settings`, `user_bookmarks`. PDF document in-memory model (Page, Annotation, EditOperation, dirty-state tracking, undo/redo stack shape — even if undo lands in Phase 2, design the slot now).
4. `docs/ui-spec.md` — screens, components, and interaction patterns for the walking skeleton:
   - Single-window app, three-pane layout: thumbnail strip (left), viewer (center), inspector/annotation tools (right, collapsible).
   - Top toolbar: Open, Save, Save As, Combine, Add Page, Delete Page, Rotate, Zoom, Annotation tools.
   - Drag-and-drop: file onto window opens, thumbnail drag reorders.
   - Empty state, loading state, error state for each pane.
   - Keyboard shortcuts table (Ctrl+O, Ctrl+S, Ctrl+Shift+S, Del on selected thumbnail, etc.).
5. `docs/conventions.md` — naming, folder layout, IPC channel naming convention, TypeScript strict-mode rules, lint config summary (referenced by swarm `CLAUDE.md`).

### Constraints Riley must encode

- **Permissive OSS only**: pdf.js (Apache-2.0) for render, pdf-lib (MIT) for edit, tesseract.js (Apache-2.0) for later OCR. No AGPL. No commercial SDKs. Every dependency choice must declare license.
- **Electron security floor (non-negotiable):**
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true` in renderer where pdf.js permits
  - All renderer→main communication via a typed `contextBridge` API in `src/preload/index.ts`
  - CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:;` (pdf.js worker needs `blob:`)
  - File-system access only via main process; renderer never sees raw paths from disk dialogs without sanitization.
- **No `any`** without a code comment justifying why.
- IPC channel module is the contract source-of-truth — owned by David but imported by Riley (read-only). Riley designs the shape; David implements the handlers; Riley consumes via the typed preload bridge.

### Acceptance criteria (Wave 1 "done")

- All five docs above exist.
- IPC contract has every Phase 1 channel typed end-to-end (request, response, error).
- SQLite schema has CREATE statements + at least one example row per table.
- UI spec has at least a wireframe (ASCII or linked image) for the main window.
- Riley appends one entry to `.learnings/learnings.jsonl` per the self-improvement protocol.

---

## 2. Wave 2 — Implementation (parallel: David, Ravi, Riley)

Three agents in parallel. **Zero file overlap** (see ownership matrix below). All consume Wave 1 docs as read-only inputs.

### 2.1 David — Electron main process, preload bridge, IPC handlers

**Agent:** David (`backend-engineer`)
**Owns (write):**

- `src/main/index.ts` — app lifecycle, BrowserWindow creation, menu, single-instance lock, file-association handler. Default ON at install per Decision 4 (§5); runtime toggle exposed via `app:setDefaultPdfHandler` IPC channel.
- `src/main/window-manager.ts` — window state restore, multi-document slot (single window for Phase 1, designed for multi later).
- `src/main/dialogs.ts` — native open/save dialogs.
- `src/preload/index.ts` — `contextBridge.exposeInMainWorld('pdfApi', {...})`, typed against the IPC contract.
- `src/ipc/contracts.ts` — shared TypeScript types for all channels (imported by preload AND renderer). **This is the contract source — Riley reads, never writes.**
- `src/ipc/handlers/*.ts` — one file per channel group: `dialogs.ts`, `fs.ts`, `recents.ts`, `settings.ts`, `bookmarks.ts`, `pdf-ops.ts`.
- `src/main/pdf-ops/combine.ts` — pdf-lib-driven merge running in main process (off the renderer thread).
- `src/main/security/path-sanitizer.ts` — every path crossing the IPC boundary goes through this.
- `.env.example` — placeholder for future cloud OCR keys etc. (no values; document-only for Phase 1).
  **Reads:** Wave 1 docs, especially `docs/api-contracts.md` and `docs/data-models.md`.
  **Must not touch:** `src/client/**`, `src/db/**`, `migrations/**`.
  **Security checklist David must satisfy:**
- contextIsolation on, nodeIntegration off, sandbox on where compatible
- All IPC handlers validate inputs and sanitize file paths (no `..` traversal, only paths user actually chose via dialog)
- No `eval`, no `Function()` constructor
- CSP set in main process via `session.defaultSession.webRequest`
- Auto-updater disabled in Phase 1 (Phase 7 scope) — explicit comment

### 2.2 Ravi — SQLite layer

**Agent:** Ravi (`database-specialist`)
**Owns (write):**

- `src/db/connection.ts` — better-sqlite3 connection factory, WAL mode, prepared-statement cache, lives in main process only.
- `src/db/migrate.ts` — migration runner, idempotent, tracks applied migrations in a `schema_migrations` table.
- `migrations/0001_init.sql` — initial schema:
  - `recent_files` (path TEXT PRIMARY KEY, last_opened_at INTEGER, file_hash TEXT, display_name TEXT)
  - `app_settings` (key TEXT PRIMARY KEY, value TEXT) — JSON-serialized values
  - `user_bookmarks` (id INTEGER PK, file_hash TEXT, page_index INTEGER, title TEXT, created_at INTEGER, UNIQUE(file_hash, page_index, title))
  - `schema_migrations` (version INTEGER PRIMARY KEY, applied_at INTEGER)
- `src/db/repositories/recent-files-repo.ts`
- `src/db/repositories/settings-repo.ts`
- `src/db/repositories/bookmarks-repo.ts`
- `src/db/types.ts` — row types matching the schema.
  **Reads:** `docs/data-models.md` (canonical schema), `docs/api-contracts.md` (which channels need which queries).
  **Must not touch:** `src/main/**`, `src/preload/**`, `src/client/**`, `src/ipc/**`.
  **Constraints:**
- Database file lives in Electron `app.getPath('userData')` — Ravi codes against an injected path so tests can use a temp dir.
- All queries use prepared statements (no string concatenation).
- File-hash strategy: SHA-256 of first 64 KiB + file size, computed in main process (David's pdf-ops file owns the hash util; Ravi just stores the hex string).

### 2.3 Riley — React renderer (implementation mode)

**Agent:** Riley (`front-end-architect`)
**Owns (write):**

- `src/client/` — entire React app tree.
  - `src/client/main.tsx` — Vite entrypoint.
  - `src/client/app.tsx` — root component, layout.
  - `src/client/components/` — `ThumbnailStrip`, `PdfViewer`, `Toolbar`, `AnnotationLayer`, `InspectorPanel`, `RecentsMenu`, `ErrorBoundary`, `EmptyState`.
  - `src/client/state/` — Redux Toolkit store + slices per Decision 3. One slice per concern (`documentSlice`, `viewportSlice`, `annotationsSlice`, `selectionSlice`, `exportSlice`, `uiSlice`). Async work via `createAsyncThunk`. Command-pattern undo middleware spec'd by Riley in ARCHITECTURE.md.
  - `src/client/services/pdf-render.ts` — pdf.js wrapper (worker setup, page rendering, viewport math).
  - `src/client/services/pdf-edit.ts` — pdf-lib wrapper for page reorder/insert/delete/rotate in-memory.
  - `src/client/services/api.ts` — thin typed wrapper over `window.pdfApi` (the preload bridge).
  - `src/client/hooks/` — `useDocument`, `useThumbnails`, `useAnnotationTool`, etc.
  - `src/client/styles/` — CSS modules or Tailwind (Riley picks; document choice in `ui-spec.md`).
  - `src/client/index.html` — Vite template with CSP meta tag mirroring main-process CSP.
    **Reads:** all Wave 1 docs, **imports from `src/ipc/contracts.ts` (David's file) read-only**.
    **Must not touch:** any path David or Ravi owns. Specifically: cannot modify `src/ipc/contracts.ts` even if a type seems wrong — file a note for Marcus to escalate.
    **Constraints:**
- pdf.js worker loaded as a Vite asset, not from CDN.
- Memory hygiene: every `PDFPageProxy` must have `.cleanup()` called when scrolled off-screen; every `RenderTask` cancelled on unmount. (Julian will audit this in Wave 3.)
- Annotation toolbar wired but only highlight + sticky note + text box implemented for Phase 1. Freehand stub OK — disabled in UI with "Phase 2" tooltip per roadmap stretch.
- Drag-reorder uses HTML5 DnD or `@dnd-kit/sortable` (MIT) — Riley's call, declared in ui-spec.

### File ownership matrix (Wave 2)

| Path                                         | Owner                          | Others                                                                                                                  |
| -------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `src/main/**`                                | David                          | —                                                                                                                       |
| `src/preload/**`                             | David                          | —                                                                                                                       |
| `src/ipc/contracts.ts`                       | David                          | Riley reads only                                                                                                        |
| `src/ipc/handlers/**`                        | David                          | —                                                                                                                       |
| `src/db/**`                                  | Ravi                           | —                                                                                                                       |
| `migrations/**`                              | Ravi                           | —                                                                                                                       |
| `src/client/**`                              | Riley                          | —                                                                                                                       |
| `.env.example`                               | David                          | —                                                                                                                       |
| `package.json`                               | **deferred to Wave 3 / Diego** | David proposes deps via comments in his files; Diego consolidates into `package.json` to avoid three-way merge conflict |
| `tsconfig*.json`                             | **deferred to Wave 3 / Diego** | same reason                                                                                                             |
| `vite.config.ts` / `electron.vite.config.ts` | **deferred to Wave 3 / Diego** | same reason                                                                                                             |

> **Marcus note:** `package.json` and build configs are deliberately Diego's. Asking three parallel agents to all add deps to the same `package.json` is a guaranteed merge conflict (and the JSONL contention pattern from the Hard-Won Playbook teaches the same lesson — serialize writes to shared files). Each Wave 2 agent declares the deps they need in a code comment block at the top of their entry file; Diego folds them in.

### Acceptance criteria (Wave 2 "done")

- All files in the matrix exist and compile under `tsc --noEmit` (Diego will run this in Wave 3).
- No agent has modified any file outside their owned paths (Marcus verifies via post-wave file listing).
- David's IPC handlers cover every channel from `docs/api-contracts.md`.
- Ravi's migration runs cleanly against a fresh SQLite file and is idempotent on re-run.
- Riley's React app builds (after Diego's Wave 3 build config) and renders the empty state.
- Each agent appends a `.learnings/learnings.jsonl` entry. **Per the Hard-Won Playbook (parallel-write contention), agents return their JSONL entry to Marcus rather than writing directly. Marcus appends serially after Wave 2 joins.**

---

## 3. Wave 3 — Infrastructure + Code Review (parallel: Diego, Julian)

### 3.1 Diego — Build, packaging, CI

**Agent:** Diego (`dev-ops-agent`)
**Owns (write):**

- `package.json` — consolidates dep lists from David/Ravi/Riley. Scripts: `dev`, `build`, `package`, `lint`, `typecheck`, `test:unit`, `test:e2e`.
- `tsconfig.json`, `tsconfig.main.json`, `tsconfig.renderer.json` — strict mode, project references.
- `vite.config.ts` (or `electron.vite.config.ts` using `electron-vite`) — Vite for renderer, esbuild for main/preload.
- `electron-builder.yml` — Windows MSI (NSIS) + portable .exe targets. App icon embedded (multi-resolution .ico — apply the RDPMaster L-010 lesson: ensure Windows shell surfaces show the icon, not just the in-window title bar). Code-signing config **placeholder only** — comment block with steps and Azure Key Vault cert reference, no actual cert.
- `.github/workflows/ci.yml` — matrix: `lint` + `typecheck` + `test:unit` + `test:e2e` (Playwright headed-Electron smoke: launch app, open a sample PDF, screenshot, exit) + `build` job that runs `electron-builder --dir` to verify packaging.
- `scripts/` — any helper scripts (e.g. `scripts/generate-icon.mjs`, `scripts/dev-launch.mjs`). **ASCII-only** per LOCK-0030 if any `.ps1` is shipped; Diego should prefer `.mjs` over `.ps1` for cross-platform.
- `.eslintrc.cjs` + `.prettierrc` + `.editorconfig`.
- `.gitignore` (if not present already).

**Constraints from Hard-Won Playbook and global learnings:**

- ASCII-only in any `.ps1` files (LOCK-0030)
- macOS / Linux packaging is **Phase 7**, not Phase 1 — Diego must call this out in `electron-builder.yml` comments and not waste cycles configuring DMG / AppImage now.
- electron-builder uses `nsis` (NSIS-based MSI) for Windows; portable .exe via `portable` target. Both produced from the same source build.
- No code-signing certificate in repo. The cert reference is by Azure Key Vault path in a comment — Phase 7 wires actual signing.
- No auto-update wiring (Phase 7).

### 3.2 Julian — Code review

**Agent:** Julian (`code-reviewer`)
**Owns (write):**

- `docs/code-review.md` — structured review of Wave 2 output.
  **Reads:** all of `src/`, `migrations/`, `docs/api-contracts.md`, `docs/data-models.md`.
  **Focus areas (mandatory):**

1. **Electron security** — contextIsolation, nodeIntegration, sandbox, CSP, preload surface size (smaller = safer), file-path sanitization in every IPC handler. Flag any handler that takes a path and doesn't pass it through David's sanitizer.
2. **pdf-lib usage** — `PDFDocument.load` with `updateMetadata: false` where appropriate, ignoreEncryption defaults, save-flag patterns (`useObjectStreams` etc.).
3. **pdf.js memory** — every `getPage` paired with `.cleanup()`, every `render` paired with `RenderTask.cancel()`, worker not duplicated across pages.
4. **Error handling on file I/O** — `try/catch` on every `fs.promises` call, user-visible error surface, no swallowed exceptions.
5. **Type safety** — no `any` without justification, no `as` casts without comment, exhaustive switch on discriminated unions.
6. **SQLite layer** — prepared statements only, transactions for multi-row writes, indexes on hot columns (`recent_files.last_opened_at`, `user_bookmarks.file_hash`).
7. **Annotation rendering** — coordinate system correctness (PDF y-axis is bottom-up; screen is top-down), DPI handling, no off-by-one on page boundaries.
8. **Modularization** — flag any file > 200 lines without justification (per repo `CLAUDE.md`).

**Output format for `docs/code-review.md`:**

- One section per focus area
- Each finding: severity (blocker / major / minor / nit), file:line, description, suggested fix
- Summary table at top
- Final verdict: GO / GO-with-fixes / BLOCK

### Acceptance criteria (Wave 3 "done")

- App builds via `npm run package` and produces both `.exe` artifacts.
- CI workflow passes lint + typecheck + unit + e2e + build jobs on a clean checkout.
- Julian's review committed; any **blocker** finding triggers a Wave 2.5 mini-cycle (David / Ravi / Riley fix, re-review).
- Both agents log to `.learnings/` (via Marcus serialization per Hard-Won Playbook).

---

## 4. Wave 4 — Documentation (sequential, Nathan only)

**Agent:** Nathan (`documentation-expert`)
**Owns (write):**

- `README.md` — replace current stub. Quickstart (clone → install → dev), feature list (Phase 1 only — mark Phase 2+ items as "planned"), screenshots placeholder (Nathan uses the Operator skill to capture real screenshots once Wave 3's build runs), license placeholder.
- `docs/user-guide.md` — task-oriented: how to open a PDF, reorder pages, combine, annotate, save. Screenshot per task.
- `docs/developer-guide.md` — architecture overview (links to `ARCHITECTURE.md`), repository layout, how to add a new IPC channel (walkthrough), how to add a new annotation type, debugging tips (main vs renderer DevTools), test strategy.
  **Reads:** every artifact from Waves 1–3.
  **Must not modify:** any `src/`, `docs/api-contracts.md`, `docs/data-models.md`, `docs/ui-spec.md`, `docs/conventions.md`, `docs/code-review.md`, `docs/project-roadmap.md` — those belong to other agents.

### Acceptance criteria (Wave 4 "done")

- README is publishable (no TBDs in active sections).
- A new contributor can clone the repo, follow README, and have a running dev build in <15 min on Windows.
- Nathan logs to `.learnings/`.

---

## 5. Risks and decisions for the user (block Wave 1 until resolved)

> Marcus does NOT dispatch Riley until the user resolves these four items. Defaults are recommended but not assumed.

### Decision 1 — Print-to-PDF strategy (Phase 2, but architecture must accommodate now)

**Decided: Hybrid (pdf-lib re-emit default, headless Chromium `printToPDF()` fallback) — locked by user 2026-05-21.**

Marcus's original recommendation was pure pdf-lib re-emit. User overrode to a hybrid model with two engines designed in from day one, and an engine-selection decision point in the export flow.

| Option                                          | Pros                                                                                                                 | Cons                                                                                                                                                                                                                                                                         | Status                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A. pdf-lib re-emit                              | Pure JS, deterministic, no Chromium dep, preserves vector content                                                    | Cannot capture renderer-side visual state (CSS-styled overlays, accessibility tree); some source PDFs (encrypted-but-permitting-export, malformed-but-Chromium-readable, exotic CMap tables, color-managed CMYK with ICC profiles) do not round-trip cleanly through pdf-lib | **Default engine** — used unless the heuristic flips to Chromium                                                              |
| B. Headless Chromium `webContents.printToPDF()` | Renders exactly what the viewer sees; covers everything pdf.js could open; built into Electron — no extra dependency | Rasterizes some vectors (text-as-glyphs vs text-as-paths depends on the source); larger output file; slower                                                                                                                                                                  | **Fallback engine** — used when (a) heuristic flags the source PDF as risky, or (b) user manually overrides via export dialog |

**Why hybrid (per user direction):** pdf-lib's load/save cycle silently corrupts a non-trivial slice of real-world PDFs (encrypted-but-printable, CMYK + ICC, exotic CMap, malformed but viewer-tolerant). Falling back to Chromium for those cases trades file size for "the export at least opens." Both engines being designed in from day one avoids retrofitting later.

**Architectural asks for Wave 1 (Riley must spec all of these):**

1. `pdf-edit.ts` represents every edit operation as an idempotent, serializable discriminated union (`EditOperation`). This makes pdf-lib re-emit a pure function over `(originalBytes, ops[])`.
2. An `ExportEngineSelector` module with a **heuristic** — concrete signals that flip the default from pdf-lib to Chromium. Initial heuristic (Riley refines in ARCHITECTURE.md):
   - Source PDF is encrypted (any flavor of standard security handler) — Chromium
   - Source PDF has unresolved structural warnings on pdf-lib load (object stream errors, xref repair triggered) — Chromium
   - Source PDF uses CMYK color space + embedded ICC profile — Chromium (pdf-lib's color handling is sRGB-biased)
   - User has applied annotations whose subtype pdf-lib cannot author cleanly (TBD in Decision 2 sidecar list) — Chromium (so the visual flatten matches what user sees)
   - Otherwise — pdf-lib
3. A **manual override** in the export dialog: dropdown "Engine: Auto (recommended) / pdf-lib / Chromium print" so the user can force either path. Default "Auto" runs the heuristic.
4. Export flow returns `{ engine: 'pdf-lib' | 'chromium', warnings: string[], outputBytes: Uint8Array }` so downstream consumers (and Phase 2 print-to-physical-printer) can branch on which engine ran.
5. Chromium engine lives in the main process, driven by an offscreen `BrowserWindow` that loads the in-memory edited PDF via a custom protocol handler (`pdfedit://`); no temp file on disk. (David will implement in Phase 2; Riley specs the IPC channel and offscreen-window contract now.)

This is Phase 2 implementation but Phase 1 design must accommodate. Riley wires the `ExportEngineSelector` shape and the two-engine IPC channel into `docs/api-contracts.md` so the Wave 2 boundary is correct.

### Decision 2 — Annotation storage

**Decided: Embed as standard PDF annotations (ISO 32000 annotation subtypes). No sidecar. — locked by user 2026-05-21.**

Aligns with Marcus's recommendation. No override.

| Option                                                                                                                                              | Pros                                                                                                                                                 | Cons                                                                                                                                              | Status      |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| A. Embed as PDF annotations (Highlight, Underline, StrikeOut, Text/sticky-note, Ink/freehand, FreeText, Square, Circle, Line per ISO 32000-1 §12.5) | Portable to Acrobat / Edge / Preview / any conforming viewer, survives export through either Print-to-PDF engine, no sidecar to lose or version-skew | pdf-lib's annotation support is partial — freehand (Ink), polygon, and some appearance-stream details require manual annotation dict authoring    | **Decided** |
| B. Sidecar JSON                                                                                                                                     | Richer (any property), easier to author                                                                                                              | Annotations don't travel with the PDF; export/share workflow breaks; conflicts with the "export preserves edits" promise; doubles the I/O surface | Rejected    |

**Annotation subtypes Phase 1 / 2 / 4 (Riley maps each to its ISO 32000 subtype in `docs/data-models.md`):**

| User-visible name | PDF annotation subtype | Phase | Implementer notes                                                   |
| ----------------- | ---------------------- | ----- | ------------------------------------------------------------------- |
| Highlight         | `/Highlight`           | 1     | pdf-lib native; QuadPoints array required                           |
| Sticky note       | `/Text`                | 1     | pdf-lib native; contents string, icon name `Note`                   |
| Text box          | `/FreeText`            | 1     | pdf-lib native; appearance stream needed for cross-viewer rendering |
| Underline         | `/Underline`           | 2     | pdf-lib native                                                      |
| Strikethrough     | `/StrikeOut`           | 2     | pdf-lib native                                                      |
| Freehand          | `/Ink`                 | 2     | Manual annotation dict authoring; InkList of point arrays           |
| Rectangle         | `/Square`              | 4     | pdf-lib native                                                      |
| Circle / ellipse  | `/Circle`              | 4     | pdf-lib native                                                      |
| Line / arrow      | `/Line`                | 4     | pdf-lib native; line-ending styles for arrows                       |

**No-sidecar implication for Riley's design:** all annotation state must round-trip through the PDF itself. The Redux Toolkit document-model slice holds annotations as TypeScript objects keyed to their PDF object number once written; on document re-open, the annotation array is rebuilt by parsing PDF annotations on each page. Editing an annotation marks it dirty in the slice; save flushes the dirty set back as PDF annotations via pdf-lib (or via the Chromium engine for the small set that needs it, with annotations baked into the printToPDF render).

**No "hybrid escape hatch" anymore.** If Riley discovers an annotation type pdf-lib cannot author, the resolution is either (a) write the annotation dict manually using `PDFDict` / `PDFArray` primitives, or (b) flag the document for the Chromium export engine (Decision 1 path B). Sidecar files are off the table.

### Decision 3 — State management library

**Decided: Redux Toolkit — locked by user 2026-05-21.**

Marcus's original recommendation was Zustand on minimal-surface-area grounds. User overrode in favor of Redux Toolkit because Phase 2's undo/redo + the multi-slice document model (pages, annotations, viewport, export state, selection) will be heavier than the Phase 1 surface suggests, and RTK's `createSlice` + Immer + time-travel devtools earn their weight when the model grows.

| Option           | Pros                                                                                                                                                                                                                                                                             | Cons                                                                                                                                     | Status      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| A. Zustand       | Tiny, no boilerplate                                                                                                                                                                                                                                                             | No built-in undo/redo idiom; time-travel debugging is bolt-on; growing into a multi-slice model means inventing reducer patterns by hand | Rejected    |
| B. Redux Toolkit | `createSlice` removes most historical Redux boilerplate; Immer gives mutable-style writes; **command-pattern undo/redo maps cleanly to action history**; Redux DevTools time-travel is essential for debugging the document model; multi-slice composition is the idiomatic path | Larger bundle; more files; team must respect the slice boundary                                                                          | **Decided** |

**Why Redux Toolkit (per user direction):**

1. **Undo/redo is a command stack.** Phase 2 ships undo/redo. Each `EditOperation` from Decision 1 IS a Redux action with payload — `pushAction` / `popAction` / `replayActions` map 1:1 to RTK's action history. Zustand has no first-class equivalent.
2. **Multi-slice document model.** Phase 1 has at least: `documentSlice` (open PDF metadata + dirty ops), `viewportSlice` (zoom, scroll, current page), `annotationsSlice` (active tool, draft annotation in progress), `selectionSlice` (which thumbnails/pages selected), `exportSlice` (engine choice, in-flight job state), `uiSlice` (sidebar tab, modal open). Phase 2 adds `historySlice`. Six-plus slices is RTK's sweet spot.
3. **DevTools.** Time-travel debugging the document model during annotation work pays back fast.

**Architectural asks for Wave 1 (Riley specs in `docs/conventions.md` + UI spec):**

- One slice per concern in `src/client/state/slices/<name>-slice.ts`. Slices export their reducer + their action creators; no re-exporting the store from a slice file.
- Selectors live next to their slice in `src/client/state/slices/<name>-selectors.ts`. Memoize with `createSelector` (built into RTK) when the selector derives state.
- Async work via `createAsyncThunk` for anything that crosses the preload bridge (open file, save file, combine). The IPC call IS the thunk's payload.
- Undo/redo: a `historySlice` keyed by document id, holding `past: Action[]`, `present: DocumentSnapshot`, `future: Action[]`. Actions tagged `meta.undoable: true` get pushed by a middleware that wraps the document reducer. Riley specs this in ARCHITECTURE.md as the **Command Pattern Middleware**.
- No `redux-saga` / `redux-observable`. Thunks only.
- No RTK Query (no server cache).
- Strict TypeScript: every slice exports its `RootState` slice + `AppDispatch` is the typed dispatch. `useAppSelector` / `useAppDispatch` typed hooks in `src/client/state/hooks.ts`.

### Decision 4 — Windows file-association (.pdf handler)

**Decided: Installer checkbox, default ON — locked by user 2026-05-21.**

Marcus's original recommendation was opt-in default OFF. User overrode to opt-in default ON: the installer shows a clearly-labeled checkbox "Make PDF_Viewer_Editor the default PDF viewer" pre-checked. User can uncheck before clicking Install.

**Rationale for the override:** the user judged that anyone installing a PDF editor is signalling intent to use it for PDFs; making them dig through Settings afterward is a worse onboarding than the checkbox they actually see. The checkbox preserves consent (it is visible, labeled, and unchecking is one click), so it's not "stomping silently" — the original concern.

**Implementation asks:**

- **Diego (electron-builder NSIS script):** the .pdf file-association registration is performed during install when the checkbox is checked. Use NSIS `WriteRegStr HKCR ".pdf"` patterns AND register PDF_Viewer_Editor as a `ProgID` so Windows' "Open With" UI lists it cleanly. The checkbox label must include the word "default" and be pre-checked. On uninstall, only remove the association if PDF_Viewer_Editor is currently the registered handler — never claw back a user's later choice of Acrobat.
- **David (`src/main/index.ts`):** independently expose Settings → "Make PDF_Viewer_Editor the default PDF viewer" toggle so the user can flip it post-install. Uses Windows API path (`app.setAsDefaultProtocolClient` is for protocol handlers, NOT file extensions — for `.pdf` we need to write to the registry or invoke `SHChangeNotify`. Riley specs the IPC channel `app:setDefaultPdfHandler` in `docs/api-contracts.md`; David implements via `regedit` Node module or shelling to `assoc` / `ftype`.)
- **Ravi (`app_settings` table):** key `file_association.pdf.requested = 'true' | 'false'` mirrors current state for Settings UI.
- **Riley (UI spec):** Settings dialog shows the current state ("PDF_Viewer_Editor IS the default PDF viewer" / "Currently NOT the default") with a button to toggle. On Windows 10+ the OS may show its own consent UI when the toggle flips — that's expected, document it in the user guide.
- **No silent re-assertion.** If the user changes their default to Acrobat after install, we do NOT reclaim it on next launch. The setting is "what we asked for at install time," not "ongoing battle for the file type."

---

## 6. Quality gates (per wave, gating advance)

| Wave  | Gate                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | All 5 docs exist; IPC contract is complete for Phase 1 channels; UI spec has a wireframe; Marcus reviews + signs off before dispatching Wave 2.                                            |
| 2     | All files in ownership matrix exist; no cross-ownership writes; `tsc --noEmit` clean (Diego runs in Wave 3 pre-check); David's IPC handlers match Riley's preload bridge expectations 1:1. |
| 3     | `npm run package` produces both Windows artifacts; CI workflow green on a clean checkout; Julian's review has no blocker findings (or blockers fixed in Wave 2.5 mini-cycle).              |
| 4     | README is publishable; new-contributor onboarding works in <15 min; Phase 1 walking-skeleton features all documented.                                                                      |
| Final | Marcus writes `docs/build-report.md` summarising deliveries per agent, any failures encountered, and lessons appended to `.learnings/`.                                                    |

---

## 7. JSONL log contention — pre-applied mitigation

Per Marcus's Hard-Won Playbook (parallel-write JSONL contention, 2026-04-29):

- **Wave 2 and Wave 3 agents MUST NOT write to `.learnings/learnings.jsonl` themselves.** Each agent returns its post-flight log entry as a structured JSON object in its final response to Marcus.
- Marcus appends all entries **serially** after the wave joins.
- Per-agent log files (`.learnings/agents/<agent>.jsonl`) are the fallback if an agent forgets — Marcus merges them.
- Every agent kickoff prompt will include the reminder: "Your `detail` and `fix` fields must be passed through `JSON.stringify` before being written. Do NOT hand-write strings that contain `\` or unescaped quotes."

---

## 8. Out-of-scope for Phase 1 (do not pull scope)

The following are **explicitly excluded** from Phase 1. Any agent who builds these is doing rework — flag and revert.

- Print-to-PDF (Phase 2)
- Print-to-physical-printer (Phase 2)
- Image import as page or overlay (Phase 2)
- Text-content editing on existing pages (Phase 2)
- Bookmarks authoring UI (Phase 2 — read-only display of existing bookmarks is OK in Phase 1 if cheap; ask Marcus first)
- AcroForms detection / fill (Phase 3)
- Form designer (Phase 3)
- Mail merge (Phase 3)
- Signature capture / placement (Phase 4)
- Full annotation toolset (Phase 4) — Phase 1 ships highlight + sticky note + text box only
- Scan integration (Phase 5)
- OCR (Phase 5)
- PDF → Word/Excel/PowerPoint/image export (Phase 6)
- macOS / Linux packaging (Phase 7)
- Auto-update (Phase 7)
- Telemetry (Phase 7)
- Localization (Phase 7)

If a user request in Phase 1 says "and also OCR" — Marcus says no, file as Phase 5 work.

---

## 9. Dispatch readiness

**Plan approved 2026-05-21. Wave 1 dispatched.**

Locked decisions (Section 5):

1. Print-to-PDF strategy → **Hybrid: pdf-lib default + Chromium `printToPDF()` fallback, both designed in, heuristic + manual override** (user override of Marcus's pdf-lib-only recommendation)
2. Annotation storage → **Embed as standard PDF annotations, no sidecar** (aligned with Marcus recommendation)
3. State library → **Redux Toolkit** (user override of Marcus's Zustand recommendation, chosen for undo/redo + multi-slice document model)
4. .pdf file-association → **Installer checkbox, default ON** (user override of Marcus's opt-in default-OFF recommendation)

Riley dispatched for Wave 1 with the Section 1 brief, amended for the four locked decisions above.
