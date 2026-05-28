# ARCHITECTURE — Phase 2 Additions

**Author:** Riley (front-end-architect)
**Date:** 2026-05-21 (Wave 6)
**Status:** Phase 2 design, locked at end of Wave 6. Additions to Phase-1 `ARCHITECTURE.md` (which is frozen per locked decision P2-L-5).
**Scope:** Architectural deltas needed for Phase 2 features (edit-replay, image import, text editing, bookmarks authoring, print, undo/redo activation). Phase-1 sections remain authoritative for anything not amended here.
**Reads:** `ARCHITECTURE.md` (full), `docs/phase-2-plan.md`, `docs/wave-6-brief.md`, `docs/edit-replay-engine.md`.

---

## 0. Scope

Phase 2 closes the walking-skeleton-to-real-editor gap. It promotes Save from a contract-correct stub (the H-3 Phase-1 boundary documented in user-guide and README) to a fully-replayed PDF emission. It adds:

1. **Edit-replay engine** in main process. Lynchpin (P2-L-2). Detailed design: `docs/edit-replay-engine.md`.
2. **Image import** (insert-as-page AND overlay) for PNG/JPEG/TIFF. P2-L-4.
3. **Text editing** (replace-only, original font). P2-L-3.
4. **Bookmarks authoring** (full CRUD + nesting + reorder) with schema delta `0002_phase2_bookmarks.sql`. P2-L-6.
5. **Print** to physical printer (system dialog) + Print-to-PDF (dual-engine, now Live).
6. **Undo/redo UI activation** — the Phase-1 `historyMiddleware` shim activates.

Each section below describes the architectural deltas. Phase-1 `ARCHITECTURE.md` chapters that aren't amended remain authoritative; cross-references point back to them where helpful.

---

## 1. Locked decisions encoded (Wave 6 self-check)

| ID | Decision | Encoded where in this doc |
|---|---|---|
| **P2-L-2** | Main keeps original bytes per handle | §3 (lynchpin) — full design with lifecycle, memory budget, eviction |
| **P2-L-3** | Text editing: replace-only, original font | §4 — failure modes, glyph coverage, missing-glyph UX; `edit-replay-engine.md` §4.6 |
| **P2-L-4** | Image import: both modes, PNG/JPEG/TIFF | §5 — new EditOperation variants, embed model; `edit-replay-engine.md` §4.3-§4.5, §8 |
| **P2-L-5** | ARCHITECTURE.md frozen; this is the delta | This doc exists. Phase-1 ARCHITECTURE.md is untouched by Wave 6. |
| **P2-L-6** | Bookmarks: full CRUD + nesting + reorder | §6 — schema delta, IPC contract, UI; `data-models.md` §7 |

---

## 2. Process model deltas

### 2.1 No new processes

Phase 2 does not add any new process. Main, preload, renderer remain the three. The offscreen BrowserWindow for Chromium export (Phase 1 architecture §6.3) now becomes a Live code path, not just a contract.

### 2.2 Main-process module additions

```
src/main/pdf-ops/
  document-store.ts          (EDIT — extends to retain Uint8Array per handle; §3)
  replay-engine.ts           (NEW — see edit-replay-engine.md)
  text-replace.ts            (NEW — content-stream parsing for replace)
  image-embed.ts             (NEW — TIFF→PNG + embedPng/Jpg + cache)
  tiff-decoder.ts            (NEW — wraps utif)
  annotations.ts             (EDIT — Phase-2 subtypes /Underline /StrikeOut /Ink)

src/main/export/
  pdf-lib-engine.ts          (EDIT — now wired to replay-engine.ts)
  chromium-engine.ts         (EDIT — fed bytes via replay-engine.ts output)
  engine-selector.ts         (EDIT — heuristic extended; §3.8)

src/ipc/handlers/
  fs-write-pdf.ts            (EDIT — kind:'ops' Live)
  pdf-export.ts              (EDIT — real impl)
  pdf-embed-image.ts         (NEW)
  pdf-replace-text.ts        (NEW)
  pdf-identify-text-span.ts  (NEW)
  pdf-print.ts               (NEW)
  bookmarks.ts               (EDIT — new ops: reorder, move, listTree)
```

### 2.3 Renderer-process additions

