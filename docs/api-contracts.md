# API Contracts — IPC Surface

**Author:** Riley (front-end-architect)
**Date:** 2026-05-21
**Status:** Wave 1, locked. Drives David's `src/ipc/contracts.ts` (David owns the file; Riley specs the shape; renderer imports read-only).
**Scope:** All IPC channels for Phase 1 + Phase 2's `pdf:export` (specified now because the engine-selector lives in Wave 1 architecture per Decision 1).

---

## 0. Conventions

All channels are `ipcRenderer.invoke` request/response unless explicitly labeled "event stream" (those use `webContents.send` from main → renderer).

Every channel's response is a discriminated-union `Result<T, ChannelError>`:

```ts
type Result<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message: string; details?: Record<string, unknown> };
```

- Main-process handlers NEVER throw across the bridge. All failures map to `{ ok: false, error, message }`.
- Error variants are **named string literals** per channel. No `error: string` with free-form values.
- Logging in main records `channel + duration + ok/error`, never payloads (which can contain document content).

### 0.1 Payload validation

David's handlers validate every payload with **zod** schemas (Riley specs the types; David authors the schemas in his handler files). Validation failures return `{ ok: false, error: 'invalid_payload', ... }`.

### 0.2 Naming convention

`<domain>:<verb>` — colon-separated. Domains: `dialog`, `fs`, `recents`, `settings`, `bookmarks`, `pdf`, `app`. Event streams use `<domain>:<verb>:<event>` (e.g. `pdf:export:progress`).

### 0.3 Shared types module

