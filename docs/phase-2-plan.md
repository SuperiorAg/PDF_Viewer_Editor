# Phase 2 — Editing & Print-to-PDF Plan

**Author:** Marcus (orchestration-manager)
**Date:** 2026-05-21
**Status:** Top-level plan. Wave 6 brief (`docs/wave-6-brief.md`) is the Riley dispatch document.
**Prerequisite:** Phase 1.1 closes GREEN (see `docs/phase-1.1-brief.md`).

---

## 0. Goals + locked decisions

Phase 2 closes the Walking-Skeleton-to-Real-Editor gap. It promotes Save from "produces a valid PDF skeleton" (H-3 Phase-1 boundary, documented in user guide and README) to "produces a PDF that fully reflects every edit, annotation, image import, and text replacement the user made."

### Locked decisions (user, 2026-05-21)

| ID         | Decision                                                                                                                                                                                                                                                                                                  | Implication                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P2-L-1** | License = MIT. LICENSE file at root, package.json already declares it, LICENSES.md updated.                                                                                                                                                                                                               | Handled in Phase 1.1.                                                                                                                                                                           |
| **P2-L-2** | **Edit-replay architecture: main keeps original bytes per handle.** Main process retains the loaded PDF `Uint8Array` keyed by `DocumentHandle`. Renderer streams `EditOperation[]` via IPC; main applies via pdf-lib at save time. Renderer holds no large binaries (conventions §10 holds).              | This is the lynchpin. Unblocks H-3 Phase-1 limitation. Drives `fs:writePdf` `kind:'ops'` becoming Live. Underpins Print-to-PDF (pdf-lib path) and every Phase-2 mutation.                       |
| **P2-L-3** | **Text editing: replace-only, original font.** No reflow, no font substitution, no font subsetting beyond what pdf-lib offers natively. Plus the existing Phase-1 FreeText annotation tool for net-new text.                                                                                              | Sharply bounds the design surface. Existing-text-span replacement is solvable in pdf-lib; reflow + multilanguage shaping is not, and shipping it would be a Phase 4+ effort.                    |
| **P2-L-4** | **Image import: both modes.** Insert-as-new-page AND overlay-on-existing-page (signature-stamp UX). Formats: PNG, JPEG, TIFF.                                                                                                                                                                             | TIFF requires pre-conversion in main (pdf-lib supports PNG + JPEG natively); use `sharp` or a lightweight TIFF→PNG decoder. Two UX entry points (toolbar Insert Image + drag-drop onto a page). |
| **P2-L-5** | `ARCHITECTURE.md` Phase-1 is **frozen**. Wave 6 creates `ARCHITECTURE-PHASE-2.md` as additions/deltas. Phase-1 readers see the original; Phase-2 readers see the deltas.                                                                                                                                  | Avoids destructive edits to a doc Julian audited against.                                                                                                                                       |
| **P2-L-6** | Bookmarks authoring: full CRUD + nesting + reorder. Schema migration `0002_phase2_bookmarks.sql` adds `parent_id INTEGER REFERENCES user_bookmarks(id) ON DELETE CASCADE` + `sort_order INTEGER`. (This was deferred from Wave 2; Ravi noted it as a Phase-2 backlog item in his self-improvement entry.) | New migration in Wave 7. Repository methods expand.                                                                                                                                             |

### Headline features (from `docs/project-roadmap.md` Phase 2)