```
src/client/components/
  modals/image-import-modal/         (NEW)
  modals/print-export-dialog/        (NEW — separate from existing export-engine-dialog or merged; see ui-spec §11.4)
  text-edit-overlay/                 (NEW — dual-mode click-to-edit existing text + FreeText reuse)
  bookmarks-panel/                   (REWRITE — read-only Phase 1 → full CRUD Phase 2)

src/client/state/
  slices/document-slice.ts           (EDIT — accept new EditOperation variants)
  slices/document-slice-apply.ts     (EDIT — apply functions for new variants)
  slices/document-inverses.ts        (EDIT — inverses for new variants)
  slices/bookmarks-slice.ts          (EDIT — tree + reorder ops)
  slices/history-slice.ts            (EDIT — activate; was passive shim Phase 1)
  middleware/history-middleware.ts   (EDIT — activate)
  thunks.ts                          (EDIT — remove PHASE-1 INLINE; new image-import / text-replace / print / export thunks)

src/client/hooks/
  use-app-shortcuts.ts               (EDIT — wire Ctrl+Z / Ctrl+Y / Ctrl+I / Ctrl+P / Ctrl+Shift+P)

src/client/services/
  pdf-edit.ts                        (RENAME — or refactor; phase-2-plan §4.6 flags the originalBytes parameter as a Uint8Array leak risk; resolution: rename to pdf-ops-renderer.ts and remove the originalBytes parameter)
```

### 2.4 Boundary discipline (unchanged from Phase 1)

Conventions §10 still holds: **renderer never holds `Uint8Array` of document bytes**. The lynchpin decision (§3 below) means main owns the bytes — Phase 2 strengthens this rather than weakens it. Any renderer code that previously took `originalBytes` as a parameter is refactored to operate on a `DocumentHandle` + IPC call instead.

### 2.5 IPC surface growth

11 new channels (full spec in `api-contracts.md` §12):

| Channel | Purpose | Phase |
|---|---|---|
| `pdf:embedImage` | Embed a single image; returns appended EditOperation | 2 |
| `pdf:replaceText` | Replace a text span; returns appended EditOperation | 2 |
| `pdf:identifyTextSpan` | Renderer asks main for `objectId` at a click point | 2 |
| `pdf:print` | Physical-printer export via Electron `webContents.print` | 2 |
| `bookmarks:move` | Reorder + re-parent | 2 |
| `bookmarks:listTree` | Hierarchical fetch | 2 |
| `bookmarks:rename` | Title-only update (also via `bookmarks:upsert`; convenience) | 2 |
| `fs:getDocumentMetadata` | Renderer queries main for things like `pdflibLoadWarnings` post-save (was inlined in `fs:writePdf` response Phase 1; Phase 2 surfaces it as a refresh path) | 2 (optional) |

The Phase-1 contract surface (§1-§11 of `api-contracts.md`) remains frozen and additive-only. The `'not_implemented'` variant on `fs:writePdf kind:'ops'` and on `pdf:export` is removed (handlers now return real results).

---

## 3. Lynchpin: main keeps original bytes per handle

### 3.1 Decision

Per locked decision P2-L-2: **main process retains the original PDF `Uint8Array` keyed by `DocumentHandle`**, from the moment the document is loaded (via `dialog:openPdf` / `fs:readPdf` / `pdf:combine` result) until the handle is released (via `fs:closePdf` or app quit).

### 3.2 Where the bytes live

`src/main/pdf-ops/document-store.ts` (existing Phase-1 file) extends:

```ts
// Phase 1 — existing shape:
class DocumentStore {
  private handles: Map<DocumentHandle, OpenDocument>;
  // OpenDocument was metadata-only in Phase 1 per H-3 boundary
}

// Phase 2 — extended shape:
interface OpenDocument {
  handle: DocumentHandle;
  displayName: string;
  fileHash: string;
  sourcePath: string | null;        // null for combine-result handles
  bytes: Uint8Array;                // NEW — held for handle lifetime
  pageCount: number;
  pdflibLoadWarnings: string[];
  openedAt: number;                 // ms epoch; for eviction heuristic if Phase 5 multi-doc
  bytesSize: number;                // for memory accounting
}

class DocumentStore {
  // New methods:
  getBytes(handle: DocumentHandle): Uint8Array | null;
  setBytes(handle: DocumentHandle, bytes: Uint8Array): void;    // called post-save to refresh
  releaseHandle(handle: DocumentHandle): void;                   // existing; now clears the bytes slot too
  getOpenDocCount(): number;
  getTotalBytesHeld(): number;
}
```

### 3.3 Lifetime contract

| Event | Bytes action |
|---|---|
| `dialog:openPdf` succeeds | `setBytes(handle, freshlyReadBytes)` — held in memory |
| `fs:readPdf` (drag-drop) succeeds | Same |
| `pdf:combine` succeeds | `setBytes(newHandle, combinedOutputBytes)` |
| `fs:writePdf kind:'ops'` succeeds | `setBytes(handle, replayOutputBytes)` — REPLACE source-of-truth with newly-saved version (see §3.9 / edit-replay-engine §13.1) |
| `pdf:export` succeeds | **No change to main's bytes** — export writes a new file but the open document's bytes remain whatever they were. The exported file is a destination, not the new source. |
| `fs:closePdf` | Bytes evicted, handle freed |
| App quit | All bytes freed |

### 3.4 Memory budget