All types in this document live in `src/ipc/contracts.ts` (David's file). Renderer imports read-only:

```ts
import type { PdfApi, ChannelRequest, ChannelResponse } from '../ipc/contracts';
```

The preload bridge (`src/preload/index.ts`) exposes the typed `PdfApi` interface via `contextBridge.exposeInMainWorld('pdfApi', impl)`. The renderer's `services/api.ts` is a thin wrapper that re-narrows the global to the same `PdfApi` type.

---

## 1. Document handles

```ts
type DocumentHandle = number; // assigned by main on open; renderer treats as opaque
```

A `DocumentHandle` identifies an open document for the duration of its life in main-process memory. The renderer never sees the underlying file path; it works with handles. Main resolves `handle → path + buffer` internally.

Handle lifecycle:

- Created by `dialog:openPdf`, `fs:readPdf` (drag-drop), or `pdf:combine` (output of combine is a new handle for the new document)
- Held while the renderer has the document open
- Released by `fs:closePdf` (sent on document close or app quit)
- Stale handles return `error: 'handle_not_found'`

---

## 2. Channels — `dialog`

### 2.1 `dialog:openPdf`

Show native open dialog; on success, read the chosen file into memory and return a handle.

```ts
interface DialogOpenPdfRequest {} // no args; multi-select disabled in Phase 1
type DialogOpenPdfError = 'user_cancelled' | 'invalid_pdf' | 'fs_read_failed' | 'too_large';
interface DialogOpenPdfValue {
  handle: DocumentHandle;
  displayName: string;
  fileHash: string; // SHA-256(first 64 KiB || size), hex lowercase
  pageCount: number;
  pdflibLoadWarnings: string[]; // surfaced by ExportEngineSelector heuristic later
}
type DialogOpenPdfResponse = Result<DialogOpenPdfValue, DialogOpenPdfError>;
```

Notes:

- "Too large" threshold = 500 MB for Phase 1 (configurable in `app_settings`)
- `pdflibLoadWarnings` is the raw warning list pdf-lib emits on load; the renderer stores it on the document model for use at export time

### 2.2 `dialog:saveAs`

Show native save dialog; return chosen path (sanitized). Does NOT write — caller follows up with `fs:writePdf`.

```ts
interface DialogSaveAsRequest {
  suggestedName: string; // e.g. original filename with " (edited).pdf" suffix
}
type DialogSaveAsError = 'user_cancelled' | 'invalid_path';
interface DialogSaveAsValue {
  destinationToken: string; // opaque; pass to fs:writePdf. Renderer never sees the raw path.
  displayName: string; // for UI ("Saved to X.pdf")
}
type DialogSaveAsResponse = Result<DialogSaveAsValue, DialogSaveAsError>;
```

**Why a token instead of returning the path:** keeps the renderer ignorant of absolute paths even on the write side. The token expires after 60s if unused; main GCs it.

---

## 3. Channels — `fs`

### 3.1 `fs:readPdf` (drag-drop path)

Same shape as `dialog:openPdf` but accepts a path from a drag-drop event. Path is sanitized in main; renderer-supplied paths from drag events are validated against the OS-reported file URL list.

```ts
interface FsReadPdfRequest {
  // Renderer passes the File-API-derived path string from a drop event.
  // Main rejects anything that isn't an existing readable .pdf the OS surfaced.
  droppedPath: string;
}
type FsReadPdfError = DialogOpenPdfError | 'path_rejected';
type FsReadPdfResponse = Result<DialogOpenPdfValue, FsReadPdfError>;
```

### 3.2 `fs:writePdf`

Write the current document's edited bytes to the saved destination.

```ts
interface FsWritePdfRequest {
  handle: DocumentHandle;
  destinationToken: string; // from dialog:saveAs
  // For Phase 1 the renderer hands main the edited bytes; for Phase 2 we may move
  // the pdf-lib replay into main entirely. Both paths are supported by the contract.
  payload:
    | { kind: 'bytes'; bytes: Uint8Array }
    | {
        kind: 'ops';
        originalHandle: DocumentHandle;
        ops: EditOperationSerialized[];
        annotations: AnnotationModelSerialized[];
      };
}
type FsWritePdfError = 'token_expired' | 'handle_not_found' | 'fs_write_failed' | 'disk_full';
interface FsWritePdfValue {
  bytesWritten: number;
  newFileHash: string;
}
type FsWritePdfResponse = Result<FsWritePdfValue, FsWritePdfError>;
```

### 3.3 `fs:closePdf`

Release a document handle and its in-memory buffers.

```ts
interface FsClosePdfRequest {
  handle: DocumentHandle;
}
type FsClosePdfError = 'handle_not_found';
type FsClosePdfResponse = Result<{}, FsClosePdfError>;
```

---

## 4. Channels — `recents`

Backed by SQLite table `recent_files` (see `docs/data-models.md` §2.1).

### 4.1 `recents:list`

```ts
interface RecentsListRequest {
  limit?: number; // default 20
}
interface RecentsListItem {
  path: string; // shown only in tooltip; raw display path
  displayName: string;
  lastOpenedAt: number; // ms epoch
  fileHash: string;
  fileStillExists: boolean; // main checks existsSync; renderer dims missing entries
}
type RecentsListError = 'db_unavailable';
type RecentsListResponse = Result<{ items: RecentsListItem[] }, RecentsListError>;
```

### 4.2 `recents:add` (called internally on open; renderer rarely calls)

```ts
interface RecentsAddRequest {
  path: string; // resolved absolute path (main has it from open dialog)
  displayName: string;
  fileHash: string;
}
type RecentsAddError = 'db_unavailable' | 'invalid_payload';
type RecentsAddResponse = Result<{}, RecentsAddError>;
```

### 4.3 `recents:clear`

```ts
interface RecentsClearRequest {}
type RecentsClearError = 'db_unavailable';
type RecentsClearResponse = Result<{ cleared: number }, RecentsClearError>;
```

---

## 5. Channels — `settings`

Backed by SQLite `app_settings` table. Values are JSON-serialized strings; the channel transports parsed JSON to/from the renderer.

```ts
type SettingKey =
  | 'recents.maxItems'
  | 'open.maxFileSizeMB'
  | 'export.defaultEngine' // 'auto' | 'pdf-lib' | 'chromium'
  | 'export.showWarningsToast'
  | 'file_association.pdf.requested' // boolean; reflects Decision 4 state
  | 'theme' // 'system' | 'light' | 'dark' — Phase 2+ stretch
  | 'undo.maxHistory'; // default 100; Phase 2 wires the slider

type SettingValue<K extends SettingKey> = K extends 'recents.maxItems'
  ? number
  : K extends 'open.maxFileSizeMB'
    ? number
    : K extends 'export.defaultEngine'
      ? 'auto' | 'pdf-lib' | 'chromium'
      : K extends 'export.showWarningsToast'
        ? boolean
        : K extends 'file_association.pdf.requested'
          ? boolean
          : K extends 'theme'
            ? 'system' | 'light' | 'dark'
            : K extends 'undo.maxHistory'
              ? number
              : never;
```

### 5.1 `settings:get`

```ts
interface SettingsGetRequest<K extends SettingKey> {
  key: K;
}
type SettingsGetError = 'db_unavailable' | 'unknown_key';
type SettingsGetResponse<K extends SettingKey> = Result<
  { value: SettingValue<K> | null },
  SettingsGetError
>;
```

`null` when the key has never been set; the renderer applies its own default in that case.

### 5.2 `settings:set`

```ts
interface SettingsSetRequest<K extends SettingKey> {
  key: K;
  value: SettingValue<K>;
}
type SettingsSetError = 'db_unavailable' | 'unknown_key' | 'invalid_value';
type SettingsSetResponse = Result<{}, SettingsSetError>;
```

### 5.3 `settings:getAll` (renderer boot)

```ts
interface SettingsGetAllRequest {}
interface SettingsGetAllValue {
  // Partial — only set keys are returned; renderer merges with defaults.
  entries: Partial<{ [K in SettingKey]: SettingValue<K> }>;
}
type SettingsGetAllError = 'db_unavailable';
type SettingsGetAllResponse = Result<SettingsGetAllValue, SettingsGetAllError>;
```

---

## 6. Channels — `bookmarks`

User-authored bookmarks per file (keyed by `fileHash`). Distinct from native PDF outline bookmarks (those are read-only in Phase 1; merged display in UI).

### 6.1 `bookmarks:list`

```ts
interface BookmarksListRequest {
  fileHash: string;
}
interface BookmarkRow {
  id: number;
  fileHash: string;
  pageIndex: number;
  title: string;
  createdAt: number;
}
type BookmarksListError = 'db_unavailable';
type BookmarksListResponse = Result<{ items: BookmarkRow[] }, BookmarksListError>;
```

### 6.2 `bookmarks:upsert`

```ts
interface BookmarksUpsertRequest {
  fileHash: string;
  pageIndex: number;
  title: string;
  id?: number; // present → update; absent → insert
}
type BookmarksUpsertError = 'db_unavailable' | 'invalid_payload' | 'duplicate';
type BookmarksUpsertResponse = Result<{ id: number }, BookmarksUpsertError>;
```

### 6.3 `bookmarks:delete`

```ts
interface BookmarksDeleteRequest {
  id: number;
}
type BookmarksDeleteError = 'db_unavailable' | 'not_found';
type BookmarksDeleteResponse = Result<{}, BookmarksDeleteError>;
```

---

## 7. Channels — `pdf` (document operations)

### 7.1 `pdf:combine`

Server-side merge of multiple PDFs into a new document. Runs in main (pdf-lib) so the renderer stays responsive.

```ts
interface PdfCombineRequest {
  // Each input is either an open document or a fresh file path from a picker
  sources: Array<
    | { kind: 'handle'; handle: DocumentHandle; pageRange?: { start: number; end: number } }
    | { kind: 'path'; path: string; pageRange?: { start: number; end: number } } // path is one main has from a file picker; renderer never originates raw paths
  >;
}
type PdfCombineError =
  | 'invalid_source'
  | 'handle_not_found'
  | 'fs_read_failed'
  | 'pdf_load_failed'
  | 'invalid_page_range';
interface PdfCombineValue {
  handle: DocumentHandle; // new in-memory document
  pageCount: number;
  displayName: string; // default "Combined Document.pdf"; user can change via Save As
}
type PdfCombineResponse = Result<PdfCombineValue, PdfCombineError>;
```

### 7.2 `pdf:export` (Phase 2 channel, contract specified now per Decision 1)

Export the current state of an open document to a fresh PDF, applying all dirty operations.

```ts
type ExportEnginePreference = 'auto' | 'pdf-lib' | 'chromium';

interface PdfExportRequest {
  handle: DocumentHandle;
  preference: ExportEnginePreference; // user choice from export dialog
}

type PdfExportError =
  | 'handle_not_found'
  | 'engine_failed_pdflib'
  | 'engine_failed_chromium'
  | 'no_dirty_changes' // not actually an error in UX; channel returns it so renderer can offer "save without re-emit"
  | 'cancelled';

interface PdfExportValue {
  engine: 'pdf-lib' | 'chromium'; // which engine actually ran
  reason: string; // why this engine was chosen
  forcedBy: 'user' | 'heuristic';
  warnings: string[];
  outputBytes: Uint8Array; // ~for small documents; for large, see streaming variant below
}
type PdfExportResponse = Result<PdfExportValue, PdfExportError>;
```

For documents >50 MB, main streams via `pdf:export:progress` events (§7.3) and returns a temp-file path token instead of `outputBytes`. (Implementation detail for Phase 2; contract reserves the field.)

### 7.3 `pdf:export:progress` (event stream, main → renderer)

```ts
interface PdfExportProgressEvent {
  handle: DocumentHandle;
  jobId: string;
  phase:
    | 'preparing'
    | 'pdflib-applying-ops'
    | 'chromium-loading'
    | 'chromium-printing'
    | 'finalizing';
  percent: number; // 0–100; -1 for indeterminate
  message?: string;
}
```

Renderer subscribes via `window.pdfApi.events.onExportProgress(handler)` (preload exposes a typed listener registration helper).

### 7.4 `pdf:getOutline` (PDF-native bookmarks; read-only Phase 1)

```ts
interface PdfGetOutlineRequest {
  handle: DocumentHandle;
}
interface OutlineNode {
  title: string;
  pageIndex: number | null; // null for chapter-headers without destinations
  children: OutlineNode[];
}
type PdfGetOutlineError = 'handle_not_found' | 'parse_failed';
type PdfGetOutlineResponse = Result<{ outline: OutlineNode[] }, PdfGetOutlineError>;
```

---

## 8. Channels — `app`

### 8.1 `app:getVersion`

```ts
interface AppGetVersionRequest {}
interface AppGetVersionValue {
  appVersion: string; // from package.json
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
}
type AppGetVersionResponse = Result<AppGetVersionValue, never>;
```

### 8.2 `app:quit`

```ts
interface AppQuitRequest {
  confirmUnsaved: boolean;
}
type AppQuitError = 'unsaved_changes';
type AppQuitResponse = Result<{}, AppQuitError>;
// If confirmUnsaved is false and there are dirty docs, returns the error so the renderer can prompt.
```

### 8.3 `app:setDefaultPdfHandler` (Decision 4 runtime toggle)

Request that the OS make PDF_Viewer_Editor the default handler for `.pdf`. On Windows 10+ the OS may show its own consent UI; the channel surfaces the OS-reported result.

```ts
interface AppSetDefaultPdfHandlerRequest {
  enable: boolean; // true → request to become default; false → relinquish (no-op if not currently default)
}
type AppSetDefaultPdfHandlerError =
  | 'os_denied' // user clicked "No" in Windows consent UI
  | 'unsupported_os' // non-Windows platform (Phase 7)
  | 'registry_write_failed'
  | 'already_in_requested_state';
interface AppSetDefaultPdfHandlerValue {
  isNowDefault: boolean; // current OS state after the request
  prompt: 'shown' | 'not_shown'; // whether the OS surfaced its consent UI
}
type AppSetDefaultPdfHandlerResponse = Result<
  AppSetDefaultPdfHandlerValue,
  AppSetDefaultPdfHandlerError
>;
```

### 8.4 `app:getDefaultPdfHandlerStatus`

```ts
interface AppGetDefaultPdfHandlerStatusRequest {}
interface AppGetDefaultPdfHandlerStatusValue {
  isDefault: boolean;
  currentDefaultName?: string; // e.g. "Microsoft Edge" if we're not default; null if unknown
}
type AppGetDefaultPdfHandlerStatusResponse = Result<
  AppGetDefaultPdfHandlerStatusValue,
  'os_query_failed'
>;
```

### 8.5 `app:openExternal` (recents tooltip, etc.)

For the small set of UI affordances that need to open an OS path (e.g. "show in Explorer"). Strictly path-validated; never opens arbitrary URLs.

```ts
interface AppOpenExternalRequest {
  kind: 'show_in_explorer';
  handle: DocumentHandle;
}
type AppOpenExternalError = 'handle_not_found' | 'os_failed';
type AppOpenExternalResponse = Result<{}, AppOpenExternalError>;
```

### 8.6 `app:pickPdfPath` — Phase-2 placeholder (not implemented in Phase 1)

Reserved channel for the combine-modal "Add file…" affordance. Opens the OS open-file dialog and returns a sanitized path string (not a handle — the combine flow accepts paths directly). Phase 1 stubs the affordance in the UI with a "coming soon" toast; the channel ships in Phase 2 with the implementation.

```ts
// Phase 2 — not registered in Phase 1
interface AppPickPdfPathRequest {}
type AppPickPdfPathError = 'cancelled' | 'invalid_path';
type AppPickPdfPathValue = { path: string; displayName: string };
type AppPickPdfPathResponse = Result<AppPickPdfPathValue, AppPickPdfPathError>;
```

---

## 9. Channels — `window` (added by David per Wave 2 CLAUDE.md brief)

These four channels were added to `src/ipc/contracts.ts` during Wave 2 to support a future custom-chrome / title-bar story. The Phase 1 renderer does NOT consume them — Electron's native chrome covers Phase 1. They are documented here so the contract module reflects shipped reality and Julian's Wave 3 audit covers them. Phase 2+ custom-chrome work uses these directly.

### 9.1 `window:minimize`

```ts
interface WindowMinimizeRequest {}
type WindowMinimizeError = 'no_window';
type WindowMinimizeResponse = Result<{}, WindowMinimizeError>;
```

### 9.2 `window:maximize`

Toggles between maximized and unmaximized. Returns the resulting state so the renderer can swap the icon.

```ts
interface WindowMaximizeRequest {}
type WindowMaximizeError = 'no_window';
interface WindowMaximizeValue {
  isMaximized: boolean;
}
type WindowMaximizeResponse = Result<WindowMaximizeValue, WindowMaximizeError>;
```

### 9.3 `window:close`

Closes the focused window. Fires the standard `before-close` flow (unsaved-changes prompt etc.); the renderer should rely on the existing close-confirmation modal rather than calling this for documents with dirty state.

```ts
interface WindowCloseRequest {}
type WindowCloseError = 'no_window';
type WindowCloseResponse = Result<{}, WindowCloseError>;
```

### 9.4 `window:getState`

Read-only snapshot of the window's chrome state — used by Phase-2 custom chrome to render the right minimize/maximize icon at startup.

```ts
interface WindowGetStateRequest {}
type WindowGetStateError = 'no_window';
interface WindowGetStateValue {
  isMaximized: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
}
type WindowGetStateResponse = Result<WindowGetStateValue, WindowGetStateError>;
```

---

## 9.5 Stub-channel error variant: `'not_implemented'`

The following Phase-1 channels ship a typed stub implementation that returns the contract-shaped error variant `'not_implemented'`: `pdf:combine`, `pdf:export`, `pdf:getOutline`, `app:setDefaultPdfHandler`, `app:getDefaultPdfHandlerStatus`, and the `ops`-payload branch of `fs:writePdf`. The variant is appended to each channel's error union in `src/ipc/contracts.ts` and the renderer pattern-matches it to surface a "coming soon" toast or disable the affordance. Real implementations land in Wave 2 follow-up (combine + outline) and Phase 2 (export, file-association toggle, ops-payload save). The renderer treats `'not_implemented'` as a non-error stub signal, not a failure.

---

## 9.6 Aggregate `PdfApi` shape (preload bridge surface)

```ts
export interface PdfApi {
  dialog: {
    openPdf: () => Promise<DialogOpenPdfResponse>;
    saveAs: (req: DialogSaveAsRequest) => Promise<DialogSaveAsResponse>;
  };
  fs: {
    readPdf: (req: FsReadPdfRequest) => Promise<FsReadPdfResponse>;
    writePdf: (req: FsWritePdfRequest) => Promise<FsWritePdfResponse>;
    closePdf: (req: FsClosePdfRequest) => Promise<FsClosePdfResponse>;
  };
  recents: {
    list: (req: RecentsListRequest) => Promise<RecentsListResponse>;
    add: (req: RecentsAddRequest) => Promise<RecentsAddResponse>;
    clear: () => Promise<RecentsClearResponse>;
  };
  settings: {
    get: <K extends SettingKey>(req: SettingsGetRequest<K>) => Promise<SettingsGetResponse<K>>;
    set: <K extends SettingKey>(req: SettingsSetRequest<K>) => Promise<SettingsSetResponse>;
    getAll: () => Promise<SettingsGetAllResponse>;
  };
  bookmarks: {
    list: (req: BookmarksListRequest) => Promise<BookmarksListResponse>;
    upsert: (req: BookmarksUpsertRequest) => Promise<BookmarksUpsertResponse>;
    delete: (req: BookmarksDeleteRequest) => Promise<BookmarksDeleteResponse>;
  };
  pdf: {
    combine: (req: PdfCombineRequest) => Promise<PdfCombineResponse>;
    export: (req: PdfExportRequest) => Promise<PdfExportResponse>;
    getOutline: (req: PdfGetOutlineRequest) => Promise<PdfGetOutlineResponse>;
  };
  app: {
    getVersion: () => Promise<AppGetVersionResponse>;
    quit: (req: AppQuitRequest) => Promise<AppQuitResponse>;
    setDefaultPdfHandler: (
      req: AppSetDefaultPdfHandlerRequest,
    ) => Promise<AppSetDefaultPdfHandlerResponse>;
    getDefaultPdfHandlerStatus: () => Promise<AppGetDefaultPdfHandlerStatusResponse>;
    openExternal: (req: AppOpenExternalRequest) => Promise<AppOpenExternalResponse>;
  };
  window: {
    minimize: () => Promise<WindowMinimizeResponse>;
    maximize: () => Promise<WindowMaximizeResponse>;
    close: () => Promise<WindowCloseResponse>;
    getState: () => Promise<WindowGetStateResponse>;
  };
  events: {
    onExportProgress: (handler: (evt: PdfExportProgressEvent) => void) => () => void; // returns unsubscribe
  };
}
```

The preload `index.ts` constructs this object by binding each method to `ipcRenderer.invoke('<channel>', payload)` and exposes it via `contextBridge.exposeInMainWorld('pdfApi', pdfApi)`.

---

## 10. Validation responsibilities

| Layer                  | Validates                                                 |
| ---------------------- | --------------------------------------------------------- |
| Renderer (TS compiler) | Argument types — caught at build time                     |
| Preload                | Nothing (pure forward)                                    |
| Main handler (entry)   | Zod schema of payload — runtime                           |
| Main handler (logic)   | Business rules (handle exists, file exists, bounds, etc.) |
| Main handler (output)  | Result variant — TS exhaustive checks                     |

The renderer NEVER trusts a payload returned from main without checking the `ok` discriminant. ESLint rule: `consistent-return-result` (custom) — to be authored in Wave 3.

---

## 11. Backward-compatibility policy

Phase 1's contract is frozen at end of Wave 1. Changes during Wave 2 require an explicit Marcus-approved amendment to this file. The contract module (`src/ipc/contracts.ts`) is owned by David; Riley reads only.

If David discovers a contract bug during Wave 2 implementation, the protocol is:

1. David documents the issue inline as a comment in `src/ipc/contracts.ts`
2. David pings Marcus
3. Marcus dispatches Riley for a contract amendment
4. The amendment edits THIS file, then Riley signals David to update `src/ipc/contracts.ts`

This avoids the parallel-write contention pattern from the orchestrator's Hard-Won Playbook §1.

---

### Phase 2 amendment (2026-05-21, Riley)

The §1-§11 surface above remains FROZEN at Wave 1 (per locked decision P2-L-5 in `docs/phase-2-plan.md`). Phase 2 channels are appended below in §12 as additive-only changes. Two Phase-1 stubs change status (no contract shape change, just removal of the `'not_implemented'` error variant):

| Channel                                     | Phase 1 status                                            | Phase 2 status                                                                                        |
| ------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `fs:writePdf` with `payload.kind === 'ops'` | Returns `'not_implemented'`                               | **LIVE** — real replay-engine path; returns `{ bytesWritten, newFileHash, annotationRefAssignments }` |
| `pdf:export`                                | Returns `'not_implemented'`                               | **LIVE** — dual-engine selector (pdf-lib default, Chromium fallback)                                  |
| `pdf:combine`                               | Returns `'not_implemented'` (per Wave-2 stub status §9.5) | (Wave 7 Phase-2 ships real implementation per phase-2-plan §2.2)                                      |

The `'not_implemented'` variant remains on each error union for API stability; handlers stop returning it in Phase 2.

---

## 12. Phase 2 additions (2026-05-21, Riley)

All channels below are NEW in Phase 2. They follow the §0 conventions: discriminated-union `Result<T, E>`, zod-validated payloads, no thrown exceptions across the bridge. Naming convention `<domain>:<verb>` is preserved.

### 12.1 `pdf:embedImage`

Embed a single image (PNG/JPEG/TIFF) into the document, either as a new page or as an overlay on an existing page. Returns an `EditOperation` to be appended to the renderer's `dirtyOps`.

```ts
type ImageFormat = 'image/png' | 'image/jpeg' | 'image/tiff';

interface PdfEmbedImageRequest {
  handle: DocumentHandle;
  image: {
    bytes: Uint8Array;
    mimeType: ImageFormat;
    /** Intrinsic image dimensions in pixels (used for default page sizing). */
    width: number;
    height: number;
  };
  placement:
    | { kind: 'new-page'; atIndex: number; orientation?: 'portrait' | 'landscape' }
    | { kind: 'overlay'; pageIndex: number; rect: PdfRect; overlayId?: string }; // overlayId auto-generated if absent
}

type PdfEmbedImageError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'image_decode_failed' // PNG/JPEG load failed
  | 'tiff_decode_failed' // TIFF subtype unsupported
  | 'tiff_multi_page_warning' // first page used; warning returned alongside success — NOT an error
  | 'out_of_range'; // atIndex or pageIndex out of bounds

interface PdfEmbedImageValue {
  /** The EditOperation to append to dirtyOps. Caller dispatches applyEdit(op) on the renderer slice. */
  op: EditOperationSerialized; // kind: 'image-insert' | 'image-overlay'
  /** Content hash of the embedded image (sha256 hex). Used for dedup across the same save. */
  contentHash: string;
  /** Warnings (e.g. "Multi-page TIFF: first page used"); non-blocking. */
  warnings: string[];
}

type PdfEmbedImageResponse = Result<PdfEmbedImageValue, PdfEmbedImageError>;
```

**Why the channel returns the op:** centralizes the EditMeta + operationId generation in main (next to the bytes + hashing). The renderer dispatches the op verbatim through its standard `applyEdit` funnel. This keeps the renderer ignorant of bytes (per conventions §10).

### 12.2 `pdf:replaceText`

Apply a text-replace EditOperation. The renderer typically calls this **after** the user commits the inline editor, NOT during typing — typing is renderer-local until commit.

```ts
interface PdfReplaceTextRequest {
  handle: DocumentHandle;
  pageIndex: number;
  objectId: string; // from a prior pdf:identifyTextSpan call (see §12.3)
  newText: string;
}

type PdfReplaceTextError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'text_span_not_found' // objectId resolves to nothing in the current bytes
  | 'missing_glyph' // font lacks one or more codepoints; per locked decision P2-L-3 no substitution
  | 'out_of_range';

interface PdfReplaceTextValue {
  op: EditOperationSerialized; // kind: 'text-replace' { ..., oldText, newText }
  /** Will the new text be clipped by the original run's bounding box? Renderer warned the user already, but this confirms. */
  willClip: boolean;
  /** If willClip, this is the overflow in PDF user-space units. */
  overflowPt?: number;
}

type PdfReplaceTextResponse = Result<PdfReplaceTextValue, PdfReplaceTextError>;
```

Note that the actual replacement (mutation of pdf-lib content stream) does NOT happen here — it happens at save time inside `replay()`. This channel validates feasibility and returns the op with the `oldText` populated (from the current bytes) so undo works correctly.

### 12.3 `pdf:identifyTextSpan`

Find the text span at a given page + coordinate. Used by the text-edit overlay when the user clicks into a text region.

```ts
interface PdfIdentifyTextSpanRequest {
  handle: DocumentHandle;
  pageIndex: number;
  /** PDF user-space coordinates (origin bottom-left). Converted from screen coords by pdf-coords.ts. */
  x: number;
  y: number;
}

type PdfIdentifyTextSpanError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'no_text_at_point'
  | 'out_of_range';

interface PdfIdentifyTextSpanValue {
  objectId: string; // pageObjectNumber/contentStreamIndex/runIndex — see edit-replay-engine.md §4.6.1
  runBoundingRect: PdfRect;
  currentText: string;
  font: {
    family: string; // PDF font name, e.g. "Helvetica" or subset prefix
    size: number;
    /** Glyph metrics for the renderer-side font-metrics shim (architecture-phase-2.md §4.3). */
    glyphWidths: Record<number /* codepoint */, number /* width at 1pt */>;
    glyphMapSize: number; // total number of glyphs in the font's encoding (for missing-glyph detection)
  };
}

type PdfIdentifyTextSpanResponse = Result<PdfIdentifyTextSpanValue, PdfIdentifyTextSpanError>;
```

The `font.glyphWidths` payload allows the renderer to measure new strings without round-tripping per keystroke. The renderer caches this per `objectId` for the editor session. Conventions §10 (no `Uint8Array` in renderer state) is preserved — glyph widths are plain JSON.

### 12.4 `pdf:print`

Send the current document state (replayed) to a physical printer via Electron's `webContents.print()`. Opens the OS print dialog if no `printerName` is supplied.

```ts
interface PdfPrintRequest {
  handle: DocumentHandle;
  ops: EditOperationSerialized[]; // dirtyOps to apply before printing
  annotations: AnnotationModelSerialized[];
  printerName?: string; // if absent, OS dialog is shown
  pageRange?: { start: number; end: number }; // inclusive, 1-based; absent = all pages
  options?: {
    silent?: boolean; // suppress OS dialog (requires printerName)
    copies?: number;
    color?: boolean;
    duplex?: 'simplex' | 'short-edge' | 'long-edge';
    pageSize?: 'A4' | 'Letter' | 'Legal' | { width: number; height: number };
  };
}

type PdfPrintError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'replay_failed' // engine failed to produce printable bytes
  | 'no_printers_found'
  | 'printer_not_found' // printerName doesn't match any installed printer
  | 'user_cancelled' // user closed the OS dialog without confirming
  | 'print_dispatch_failed'; // Electron-side error

interface PdfPrintValue {
  jobDispatched: true;
  /** Engine used to produce the printable bytes. Always 'pdf-lib' in Phase 2 unless the engine selector forced 'chromium'. */
  engineUsed: 'pdf-lib' | 'chromium';
  warnings: string[]; // e.g. from replay engine
}

type PdfPrintResponse = Result<PdfPrintValue, PdfPrintError>;
```

Print is fire-and-forget once dispatched; the OS handles spooling. The channel returns immediately after `webContents.print()` callback fires (success or fail). Phase 2 does NOT track print job lifecycle past dispatch.

### 12.5 `bookmarks:listTree`

Hierarchical fetch of user-authored bookmarks for a file, with `parent_id` + `sort_order` honored.

```ts
interface BookmarksListTreeRequest {
  fileHash: string;
}

interface BookmarkNode {
  id: number;
  fileHash: string;
  pageIndex: number;
  title: string;
  createdAt: number;
  parentId: number | null;
  sortOrder: number;
  children: BookmarkNode[]; // recursive
}

type BookmarksListTreeError = 'db_unavailable';
type BookmarksListTreeResponse = Result<{ tree: BookmarkNode[] }, BookmarksListTreeError>;
```

Root-level nodes (`parentId === null`) are returned at the top level, sorted by `sortOrder` then `id`. Children are recursively nested.

### 12.6 `bookmarks:move`

Re-parent and/or re-order a single bookmark.

```ts
interface BookmarksMoveRequest {
  id: number;
  newParentId: number | null; // null = make top-level
  newSortOrder: number;
}

type BookmarksMoveError =
  | 'db_unavailable'
  | 'not_found'
  | 'invalid_payload'
  | 'cycle_detected'
  | 'invalid_parent';
type BookmarksMoveResponse = Result<{}, BookmarksMoveError>;
```

`'cycle_detected'` fires if `newParentId` is a descendant of `id` (would create a loop). The repo method checks before applying.

`'invalid_parent'` is returned when the requested `newParentId` does not exist OR belongs to a different `fileHash` than the bookmark being moved.

> ### Phase 2.5 amendment (2026-05-22, David)
>
> `'invalid_parent'` is added to the `BookmarksMoveError` union. Wave 7 collapsed the repo's three-variant failure mode (`not_found | cycle_detected | invalid_parent`) onto a boolean and the IPC handler heuristically reconstructed the variant from the request shape — rendering `invalid_parent` permanently unreachable. Wave 8.5 (H-1) restored the discriminated union end-to-end at the repo→bridge→handler layer (see `data-models.md §7.5` amendment) but left the wire surface with only four variants because the brief explicitly froze Wave 1 docs. The handler then translated `invalid_parent → invalid_payload` at the wire boundary so renderer surfaces wouldn't see an undocumented variant. That translation is now retired: the handler passes `invalid_parent` through verbatim. Riley's renderer-side `moveBookmarkThunk` (R-10.3) handles the new variant as a first-class case (toast: "Cannot move bookmark to that location").

### 12.7 `bookmarks:rename`

Convenience channel — equivalent to `bookmarks:upsert` with only `title` changed, but easier for the renderer to call from the inline-rename UI.

```ts
interface BookmarksRenameRequest {
  id: number;
  title: string;
}
type BookmarksRenameError = 'db_unavailable' | 'not_found' | 'invalid_payload';
type BookmarksRenameResponse = Result<{}, BookmarksRenameError>;
```

### 12.8 New `pdf:export:progress` phase values

The existing event stream (§7.3) gains the following `phase` values:

```ts
type PdfExportProgressPhase =
  | 'preparing' // existing Phase 1
  | 'pdflib-applying-ops' // existing
  | 'pdflib-applying-text-replace' // NEW sub-phase
  | 'pdflib-embedding-images' // NEW sub-phase
  | 'pdflib-emitting-annotations' // NEW sub-phase
  | 'chromium-loading' // existing
  | 'chromium-printing' // existing
  | 'finalizing'; // existing
```

Additive — no existing phase values are removed.

### 12.9 New `Setting` keys

The `SettingKey` union (§5) extends with:

```ts
type SettingKey =
  // ...existing keys (recents.maxItems, open.maxFileSizeMB, etc.)...
  | 'export.deterministic' // boolean; strip timestamps from Chromium output; default false
  | 'export.includeBookmarksInOutline' // boolean; write user-authored bookmarks to exported PDF /Outlines; default true
  | 'editing.confirmDelete' // boolean; show confirm dialog on annotation/page delete; default true (from Julian Wave 2 MEDIUM finding I-2, absorbed in Phase 2)
  | 'editing.commitTextOnBlur'; // boolean; commit text-edit on click-out (vs only Enter); default true

type SettingValue<K extends SettingKey> =
  // ...existing mappings...
  K extends 'export.deterministic'
    ? boolean
    : K extends 'export.includeBookmarksInOutline'
      ? boolean
      : K extends 'editing.confirmDelete'
        ? boolean
        : K extends 'editing.commitTextOnBlur'
          ? boolean
          : never;
```

These are added to the registry in `data-models.md` §2.3 + §7.

### 12.10 Aggregate `PdfApi` shape — Phase 2 additions

Extends §9.6:

```ts
export interface PdfApi {
  // ...existing Phase 1 namespaces...
  pdf: {
    // ...existing Phase 1 methods (combine, export, getOutline)...
    embedImage: (req: PdfEmbedImageRequest) => Promise<PdfEmbedImageResponse>; // NEW
    replaceText: (req: PdfReplaceTextRequest) => Promise<PdfReplaceTextResponse>; // NEW
    identifyTextSpan: (req: PdfIdentifyTextSpanRequest) => Promise<PdfIdentifyTextSpanResponse>; // NEW
    print: (req: PdfPrintRequest) => Promise<PdfPrintResponse>; // NEW
  };
  bookmarks: {
    // ...existing list, upsert, delete...
    listTree: (req: BookmarksListTreeRequest) => Promise<BookmarksListTreeResponse>; // NEW
    move: (req: BookmarksMoveRequest) => Promise<BookmarksMoveResponse>; // NEW
    rename: (req: BookmarksRenameRequest) => Promise<BookmarksRenameResponse>; // NEW
  };
  // events.onExportProgress receives new phase values (§12.8); type is the same.
}
```

### 12.11 Validation responsibilities — unchanged

§10 table still holds for the new channels. Every new handler validates payload with zod, sanitizes paths through `path-sanitizer.ts` (no new paths in Phase 2 — image bytes come in-memory via drag-drop or file picker; the picker uses the existing `app:pickPdfPath` Phase-2 channel pattern; an analogous `app:pickImagePath` may be added in Wave 7 if needed).

### 12.12 Phase 2 contract freeze point

At end of Wave 6 (this amendment), the Phase-2 contract is locked. Wave 7 implementation must conform; David extends `src/ipc/contracts.ts` to match these types. Any Wave-7 discovery that requires a contract change follows the same Riley-amend-then-David-update protocol as Wave 2 (§11 above).

---

### Phase 3 amendment (2026-05-22, Riley)

The §1-§12 surface above remains FROZEN at Wave 6 (per Phase-3 freeze rule recorded in `docs/architecture-phase-3.md §13`). Phase 3 channels are appended below in §13 as additive-only changes. No Phase-1 or Phase-2 channel's contract shape changes.

`pdf:export` (§7.2) gains an additive optional `flattenForms?: boolean` field — see §13.11 below for the amendment.

---

## 13. Phase 3 additions (2026-05-22, Riley)

All channels below are NEW in Phase 3. They follow the §0 conventions: discriminated-union `Result<T, E>`, zod-validated payloads, no thrown exceptions across the bridge. Naming convention `<domain>:<verb>` is preserved; the new domain is `forms`.

### 13.1 `forms:detect`

Detect AcroForm fields in the open document. Cheap; no doc mutation.

```ts
interface FormsDetectRequest {
  handle: DocumentHandle;
}

type FormsDetectError = 'handle_not_found' | 'load_failed' | 'detect_failed';

interface FormsDetectValue {
  fields: FormFieldDefinition[];
  hasAcroForm: boolean;
  hasXfaForm: boolean; // XFA detected → renderer shows "read-only XFA" banner
  hasJavaScriptActions: boolean; // /Names /JavaScript present → renderer warning
  warnings: string[];
}

type FormsDetectResponse = Result<FormsDetectValue, FormsDetectError>;
```

`FormFieldDefinition` shape: see `data-models.md §8.1`.

### 13.2 `forms:fill`

Apply a single per-field fill value. Returns an `EditOperation` per Phase-3 hybrid model (`architecture-phase-3.md §5`) — actual mutation happens at save via the replay engine. The renderer typically calls this to validate the value (e.g. dropdown option exists) before pushing to `formsSlice.values`.

```ts
interface FormsFillRequest {
  handle: DocumentHandle;
  fieldName: string;
  value: FormFieldValue;
}

type FormsFillError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'field_not_found'
  | 'field_type_mismatch' // e.g. text value on a checkbox field
  | 'option_not_in_field'; // dropdown/radio value not in options[]

interface FormsFillValue {
  fieldName: string;
  /** Echo of the validated value (normalized — e.g. date coerced to ISO-8601). */
  normalizedValue: FormFieldValue;
  warnings: string[];
}

type FormsFillResponse = Result<FormsFillValue, FormsFillError>;
```

Note: this channel does NOT return an EditOperation. Per Phase-3 hybrid model, individual fill values are transient renderer state; the commit boundary (Save or explicit "Commit form values" button) produces a SINGLE `form-commit` EditOperation containing the batched values. The renderer's `commitFormThunk` constructs that op locally (no IPC call needed for the construction).

### 13.3 `forms:flatten`

Flatten all form fields to static page content. Standalone op (also bundled into `pdf:export` via §13.11 flag).

```ts
interface FormsFlattenRequest {
  handle: DocumentHandle;
}

type FormsFlattenError =
  | 'handle_not_found'
  | 'load_failed'
  | 'form_not_present'
  | 'flatten_failed'
  | 'serialize_failed';

interface FormsFlattenValue {
  /** EditOperation pushed to dirtyOps (kind: 'form-flatten'). Save will produce the flattened bytes. */
  op: EditOperationSerialized;
  flattenedFieldCount: number;
  warnings: string[];
}

type FormsFlattenResponse = Result<FormsFlattenValue, FormsFlattenError>;
```

Note: this channel returns an EditOperation (unlike `forms:fill`) because flatten is a one-shot document-structural change, not a transient value edit. Standard EditOperation pattern.

### 13.4 `forms:designAdd`

Author a new form field. Renderer fires this when the user completes a click-to-place gesture in the form-designer mode.

```ts
interface FormsDesignAddRequest {
  handle: DocumentHandle;
  fieldDefinition: FormFieldDefinition;
}

type FormsDesignAddError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'duplicate_field_name'
  | 'invalid_field_definition' // e.g. radio with no options
  | 'unsupported_field_type' // Phase 3.1 types
  | 'page_out_of_range';

interface FormsDesignAddValue {
  op: EditOperationSerialized; // kind: 'form-design-add'
  /** Confirmed/sanitized field definition (e.g. rect coords clamped to page bounds). */
  normalizedFieldDefinition: FormFieldDefinition;
  warnings: string[];
}

type FormsDesignAddResponse = Result<FormsDesignAddValue, FormsDesignAddError>;
```

### 13.5 `forms:designRemove`

Remove a form field (authored OR detected).

```ts
interface FormsDesignRemoveRequest {
  handle: DocumentHandle;
  fieldName: string;
}

type FormsDesignRemoveError = 'handle_not_found' | 'invalid_payload' | 'field_not_found';

interface FormsDesignRemoveValue {
  op: EditOperationSerialized; // kind: 'form-design-remove'; carries the full FieldDefinition for inverse
  warnings: string[];
}

type FormsDesignRemoveResponse = Result<FormsDesignRemoveValue, FormsDesignRemoveError>;
```

### 13.6 `forms:listTemplates`

List saved form templates from the `form_templates` table (schema v3).

```ts
interface FormsListTemplatesRequest {}

interface FormTemplateListItem {
  id: number;
  name: string;
  /** Number of fields in the template (saves the renderer a JSON parse + count). */
  fieldCount: number;
  sourceDocHash: string | null;
  createdAt: number;
  updatedAt: number;
}

type FormsListTemplatesError = 'db_unavailable';

interface FormsListTemplatesValue {
  items: FormTemplateListItem[]; // ordered by updatedAt DESC
}

type FormsListTemplatesResponse = Result<FormsListTemplatesValue, FormsListTemplatesError>;
```

Note: `listTemplates` returns only summary metadata. Full field definitions come via `forms:loadTemplate` (§13.8) — keeps the list-fetch cheap.

### 13.7 `forms:saveTemplate`

Save the current document's authored field set as a reusable template.

```ts
interface FormsSaveTemplateRequest {
  handle: DocumentHandle;
  name: string; // unique; on conflict, returns 'name_in_use'
  fields: FormFieldDefinition[]; // typically formsSlice.fields filtered to origin='authored'
  /** Optional column-mapping snapshot from a prior mail-merge run, persisted with the template. */
  columnMappings?: Record<string, string>;
}

type FormsSaveTemplateError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'name_in_use'
  | 'db_unavailable';

interface FormsSaveTemplateValue {
  id: number;
  warnings: string[];
}

type FormsSaveTemplateResponse = Result<FormsSaveTemplateValue, FormsSaveTemplateError>;
```

### 13.8 `forms:loadTemplate`

Load a template; returns the field definitions for the renderer to dispatch as `form-design-add` ops onto the current document.

```ts
interface FormsLoadTemplateRequest {
  templateId: number;
}

type FormsLoadTemplateError = 'invalid_payload' | 'template_not_found' | 'db_unavailable';

interface FormsLoadTemplateValue {
  id: number;
  name: string;
  fields: FormFieldDefinition[];
  /** Restored column mappings, for the mail-merge wizard's auto-pre-population. */
  lastColumnMappings: Record<string, string> | null;
}

type FormsLoadTemplateResponse = Result<FormsLoadTemplateValue, FormsLoadTemplateError>;
```

The renderer's `loadFormTemplateThunk` receives this result, dispatches one `form-design-add` op per field (so each is undoable), and caches `lastColumnMappings` in `mail-merge-slice` for wizard step 3 pre-population.

### 13.9 `forms:runMailMerge`

Execute a mail-merge job. Long-running; streams `mail-merge:progress` events (§13.10).

#### Phase 3.1 amendment (2026-05-22, David — Wave 13.5 H-3.2)

`MailMergeJob` gains an optional `flattenForms?: boolean` field. When `true`,
the runner calls `form.flatten()` on each per-row fill output before writing,
producing non-editable PDFs. Defaults to `false` (unflattened) so Phase 3.0
wire callers that omit the field get unchanged behavior. Mirrors the
"flatten output" checkbox in the wizard's output step (Riley's
`mail-merge-slice.flattenInOutput`). Additive; backwards-compatible.

