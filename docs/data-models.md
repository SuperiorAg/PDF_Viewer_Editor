# Data Models — SQLite Schema + In-Memory Document Model

**Author:** Riley (front-end-architect)
**Date:** 2026-05-21
**Status:** Wave 1, locked. SQLite schema is canonical for Ravi; in-memory types are canonical for David + Riley.
**Scope:** Phase 1. Phase 2+ additions are noted with `-- Phase N` markers but NOT defined here.

---

## 1. Conventions

- All `*_at` columns are `INTEGER` storing **milliseconds since Unix epoch** (`Date.now()`). NOT TEXT timestamps.
- All `value` blobs are `TEXT` containing JSON strings; the channel layer parses on read.
- Primary keys are explicit. `INTEGER PRIMARY KEY` aliases SQLite's rowid (auto-increment).
- File-hash strategy (canonical): `SHA-256( first 64 KiB of file bytes || ASCII string of file size )`, hex lowercase. Computed in main process. 64 KiB threshold balances "fast" with "differentiates near-identical PDFs."
- All write paths use **prepared statements**. No string concatenation. No `db.exec(userSuppliedSQL)`.
- All multi-row writes wrap in a **transaction** (`BEGIN; ...; COMMIT;`).

---

## 2. SQLite schema (DDL)

```sql
-- ============================================================
-- migrations/0001_init.sql
-- ============================================================

-- Migration tracking
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Recently opened files
CREATE TABLE recent_files (
  path           TEXT PRIMARY KEY,                  -- absolute path, OS-normalized
  last_opened_at INTEGER NOT NULL,                  -- ms epoch
  file_hash      TEXT NOT NULL,                     -- SHA-256(first 64 KiB || size), hex lowercase
  display_name   TEXT NOT NULL                      -- filename, no path
);
CREATE INDEX idx_recent_files_last_opened_at
  ON recent_files(last_opened_at DESC);
CREATE INDEX idx_recent_files_file_hash
  ON recent_files(file_hash);

-- Application settings (key/value, JSON-serialized values)
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,                           -- dotted notation, see §2.3
  value TEXT NOT NULL                               -- JSON-encoded value
);

-- User-authored bookmarks, per file (keyed by file_hash, not path)
CREATE TABLE user_bookmarks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_hash  TEXT NOT NULL,
  page_index INTEGER NOT NULL CHECK (page_index >= 0),
  title      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (file_hash, page_index, title)
);
CREATE INDEX idx_user_bookmarks_file_hash
  ON user_bookmarks(file_hash);

-- ============================================================
-- Phase 2+ tables (NOT created in 0001_init.sql; listed here for reference)
-- ============================================================
-- CREATE TABLE form_templates ( ... );        -- Phase 3
-- CREATE TABLE merge_jobs    ( ... );         -- Phase 3
-- CREATE TABLE signature_assets ( ... );      -- Phase 4
-- CREATE TABLE ocr_language_packs ( ... );    -- Phase 5
```

### 2.1 Example rows

```sql
-- recent_files
INSERT INTO recent_files (path, last_opened_at, file_hash, display_name) VALUES
  ('C:\Users\ahudson\Documents\contract.pdf',
   1716307200000,
   'a3f5e8b1c7d9...e2',  -- 64-hex SHA-256
   'contract.pdf');

-- app_settings
INSERT INTO app_settings (key, value) VALUES
  ('recents.maxItems',                '20'),
  ('open.maxFileSizeMB',              '500'),
  ('export.defaultEngine',            '"auto"'),
  ('export.showWarningsToast',        'true'),
  ('file_association.pdf.requested',  'true'),   -- Decision 4: default ON at install
  ('theme',                           '"system"'),
  ('undo.maxHistory',                 '100');

-- user_bookmarks
INSERT INTO user_bookmarks (file_hash, page_index, title, created_at) VALUES
  ('a3f5e8b1c7d9...e2', 0,  'Cover page',          1716307260000),
  ('a3f5e8b1c7d9...e2', 14, 'Indemnification',     1716307320000),
  ('a3f5e8b1c7d9...e2', 27, 'Signature block',     1716307380000);
```

### 2.2 `schema_migrations` example

```sql
INSERT INTO schema_migrations (version, applied_at) VALUES (1, 1716307100000);
```

