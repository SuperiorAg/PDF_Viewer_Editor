# Wave 9 brief — Phase 2 documentation update

**From:** Marcus (orchestration-manager), 2026-05-21
**Wave 8.5 outcome:** GREEN at engine + bridge + handler + lint surface. All 2 BLOCKERs (B-1 reorder, B-2 insert-original/image) + HIGH H-1 (`MoveBookmarkResult` end-to-end) + HIGH H-2 (ESLint `no-restricted-imports` for `src/ipc/contracts`) closed at source. The H-3 walking-skeleton fidelity boundary is RETIRED at the engine + handler integration level (`h3-retirement.test.ts` passes).
**Wave 9 agent:** Nathan (documentation-expert) — runs in PARALLEL with Julian's Phase 2 re-audit (zero file overlap; Julian writes `docs/code-review.md`, Nathan owns the user-facing doc surface).
**Sequential prereq:** Wave 8.5 closure verified on disk (per the Wave 8.5 build-report status rows). Wave 9 dispatch happens regardless of Julian's re-audit outcome — Nathan's deliverables document what Phase 2 _ships_, not what Julian _blessed_. If Julian re-audit produces a Wave 9.5 finding that contradicts a Nathan doc, the doc is amended in Wave 9.5 (cheap; one editor's pass).
**Phase 2 close:** Wave 9 is the final wave of Phase 2. Nathan's outputs CLOSE the phase.

Nathan reads this brief end-to-end before starting. Then reads, in order:

1. `.learnings/locked-instructions.md` — L-001 must survive every doc claim
2. `.learnings/learnings.jsonl` — last 27 entries (the full Phase 1 + Phase 2 lesson stream; Nathan needs the H-3 closure lineage in particular)
3. `docs/build-report.md` — Wave 6 + Wave 7 + Wave 8 + Wave 8.5 sections in full
4. `docs/architecture-phase-2.md` (Riley, frozen) — entire doc
5. `docs/edit-replay-engine.md` (Riley, frozen) — §10 atomic save, §12 fidelity matrix, §4 op handlers
6. `docs/api-contracts.md` §12 (Phase 2 channels, frozen)
7. `docs/data-models.md` §7 (Phase 2 schemas, frozen) + §7.5 Wave 8.5 amendment banner (Marcus + David)
8. `docs/ui-spec.md` §11 (Phase 2 UI surface, frozen)
9. `docs/conventions.md` §13 (Phase 2 conventions, frozen)
10. `docs/code-review.md` — Julian's Wave 8 Phase 2 review section + the Wave 8.5 re-audit section (in-flight as Nathan works; Nathan may need to re-read at the close of his wave if Julian lands first)
11. The existing Phase 1 docs Nathan wrote in Wave 4 + Wave 5 (`README.md`, `docs/user-guide.md`, `docs/developer-guide.md`, `docs/api-reference.md`, `LICENSES.md`) — these are Nathan's own prior output; Wave 9 amends them in place

---

## Background — what Phase 2 actually ships (the honesty baseline)

The hard constraint from Nathan's Wave 4 brief still applies: **no aspirational claims.** A doc that says "Save preserves your edits" only ships if Save actually does. A doc that says "Print works" only ships if Print actually dispatches a job. The Phase 1 fidelity-boundary discipline (three impressions of the H-3 limitation: README front, user-guide top, Saving section) was the trust floor; Wave 9 inherits that discipline applied to the Phase 2 surface.

### What is now LIVE on disk

| Feature                                                                                                                  | Status   | Channel(s)                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit-replay engine (`replay()`, 11 op-handlers, fold-then-emit, atomic save, image-cache dedup, byte-stable determinism) | LIVE     | `fs:applyEditOps`                                                                                                                                              |
| Save fidelity (H-3 RETIRED)                                                                                              | LIVE     | `fs:save` calls `fs:applyEditOps` directly — no PHASE-1 INLINE block                                                                                           |
| Print-to-PDF (pdf-lib default engine)                                                                                    | LIVE     | `pdf:exportToPdf` (engine: `pdf-lib`)                                                                                                                          |
| Print-to-PDF (Chromium fallback engine)                                                                                  | LIVE     | `pdf:exportToPdf` (engine: `chromium`) — wired by Diego in Wave 8 via offscreen BrowserWindow + `webContents.printToPDF()` with L-001 security floor preserved |
| Print to physical printer                                                                                                | LIVE     | `pdf:print` — `webContents.print()` dispatch wired by Diego in Wave 8                                                                                          |
| Image import as new page                                                                                                 | LIVE     | `pdf:embedImage` (mode: `new-page`)                                                                                                                            |
| Image import as overlay on existing page                                                                                 | LIVE     | `pdf:embedImage` (mode: `overlay`)                                                                                                                             |
| PNG/JPEG support                                                                                                         | LIVE     | embedded via pdf-lib `embedPng` / `embedJpg`                                                                                                                   |
| TIFF first-page support                                                                                                  | LIVE     | `utif` decoder (added by Diego in Wave 8) — multi-page TIFF uses first page only                                                                               |
| Text editing (replace-only with original font)                                                                           | LIVE     | `pdf:replaceText` + `pdf:identifyTextSpan`                                                                                                                     |
| Bookmarks authoring (full CRUD tree, cycle detection, drag-reorder, drag-nest)                                           | LIVE     | `bookmarks:listTree`, `bookmarks:move`, `bookmarks:rename` + Phase-1 `bookmarks:create`/`bookmarks:delete`                                                     |
| Undo/redo across all Phase 1 + Phase 2 ops                                                                               | LIVE     | renderer history middleware (`history-middleware.ts`) — re-entrancy flag `meta.__history`                                                                      |
| Schema v2                                                                                                                | LIVE     | `migrations/0002_phase2_bookmarks.sql` runs on first launch of 0.2.0                                                                                           |
| Renderer-gatekeeper boundary                                                                                             | ENFORCED | ESLint `no-restricted-imports` (Wave 8.5 H-2) catches direct imports of `src/ipc/contracts` from `src/client/`                                                 |

### What Phase 2 does NOT do (the honest limitations)

| Limitation                                                                                     | Why                                                                                                                                             | Ships in                                                                                            |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Text editing requires the original font; no reflow                                             | P2-L-3 lock — multilang shaping is a Phase 4+ effort                                                                                            | Phase 4 (font substitution + reflow)                                                                |
| Missing-glyph rendering returns `missing_glyph` error                                          | Direct consequence of replace-only with original font                                                                                           | Phase 4                                                                                             |
| TIFF multi-page imports use first page only                                                    | `utif` decoder ships first page; multi-page extraction would be a small Phase 2.5 ticket                                                        | Phase 2.5 (potential ticket)                                                                        |
| `pdf:identifyTextSpan` scanner returns `no_text_at_point` for hit-testing                      | Renderer-cached font-metrics work as designed (per architecture-phase-2.md §4.3); real content-stream walker is Phase 2.5                       | Phase 2.5                                                                                           |
| Cross-op-chain undo of inserts (e.g. undo across a delete→insert→reorder sequence)             | History middleware is single-op-inverse; multi-op compaction is Phase 3 scope                                                                   | Phase 3                                                                                             |
| `invalid_parent` from bookmarks repo maps to IPC `invalid_payload` (no dedicated wire variant) | api-contracts.md §12.6 `BookmarksMoveError` union doesn't include `invalid_parent`; David's Wave 8.5 boundary translation per brief constraints | Phase 2.5 ticket: add `'invalid_parent'` variant to `BookmarksMoveError` + dedicated renderer toast |
| Bookmarks scope is single-file                                                                 | parent_id FK is scoped per `fileHash`; cross-file bookmark navigation is Phase 5+                                                               | Phase 5+                                                                                            |
| Print preview before dispatch                                                                  | `pdf:print` dispatches direct via `webContents.print()`; no in-app preview pane                                                                 | Phase 3 (preview pane + print settings UI)                                                          |
| Forms (fill / design / mail-merge)                                                             | Phase 3 scope                                                                                                                                   | Phase 3                                                                                             |
| Fill & sign                                                                                    | Phase 4 scope                                                                                                                                   | Phase 4                                                                                             |
| Scan + OCR                                                                                     | Phase 5 scope                                                                                                                                   | Phase 5                                                                                             |
| Office export (Word / Excel / PowerPoint)                                                      | Phase 6 scope                                                                                                                                   | Phase 6                                                                                             |
| macOS / Linux packaging                                                                        | Phase 7 scope                                                                                                                                   | Phase 7                                                                                             |
| Auto-update                                                                                    | Phase 7 scope                                                                                                                                   | Phase 7                                                                                             |
| Code signing                                                                                   | A later milestone — SmartScreen warning is the cost; Phase 1 README language stays accurate                                                     | Later                                                                                               |

### Test counts to cite

Per the Wave 8.5 verification matrix and pre-existing renderer count from Wave 7:

| Suite                           | Pass count (post Wave 8.5)                                                                                                                                                              | Pre-Phase-2 baseline |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `src/main` + `src/ipc` (Vitest) | **224/224** in 29 test files (Wave 8.5 added +11 — B-1 reorder ×5, B-2 insert ×6)                                                                                                       | 86/86 (pre-Wave 7)   |
| `src/client` (Vitest)           | **94/94** in 9 spec files (Wave 7 added +25 — image-import-modal, text-edit-overlay, bookmarks-slice, history-middleware, document-inverses; Wave 8.5 +8 — `document-inverses.test.ts`) | 61/61 (pre-Wave 7)   |
| `src/db` (Vitest)               | **37/37** when better-sqlite3 ABI matches the host Node (CI on Node 20 LTS; local dev on Node 24 fails ABI per Diego's Wave 3 lesson)                                                   | n/a                  |
| Total Phase-2 close             | **355/355** when ABI matches                                                                                                                                                            | 147 (pre-Wave 7)     |

Nathan cites the test-count numbers but does NOT claim they cover every edge case — the developer guide explicitly notes the Phase 2 test gaps Julian's audit will surface (e.g. cross-op-chain undo not covered; pdf-lib upgrade determinism guarded by the golden-bytes test in `replay-engine.test.ts`).

---

## Triage of Phase 2 surface to update (per existing doc Nathan owns)

| #   | Doc                                   | Phase 1 status                                               | Phase 2 update scope                                                                                                                                                                                                      |
| --- | ------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `README.md`                           | "0.1.0 walking skeleton"                                     | "0.2.0 functional editor"; retire H-3 limitation language; promote 5 Phase 2 features; add new limitations section                                                                                                        |
| 2   | `docs/user-guide.md`                  | Phase 1 feature walkthrough w/ "coming soon" toasts          | Add 5 NEW sections (Printing, Print to PDF, Importing images, Editing text, Working with bookmarks); rewrite Saving section; rewrite Known Limitations section; update shortcuts table                                    |
| 3   | `docs/developer-guide.md`             | Phase 1 architecture overview                                | Add edit-replay engine architecture; add "How to add an EditOperation variant" walkthrough; update IPC reference card; update Common Pitfalls (H-1 lesson + H-2 lesson); update test counts                               |
| 4   | `docs/api-reference.md`               | Phase 1 IPC channel cards                                    | Append Phase 2 channels section (8 channels listed below); add `MoveBookmarkResult` discriminated union with invalid_parent → invalid_payload boundary note                                                               |
| 5   | `LICENSES.md`                         | Phase 1.1 walk (1 undeclared resolved by `concurrently 9.x`) | Verify `utif@^3.1.0` row Diego added in Wave 8 is present + correctly attributed; re-run a license walk if any other deps surfaced through Phase 2 (probably not — confirm by diff); update "Scan basis" date             |
| 6   | `docs/phase-2-release-notes.md` (NEW) | n/a                                                          | One-page user-facing changelog: What's new, Known limitations, Breaking changes (probably none — design was additive), Upgrade notes (recents/settings/bookmarks survive schema v2 migration via `migrations/0002_*.sql`) |

---

## Nathan — Wave 9 task list (documentation-expert)

**Files Nathan may touch (Phase 2 update):**

- `README.md`
- `docs/user-guide.md`
- `docs/developer-guide.md`
- `docs/api-reference.md`
- `LICENSES.md` (only if deps changed since Wave 8 — usually a verify-and-amend-intro task)
- `docs/phase-2-release-notes.md` (NEW — Nathan creates)

**Files Nathan must NOT touch (frozen / owned by others):**

- Any source under `src/`
- Any Wave 1 frozen doc: `ARCHITECTURE.md`, `docs/conventions.md`, `docs/api-contracts.md`, `docs/data-models.md`, `docs/ui-spec.md`
- Any Wave 6 frozen doc: `docs/architecture-phase-2.md`, `docs/edit-replay-engine.md`
- Marcus's docs: `docs/project-plan.md`, `docs/project-roadmap.md`, `docs/wave-*-brief.md`, `docs/phase-*-plan.md`, `docs/build-report.md` (Nathan appends ONE status row at wave-close per Wave 4 + Wave 5 precedent; no other edit)
- Julian's `docs/code-review.md`
- Diego's: `package.json`, `electron-builder.yml`, `.github/`, `scripts/`, `tsconfig.*.json`, ESLint/Prettier configs, `electron.vite.config.ts`
- `LICENSE` (the file at repo root — Nathan's own Wave 5 work, no Phase 2 changes needed; the file is the MIT text + copyright line, not a changelog)
- `.learnings/locked-instructions.md` (L-001 untouched — Nathan reads, never writes)

---

### N-9.1 — `README.md` update

Replace the **Status banner** (line 5 of current README) to reflect Phase 2:

```markdown
> **Status — Phase 2 functional editor (0.2.0).** The app opens PDFs, renders them, edits pages and annotations, **and saves them with edits preserved**. Phase 2 ships print to physical printer, print-to-PDF (dual engine: pdf-lib default + Chromium fallback), image import (PNG/JPEG/first-page TIFF as new page or overlay), text editing (replace-only with the original font), bookmarks authoring (full CRUD tree), and undo/redo across all edit operations. See [Phase 2 known limitations](#phase-2-known-limitations) for the honest scope-fence.
```

(Nathan uses whatever version string Diego stamps in `package.json` at Wave 8/8.5 close. If `package.json` still says `0.1.0`, Nathan notes the discrepancy in his status row and uses `0.2.0` as the documented version — Diego stamps via a Wave 9.5 patch if needed. Doc-vs-config drift is a known surface; cross-grep before writing the README.)

Rewrite the **"What this is"** paragraph (lines 9–13) to drop "walking skeleton" framing:

```markdown
PDF_Viewer_Editor is a desktop PDF tool built with Electron, TypeScript, and React. It uses **only permissively licensed PDF libraries** (pdf.js, pdf-lib) — no AGPL components, no commercial SDKs, no per-seat licensing.

Phase 2 layers a real edit-replay engine, printing, image import, text editing, and bookmarks authoring on top of the Phase 1 architecture. The architectural pipe was proven in Phase 1; Phase 2 is where fidelity lands. Forms, signing, OCR, and Office export ship in later phases. See the [project roadmap](docs/project-roadmap.md) for the phased plan.
```

Update the **Use** section (lines 40–50) feature bullet list. Phase 1 had 6 bullets ending with the "produces a valid PDF (see fidelity note below)" Save bullet. Phase 2 list:

- Open and read a PDF (unchanged)
- Navigate with zoom, pan, and thumbnails (unchanged)
- Edit pages in memory — drag-reorder, insert blank, delete, rotate, **insert image as page or overlay**, **edit text on existing pages**
- Combine multiple PDFs (unchanged)
- Annotate (unchanged)
- **Bookmarks** — create, rename, nest, reorder a full bookmark tree
- **Save the result** — produces a valid PDF with all edits preserved
- **Print to PDF** — exports via pdf-lib (default) or Chromium (fallback when the heuristic detects unauthorable annotations)
- **Print** — dispatches to the system print dialog via Electron `webContents.print()`
- **Undo / Redo** — across page ops, annotation ops, image ops, text ops, and bookmark ops

Rewrite the **Phase 1 known limitations** section header to **Phase 2 known limitations**. Move the H-3 paragraph OUT (Save preserves edits now). Add the new limitations table. Cross-reference user-guide for full text. Pattern:

```markdown
## Phase 2 known limitations

The full list lives in the [user guide](docs/user-guide.md#known-limitations-in-phase-2). The headline limitations:

- **Text editing is replace-only with the original font.** No reflow, no font substitution, no multilang shaping. Replacing text that doesn't fit the original glyph run width returns a `clipped` failure; replacing with glyphs the original font doesn't support returns `missing_glyph`. Reflow + font substitution ships in Phase 4.
- **TIFF imports use the first page only.** Multi-page TIFF extraction is a Phase 2.5 candidate.
- **Cross-op-chain undo is not supported.** Undo unwinds one op at a time (the inverse of the most recent op). Compaction of a delete→insert→reorder sequence into a single undo step ships in Phase 3.
- **Bookmarks are scoped to a single file.** Cross-file navigation ships in Phase 5+.
- **No print preview before dispatch.** Phase 3 adds a preview pane and print settings UI.

Other limitations (forms, signing, OCR, Office export, macOS/Linux packaging, auto-update, code signing) — see [user guide](docs/user-guide.md#known-limitations-in-phase-2) and [roadmap](docs/project-roadmap.md).
```

Retire the `### Phase 1.1 updates (2026-05-21)` subsection — its three bullets are now historical and can move to `docs/phase-2-release-notes.md` under "Phase 1.1 history". If Nathan judges them still useful in the README, they can stay as a `### Phase 1.1 archive` block beneath the Phase 2 limitations — Nathan's call.

Update **License** section (line 105). Unchanged copy is fine; only verify the MIT line and the `LICENSES.md` cross-link are still accurate.

Update **Acknowledgments** (line 113) if Phase 2 added user-facing acknowledgments worth surfacing (e.g. `utif` for TIFF support — yes, add a line for it).

**Acceptance:** Status banner reflects 0.2.0; no "walking skeleton" language remains; no "Save does not preserve edits" claim remains; Phase 2 limitations section is honest about replace-only, TIFF first-page-only, cross-op-chain undo, bookmarks single-file, no print preview.

---

### N-9.2 — `docs/user-guide.md` update

#### N-9.2.1 — Rewrite the top-of-doc preamble and Known Limitations section

The Phase 1 "Known limitations in Phase 1" section (lines 9–47 of the existing doc) is the lynchpin for the rewrite. Convert it to **"Known limitations in Phase 2"** and:

- DELETE the "Save fidelity (the important one)" subsection entirely. It is no longer true. (Replace with a 1-line "What changed in 0.2.0: Save now preserves edits — see the [Phase 2 release notes](phase-2-release-notes.md) for the full changelog." with a link.)
- DELETE the "Other Phase 1 stubs" table rows for: Print to physical printer, Print to PDF / Export to PDF, Image import, Text editing, Bookmarks authoring, Make PDF the OS default handler (in-app toggle), Undo/redo. These are all now LIVE.
- KEEP and update: Forms, Fill & sign, Scan from TWAIN + OCR, Office export, macOS/Linux, Auto-update — these are still Phase 3+ scope.
- KEEP and update: "Find / search within document" (Phase 2 ALSO does not ship this — confirm vs Riley's actual implementation; if it shipped, move it to a Use section; if it didn't, keep it stubbed).
- ADD a new subsection "Phase 2 partial features" with explicit limitations: text editing replace-only, TIFF first-page-only, no cross-op-chain undo, no print preview, single-file bookmarks.
- ADD a top-of-doc preamble paragraph paralleling the Phase 1 trust floor — "Headline Phase 2 partial: text editing requires the original font. See [Phase 2 partial features](#phase-2-partial-features) before relying on text replacement in production."

#### N-9.2.2 — Add NEW section "Printing"

After the existing "Annotating" section (or wherever Phase 1's "Saving" lives), insert:

```markdown
## Printing

PDF_Viewer_Editor 0.2.0 dispatches print jobs through Electron's `webContents.print()`. Press **Ctrl+P** or use **File → Print** to open the system print dialog.

### What happens when you press Ctrl+P

1. The renderer asks main to dispatch a print job for the current document.
2. Main constructs a hidden BrowserWindow (security floor preserved — see [developer-guide](developer-guide.md#security-floor) for L-001 enforcement), loads the current document bytes (with all your edits replayed via the same engine that powers Save), and invokes the OS print dialog through the embedded webContents.
3. You pick a printer in the OS dialog, click Print, and the job is dispatched.

### What you'll see

- A toast "Sending to printer..." while the job is queued.
- A toast "Sent to printer" once the OS accepts the job. (We do NOT track per-printer success; that's the OS's responsibility.)
- If something goes wrong before dispatch — usually a bytes-build failure for a document with a corrupt edit chain — you'll see "Print failed: ..." with the specific reason.

### Limitations

- **No in-app print preview.** The OS print dialog has its own preview; we don't render one in the app. Phase 3 will add a preview pane + print settings UI.
- **No print-settings persistence.** Each Print press opens the OS dialog with OS defaults; settings don't survive between prints.
```

#### N-9.2.3 — Add NEW section "Print to PDF"

```markdown
## Print to PDF

PDF_Viewer_Editor 0.2.0 exports the current document to a new PDF file via **Ctrl+Shift+P** or **File → Print to PDF**. The export uses one of two engines depending on a heuristic:

### The two engines

| Engine                  | When it's picked                                                                                                            | What it does                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **pdf-lib (default)**   | Documents without unauthorable annotations, fewer than ~10 overlay objects per page, no text-replace ops in the edit chain. | Replays the edit chain via the same engine that powers Save, then writes the result through pdf-lib. Byte-stable, fast, deterministic.                                                                             |
| **Chromium (fallback)** | Documents with unauthorable annotations, ≥10 overlay objects per page, or text-replace ops in the edit chain.               | Renders the document through an offscreen BrowserWindow and uses `webContents.printToPDF()` to write the output. Slower; bytes are not deterministic across runs (Chromium's own bytes-build is non-reproducible). |

You can force a specific engine via **Settings → Export → Default engine** (`pdf-lib` / `chromium` / `auto`). The default is `auto` (heuristic picks).

### Engine selection feedback

When you press Ctrl+Shift+P, you see a brief "Engine: pdf-lib" or "Engine: Chromium (reason: ...)" indicator in the toast that confirms which engine ran. The reason string is one of: `default`, `forced-by-setting`, `forced-by-overlay-threshold`, `forced-by-unauthorable-annotation`, `forced-by-text-replace`. See [api-reference.md](api-reference.md#pdfexporttopdf) for the full reason enum.

### Limitations

- **Chromium engine produces non-deterministic bytes.** Same input, same edit chain → different output bytes across runs. This is Chromium's behavior, not ours. For deterministic exports, force `pdf-lib`.
- **Forms, signatures, and embedded JavaScript are not preserved in Chromium output.** The Chromium engine renders the document, then writes the rendered pages — interactive structures are flattened. If your document has those structures and you need them preserved, force `pdf-lib`.
```

#### N-9.2.4 — Add NEW section "Importing images"

```markdown
## Importing images

PDF_Viewer_Editor 0.2.0 imports PNG, JPEG, and TIFF (first page only) images. Two import modes:

### Mode 1: Insert image as a new page

**Toolbar → Insert image → New page** (or **Insert menu → Image as page**). Pick a file. Pick an insertion position (before/after current page). The image becomes a full page sized to fit A4 (with the image scaled proportionally inside).

### Mode 2: Overlay image on existing page

**Toolbar → Insert image → Overlay** (or right-click on a page → Insert image overlay). Pick a file. Click-drag a rectangle on the page where the image should land. Resize after drop via the corner handles.

### What formats work

| Format                                    | Status              | Notes                                                                                 |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| PNG (8-bit, 16-bit)                       | LIVE                | Embedded via pdf-lib `embedPng`.                                                      |
| JPEG (baseline, progressive)              | LIVE                | Embedded via pdf-lib `embedJpg`.                                                      |
| TIFF (single-page)                        | LIVE                | Decoded via [utif](https://github.com/photopea/UTIF.js) (MIT).                        |
| TIFF (multi-page)                         | **First page only** | Only the first frame is decoded. Multi-page TIFF extraction is a Phase 2.5 candidate. |
| Other formats (BMP, GIF, WebP, HEIC, RAW) | Not supported       | Convert to PNG or JPEG before import.                                                 |

### Limitations

- **TIFF multi-page imports use the first page only.** A 5-page TIFF imports as a single image (the first page).
- **No transparency for JPEG.** JPEG doesn't support alpha; if you need a transparent background, use PNG.
```

#### N-9.2.5 — Add NEW section "Editing text"

```markdown
## Editing text

PDF_Viewer_Editor 0.2.0 supports **replace-only text editing with the original font**. This is intentionally narrow — full text editing (reflow, font substitution, multilang shaping) ships in Phase 4.

### How to edit text

1. Click on a run of text in the document. A text-edit overlay appears around the run.
2. Type your replacement. The overlay shows the original font's metrics in real time as you type.
3. Press **Enter** to commit, **Esc** to cancel.

The replacement is queued as an edit op (kind: `text-replace`). On Save, the engine writes the replacement into the saved bytes through pdf-lib at the original run's content-stream position.

### What works

- Replacing a word with another word the same length (no clipping, no glyph misses).
- Replacing a word with a shorter word.
- Replacing a word with a longer word, **as long as the longer word fits within the original glyph run's width** in the original font.

### What doesn't work

- **Reflow.** If your replacement doesn't fit the original run's width, you get a `clipped` error toast. Phase 4 will reflow.
- **Font substitution.** If your replacement uses characters the original font doesn't have (e.g. you type a Cyrillic character into a Latin-only font), you get a `missing_glyph` error toast. Phase 4 will substitute.
- **Multi-line edits.** Phase 2 text-replace is single-run. Multi-line text editing is Phase 4.

If you need to edit text in a way Phase 2 doesn't support, the workaround is to add a text annotation on top (Phase 1 feature) — not a replacement of the original text, but an overlay that prints with the document.
```

#### N-9.2.6 — Rewrite the "Working with bookmarks" section

Phase 1's bookmarks were read-only (display the native PDF outline if present). Phase 2 is full CRUD with drag-reorder + drag-nest + cycle detection. Rewrite to walk through:

- Open the Bookmarks panel (sidebar tab).
- Create a new bookmark (right-click in panel → New bookmark, or button in toolbar). Bookmark is created with the current page as its target.
- Rename a bookmark (double-click on the label, or right-click → Rename).
- Nest a bookmark under another (drag-and-drop onto the parent).
- Reorder (drag-and-drop to a new position at the same depth).
- Delete (right-click → Delete, or select + Delete key).

Document the **cycle detection** behavior: dragging a bookmark onto its own descendant rejects the drop with a "Would create a cycle" toast.

Document the **single-file scope** limitation: bookmarks are stored per-file (keyed by file hash); they don't carry across documents.

#### N-9.2.7 — Rewrite the Saving section

The current Saving section (per existing user-guide) carries the H-3 fidelity caveat throughout. Rewrite to:

- Replace "writes a valid PDF but does NOT preserve your edits" with "writes a valid PDF with all your edits preserved via the edit-replay engine."
- Add a sentence about the atomic-save invariant (temp file → rename) so partial saves can never leave a corrupt file at the destination path.
- Add a "What happens behind the scenes" subsection that explains the IPC pipe in plain language (renderer dispatches op list → main replays into bytes → atomic write to disk).
- Add a cross-reference to the Print to PDF section for the engine-selection note (when you Save, you always get pdf-lib; the dual-engine choice only applies to Print to PDF).
- Remove all three H-3 "Saved to filename — that is true. It does not reflect your edits." paragraphs.

Keep the Save As behavior unchanged.

#### N-9.2.8 — Update the shortcuts table

Phase 2 adds **Ctrl+I** (Insert image), **Ctrl+P** (Print), **Ctrl+Shift+P** (Print to PDF), and re-enables **Ctrl+Z** / **Ctrl+Y** (Undo/Redo across all op kinds), and **F2** (rename bookmark in panel when focused). Match against `src/client/hooks/use-app-shortcuts.ts` — Nathan must grep this file to confirm the exact bindings Riley shipped; do not invent shortcuts.

#### N-9.2.9 — Update "Coming in Phase 2+" → "Coming in Phase 3+"

The existing user-guide has a section listing Phase 2+ promises. Rename to "Coming in Phase 3+" and remove every entry that Phase 2 now delivers.

**Acceptance:** Every Phase 2 user-facing feature has a section. Every limitation is documented honestly. No "coming soon" language remains for features that shipped. Shortcuts table matches `use-app-shortcuts.ts` exactly.

---

### N-9.3 — `docs/developer-guide.md` update

#### N-9.3.1 — Add edit-replay engine to the architecture overview

The existing developer guide's architecture section walks the Phase 1 module map. Add a new subsection covering Phase 2:

- The **edit-replay engine** (`src/main/pdf-ops/replay-engine.ts`) — pure function `replay(input: ReplayInput): Promise<ReplayResult>`, 11 op-handlers, fold-then-emit pipeline, atomic save via `fs:applyEditOps` handler.
- The **lynchpin decision: main keeps original bytes per handle** (P2-L-2) — `src/main/pdf-ops/document-store.ts` gains `getBytes()` / `setBytes()` + a `Uint8Array` slot. The renderer NEVER holds original bytes (conventions §10 ban survives). Every Phase 2 feature composes ON this lynchpin.
- The **history middleware** (`src/client/state/middleware/history-middleware.ts`) — computes inverses, compacts image bytes (`meta.__history` re-entrancy flag), supports Phase 1 + Phase 2 op kinds.
- The **renderer-gatekeeper boundary** — ESLint `no-restricted-imports` enforces that renderer code never imports `src/ipc/contracts` directly; all contract types route through `src/client/types/ipc-contract.ts`. (Wave 8.5 H-2.)

Include a diagram (ASCII or mermaid) of the data flow for an edit op: renderer dispatch → history middleware → IPC → main handler → engine → bytes → atomic save.

#### N-9.3.2 — NEW section: "How to add an EditOperation variant"

Concrete walkthrough using `text-replace` as the worked example (or a hypothetical new variant — Nathan's call). Touch points:

1. **`docs/data-models.md` §7.1** — add the new variant to the `EditOperation` discriminated union. (Frozen doc — flag for Marcus amendment.)
2. **`docs/data-models.md` §7.1.3** — add forward + reverse inverse rows in the inverse table. (Wave 8.5 lesson: asymmetric inverse tables hide ship-blockers — both directions are required.)
3. **`src/main/pdf-ops/replay-engine.ts`** — add an `apply<Variant>(...)` handler that mutates the in-progress `PDFDocument`.
4. **`src/main/pdf-ops/replay-engine.test.ts`** — add tests for the new variant: (a) forward apply, (b) round-trip with delete-then-insert, (c) error path with `op_apply_failed`.
5. **`src/client/state/slices/document-slice-apply.ts`** — add a renderer-side apply branch in `applyOperationToDocument`. Variants that DON'T mutate the renderer model (e.g. text-replace, image overlays) get an empty case with an explicit "// PRESENTATIONAL — main engine resolves at save" comment.
6. **`src/client/state/slices/document-inverses.ts`** — add an `inverseOf` branch. Both directions if the variant produces or consumes a `delete`/`insert` pair.
7. **`src/ipc/contracts.ts`** — if the new variant requires a NEW IPC channel (e.g. `pdf:replaceText`), define request/response types here. (David's domain — for a new variant that fits an existing channel like `fs:applyEditOps`, no contract change needed.)
8. **`src/client/state/middleware/history-middleware.ts`** — if the new variant carries `Uint8Array` (image bytes), add a `compactImageOpForHistory`-equivalent compaction to keep the redux store under conventions §10's ban.

Note explicitly: **the `text-replace` and image overlay variants are PRESENTATIONAL at the renderer** (no PageModel mutation; engine resolves at save). Only variants that produce or consume pages mutate the renderer's model.

#### N-9.3.3 — Update IPC contract reference card

Add the 8 Phase 2 channels (cross-link to `docs/api-reference.md` for full request/response detail):

| Channel                | Direction | Request                                     | Response                                                         | Status                                                                    |
| ---------------------- | --------- | ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `fs:applyEditOps`      | R → M     | `{ handle, ops, originalBytes? }`           | `Result<{ savedAt: string }, FsApplyError>`                      | LIVE                                                                      |
| `pdf:embedImage`       | R → M     | `{ handle, image, mode, page?, geometry? }` | `Result<{ pageIndex, opAppended }, PdfEmbedImageError>`          | LIVE                                                                      |
| `pdf:replaceText`      | R → M     | `{ handle, runId, newText }`                | `Result<{ opAppended }, PdfReplaceTextError>`                    | LIVE                                                                      |
| `pdf:identifyTextSpan` | R → M     | `{ handle, page, point }`                   | `Result<TextSpanIdentification, PdfIdentifyTextSpanError>`       | LIVE (renderer-cached metrics; `no_text_at_point` is the no-hit response) |
| `pdf:print`            | R → M     | `{ handle }`                                | `Result<{ dispatched: true }, PdfPrintError>`                    | LIVE                                                                      |
| `pdf:exportToPdf`      | R → M     | `{ handle, destPath, engine? }`             | `Result<{ engine, reason, destPath, warnings }, PdfExportError>` | LIVE (both engines)                                                       |
| `bookmarks:listTree`   | R → M     | `{ fileHash }`                              | `Result<{ tree: BookmarkNode[] }, BookmarksListError>`           | LIVE                                                                      |
| `bookmarks:move`       | R → M     | `{ id, newParentId, newSortOrder }`         | `Result<{ moved: true }, BookmarksMoveError>`                    | LIVE                                                                      |
| `bookmarks:rename`     | R → M     | `{ id, newLabel }`                          | `Result<{ renamed: true }, BookmarksRenameError>`                | LIVE                                                                      |

#### N-9.3.4 — Update Common Pitfalls

Add three new pitfalls based on Phase 2 lessons:

1. **The renderer-gatekeeper boundary is ESLint-enforced.** Direct imports of `src/ipc/contracts` from `src/client/` are blocked. All contract types route through `src/client/types/ipc-contract.ts`. (Wave 8.5 H-2; Wave 7 had a manual catch.)
2. **Discriminated unions with downstream consumers — don't collapse to boolean.** If a repo method (e.g. `BookmarksRepo.move`) returns a discriminated union like `MoveBookmarkResult`, the downstream adapter / bridge / handler MUST preserve the union all the way to the IPC boundary. Collapsing to boolean and re-inferring the variant via a heuristic is the H-1 anti-pattern (Wave 8 BLOCKER + Wave 8.5 fix). Document with reference to `src/main/db-bridge.ts` (and the parallel `bookmarks-phase2.ts` switch).
3. **History middleware re-entrancy: the `meta.__history` flag is load-bearing.** When undo dispatches `applyEdit(inverse)`, the middleware re-enters; without the flag, infinite loop. Pattern documented in conventions §6.5 (Wave 7 Riley lesson).
4. **The `text-replace` and image overlay EditOperation variants are PRESENTATIONAL at the renderer.** They don't mutate `PageModel`; the engine resolves at save time. Don't try to render the replacement in the renderer's PageModel — the canvas overlay reads from `dirtyOps` until the next save round-trip.
5. **Always use `originalBytes` from the main-process `document-store`, not from `op.image.bytes`.** History middleware compacts image bytes (zeroes the Uint8Array after pushing the op to history). Main-side handlers MUST look up image bytes via `contentHash` from the per-handle image cache. (Wave 8.5 Riley lesson — image-insert inverse fix.)

#### N-9.3.5 — Update test count breakdown

```markdown
| Suite                             | Test count      | What's covered                                                                                                                                                                                                                                                                                     |
| --------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main` + `src/ipc` (Vitest)   | 224             | Engine round-trips, all IPC handlers, db-bridge, replay golden bytes, atomic save, security floor (L-001 on both factories), Print/Export adapter dispatch, image-embed pipeline, TIFF graceful-degradation, H-3 retirement smoke (3-page round-trip), all bookmarks CRUD with variant exhaustion. |
| `src/client` (Vitest)             | 94              | Slices + selectors, history middleware (compaction + re-entrancy + 8 inverse cases incl. image-page delete), components (image-import-modal, text-edit-overlay, bookmarks-panel), thunks, gatekeeper boundary.                                                                                     |
| `src/db` (Vitest)                 | 37              | Repos against an in-memory better-sqlite3 — settings, recents, bookmarks (full Phase 2 tree CRUD incl. cycle detection). Requires better-sqlite3 ABI matching host Node.                                                                                                                           |
| `tests/e2e` (Playwright Electron) | 1 smoke         | Launches the app, opens a synthesized PDF, asserts the main window mounts. H-3 retirement smoke also runs as a Vitest integration test for speed.                                                                                                                                                  |
| **Total**                         | **355** + 1 e2e |                                                                                                                                                                                                                                                                                                    |
```

Note explicitly: **Phase 2 test gaps** (cited honestly): no automated cross-op-chain undo coverage; no automated Chromium-engine golden-bytes test (non-deterministic by nature); `pdf:identifyTextSpan` real scanner is Phase 2.5 (the Phase 2 channel returns `no_text_at_point` and renderer-cached metrics carry the UX).

#### N-9.3.6 — Update Prerequisites

The existing "Use Node 20 LTS" note is still accurate. Phase 2 added `utif` to the dependency tree; no new Node version constraints. Confirm by reading `package.json` engines field.

**Acceptance:** Architecture overview reflects edit-replay engine and lynchpin. "How to add an EditOperation variant" walkthrough has concrete file paths. IPC reference card lists all 8 Phase 2 channels with status. Common Pitfalls includes all 5 new pitfalls. Test counts match Wave 8.5 verification matrix.

---

### N-9.4 — `docs/api-reference.md` update

Append a **"Phase 2 channels"** section at the bottom (do NOT rewrite the Phase 1 section — Phase 1 channels are unchanged). For each of the 8 channels listed in N-9.3.3, provide:

- **Channel name** (e.g. `fs:applyEditOps`)
- **Direction** (R→M for renderer-to-main)
- **Request type** (TypeScript signature; copy from `src/ipc/contracts.ts`)
- **Response type** (typed Result with the success and error union)
- **Error variants** (every variant in the error union with one-line description)
- **Live/stub status** (most are LIVE; note `pdf:identifyTextSpan` returns `no_text_at_point` as the renderer-cached-metrics fallback)
- **Cross-reference** to `api-contracts.md` §12 for architectural detail

Add a **subsection on `MoveBookmarkResult`** showing the discriminated union shape AND the **`invalid_parent` → `invalid_payload` IPC boundary translation** David flagged in Wave 8.5. Verbatim from David's status row:

````markdown
### `MoveBookmarkResult` (repo-side) → `BookmarksMoveError` (IPC-side)

The `BookmarksRepo.move()` repo method returns `MoveBookmarkResult`:

```ts
type MoveBookmarkResult =
  | { ok: true }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'cycle_detected' }
  | { ok: false; error: 'invalid_parent' };
```
````

The IPC `BookmarksMoveError` union (per `api-contracts.md` §12.6) is:

```ts
type BookmarksMoveError =
  | { error: 'not_found' }
  | { error: 'cycle_detected' }
  | { error: 'invalid_payload' }
  | { error: 'db_unavailable' };
```

The handler (`src/ipc/handlers/bookmarks-phase2.ts`) maps repo `'invalid_parent'` → IPC `'invalid_payload'`. The semantic mapping reads as "the parent reference is structurally invalid" — accurate given the IPC contract scope. A dedicated `'invalid_parent'` wire variant is a Phase 2.5 candidate (it would surface a distinct renderer toast).

````

Add a brief paragraph at the top of the Phase 2 section explaining the cross-doc relationship: `api-reference.md` is the **contributor-facing reference card**; `api-contracts.md` §12 is the **architectural / wire-format contract**. The two are kept in sync — when a channel's request/response shape changes, both docs amend.

**Acceptance:** All 8 Phase 2 channels listed with full request/response types, error variants, status. `MoveBookmarkResult` discriminated union documented with the IPC boundary translation note.

---

### N-9.5 — `LICENSES.md` verify-and-amend

Diego added the `utif@^3.1.0` row in Wave 8 (per his Wave 8 status row: "Update LICENSES.md with the new entry"). Nathan's job in Wave 9:

1. **Verify** the utif row is present, correctly attributed (MIT, author: photopea), and consistent with the existing table format.
2. **Diff** the current dependency set against the Phase 1.1 walk basis. If any other deps were added through Phases 7/8 (e.g. dev-deps Diego added for the Chromium adapter or print dispatch) the doc must add them. Check by:
   - `npm ls --all --json | jq '.dependencies | keys'` then compare against the existing table. (Nathan calls this through `bash` since the data is on disk.)
3. **Update the "Scan basis" / "Last walked" date** at the top of the doc to today.
4. **Update the intro paragraph** if the dependency totals changed (the current intro cites "X direct dependencies + Y transitive"; refresh both).

**Acceptance:** `utif` is in the table with MIT attribution. Any other Phase 2 deps are documented. Scan basis date is current. No undeclared-license packages remain.

---

### N-9.6 — NEW: `docs/phase-2-release-notes.md`

A one-page user-facing changelog summarizing the Phase 1 → Phase 2 transition. Pattern:

```markdown
# Phase 2 release notes — 0.2.0

PDF_Viewer_Editor 0.2.0 is the **functional editor** release. Phase 1 was the walking skeleton — the architecture was proven end-to-end but Save didn't yet preserve edits. Phase 2 lights up the fidelity layer + ships printing, image import, text editing, and bookmarks authoring.

## What's new in 0.2.0

- **Save preserves edits.** The pdf-lib replay engine ships. Every edit you make (rotation, deletion, reorder, insert blank, annotation, image import, text replace) is written into the saved bytes via an atomic temp-rename pipeline.
- **Print to physical printer.** Ctrl+P dispatches a job through the system print dialog (Electron `webContents.print()`).
- **Print to PDF.** Ctrl+Shift+P exports the document to a new PDF via either the pdf-lib engine (default, deterministic, fast) or the Chromium engine (fallback for documents with unauthorable annotations or text-replace ops).
- **Image import.** PNG, JPEG, and TIFF (first page) imports as a new page OR as an overlay on an existing page.
- **Text editing (replace-only, original font).** Click a text run, type a replacement, press Enter. The engine writes the replacement into the saved bytes through pdf-lib at the original run's position. Failure modes: `clipped` (replacement too wide for the original run's width) and `missing_glyph` (character not in the original font).
- **Bookmarks authoring (full CRUD tree).** Create, rename, nest, reorder, delete. Drag-and-drop with cycle detection.
- **Undo / Redo across all ops.** Page ops, annotation ops, image ops, text ops, bookmark ops — all undoable.

## Known limitations in 0.2.0

- Text editing is replace-only with the original font (no reflow, no font substitution, no multilang shaping). → Phase 4.
- TIFF imports use the first page only (multi-page extraction is a candidate Phase 2.5 ticket).
- Cross-op-chain undo is not compacted (each undo unwinds one op). → Phase 3.
- Bookmarks are scoped to a single file (cross-file navigation). → Phase 5+.
- No print preview pane (the OS dialog provides its own). → Phase 3.
- Chromium engine produces non-deterministic bytes; forms / signatures / embedded JavaScript are flattened in Chromium output. Force `pdf-lib` for deterministic / structure-preserving exports.
- `pdf:identifyTextSpan` returns `no_text_at_point` (renderer-cached metrics carry the UX). Real content-stream walker is Phase 2.5.

## Breaking changes from 0.1.0

**None.** The Phase 2 design is additive. All Phase 1 features continue to work unchanged. The IPC contract gained new channels but didn't change any existing channel's request/response shape.

## Upgrade notes (from 0.1.0)

- **Your data survives.** Recents, settings, and any Phase-1 bookmarks (read-only outline) carry forward through the schema-v2 migration (`migrations/0002_phase2_bookmarks.sql`). The migration runs on first launch of 0.2.0; no manual action.
- **Bookmarks become editable.** Phase 1 bookmarks were a read-only view of the native PDF outline. Phase 2 adds a Bookmarks panel with CRUD; the underlying storage is the same SQLite table (`bookmarks`), now with `parent_id` and `sort_order` columns.
- **Save behavior changes.** In 0.1.0, Save wrote a valid PDF without your edits. In 0.2.0, Save writes a valid PDF with your edits. **This is a behavior change you should know about if any 0.1.0-saved-file expectations are baked into your workflow** — re-save your 0.1.0 files in 0.2.0 to get edits-preserved output.
- **License unchanged: MIT** (no change from Phase 1.1).

## Phase 1.1 archive (historical)

The Phase 1.1 cleanup (2026-05-21) added the MIT `LICENSE` file at the repo root, resolved the TS4023 renderer typecheck cascade, and laid the groundwork for Phase 2 — see [`README.md`](../README.md#phase-11-updates-2026-05-21) if it's still cited there, or [`build-report.md`](build-report.md) for the wave-by-wave detail.

## What's next

See [`project-roadmap.md`](project-roadmap.md). Phase 3 (forms, find/search, print preview), Phase 4 (text editing with reflow), Phase 5 (scan + OCR + cross-file bookmarks), Phase 6 (Office export), Phase 7 (macOS / Linux / auto-update / code signing).
````

**Acceptance:** One page, user-facing, honest. Lists what's new, what's still limited, that there are no breaking changes, and what survives the migration.

---

## Acceptance criteria for Wave 9 close

- [ ] README accurately describes Phase 2 capabilities; "0.1.0 walking skeleton" language removed; status banner reflects 0.2.0
- [ ] user-guide.md has sections for every Phase 2 user-facing feature (Printing, Print to PDF, Importing images, Editing text, Working with bookmarks rewrite, Saving rewrite)
- [ ] user-guide.md "Known limitations in Phase 2" section is honest about replace-only text, TIFF first-page-only, cross-op-chain undo unsupported, single-file bookmarks, no print preview
- [ ] developer-guide.md describes the edit-replay engine architecture + the "main keeps original bytes per handle" lynchpin
- [ ] developer-guide.md "How to add an EditOperation variant" walkthrough has concrete file paths for every touch point (data-models, replay-engine, document-inverses, history-middleware, etc.)
- [ ] developer-guide.md IPC reference card lists all 8 Phase 2 channels with status
- [ ] developer-guide.md Common Pitfalls includes all 5 new pitfalls
- [ ] developer-guide.md test counts match the Wave 8.5 verification matrix (224 main+ipc, 94 client, 37 db = 355)
- [ ] api-reference.md lists every Phase 2 channel with request/response types, error variants, status, cross-reference to api-contracts.md §12
- [ ] api-reference.md documents `MoveBookmarkResult` + the `invalid_parent` → `invalid_payload` IPC boundary translation
- [ ] LICENSES.md has the `utif@^3.1.0` row; Scan basis date is current; no other undeclared Phase 2 deps surfaced
- [ ] phase-2-release-notes.md exists as a one-page user-facing changelog
- [ ] No aspirational claims (every "X works" claim is verifiable on disk; every "Coming in Phase N" claim is consistent with project-roadmap.md)
- [ ] L-001 not touched, not weakened, not removed from any cross-reference
- [ ] Build-report status row appended at wave close (one row; Nathan does NOT rewrite any other section of build-report)
- [ ] One JSONL entry appended to `.learnings/learnings.jsonl` capturing Nathan's wave lessons (per self-improvement protocol)

---

## Output Nathan delivers at wave close

1. The 6 doc updates (5 amends + 1 NEW).
2. A status row at the bottom of `docs/build-report.md` summarizing files touched, line counts, and any cross-doc consistency observations.
3. One JSONL entry in `.learnings/learnings.jsonl`.

---

## What NOT to do

- Do not modify source under `src/`
- Do not modify any Wave 1 or Wave 6 frozen doc (`ARCHITECTURE.md`, `conventions.md`, `api-contracts.md`, `data-models.md`, `ui-spec.md`, `architecture-phase-2.md`, `edit-replay-engine.md`) — if Nathan finds a doc inconsistency that requires amending one of these, flag in the build-report status row for a Marcus Wave 9.5 amendment pass; do NOT touch the frozen doc directly
- Do not weaken or remove L-001 references; every doc that talks about the security floor cites L-001
- Do not invent shortcuts, file paths, or test counts — grep / cat the source before writing
- Do not rewrite Julian's `docs/code-review.md`
- Do not change the LICENSE file at repo root
- Do not change `.learnings/locked-instructions.md`

---

## Marcus's verdict for Wave 9 dispatch

**GREEN** — Nathan can start as soon as Wave 8.5 is on disk (confirmed) regardless of Julian's re-audit status. The two waves are independent: Julian writes `docs/code-review.md`, Nathan writes user-facing docs. If Julian's re-audit surfaces a contradiction with a Nathan doc, a small Wave 9.5 amendment pass closes the gap. The brief-as-artefact pattern (per Wave 3.5 learning #11) applies: this brief is the dispatchable contract.

**Dispatch path (for the main session, not Marcus):** invoke `documentation-expert` with this brief as the primary context + the readings list above. Confirm test counts and shortcut bindings against disk before each doc claim.