```ts
interface MailMergeJob {
  jobId: string; // renderer-generated UUID; used to correlate progress events
  templateHandle: DocumentHandle | null; // open document used as template
  templateId: number | null; // OR a saved form-template id (one of templateHandle / templateId must be set)
  dataSource:
    | { kind: 'csv'; bytes: Uint8Array; delimiter?: ',' | ';' | '\t' }
    | { kind: 'xlsx'; bytes: Uint8Array }; // bytes streamed from renderer file-pick
  columnMapping: Record<string /* columnName */, string /* fieldName */>;
  outputMode:
    | { kind: 'folder'; outputFolder: string; filenameTemplate: string } // e.g. "contract-{LastName}-{rowIndex:04}.pdf"
    | { kind: 'concat'; outputFile: string };
  /** Default filenameTemplate is `merged-{rowIndex:04}.pdf` if not supplied. */
  fields: FormFieldDefinition[]; // snapshot of field defs for mapRowToFieldValues; allows coercion
  /** Phase 3.1 (H-3.2): flatten each per-row output. Default false. */
  flattenForms?: boolean;
}

interface FormsRunMailMergeRequest {
  job: MailMergeJob;
}

type FormsRunMailMergeError =
  | 'handle_not_found' // template handle invalid
  | 'template_not_found' // templateId invalid
  | 'invalid_payload' // bad job shape
  | 'data_parse_failed' // csv-parse / exceljs threw
  | 'unmapped_required_field' // required field has no column mapping
  | 'row_fill_failed' // a per-row fillForm errored
  | 'output_path_invalid' // path-sanitizer rejected outputFolder/outputFile
  | 'fs_write_failed' // disk write failed mid-run
  | 'cancelled'; // user fired forms:runMailMerge:cancel

interface FormsRunMailMergeValue {
  jobId: string;
  outputPath: string | null; // null if cancelled in concat mode
  rowsWritten: number;
  totalRows: number;
  wasCancelled: boolean;
  warnings: string[];
}

type FormsRunMailMergeResponse = Result<FormsRunMailMergeValue, FormsRunMailMergeError>;
```