Migration runner (Ravi's `src/db/migrate.ts`) reads `MAX(version)`, finds files in `migrations/` numbered `>` that, applies each in its own transaction, records the row. Idempotent on re-run.

### 2.3 Settings key registry

Authoritative list (cross-referenced with `docs/api-contracts.md` §5):

| Key | Value JSON type | Default | Set by |
|---|---|---|---|
| `recents.maxItems` | number | 20 | User (Settings dialog) |
| `open.maxFileSizeMB` | number | 500 | User (Settings dialog) |
| `export.defaultEngine` | `"auto"\|"pdf-lib"\|"chromium"` | `"auto"` | User (Settings dialog) |
| `export.showWarningsToast` | boolean | `true` | User (Settings dialog) |
| `file_association.pdf.requested` | boolean | `true` after install if user kept the checkbox | Installer (NSIS) + Settings dialog toggle |
| `theme` | `"system"\|"light"\|"dark"` | `"system"` | User (Settings dialog; Phase 2 wires UI) |
| `undo.maxHistory` | number | 100 | User (Settings dialog; Phase 2 wires UI) |

Renderer reads `settings:getAll` on boot and merges with its hardcoded defaults. Writes go through `settings:set`.

---

## 3. In-memory document model

Lives in renderer Redux store (`documentSlice`); David's main-process pdf-ops reads serializable subsets when needed.

### 3.1 Type hierarchy

```ts
// src/ipc/contracts.ts (David's file; types specified here)
// Renderer mirrors these in src/client/state/slices/document-slice.ts

type DocumentHandle = number;
type FileHash       = string; // 64-char hex lowercase

type AnnotationSubtype =
  // Phase 1
  | 'Highlight' | 'Text' | 'FreeText'
  // Phase 2
  | 'Underline' | 'StrikeOut' | 'Ink'
  // Phase 4
  | 'Square' | 'Circle' | 'Line';

interface PDFDocumentModel {
  handle: DocumentHandle;
  displayName: string;
  fileHash: FileHash;
  pageCount: number;             // mutates with insert/delete
  pages: PageModel[];
  annotations: AnnotationModel[];
  dirtyOps: EditOperation[];
  savedAtHandleVersion: number;  // 0 initially; increments on save
  pdflibLoadWarnings: string[];  // from pdf-lib's load; consumed by ExportEngineSelector
}

interface PageModel {
  pageIndex: number;             // 0-based; current ordinal (mutates with reorder)
  sourcePageRef: SourcePageRef;
  rotation: 0 | 90 | 180 | 270;
  width: number;                 // PDF user-space units (typically 612 = 8.5"x72)
  height: number;
}

type SourcePageRef =
  | { kind: 'original';  originalIndex: number }
  | { kind: 'inserted';  sourceFileHash: FileHash; sourcePageIndex: number }
  | { kind: 'blank';     width: number; height: number };
  // Phase 2 adds:
  // | { kind: 'image'; bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; width: number; height: number };

interface AnnotationModel {
  id: string;                    // UUID v4; stable across edits & undo
  pageIndex: number;             // current page (mutates with reorder)
  subtype: AnnotationSubtype;
  rect: PdfRect;                 // bounding box in PDF user-space (origin bottom-left)
  color: RgbColor;
  opacity: number;               // 0..1
  contents?: string;             // for Text, FreeText
  author?: string;               // from settings; defaults to OS username
  createdAt: number;             // ms epoch
  modifiedAt: number;            // ms epoch
  // subtype-specific fields:
  highlight?:   { quadPoints: number[] };               // Highlight only
  freeText?:    { fontSize: number; fontFamily: string }; // FreeText only
  ink?:         { paths: Array<{ x: number; y: number }[]> }; // Ink only (Phase 2)
  square?:      { borderWidth: number };                // Square only (Phase 4)
  // round-trip:
  pdfObjectNumber?: number;       // present after save; absent for unsaved
  dirty: boolean;                 // since last save
  preservedDict?: Record<string, unknown>; // unknown-subtype passthrough; read-only in UI
}

interface PdfRect { x: number; y: number; width: number; height: number }
interface RgbColor { r: number; g: number; b: number } // each 0..1

// ============================================================
// Edit operations — the heart of the document model
// ============================================================

interface EditMeta {
  ts: number;
  undoable: true;
  operationId: string; // UUID; used by undo middleware
}

type EditOperation =
  | { kind: 'reorder';      meta: EditMeta; fromIndex: number; toIndex: number }
  | { kind: 'insert';       meta: EditMeta; atIndex: number; source: SourcePageRef }
  | { kind: 'delete';       meta: EditMeta; pageIndex: number; preservedSource: SourcePageRef } // preservedSource lets undo restore the page
  | { kind: 'rotate';       meta: EditMeta; pageIndex: number; fromRotation: 0|90|180|270; toRotation: 0|90|180|270 }
  | { kind: 'annot-add';    meta: EditMeta; annotation: AnnotationModel }
  | { kind: 'annot-edit';   meta: EditMeta; id: string; before: Partial<AnnotationModel>; after: Partial<AnnotationModel> }
  | { kind: 'annot-delete'; meta: EditMeta; before: AnnotationModel };

// Serialized variant for IPC (Uint8Array doesn't survive structuredClone in some IPC paths)
type EditOperationSerialized = EditOperation; // same shape; SourcePageRef.kind='image' would base64-encode bytes in Phase 2
type AnnotationModelSerialized = AnnotationModel; // same shape
```

### 3.2 Inverse computation (for undo)

Every `EditOperation` has a deterministic inverse computed at dispatch time and stored on the history stack:

| Forward | Inverse |
|---|---|
| `reorder { from, to }` | `reorder { from: to, to: from }` |
| `insert { atIndex, source }` | `delete { pageIndex: atIndex, preservedSource: source }` |
| `delete { pageIndex, preservedSource }` | `insert { atIndex: pageIndex, source: preservedSource }` |
| `rotate { from, to }` | `rotate { from: to, to: from }` |
| `annot-add { annotation }` | `annot-delete { before: annotation }` |
| `annot-edit { id, before, after }` | `annot-edit { id, before: after, after: before }` |
| `annot-delete { before }` | `annot-add { annotation: before }` |

Inverses live next to the reducer in `src/client/state/slices/document-slice.inverses.ts` (Riley's file in Wave 2). Pure functions. Vitest-tested with property-based tests (each op composed with its inverse must yield identity).

### 3.3 Dirty-state semantics

- `document.dirtyOps.length > 0` ⇒ document modified
- UI: title bar shows `* displayName` when dirty; close prompt fires
- On successful save (`fs:writePdf` returns `ok: true`):
  - `dirtyOps = []`
  - `savedAtHandleVersion += 1`
  - Each `AnnotationModel` with `dirty: true` gets its `pdfObjectNumber` assigned and `dirty` cleared

### 3.4 Annotation round-trip — pdf-lib support matrix (Decision 2)

| User-visible | ISO 32000 Subtype | Phase | pdf-lib support | Notes |
|---|---|---|---|---|
| Highlight | `/Highlight` | 1 | Native | `QuadPoints` array; pdf-lib has helpers in 1.17+ |
| Sticky note | `/Text` | 1 | Native | `Contents`, icon name `Note`, `Open` bool |
| Text box | `/FreeText` | 1 | Native + manual appearance stream | pdf-lib creates the dict; appearance stream needed for cross-viewer fidelity (else some viewers won't display) |
| Underline | `/Underline` | 2 | Native | Like Highlight; QuadPoints |
| Strikethrough | `/StrikeOut` | 2 | Native | Like Highlight; QuadPoints |
| Freehand | `/Ink` | 2 | **Manual dict authoring** | `InkList` of point arrays; pdf-lib has no helper. **Flagged in ExportEngineSelector as a Chromium-fallback hint.** |
| Rectangle | `/Square` | 4 | Native | Border style, color, opacity |
| Circle / ellipse | `/Circle` | 4 | Native | Same as Square |
| Line / arrow | `/Line` | 4 | Native | `L` array (x1,y1,x2,y2), `LE` (line-ending styles) |

**No sidecar JSON** (Decision 2). Subtypes pdf-lib cannot author cleanly are either (a) hand-authored via `PDFDict` / `PDFArray` primitives in `src/main/pdf-ops/annotations.ts` (David's file in Wave 2 / 4), OR (b) trigger the Chromium export engine via the ExportEngineSelector heuristic so the visual is rendered.

### 3.5 Coordinate system

PDF native: origin at **bottom-left**, y-axis up, units = 1/72 inch.
Screen / pdf.js render: origin at **top-left**, y-axis down, units = device pixels at current zoom.

Conversion lives in **exactly one module**: `src/client/services/pdf-coords.ts` (Riley's file, Wave 2). API:

```ts
function pdfRectToScreen(rect: PdfRect, page: PageModel, viewport: PageViewport): ScreenRect;
function screenRectToPdf(rect: ScreenRect, page: PageModel, viewport: PageViewport): PdfRect;
function pdfPointToScreen(pt: { x: number; y: number }, page: PageModel, viewport: PageViewport): { x: number; y: number };
// ... etc.
```

Every annotation read/write goes through this module. Julian audits in Wave 3. Off-by-one and y-flip bugs are the single most common annotation defect — funnel them into one place.

---

## 4. Repository interfaces (Ravi owns implementation in `src/db/repositories/`)

Specified here so David's IPC handlers know what to call.

```ts
// src/db/repositories/recent-files-repo.ts (Ravi)
interface RecentFilesRepo {
  list(limit: number): RecentFileRow[];
  upsert(row: Omit<RecentFileRow, 'last_opened_at'> & { last_opened_at?: number }): void;
  clear(): number;  // returns rows deleted
  getByPath(path: string): RecentFileRow | null;
}

// src/db/repositories/settings-repo.ts (Ravi)
interface SettingsRepo {
  get<K extends SettingKey>(key: K): SettingValue<K> | null;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): void;
  getAll(): Partial<Record<SettingKey, unknown>>; // typed by caller
}

// src/db/repositories/bookmarks-repo.ts (Ravi)
interface BookmarksRepo {
  listByFile(fileHash: string): BookmarkRow[];
  upsert(row: Omit<BookmarkRow, 'id' | 'created_at'> & { id?: number; created_at?: number }): number; // returns id
  delete(id: number): boolean; // returns true if deleted
}
```

Row types (`RecentFileRow`, `BookmarkRow`) live in `src/db/types.ts` (Ravi's file) and mirror the SQL columns 1:1.

---

## 5. Connection management (Ravi)

- One connection per main-process app instance (better-sqlite3 is synchronous; one connection suffices).
- WAL mode enabled (`PRAGMA journal_mode = WAL`).
- `PRAGMA foreign_keys = ON` (no FKs in Phase 1 schema, but enable for Phase 2+).
- Prepared statements cached in repository constructors. Don't re-prepare in a hot loop.
- Database file location: `app.getPath('userData') / 'pdf-viewer-editor.db'`.
- Tests inject a `:memory:` connection.

---

## 6. Open data-model questions (not blocking Wave 2)

1. **Bookmarks on reordered pages** — if user authors a bookmark on page 5, then reorders so the original page 5 becomes page 12, does the bookmark follow the page or the index? **Decision: follows the page.** Bookmarks bind to `SourcePageRef`, not `pageIndex`. Phase 2 will surface this in UI; Phase 1 keeps the simpler index-only binding and notes the limitation in the user guide.
2. **fileHash collisions** — extremely unlikely for SHA-256(64 KiB || size), but if two files collide, bookmarks merge. Acceptable for Phase 1.
3. **Migration rollback** — not planned. Forward-only migrations. If a migration fails partway, the transaction rolls back and the version row isn't written; next launch re-attempts.

---

## 7. Phase 2 additions (2026-05-21, Riley)

> ### Phase 2 amendment (2026-05-21)
>
> §1-§6 above remain FROZEN at Wave 1. Additions below are append-only.

This section adds:
- Six new `EditOperation` variants
- New `SourcePageRef` variant for image-as-page
- Image-embed model (`ImageEmbedPayload`, content-hash dedup)
- Bookmarks schema delta (`0002_phase2_bookmarks.sql`) with `parent_id` + `sort_order`
- Updated `BookmarkRow` shape + new `BookmarkNode`
- New repo methods: `listTree`, `move`, `rename`
- New `SettingKey`s

### 7.1 EditOperation extensions

```ts
// extends data-models.md §3.1 EditOperation union (append-only)

type EditOperation =
  // ...Phase 1 variants (reorder, insert, delete, rotate, annot-add, annot-edit, annot-delete)...

  // Phase 2:
  | { kind: 'image-insert';
      meta: EditMeta;
      atIndex: number;
      image: ImageEmbedPayload;
    }
  | { kind: 'image-overlay';
      meta: EditMeta;
      pageIndex: number;
      rect: PdfRect;
      image: ImageEmbedPayload;
      overlayId: string;                  // UUID; lets later ops reference this overlay
    }
  | { kind: 'image-overlay-edit';
      meta: EditMeta;
      pageIndex: number;
      overlayId: string;
      beforeRect: PdfRect;
      afterRect: PdfRect;
    }
  | { kind: 'image-overlay-delete';
      meta: EditMeta;
      pageIndex: number;
      overlayId: string;
      before: { rect: PdfRect; image: ImageEmbedPayload };  // for undo
    }
  | { kind: 'text-replace';
      meta: EditMeta;
      pageIndex: number;
      objectId: string;                   // pageObjectNumber/contentStreamIndex/runIndex (see edit-replay-engine.md §4.6.1)
      oldText: string;                    // for inverse
      newText: string;
    };

interface ImageEmbedPayload {
  bytes: Uint8Array;                       // populated by pdf:embedImage handler in main; renderer dispatches via op
  mimeType: 'image/png' | 'image/jpeg' | 'image/tiff';
  width: number;                           // intrinsic pixel width
  height: number;                          // intrinsic pixel height
  contentHash: string;                     // sha256(bytes), hex lowercase; used for engine-side dedup (see edit-replay-engine.md §7)
}
```

#### 7.1.1 Where does `image.bytes` live in the renderer?

The Uint8Array of an image is stored on the EditOperation in `dirtyOps`. This is allowed by conventions §10 because the EditOperation is **transient** (cleared on save). For long-lived history entries (history-slice.past), the renderer stores ONLY the `contentHash`, not the bytes — see §7.1.4 below.

The main-process replay engine looks up the bytes from its own per-save image cache (§7 of edit-replay-engine.md). After save, the EditOperations are cleared from `dirtyOps` but the history entries remain with their content-hash references; the bytes remain in main's `DocumentStore` cache for the handle's lifetime, indexed by content hash for redo retrieval.

#### 7.1.2 New `SourcePageRef` variant

```ts
// extends §3.1 SourcePageRef union
type SourcePageRef =
  | { kind: 'original'; originalIndex: number }
  | { kind: 'inserted'; sourceFileHash: FileHash; sourcePageIndex: number }
  | { kind: 'blank'; width: number; height: number }
  // Phase 2:
  | { kind: 'image'; image: ImageEmbedPayload; pageWidth: number; pageHeight: number };
```

`SourcePageRef { kind: 'image' }` is the inverse target of an `image-insert` op — when undo dispatches a `delete` op whose `preservedSource` is `{ kind: 'image', ... }`, redo can re-create the page by re-running the `image-insert` (or by `insert { source: { kind: 'image', ... } }`).

#### 7.1.3 Inverse table (extends §3.2)

| Forward | Inverse |
|---|---|
| `image-insert { atIndex, image }` | `delete { pageIndex: atIndex, preservedSource: { kind: 'image', image, pageWidth: …, pageHeight: … } }` |
| `image-overlay { pageIndex, rect, image, overlayId }` | `image-overlay-delete { pageIndex, overlayId, before: { rect, image } }` |
| `image-overlay-edit { pageIndex, overlayId, beforeRect, afterRect }` | `image-overlay-edit { pageIndex, overlayId, beforeRect: afterRect, afterRect: beforeRect }` |
| `image-overlay-delete { pageIndex, overlayId, before }` | `image-overlay { pageIndex, rect: before.rect, image: before.image, overlayId }` |
| `text-replace { pageIndex, objectId, oldText, newText }` | `text-replace { pageIndex, objectId, oldText: newText, newText: oldText }` |

Bookmarks ops (§7.3) have their own inverse table — they do NOT live in the EditOperation union per `edit-replay-engine.md` §4.7.

#### 7.1.4 History storage of image bytes

To prevent history-slice from holding gigabytes of image data:

```ts
// src/client/state/slices/history-slice.ts — Phase 2 activated form
interface HistoryEntry {
  fwd: EditOperation;
  inv: EditOperation;
}

// For image ops, the renderer rewrites image.bytes -> a zero-length Uint8Array
// before pushing onto history. The contentHash is preserved.
// Redo retrieves the bytes from main via pdf:embedImage with { existingHash: contentHash }
// which short-circuits the encode + returns the cached embed.
//
// In Phase 2, this is implemented by a small helper:
function compactImageOpForHistory(op: EditOperation): EditOperation {
  if (op.kind === 'image-insert' || op.kind === 'image-overlay') {
    return { ...op, image: { ...op.image, bytes: new Uint8Array(0) } };
  }
  return op;
}
```

Convention §13 (`conventions.md` §13 Phase-2 addition) documents this pattern.

### 7.2 Image-embed model

```ts
interface PdfImage {
  contentHash: string;          // sha256 hex
  mimeType: 'image/png' | 'image/jpeg' | 'image/tiff';
  width: number;                // intrinsic pixel dims
  height: number;
  /** Source bytes; held in main's image-cache for the handle's lifetime. */
  bytes: Uint8Array;
}

interface ImagePlacement {
  /** Where to place on a page. PDF user-space, origin bottom-left. */
  rect: PdfRect;
  /** Optional rotation; Phase 2 ships only 0 (rotate the image overlay via the page rotation if needed). */
  rotation?: 0;
}
```

`PdfImage` lives in main only. The renderer references images by `contentHash` (a string) — never holds the bytes. The IPC channel `pdf:embedImage` (api-contracts.md §12.1) is the boundary: renderer sends bytes ONCE; main hashes + caches; subsequent ops reference by hash.

### 7.3 Bookmarks schema delta (`0002_phase2_bookmarks.sql`)

Per locked decision P2-L-6.

#### 7.3.1 DDL

```sql
-- ============================================================
-- migrations/0002_phase2_bookmarks.sql (Phase 2, Ravi Wave 7)
-- Forward-only. Adds nesting + ordering to user_bookmarks.
-- ============================================================

-- Add parent_id (NULL = top-level) and sort_order (lower = earlier in sibling list).
ALTER TABLE user_bookmarks ADD COLUMN parent_id INTEGER REFERENCES user_bookmarks(id) ON DELETE CASCADE;
ALTER TABLE user_bookmarks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Index for tree traversal.
CREATE INDEX idx_user_bookmarks_parent_id ON user_bookmarks(parent_id);

-- Record the migration.
INSERT INTO schema_migrations (version, applied_at) VALUES (2, strftime('%s', 'now') * 1000);
```

#### 7.3.2 Migration behavior

- Existing rows: `parent_id` defaults to NULL (top-level), `sort_order` defaults to 0. The renderer's `bookmarks-slice` should fall back to ordering ties by `id` ASC when `sort_order` ties.
- New rows (via `bookmarks:upsert`): the renderer supplies `parentId` (nullable) and `sortOrder`. The repo's `upsert` widens to accept both.
- Cascade delete: removing a parent removes all descendants. The UI should prompt before deleting a bookmark with children (defensive — avoids surprising the user with a sub-tree wipe).

#### 7.3.3 Rollback policy

Forward-only per §6.3. If 0002 fails partway (extremely unlikely; ALTER TABLE + ADD COLUMN is atomic in WAL mode), the transaction rolls back and `schema_migrations` is unchanged. Next launch re-attempts. No rollback path is provided.

#### 7.3.4 Phase-2 fileHash invariant

Phase-1 §6 question 1 answered: bookmarks bind to `SourcePageRef`, not `pageIndex`. Phase 2 keeps the same binding model for new bookmarks. The `page_index` column stores the index at creation time; the renderer reconciles to the current index when the doc is opened (since `SourcePageRef` is not stored in SQL, the reconciliation relies on the page still being at that index — a Phase-2 limitation that Phase 5 may revisit when reorders persist across sessions). Document in user-guide.md.

### 7.4 `BookmarkRow` shape update

```ts
// src/db/types.ts (Ravi Wave 7 edit)

interface BookmarkRow {
  id: number;
  file_hash: string;
  page_index: number;
  title: string;
  created_at: number;
  parent_id: number | null;      // NEW Phase 2
  sort_order: number;             // NEW Phase 2
}

// IPC contract camelCase (data-models.md §3.1 convention):
interface BookmarkRowDto {
  id: number;
  fileHash: string;
  pageIndex: number;
  title: string;
  createdAt: number;
  parentId: number | null;
  sortOrder: number;
}

interface BookmarkNode extends BookmarkRowDto {
  children: BookmarkNode[];
}
```

`db-bridge.ts` (David's adapter file, Wave 2 — Wave-7-extended) translates `BookmarkRow` ↔ `BookmarkRowDto`.

### 7.5 Repo interface extensions

> ### Wave 8.5 amendment (2026-05-21, David)
>
> `move()` now returns a `MoveBookmarkResult` discriminated union rather than `boolean`. The boolean form collapsed three distinct failure modes (`not_found`, `cycle_detected`, `invalid_parent`) into one signal, forcing the IPC handler to heuristically reconstruct the variant from the request shape — mis-classifying every legitimate `not_found` with a non-null parent as `cycle_detected`, and rendering `invalid_parent` permanently unreachable. The union flows end-to-end from `src/db/repositories/bookmarks-repo.ts` through `src/main/db-bridge.ts` to `src/ipc/handlers/bookmarks-phase2.ts`. Marcus's Wave 8 brief endorsed this as "amend doc to match shipped reality (better-spec'd union)."

```ts
// src/db/repositories/bookmarks-repo.ts (Ravi Wave 7 + David Wave 8.5)

type MoveBookmarkResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'cycle_detected' | 'invalid_parent' };

interface BookmarksRepo {
  // Phase 1 — unchanged signatures (backward-compatible):
  listByFile(fileHash: string): BookmarkRow[];          // flat list
  upsert(row: Omit<BookmarkRow, 'id' | 'created_at'> & { id?: number; created_at?: number }): number;
  delete(id: number): boolean;

  // Phase 2 — new methods:
  listTree(fileHash: string): BookmarkNodeRow[];                                    // hierarchical
  move(id: number, newParentId: number | null, newSortOrder: number): MoveBookmarkResult; // Wave 8.5: was `boolean`
  rename(id: number, title: string): boolean;
}

interface BookmarkNodeRow extends BookmarkRow {
  children: BookmarkNodeRow[];
}
```

`listByFile` remains for Phase-1 callers; new callers prefer `listTree`. `upsert` extends to accept the two new fields with defaults (`parent_id = NULL`, `sort_order = 0`).

`move`'s cycle-detection: implemented in-JS walking the parent chain — verify that `newParentId` is not in the descendants of `id` and that the parent (if non-null) exists and belongs to the same `file_hash`. The repo returns `{ ok: false, error: 'cycle_detected' }` for cycles, `{ ok: false, error: 'invalid_parent' }` for missing or cross-file parents, `{ ok: false, error: 'not_found' }` for missing bookmark ids. The IPC handler `bookmarks:move` maps each variant to the appropriate `BookmarksMoveError` (`'cycle_detected'`, `'invalid_payload'`, `'not_found'` respectively).

### 7.6 New setting keys

```ts
// extends §2.3 Settings key registry

| Key | Value JSON type | Default | Set by |
|---|---|---|---|
| `export.deterministic` | boolean | `false` | User (Settings dialog → Export) |
| `export.includeBookmarksInOutline` | boolean | `true` | User (Settings dialog → Export) |
| `editing.confirmDelete` | boolean | `true` | User (Settings dialog → Editing) |
| `editing.commitTextOnBlur` | boolean | `true` | User (Settings dialog → Editing) |
```

`'export.deterministic'`: when true, strips wall-clock timestamps from Chromium-engine export output for reproducible builds. pdf-lib path is already deterministic. Default false to match mainstream user expectations.

`'export.includeBookmarksInOutline'`: when true (default), `pdf:export` writes user-authored bookmarks to the exported PDF's `/Outlines` dictionary. When false, the exported PDF inherits the source's outline only.

`'editing.confirmDelete'`: when true (default), the UI prompts before deleting a page, annotation, or bookmark. Absorbs Julian Wave 2 MEDIUM finding I-2 (Phase 2 absorption).

`'editing.commitTextOnBlur'`: when true (default), the text-edit inline editor commits on click-out. When false, only Enter commits (Esc cancels). User preference.

### 7.7 Annotation subtype activations (Phase 2)

Per `data-models.md` §3.4 (no change to the table). Phase 1 shipped `/Highlight`, `/Text`, `/FreeText`. Phase 2 activates `/Underline`, `/StrikeOut`, `/Ink`. The `AnnotationSubtype` union (§3.1) already includes these — no type change needed. The toolbar (ui-spec.md §11) enables the corresponding buttons.

The `/Ink` annotation uses hand-authored `PDFDict` per `data-models.md` §3.4 (no native pdf-lib helper). The dict shape is documented in `edit-replay-engine.md` §5.2.

`AnnotationModel.ink.paths` (existing optional field) is now LIVE.

### 7.8 Phase 2 open questions (carried forward)

None new — all Phase 2 open questions from `phase-2-plan.md` §7 have been answered in this amendment, `architecture-phase-2.md`, or `edit-replay-engine.md`. Cross-reference table:

| phase-2-plan §7 question | Answer location |
|---|---|
| 1. Op ordering | architecture-phase-2.md §8; edit-replay-engine.md §6 — dispatch order |
| 2. Partial-failure rollback | architecture-phase-2.md §9; edit-replay-engine.md §9 — whole-save abort |
| 3. Atomic save | architecture-phase-2.md §10; edit-replay-engine.md §10 — write-to-temp, rename |
| 4. Bytes lifetime | architecture-phase-2.md §11 — held for handle lifetime |
| 5. Image dedup | architecture-phase-2.md §12; edit-replay-engine.md §7 — content-hash cache per save |
| 6. Determinism | architecture-phase-2.md §13 — new setting `export.deterministic` |
| 7. Text-edit span identification | architecture-phase-2.md §14; api-contracts.md §12.3 — `pdf:identifyTextSpan` channel |

---

## 8. Phase 3 additions (2026-05-22, Riley)

> ### Phase 3 amendment (2026-05-22)
>
> §1-§7 above remain FROZEN at Wave 6. Additions below are append-only. Per the Phase-3 freeze rule (`docs/architecture-phase-3.md §13`), Phase-1 + Phase-2 sections do not change.

This section adds:
- `FormFieldDefinition`, `FormFieldValue`, `FormFieldType`, `FormFieldOption` types
- Four new `EditOperation` variants (`form-commit`, `form-design-add`, `form-design-remove`, `form-design-edit`)
- Schema v3 DDL (`form_templates` table)
- `FormTemplateRow` + DTO shape
- `FormTemplatesRepo` interface
- Four new `SettingKey`s

### 8.1 Form-field types

```ts
// extends data-models.md §3.1 — Phase 3 append-only

type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'        // a radio GROUP; individual radio buttons live in options[]
  | 'dropdown'     // single-select combo box
  | 'signature'    // placeholder only; signing arrives Phase 4
  | 'date';        // text field with date-format hint + locale-aware renderer

interface FormFieldDefinition {
  /** Unique within document. AcroForm field name (period-separated for nested fields). */
  name: string;
  type: FormFieldType;
  pageIndex: number;
  /** Widget rect in PDF user-space (origin bottom-left). */
  rect: PdfRect;
  /** UI-visible label; defaults to `name` if author didn't supply a /TU (tooltip) entry. */
  label: string;
  /** Required-flag from AcroForm /Ff bit 2 (Required). */
  required: boolean;
  /** Optional default value populated into the AcroForm /DV entry. */
  defaultValue?: FormFieldValue;
  /** For radio + dropdown only; options the user can pick from. */
  options?: FormFieldOption[];
  /** Origin of the field: detected from source PDF, or authored by user this session. */
  origin: 'detected' | 'authored';
  /** True when the field was authored in the current session and hasn't been saved yet. */
  unsaved: boolean;
}

interface FormFieldOption {
  /** Export value written to /V on selection. */
  value: string;
  /** Display label shown in the UI. */
  label: string;
}

type FormFieldValue =
  | { type: 'text';      value: string }
  | { type: 'checkbox';  value: boolean }
  | { type: 'radio';     value: string /* one of options[].value */ }
  | { type: 'dropdown';  value: string }
  | { type: 'signature'; value: null /* always null in Phase 3 */ }
  | { type: 'date';      value: string /* ISO-8601 YYYY-MM-DD */ };
```

### 8.2 EditOperation extensions

```ts
// extends data-models.md §3.1 + §7.1 EditOperation union (Phase 3 append-only)

type EditOperation =
  // ...Phase 1 + Phase 2 variants...

  // Phase 3:
  | { kind: 'form-commit';
      meta: EditMeta;
      /** Map of field.name → new value. Only changed values appear. */
      fieldValues: Record<string, FormFieldValue>;
      /** Snapshot of prior committed values for each changed field (undo target). */
      previousValues: Record<string, FormFieldValue | undefined>;
    }
  | { kind: 'form-design-add';
      meta: EditMeta;
      fieldDefinition: FormFieldDefinition;
    }
  | { kind: 'form-design-remove';
      meta: EditMeta;
      fieldName: string;
      before: FormFieldDefinition;      // full snapshot for inverse re-author
    }
  | { kind: 'form-design-edit';
      meta: EditMeta;
      fieldName: string;
      before: Partial<FormFieldDefinition>;
      after: Partial<FormFieldDefinition>;
    }
  | { kind: 'form-flatten';
      meta: EditMeta;
      /** Snapshot of fields BEFORE flatten, for inverse undo via re-creating fields + re-filling. */
      beforeFields: FormFieldDefinition[];
      beforeValues: Record<string, FormFieldValue>;
    };
```

Note: `form-flatten` is a deliberately heavy inverse (re-creating N fields + re-filling). Phase 3 ships the inverse for correctness but the user-facing UX may surface a confirm before flatten with "this is irreversible after save" copy — see `ui-spec.md §12.5`. The history middleware preserves the inverse so undo BEFORE save works; undo AFTER save also works at the renderer level but the saved bytes have already been flattened (the original interactivity is gone from disk). The next save re-emits the un-flattened fields with their values, restoring interactivity in the on-disk file.

### 8.3 Inverse table (extends §3.2 + §7.1.3)

| Forward | Inverse |
|---|---|
| `form-commit { fieldValues, previousValues }` | `form-commit { fieldValues: previousValues, previousValues: fieldValues }` |
| `form-design-add { fieldDefinition }` | `form-design-remove { fieldName: fieldDefinition.name, before: fieldDefinition }` |
| `form-design-remove { fieldName, before }` | `form-design-add { fieldDefinition: before }` |
| `form-design-edit { fieldName, before, after }` | `form-design-edit { fieldName, before: after, after: before }` |
| `form-flatten { beforeFields, beforeValues }` | A composite synthesized at undo time: dispatch `form-design-add` per field in `beforeFields`, then `form-commit` with `beforeValues`. The history middleware emits a single history entry referencing the composite; documented in `architecture-phase-3.md §5.5` |

Implementation note: the renderer's `document-inverses.ts` (Phase 1 file, Phase 2 extended) adds five new branches. The `form-flatten` inverse is a function that returns a thunk-like composite (matches the Phase 2 pattern for compact history entries).

### 8.4 SQLite schema v3 — `form_templates` table

```sql
-- ============================================================
-- migrations/0003_phase3_forms.sql (Phase 3, Ravi Wave 12)
-- Forward-only. Adds form_templates table for cross-file template storage.
-- ============================================================

CREATE TABLE form_templates (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT NOT NULL UNIQUE,
  /** JSON-encoded FormFieldDefinition[]. */
  fields_json              TEXT NOT NULL,
  /** Optional source-doc file_hash; null for templates authored from scratch. */
  source_doc_hash          TEXT,
  /** JSON-encoded Record<columnName, fieldName> from the last mail-merge run; null until first run. */
  last_column_mappings     TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE INDEX idx_form_templates_name ON form_templates(name);
CREATE INDEX idx_form_templates_updated_at ON form_templates(updated_at DESC);

INSERT INTO schema_migrations (version, applied_at) VALUES (3, strftime('%s', 'now') * 1000);
```

#### 8.4.1 Migration behavior

- Idempotent at the runner level — Ravi's `migrate.ts` (Phase 1 file) skips applied versions per `data-models.md §2.2`.
- Forward-only. No rollback (consistent with Phase 1 + Phase 2 policy).
- Clean migration from schema v2 (Phase 2 bookmarks): no existing tables touched. v2-installed users get v3 on first launch of the Phase 3 build.
- Cross-file design: templates are keyed by `id`, not `file_hash`. A template authored against one PDF can be applied to any other PDF.
- `name` is `UNIQUE` — duplicate template names return `name_in_use` (api-contracts §13.7).

#### 8.4.2 Why not per-file association

Considered: extend `user_bookmarks`-style per-file association (templates keyed by `file_hash`). Rejected — see `architecture-phase-3.md §7.3` for the full rationale. The short version: cross-file reuse is the 80% use case; per-file binding is fragile (PDF hash changes when the PDF is edited).

#### 8.4.3 Rollback policy

Forward-only per §6.3. If 0003 fails partway (extremely unlikely; CREATE TABLE + indexes are atomic in WAL mode), the transaction rolls back and `schema_migrations` is unchanged. Next launch re-attempts.

### 8.5 Row + DTO shapes

```ts
// src/db/types.ts (Ravi Wave 12 edit)

interface FormTemplateRow {
  id: number;
  name: string;
  fields_json: string;
  source_doc_hash: string | null;
  last_column_mappings: string | null;
  created_at: number;
  updated_at: number;
}

// IPC contract camelCase (data-models.md §3.1 convention):
interface FormTemplateRowDto {
  id: number;
  name: string;
  fields: FormFieldDefinition[];                              // PARSED from fields_json
  sourceDocHash: string | null;
  lastColumnMappings: Record<string, string> | null;          // PARSED from last_column_mappings
  createdAt: number;
  updatedAt: number;
}
```

`db-bridge.ts` (David's adapter) translates `FormTemplateRow` ↔ `FormTemplateRowDto`, parsing/serializing JSON columns at the IPC boundary.

### 8.6 Repository interface

```ts
// src/db/repositories/form-templates-repo.ts (Ravi Wave 12)

interface FormTemplatesRepo {
  list(): FormTemplateRow[];                                  // ordered by updated_at DESC
  get(id: number): FormTemplateRow | null;
  getByName(name: string): FormTemplateRow | null;
  upsert(row: Omit<FormTemplateRow, 'id' | 'created_at' | 'updated_at'> & {
    id?: number;
    created_at?: number;
    updated_at?: number;
  }): number;                                                  // returns id
  delete(id: number): boolean;
  updateColumnMappings(id: number, mappings: Record<string, string>): boolean;
}
```

`updateColumnMappings` is a convenience for the mail-merge runner — after a successful run, the runner persists the column mapping back to the template so the next run pre-populates it (`architecture-phase-3.md §6.4`).

### 8.7 New `SettingKey`s

```ts
// extends §2.3 Settings key registry

| Key | Value JSON type | Default | Set by |
|---|---|---|---|
| `forms.dateLocale` | `"system"|"en-US"|"en-GB"|"ISO"` | `"system"` | User (Settings dialog → Forms) |
| `forms.flattenOnExportDefault` | boolean | `false` | User (Settings dialog → Forms) |
| `mailMerge.lastOutputFolder` | string | `""` | Auto (mail-merge wizard step 4 persists last folder) |
| `mailMerge.defaultOutputMode` | `"folder"|"concat"` | `"folder"` | User (Settings dialog → Forms) |
```

`'forms.dateLocale'`: controls how the renderer's date picker parses + displays date values. `'system'` reads `Intl.DateTimeFormat().resolvedOptions().locale`. The PDF on-disk value is always ISO-8601 regardless of locale; the locale only affects renderer presentation.

`'forms.flattenOnExportDefault'`: default state of the "Flatten forms" checkbox in the Save As / Export dialog. False matches the round-trip-friendly default; users who never want interactive output can flip it.

`'mailMerge.lastOutputFolder'`: auto-populates the folder picker in mail-merge wizard step 4. Updated by the runner on successful completion.

`'mailMerge.defaultOutputMode'`: which radio button is preselected in step 4 of the mail-merge wizard. `'folder'` matches the most common use case.

### 8.8 FormFieldDefinition validation rules (zod schema spec)

For David's zod schemas in the Phase-3 handlers:

| Field | Rule |
|---|---|
| `name` | string, 1..63 chars, no `.` (period-separated names are NOT supported by the renderer's Inspector in Phase 3; Phase 3.1 may add nested-field support) |
| `type` | one of the 6 FormFieldType literals |
| `pageIndex` | integer, ≥ 0, < pageCount |
| `rect.x/y` | number, finite |
| `rect.width/height` | number, > 0 |
| `label` | string, 0..200 chars |
| `required` | boolean |
| `options` | array of FormFieldOption; required if type === 'radio' or 'dropdown'; forbidden for other types |
| `options[].value` | string, 1..100 chars |
| `options[].label` | string, 0..200 chars |
| `defaultValue` | matches `type` per FormFieldValue union; optional |

Out-of-bounds rect coords are clamped to page bounds with a warning per api-contracts §13.4. Names with `.` get rejected at the handler boundary with `invalid_field_definition`.

### 8.9 Phase 3 open questions (carried forward)

None new — all Phase 3 design questions from `wave-11-brief.md §"Specific design questions you must answer"` have been answered in `architecture-phase-3.md`, `form-engine.md`, this amendment, or the api-contracts §13 amendment. Cross-reference:

| Wave-11-brief question | Answer location |
|---|---|
| A. pdf-lib CREATE boundary | architecture-phase-3.md §4.2; form-engine.md §3.4 + §3.7 — native-supported + manual-dict for signature |
| B. EditOperation integration | architecture-phase-3.md §5 — HYBRID with commit boundary |
| C. Mail-merge progress reporting | architecture-phase-3.md §6.3; api-contracts.md §13.10 — IPC stream + modal with cancel |
| D. Field-mapping UI | architecture-phase-3.md §6.4 — auto-detect + per-template persistence in form_templates.last_column_mappings |
| E. Form designer placement coords | UI in screen-space; conversion to PDF user-space at IPC boundary via pdf-coords.ts (`ui-spec.md §12` — see Phase-3 amendment) |
| F. Signature placeholders | architecture-phase-3.md §8 — placeholder in Phase 3 + Phase 4 handoff |
| G. Form template storage | architecture-phase-3.md §7.3; this §8.4.2 — cross-file table, not per-file |

---

## 9. Phase 4 additions (2026-05-26, Riley)

> ### Phase 4 amendment (2026-05-26)
>
> §1-§8 above remain FROZEN at Wave 11. Additions below are append-only. Per the Phase-4 freeze rule (`docs/architecture-phase-4.md §13`), Phase-1 + Phase-2 + Phase-3 sections do not change.

This section adds:
- `SignaturePlacement`, `VisualAppearanceSpec`, `PadesAppearanceSpec`, `VisualAppearanceSource` types
- `SignaturePayload` (extending Phase-3 `FormFieldValue.{ type: 'signature' }`)
- Five new `EditOperation` variants (`signature-visual-place`, `signature-pades-applied`, `annot-add-shape`, `annot-edit-shape`, `annot-delete-shape`)
- `ShapeAnnotationModel` for the 7 new shape/line/callout/measure annotations
- Schema v4 DDL (`signature_audit_log` table)
- `SignatureAuditRow` + DTO + `SignatureAuditRepo` interface
- `MeasureCalibration` type
- Eleven new `SettingKey`s

### 9.1 Signature placement + appearance types

```ts
// extends data-models.md §3.1 — Phase 4 append-only

type SignaturePlacementMode = 'placeholder' | 'freeform';

interface SignaturePlacement {
  mode: SignaturePlacementMode;
  /** When mode='placeholder', the Phase-3 /Sig field to fill. */
  fieldName?: string;
  /** When mode='freeform', the page + rect for a new /Sig field. */
  pageIndex?: number;
  rect?: PdfRect;
  rotation?: 0 | 90 | 180 | 270;
}

type VisualAppearanceSource =
  | { kind: 'typed'; name: string; fontFamily?: string; fontSize?: number; pngBytes: Uint8Array; widthPx: number; heightPx: number }
  | { kind: 'drawn'; pngBytes: Uint8Array; widthPx: number; heightPx: number }
  | { kind: 'image'; bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg'; widthPx: number; heightPx: number };

interface VisualAppearanceSpec {
  source: VisualAppearanceSource;
  showName: boolean;
  showDate: boolean;
  showReason: boolean;
  showSubjectCN: boolean;                 // visual: always false; included for type symmetry
  showIssuerCN: boolean;                  // visual: always false
  showTsaInfo: boolean;                   // visual: always false
  reason?: string;
}

interface PadesAppearanceSpec extends VisualAppearanceSpec {
  showSubjectCN: boolean;                 // default true
  showIssuerCN: boolean;                  // default false
  showTsaInfo: boolean;                   // default false
}
```

### 9.2 Extending `FormFieldValue.{ type: 'signature' }` from Phase 3

Phase 3 `FormFieldValue.{ type: 'signature', value: null }` (§8.1) is extended to carry a non-null `SignaturePayload`:

```ts
// extends data-models.md §8.1 FormFieldValue union — Phase 4 amendment

type FormFieldValue =
  | { type: 'text';      value: string }
  | { type: 'checkbox';  value: boolean }
  | { type: 'radio';     value: string }
  | { type: 'dropdown';  value: string }
  | { type: 'signature'; value: SignaturePayload | null }   // null = placeholder; non-null = signed
  | { type: 'date';      value: string };

interface SignaturePayload {
  kind: 'visual' | 'pades';
  /** SignatureAuditLog row id; null for visual signatures (no audit row). */
  auditLogRowId: number | null;
  /** Cert SHA-256 fingerprint; null for visual signatures. */
  fingerprint: string | null;
  /** Subject CN from the cert; null for visual signatures. */
  subjectCN: string | null;
  /** When the signature was applied (ms epoch). For visual, derived from the widget's /M entry. */
  signedAt: number;
  /** TSA URL used; null for visual or no-TSA PAdES. */
  tsaUrl: string | null;
}
```

**Phase-3 backward compatibility:** existing Phase-3 placeholders continue to have `{ type: 'signature', value: null }`. The renderer pattern-matches on `value === null` for placeholder vs signed.

### 9.3 EditOperation extensions

```ts
// extends data-models.md §3.1 + §7.1 + §8.2 EditOperation union (Phase 4 append-only)

type EditOperation =
  // ...Phase 1 + 2 + 3 variants...

  // Phase 4 — signatures:
  | { kind: 'signature-visual-place';
      meta: EditMeta;
      placement: SignaturePlacement;
      appearance: VisualAppearanceSpec;
      placeholderFieldName: string | null; // non-null when filling a Phase-3 /Sig field
    }
  | { kind: 'signature-pades-applied';
      meta: EditMeta;
      placement: SignaturePlacement;
      certFingerprint: string;             // SHA-256 hex; not the cert itself
      signerSubjectCN: string;
      signerIssuerCN: string;
      signedAt: number;
      tsaUrl: string | null;
      auditLogRowId: number;               // FK to signature_audit_log.id
      placeholderFieldName: string | null;
    }

  // Phase 4 — annotation shapes (NEW variants, not extensions of annot-add/edit/delete):
  | { kind: 'annot-add-shape';
      meta: EditMeta;
      annotation: ShapeAnnotationModel;
    }
  | { kind: 'annot-edit-shape';
      meta: EditMeta;
      id: string;
      before: Partial<ShapeAnnotationModel>;
      after: Partial<ShapeAnnotationModel>;
    }
  | { kind: 'annot-delete-shape';
      meta: EditMeta;
      before: ShapeAnnotationModel;
    };
```

#### 9.3.1 Inverse table (extends §3.2 + §7.1.3 + §8.3)

| Forward | Inverse |
|---|---|
| `signature-visual-place { placement, appearance, placeholderFieldName }` | `signature-visual-remove { placement, placeholderFieldName, before: { appearance } }` (NEW companion variant; documented in §9.3.2) |
| `signature-pades-applied { placement, certFingerprint, signerSubjectCN, signedAt, auditLogRowId, ... }` | `signature-pades-removed { placement, auditLogRowId, before: { certFingerprint, signerSubjectCN, signedAt } }` (NEW companion; deletes the audit row) |
| `annot-add-shape { annotation }` | `annot-delete-shape { before: annotation }` |
| `annot-edit-shape { id, before, after }` | `annot-edit-shape { id, before: after, after: before }` |
| `annot-delete-shape { before }` | `annot-add-shape { annotation: before }` |

#### 9.3.2 Companion variants

For symmetry with §7.1.3's image-overlay-delete pattern, Phase 4 adds inverse-only companions:

```ts
type EditOperation =
  // ...
  | { kind: 'signature-visual-remove';
      meta: EditMeta;
      placement: SignaturePlacement;
      placeholderFieldName: string | null;
      before: { appearance: VisualAppearanceSpec };
    }
  | { kind: 'signature-pades-removed';
      meta: EditMeta;
      placement: SignaturePlacement;
      placeholderFieldName: string | null;
      auditLogRowId: number;
      before: {
        certFingerprint: string;
        signerSubjectCN: string;
        signedAt: number;
        tsaUrl: string | null;
      };
    };
```

These are emitted ONLY as undo inverses; the renderer doesn't create them via UI. The replay engine's step 3.7 handles them by removing the widget + clearing /V from the field dict + (for PAdES) deleting the audit row.

### 9.4 SQLite schema v4 — `signature_audit_log` table

```sql
-- ============================================================
-- migrations/0004_phase4_signatures.sql (Phase 4, Ravi Wave 16)
-- Forward-only. Adds signature_audit_log table for local "what have I signed?" log.
-- ============================================================

CREATE TABLE signature_audit_log (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  /** SHA-256 of the SIGNED bytes (post-signing). */
  doc_hash                 TEXT NOT NULL,
  /** SHA-256 of the bytes the engine actually signed (the byte-range hash input). */
  pre_sign_doc_hash        TEXT NOT NULL,
  signed_at                INTEGER NOT NULL,         -- ms epoch
  signature_kind           TEXT NOT NULL CHECK (signature_kind IN ('visual', 'pades', 'pades-tsa')),
  signed_by_fingerprint    TEXT,                     -- SHA-256 hex of the cert; NULL for visual
  signed_by_subject_cn     TEXT,                     -- subject CN for display; NULL for visual
  signed_by_issuer_cn      TEXT,                     -- issuer CN for display; NULL for visual
  cert_not_before          INTEGER,                  -- ms epoch
  cert_not_after           INTEGER,                  -- ms epoch
  tsa_url                  TEXT,                     -- TSA URL at sign time; NULL if no TSA
  tsa_response_status      TEXT CHECK (tsa_response_status IN ('ok', 'failed')),
  sig_bytes_offset         INTEGER,                  -- byte offset of /Contents in signed bytes; NULL for visual
  sig_bytes_length         INTEGER,                  -- byte length of /Contents
  byte_range_json          TEXT,                     -- JSON-encoded [a, b, c, d]
  reason                   TEXT,                     -- user-supplied
  location                 TEXT,                     -- user-supplied
  field_name               TEXT,                     -- placeholder field name OR NULL for freeform
  created_at               INTEGER NOT NULL,
  UNIQUE (doc_hash, sig_bytes_offset)                -- one row per signature in a signed document
);

CREATE INDEX idx_signature_audit_log_doc_hash ON signature_audit_log(doc_hash);
CREATE INDEX idx_signature_audit_log_pre_sign_doc_hash ON signature_audit_log(pre_sign_doc_hash);
CREATE INDEX idx_signature_audit_log_signed_at ON signature_audit_log(signed_at DESC);
CREATE INDEX idx_signature_audit_log_fingerprint ON signature_audit_log(signed_by_fingerprint);

INSERT INTO schema_migrations (version, applied_at) VALUES (4, strftime('%s', 'now') * 1000);
```

#### 9.4.1 Migration behavior

- Idempotent at the runner level — Ravi's `migrate.ts` skips applied versions per `data-models.md §2.2`.
- Forward-only. No rollback.
- Clean migration from schema v3 — no existing tables touched. v3-installed users get v4 on first launch of the Phase 4 build.
- The `UNIQUE (doc_hash, sig_bytes_offset)` constraint covers two scenarios:
  - **Same doc signed twice** at the same field (re-sign workflow Phase 4.5+) → second insert violates uniqueness; engine surfaces an error
  - **Visual signature** has `sig_bytes_offset = NULL` and NULL doesn't conflict with NULL in SQLite UNIQUE semantics — so multiple visual signatures on the same doc are fine

#### 9.4.2 Why these fields

- `doc_hash` lets the audit panel filter to "signatures on the file currently open" — by computing sha256 of the current open bytes
- `pre_sign_doc_hash` lets the verify flow recompute the hash over the byte-range of the SIGNED bytes; both should match if the signed bytes are intact
- `sig_bytes_offset` + `sig_bytes_length` + `byte_range_json` let `signatures:verify` locate the CMS in the bytes and re-validate without re-parsing the whole document
- `cert_not_before` + `cert_not_after` let the audit panel render "signed with a cert that was/is valid 2024-2030" without re-loading the cert
- `tsa_url` + `tsa_response_status` document whether timestamping happened
- `reason` + `location` are PDF spec optional sig dict fields

#### 9.4.3 Tamper-vulnerability disclosure

The audit log lives in the same SQLite file as recents/bookmarks/templates. **Any process with write access can forge rows.** This is documented in user-guide §Signing (Wave 18 Nathan) and in `architecture-phase-4.md §10.2`. Phase 4 makes NO claim that the audit log is tamper-evident — it is a local log for the user's own reference, not a notarization service.

### 9.5 Row + DTO shapes

```ts
// src/db/types.ts (Ravi Wave 16 edit)

interface SignatureAuditRow {
  id: number;
  doc_hash: string;
  pre_sign_doc_hash: string;
  signed_at: number;
  signature_kind: 'visual' | 'pades' | 'pades-tsa';
  signed_by_fingerprint: string | null;
  signed_by_subject_cn: string | null;
  signed_by_issuer_cn: string | null;
  cert_not_before: number | null;
  cert_not_after: number | null;
  tsa_url: string | null;
  tsa_response_status: 'ok' | 'failed' | null;
  sig_bytes_offset: number | null;
  sig_bytes_length: number | null;
  byte_range_json: string | null;
  reason: string | null;
  location: string | null;
  field_name: string | null;
  created_at: number;
}

// IPC contract camelCase (data-models.md §3.1 convention):
interface SignatureAuditRowDto {
  id: number;
  docHash: string;
  preSignDocHash: string;
  signedAt: number;
  signatureKind: 'visual' | 'pades' | 'pades-tsa';
  signedByFingerprint: string | null;
  signedBySubjectCN: string | null;
  signedByIssuerCN: string | null;
  certNotBefore: number | null;
  certNotAfter: number | null;
  tsaUrl: string | null;
  tsaResponseStatus: 'ok' | 'failed' | null;
  sigBytesOffset: number | null;
  sigBytesLength: number | null;
  byteRange: number[] | null;            // PARSED from byte_range_json
  reason: string | null;
  location: string | null;
  fieldName: string | null;
  createdAt: number;
}
```

`db-bridge.ts` (David's adapter) translates `SignatureAuditRow` ↔ `SignatureAuditRowDto`, parsing/serializing `byte_range_json` at the IPC boundary.

### 9.6 Repository interface

```ts
// src/db/repositories/signature-audit-repo.ts (Ravi Wave 16)

interface SignatureAuditRepo {
  insert(row: Omit<SignatureAuditRow, 'id' | 'created_at'> & { created_at?: number }): number;
  get(id: number): SignatureAuditRow | null;
  listByDocHash(docHash: string, limit?: number, offset?: number): SignatureAuditRow[];
  listByPreSignDocHash(preSignDocHash: string, limit?: number, offset?: number): SignatureAuditRow[];
  listByFingerprint(fingerprint: string, since?: number, until?: number, limit?: number, offset?: number): SignatureAuditRow[];
  listAll(filters: {
    fileHash?: string;
    signedByFingerprint?: string;
    since?: number;
    until?: number;
  }, limit?: number, offset?: number): { items: SignatureAuditRow[]; total: number };
  delete(id: number): boolean;
}
```

`delete(id)` is used by the undo-PAdES flow — when the user undoes a PAdES sign, the audit row is removed alongside the signature widget.

### 9.7 ShapeAnnotationModel

```ts
// extends data-models.md §3.1 — Phase 4 append-only

type ShapeAnnotationSubtype =
  | 'Square'         // rectangle
  | 'Circle'         // ellipse
  | 'Polygon'        // closed polygon
  | 'PolyLine'       // open polyline
  | 'Line'           // straight line (used for arrow + line-measure)
  | 'FreeTextCallout'; // /FreeText with /IT FreeTextCallout

interface ShapeAnnotationModel {
  id: string;                              // UUID v4
  pageIndex: number;
  subtype: ShapeAnnotationSubtype;
  rect: PdfRect;                           // bounding box; used for hit-testing
  color: RgbColor;                         // stroke color
  opacity: number;                         // 0..1
  borderWidth: number;                     // pt; 0.25..10
  borderStyle: 'solid' | 'dashed' | 'dotted';
  fillColor?: RgbColor;                    // for Square/Circle/Polygon when fillEnabled
  fillEnabled?: boolean;
  // Subtype-specific (only one of these blocks is populated per row):
  vertices?: number[];                     // [x1, y1, x2, y2, ...] for Polygon/PolyLine
  lineStart?: { x: number; y: number };    // Line / arrow start
  lineEnd?: { x: number; y: number };      // Line / arrow end
  lineStartStyle?: 'None' | 'Butt' | 'OpenArrow' | 'ClosedArrow';
  lineEndStyle?: 'None' | 'Butt' | 'OpenArrow' | 'ClosedArrow';
  calloutText?: string;                    // FreeTextCallout body
  calloutPointer?: { x: number; y: number }; // /CL array tip
  fontSize?: number;                       // FreeTextCallout
  fontFamily?: string;                     // FreeTextCallout
  measure?: {                              // Line / PolyLine when used as measure tool
    unit: 'inch' | 'cm' | 'mm' | 'pt' | 'px' | 'custom';
    customUnitLabel?: string;
    scale: number;
  };
  author?: string;
  contents?: string;                       // /Contents popup text
  createdAt: number;
  modifiedAt: number;
  pdfObjectNumber?: number;                // assigned after save
  dirty: boolean;
  preservedDict?: Record<string, unknown>; // for round-trip of unknown fields
}
```

The Phase-1 `AnnotationModel` is unchanged; the new `ShapeAnnotationModel` is a parallel type. Selectors in `annotations-slice.ts` can union over both via a TS discriminated union; renderer components branch on the subtype.

### 9.8 MeasureCalibration

```ts
interface MeasureCalibration {
  /** 1 PDF user-space unit = N <unit> in the real-world drawing. */
  unit: 'inch' | 'cm' | 'mm' | 'pt' | 'px' | 'custom';
  customUnitLabel?: string;
  scale: number;
}
```

Stored in main memory keyed by `DocumentHandle` for the document's open session. Persisted into the PDF on save by writing a `/Measure` dict onto the first measure annotation OR the page's measure dict, per ISO 32000 §12.7.4.

### 9.9 New `SettingKey`s

```ts
// extends §2.3 Settings key registry

| Key | Value JSON type | Default | Set by |
|---|---|---|---|
| `signatures.tsaUrl` | string | `""` | User (Settings dialog → Signing) |
| `signatures.tsaEnabled` | boolean | `false` | User (Settings dialog → Signing) |
| `signatures.tsaTimeoutMs` | number | `30000` | User (Settings dialog → Signing) |
| `signatures.placeholderSize` | number | `16384` | User (Settings dialog → Signing → Advanced) |
| `signatures.defaultShowDate` | boolean | `true` | User (Settings dialog → Signing) |
| `signatures.defaultShowSubjectCN` | boolean | `true` | User (Settings dialog → Signing) |
| `signatures.padesEngine` | `"signpdf"|"manual"` | `"signpdf"` | User (Settings dialog → Signing → Advanced; Phase 4.1) |
| `annotations.defaultBorderWidth` | number | `1` | User (Settings dialog → Annotations) |
| `annotations.defaultBorderStyle` | `"solid"|"dashed"|"dotted"` | `"solid"` | User (Settings dialog → Annotations) |
| `annotations.defaultFillEnabled` | boolean | `false` | User (Settings dialog → Annotations) |
| `annotations.defaultLineEndStyle` | `"None"|"OpenArrow"|"ClosedArrow"` | `"OpenArrow"` | User (Settings dialog → Annotations) |
```

`signatures.tsaEnabled` is FALSE by default (P4-L-2). Even if the user pastes a URL, signing without checking the enable checkbox skips the TSA hop.

`signatures.padesEngine` ships in Phase 4 with only `'signpdf'` exposed in the UI; the `'manual'` value is selectable by Phase 4.1 OR by power-users editing the SQLite settings table directly. The runtime engine selection respects the value; the Settings UI may show the option as "Advanced — for users hitting a node-signpdf bug" in Phase 4.1.

### 9.10 ShapeAnnotation validation rules (zod schema spec)

For David's zod schemas in the `annotations:addShape` handler:

| Field | Rule |
|---|---|
| `id` | string, UUID v4 |
| `pageIndex` | integer, ≥ 0, < pageCount |
| `subtype` | one of the 6 ShapeAnnotationSubtype literals |
| `rect` | bounded by page bounds; w/h > 0 |
| `color` | RgbColor with all components 0..1 |
| `opacity` | 0..1 |
| `borderWidth` | 0.25..10 pt |
| `borderStyle` | one of three literals |
| `fillColor` | required if `fillEnabled === true` |
| `vertices` | required if subtype is Polygon or PolyLine; even-length array; ≥ 3 points for Polygon; ≥ 2 for PolyLine |
| `lineStart`/`lineEnd` | required if subtype is Line |
| `calloutText` | required if subtype is FreeTextCallout; 0..2000 chars |
| `calloutPointer` | required if subtype is FreeTextCallout |
| `measure` | optional; required when used as line-measure / polyline-measure tool; scale > 0 |

### 9.11 Phase 4 open questions

None new — all Phase 4 design questions from `wave-15-brief.md §"Specific design questions"` have been answered in `architecture-phase-4.md`, `signature-engine.md`, this amendment, the api-contracts §14 amendment, the ui-spec §13 amendment, and the conventions §15 amendment. Cross-reference:

| Wave-15-brief question | Answer location |
|---|---|
| A. PAdES library selection | architecture-phase-4.md §4.3; signature-engine.md §3 — node-signpdf primary + manual fallback |
| B. Cert/password lifecycle | architecture-phase-4.md §4.2 + R-W15-A; signature-engine.md §4; conventions.md §15 |
| C. TSA URL trust model | architecture-phase-4.md §4.5; signature-engine.md §6.4 — default OFF, user URL, validate-by-attempt |
| D. Signature appearance stream design | architecture-phase-4.md §4.4; signature-engine.md §5 — deterministic layout + drop priority |
| E. Visual vs PAdES UI distinction | ui-spec.md §13.4 — two clearly-labeled buttons in capture modal |
| F. Verification UX | architecture-phase-4.md §4.5 + §8 — `signatures:verify` for own signatures only; Phase 4.1 for third-party |
| G. Annotation toolset expansion | architecture-phase-4.md §5; ui-spec.md §13.5 — 7 tools enumerated; scope-fenced |
| H. Signature placement overlay | ui-spec.md §13.4.3 — SHARED with image-overlay component per the question H decision |

End of Phase-4 data-models amendment.

---

## 10. Phase 5 additions (2026-05-27, Riley)

> ### Phase 5 amendment (2026-05-27)
>
> §1-§9 above remain FROZEN at Wave 15. Additions below are append-only. Per the Phase-5 freeze rule (`docs/architecture-phase-5.md §14`), Phase-1 + Phase-2 + Phase-3 + Phase-4 sections do not change. One ALTER TABLE on the Phase-4 `signature_audit_log` is in scope per §10.4 — additive nullable column only.

This section adds:
- `LanguagePack`, `LanguagePackCatalogEntry`, `OcrLanguagePackSource` types
- `PreprocessOptions`, `OcrWord`, `OcrPageResult`, `OcrJobSummary` types
- One new `EditOperation` variant (`ocr-text-behind-applied`) + its inverse companion (`ocr-text-behind-removed`)
- Schema v5 DDL (`ocr_jobs`, `ocr_results`, `language_packs` tables + additive column on `signature_audit_log`)
- `OcrJobRow` + `OcrResultRow` + `LanguagePackRow` + DTO shapes
- Repository interfaces (`OcrJobsRepo`, `OcrResultsRepo`, `LanguagePacksRepo`)
- Eleven new `SettingKey`s
- Validation rules

### 10.1 Language pack types

```ts
// extends data-models.md §3.1 — Phase 5 append-only

type OcrLanguagePackSource = 'bundled' | 'downloaded';

interface LanguagePack {
  lang: string;                            // ISO 639-2/3 letter; tesseract.js compatible
  displayName: string;                     // for UI
  source: OcrLanguagePackSource;
  filePath: string;                        // absolute path (main only); NEVER echoed to renderer
  sizeBytes: number;
  sha256: string;                          // hex
  installedAt: number;                     // ms epoch
  lastUsedAt: number | null;
}

interface LanguagePackCatalogEntry {
  lang: string;
  displayName: string;
  sizeBytes: number;
  sha256: string;
  // Catalog entries do NOT carry filePath — they're not installed yet.
}

// Renderer-facing DTO — file path omitted (§16 contract: bytes-stay-in-main pattern):
interface LanguagePackDto {
  lang: string;
  displayName: string;
  source: OcrLanguagePackSource;
  sizeBytes: number;
  sha256: string;
  installedAt: number;
  lastUsedAt: number | null;
}
```

**Boundary:** `LanguagePack.filePath` is main-only. The renderer-facing `LanguagePackDto` strips it. Cross-process discipline mirrors conventions §10 (renderer never holds doc bytes / doc paths).

### 10.2 OCR preprocessing options

```ts
interface PreprocessOptions {
  deskew: boolean;
  denoise: boolean;
  contrastBoost: boolean;
}
```

No optional fields. Renderer must send all three (defaults applied at the modal layer from `ocr.preprocess.*` settings).

### 10.3 EditOperation extensions

```ts
// extends data-models.md §3.1 + §7.1 + §8.2 + §9.3 EditOperation union (Phase 5 append-only)

type EditOperation =
  // ...Phase 1 + 2 + 3 + 4 variants...

  // Phase 5 — OCR text-behind-image:
  | { kind: 'ocr-text-behind-applied';
      meta: EditMeta;
      jobId: number;                       // FK to ocr_jobs.id
      pageRange: { start: number; end: number };
      langs: string[];
      meanConfidence: number;
      totalWordsRecognized: number;
      invalidatesSignatures: boolean;      // true if PAdES widgets were present pre-OCR (user confirmed at modal time)
    }
  // Inverse companion (undo only):
  | { kind: 'ocr-text-behind-removed';
      meta: EditMeta;
      before: {
        jobId: number;
        pageRange: { start: number; end: number };
        langs: string[];
        meanConfidence: number;
        totalWordsRecognized: number;
      };
    };
```

#### 10.3.1 Inverse table (extends §3.2 + §7.1.3 + §8.3 + §9.3.1)

| Forward | Inverse |
|---|---|
| `ocr-text-behind-applied { jobId, pageRange, langs, ... }` | `ocr-text-behind-removed { before: { jobId, pageRange, langs, ... } }` |
| `ocr-text-behind-removed { before }` | `ocr-text-behind-applied { jobId: before.jobId, ..., invalidatesSignatures: false }` (Note: re-applying does NOT re-prompt — the signatures were already invalidated by the first run; the audit log already records it.) |

#### 10.3.2 Phase 4 PAdES interaction note

When `ocr-text-behind-applied.invalidatesSignatures === true`, the replay engine MUST also update `signature_audit_log.invalidated_by_ocr_job_id` for matching rows (per `architecture-phase-5.md §6`). Replay engine guidance is in `ocr-engine.md §8.4`.

### 10.4 SQLite schema v5 — `ocr_jobs`, `ocr_results`, `language_packs` + additive column

```sql
-- ============================================================
-- migrations/0005_phase5_ocr.sql (Phase 5, Ravi Wave 20)
-- Forward-only. Adds three tables + one additive column on signature_audit_log.
-- ============================================================

CREATE TABLE ocr_jobs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  /** SHA-256 of the doc bytes when the job started. */
  doc_hash                 TEXT NOT NULL,
  page_range_start         INTEGER NOT NULL,
  page_range_end           INTEGER NOT NULL,
  /** '+'-joined Tesseract lang codes, e.g. 'eng+spa'. Normalized lowercase. */
  langs                    TEXT NOT NULL,
  /** JSON-encoded PreprocessOptions. */
  preprocess_json          TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN
                            ('queued', 'running', 'completed', 'cancelled', 'failed', 'superseded_by_undo')),
  started_at               INTEGER NOT NULL,
  completed_at             INTEGER,                  -- NULL until terminal
  mean_confidence          REAL,                     -- NULL until completed
  total_words              INTEGER,                  -- NULL until completed
  /** Non-NULL only on status='failed'. */
  error_message            TEXT,
  /** 0 or 1; true if PAdES widget was present pre-run. */
  invalidated_signatures   INTEGER NOT NULL DEFAULT 0 CHECK (invalidated_signatures IN (0, 1)),
  created_at               INTEGER NOT NULL
);

CREATE INDEX idx_ocr_jobs_doc_hash      ON ocr_jobs(doc_hash);
CREATE INDEX idx_ocr_jobs_status        ON ocr_jobs(status);
CREATE INDEX idx_ocr_jobs_started_at    ON ocr_jobs(started_at DESC);

CREATE TABLE ocr_results (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id                   INTEGER NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  page_index               INTEGER NOT NULL,
  total_words              INTEGER NOT NULL,
  low_confidence_words     INTEGER NOT NULL,
  mean_confidence          REAL    NOT NULL,
  /** Word-level data as JSON: [{ text, confidence, imgRect: {x0,y0,x1,y1}, pdfRect: {x,y,width,height} | null }]. */
  words_json               TEXT    NOT NULL,
  /** Image dimensions used for OCR (px). */
  img_width_px             INTEGER NOT NULL,
  img_height_px            INTEGER NOT NULL,
  duration_ms              INTEGER NOT NULL,
  created_at               INTEGER NOT NULL,
  UNIQUE (job_id, page_index)
);

CREATE INDEX idx_ocr_results_job_id  ON ocr_results(job_id);

CREATE TABLE language_packs (
  lang                     TEXT PRIMARY KEY,
  source                   TEXT NOT NULL CHECK (source IN ('bundled', 'downloaded')),
  /** Absolute path on disk. NEVER echoed to renderer. */
  file_path                TEXT NOT NULL,
  size_bytes               INTEGER NOT NULL,
  sha256                   TEXT NOT NULL,
  installed_at             INTEGER NOT NULL,
  last_used_at             INTEGER                    -- NULL if never used
);

CREATE INDEX idx_language_packs_source ON language_packs(source);

-- Additive amendment to Phase-4 signature_audit_log:
-- Nullable column links a signature row to the OCR job that invalidated it.
-- Pre-Phase-5 rows have NULL = "not invalidated by OCR".
ALTER TABLE signature_audit_log ADD COLUMN invalidated_by_ocr_job_id INTEGER
  REFERENCES ocr_jobs(id);

CREATE INDEX idx_signature_audit_log_invalidated_by_ocr_job_id
  ON signature_audit_log(invalidated_by_ocr_job_id);

INSERT INTO schema_migrations (version, applied_at) VALUES (5, strftime('%s', 'now') * 1000);
```

#### 10.4.1 Migration behavior

- Idempotent at the runner level — Ravi's `migrate.ts` skips applied versions per `data-models.md §2.2`.
- Forward-only. No rollback.
- Clean migration from schema v4: three new tables + one additive nullable column on `signature_audit_log`. NO existing data touched.
- Pre-Phase-5 `signature_audit_log` rows have `invalidated_by_ocr_job_id IS NULL`, which the engine treats as "not invalidated by OCR".

#### 10.4.2 Why these fields

- `doc_hash` — lets the OCR audit panel filter to "OCR jobs on the file currently open"
- `langs` — `+`-joined preserves multi-language run history (e.g. `eng+spa` runs are distinct from `eng` runs)
- `preprocess_json` — JSON-encoded so we can extend the preprocess option set without schema migration
- `words_json` (in `ocr_results`) — single-table JSON blob, parsed on demand. Avoids a 5th table with 1000s of word rows per page. Tradeoff: not directly queryable in SQL; query via the application layer.
- `invalidated_signatures` flag on `ocr_jobs` (boolean) — fast lookup for the "this job invalidated a signature" UI
- `invalidated_by_ocr_job_id` on `signature_audit_log` — back-reference; the signature audit panel shows which OCR job invalidated each signature

#### 10.4.3 Tamper-vulnerability disclosure

Same disclosure as Phase 4 `signature_audit_log` (§9.4.3): the OCR audit tables live in the same SQLite file as recents/bookmarks/templates/signature_audit_log. **Any process with write access can forge rows.** Phase 5 makes NO claim that the OCR audit is tamper-evident — it is a local log for the user's own reference. Documented in user-guide §OCR (Wave 22 Nathan) and in `architecture-phase-5.md §11.2`.

### 10.5 Row + DTO shapes — `ocr_jobs`

```ts
// src/db/types.ts (Ravi Wave 20 edit)

type OcrJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'superseded_by_undo';

interface OcrJobRow {
  id: number;
  doc_hash: string;
  page_range_start: number;
  page_range_end: number;
  langs: string;                                  // '+'-joined
  preprocess_json: string;
  status: OcrJobStatus;
  started_at: number;
  completed_at: number | null;
  mean_confidence: number | null;
  total_words: number | null;
  error_message: string | null;
  invalidated_signatures: 0 | 1;
  created_at: number;
}

// IPC contract camelCase:
interface OcrJobRowDto {
  id: number;
  docHash: string;
  pageRange: { start: number; end: number };
  langs: string[];                                // parsed from '+'-joined string
  preprocess: PreprocessOptions;                  // parsed from preprocess_json
  status: OcrJobStatus;
  startedAt: number;
  completedAt: number | null;
  meanConfidence: number | null;
  totalWords: number | null;
  errorMessage: string | null;
  invalidatedSignatures: boolean;                 // 0/1 → bool
  createdAt: number;
}
```

### 10.6 Row + DTO shapes — `ocr_results` + `OcrPageResult` + `OcrWord`

```ts
interface OcrResultRow {
  id: number;
  job_id: number;
  page_index: number;
  total_words: number;
  low_confidence_words: number;
  mean_confidence: number;
  words_json: string;
  img_width_px: number;
  img_height_px: number;
  duration_ms: number;
  created_at: number;
}

interface OcrWord {
  text: string;
  confidence: number;                             // 0-100 (Tesseract scale)
  imgRect: { x0: number; y0: number; x1: number; y1: number };
  /** PDF user-space rect. NULLABLE — late-init; set by searchable-pdf-builder. */
  pdfRect: PdfRect | null;
}

interface OcrPageResult {
  pageIndex: number;
  imgDimsPx: { widthPx: number; heightPx: number };
  totalWords: number;
  lowConfidenceWords: number;
  meanConfidence: number;
  words: OcrWord[];
  durationMs: number;
}

// IPC DTO — camelCase mirror of the row + parsed words_json:
interface OcrResultRowDto {
  id: number;
  jobId: number;
  pageIndex: number;
  totalWords: number;
  lowConfidenceWords: number;
  meanConfidence: number;
  words: OcrWord[];                               // parsed from words_json
  imgDimsPx: { widthPx: number; heightPx: number };
  durationMs: number;
  createdAt: number;
}
```

**Nullable-late-init discipline:** `OcrWord.pdfRect` is `null` until the searchable-pdf-builder transforms the image-space rect to PDF user-space. Per the Phase 4.1.1 sentinel-default lesson, consumers MUST handle `pdfRect === null` as the "not yet composed" state, NOT as `{ x: 0, y: 0, width: 0, height: 0 }`.

### 10.7 OCR job summary (IPC return shape)

```ts
interface OcrJobSummary {
  jobId: number;
  pageRange: { start: number; end: number };
  langs: string[];
  status: 'completed' | 'cancelled' | 'failed';
  totalWords: number;
  meanConfidence: number;
  totalDurationMs: number;
  /** NULLABLE — late-init. Populated when status='completed' or 'cancelled' (partial); null on 'failed' before any page completed. */
  pageResults: OcrPageResult[] | null;
  error?: string;
}
```

### 10.8 Row + DTO shapes — `language_packs`

```ts
interface LanguagePackRow {
  lang: string;
  source: OcrLanguagePackSource;
  file_path: string;                              // main-only
  size_bytes: number;
  sha256: string;
  installed_at: number;
  last_used_at: number | null;
}

// Renderer-facing — file_path omitted (boundary discipline per §10.1):
interface LanguagePackDto {
  lang: string;
  displayName: string;                            // resolved from catalog at the bridge
  source: OcrLanguagePackSource;
  sizeBytes: number;
  sha256: string;
  installedAt: number;
  lastUsedAt: number | null;
}
```

`db-bridge.ts` (David's adapter) translates `LanguagePackRow` ↔ `LanguagePackDto`, dropping `file_path` AND attaching the display name from the catalog file.

### 10.9 Repository interface

```ts
// src/db/repositories/ocr-jobs-repo.ts (Ravi Wave 20)

interface OcrJobsRepo {
  insert(row: Omit<OcrJobRow, 'id' | 'created_at'> & { created_at?: number }): number;
  get(id: number): OcrJobRow | null;
  updateStatus(
    id: number,
    status: OcrJobStatus,
    completedAt?: number,
    meanConfidence?: number,
    totalWords?: number,
    errorMessage?: string,
  ): boolean;
  listByDocHash(docHash: string, limit?: number, offset?: number): OcrJobRow[];
  listByStatus(status: OcrJobStatus, limit?: number, offset?: number): OcrJobRow[];
  listAll(filters: {
    docHash?: string;
    status?: OcrJobStatus;
    since?: number;
    until?: number;
  }, limit?: number, offset?: number): OcrJobRow[];
  countAll(filters: { docHash?: string; status?: OcrJobStatus; since?: number; until?: number }): number;
  delete(id: number): boolean;
}

// src/db/repositories/ocr-results-repo.ts (Ravi Wave 20)

interface OcrResultsRepo {
  insert(row: Omit<OcrResultRow, 'id' | 'created_at'> & { created_at?: number }): number;
  listByJobId(jobId: number): OcrResultRow[];
  getByJobAndPage(jobId: number, pageIndex: number): OcrResultRow | null;
  deleteByJobId(jobId: number): number;          // returns rows deleted; cascade also fires on DELETE FROM ocr_jobs
}

// src/db/repositories/language-packs-repo.ts (Ravi Wave 20)

interface LanguagePacksRepo {
  upsert(pack: LanguagePackRow): void;
  list(): LanguagePackRow[];
  get(lang: string): LanguagePackRow | null;
  remove(lang: string): boolean;                  // refuses to remove source='bundled' — caller surfaces error
  touchLastUsed(lang: string, when: number): void;
}

// src/db/repositories/signature-audit-repo.ts (Ravi Wave 16; Phase 5 amends — see §10.10)
interface SignatureAuditRepo {
  // ...existing Phase 4 methods unchanged...
  // Phase 5 addition:
  markInvalidatedByOcrJob(rowIds: number[], ocrJobId: number): number;  // returns rows updated
  listInvalidatedByOcrJob(ocrJobId: number): SignatureAuditRow[];
}
```

### 10.10 Phase 4 `signature_audit_log` amendment — additive column

The Phase-4 `signature_audit_log` schema (data-models.md §9.4) is amended ADDITIVELY:

```sql
ALTER TABLE signature_audit_log
  ADD COLUMN invalidated_by_ocr_job_id INTEGER REFERENCES ocr_jobs(id);
```

The `SignatureAuditRow` type gains one nullable field:

```ts
interface SignatureAuditRow {
  // ...existing Phase-4 fields unchanged...
  invalidated_by_ocr_job_id: number | null;
}

interface SignatureAuditRowDto {
  // ...existing Phase-4 fields unchanged...
  invalidatedByOcrJobId: number | null;
}
```

This is the ONLY Phase-4 surface change permitted by the Phase-5 freeze — it is purely additive (nullable column, nullable field, two new repo methods) and serves the cross-feature invariant from `architecture-phase-5.md §6`. The Phase 4 contract `signatures:listAudit` returns rows with the new field populated (`null` for pre-Phase-5 rows).

### 10.11 New `SettingKey`s

Eleven new keys (full list mirrored in api-contracts.md §16.11):

| Key | Type | Default | Notes |
|---|---|---|---|
| `ocr.defaultLang` | string | `'eng'` | Initial lang in OCR modal |
| `ocr.lowConfidenceThreshold` | number | `60` | Applied at render time, not recognition |
| `ocr.rasterDpi` | number | `300` | Page rasterization DPI |
| `ocr.maxConcurrentLanguages` | number | `4` | Worker pool size cap |
| `ocr.workerWatchdogSec` | number | `60` | Per-page hang timeout |
| `ocr.preprocess.deskew` | boolean | `true` | Default modal toggle |
| `ocr.preprocess.denoise` | boolean | `false` | Default modal toggle |
| `ocr.preprocess.contrastBoost` | boolean | `false` | Default modal toggle |
| `ocr.denoise.kernel` | number | `3` | Denoise filter kernel |
| `ocr.showConfidenceOverlayByDefault` | boolean | `false` | Overlay visibility on doc open |
| `ocr.confirmInvalidateSignaturesOnce` | boolean | `false` | "Don't ask me again" for §6 prompt |

### 10.12 Validation rules

| Field | Rule |
|---|---|
| `lang` (catalog code) | `/^[a-z]{3}(_[a-z]+)?$/i` AND must be in catalog |
| `pageRange.start` | `>= 0` |
| `pageRange.end` | `>= start` AND `< doc.pageCount` |
| `PreprocessOptions` | All three booleans required |
| `confidence` (OcrWord) | 0..100, inclusive |
| `OcrPageResult.words` | sorted by reading order (top-to-bottom, left-to-right within line) |
| `OcrJobSummary.pageResults` | `null` until terminal status |
| `LanguagePack.lang` | matches the same regex as catalog code |
| `LanguagePack.sha256` | 64-hex-char string |
| `signature_audit_log.invalidated_by_ocr_job_id` | nullable; FK on `ocr_jobs.id` |

### 10.13 Phase 5 open questions

None new — all Phase 5 design questions from `wave-19-brief.md §"Specific design questions"` have been answered in `architecture-phase-5.md`, `ocr-engine.md`, this amendment, the api-contracts §16 amendment, the ui-spec §14 amendment, and the conventions §16 amendment. Cross-reference:

| Wave-19-brief question | Answer location |
|---|---|
| Q-A. tesseract.js vs native binding | architecture-phase-5.md §3.1; ocr-engine.md §2 — tesseract.js primary + Phase 5.1 system-Tesseract escape hatch |
| Q-B. Language pack delivery | architecture-phase-5.md §4.3 + §3.3; ocr-engine.md §4 — bundle `eng` + lazy-download upstream + SHA-256 + offline-after-first-use |
| Q-C. OCR job scheduling | architecture-phase-5.md §4.6; ocr-engine.md §7.4 — modal-driven blocking v1; background queue Phase 5.2 |
| Q-D. Text-behind-image format | architecture-phase-5.md §4.4; ocr-engine.md §5 — render-mode-3 BT/ET, NOT ActualText |
| Q-E. Native scanner go/no-go | architecture-phase-5.md §7 — DEFER to Phase 5.1 (no MIT-compatible binding survives the maturity bar) |
| Plus: P5-L-10 PAdES interaction | architecture-phase-5.md §6; ocr-engine.md §8 — pre-flight confirm + audit-log update + replay guard |

End of Phase-5 data-models amendment.

---

## 11. Phase 6 additions (2026-05-27, Riley)

> ### Phase 6 amendment (2026-05-27, Riley)
>
> §1-§10 above remain authoritative for Phase 1-5 data. Phase 6 introduces ONE new SQLite table (`export_jobs`) for tracking in-progress + historical export operations and folds per-format defaults into the existing `settings` key-value store. NO existing Phase 1-5 table is touched. NO new column on any prior table.

### 11.1 Schema v6 migration overview

| Migration | File | Adds |
|---|---|---|
| v6 | `migrations/0006_phase6_export.sql` | `export_jobs` table + 3 indexes + setting-key seed inserts via `INSERT OR IGNORE INTO settings (key, value)` |

Forward-only. Idempotent — `migrate.ts` skips applied versions. Clean migration from schema v5 — one new table only.

### 11.2 `export_jobs` table — full DDL

```sql
CREATE TABLE export_jobs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_hash                 TEXT NOT NULL,
  format                   TEXT NOT NULL CHECK (format IN ('docx', 'xlsx', 'pptx', 'png', 'jpeg', 'tiff')),
  quality_tier             TEXT NOT NULL CHECK (quality_tier IN ('text-only', 'layout-preserving', 'n/a')),
  page_range_start         INTEGER NOT NULL,
  page_range_end           INTEGER NOT NULL,
  include_annotations      INTEGER NOT NULL DEFAULT 1,     -- 0 or 1
  dpi                      INTEGER,                         -- non-null only for image formats
  jpeg_quality             REAL,                            -- non-null only for jpeg
  multi_page_tiff          INTEGER,                         -- non-null only for tiff; 0 or 1
  output_path              TEXT NOT NULL,                   -- absolute path on disk
  output_size_bytes        INTEGER,                         -- null until completed
  status                   TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
  started_at               INTEGER NOT NULL,                -- ms epoch (insert time = queued time)
  completed_at             INTEGER,                         -- null until terminal
  duration_ms              INTEGER,                         -- null until terminal; = completed_at - started_at when set
  pages_processed          INTEGER NOT NULL DEFAULT 0,
  paragraphs_extracted     INTEGER,                         -- null for image formats AND until done
  tables_detected          INTEGER,                         -- null for image formats AND until done
  images_embedded          INTEGER,                         -- null for image formats AND until done
  error_message            TEXT,                            -- non-null only on status='failed'
  created_at               INTEGER NOT NULL
);

CREATE INDEX idx_export_jobs_doc_hash ON export_jobs(doc_hash);
CREATE INDEX idx_export_jobs_status   ON export_jobs(status);
CREATE INDEX idx_export_jobs_format   ON export_jobs(format);

INSERT INTO schema_migrations (version, applied_at) VALUES (6, strftime('%s', 'now') * 1000);
```

**Per-column rationale:**

- `doc_hash` — matches the `doc_hash` semantic used by `ocr_jobs`, `bookmarks`, `signature_audit_log`. SHA-256 hex string of the source PDF bytes at export time. Allows the sidebar to filter exports by current doc.
- `format` — discriminated `CHECK` constraint matches the IPC `ExportFormat` type.
- `quality_tier` — `'n/a'` is the valid value for image formats (PNG / JPEG / TIFF do not have a quality tier); office formats are always `'text-only'` or `'layout-preserving'`.
- `include_annotations` — stored as `INTEGER` 0/1 (SQLite convention; same as `language_packs.source`).
- `dpi`, `jpeg_quality`, `multi_page_tiff` — **nullable** per the anti-sentinel discipline. Non-image rows have NULL here; image rows have non-null. Consumers pattern-match on format AND null-check the relevant column (NOT a sentinel like `-1` or `0`).
- `output_path` — absolute path. Renderer-bound DTO strips this to a basename for display (boundary discipline; see conventions §17.2).
- `output_size_bytes` — populated on `status='completed'`. NULL on `queued / running / cancelled / failed`. Anti-sentinel: no `-1` or `0` for unknown.
- `status` — five terminal+running values; `superseded_by_undo` (Phase 5 ocr_jobs convention) is NOT applicable here because export is not an edit.
- `pages_processed` — DEFAULT 0; bumped as each page completes. Used by the renderer to estimate progress when the engine's per-second progress event is throttled.
- `paragraphs_extracted` / `tables_detected` / `images_embedded` — populated at `status='completed'` for office formats; NULL for image formats. Drives the summary text in the Exports sidebar tab ("3 pages → 47 paragraphs, 2 tables, 5 images embedded").
- `error_message` — populated only when `status='failed'`. The handler captures the engine's error string (zod-shaped at the IPC boundary; truncated to 2048 chars before insert).
- `created_at` — `strftime('%s','now') * 1000` ms epoch; matches Phase 1-5 timestamp convention.

### 11.3 No new column on existing Phase 1-5 tables

Unlike Phase 5 which added `signature_audit_log.invalidated_by_ocr_job_id` (because OCR mutates content and the audit needed a backref), Phase 6 makes NO such addition because export is read-only on the source. `signature_audit_log` is untouched by Phase 6. Cross-checked against P6-L-9.

### 11.4 EditOperation union — NOT extended

**Phase 6 introduces NO new EditOperation variant.** Export does not produce an edit. The `EditOperation` discriminated union (`data-models.md §10.3` Phase-5 amendment) is FROZEN by Phase 6. The replay engine is unchanged.

Documented as a deliberate non-delta for the audit trail.

### 11.5 Renderer-facing DTO shapes

`export_jobs` row → `ExportJobRowDto`:

```ts
export interface ExportJobRowDto {
  id: number;
  docHash: string;
  format: 'docx' | 'xlsx' | 'pptx' | 'png' | 'jpeg' | 'tiff';
  qualityTier: 'text-only' | 'layout-preserving' | 'n/a';
  pageRange: { start: number; end: number };
  includeAnnotations: boolean;
  /** Image-format-specific; null for office formats */
  imageOptions: { dpi: number; jpegQuality: number | null; multiPageTiff: boolean | null } | null;
  /** Basename of output_path; absolute path is NOT exposed to renderer (boundary discipline) */
  outputBasename: string;
  outputDirHint: string;                        // last-folder-only, for "Open output folder" UX (NOT the full absolute path)
  outputSizeBytes: number | null;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  pagesProcessed: number;
  /** Office-format-specific; null for image formats AND until done */
  contentStats: { paragraphsExtracted: number; tablesDetected: number; imagesEmbedded: number } | null;
  errorMessage: string | null;
  createdAt: number;
}
```

`ExportJobSummary` (the success payload from `export:to*` channels):

```ts
export interface ExportJobSummary {
  jobId: number;
  format: ExportFormat;
  qualityTier: ExportQualityTier | 'n/a';
  pageCount: number;
  durationMs: number;
  outputBasename: string;
  outputDirHint: string;
  outputSizeBytes: number;
  contentStats: { paragraphsExtracted: number; tablesDetected: number; imagesEmbedded: number } | null;
  /** Nullable + late-init (Phase 5 lesson reaffirmed). Per-page progress is null until export starts; populated incrementally during run. */
  perPageProgress: Array<{ pageIndex: number; phase: string; completedAt: number | null }> | null;
}
```

**Anti-sentinel discipline (cross-check with 2026-05-26 lesson):** `imageOptions`, `contentStats`, `outputSizeBytes`, `completedAt`, `durationMs`, `errorMessage`, `perPageProgress` are all `T | null`. Consumers pattern-match on `null` to display the "not yet" state; they NEVER read sentinel zero / empty-string. The renderer's Exports sidebar tab renders `pagesProcessed / pageCount` for in-flight jobs and `contentStats.paragraphsExtracted` etc. only when `status === 'completed'` and `contentStats !== null`.

### 11.6 Per-format defaults — `settings` table extension (P6-L-10)

Phase 6 adds 17 new `settings` keys (no new table; folds into existing key-value store seeded by Phase 1). Migration v6 includes `INSERT OR IGNORE` for each key:

| Key | Type | Default | Purpose |
|---|---|---|---|
| `export.docx.qualityTier` | `'text-only' \| 'layout-preserving'` | `'layout-preserving'` | Default tier for docx |
| `export.docx.pageSize` | `'letter' \| 'a4' \| 'auto'` | `'auto'` | Default page size for docx output |
| `export.docx.includeAnnotations` | `boolean` | `true` | Default for docx include-annotations toggle |
| `export.xlsx.qualityTier` | `'text-only' \| 'layout-preserving'` | `'text-only'` | Default tier for xlsx (Q-D: Excel inherently tabular) |
| `export.xlsx.includeAnnotations` | `boolean` | `false` | Default false (cells are data, not visual) |
| `export.pptx.qualityTier` | `'text-only' \| 'layout-preserving'` | `'layout-preserving'` | Default tier for pptx |
| `export.pptx.includeAnnotations` | `boolean` | `true` | Default true |
| `export.image.format` | `'png' \| 'jpeg' \| 'tiff'` | `'png'` | Default image format in image-export sub-picker |
| `export.image.dpi` | `number` | `150` | Default DPI for image export |
| `export.image.jpegQuality` | `number` | `0.9` | Default JPEG quality |
| `export.image.multiPageTiff` | `boolean` | `false` | Default multi-page-TIFF bundling |
| `export.image.includeAnnotations` | `boolean` | `true` | Default for image-export include-annotations toggle |
| `export.layout.lineEpsilonPt` | `number` | `2` | Y-coordinate clustering epsilon (paragraph detection; see export-engine.md §3.4.2) |
| `export.layout.paragraphBreakRatio` | `number` | `1.5` | Line-gap / median-line-height threshold for paragraph break |
| `export.layout.headingRatio` | `number` | `1.3` | Font-size / median-body-font ratio for heading classification |
| `export.layout.columnGapPt` | `number` | `40` | Minimum X-gap for column boundary detection |
| `export.maxQueueSize` | `number` | `50` | Max queued + 1 running |

Stored as JSON-serialized strings in `settings.value` (Phase 1 convention). The renderer-side `settings-slice` (Phase 1) gains a `useExportSettings` selector pulling all 17 keys at once for the modal's per-format options panel.

### 11.7 Repository interface (Ravi Wave 24)

```ts
// src/db/repositories/export-jobs-repo.ts
export type ExportJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface ExportJobRow {
  id: number;
  doc_hash: string;
  format: 'docx' | 'xlsx' | 'pptx' | 'png' | 'jpeg' | 'tiff';
  quality_tier: 'text-only' | 'layout-preserving' | 'n/a';
  page_range_start: number;
  page_range_end: number;
  include_annotations: 0 | 1;
  dpi: number | null;
  jpeg_quality: number | null;
  multi_page_tiff: 0 | 1 | null;
  output_path: string;
  output_size_bytes: number | null;
  status: ExportJobStatus;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  pages_processed: number;
  paragraphs_extracted: number | null;
  tables_detected: number | null;
  images_embedded: number | null;
  error_message: string | null;
  created_at: number;
}

export interface ExportJobsRepo {
  insert(row: Omit<ExportJobRow, 'id' | 'created_at'> & { created_at?: number }): number;
  get(id: number): ExportJobRow | null;
  updateStatus(id: number, status: ExportJobStatus, completedAt?: number, durationMs?: number, errorMessage?: string): boolean;
  updateProgress(
    id: number,
    pagesProcessed: number,
    extras?: { paragraphsExtracted?: number; tablesDetected?: number; imagesEmbedded?: number; outputSizeBytes?: number }
  ): boolean;
  listByDocHash(docHash: string, limit?: number, offset?: number): ExportJobRow[];
  listByStatus(status: ExportJobStatus, limit?: number, offset?: number): ExportJobRow[];
  listRecent(limit?: number): ExportJobRow[];
  delete(id: number): boolean;
}
```

`db-bridge.ts` (David's adapter) translates snake_case rows ↔ camelCase DTOs at the IPC boundary, mapping `0/1` integers to booleans, `'n/a'` to its TS-union member, and nesting the image-format options into `ExportJobRowDto.imageOptions` (or `null` for office formats).

### 11.8 Foreign-key relationships

`export_jobs` has NO foreign keys (export is independent of edit history). The `doc_hash` column is a soft reference — there is no FK to `edits` / `bookmarks` / `signature_audit_log` / `ocr_jobs`. Documented as a deliberate denormalization — exports survive the deletion of the underlying doc's other rows; users can audit historical exports even after re-saving the doc (which changes the hash).

### 11.9 Validation matrix (Phase 6)

The renderer + IPC handler enforce the following invariants per row:

| Field | Constraint |
|---|---|
| `format` | one of 6 enum values |
| `quality_tier` | matches format: `'n/a'` iff format ∈ {png, jpeg, tiff}; else 'text-only' or 'layout-preserving' |
| `page_range_start` | `>= 0` |
| `page_range_end` | `>= start` AND `< doc.pageCount` |
| `dpi` | non-null iff format ∈ {png, jpeg, tiff}; range [72, 600] |
| `jpeg_quality` | non-null iff format='jpeg'; range [0.1, 1.0] |
| `multi_page_tiff` | non-null iff format='tiff'; 0 or 1 |
| `output_path` | absolute path; writable parent dir |
| `output_size_bytes` | nullable until terminal; `>= 0` when populated |
| `paragraphs_extracted` / `tables_detected` / `images_embedded` | nullable for image formats AND until done; `>= 0` when populated |
| `error_message` | non-null iff status='failed'; max length 2048 chars |

### 11.10 Migration repo seeds

The migration file inserts the 17 settings keys via `INSERT OR IGNORE`:

```sql
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('export.docx.qualityTier',         '"layout-preserving"'),
  ('export.docx.pageSize',            '"auto"'),
  ('export.docx.includeAnnotations',  'true'),
  ('export.xlsx.qualityTier',         '"text-only"'),
  ('export.xlsx.includeAnnotations',  'false'),
  ('export.pptx.qualityTier',         '"layout-preserving"'),
  ('export.pptx.includeAnnotations',  'true'),
  ('export.image.format',             '"png"'),
  ('export.image.dpi',                '150'),
  ('export.image.jpegQuality',        '0.9'),
  ('export.image.multiPageTiff',      'false'),
  ('export.image.includeAnnotations', 'true'),
  ('export.layout.lineEpsilonPt',     '2'),
  ('export.layout.paragraphBreakRatio','1.5'),
  ('export.layout.headingRatio',      '1.3'),
  ('export.layout.columnGapPt',       '40'),
  ('export.maxQueueSize',             '50');
```

`INSERT OR IGNORE` preserves user-customized values across upgrades (Phase 1 convention). The migration must NOT use `INSERT OR REPLACE` — that would clobber user preferences.

### 11.11 Phase 6 open questions

None new — all Phase 6 design questions from `wave-23-brief.md "Specific design questions"` (Q-A through Q-F) have been answered in `architecture-phase-6.md`, `export-engine.md`, this amendment, the api-contracts §17 amendment, the ui-spec §15 amendment, and the conventions §17 amendment.

| Wave-23-brief question | Answer location |
|---|---|
| Q-A. DOCX library scope | architecture-phase-6.md §3.1 + §4.4.1; export-engine.md §2.1 + §4 — `docx` (MIT) v9.7+; v1 surface = Paragraph + TextRun + Heading1..3 + Table + ImageRun + AlignmentType; defer footnotes/comments/revision tracking to Phase 6.1 |
| Q-B. Layout-preserving algorithm | architecture-phase-6.md §4.3; export-engine.md §3.4 + §3.5 — bounding-box Y-clustering (ε=2pt) for lines; paragraph-break by gap (1.5× line-height); heading by font-size delta (H1=1.8×, H2=1.5×, H3=1.3×); column detection by X-clustering (40pt gap); table detection via pdf.js operator-stream line-grid analysis |
| Q-C. Image extraction | architecture-phase-6.md §3.1 + §4.4.4; export-engine.md §3.6 — pdf.js `getOperatorList()` → `OPS.paintImageXObject` capture; CTM stack tracking for position; format conversion to PNG; inline image + XObject reference + image-mask all handled; skip threshold 8×8 px / 16 pt² |
| Q-D. Quality-tier UX | architecture-phase-6.md §4.2; ui-spec.md §15.3 — toggle in modal Step 2; `layout-preserving` default for Word + PowerPoint per locked-decision; `text-only` default for Excel (inherently tabular); image formats have no tier |
| Q-E. Progress / cancel UX | architecture-phase-6.md §4.5; export-engine.md §8; ui-spec.md §15.3 + §15.7 — background queue + status-bar widget + Exports sidebar tab; per-page progress; cancel always available; partial output deleted on cancel; mid-page cancel = Phase 6.1; job persistence across restarts = Phase 7+ |
| Q-F. Image format defaults | architecture-phase-6.md §4.4.4; export-engine.md §7 — PNG default (lossless); JPEG opt-in with quality slider (default 0.9); TIFF opt-in with multi-page bundle toggle (default false → one-file-per-page); dpi default 150 |

End of Phase-6 data-models amendment.

---

## 12. Phase 7 additions (2026-05-27, Riley)

> ### Phase 7 amendment (2026-05-27, Riley)
>
> §1-§11 above remain authoritative for Phase 1-6 data. Phase 7 introduces **NO new SQLite table** and **NO new column on any existing table**. It folds four new `settings` keys (telemetry opt-in, selected locale, update channel, last-update-check timestamp) into the existing key-value `settings` store. The telemetry ring buffer is **in-memory only** (NOT persisted to SQLite — it must never survive a restart, by privacy design). The `EditOperation` union is FROZEN (Phase 7 produces no edit). This is the FINAL roadmap phase.

### 12.1 Schema v7 migration overview

| Migration | File | Adds |
|---|---|---|
| v7 | `migrations/0007_phase7_polish.sql` (Ravi Wave 28) | NO new table; NO new column; setting-key seed inserts via `INSERT OR IGNORE INTO settings (key, value)` + the `schema_migrations` version row |

```sql
-- migrations/0007_phase7_polish.sql (Ravi Wave 28) — design shape
-- NO CREATE TABLE. NO ALTER TABLE. Settings-only forward-only migration.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('telemetry.optIn',      'false'),     -- DEFAULT OFF (P7-L-6 obligation #1)
  ('i18n.locale',          '"en-US"'),   -- baseline locale (JSON-string per Phase 1 convention)
  ('update.channel',       '"manual"'),  -- DEFAULT manual (no auto-check vs placeholder; P7-L-6 #2)
  ('update.lastCheckedAt', 'null');      -- nullable + late-init (NO sentinel 0)

INSERT INTO schema_migrations (version, applied_at) VALUES (7, strftime('%s', 'now') * 1000);
```

Forward-only. Idempotent — `migrate.ts` skips applied versions. Clean migration from schema v6 — settings rows only, zero structural change. This is the smallest migration in the project (no DDL at all), reflecting that Phase 7 is polish, not new persistent state.

### 12.2 The four new `settings` keys

Values are JSON-serialized strings in `settings.value` (Phase 1 convention; `'false'`, `'"en-US"'`, `'"manual"'`, `'null'`).

| Key | TS type | Default | Purpose | Obligation |
|---|---|---|---|---|
| `telemetry.optIn` | `boolean` | `false` | Master opt-in for the telemetry framework. When `false`, the renderer's `useTelemetry` hook drops every event AND the `telemetry:recordEvent` handler returns `recorded: false`. | **#1 — default OFF** |
| `i18n.locale` | `'en-US' \| 'es-ES'` | `'en-US'` | Active UI locale. Read at bootstrap → `i18next.changeLanguage`. `'es-ES'` is the proof locale (sample). | **#4 — baseline** |
| `update.channel` | `'manual' \| 'check-on-launch'` | `'manual'` | Auto-update trigger policy. `'manual'` = explicit check only (default, because the publish target is a placeholder). `'check-on-launch'` = check once on launch (opt-in). | **#2 — no auto-check vs placeholder** |
| `update.lastCheckedAt` | `number \| null` | `null` | ms-epoch timestamp of the last update check. `null` until the first check ever runs. Drives the About-modal "last checked: …" line. | nullable + late-init |

**Anti-sentinel discipline (cross-check with the four-times-bitten 2026-05-26 lesson):** `update.lastCheckedAt` defaults to `null`, NOT `0`. The renderer's About-modal selector pattern-matches: `lastCheckedAt === null ? t('settings.update.neverChecked') : fmtDate(lastCheckedAt)`. A sentinel `0` would render "Jan 1, 1970" — the exact defect class this discipline prevents.

### 12.3 SettingKey union extension (David's `src/ipc/contracts.ts`)

The Phase-1 `SettingKey` discriminated union (Ravi + David co-own the union; zero-drift discipline from the Wave 7 lesson) gains four members:

```ts
type SettingKey =
  // ...Phase 1-6 keys (frozen)...
  | 'telemetry.optIn'
  | 'i18n.locale'
  | 'update.channel'
  | 'update.lastCheckedAt';
```

Per the Wave-7 SettingKey-zero-drift lesson (a parallel agent pre-empting a union member caused no drift only because the shapes matched), David + Ravi MUST add these four to the SAME union in `src/ipc/contracts.ts` and the settings-repo's allowlist in Wave 28. Riley's renderer `settings-slice` gains a `usePhase7Settings` selector pulling all four at once for the Settings → General panel.

### 12.4 Telemetry ring buffer — IN-MEMORY ONLY (no schema)

The telemetry event buffer (`NoOpRingBufferTransport`, architecture-phase-7.md §4.3) is a **renderer-side in-memory bounded array (default 500 events)**. It is:

- **NOT a SQLite table.** Privacy design: telemetry events must not survive a restart, must not be forensically recoverable from the DB file, and must not be a tamper surface. An in-memory buffer that evaporates on quit is the correct durability for "anonymous counts the user can audit this session".
- **NOT persisted to `settings`** either. Only the opt-in *flag* persists; the events themselves never touch disk.
- Cleared on opt-out (`telemetry:setOptIn { optIn: false }` → `bufferCleared: true`) and on app quit (process exit).

This is a deliberate non-table. Documented for the audit trail so a future maintainer does not "helpfully" add a `telemetry_events` table — that would violate the privacy stance (P7-L-3).

### 12.5 EditOperation union — NOT extended

**Phase 7 introduces NO new EditOperation variant.** Auto-update, telemetry, locale changes, and a11y fixes do not produce edits. The `EditOperation` discriminated union (frozen by Phase 6 at `data-models.md §11.4`) remains FROZEN. The replay engine, history middleware, and document model are unchanged. Documented as a deliberate non-delta.

### 12.6 No foreign keys, no relationships

Phase 7 adds no rows that reference other tables. The four settings keys are independent key-value entries. No FK, no index (the `settings` table's existing PK on `key` suffices). Documented for completeness.

### 12.7 Renderer-facing state shapes (no DTO translation needed)

Unlike Phase 5/6 which needed snake_case-row ↔ camelCase-DTO translation, Phase 7's settings keys are read through the existing Phase-1 settings bridge (already camelCase-keyed by the `SettingKey` union). The renderer state shapes:

```ts
// update-slice (architecture-phase-7.md §3.3) — sourced from settings + IPC responses
interface UpdateState {
  channel: 'manual' | 'check-on-launch';   // from settings 'update.channel'
  status: UpdateStatus;                     // from update:check / download responses (not persisted)
  availableVersion: string | null;
  downloadProgressPercent: number | null;
  lastCheckedAt: number | null;             // from settings 'update.lastCheckedAt'
  errorMessage: string | null;
}

// telemetry status (architecture-phase-7.md §4.4) — from telemetry:getStatus
interface TelemetryStatus {
  optedIn: boolean;                         // from settings 'telemetry.optIn'
  bufferedCount: number;                    // from the in-memory buffer (not persisted)
  lastEventAt: number | null;
}

// locale state — from settings 'i18n.locale' + i18n:getAvailableLocales
interface LocaleState {
  active: 'en-US' | 'es-ES';                // from settings 'i18n.locale'
  available: Array<{ locale: 'en-US' | 'es-ES'; nativeName: string; complete: boolean }>;
}
```

`status` (update) and `bufferedCount` (telemetry) are **runtime-only, not persisted** — they live in renderer state for the current session and reset on relaunch. Only the four `settings` keys persist.

### 12.8 Validation matrix (Phase 7)

| Key / field | Constraint |
|---|---|
| `telemetry.optIn` | boolean; default `false` |
| `i18n.locale` | one of `supportedLngs` (`'en-US'`, `'es-ES'`); reject others |
| `update.channel` | one of `'manual'`, `'check-on-launch'` |
| `update.lastCheckedAt` | `null` OR `>= 0` ms epoch; NEVER a sentinel `0` for "never" (use `null`) |
| telemetry event | `name ∈ allowlist`; `dayBucket` matches `^\d{4}-\d{2}-\d{2}$`; `.strict()` rejects any extra property |

### 12.9 Phase 7 open questions

None new — all Phase 7 design questions from the Wave-27 brief (Q-A through Q-E) are answered across `architecture-phase-7.md`, `a11y-audit.md`, `i18n-strategy.md`, this amendment, the api-contracts §18 amendment, the ui-spec §16 amendment, and the conventions §18 amendment.

| Wave-27-brief question | Answer location |
|---|---|
| Q-A. i18n string-extraction scope | i18n-strategy.md §3 — big-bang sweep in Wave 28; ~800-1200 strings estimate; typed-key compile-error gate makes it verifiable |
| Q-B. Telemetry transport | architecture-phase-7.md §4.3 — `NoOpRingBufferTransport` (in-memory bounded buffer, default 500); nothing leaves the machine; auditable via debug panel; real network transport = Phase 7.1 behind the same `TelemetryTransport` interface |
| Q-C. Auto-update UX | architecture-phase-7.md §3.4 — explicit "Check for updates" in About modal (primary) + opt-in `update.channel='check-on-launch'` (default OFF); no silent background download (every download user-initiated) |
| Q-D. a11y remediation priority | a11y-audit.md §5 — MUST: open/render/navigate/annotate/save + deferred ARIA tab patterns; SHOULD ranked: forms > export > OCR > sign; DOCUMENT-ONLY: freehand/drawn-signature keyboard, page-raster narration |
| Q-E. Cross-platform native modules | architecture-phase-7.md §6 — `better-sqlite3` (HIGH risk; per-platform rebuild), `@napi-rs/canvas` (MEDIUM; universal-mac merge of both arch prebuilds), `tesseract.js-core` (LOW; WASM is portable); the riskiest part of the UNVERIFIED configs |

End of Phase-7 data-models amendment.