Phase 1 set `open.maxFileSizeMB = 500` (single-document, soft cap). Phase 2 preserves single-document and the 500 MB cap. **Memory footprint estimate:**

- 1 open document × 500 MB max = 500 MB worst case
- Plus pdf-lib's in-flight `PDFDocument` during replay (typically 1.5-2× the source size in JS heap)
- Plus image embedding cache (per-save, freed after) — bounded by ops count × image size

**No multi-document in Phase 2** (locked by phase-2-plan §4.7). When Phase 5 ships multi-document, the document-store grows an LRU or explicit-close discipline. Phase 2 leaves a hook (`getOpenDocCount()`, `getTotalBytesHeld()`) so Phase 5 can add the eviction policy without restructuring.

### 3.5 Eviction policy

**Phase 2 default: no eviction.** Single open document, bytes held for handle lifetime. Per `phase-2-plan.md` §7 question 4 answer.

**Recovery if bytes are somehow dropped:** if `getBytes(handle)` returns null (shouldn't happen in Phase 2), the replay-engine caller in `fs-write-pdf.ts` returns `Result<_, 'handle_not_found'>`. The renderer's save thunk catches this and shows a toast: "Document state lost. Re-open the file and try again." This is a defensive code path for Phase 5 readiness; Phase 2 single-doc shouldn't hit it.

### 3.6 Atomicity (write-to-temp, rename)

Per `phase-2-plan.md` §7 question 3 answer. Implementation in `fs-write-pdf.ts`:

```
1. replay() returns newBytes (or error)
2. const tempPath = path.join(dir, `.${name}.tmp-${pid}-${ts}`)   // same directory as destination
3. fs.writeFile(tempPath, newBytes)
4. fs.rename(tempPath, destPath)                                   // atomic on same filesystem
5. documentStore.setBytes(handle, newBytes)                        // bytes refresh AFTER rename succeeds
6. ok({ bytesWritten, newFileHash })
```

Full pseudocode in `edit-replay-engine.md` §10. Failure modes (rename fails after write succeeds) return `fs_write_failed` with `details.tempPath` for manual recovery. The renderer's `dirtyOps` is NOT cleared if save fails — the user can retry.

**Cross-FS rename caveat:** the temp file MUST be in the same directory as the destination. Cross-volume rename on Windows falls back to copy-then-delete which is non-atomic. The code uses `path.dirname(destPath)` to derive the temp directory, never `os.tmpdir()`.

### 3.7 Image-embedding cache

Per `phase-2-plan.md` §7 question 5 answer. **Dedup by content hash within a single save.** Same image dropped on N pages → one `embedPng`/`embedJpg` call, N `drawImage` references. Cache is per-`replay()` invocation, not persistent.

`image.contentHash` (SHA-256) is computed in main when `pdf:embedImage` first ingests the bytes. The hash flows through the EditOperation, so dedup works across reload + redo (same bytes → same hash → same dedup).

Detail in `edit-replay-engine.md` §7.

### 3.8 Print-to-PDF dual-engine heuristic (extended)

Phase 1 architected the heuristic in `ARCHITECTURE.md` §6.1. Phase 2 extends with new signals for the new ops:

| Source signal | Phase 1? | Phase 2 extension |
|---|---|---|
| Encrypted source | Yes — Chromium | (unchanged) |
| pdf-lib load warnings include xref/repair | Yes — Chromium | (unchanged) |
| CMYK + ICC profile | Yes — Chromium | (unchanged) |
| `/Ink` annotation present | Yes — Chromium | (unchanged; now actually fires since Ink is authored in Phase 2) |
| AcroForm fields present | — | **NEW** Chromium (forms are Phase 3; pdf-lib drops appearance streams) |
| Embedded JavaScript actions (`/Names → /JavaScript`) | — | **NEW** Chromium (pdf-lib strips) |
| text-replace op present | — | **NEW** pdf-lib (Chromium would substitute the font, violating P2-L-3) |
| image-overlay op count > 10 | — | **NEW** pdf-lib (Chromium's printToPDF reflows the source; many overlays compose better via direct write) |
| Document is signed (`/Sig` field present) | — | **NEW** Chromium with warning ("signature will be invalidated") |

The heuristic table lives in `src/main/export/engine-selector.ts`; Phase 2 updates the literals and adds tests. User manual override always wins.

### 3.8.1 Determinism (per `phase-2-plan.md` §7 question 6)

pdf-lib re-emit is deterministic (object stream order is stable; xref offsets are byte-stable). Chromium `printToPDF` is **not** — `/CreationDate` and `/ModDate` reflect wall-clock time, and `/ID` includes a randomized component.

**Decision:** add a new setting key `export.deterministic` (boolean, default false). When true:

- pdf-lib path: unchanged (already deterministic).
- Chromium path: post-process the output buffer to strip `/CreationDate`, `/ModDate`, and replace `/ID` with a hash-derived constant. The post-process is a pdf-lib re-load + scrub + re-save. Cost: ~100ms on a 10 MB output, acceptable.

Add `'export.deterministic'` to `SettingKey` union in `api-contracts.md` and `data-models.md` §2.3 (registry table). Default false. Setting surfaced in the Settings modal Export section.

### 3.9 Undo/redo activation

Per `phase-2-plan.md` §7. Phase 1 shipped `historyMiddleware` as a passive shim and `historySlice` skeleton. Phase 2 activates both.

#### 3.9.1 What activates

1. `historyMiddleware.ts` — populates `historySlice.past` for every action with `meta.undoable: true`. Inverse computed via `document-inverses.ts` (already exists; Phase 2 extends with new variant inverses).
2. `historySlice.ts` — reducers `undo`, `redo`, `clearHistory` that move entries between `past`/`future`.
3. `use-app-shortcuts.ts` — Ctrl+Z dispatches `undo()`, Ctrl+Y / Ctrl+Shift+Z dispatches `redo()`.
4. Toolbar Undo / Redo buttons enable based on `past.length > 0` / `future.length > 0`.

#### 3.9.2 What happens on Save

History is **not** cleared on save. The user can undo past their last save. The replay engine handles this correctly because:

- After save, `dirtyOps` is cleared (no unsaved changes from the renderer's view).
- `historySlice.past` still holds the actions + inverses.
- An undo dispatches an inverse `EditOperation` which goes onto the new (post-save) `dirtyOps`.
- Re-saving runs the engine over the **post-save bytes** (refreshed in step 5 of §3.6) with the inverse op as input.

For text-replace: the inverse's `oldText` and `newText` are swapped, and the `objectId` may need re-resolution against the new bytes. The renderer's text-edit overlay re-queries `pdf:identifyTextSpan` lazily on entering edit mode, OR the engine tolerates `text_span_not_found` with a renderer-side retry. Detail in `edit-replay-engine.md` §13.

#### 3.9.3 History cap

Setting `undo.maxHistory` (already in `data-models.md` §2.3, default 100). When `past.length > maxHistory`, oldest entry drops FIFO. This is per-document; switching documents doesn't merge histories (`closeDocument` clears history).

#### 3.9.4 Image-bytes in history entries

The `image-insert` and `image-overlay` ops carry `image.bytes: Uint8Array`. Storing 100 history entries each with a 5 MB image could pressure the renderer's memory. **Mitigation:** the renderer's history slice stores only the `contentHash`, not the bytes; the bytes live in main's image cache for the document handle's lifetime. On undo of an `image-overlay`, the inverse `image-overlay-delete` carries `before.image.contentHash` only; re-doing requires the bytes to still be in main's cache (which they are, because Phase 2 holds bytes for handle lifetime).

This pushes the "Uint8Array does not live in renderer state" discipline (conventions §10) one step deeper: even history entries must not carry image bytes. **Convention §13 addition** documents this pattern (see `conventions.md` §13).

---

## 4. Text editing (P2-L-3)

### 4.1 Scope reminder

Replace-only on existing text spans. No reflow. No font substitution. Plus the existing Phase-1 FreeText annotation tool for net-new text.

### 4.2 Span identification

Per `phase-2-plan.md` §7 question 7. New IPC channel `pdf:identifyTextSpan`:

```
Renderer (text-edit overlay) → user clicks into a text region
  → onClick handler captures pageIndex + canvas coordinates
  → coordinates converted via pdf-coords.ts to PDF user-space
  → dispatch identifyTextSpanThunk
    → api.pdf.identifyTextSpan({ handle, pageIndex, x, y })
      → main reads bytes via documentStore.getBytes(handle)
      → loads with pdf-lib, parses page's content stream
      → hit-tests each text-run bounding rect against (x, y)
      → returns { objectId, runBoundingRect, currentText, fontFamily, fontSize }
  → renderer renders inline text input over the run, populated with currentText
```

`objectId` encoding: `${pageObjectNumber}/${contentStreamIndex}/${runIndex}` (detail in `edit-replay-engine.md` §4.6.1).

### 4.3 Failure-mode UX

Per `phase-2-plan.md` §4.2 risk. Detection lives in the renderer preview engine (not main) so the user gets immediate feedback without an IPC round-trip per keystroke.

**Renderer-side font-metrics shim:** the renderer extracts the original run's font metrics (glyph widths, glyph map) at `identifyTextSpan` time and caches them per `objectId`. As the user types in the inline editor, the renderer:

1. Measures the new string with cached metrics.
2. If `newWidth > runBoundingRect.width`: shows a tooltip "Text will be clipped on save. Phase 4 will support reflow." (Tooltip text is the user-visible failure-mode UX from `phase-2-plan.md` §4.2.) Editor stays open; user can cancel (Esc) or accept (Enter).
3. For each codepoint in the new string: check against the cached glyph map. If absent, render the missing-glyph indicator (`￿`) inline AND surface a tooltip "Original font does not contain this character. Use FreeText annotation to add new text in a different font."

The user can still commit a clipping replace (they were warned). The user **cannot** commit a missing-glyph replace — the editor shows it but the Save button is disabled with the missing-glyph tooltip.

**Why renderer-side metrics:** an IPC round-trip per keystroke is too slow. Per-keystroke debounce + cached metrics is the right boundary.

**Bytes-in-renderer caveat:** glyph metrics are NOT bytes; they're a small JSON object (width array per glyph + Unicode → glyph mapping). Conventions §10 ban on `Uint8Array` is preserved.

### 4.4 Commit path

Pressing Enter (or clicking out, if `commitOnBlur` setting is true):

```
1. Renderer dispatches applyEdit({ kind: 'text-replace', meta: ..., pageIndex, objectId, oldText: cachedText, newText })
2. Action passes through historyMiddleware which:
   - Computes inverse: { kind: 'text-replace', ..., oldText: newText, newText: oldText }
   - Pushes { fwd, inv } onto historySlice.past
3. document-slice-apply.ts applyTextReplace:
   - Pushes op onto dirtyOps
   - (No state mutation beyond dirtyOps; the actual text-replace happens at save via the engine)
```

The renderer's view of the canvas doesn't update — the new text is shown via the overlay until save. (Updating the canvas mid-edit would require running pdf-lib in the renderer, which conventions §10 forbids.) This is a UX trade-off: the user sees an overlay with the new text, the underlying canvas still has the old text. On save → reload-after-save, the canvas refreshes with the replayed bytes.

**Phase 2.5 optimization:** consider rendering the overlay with the user's new text on top of the canvas with a hide-original-run mask. Phase 2 ships the simpler "overlay shows new text, canvas shows old, refresh on save" path.

---

## 5. Image import (P2-L-4)

### 5.1 Two modes + three formats

Insert-as-new-page AND overlay-on-existing-page. Formats: PNG, JPEG, TIFF.

### 5.2 EditOperation variants

Documented in `data-models.md` §7 (full TS shapes) and `edit-replay-engine.md` §4.3-§4.5 (replay semantics). Summary:

- `image-insert { atIndex, image }` — creates a new page, draws the image filling it
- `image-overlay { pageIndex, rect, image, overlayId }` — places image on existing page
- `image-overlay-edit { pageIndex, overlayId, beforeRect, afterRect }` — move/resize
- `image-overlay-delete { pageIndex, overlayId, before }`

### 5.3 UX entry points

Per `ui-spec.md` §11:

1. **Toolbar Insert Image button** — opens the ImageImportModal which prompts for mode (new page vs overlay) and accepts file via dialog.
2. **Drag-drop image onto canvas** — opens the same modal with the file pre-loaded and the default mode set to "overlay at drop position." See L-001 — the drag-drop path uses `File.path` (Electron's non-standard property) which depends on `enableDragDropFiles: true` on the BrowserWindow. **The drag-drop image flow extends but DOES NOT replace the L-001 path** — the same property unlocks both PDF drops AND image drops. Wave 7 implementer (Riley) MUST NOT modify `window-manager.ts` to weaken L-001.

### 5.4 TIFF decoding boundary

Per `edit-replay-engine.md` §8.2. Phase 2 ships single-page TIFF with LZW / Deflate / Uncompressed support. Multi-page TIFF: first page only with warning. Document loudly in user-guide.md (Nathan Wave 9).

### 5.5 Phase-2 doesn't ship

- Image cropping (Phase 4)
- Image color adjustment (Phase 4)
- Image rotation independent of page rotation (Phase 4)
- Vector image import (SVG → PDF) (Phase 5 or later)

---

## 6. Bookmarks authoring (P2-L-6)

### 6.1 Schema delta

`migrations/0002_phase2_bookmarks.sql` (Ravi Wave 7):

```sql
-- Add parent_id and sort_order to user_bookmarks
ALTER TABLE user_bookmarks ADD COLUMN parent_id INTEGER REFERENCES user_bookmarks(id) ON DELETE CASCADE;
ALTER TABLE user_bookmarks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Index for tree traversal
CREATE INDEX idx_user_bookmarks_parent_id ON user_bookmarks(parent_id);

-- (Existing) idx_user_bookmarks_file_hash remains

-- Schema migration row
INSERT INTO schema_migrations (version, applied_at) VALUES (2, 1716394500000);
```

**Defaults:**
- `parent_id = NULL` for existing rows (every Phase-1 bookmark becomes top-level after migration).
- `sort_order = 0` for existing rows (ties broken by `id` ascending for stability).

`ON DELETE CASCADE` means deleting a parent deletes all descendants. The renderer confirms before deleting a bookmark with children (UI safety; the DB doesn't error if cascade happens unexpectedly).

Detail and DDL in `data-models.md` §7.

### 6.2 Repo interface extensions

`src/db/repositories/bookmarks-repo.ts` (Ravi edit):

```ts
interface BookmarksRepo {
  // Phase 1 — unchanged:
  listByFile(fileHash: string): BookmarkRow[];   // flat list, Phase 1 compat
  upsert(row: ...): number;
  delete(id: number): boolean;

  // Phase 2 — new:
  listTree(fileHash: string): BookmarkNodeRow[]; // hierarchical
  move(id: number, newParentId: number | null, newSortOrder: number): boolean;
  rename(id: number, title: string): boolean;
}

interface BookmarkRow {
  id: number;
  file_hash: string;
  page_index: number;
  title: string;
  created_at: number;
  parent_id: number | null;     // NEW
  sort_order: number;            // NEW
}

interface BookmarkNodeRow extends BookmarkRow {
  children: BookmarkNodeRow[];
}
```

The `db-bridge.ts` (David's adapter file from Wave 2) gains `adaptBookmarksRepoPhase2` that translates snake_case rows to camelCase for IPC, including the new `parentId` and `sortOrder` fields. Pattern locked Wave 2; David extends in Wave 7.

### 6.3 Bookmarks NOT in EditOperation union

Per `edit-replay-engine.md` §4.7. Bookmark CRUD goes through `bookmarks:*` IPC channels directly; it does NOT funnel through `applyEdit`. Justification:

1. Bookmarks live in SQLite, not PDF bytes.
2. Users want to bookmark without re-emitting the PDF (read-then-save UX trap).
3. Undo of a bookmark op IS still supported — the history middleware accepts any action with `meta.undoable: true`, and bookmark mutation actions carry that flag with their own inverse computation.

The renderer's `bookmarks-slice.ts` (existing Phase-1 file) gets new reducers for tree state and a new thunk family that calls `bookmarks:listTree`, `bookmarks:move`, `bookmarks:rename`, plus the existing `bookmarks:upsert` / `bookmarks:delete`. The renderer's UI tree component (`bookmarks-panel/`) rewrites from the read-only Phase-1 list to a drag-to-reorder + indent/outdent + inline-rename tree.

### 6.4 Native PDF outline write-through (export only)

Per `edit-replay-engine.md` §4.7 second half. When `pdf:export` is invoked, the engine optionally writes the user's bookmarks to the exported PDF's `/Outlines` dictionary. This is governed by a new setting `export.includeBookmarksInOutline` (boolean, default true). When true, the exported PDF has a navigable outline matching the user's authored bookmarks. When false, the exported PDF's outline matches the source.

`fs:writePdf kind:'ops'` (the regular Save path) does NOT write bookmarks to the outline — Save preserves the source's outline behavior. This is a deliberate split: Save = round-trip; Export = portable artifact.

---

## 7. Print to physical printer

New channel `pdf:print` (api-contracts.md §12). Implementation in `src/ipc/handlers/pdf-print.ts` (David Wave 7):

```ts
async function handlePdfPrint(req: PdfPrintRequest): Promise<PdfPrintResponse> {
  // 1. Replay current state (ops + annotations) to fresh bytes
  const replayResult = await replay({ originalBytes, ops, annotations, jobId: ... });
  if (!replayResult.ok) return mapReplayError(replayResult);

  // 2. Load replayed bytes into a hidden BrowserWindow via pdfedit:// protocol
  //    (same offscreen-window pattern as Chromium export engine; src/main/export/chromium-engine.ts)

  // 3. Call webContents.print() — Electron shows the OS print dialog if printerName is undefined,
  //    or sends to the named printer if specified.
  win.webContents.print(electronPrintOptions, (success, failureReason) => { ... });

  // 4. Destroy the offscreen window after the print job dispatches
  return ok({ jobDispatched: true });
}
```

The print dialog UX is the OS-native Electron print dialog (consistent with system conventions). No custom Print dialog component in Phase 2 (UI spec §11.5 doesn't add one; the existing Electron dialog suffices). If the user wants page-range selection within the app, they use the Electron dialog's built-in page-range input.

**Phase 2 doesn't ship:** custom print dialog, print preview, virtual printer driver, fax export, network printer auto-discovery. All Phase 5+ candidates per project-roadmap.md.

---

## 8. Op-ordering policy (locked)

Per `phase-2-plan.md` §7 question 1. **Dispatch order, no topological reorder.** Already in `edit-replay-engine.md` §6. Repeated here for cross-reference:

- Renderer dispatches ops in user-action order. Redux history middleware preserves that order on the past stack.
- Engine applies ops in `input.ops[]` array order — no batching, no commutativity exploitation.
- The only "conflict" is delete-then-edit on the same annotation, which the renderer slice resolves by removing the annotation from `state.current.annotations` on delete. Subsequent `annot-edit` for that id is a no-op at the engine layer (it's still in `ops[]` for undo, but the emit step skips because the annotation isn't in `annotations[]`).

---

## 9. Partial-failure rollback policy (locked)

Per `phase-2-plan.md` §7 question 2. **Whole-save abort.** Already in `edit-replay-engine.md` §9. Repeated:

- If op N fails inside `replay()`, no partial output is emitted. Caller receives `Result<_, 'op_apply_failed'>` with `details.opIndex`.
- The atomic-rename pattern (§3.6) ensures the destination file is untouched.
- The renderer's `dirtyOps` is NOT cleared. User can fix the offending op or retry.

The renderer's save thunk surfaces the failure via the existing error-toast pattern, with a specific message per error variant:

| Error variant | Toast message |
|---|---|
| `op_apply_failed` (text-replace + missing_glyph) | "Save failed: the text you replaced contains characters not in the original font. Cancel that edit and try again." |
| `image_decode_failed` | "Save failed: one of the images couldn't be processed. The file may be corrupt." |
| `text_span_not_found` | "Save failed: a text edit references a span that no longer exists. Cancel and re-edit." |
| `fs_write_failed` | "Save failed: couldn't write to disk. Try Save As to choose a different location." |
| `handle_not_found` | "Save failed: document state was lost. Please re-open the file." |
| `encrypted_unsupported` | "Save failed: the source PDF is encrypted in a way the default engine can't preserve. Try Export to PDF with the Chromium engine." |

---

## 10. Atomic save (locked)

Per `phase-2-plan.md` §7 question 3. See §3.6 above for the full pattern. Key points:

1. Write to temp file in same directory as destination.
2. Rename temp to destination (atomic on same filesystem).
3. Refresh `documentStore.setBytes(handle, newBytes)` after rename succeeds.
4. Rename-failure UX: toast + temp file left on disk with `details.tempPath` for recovery.

---

## 11. Original-bytes lifetime (locked)

Per `phase-2-plan.md` §7 question 4. **Bytes held for handle lifetime, no eviction.** See §3.5 above. Phase 5 multi-document revisits.

---

## 12. Image-embedding caching (locked)

Per `phase-2-plan.md` §7 question 5. **Dedup by content hash.** Per-`replay()` cache. See §3.7 and `edit-replay-engine.md` §7.

---

## 13. Print-to-PDF determinism (locked)

Per `phase-2-plan.md` §7 question 6. **New setting `export.deterministic` defaulting to false.** When true, post-process Chromium output to strip timestamps + replace `/ID`. pdf-lib path is deterministic already. See §3.8.1.

---

## 14. Text-edit span identification (locked)

Per `phase-2-plan.md` §7 question 7. **Click-into-text + main-process content-stream walk via `pdf:identifyTextSpan` channel.** See §4.2.

---

## 15. Phase 1 boundaries that Phase 2 closes

These are the doc-loop honesty obligations. Wave 9 (Nathan) must update each user-facing surface:

| Phase 1 limitation | Phase 2 reality | Doc update target |
|---|---|---|
| "Save does not preserve edits — saved file is a valid placeholder, not your work" | "Save preserves edits via the edit-replay engine" | `README.md` Phase 1 limitations section; `docs/user-guide.md` Known Limitations; `docs/user-guide.md` Saving section; HelpModal Phase-1 bullet; status-bar tooltip if any |
| `fs:writePdf kind:'ops'` returns `not_implemented` | Returns real `{ bytesWritten, newFileHash, annotationRefAssignments }` | `docs/api-reference.md`; `docs/api-contracts.md` (Phase-2 amendment) |
| `pdf:export` is a stub | Real implementation with dual-engine | Same as above |
| Undo/redo disabled in Phase 1 | Activated; Ctrl+Z / Ctrl+Y wired | `docs/user-guide.md` shortcuts table; HelpModal table |
| Bookmarks are flat (no nesting) | Tree with parent_id + sort_order | `docs/user-guide.md` Bookmarks section |
| Text editing "coming in Phase 2" | Replace-only with original font; limitations documented | `docs/user-guide.md` new section "Editing text"; HelpModal Phase 2 bullets removed for text edit |
| Image import "coming in Phase 2" | New-page + overlay; PNG/JPEG/TIFF | `docs/user-guide.md` new section "Inserting images" |
| Print "coming in Phase 2" | Live | `docs/user-guide.md` new section "Printing" |
| Export "coming in Phase 2" | Live | Same |

Nathan's Wave 9 brief MUST address each row. The "three impressions of honesty at point-of-action" pattern (Nathan Wave 4 lesson) extends to Phase 2: where the limitation was repeated at front-door + section-top + point-of-action, the closure must be reflected at all three.

---

## 16. Phase-2 fidelity boundary (new honesty obligations)

Phase 2 closes the H-3 boundary but introduces new fidelity boundaries the user-guide must document. These are NOT bugs — they are deliberate Phase-2 scope fences per locked decisions:

| Boundary | Description | Where to surface |
|---|---|---|
| Text-replace clipping | New text wider than original box clips at the edge | Tooltip during edit; user-guide Editing-text section |
| Text-replace missing glyph | New text contains codepoints not in original font | Inline indicator + tooltip during edit; user-guide |
| Image overlay round-trip | Once saved, an overlay becomes page content; re-opening the saved PDF shows the image as a fixed drawing, not an editable overlay | user-guide Inserting-images section (with example screenshot) |
| TIFF multi-page | Only first page imported | Tooltip in image-import modal when multi-page TIFF selected; user-guide |
| TIFF compression subtypes | LZW / Deflate / Uncompressed supported; CCITT-G4 + JPEG-in-TIFF best-effort | user-guide |
| Form fields | Pdf-lib loses appearance streams; pages with forms route to Chromium engine | Export dialog "Auto will choose: Chromium — source contains form fields" |
| Encrypted source | pdf-lib drops the security handler on save; export only via Chromium with warning | Export dialog + toast on save attempt |
| Linearization | Lost on save (pdf-lib doesn't emit linearized output) | user-guide Known Limitations |

Phase 3 (forms), Phase 4 (signing), and Phase 5 (multi-page TIFF, scan + OCR) progressively close these.

---

## 17. Extension points for Phase 3+

The Phase-1 `ARCHITECTURE.md` §8 extension-points table remains the canonical roadmap. Phase 2 fills the rows for "Image import", "Text editing", "Print", "Undo/redo UI". Phase 3+ rows are unchanged — those slots remain spec'd but not implemented.

Phase 2's main contribution to Phase 3+ extensibility: **the replay engine is the single funnel** for every PDF mutation. Phase 3+ features add new EditOperation variants and new `case` branches in `applyOp`; the surrounding architecture (handle-bytes retention, atomic write, undo middleware, dirtyOps accumulator) is reused.

---

## 18. What's NOT in Phase 2

Hard scope-fence per `phase-2-plan.md` §6. Listed here to absorb any Phase-2 brief drift:

- AcroForms detection or filling (Phase 3)
- Form designer (Phase 3)
- Mail merge (Phase 3)
- Signature capture / signing (Phase 4)
- Square/Circle/Line shape annotations (Phase 4)
- Scanning / TWAIN (Phase 5)
- OCR (Phase 5)
- Multi-page TIFF full support (Phase 5)
- Office export — docx/xlsx/pptx (Phase 6)
- macOS / Linux packaging (Phase 7)
- Auto-update (Phase 7)
- Localization (Phase 7)
- Custom-chrome / title-bar (uses existing Phase-1 `window:*` channels; UI rewrite Phase 7)

If a Phase-2 wave brief or implementation pulls toward any of these, the agent stops and surfaces to Marcus.

---

## 19. L-001 cross-check

**L-001 status: unchanged.** Phase 2 introduces:

- Drag-drop image onto canvas (depends on `File.path` Electron property; depends on `enableDragDropFiles: true`)
- Drag-drop PDF onto canvas / thumbnail strip (Phase 1; same dependency)

Both use the same Electron drag-drop pathway. L-001 keeps `enableDragDropFiles` at its default `true`. The Phase-2 image-import drag-drop EXTENDS the L-001 pathway; it does not weaken or modify it.

No new lock proposed in Wave 6. If Wave 7 implementation surfaces a need for a new lock (e.g. "image-overlay rect coordinates must always be sanitized before reaching pdf-lib"), that's a Marcus call after Julian's Wave 8 audit.

---

## 20. Cross-reference checklist (Wave 6 self-verification)

- [x] All 6 locked decisions encoded (§1)
- [x] Main keeps bytes per handle (§3) — lifecycle, memory budget, eviction policy spec'd
- [x] EditOperation extensions (§5 + data-models.md §7)
- [x] Replay model lazy-at-save (§3 + edit-replay-engine.md §3.1)
- [x] Print-to-PDF dual engine heuristic extended (§3.8)
- [x] New IPC channels listed (§2.5 + api-contracts.md §12)
- [x] Schema changes (bookmarks parent_id, sort_order; §6.1 + data-models.md §7)
- [x] Phase-3+ extension points (§17)
- [x] Phase-2 scope fence (§18)
- [x] Phase-1 boundaries closed (§15)
- [x] Phase-2 new boundaries surfaced (§16)
- [x] L-001 unchanged (§19)

End of Phase-2 architecture amendment.