The handler validates payload, then spawns the async runner. The runner streams progress (§13.10) while the response Promise stays pending. Resolves when the runner finishes (success, failure, OR cancel).

### 13.10 `mail-merge:progress` (event stream, main → renderer)

Mirrors `pdf:export:progress` (§7.3). Streams during a `forms:runMailMerge` invocation.

```ts
type MailMergeProgressPhase =
  | 'parsing-data'
  | 'preparing-template'
  | 'rendering-row'
  | 'writing-row'
  | 'finalizing';

interface MailMergeProgressEvent {
  jobId: string;
  phase: MailMergeProgressPhase;
  currentRow: number; // 1-based; 0 during parsing-data / preparing-template
  totalRows: number; // populated after parsing-data; -1 before
  percent: number; // 0-100; monotonic per jobId
  /** Most-recent warning, if any. Accumulator lives in the resulting MailMergeValue. */
  latestWarning?: string;
}
```

Renderer subscribes via `window.pdfApi.events.onMailMergeProgress(handler)` — preload exposes a typed listener registration (mirrors `onExportProgress`). Subscription is per-jobId; the renderer's mail-merge-slice tracks all in-flight jobs.

#### 13.10.1 Cancellation sub-channel

```ts
// Companion to forms:runMailMerge; fired when user clicks Cancel in the progress modal.
interface FormsRunMailMergeCancelRequest {
  jobId: string;
}
type FormsRunMailMergeCancelError = 'job_not_found';
type FormsRunMailMergeCancelResponse = Result<{}, FormsRunMailMergeCancelError>;
```

The cancel handler flips the runner's `cancelRequested` flag for the named job. The runner finishes the current row, then returns the partial result via the original `forms:runMailMerge` response.

### 13.11 `pdf:export` Phase-3 extension (additive)