- [ ] Edit-replay engine (THE feature — drives Save fidelity)
- [ ] Image import (new page + overlay; PNG/JPEG/TIFF)
- [ ] Text editing (replace-only)
- [ ] Bookmarks authoring (create, rename, nest, reorder)
- [ ] Print to physical printer
- [ ] Print to PDF (hybrid: pdf-lib default + Chromium fallback)
- [ ] Undo/redo across all page + content operations (extending Phase 1's partial wiring)

## 1. Wave structure

```
Wave 6 (sequential)   →  Riley                  Phase 2 architecture + doc deltas (3-5h)
Wave 7 (parallel)     →  David + Ravi + Riley   Implementation (full-swarm)
Wave 8 (parallel)     →  Diego + Julian + Nathan(starts)  Infra/CI + code review + docs delta starts
Wave 9 (sequential)   →  Nathan                 Final docs (README + user guide + dev guide + api ref + LICENSES.md)
Phase 2.1 (cleanup)   →  TBD agents             Any HIGH findings out of Julian's Wave 8 audit (mirrors Wave 3.5)
```

Marcus runs the wave joins and writes `docs/build-report.md` deltas between waves.

## 2. Per-wave per-agent task summary

Full briefs are written when each wave opens. This is the headline scope.

### 2.1 Wave 6 — Riley (sequential) — Phase 2 architecture

**Brief:** `docs/wave-6-brief.md` (already written).

Deliverables:

- `docs/architecture-phase-2.md` (NEW) — Phase-2 additions and changes
- `docs/edit-replay-engine.md` (NEW) — main-process pdf-lib replay design (ordering, conflict resolution, partial-failure rollback, atomicity, perf)
- Append-only updates to `docs/api-contracts.md` (new channels)
- Append-only updates to `docs/data-models.md` (new EditOperation variants, bookmarks parent_id, image embedding model)
- Append-only updates to `docs/ui-spec.md` (new UI affordances)
- Append-only updates to `docs/conventions.md` (main-process edit-ops patterns, if new)

Phase-1 docs are **not destructively edited**. Append a "Phase 2 additions" section to each doc, or write a new sibling doc for new content.

### 2.2 Wave 7 — Parallel implementation

#### David (`backend-engineer`)

- Main-process **edit-replay engine** in `src/main/pdf-ops/replay-engine.ts` (NEW). Accepts a `DocumentHandle` + `EditOperationSerialized[]` + `AnnotationModelSerialized[]`. Loads the original bytes (held since `dialog:openPdf` / `fs:readPdf`), applies each op via pdf-lib, returns new bytes. Honors ordering and the inverse-op contract from `data-models.md` §3.2.
- Document-byte retention: extend `DocumentStore` (`src/main/pdf-ops/document-store.ts`) to hold the loaded `Uint8Array` keyed by handle. Add a `getBytes(handle)` method. Release on `fs:closePdf`.
- New IPC handlers + register entries:
  - `fs:writePdf` `kind:'ops'` path becomes Live (replaces the H-3 Phase-1 placeholder).
  - `pdf:embedImage` — embed a single image (PNG/JPEG/TIFF) into either a new page or as an overlay rect on an existing page. Returns updated handle.
  - `pdf:replaceText` — replace a text span on a page. Takes `{ pageIndex, objectId, newText }` per ARCHITECTURE §8 extension point.
  - `pdf:print` — physical-printer wrapper around Electron `webContents.print()`.
  - `pdf:export` — real implementation (no longer stub). Engine selector picks pdf-lib vs Chromium per the heuristic in `ARCHITECTURE.md` §6. Streams via `pdf:export:progress` for documents > 50 MB.
- TIFF → PNG conversion path. Investigate `utif`/`tiff` libraries first (smaller, permissive); only add `sharp` if image quality demands. License-check anything new BEFORE merging.
- Document-handle GC. Loaded original bytes can be 100MB+ per handle; ensure single-document Phase-1 invariant holds in Phase 2 (drop bytes on `fs:closePdf`).
- Result-shape hygiene: every new handler uses the H-4 `safeMessage()` helper (Phase 1.1 may close H-4, Phase 2 inherits the pattern; if Phase 1.1 deferred H-4, David closes it in Wave 7).

**Files owned (NEW or substantive edits):**

- `src/main/pdf-ops/replay-engine.ts` (NEW)
- `src/main/pdf-ops/document-store.ts` (edit — add bytes retention)
- `src/main/pdf-ops/text-replace.ts` (NEW)
- `src/main/pdf-ops/image-embed.ts` (NEW)
- `src/main/pdf-ops/tiff-decoder.ts` (NEW if needed)
- `src/ipc/handlers/fs-write-pdf.ts` (edit — ops path Live)
- `src/ipc/handlers/pdf-embed-image.ts` (NEW)
- `src/ipc/handlers/pdf-replace-text.ts` (NEW)
- `src/ipc/handlers/pdf-print.ts` (NEW)
- `src/ipc/handlers/pdf-export.ts` (edit — real implementation)
- `src/ipc/contracts.ts` (edit — new channel types per Riley's amendment)
- `src/ipc/register.ts` (edit — register new handlers)
- Test files for each new handler

#### Ravi (`database-specialist`)

- `migrations/0002_phase2_bookmarks.sql` — adds `parent_id INTEGER REFERENCES user_bookmarks(id) ON DELETE CASCADE` and `sort_order INTEGER NOT NULL DEFAULT 0`. Adds index `idx_user_bookmarks_parent_id`. Forward-only migration with example seed test.
- `src/db/repositories/bookmarks-repo.ts` (edit) — extend `BookmarksRepo` interface with `listTree(fileHash)`, `move(id, newParentId, newSortOrder)`, `rename(id, title)`. Existing `upsert`/`delete` remain backward-compatible.
- Migration test in `src/db/migrate.test.ts` — applying 0002 over an existing 0001 schema preserves all rows; `parent_id` defaults to NULL; reading via the new `listTree()` returns a hierarchical structure.
- Update `src/db/types.ts` to add `parent_id`/`sort_order` to `BookmarkRow`. David's adapter (`src/main/db-bridge.ts`) gets the camelCase translation; Riley reads from the contract.

**Files owned:**

- `migrations/0002_phase2_bookmarks.sql` (NEW)
- `src/db/repositories/bookmarks-repo.ts` (edit)
- `src/db/types.ts` (edit)
- `src/db/migrate.test.ts` (edit)
- `src/db/repositories/bookmarks-repo.test.ts` (edit — add tree/move/rename cases)

#### Riley (`front-end-architect`)

- UI for **edit-replay end-to-end**: confirm the existing `applyEdit` funnel and `dirtyOps` accumulator now flow through the real `fs:writePdf` `kind:'ops'` path. Remove the H-3 PHASE-1 INLINE comment + placeholder from `src/client/state/thunks.ts`.
- **Image import modal** (`src/client/components/modals/image-import-modal/`) — supports both "Insert as new page" and "Overlay on current page". Accepts PNG, JPEG, TIFF. Drag-drop onto a page in the canvas/thumbnail also triggers the overlay path with default placement.
- **Text-edit overlay** — a dual-mode renderer over the canvas. Mode 1: edit existing text spans (replace-only). Mode 2: existing FreeText annotation tool (already shipped Phase 1). New component `src/client/components/text-edit-overlay/`.
- **Bookmarks-authoring panel** rewrite. Tree component with drag-to-reorder, indent/outdent for nesting, inline rename. Replaces the read-only Phase-1 panel. Uses `@dnd-kit` (already a dep).
- **Print dialog wiring** — toolbar/menu Print → opens system print dialog (Electron handles UI) → calls `pdf:print`. Toolbar/menu Export-to-PDF → opens ExportEngineDialog (already drafted in Phase 1 UI spec §9.4) → calls real `pdf:export`.
- **Undo/redo UI** — activate the Phase-1 `historyMiddleware` shim (currently passive). Wire Ctrl+Z / Ctrl+Y shortcuts (already declared but disabled in `use-app-shortcuts.ts`). Add toolbar Undo/Redo buttons. Cap history at `undo.maxHistory` setting (already in contract).
- **Bundle Julian's MEDIUM findings into this wave** — E-1, E-2, G-5, I-2, I-3, I-4 from Phase 1.1 triage (§5.2). They're small UI fixes that align with surfaces being touched anyway.

**Files owned (NEW or substantive edits):**

- `src/client/components/modals/image-import-modal/` (NEW)
- `src/client/components/text-edit-overlay/` (NEW)
- `src/client/components/bookmarks-panel/index.tsx` (rewrite)
- `src/client/components/modals/print-export-dialog/` (NEW; or extend existing)
- `src/client/state/slices/document-slice.ts` (edit — new EditOperation variants)
- `src/client/state/slices/document-slice-apply.ts` (edit — new ops)
- `src/client/state/slices/document-inverses.ts` (edit — new inverses)
- `src/client/state/middleware/history-middleware.ts` (edit — activate)
- `src/client/state/thunks.ts` (edit — remove PHASE-1 INLINE, add image-import/text-edit/print/export thunks)
- `src/client/hooks/use-app-shortcuts.ts` (edit — enable Ctrl+Z/Y, F1 already handled in Phase 1.1)
- `src/client/types/ipc-contract.ts` (no change — pure re-export)
- Test files for all new components + slice tests for new ops

### 2.3 Wave 8 — Parallel infra + review + docs-start

#### Diego (`dev-ops-agent`)

- CI updates: new test patterns (Playwright e2e cases for image-import, print dialog, etc.). Verify `electron-builder.yml` still builds.
- If new native deps (e.g. `sharp` for TIFF) land, verify `electron-builder install-app-deps` covers them.
- Verify the renderer typecheck remains clean across the Phase-2 surface (TS4023 cascade should remain at 0 from Phase 1.1).
- Add Playwright component tests for the new Phase-2 modals.

#### Julian (`code-reviewer`)

- Full review of all Wave 7 code. Same template as Wave 2 audit (sections A-I). Mirror the verdict format. Expect HIGH findings — Phase 2 is much larger than Phase 1 implementation.
- Focus areas:
  - The replay engine's main-process trust boundary (David)
  - Image-embed path sanitization for TIFF decoder
  - Text-replace operation's safety on signed/encrypted PDFs
  - Migration 0002 rollback-safety
  - Undo/redo invariants on the expanded EditOperation set
  - Result-shape hygiene on the new handlers
- Output: `docs/code-review.md` is overwritten with the Wave 8 review (or appended with `## Wave 8` section; Julian decides). Phase-2 verdict written into `docs/build-report.md` by Marcus on join.

#### Nathan (`documentation-expert`)

- Starts the docs delta in parallel; final pass is Wave 9 sequential. Reason: many Phase 2 doc additions are predictable once Wave 7 is mid-flight (new IPC channels, new shortcuts) — Nathan can draft the api-reference + dev-guide delta while Julian is auditing.

### 2.4 Wave 9 — Nathan (sequential) — Final docs

- `README.md` — update Phase-2 status. Remove "Phase 1" badges where features now ship. Update install/run guidance if changed.
- `docs/user-guide.md` — delete "Coming in Phase 2" notes wherever the feature is now shipped. Update the Known Limitations section (Save fidelity is GONE as a limitation; new limitations may emerge from Julian's review). Add user-facing docs for image import, text editing, bookmarks authoring, printing, export. Add real screenshots if Diego's Wave 8 produced a green smoke run (operator-skill).
- `docs/developer-guide.md` — new IPC channels documented; new EditOperation variants; updated "Add an IPC channel" walkthrough if the steps changed.
- `docs/api-reference.md` — every new channel, every new error variant, every new event-stream phase added.
- `LICENSES.md` — re-walk node_modules if any new deps landed (TIFF decoder, etc.). Update license counts. Flag any non-permissive dep BEFORE Wave 9 closes (would force a Phase 2.1 dep swap).

### 2.5 Phase 2.1 (cleanup wave, conditional)

If Julian's Wave 8 review surfaces HIGH findings (>0), Marcus runs a Phase 2.1 wave mirroring Wave 3.5: small targeted agent dispatch to close the HIGH items. Triggered by Julian's verdict, not pre-scheduled.

## 3. File ownership table for Phase 2

One agent per file. Marcus enforces.

| Path                                                                                                 | Owner                                            | Note                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| `docs/architecture-phase-2.md` (NEW)                                                                 | Riley                                            | Wave 6                                          |
| `docs/edit-replay-engine.md` (NEW)                                                                   | Riley                                            | Wave 6                                          |
| `docs/api-contracts.md` (Phase-2 additions section)                                                  | Riley                                            | Wave 6; Phase-1 sections frozen                 |
| `docs/data-models.md` (Phase-2 additions section)                                                    | Riley                                            | Wave 6                                          |
| `docs/ui-spec.md` (Phase-2 additions section)                                                        | Riley                                            | Wave 6                                          |
| `docs/conventions.md` (Phase-2 additions, if any)                                                    | Riley                                            | Wave 6                                          |
| `docs/wave-7-brief.md` (NEW, future)                                                                 | Marcus                                           | After Wave 6 closes                             |
| `docs/wave-8-brief.md` (NEW, future)                                                                 | Marcus                                           | After Wave 7 closes                             |
| `docs/wave-9-brief.md` (NEW, future)                                                                 | Marcus                                           | After Wave 8 closes                             |
| `docs/build-report.md` (Phase-2 sections)                                                            | Marcus                                           | Per-wave append                                 |
| `docs/code-review.md`                                                                                | Julian                                           | Wave 8                                          |
| `migrations/0002_phase2_bookmarks.sql` (NEW)                                                         | Ravi                                             | Wave 7                                          |
| `src/db/**`                                                                                          | Ravi                                             | Wave 7                                          |
| `src/main/**`, `src/preload/**`, `src/ipc/**`                                                        | David                                            | Wave 7                                          |
| `src/client/**` (all renderer code)                                                                  | Riley                                            | Wave 7                                          |
| `package.json` (if new deps)                                                                         | Diego                                            | Wave 7-8; David requests, Diego approves + adds |
| `electron-builder.yml`, `.github/workflows/**`, `scripts/**`                                         | Diego                                            | Wave 8                                          |
| `README.md`, `docs/user-guide.md`, `docs/developer-guide.md`, `docs/api-reference.md`, `LICENSES.md` | Nathan                                           | Wave 8 (draft) + Wave 9 (final)                 |
| `.learnings/learnings.jsonl`                                                                         | Marcus appends serially per Hard-Won Playbook §1 | All waves                                       |
| `.learnings/locked-instructions.md`                                                                  | Marcus only                                      | All waves; L-001 must continue holding          |

### 3.1 Cross-cutting files where parallel-write contention risk is highest

- `src/ipc/contracts.ts` — David edits in Wave 7 to add new channel types. Riley **reads only**. Backward-compatibility policy from api-contracts §11 holds: if Riley needs a contract change, Marcus mediates a Riley-amendment-to-doc → David-edit cycle. **Pre-flight check Wave 7:** confirm Riley's Wave 6 contract additions are fully drafted before David starts the contract-edit pass.
- `docs/build-report.md` — Marcus only; no contention.
- `package.json` — Diego only; David requests deps, Diego adds.
- `.learnings/learnings.jsonl` — Marcus serializes appends per Hard-Won Playbook §1. Wave 7 agents return JSON-shape entries; Marcus writes them serially.

## 4. Risk register

### 4.1 HIGH risk: Edit-replay engine correctness

**Risk:** pdf-lib `import-and-modify` does not faithfully round-trip every existing-PDF feature. Common breakage modes:

- Form fields lose their appearance streams
- Embedded JavaScript actions get stripped
- Annotations not in pdf-lib's native subtype list disappear
- Compressed object streams (`/ObjStm`) get rewritten in ways that some viewers don't read

**Detection:** Wave 7 acceptance tests must include a round-trip fidelity matrix — open known-good PDFs (forms, annotated, signed, complex), apply _no edits_, save, diff against original. Any non-trivial diff is a finding.

**Mitigation:** the Chromium engine fallback already exists by design (ARCHITECTURE §6). When pdf-lib re-emit produces a diff against `pdflibLoadWarnings`, the heuristic should bias toward the Chromium fallback for that save. The user-facing fallback path is the safety net.

**Owner:** David Wave 7; Julian Wave 8 audit.

### 4.2 HIGH risk: Text-edit replace-only correctness on non-trivial PDFs

**Risk:** Text spans in PDFs are often split across multiple TJ/Tj operators, may use embedded subset fonts, may use multibyte encoding, may be laid out via CID fonts. Replace-only with original font still requires:

- Identifying the text-object boundary
- Computing the new glyph widths (even without reflow, the new string may not fit in the original box → clip or overflow)
- Preserving font metrics

Per locked decision P2-L-3, no reflow + no substitution. This makes the feature shippable but introduces edge cases the user can hit:

- "I replaced 'cat' with 'cataclysm' and it ran off the right edge of the box."
- "I replaced 'résumé' but the original font didn't have those glyphs."

**Mitigation:**

- Wave 6 architecture must specify the failure-mode UX: if the new text doesn't fit, warn the user with a tooltip / inline error. If glyphs are missing, show "missing glyph" indicators in the preview before commit.
- Test fixtures: a `tests/fixtures/text-replace/` set covering single-line, multi-line, mixed-encoding, missing-glyph cases. Document the documented limitations in the user guide.

**Owner:** Riley Wave 6 (UX); David Wave 7 (engine); Nathan Wave 9 (docs).

### 4.3 MEDIUM risk: TIFF decoder license + binary size

**Risk:** `sharp` (the highest-fidelity option) pulls native binaries and is `Apache-2.0` but with large binary footprint. `utif` is pure-JS MIT but limited fidelity on uncommon TIFF subtypes. Adding either grows the installer by 10-40 MB.

**Mitigation:**

- Default to `utif` first (pure-JS MIT). Only escalate to `sharp` if real-user TIFFs fail the decode path.
- Document TIFF support level honestly in user guide: "Common single-page TIFF (LZW, deflate, uncompressed) supported. Multi-page TIFF Phase 3."
- License check before merge. `utif` is on the allow-list per ARCHITECTURE §3.

**Owner:** David Wave 7; Diego Wave 8 (binary size); Nathan Wave 9 (docs).

### 4.4 MEDIUM risk: Bookmarks migration on existing user databases

**Risk:** Users who installed Phase 1 have `0001_init.sql` applied. Migration `0002_phase2_bookmarks.sql` must:

- Add `parent_id` and `sort_order` columns without locking the table excessively
- NULL parent_id is the valid "top-level" state — every existing bookmark becomes a top-level bookmark
- Forward-only; no rollback expected (per data-models §6.3)

**Detection:** Wave 7 test (Ravi) — start from a Phase-1 schema with rows, apply 0002, verify no row loss, verify NULL parent_id behavior.

**Mitigation:** Standard ALTER TABLE in SQLite is safe and atomic in WAL mode. Risk is low; the call-out is mostly to ensure Ravi writes the test.

**Owner:** Ravi Wave 7.

### 4.5 MEDIUM risk: Print-to-PDF dual-engine heuristic regression

**Risk:** The Phase-1 contract reserved `pdf:export` shape but the engine never ran. Phase 2 wires the real selector. If the heuristic picks pdf-lib when it should pick Chromium (e.g. on a doc with `/Ink` annotations), users get visually-broken output and blame the app.

**Mitigation:**

- Wave 6 specifies the heuristic in extreme detail (already done in ARCHITECTURE §6.1 — but verify the table is exhaustive).
- Wave 7 test: a corpus of fixture PDFs each tagged with the expected engine choice. CI fails if the heuristic picks the wrong engine.
- User-override path is shipped (`preference: 'pdf-lib' | 'chromium' | 'auto'` in `pdf:export`); when the heuristic loses, the user can force the other engine.

**Owner:** David Wave 7; Julian Wave 8.

### 4.6 MEDIUM risk: Renderer `Uint8Array`-in-store ban + main bytes retention

**Risk:** Conventions §10 forbids `Uint8Array` in the Redux store. Phase 2's edit-replay design (P2-L-2) puts the bytes in main, not the renderer. **This is the right call** — renderer stays light, main owns the buffers. But the boundary requires discipline: any thunk that needs document bytes for any reason must go through an IPC channel, not pull them into the store.

**Detection:** Julian Wave 8 grep for `Uint8Array` in any file under `src/client/state/`.

**Mitigation:** Convention §10 is already the locked rule. Riley's `pdf-edit.ts` interface (which currently takes `originalBytes` as a parameter) needs renaming or refactoring to make it clear that `originalBytes` only ever transits through an IPC path, never lives in store.

**Owner:** Riley Wave 7 (refactor); Julian Wave 8 (audit).

### 4.7 LOW risk: Memory pressure on large PDFs with many edits

**Risk:** A 500MB PDF + 10 image overlays + 200 ops could pressure main-process memory. The current `DocumentStore` is single-document Phase 1; Phase 2 still single-document but with persistent original bytes per handle.

**Mitigation:** Phase 1 already caps file open at 500MB (`open.maxFileSizeMB` setting). Document.released on `fs:closePdf`. Streaming via `pdf:export:progress` for >50MB outputs. No additional Phase-2 work required; revisit in Phase 5 (multi-document) if needed.

**Owner:** N/A Phase 2; flag for Phase 5.

## 5. Acceptance criteria for Phase 2 ship

All testable. Each row maps to a runnable verification.

### 5.1 Functional

- [ ] Open a Phase-1-saved PDF (no ops) and re-save → output byte-identical to input (modulo pdf-lib's deterministic re-emit signature).
- [ ] Open a PDF, apply 5 page reorders + 3 rotate-90s, save → re-open → page order and rotation match.
- [ ] Open a PDF, insert a page from disk, save → re-open → inserted page in correct position.
- [ ] Open a PDF, delete a page, save → re-open → page is gone.
- [ ] Open a PDF, add a Highlight annotation, save → re-open in PDF_Viewer_Editor → annotation present at correct rect. Re-open in Adobe Acrobat / Chrome → annotation present and renders.
- [ ] Open a PDF, add a FreeText annotation, save → re-open in both viewers → annotation present.
- [ ] Replace a text span (single-line, ASCII, fits in original box) → save → re-open → replacement visible.
- [ ] Insert PNG image as new page → save → re-open → page present.
- [ ] Insert PNG image as overlay on page 3 → save → re-open → overlay present at correct rect.
- [ ] Insert JPEG image (both modes) → save → re-open → present.
- [ ] Insert TIFF image (single-page, LZW or uncompressed) → save → re-open → present.
- [ ] Create a bookmark; nest it under another bookmark; reorder; rename; delete → all operations persist across app restart.
- [ ] Print to physical printer → system print dialog appears; spool job lands at the printer.
- [ ] Print to PDF (pdf-lib engine forced) → output PDF opens in Adobe Acrobat without warnings.
- [ ] Print to PDF (Chromium engine forced) → output PDF opens in Adobe Acrobat; warnings about subset font are acceptable.
- [ ] Undo (Ctrl+Z) reverses last operation; Redo (Ctrl+Y) re-applies. Works across page ops, annotations, text edits, image inserts, bookmarks.
- [ ] Undo history is capped at `undo.maxHistory` setting; oldest entries drop FIFO.

### 5.2 Non-functional

- [ ] `fs:writePdf` `kind:'ops'` never returns `invalid_payload` for a contract-valid payload (the H-3 Phase-1 limitation is gone).
- [ ] Renderer Redux store contains zero `Uint8Array` references (grep + Julian audit).
- [ ] Conventions §10 holds (renderer holds handle, main holds bytes).
- [ ] L-001 holds (`enableDragDropFiles` not set to false).
- [ ] Cold renderer typecheck reports 0 TS4023 errors.
- [ ] CI is green on Windows + Linux.
- [ ] Installer builds successfully (`npm run dist:win`) with no schema-validation errors.
- [ ] Smoke launch: open → image-import → text-edit → bookmark-create → save → restart → all changes survive.

### 5.3 Documentation

- [ ] `docs/user-guide.md` removes "Save does not preserve edits" warning (H-3 closed).
- [ ] `README.md` Phase 1 limitations section is rewritten or removed.
- [ ] `docs/api-reference.md` documents every new channel.
- [ ] `docs/developer-guide.md` walks through "Add a new EditOperation variant" end-to-end.
- [ ] `LICENSES.md` updated for any new transitive deps.

### 5.4 Security / Quality

- [ ] Julian's Wave 8 verdict is GREEN or YELLOW-with-closable-HIGHs. RED triggers a Phase 2.1 wave; ship does not happen until GREEN.
- [ ] All new handlers use `safeMessage()` (no raw `(e as Error).message` to user-facing toasts).
- [ ] All new handlers' tests use `expectErr<E>` / `expectOk` from `src/ipc/handlers/test-support.ts` (added in Phase 1.1).
- [ ] No raw absolute paths leak to renderer (destination-token discipline preserved across new image-import + text-edit + print flows).

## 6. Out of scope for Phase 2

Hard scope-fence. These items are valid asks but NOT Phase 2:

- AcroForms detection or filling (Phase 3)
- Mail merge (Phase 3)
- Signature capture / placement (Phase 4)
- Full annotation toolset beyond the Phase-2 subtype list (Square/Circle/Line are Phase 4)
- Scan / OCR (Phase 5)
- Office export — docx, xlsx, pptx (Phase 6)
- macOS / Linux packaging (Phase 7)
- Auto-update (Phase 7)
- Accessibility full audit (Phase 7)
- Localization (Phase 7)

If a Phase-2 wave brief asks for something on this list, Marcus rejects it as scope-creep and routes to the right phase.

## 7. Open questions for Riley to address in Wave 6

These get answered in `docs/architecture-phase-2.md`:

1. **Op ordering** — are EditOperations applied in dispatch order, or is there a topological reorder (e.g. all reorders before all annotations)? What if a reorder and an annotation on the same page index disagree?
2. **Partial-failure rollback** — if op #7 of 10 fails, do ops 1-6 commit and we report partial success, or does the whole save abort?
3. **Atomic save** — is the new PDF written to a temp file then renamed (atomic on the filesystem), or written directly? What if the rename fails after the write?
4. **Original bytes lifetime** — when the user has a 500MB doc open and does no edits for an hour, are the bytes still in main? Or do we evict and re-read on save?
5. **Image embedding caching** — same image dropped on 5 different pages — embed once and reference, or embed five times? pdf-lib's `embedPng`/`embedJpg` return reusable refs.
6. **Print-to-PDF determinism** — pdf-lib re-emit is deterministic; Chromium printToPDF is not (timestamps in metadata). Document the difference; consider stripping timestamps for reproducible-build users.
7. **Text-edit span identification** — how does the renderer pick a text span to edit? Click + double-click into a text box? Selection of a substring? Riley designs the interaction.

## 8. Estimated wave durations

| Wave                            | Agent(s)                         | Estimated wall-time | Confidence                                                 |
| ------------------------------- | -------------------------------- | ------------------- | ---------------------------------------------------------- |
| 6 — Phase 2 architecture        | Riley solo                       | 3-5 hours           | Medium-high (Riley has done one architecture pass already) |
| 7 — Implementation              | David + Ravi + Riley parallel    | 8-12 hours          | Medium (replay engine is the unknown)                      |
| 8 — Infra + review + docs start | Diego + Julian + Nathan parallel | 4-6 hours           | High                                                       |
| 9 — Final docs                  | Nathan solo                      | 2-3 hours           | High                                                       |
| Phase 2.1 cleanup (if needed)   | TBD                              | 1-3 hours           | Conditional                                                |
| **Total**                       |                                  | **18-29 hours**     |                                                            |

Phase 2 is roughly 2-3x the scope of Phase 1.

## 9. Dispatch sequence

1. Phase 1.1 wave (Wave 5) — closes GREEN per `docs/phase-1.1-brief.md`.
2. Marcus appends Phase 1.1 join to `build-report.md`.
3. Wave 6 dispatch — Riley solo, sequential. Brief: `docs/wave-6-brief.md`.
4. Marcus integration-check on Wave 6 deliverables; spot-check `docs/architecture-phase-2.md` + `docs/edit-replay-engine.md` exist and answer the §7 open questions.
5. Wave 7 dispatch — David + Ravi + Riley parallel. Briefs: `docs/wave-7-brief.md` (Marcus writes after Wave 6 closes).
6. Marcus join; spot-check H-3 Phase-1 limitation is closed (grep for "PHASE-1 INLINE" in source — should be 0 hits).
7. Wave 8 dispatch — Diego + Julian + Nathan parallel. Briefs: `docs/wave-8-brief.md`.
8. Marcus join; Julian verdict drives Phase 2.1 decision.
9. Wave 9 dispatch — Nathan solo, sequential.
10. Phase 2.1 wave only if Julian's Wave 8 verdict has HIGH findings.
11. Phase 2 ship.

## 10. Honesty obligations

Phase 2 is when the H-3 Phase-1 fidelity boundary closes. **Every doc that mentioned the limitation must be updated in Wave 9.** Specifically:

- README "Phase 1 known limitations" section — H-3 mention removed.
- `docs/user-guide.md` opening "Known Limitations in Phase 1" section — rewrite or remove. New section: "Phase 2 limitations" enumerating the real ones (e.g. "Text replace cannot reflow", "TIFF support is single-page only", "Print uses system dialog").
- `docs/user-guide.md` Saving section — remove the "edits are not preserved" repeat.
- Any tooltip/toast string in the codebase referencing the limitation — remove or rewrite.

Failing to close the doc loop is a regression on Wave 4 Nathan's "three impressions of honest message" pattern. Nathan Wave 9 must verify all three impressions are now consistent with the new reality.
