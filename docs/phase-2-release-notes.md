# Phase 2 release notes — 0.2.0

**Release date:** 2026-05-21
**Codename:** Functional editor

PDF_Viewer_Editor 0.2.0 is the **functional editor** release. Phase 1 was the walking skeleton — the architecture was proven end-to-end but Save didn't yet preserve edits. Phase 2 lights up the fidelity layer plus ships printing, image import, text editing, and bookmarks authoring.

---

## What's new in 0.2.0

- **Save preserves edits.** The pdf-lib edit-replay engine ships. Every edit you make (rotation, deletion, reorder, insert-blank, annotation, image import, text replace, bookmark op) is written into the saved bytes via an atomic temp-rename pipeline. The Phase 1 "Save does not preserve your edits" caveat is **retired**.
- **Print to physical printer.** Ctrl+P (or File → Print) dispatches a job through the system print dialog via Electron `webContents.print()`.
- **Print to PDF.** Ctrl+Shift+P (or File → Print to PDF) exports the document to a new PDF via either the pdf-lib engine (default, byte-stable, deterministic, fast) or the Chromium engine (fallback for documents with unauthorable annotations, ≥10 overlay objects per page, or text-replace ops). Engine choice is automatic by heuristic; manual override available in Settings → Export.
- **Image import.** PNG, JPEG, and TIFF (first page only) imports as a new page OR as an overlay on an existing page. Shortcut: Ctrl+I.
- **Text editing (replace-only, original font).** Click a text run, type a replacement, press Enter. The engine writes the replacement into the saved bytes through pdf-lib at the original run's position. Failure modes: `clipped` (replacement wider than the original run's width) and `missing_glyph` (character not in the original font). Shortcut: Ctrl+E (toggle text-edit mode).
- **Bookmarks authoring (full CRUD tree).** Create, rename, nest, reorder, delete. Drag-and-drop with cycle detection. Stored per-file in SQLite, keyed by file hash.
- **Undo / Redo across all ops.** Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z). Page ops, annotation ops, image ops, text ops, bookmark ops — all undoable. The history middleware handles image-bearing ops correctly: bytes survive undo/redo even though the storage form is compacted.

---

## Known limitations in 0.2.0

| Limitation | Ships in |
|---|---|
| Text editing is replace-only with the original font (no reflow, no font substitution, no multilang shaping) | Phase 4 |
| TIFF imports use the first page only (multi-page TIFF extraction is a candidate Phase 2.5 ticket) | Phase 2.5 |
| Cross-op-chain undo is not compacted (each undo press unwinds one op at a time) | Phase 3 |
| Bookmarks are scoped to a single file (cross-file navigation not supported) | Phase 5+ |
| No in-app print preview pane (the OS dialog has its own preview) | Phase 3 |
| Chromium-engine output bytes are non-deterministic; forms / signatures / embedded JavaScript are flattened in Chromium output | Force `pdf-lib` for deterministic / structure-preserving exports |
| `pdf:identifyTextSpan` real content-stream walker is stubbed (channel returns `no_text_at_point`; renderer-cached metrics carry the text-edit UX) | Phase 2.5 |
| `MoveBookmarkResult` `invalid_parent` (parent doesn't exist or belongs to a different file) surfaces on the wire as `invalid_payload` because `api-contracts.md` §12.6 doesn't define a dedicated variant | Phase 2.5 (contract amendment) |
| File-association installer checkbox works on install; SmartScreen warning still present (binaries unsigned) | Code signing in a later milestone |
| Find / search within document | Phase 3 |
| Forms (designer, fill, mail-merge from CSV/Excel) | Phase 3 |
| Fill & sign (typed/drawn/image signature) | Phase 4 |
| Scan from TWAIN/WIA + OCR | Phase 5 |
| Export to Word / Excel / PowerPoint / image | Phase 6 |
| macOS / Linux builds | Phase 7 |
| Auto-update | Phase 7 |

Full per-feature detail: [`user-guide.md` → Known limitations in Phase 2](user-guide.md#known-limitations-in-phase-2).

---

## Breaking changes from 0.1.0

**None.** The Phase 2 design is additive. All Phase 1 features continue to work unchanged. The IPC contract gained 8 new channels (`fs:applyEditOps`, `pdf:embedImage`, `pdf:replaceText`, `pdf:identifyTextSpan`, `pdf:print`, `bookmarks:listTree`, `bookmarks:move`, `bookmarks:rename`) plus retired the Phase 1 `pdf:export` stub (now LIVE), but no existing channel's request/response shape changed.

---

## Upgrade notes (from 0.1.0)

- **Your data survives.** Recents, settings, and any Phase 1 bookmarks (read-only outline view) carry forward through the schema-v2 migration (`migrations/0002_phase2_bookmarks.sql`). The migration runs automatically on first launch of 0.2.0; no manual action needed.
- **Bookmarks become editable.** Phase 1 bookmarks were a read-only view of the native PDF outline. Phase 2 adds a Bookmarks panel with CRUD; the underlying storage is the same SQLite `user_bookmarks` table, now with `parent_id` and `sort_order` columns (added by the schema-v2 migration).
- **New settings keys.** The settings registry gained: `export.defaultEngine` (`'auto' | 'pdf-lib' | 'chromium'`, default `auto`), `export.showWarningsToast` (boolean, default `true`), `annotation.authorDefault` (string), `undo.maxHistory` (number, default 100). New keys are created on first use; existing settings carry over unchanged.
- **Save behavior changes.** In 0.1.0, Save wrote a valid PDF but did NOT preserve your edits (the H-3 walking-skeleton boundary). In 0.2.0, Save writes a valid PDF with your edits intact. **This is a behavior change you should know about if any 0.1.0-saved-file expectations are baked into your workflow** — re-save your 0.1.0 files in 0.2.0 to get edits-preserved output.
- **License unchanged: MIT** (no change from Phase 1.1).
- **Build artefacts.** 0.2.0 installer and portable filenames bump from `PDF Viewer & Editor-0.1.0-x64.exe` to `PDF Viewer & Editor-0.2.0-x64.exe`. Existing 0.1.0 install can be upgraded by running the 0.2.0 installer over it (NSIS uninstalls cleanly, then installs the new version; user data under `%APPDATA%/PDF Viewer & Editor/` is preserved).

---

## Phase 1.1 archive (historical)

The Phase 1.1 cleanup (2026-05-21) added the MIT `LICENSE` file at the repo root, resolved the TS4023 renderer typecheck cascade (by dropping `composite: true` from `tsconfig.renderer.json`), and laid the groundwork for Phase 2. See [`build-report.md`](build-report.md) for the wave-by-wave detail.

---

## What's next

See [`project-roadmap.md`](project-roadmap.md) for the full phased plan. The headline:

- **Phase 3** — forms (designer, fill, mail-merge from CSV/Excel), find / search within document, print preview pane, cross-op-chain undo compaction
- **Phase 4** — fill & sign (typed/drawn/image signature), text editing with reflow + font substitution + multilang shaping
- **Phase 5** — scan from TWAIN/WIA + OCR, cross-file bookmark navigation
- **Phase 6** — export to Word / Excel / PowerPoint / image
- **Phase 7** — macOS / Linux packaging, auto-update, accessibility audit, localization, code signing