`PdfExportRequest` (§7.2) gains an optional `flattenForms?: boolean` field. Backwards-compatible: omitting the field preserves Phase 2 behavior (don't flatten).

```ts
interface PdfExportRequest {
  handle: DocumentHandle;
  preference: ExportEnginePreference;
  /** Phase 3 addition: when true, run flattenForms() over the engine output. Default false. */
  flattenForms?: boolean;
}
```

No change to `PdfExportError` or `PdfExportValue`. The engine selector's heuristic for AcroForm-bearing docs (`architecture-phase-2.md §3.8`) is REMOVED in Phase 3 — pdf-lib now preserves AcroForms cleanly, so the auto-Chromium routing for AcroForm presence is dropped. The heuristic for JS-actions remains (still Chromium-biased; pdf-lib strips JS actions).

### 13.12 New `SettingKey`s

Extends `SettingKey` union (§5):

```ts
type SettingKey =
  // ...existing Phase 1 + Phase 2 keys...
  | 'forms.dateLocale' // 'system' | 'en-US' | 'en-GB' | 'ISO' — date input parsing locale; default 'system'
  | 'forms.flattenOnExportDefault' // boolean; default false (export dialog checkbox default state)
  | 'mailMerge.lastOutputFolder' // string; auto-populates wizard step 4 folder picker
  | 'mailMerge.defaultOutputMode'; // 'folder' | 'concat'; default 'folder'

type SettingValue<K extends SettingKey> =
  // ...existing mappings...
  K extends 'forms.dateLocale'
    ? 'system' | 'en-US' | 'en-GB' | 'ISO'
    : K extends 'forms.flattenOnExportDefault'
      ? boolean
      : K extends 'mailMerge.lastOutputFolder'
        ? string
        : K extends 'mailMerge.defaultOutputMode'
          ? 'folder' | 'concat'
          : never;
```

Added to the registry in `data-models.md §2.3 + §8`.

### 13.13 Aggregate `PdfApi` shape — Phase 3 additions

Extends §9.6 + §12.10:

```ts
export interface PdfApi {
  // ...existing Phase 1 + Phase 2 namespaces...
  forms: {
    detect: (req: FormsDetectRequest) => Promise<FormsDetectResponse>;
    fill: (req: FormsFillRequest) => Promise<FormsFillResponse>;
    flatten: (req: FormsFlattenRequest) => Promise<FormsFlattenResponse>;
    designAdd: (req: FormsDesignAddRequest) => Promise<FormsDesignAddResponse>;
    designRemove: (req: FormsDesignRemoveRequest) => Promise<FormsDesignRemoveResponse>;
    listTemplates: (req: FormsListTemplatesRequest) => Promise<FormsListTemplatesResponse>;
    saveTemplate: (req: FormsSaveTemplateRequest) => Promise<FormsSaveTemplateResponse>;
    loadTemplate: (req: FormsLoadTemplateRequest) => Promise<FormsLoadTemplateResponse>;
    runMailMerge: (req: FormsRunMailMergeRequest) => Promise<FormsRunMailMergeResponse>;
    cancelMailMerge: (
      req: FormsRunMailMergeCancelRequest,
    ) => Promise<FormsRunMailMergeCancelResponse>;
  };
  events: {
    // ...existing onExportProgress...
    onMailMergeProgress: (handler: (evt: MailMergeProgressEvent) => void) => () => void; // returns unsubscribe
  };
}
```

### 13.14 Validation responsibilities — unchanged

§10 table still holds for the new channels. Every new handler validates payload with zod, sanitizes paths (output folder/file) through `path-sanitizer.ts`, and returns the discriminated-union `Result`.

Two Phase-3-specific validation rules:

- `forms:designAdd`'s `fieldDefinition.rect` is clamped to page bounds (`max(0, x)` ↦ `min(pageWidth, x + width)` etc). Out-of-bounds coords return `invalid_field_definition` with details.
- `forms:runMailMerge`'s output paths are sanitized BEFORE the runner starts. Cross-volume paths in folder mode produce a warning (folder mode writes per-row atomically; cross-volume rename falls back to copy-then-delete which is slower but still atomic at the file level).

### 13.15 Phase 3 contract freeze point

At end of Wave 11 (this amendment), the Phase-3 contract is locked. Wave 12 implementation must conform; David extends `src/ipc/contracts.ts` to match these types. Any Wave-12 discovery that requires a contract change follows the same Riley-amend-then-David-update protocol as Wave 2 (§11 above).

---

### Phase 4 amendment (2026-05-26, Riley)

The §1-§13 surface above remains FROZEN at Wave 11 (per Phase-4 freeze rule recorded in `docs/architecture-phase-4.md §13`). Phase 4 channels are appended below in §14 as additive-only changes. No Phase-1 / Phase-2 / Phase-3 channel's contract shape changes.

---

## 14. Phase 4 additions (2026-05-26, Riley)

All channels below are NEW in Phase 4. They follow the §0 conventions: discriminated-union `Result<T, E>`, zod-validated payloads, no thrown exceptions across the bridge. Naming convention `<domain>:<verb>` is preserved; new domains are `signatures` and an extension to `annotations`.

> **Sensitive payloads.** §14.1 (`signatures:certLoad`) carries PFX bytes + password. See `docs/conventions.md §15` (new in this wave) for the discipline that handlers MUST follow when these payloads enter main: Buffer-wrap at the earliest synchronous opportunity, explicit `Buffer.fill(0)` in a `finally` block, no logging of the raw payload, no echo over IPC. Wave 17 Julian audits this discipline in detail.

### 14.1 `signatures:certLoad`

Load a PFX/P12 cert blob + password into main-process memory and return an opaque handle. The pfx bytes and password are consumed by the handler and zeroed before it returns. The handle is valid until `signatures:certRelease` is called OR `applyPades` is called with `autoRelease: true` (default).

```ts
interface SignaturesCertLoadRequest {
  pfxBytes: Uint8Array;
  password: string; // CONSUMED; main converts to Buffer + zeroes immediately
}

type SignaturesCertLoadError =
  | 'invalid_payload'
  | 'pfx_decode_failed'
  | 'pfx_no_private_key'
  | 'pfx_no_cert'
  | 'wrong_password';

interface SignaturesCertLoadValue {
  handle: string; // opaque UUID v4; treat as opaque
  subjectCN: string; // for display
  issuerCN: string; // for display
  notBefore: number; // ms epoch
  notAfter: number; // ms epoch
  fingerprint: string; // SHA-256 hex of the cert
  isExpired: boolean; // already evaluated against system clock
}

type SignaturesCertLoadResponse = Result<SignaturesCertLoadValue, SignaturesCertLoadError>;
```

**Handler discipline:** the handler MUST Buffer-wrap `password` BEFORE any await, MUST drop the JS string reference (set local + parsed payload field to `''`), MUST pass the Buffer to `cert-store.loadCert` which zeroes it in a `finally` block. The handler MUST log channel + duration + ok/error variant ONLY — no payload reflection. See `docs/signature-engine.md §4.2` for the full flow.

### 14.2 `signatures:certRelease`

Explicitly release a cert handle. Idempotent. Renderer fires this on modal close.

```ts
interface SignaturesCertReleaseRequest {
  handle: string;
}

type SignaturesCertReleaseError = 'invalid_payload';

interface SignaturesCertReleaseValue {
  released: boolean; // true if the handle existed and was released; false if already gone
}

type SignaturesCertReleaseResponse = Result<SignaturesCertReleaseValue, SignaturesCertReleaseError>;
```

### 14.3 `signatures:applyVisual`

Apply a visual signature (typed/drawn/image) to a placeholder field OR a freeform position. No cert involved; appearance-only.

```ts
type SignaturePlacementMode = 'placeholder' | 'freeform';

interface SignaturePlacement {
  mode: SignaturePlacementMode;
  fieldName?: string; // when mode='placeholder'
  pageIndex?: number; // when mode='freeform'
  rect?: PdfRect; // when mode='freeform'; PDF user-space
  rotation?: 0 | 90 | 180 | 270; // optional
}

type VisualAppearanceSource =
  | {
      kind: 'typed';
      name: string;
      fontFamily?: string;
      fontSize?: number;
      pngBytes: Uint8Array;
      widthPx: number;
      heightPx: number;
    }
  | { kind: 'drawn'; pngBytes: Uint8Array; widthPx: number; heightPx: number }
  | {
      kind: 'image';
      bytes: Uint8Array;
      mimeType: 'image/png' | 'image/jpeg';
      widthPx: number;
      heightPx: number;
    };

interface VisualAppearanceSpec {
  source: VisualAppearanceSource;
  showName: boolean;
  showDate: boolean;
  showReason: boolean;
  showSubjectCN: boolean; // always false for visual; included for type symmetry
  showIssuerCN: boolean; // always false for visual
  showTsaInfo: boolean; // always false for visual
  reason?: string;
}

interface SignaturesApplyVisualRequest {
  handle: DocumentHandle;
  placement: SignaturePlacement;
  appearance: VisualAppearanceSpec;
}

type SignaturesApplyVisualError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'placeholder_field_not_found'
  | 'placeholder_field_already_signed'
  | 'invalid_placement'
  | 'appearance_compose_failed'
  | 'serialize_failed';

interface SignaturesApplyVisualValue {
  op: EditOperationSerialized; // kind: 'signature-visual-place'
  warnings: string[];
}

type SignaturesApplyVisualResponse = Result<SignaturesApplyVisualValue, SignaturesApplyVisualError>;
```

### 14.4 `signatures:applyPades`

Apply a PAdES cryptographic signature. Long-running if TSA is enabled (≤30s). Records an audit log row.

```ts
interface PadesAppearanceSpec extends VisualAppearanceSpec {
  showSubjectCN: boolean; // default true for PAdES
  showIssuerCN: boolean; // default false
  showTsaInfo: boolean; // default false
}

interface SignaturesApplyPadesRequest {
  handle: DocumentHandle;
  placement: SignaturePlacement;
  certHandle: string; // from signatures:certLoad
  appearance: PadesAppearanceSpec;
  tsaUrl: string | null; // null = no TSA; non-null = attempt TSA (fail-loud on TSA failure)
  reason?: string;
  location?: string;
  placeholderSize?: number; // /Contents hex placeholder size; default 16384; raise if cert chain is large
  autoRelease?: boolean; // release certHandle on completion; default true
}

type SignaturesApplyPadesError =
  | 'handle_not_found' // DocumentHandle
  | 'cert_handle_not_found'
  | 'cert_expired'
  | 'cert_not_yet_valid'
  | 'invalid_payload'
  | 'placeholder_field_not_found'
  | 'placeholder_field_already_signed'
  | 'invalid_placement'
  | 'appearance_compose_failed'
  | 'pades_sign_failed'
  | 'pades_byte_range_failed'
  | 'pades_placeholder_too_small'
  | 'pades_invalidated_by_subsequent_edit'
  | 'tsa_http_error'
  | 'tsa_tls_error'
  | 'tsa_timeout'
  | 'tsa_invalid_response'
  | 'tsa_nonce_mismatch'
  | 'tsa_genTime_skew'
  | 'serialize_failed'
  | 'audit_log_failed';

interface SignaturesApplyPadesValue {
  op: EditOperationSerialized; // kind: 'signature-pades-applied'
  auditLogRowId: number; // newly inserted row in signature_audit_log
  signerSubjectCN: string;
  certFingerprint: string;
  signedAt: number; // ms epoch from the engine
  tsaResponseStatus: 'ok' | 'failed' | null;
  warnings: string[];
}

type SignaturesApplyPadesResponse = Result<SignaturesApplyPadesValue, SignaturesApplyPadesError>;
```

### 14.5 `signatures:requestTimestamp`

Standalone TSA request. Used internally by `applyPades`; also exposed for the Settings "Test TSA URL" affordance.

```ts
interface SignaturesRequestTimestampRequest {
  tsaUrl: string; // https://...
  hash: Uint8Array; // 32 bytes (sha256)
  timeoutMs?: number; // default 30000
}

type SignaturesRequestTimestampError =
  | 'invalid_payload'
  | 'tsa_http_error'
  | 'tsa_tls_error'
  | 'tsa_timeout'
  | 'tsa_invalid_response'
  | 'tsa_nonce_mismatch'
  | 'tsa_genTime_skew';

interface SignaturesRequestTimestampValue {
  tsrBytes: Uint8Array; // TimeStampResp DER
  tsTokenBytes: Uint8Array; // TimeStampToken DER (inner content)
  genTime: number; // ms epoch
  serialNumber: string; // decimal stringified bigint
}

type SignaturesRequestTimestampResponse = Result<
  SignaturesRequestTimestampValue,
  SignaturesRequestTimestampError
>;
```

### 14.6 `signatures:verify`

Verify a signature applied BY THIS APP. Re-hashes the current bytes over the byte-range from the audit row and compares to the messageDigest in the CMS envelope. NOT a third-party signature verifier (Phase 4.1+).

```ts
interface SignaturesVerifyRequest {
  handle: DocumentHandle;
  auditLogRowId: number;
}

type SignaturesVerifyError =
  | 'handle_not_found'
  | 'invalid_payload'
  | 'audit_row_not_found'
  | 'signature_not_in_document'
  | 'verify_failed';

interface SignaturesVerifyValue {
  valid: boolean; // hash matches
  tamperedSinceSign: boolean; // doc_hash from audit row !== sha256(current bytes)
  certInfo: {
    fingerprint: string;
    subjectCN: string;
    issuerCN: string;
    notBefore: number;
    notAfter: number;
    isExpiredNow: boolean;
  };
  tsaInfo: {
    tsaUrl: string;
    genTime: number;
    valid: boolean;
  } | null;
}

type SignaturesVerifyResponse = Result<SignaturesVerifyValue, SignaturesVerifyError>;
```

### 14.7 `signatures:listAudit`

List rows from `signature_audit_log` with optional filters.

```ts
interface SignaturesListAuditRequest {
  fileHash?: string; // filter by doc_hash OR pre_sign_doc_hash
  signedByFingerprint?: string;
  since?: number; // ms epoch
  until?: number; // ms epoch
  limit?: number; // default 100
  offset?: number; // default 0
}

interface SignatureAuditItem {
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
  sigBytesOffset: number | null; // null for visual signatures
  sigBytesLength: number | null;
  byteRange: number[] | null;
  reason: string | null;
  location: string | null;
  fieldName: string | null;
  createdAt: number;
}

type SignaturesListAuditError = 'invalid_payload' | 'db_unavailable';

interface SignaturesListAuditValue {
  items: SignatureAuditItem[];
  total: number; // total matching rows (for pagination)
}

type SignaturesListAuditResponse = Result<SignaturesListAuditValue, SignaturesListAuditError>;
```

### 14.8 `annotations:addShape`

Author one of the new Phase-4 shape / line / callout / measure annotations. Returns an EditOperation per the standard Phase 1+2 annotation pattern.

```ts
type ShapeAnnotationSubtype =
  | 'Square' // rectangle
  | 'Circle' // ellipse
  | 'Polygon' // closed polygon
  | 'PolyLine' // open polyline
  | 'Line' // straight line (used for arrows + line-measure)
  | 'FreeTextCallout'; // /FreeText with /IT FreeTextCallout

interface ShapeAnnotationModel {
  id: string; // UUID v4
  pageIndex: number;
  subtype: ShapeAnnotationSubtype;
  rect: PdfRect;
  color: RgbColor;
  opacity: number; // 0..1
  borderWidth: number; // pt
  borderStyle: 'solid' | 'dashed' | 'dotted';
  fillColor?: RgbColor; // for Square/Circle/Polygon when fillEnabled
  fillEnabled?: boolean;
  // For Polygon/PolyLine:
  vertices?: number[]; // [x1, y1, x2, y2, ...] in PDF user-space
  // For Line:
  lineStart?: { x: number; y: number };
  lineEnd?: { x: number; y: number };
  lineStartStyle?: 'None' | 'Butt' | 'OpenArrow' | 'ClosedArrow';
  lineEndStyle?: 'None' | 'Butt' | 'OpenArrow' | 'ClosedArrow';
  // For FreeTextCallout:
  calloutText?: string;
  calloutPointer?: { x: number; y: number }; // PDF user-space; the /CL array's tip
  fontSize?: number;
  fontFamily?: string;
  // For Line/PolyLine with measure:
  measure?: {
    unit: 'inch' | 'cm' | 'mm' | 'pt' | 'px' | 'custom';
    customUnitLabel?: string; // when unit='custom'
    scale: number; // 1 page-unit = N <unit>
  };
  author?: string;
  createdAt: number;
  modifiedAt: number;
  contents?: string; // /Contents text for popup
}

interface AnnotationsAddShapeRequest {
  handle: DocumentHandle;
  annotation: ShapeAnnotationModel;
}

type AnnotationsAddShapeError = 'handle_not_found' | 'invalid_payload' | 'out_of_range'; // pageIndex / rect out of bounds

interface AnnotationsAddShapeValue {
  op: EditOperationSerialized; // kind: 'annot-add-shape'
  warnings: string[];
}

type AnnotationsAddShapeResponse = Result<AnnotationsAddShapeValue, AnnotationsAddShapeError>;
```

### 14.9 `annotations:setMeasureCalibration` + `annotations:getMeasureCalibration`

Per-document measure calibration. Stored in main memory for the handle's lifetime; serialized into the PDF's first existing measure annotation's `/Measure` dict on save (or the doc's `/MediaBox`-attached calibration on the first measure-bearing page).

```ts
interface MeasureCalibration {
  /** 1 PDF user-space unit = N <unit> in the real-world drawing. */
  unit: 'inch' | 'cm' | 'mm' | 'pt' | 'px' | 'custom';
  customUnitLabel?: string;
  scale: number;
}

interface AnnotationsSetMeasureCalibrationRequest {
  handle: DocumentHandle;
  calibration: MeasureCalibration;
}

type AnnotationsSetMeasureCalibrationError = 'handle_not_found' | 'invalid_payload';

type AnnotationsSetMeasureCalibrationResponse = Result<{}, AnnotationsSetMeasureCalibrationError>;

interface AnnotationsGetMeasureCalibrationRequest {
  handle: DocumentHandle;
}

type AnnotationsGetMeasureCalibrationError = 'handle_not_found';

interface AnnotationsGetMeasureCalibrationValue {
  calibration: MeasureCalibration | null; // null if not yet calibrated
}

type AnnotationsGetMeasureCalibrationResponse = Result<
  AnnotationsGetMeasureCalibrationValue,
  AnnotationsGetMeasureCalibrationError
>;
```

### 14.10 New `SettingKey`s

Extends `SettingKey` union (§5):

```ts
type SettingKey =
  // ...existing Phase 1 + 2 + 3 keys...
  | 'signatures.tsaUrl' // string; default ''
  | 'signatures.tsaEnabled' // boolean; default false
  | 'signatures.tsaTimeoutMs' // number; default 30000
  | 'signatures.placeholderSize' // number (/Contents hex chars); default 16384
  | 'signatures.defaultShowDate' // boolean; default true
  | 'signatures.defaultShowSubjectCN' // boolean; default true (PAdES only)
  | 'signatures.padesEngine' // 'signpdf' | 'manual'; default 'signpdf' (Phase 4.1 toggle)
  | 'annotations.defaultBorderWidth' // number, pt; default 1
  | 'annotations.defaultBorderStyle' // 'solid' | 'dashed' | 'dotted'; default 'solid'
  | 'annotations.defaultFillEnabled' // boolean; default false
  | 'annotations.defaultLineEndStyle'; // 'None' | 'OpenArrow' | 'ClosedArrow'; default 'OpenArrow' (arrow tool)

type SettingValue<K extends SettingKey> =
  // ...existing mappings...
  K extends 'signatures.tsaUrl'
    ? string
    : K extends 'signatures.tsaEnabled'
      ? boolean
      : K extends 'signatures.tsaTimeoutMs'
        ? number
        : K extends 'signatures.placeholderSize'
          ? number
          : K extends 'signatures.defaultShowDate'
            ? boolean
            : K extends 'signatures.defaultShowSubjectCN'
              ? boolean
              : K extends 'signatures.padesEngine'
                ? 'signpdf' | 'manual'
                : K extends 'annotations.defaultBorderWidth'
                  ? number
                  : K extends 'annotations.defaultBorderStyle'
                    ? 'solid' | 'dashed' | 'dotted'
                    : K extends 'annotations.defaultFillEnabled'
                      ? boolean
                      : K extends 'annotations.defaultLineEndStyle'
                        ? 'None' | 'OpenArrow' | 'ClosedArrow'
                        : never;
```

Added to the registry in `data-models.md §2.3` via the Phase-4 amendment in `data-models.md §9`.

### 14.11 Aggregate `PdfApi` shape — Phase 4 additions

Extends §9.6 + §12.10 + §13.13:

```ts
export interface PdfApi {
  // ...existing Phase 1 + 2 + 3 namespaces...

  signatures: {
    certLoad: (req: SignaturesCertLoadRequest) => Promise<SignaturesCertLoadResponse>;
    certRelease: (req: SignaturesCertReleaseRequest) => Promise<SignaturesCertReleaseResponse>;
    applyVisual: (req: SignaturesApplyVisualRequest) => Promise<SignaturesApplyVisualResponse>;
    applyPades: (req: SignaturesApplyPadesRequest) => Promise<SignaturesApplyPadesResponse>;
    requestTimestamp: (
      req: SignaturesRequestTimestampRequest,
    ) => Promise<SignaturesRequestTimestampResponse>;
    verify: (req: SignaturesVerifyRequest) => Promise<SignaturesVerifyResponse>;
    listAudit: (req: SignaturesListAuditRequest) => Promise<SignaturesListAuditResponse>;
  };

  annotations: {
    addShape: (req: AnnotationsAddShapeRequest) => Promise<AnnotationsAddShapeResponse>;
    setMeasureCalibration: (
      req: AnnotationsSetMeasureCalibrationRequest,
    ) => Promise<AnnotationsSetMeasureCalibrationResponse>;
    getMeasureCalibration: (
      req: AnnotationsGetMeasureCalibrationRequest,
    ) => Promise<AnnotationsGetMeasureCalibrationResponse>;
  };
}
```

### 14.12 Validation responsibilities — extends §10

§10 table still holds for the new channels. Every new handler validates payload with zod, returns the discriminated-union `Result`. **Two Phase-4-specific validation rules:**

- `signatures:certLoad`'s `password` field is wrapped in a `Buffer` at the EARLIEST synchronous point in the handler (within ≤5 lines of the validated payload destructuring), and the JS string reference is overwritten to `''`. See `docs/conventions.md §15` (new in this wave) for the discipline.
- `signatures:applyPades`'s `tsaUrl` is validated by zod as `string.url()` AND additionally checked at runtime: must be `https://`, must have no userinfo (no `user:pass@`), no fragment (no `#`), and either no query OR only a small allowlisted set of query params (none mandatory). Failed URLs return `invalid_payload`.

### 14.13 Phase 4 contract freeze point

At end of Wave 15 (this amendment), the Phase-4 contract is locked. Wave 16 implementation must conform; David extends `src/ipc/contracts.ts` to match these types. Any Wave-16 discovery that requires a contract change follows the same Riley-amend-then-David-update protocol as Wave 2 (§11 above).

---

## 15. Phase 4.1 additions (2026-05-26, David)

### Phase 4.1 amendment (2026-05-26, David)

This section is **additive** to §§1-14. Phase 4.1 ships a single new IPC channel — `fs:readBytesByHandle` — that supplies the renderer with the validated document bytes already held in main's `documentStore`, so pdf.js can render pages + thumbnails. The motivating bug: `src/client/services/pdf-render.ts` was a Wave-2 stub for 14 waves; the renderer needed a way to fetch document bytes without re-reading from disk (which would require exposing paths to the renderer — a §13 trust-boundary violation per Hard-Won Playbook entry #15).

### 15.1 `fs:readBytesByHandle`

**Channel name:** `fs:readBytesByHandle`

**Direction:** Renderer → Main (invoke / response).

**Request:**

```ts
interface FsReadBytesByHandleRequest {
  handle: DocumentHandle; // positive integer, minted by dialog:openPdf / fs:readPdf
}
```

**Response:**

```ts
type FsReadBytesByHandleError =
  | 'unknown_handle' // handle was never registered (or already closed)
  | 'document_evicted' // handle is registered but bytes are gone (future LRU)
  | 'fs_read_failed'; // reserved for future on-disk-backed handles

interface FsReadBytesByHandleValue {
  bytes: Uint8Array;
}

type FsReadBytesByHandleResponse = Result<FsReadBytesByHandleValue, FsReadBytesByHandleError>;
```

**Behavior:**

- Looks up the document record in main's `documentStore` by handle.
- Returns the stored bytes verbatim. Bytes are validated AT OPEN TIME by `dialog:openPdf` / `fs:readPdf` (sanitizePath + statFile + size cap + %PDF- header sniff via `loadPdfMetadata`). They are NOT re-validated on each read.
- The response bytes cross via Electron's structured clone — the underlying `ArrayBuffer` is copied, so renderer mutations cannot affect main's copy.

**Security:**

- No path is accepted from the renderer. Trust derives from the integer `handle`, a process-local opaque identifier minted by `documentStore.register` after the open-time validation chain.
- The handler does NOT return the document's filesystem path. The renderer cannot escalate to disk through this channel.
- Payload validation via zod (`safeParse`); same discipline as `signatures:certLoad`.

**Performance:**

- One-shot copy per call (Electron structured clone). Acceptable per the 500 MB max-file-size cap.
- Phase 5 may add a streaming variant or an LRU eviction policy; reserved error variant `document_evicted` already exists for the LRU case.

### 15.2 Aggregate `PdfApi` shape — Phase 4.1 addition

```ts
export interface PdfApi {
  // ... §§1-14 unchanged ...
  fs: {
    // ... existing fs:* members unchanged ...
    readBytesByHandle: (req: FsReadBytesByHandleRequest) => Promise<FsReadBytesByHandleResponse>;
  };
}
```

### 15.3 Validation responsibilities

Same as §10 / §14.12 — the handler validates the payload with zod and returns the discriminated-union `Result`. No special-case rules beyond the integer-positive constraint on `handle`.

### 15.4 Phase 4.1 contract freeze point

Phase 4.1 is a single-channel additive cleanup. The contract is frozen on this amendment; Riley's renderer `pdf-render.ts` implementation consumes `window.pdfApi.fs.readBytesByHandle({ handle })` directly. No follow-up amendments anticipated.

---

### Phase 5 amendment (2026-05-27, Riley)

The §1-§15 surface above remains FROZEN at Wave 15 / Wave 17.1 (per Phase-5 freeze rule recorded in `docs/architecture-phase-5.md §14`). Phase 5 channels are appended below in §16 as additive-only changes. No Phase-1 / Phase-2 / Phase-3 / Phase-4 / Phase-4.1 channel's contract shape changes.

---

## 16. Phase 5 additions (2026-05-27, Riley)

All channels below are NEW in Phase 5. They follow the §0 conventions: discriminated-union `Result<T, E>`, zod-validated payloads, no thrown exceptions across the bridge. Naming convention `<domain>:<verb>` is preserved; new domains are `ocr` and `scan` (the latter ships as Phase 5.1 placeholder handlers).

> **No secrets in Phase 5.** Unlike Phase 4's `signatures:certLoad` (which carries PFX bytes + password), the Phase 5 IPC surface carries no cryptographic material. The boundary discipline of conventions §16 (new in this wave) is about **bytes-stay-in-main** and **OCR-output-trust-floor**, not secret-zeroing. Wave 21 Julian audits the bytes-stay-in-main discipline; the cert-store-style finally/fill(0) pattern does not apply here.

### 16.1 `ocr:detectLanguages`

List installed + downloadable language packs. Renderer calls this on OCR modal open to populate the language picker.

```ts
type OcrLanguagePackSource = 'bundled' | 'downloaded';

interface LanguagePack {
  lang: string; // ISO 639-2/3-letter code (e.g. 'eng', 'spa', 'chi_sim')
  displayName: string; // 'English', 'Spanish', 'Chinese (Simplified)'
  source: OcrLanguagePackSource;
  sizeBytes: number;
  sha256: string;
  installedAt: number; // ms epoch
  lastUsedAt: number | null;
}

interface LanguagePackCatalogEntry {
  lang: string;
  displayName: string;
  sizeBytes: number;
  sha256: string;
  // No `source` field — these are NOT installed; downloadable from upstream.
}

interface OcrDetectLanguagesRequest {
  /* empty body */
}

type OcrDetectLanguagesError = 'catalog_load_failed';

interface OcrDetectLanguagesValue {
  installed: LanguagePack[];
  downloadable: LanguagePackCatalogEntry[];
  defaultLang: string; // current value of setting `ocr.defaultLang`, e.g. 'eng'
}

type OcrDetectLanguagesResponse = Result<OcrDetectLanguagesValue, OcrDetectLanguagesError>;
```

### 16.2 `ocr:runOnPage`

Run OCR on a SINGLE page of the currently-open document. Short-running (≤30s typical); no progress events. Used by the "re-OCR this page" affordance (Phase 5.2 candidate; the contract reserves the channel so Wave 20 can prototype without a re-amend).

```ts
interface PreprocessOptions {
  deskew: boolean;
  denoise: boolean;
  contrastBoost: boolean;
}

interface OcrRunOnPageRequest {
  handle: DocumentHandle;
  pageIndex: number;
  langs: string[]; // one OR more; engine joins with '+' for tesseract.js multi-lang
  preprocess: PreprocessOptions;
  invalidatesSignaturesConfirmed?: boolean; // required true if the doc has prior PAdES signatures
}

type OcrRunOnPageError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_out_of_range'
  | 'language_pack_not_installed'
  | 'signed_pdf_requires_confirm' // doc has prior PAdES signatures and confirm flag is false
  | 'pdf_render_failed' // pdf.js rasterize failed for this page
  | 'ocr_engine_failed' // tesseract.js internal failure
  | 'worker_watchdog_timeout'; // per-page watchdog fired (R-W19-D)

interface OcrRunOnPageValue {
  pageResult: OcrPageResult; // see data-models.md §10.6
  durationMs: number;
}

type OcrRunOnPageResponse = Result<OcrRunOnPageValue, OcrRunOnPageError>;
```

### 16.3 `ocr:runOnDocument`

Run OCR on a page range. Long-running; emits `ocr:progress` event stream. Returns the `EditOperationSerialized` plus the job summary.

```ts
interface OcrRunOnDocumentRequest {
  handle: DocumentHandle;
  pageRange: { start: number; end: number }; // inclusive; start <= end < doc.pageCount
  langs: string[];
  preprocess: PreprocessOptions;
  invalidatesSignaturesConfirmed?: boolean;
}

type OcrRunOnDocumentError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'language_pack_not_installed'
  | 'signed_pdf_requires_confirm'
  | 'ocr_engine_failed'
  | 'output_serialize_failed'
  | 'cancelled'; // job was cancelled by user; partial output discarded

interface OcrRunOnDocumentValue {
  jobId: number; // FK to ocr_jobs.id
  summary: OcrJobSummary; // see data-models.md §10.7
  op: EditOperationSerialized; // kind: 'ocr-text-behind-applied'
}

type OcrRunOnDocumentResponse = Result<OcrRunOnDocumentValue, OcrRunOnDocumentError>;
```

**Event stream — `ocr:progress`:** see §16.4 below.

### 16.4 `ocr:progress` (event stream, main → renderer)

Emitted during `ocr:runOnDocument`. Follows the existing Phase 3 `mail-merge:progress` pattern.

```ts
type OcrProgressEvent =
  | { jobId: number; phase: 'starting'; totalPages: number }
  | { jobId: number; phase: 'rasterizing'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'preprocessing'; pageIndex: number; totalPages: number }
  | {
      jobId: number;
      phase: 'recognizing';
      pageIndex: number;
      totalPages: number;
      confidenceSoFar: number | null;
    }
  | { jobId: number; phase: 'composing-text-behind-image'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'writing-output'; pageIndex: number; totalPages: number }
  | { jobId: number; phase: 'completed'; summary: OcrJobSummary }
  | { jobId: number; phase: 'cancelled'; pagesCompleted: number; totalPages: number }
  | { jobId: number; phase: 'failed'; pagesCompleted: number; totalPages: number; error: string };
```

Subscribe via `window.pdfApi.ocr.onProgress((event) => { ... })`. Returns an unsubscribe function. The handler MUST debounce + throttle to ≤ 10 events/sec per `phase: 'recognizing'` page to avoid renderer-side rerender storms.

### 16.5 `ocr:cancelJob`

Cancel an in-flight OCR job. Idempotent.

```ts
interface OcrCancelJobRequest {
  jobId: number;
}

type OcrCancelJobError = 'invalid_payload' | 'job_not_found' | 'job_already_terminal'; // already completed / cancelled / failed

interface OcrCancelJobValue {
  cancelled: boolean; // true if a running job was cancelled; false if it was already terminal
  pagesCompleted: number;
}

type OcrCancelJobResponse = Result<OcrCancelJobValue, OcrCancelJobError>;
```

### 16.6 `ocr:listJobs`

List rows from `ocr_jobs` (for the debugging / audit panel — Phase 5.2 candidate; ships in Phase 5 for completeness).

```ts
interface OcrListJobsRequest {
  filters?: {
    docHash?: string;
    status?: OcrJobStatus; // 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'superseded_by_undo'
    since?: number;
    until?: number;
  };
  limit?: number; // default 100, max 1000
  offset?: number;
}

type OcrListJobsError = 'invalid_payload';

interface OcrListJobsValue {
  jobs: OcrJobRowDto[]; // see data-models.md §10.5
  total: number;
}

type OcrListJobsResponse = Result<OcrListJobsValue, OcrListJobsError>;
```

### 16.7 `ocr:languagePackDownload`

Download a language pack from the upstream tessdata mirror. Verifies SHA-256 against the shipped catalog. Long-running; emits `ocr:languagePackDownload:progress` events.

```ts
interface OcrLanguagePackDownloadRequest {
  lang: string; // catalog code, e.g. 'spa'
}

type OcrLanguagePackDownloadError =
  | 'invalid_payload'
  | 'lang_not_in_catalog' // unknown lang code
  | 'pack_already_installed'
  | 'network_error'
  | 'pack_integrity_failed' // SHA-256 mismatch
  | 'disk_write_failed'
  | 'cancelled';

interface OcrLanguagePackDownloadValue {
  pack: LanguagePack; // newly installed
}

type OcrLanguagePackDownloadResponse = Result<
  OcrLanguagePackDownloadValue,
  OcrLanguagePackDownloadError
>;
```

**Event stream — `ocr:languagePackDownload:progress`:**

```ts
type OcrLanguagePackDownloadProgressEvent =
  | { lang: string; phase: 'starting'; totalBytes: number }
  | { lang: string; phase: 'downloading'; bytesDownloaded: number; totalBytes: number }
  | { lang: string; phase: 'verifying' }
  | { lang: string; phase: 'completed'; pack: LanguagePack }
  | { lang: string; phase: 'cancelled' }
  | { lang: string; phase: 'failed'; error: string };
```

Subscribe via `window.pdfApi.ocr.onLanguagePackDownloadProgress((event) => { ... })`.

### 16.8 `ocr:languagePackRemove`

Remove a previously-downloaded pack. Refuses to remove the bundled `eng` pack.

```ts
interface OcrLanguagePackRemoveRequest {
  lang: string;
}

type OcrLanguagePackRemoveError =
  | 'invalid_payload'
  | 'pack_not_installed'
  | 'cannot_remove_bundled' // bundled `eng` cannot be removed
  | 'disk_unlink_failed';

interface OcrLanguagePackRemoveValue {
  removed: boolean;
}

type OcrLanguagePackRemoveResponse = Result<OcrLanguagePackRemoveValue, OcrLanguagePackRemoveError>;
```

### 16.9 `scan:listDevices` — Phase 5.1 placeholder

Per `architecture-phase-5.md §7` Q-E deferral. The contract is reserved so Phase 5.1 is additive. Phase 5 handler returns `Result<never, 'not_implemented_phase_5_1'>` (same Phase-1 pattern as `app:pickPdfPath`).

```ts
interface ScanListDevicesRequest {
  /* empty body */
}

type ScanListDevicesError = 'not_implemented_phase_5_1';

// In Phase 5.1, the value shape will be:
//   interface ScanDevice { id: string; name: string; capabilities: ScanCapabilities; }
//   interface ScanListDevicesValue { devices: ScanDevice[] }
// Phase 5 ships only the error variant; renderer-side typings reflect that.

type ScanListDevicesResponse = Result<never, ScanListDevicesError>;
```

### 16.10 `scan:acquire` — Phase 5.1 placeholder

Same pattern as §16.9.

```ts
interface ScanAcquireRequest {
  deviceId?: string; // optional in Phase 5.1; ignored in Phase 5 placeholder
  resolution?: number;
  colorMode?: 'bw' | 'grayscale' | 'color';
  // ... full shape filled in Phase 5.1 design wave
}

type ScanAcquireError = 'not_implemented_phase_5_1';

type ScanAcquireResponse = Result<never, ScanAcquireError>;
```

### 16.11 New `SettingKey`s

Eleven new keys added to the existing `settings` table (Phase 1 §5 / Phase 2 §12.9 / Phase 3 §13.12 / Phase 4 §14.10 pattern):

| Key                                   | Type    | Default | Validation                                    |
| ------------------------------------- | ------- | ------- | --------------------------------------------- |
| `ocr.defaultLang`                     | string  | `'eng'` | one of installed pack langs                   |
| `ocr.lowConfidenceThreshold`          | number  | `60`    | 0..100                                        |
| `ocr.rasterDpi`                       | number  | `300`   | 72..600                                       |
| `ocr.maxConcurrentLanguages`          | number  | `4`     | 1..8                                          |
| `ocr.workerWatchdogSec`               | number  | `60`    | 10..600                                       |
| `ocr.preprocess.deskew`               | boolean | `true`  | —                                             |
| `ocr.preprocess.denoise`              | boolean | `false` | —                                             |
| `ocr.preprocess.contrastBoost`        | boolean | `false` | —                                             |
| `ocr.denoise.kernel`                  | number  | `3`     | odd, 3..9                                     |
| `ocr.showConfidenceOverlayByDefault`  | boolean | `false` | —                                             |
| `ocr.confirmInvalidateSignaturesOnce` | boolean | `false` | "don't ask me again" toggle for the §6 prompt |

### 16.12 Aggregate `PdfApi` shape — Phase 5 additions

```ts
export interface PdfApi {
  // ... §§1-15 unchanged ...
  ocr: {
    detectLanguages: (req: OcrDetectLanguagesRequest) => Promise<OcrDetectLanguagesResponse>;
    runOnPage: (req: OcrRunOnPageRequest) => Promise<OcrRunOnPageResponse>;
    runOnDocument: (req: OcrRunOnDocumentRequest) => Promise<OcrRunOnDocumentResponse>;
    cancelJob: (req: OcrCancelJobRequest) => Promise<OcrCancelJobResponse>;
    listJobs: (req: OcrListJobsRequest) => Promise<OcrListJobsResponse>;
    languagePackDownload: (
      req: OcrLanguagePackDownloadRequest,
    ) => Promise<OcrLanguagePackDownloadResponse>;
    languagePackRemove: (
      req: OcrLanguagePackRemoveRequest,
    ) => Promise<OcrLanguagePackRemoveResponse>;
    onProgress: (handler: (event: OcrProgressEvent) => void) => () => void;
    onLanguagePackDownloadProgress: (
      handler: (event: OcrLanguagePackDownloadProgressEvent) => void,
    ) => () => void;
  };
  scan: {
    listDevices: (req: ScanListDevicesRequest) => Promise<ScanListDevicesResponse>;
    acquire: (req: ScanAcquireRequest) => Promise<ScanAcquireResponse>;
  };
}
```

### 16.13 Validation responsibilities — extends §10 / §14.12

In addition to the standard §10 rules, Phase 5 handlers MUST:

- Validate `pageRange.start <= pageRange.end < doc.pageCount` before any rasterization.
- Validate `langs` array — each element must match `/^[a-z]{3}(_[a-z]+)?$/i` AND must be in either `installed` OR `downloadable` catalog.
- For `signed_pdf_requires_confirm` flow, the handler must NOT begin rasterization until the confirm flag is true; the pre-flight runs before any expensive op.
- For `ocr:languagePackDownload`, verify the SHA-256 BEFORE inserting the `language_packs` row.
- For `scan:*` Phase 5.1 placeholder handlers, return `Result<never, 'not_implemented_phase_5_1'>` exactly; the renderer can pattern-match on this variant to render the disabled menu tooltip.

### 16.14 Phase 5 contract freeze point

At end of Wave 19 (this amendment), the Phase-5 contract is locked. Wave 20 implementation must conform; David extends `src/ipc/contracts.ts` to match these types. Any Wave-20 discovery that requires a contract change follows the same Riley-amend-then-David-update protocol as Wave 2 (§11) / Wave 11 / Wave 15. The `scan:*` placeholder handlers are NOT considered open for Phase 5.1 design until that wave opens.

---

## 17. Phase 6 additions (2026-05-27, Riley)

> ### Phase 6 amendment (2026-05-27, Riley)
>
> §1-§16 above remain authoritative for Phase 1-5 surfaces. Additions below extend the IPC surface with eight new channels for the Export to Office feature set (PDF → docx / xlsx / pptx / png / jpeg / tiff). Naming convention `<domain>:<verb>` is preserved; new domain is `export`. The Phase 1-5 contract is frozen — no existing channel's request/response shape changes.

All channels below are NEW in Phase 6. They follow the §0 conventions: discriminated-union `Result<T, E>`, zod-validated payloads, no thrown exceptions across the bridge.

> **No secrets in Phase 6.** Like Phase 5 (and unlike Phase 4's `signatures:certLoad`), the Phase 6 IPC surface carries no cryptographic material. The boundary discipline of conventions §17 (new in this wave) is about **export-bytes-stay-in-main** + **read-only-on-source-PDF**.

### 17.1 `export:toDocx`

Run a PDF → Word (.docx) export job. Long-running; emits `export:progress` events. Returns the `ExportJobSummary` on completion.

```ts
type ExportQualityTier = 'text-only' | 'layout-preserving';

interface ExportToDocxRequest {
  handle: DocumentHandle;
  pageRange: { start: number; end: number }; // inclusive; start <= end < doc.pageCount
  qualityTier: ExportQualityTier;
  includeAnnotations: boolean;
  pageSize: 'letter' | 'a4' | 'auto'; // 'auto' = use source page size
  outputPath: string; // absolute path; main validates writability
}

type ExportToDocxError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable' // path not writable / locked by another process
  | 'queue_full' // queue at `export.maxQueueSize`
  | 'extraction_failed' // pdf.js / pdf-lib error during text/operator extraction
  | 'writer_failed' // docx library error during compose
  | 'output_write_failed' // fs error during atomic write
  | 'cancelled';

interface ExportToDocxValue {
  jobId: number; // FK to export_jobs.id
  summary: ExportJobSummary; // see data-models.md §11.5
}

type ExportToDocxResponse = Result<ExportToDocxValue, ExportToDocxError>;
```

### 17.2 `export:toXlsx`

Run a PDF → Excel (.xlsx) export job. Long-running.

```ts
interface ExportToXlsxRequest {
  handle: DocumentHandle;
  pageRange: { start: number; end: number };
  qualityTier: ExportQualityTier;
  includeAnnotations: boolean; // default false; modal default is false for xlsx
  outputPath: string;
}

type ExportToXlsxError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable'
  | 'queue_full'
  | 'extraction_failed'
  | 'writer_failed'
  | 'output_write_failed'
  | 'cancelled';

interface ExportToXlsxValue {
  jobId: number;
  summary: ExportJobSummary;
}

type ExportToXlsxResponse = Result<ExportToXlsxValue, ExportToXlsxError>;
```

### 17.3 `export:toPptx`

Run a PDF → PowerPoint (.pptx) export job. Long-running.

```ts
interface ExportToPptxRequest {
  handle: DocumentHandle;
  pageRange: { start: number; end: number };
  qualityTier: ExportQualityTier;
  includeAnnotations: boolean;
  outputPath: string;
}

type ExportToPptxError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable'
  | 'queue_full'
  | 'extraction_failed'
  | 'writer_failed'
  | 'output_write_failed'
  | 'cancelled';

interface ExportToPptxValue {
  jobId: number;
  summary: ExportJobSummary;
}

type ExportToPptxResponse = Result<ExportToPptxValue, ExportToPptxError>;
```

### 17.4 `export:toImages`

Run a PDF → image export job. Format selected via `format` field. Multi-page emits per-page progress.

```ts
type ImageExportFormat = 'png' | 'jpeg' | 'tiff';

interface ExportToImagesRequest {
  handle: DocumentHandle;
  pageRange: { start: number; end: number };
  format: ImageExportFormat;
  dpi: number; // 72-600 (validated by zod)
  jpegQuality?: number; // 0.1-1.0; honored only when format='jpeg'; default 0.9
  multiPageTiff?: boolean; // honored only when format='tiff'; default false
  includeAnnotations: boolean; // controls pdfjs annotationMode
  outputPath: string; // basename for single-page; final path for multi-page tiff
}

type ExportToImagesError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'page_range_out_of_range'
  | 'output_path_unwritable'
  | 'queue_full'
  | 'rasterize_failed' // pdfjs render error
  | 'encode_failed' // canvas.toBuffer / utif.encode error
  | 'output_write_failed'
  | 'cancelled';

interface ExportToImagesValue {
  jobId: number;
  summary: ExportJobSummary;
  outputPaths: string[]; // ONE entry per page for single-page formats; ONE entry total for multi-page tiff
}

type ExportToImagesResponse = Result<ExportToImagesValue, ExportToImagesError>;
```

### 17.5 `export:progress` (event stream, main → renderer)

Emitted during all four `export:to*` channels. Follows the existing Phase 3 `mail-merge:progress` / Phase 5 `ocr:progress` patterns.

```ts
type ExportFormat = 'docx' | 'xlsx' | 'pptx' | 'png' | 'jpeg' | 'tiff';

type ExportProgressEvent =
  | { jobId: number; format: ExportFormat; phase: 'starting'; totalPages: number }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'extracting-text';
      pageIndex: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'detecting-tables';
      pageIndex: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'extracting-images';
      pageIndex: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'rasterizing';
      pageIndex: number;
      totalPages: number;
    } // image format only
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'writing-output';
      bytesWritten: number;
      totalBytesEstimate: number | null;
    }
  | { jobId: number; format: ExportFormat; phase: 'completed'; summary: ExportJobSummary }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'cancelled';
      pagesCompleted: number;
      totalPages: number;
    }
  | {
      jobId: number;
      format: ExportFormat;
      phase: 'failed';
      pagesCompleted: number;
      totalPages: number;
      error: string;
    };
```

Subscribe via `window.pdfApi.export.onProgress((event) => { ... })`. Returns an unsubscribe function. The handler MUST debounce + throttle to ≤ 10 events/sec per `phase` per page to avoid renderer rerender storms (mirrors Phase 5 throttling discipline).

### 17.6 `export:cancelJob`

Cancel an in-flight export job. Idempotent. Partial output on disk is deleted.

```ts
interface ExportCancelJobRequest {
  jobId: number;
}

type ExportCancelJobError = 'invalid_payload' | 'job_not_found' | 'job_already_terminal'; // already completed / cancelled / failed

interface ExportCancelJobValue {
  cancelled: boolean; // true if a running/queued job was cancelled; false if it was already terminal
  pagesCompleted: number;
}

type ExportCancelJobResponse = Result<ExportCancelJobValue, ExportCancelJobError>;
```

### 17.7 `export:listJobs`

List rows from `export_jobs` (for the Exports sidebar tab + audit).

```ts
interface ExportListJobsRequest {
  filters?: {
    docHash?: string;
    format?: ExportFormat;
    status?: ExportJobStatus; // 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
    since?: number;
    until?: number;
  };
  limit?: number; // default 100, max 1000
  offset?: number;
}

type ExportListJobsError = 'invalid_payload';

interface ExportListJobsValue {
  jobs: ExportJobRowDto[]; // see data-models.md §11.5
  total: number;
}

type ExportListJobsResponse = Result<ExportListJobsValue, ExportListJobsError>;
```

### 17.8 `export:listFormats`

Returns the static format catalog — what the renderer uses to render the format picker + per-format defaults. Cached client-side; returned synchronously by the handler (no DB read; data is compiled in).

```ts
interface ExportListFormatsRequest {
  /* empty body */
}

type ExportListFormatsError = 'never'; // handler is infallible

interface ExportFormatDescriptor {
  format: ExportFormat;
  displayName: string; // 'Word document', 'Excel workbook', 'PowerPoint presentation', 'PNG image', 'JPEG image', 'TIFF image'
  defaultExtension: string; // 'docx', 'xlsx', 'pptx', 'png', 'jpeg', 'tiff'
  category: 'office' | 'image';
  supportsQualityTier: boolean; // true for office; false for image
  defaultQualityTier: ExportQualityTier | 'n/a';
  defaultIncludeAnnotations: boolean; // true for docx/pptx/image; false for xlsx
  /** Per-format setting keys — UI uses these to render the right extras */
  settingKeys: string[]; // e.g. ['export.docx.qualityTier', 'export.docx.pageSize', ...]
}

interface ExportListFormatsValue {
  formats: ExportFormatDescriptor[]; // 6 entries: docx, xlsx, pptx, png, jpeg, tiff
}

type ExportListFormatsResponse = Result<ExportListFormatsValue, ExportListFormatsError>;
```

### 17.9 `dialog:pickExportOutputPath`

Main-process file SAVE-AS dialog. Structurally mirrors Phase 1's `dialog:pickSavePath` / Phase 2's `dialog:pickPdfSavePath`. Returns the absolute path or `null` if user cancelled.

```ts
interface DialogPickExportOutputPathRequest {
  defaultBasename: string; // e.g. 'my-doc' → dialog suggests 'my-doc.docx'
  format: ExportFormat; // determines default extension + dialog filter
}

type DialogPickExportOutputPathError = 'invalid_payload';

interface DialogPickExportOutputPathValue {
  outputPath: string | null; // null if user cancelled
}

type DialogPickExportOutputPathResponse = Result<
  DialogPickExportOutputPathValue,
  DialogPickExportOutputPathError
>;
```

### 17.10 Preload-exposed API surface (Phase 6 extension)

```ts
// extends Phase 5 PreloadApi (api-contracts.md §16.12)
export interface PreloadApi {
  // ...Phase 1-5 surfaces (frozen)...
  export: {
    toDocx: (req: ExportToDocxRequest) => Promise<ExportToDocxResponse>;
    toXlsx: (req: ExportToXlsxRequest) => Promise<ExportToXlsxResponse>;
    toPptx: (req: ExportToPptxRequest) => Promise<ExportToPptxResponse>;
    toImages: (req: ExportToImagesRequest) => Promise<ExportToImagesResponse>;
    cancelJob: (req: ExportCancelJobRequest) => Promise<ExportCancelJobResponse>;
    listJobs: (req: ExportListJobsRequest) => Promise<ExportListJobsResponse>;
    listFormats: (req: ExportListFormatsRequest) => Promise<ExportListFormatsResponse>;
    onProgress: (handler: (event: ExportProgressEvent) => void) => () => void;
  };
  dialog: {
    // ...Phase 1-5 surfaces (frozen)...
    pickExportOutputPath: (
      req: DialogPickExportOutputPathRequest,
    ) => Promise<DialogPickExportOutputPathResponse>;
  };
}
```

### 17.11 Validation responsibilities — extends §10 / §14.12 / §16.13

In addition to the standard §10 rules, Phase 6 handlers MUST:

- Validate `pageRange.start <= pageRange.end < doc.pageCount` before any expensive extraction.
- Validate `format` against the static catalog returned by `export:listFormats`. Mismatches = `invalid_payload`.
- For `export:toImages`, validate `dpi ∈ [72, 600]`; `jpegQuality ∈ [0.1, 1.0]` (when format='jpeg'); `multiPageTiff` is honored ONLY when format='tiff' (silently ignored otherwise — documented behavior, not an error).
- For `outputPath`, perform a write-permission probe BEFORE inserting the `export_jobs` row (try `fs.access(parentDir, W_OK)`); reject with `output_path_unwritable` early.
- Enforce `export.maxQueueSize` from settings; reject new enqueues with `queue_full` when at cap.
- For `dialog:pickExportOutputPath`, derive the dialog's default extension from `format` (catalog-driven; never hardcode).
- The handlers MUST be read-only on the source PDF — NO writes to the source's bytes, NO `signature_audit_log` updates (export is not an edit; see P6-L-9).

### 17.12 Phase 6 contract freeze point

At end of Wave 23 (this amendment), the Phase-6 contract is locked. Wave 24 implementation must conform; David extends `src/ipc/contracts.ts` to match these types. Any Wave-24 discovery that requires a contract change follows the same Riley-amend-then-David-update protocol as Wave 2 / Wave 11 / Wave 15 / Wave 19. The Phase 1-5 surface (§1-§16) is FROZEN; Phase 6 lives in this §17 amendment only.

---

## 18. Phase 7 additions (2026-05-27, Riley)

> ### Phase 7 amendment (2026-05-27, Riley)
>
> §1-§17 above remain authoritative for Phase 1-6 surfaces. Additions below extend the IPC surface with eight new channels across three new domains — `update` (auto-update), `telemetry` (opt-in usage counts), and `i18n` (localization). Naming convention `<domain>:<verb>` is preserved. The Phase 1-6 contract is FROZEN — no existing channel's request/response shape changes. This is the FINAL roadmap phase.

All channels below are NEW in Phase 7. They follow the §0 conventions: discriminated-union `Result<T, E>`, zod-validated payloads, no thrown exceptions across the bridge.

> **No secrets in Phase 7.** Like Phase 5 + 6 (and unlike Phase 4's `signatures:certLoad`), the Phase 7 IPC surface carries no cryptographic material. The boundary disciplines that matter here are: **telemetry never carries PII / document content / file paths** (conventions §18.5), and **the update controller returns an honest `update_not_configured` rather than a fake "up to date"** when the publish target is a placeholder (architecture-phase-7.md §3.4).

### 18.1 `update:check`

Check the configured release feed for an available update. Explicit (About-modal button) OR auto (only when `settings.update.channel === 'check-on-launch'`, default `'manual'`).

```ts
type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'not-configured';

interface UpdateCheckRequest {
  trigger: 'explicit' | 'launch'; // 'launch' callers MUST have verified the channel setting first
}

type UpdateCheckError =
  | 'invalid_payload'
  | 'update_not_configured' // publish target is a PLACEHOLDER (P7-L-2); HONEST, not a fake up-to-date
  | 'network_failed' // feed unreachable
  | 'feed_parse_failed'; // latest.yml malformed

interface UpdateCheckValue {
  status: UpdateStatus;
  availableVersion: string | null; // null unless status === 'available' (NO sentinel '')
  currentVersion: string; // app.getVersion()
  lastCheckedAt: number; // ms epoch; the controller stamps this + persists to settings
}

type UpdateCheckResponse = Result<UpdateCheckValue, UpdateCheckError>;
```

### 18.2 `update:download`

Download the available update bundle. NEVER auto-invoked — always user-initiated after `update:check` reports `available`. Emits progress via `update:onProgress`.

```ts
interface UpdateDownloadRequest {
  version: string; // the availableVersion from a prior check (guards stale UI)
}

type UpdateDownloadError =
  | 'invalid_payload'
  | 'update_not_configured'
  | 'no_update_available' // no prior 'available' check, or version mismatch
  | 'download_failed'
  | 'signature_verification_failed'; // bundle signature invalid (cert dependency; P7-L-2 §3.5)

interface UpdateDownloadValue {
  status: 'downloaded';
  version: string;
}

type UpdateDownloadResponse = Result<UpdateDownloadValue, UpdateDownloadError>;
```

### 18.3 `update:install`

Quit and install a downloaded update. User-initiated ("Restart and install"). Triggers `autoUpdater.quitAndInstall()`; the app exits, so there is no success payload the renderer observes.

```ts
interface UpdateInstallRequest {
  version: string; // must match the downloaded version
}

type UpdateInstallError =
  | 'invalid_payload'
  | 'no_downloaded_update' // nothing downloaded, or version mismatch
  | 'install_failed';

// On success the process quits; the renderer never receives ok(). The Result type exists for the
// failure paths only (e.g. nothing downloaded). The handler returns ok({ quitting: true }) immediately
// before scheduling quitAndInstall on the next tick.
interface UpdateInstallValue {
  quitting: true;
}

type UpdateInstallResponse = Result<UpdateInstallValue, UpdateInstallError>;
```

**Event stream `update:onProgress`** (renderer subscribes; main emits during download):

```ts
interface UpdateProgressEvent {
  version: string;
  percent: number; // 0-100
  bytesPerSecond: number;
  transferred: number;
  total: number;
}
```

### 18.4 `telemetry:recordEvent`

Record an allowlisted anonymous usage event. The handler is a thin persistence/no-op shim — the renderer's opt-in gate (architecture-phase-7.md §4.4) already dropped the event if opt-in is OFF. The handler **re-checks** opt-in (belt-and-suspenders) and validates the name against the allowlist server-side too.

```ts
type TelemetryEventName =
  | 'app.launch'
  | 'doc.open'
  | 'doc.save'
  | 'feature.annotate.add'
  | 'feature.page.reorder'
  | 'feature.combine.run'
  | 'feature.form.fill'
  | 'feature.mailmerge.run'
  | 'feature.sign.pades'
  | 'feature.ocr.run'
  | 'feature.export.docx'
  | 'feature.export.xlsx'
  | 'feature.export.pptx'
  | 'feature.export.image'
  | 'feature.update.checked'
  | 'feature.locale.changed';

interface TelemetryRecordEventRequest {
  name: TelemetryEventName;
  dayBucket: string; // 'YYYY-MM-DD' — coarse; NO sub-day timestamp (anti-fingerprint)
  // NO other fields permitted. NO document content, NO file paths, NO field values, NO user id.
}

type TelemetryRecordEventError =
  | 'invalid_payload'
  | 'not_opted_in' // opt-in is OFF; event dropped (returned for renderer assertion in tests)
  | 'not_allowlisted'; // name not in the static allowlist; dropped

interface TelemetryRecordEventValue {
  recorded: boolean;
} // false when dropped (not opted in / not allowlisted)

type TelemetryRecordEventResponse = Result<TelemetryRecordEventValue, TelemetryRecordEventError>;
```

> **Privacy contract (conventions §18.5):** the request shape PHYSICALLY cannot carry PII — there is no free-text field, no path field, no value field. The zod schema rejects any extra property (`.strict()`). This is the structural enforcement of the opt-in/anonymous promise.

### 18.5 `telemetry:setOptIn`

Set the telemetry opt-in flag (persists to `settings.telemetry.optIn`, default `false`). Clearing opt-in also clears the local ring buffer.

```ts
interface TelemetrySetOptInRequest {
  optIn: boolean;
}

type TelemetrySetOptInError = 'invalid_payload' | 'settings_write_failed';

interface TelemetrySetOptInValue {
  optIn: boolean;
  bufferCleared: boolean;
} // bufferCleared true when turning OFF

type TelemetrySetOptInResponse = Result<TelemetrySetOptInValue, TelemetrySetOptInError>;
```

### 18.6 `telemetry:getStatus`

Return the current opt-in state + buffer snapshot (for the Settings toggle + the debug panel that makes the opt-in auditable).

```ts
interface TelemetryGetStatusRequest {
  includeBuffer: boolean;
} // debug panel passes true

type TelemetryGetStatusError = 'invalid_payload';

interface TelemetryGetStatusValue {
  optedIn: boolean;
  bufferedCount: number;
  lastEventAt: number | null; // nullable + late-init (NO sentinel 0)
  /** Only present when includeBuffer === true; the debug-panel auditable snapshot */
  buffer: Array<{ name: TelemetryEventName; dayBucket: string }> | null;
}

type TelemetryGetStatusResponse = Result<TelemetryGetStatusValue, TelemetryGetStatusError>;
```

### 18.7 `i18n:setLocale`

Persist the selected locale (`settings.i18n.locale`, default `'en-US'`). The renderer applies it live via `i18next.changeLanguage`; this channel only persists.

```ts
type AppLocale = 'en-US' | 'es-ES'; // 'es-ES' is the proof locale (sample, not complete — P7-L-6 #4)

interface I18nSetLocaleRequest {
  locale: AppLocale;
}

type I18nSetLocaleError = 'invalid_payload' | 'unsupported_locale' | 'settings_write_failed';

interface I18nSetLocaleValue {
  locale: AppLocale;
}

type I18nSetLocaleResponse = Result<I18nSetLocaleValue, I18nSetLocaleError>;
```

### 18.8 `i18n:getAvailableLocales`

Return the supported locales so the picker is data-driven (NOT hardcoded in the renderer). Each entry carries a `complete` flag so the UI can label the proof locale honestly.

```ts
interface I18nGetAvailableLocalesRequest {
  /* empty */
}

type I18nGetAvailableLocalesError = never; // always succeeds (static list)

interface LocaleDescriptor {
  locale: AppLocale;
  nativeName: string; // 'English (US)' / 'Español (España)'
  /** false for the proof locale — UI shows "translation sample, some strings may appear in English" */
  complete: boolean;
}

interface I18nGetAvailableLocalesValue {
  locales: LocaleDescriptor[]; // [{ 'en-US', complete: true }, { 'es-ES', complete: false }]
}

type I18nGetAvailableLocalesResponse = Result<
  I18nGetAvailableLocalesValue,
  I18nGetAvailableLocalesError
>;
```

### 18.9 Aggregate `PdfApi` shape additions (preload bridge surface)

```ts
interface PdfApi {
  // ...Phase 1-6 surfaces (frozen)...
  update: {
    check: (req: UpdateCheckRequest) => Promise<UpdateCheckResponse>;
    download: (req: UpdateDownloadRequest) => Promise<UpdateDownloadResponse>;
    install: (req: UpdateInstallRequest) => Promise<UpdateInstallResponse>;
    onProgress: (handler: (event: UpdateProgressEvent) => void) => () => void;
  };
  telemetry: {
    recordEvent: (req: TelemetryRecordEventRequest) => Promise<TelemetryRecordEventResponse>;
    setOptIn: (req: TelemetrySetOptInRequest) => Promise<TelemetrySetOptInResponse>;
    getStatus: (req: TelemetryGetStatusRequest) => Promise<TelemetryGetStatusResponse>;
  };
  i18n: {
    setLocale: (req: I18nSetLocaleRequest) => Promise<I18nSetLocaleResponse>;
    getAvailableLocales: (
      req: I18nGetAvailableLocalesRequest,
    ) => Promise<I18nGetAvailableLocalesResponse>;
  };
}
```

### 18.10 Validation responsibilities — extends §10 / §14.12 / §16.13 / §17.11

In addition to the standard §10 rules, Phase 7 handlers MUST:

- **`update:*`** — gate every call on the placeholder check FIRST; return `update_not_configured` (NOT a fake `up-to-date`) when the `publish` block is a placeholder. `update:check` with `trigger: 'launch'` is only ever called by the renderer AFTER it has confirmed `settings.update.channel === 'check-on-launch'` (the handler does not re-read the setting, but it does respect the placeholder gate). `update:download` validates the `version` matches the last `available` check (guards stale UI). `update:install` validates a download exists for that version.
- **`telemetry:recordEvent`** — zod schema is `.strict()` (rejects ANY extra property — the structural PII guard). Re-check opt-in server-side (`not_opted_in` → `recorded: false`). Re-validate the name against the static allowlist (`not_allowlisted` → `recorded: false`). NEVER log the event payload (conventions §9 + §18.5). The handler MUST NOT accept any timestamp finer than a day bucket.
- **`telemetry:setOptIn`** — turning opt-in OFF MUST clear the ring buffer (no orphaned events survive opt-out).
- **`i18n:setLocale`** — validate `locale ∈ supportedLngs`; reject others with `unsupported_locale`.
- **`i18n:getAvailableLocales`** — returns the static list; the `complete: false` flag on the proof locale is load-bearing for trust-floor obligation #4 (the picker subtext).

### 18.11 Phase 7 contract freeze point (FINAL roadmap phase)

At end of Wave 27 (this amendment), the Phase-7 contract is locked. Wave 28 implementation must conform; David/Diego extend `src/ipc/contracts.ts` to match these types. Any Wave-28 discovery that requires a contract change follows the same Riley-amend-then-implementer-update protocol as every prior phase. The Phase 1-6 surface (§1-§17) is FROZEN; Phase 7 lives in this §18 amendment only. **Since this is the final roadmap phase, this is also the v1.0.0-rc contract freeze.**
