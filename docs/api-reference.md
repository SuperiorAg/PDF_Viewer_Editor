# API reference — IPC channels

A developer-facing reference card for the IPC channels and event streams that make up the `pdfApi` bridge. The Phase 1 surface is 24 channels + 1 event stream; Phase 2 adds 9 more channels (8 new + the previously-stubbed `pdf:export` now live); Phase 3 (0.3.0) adds 10 channels under the new `forms:*` domain plus a second event stream (`mail-merge:progress`); Phase 4 (0.4.2) adds 10 more channels under two new domains — `signatures:*` (7) and `annotations:*` (3) — plus Phase 4.1's `fs:readBytesByHandle` (1); Phase 5 (0.5.0) adds 9 channels under two new domains — `ocr:*` (7 live) and `scan:*` (2 stubs for Phase 5.1) — plus two new event streams (`ocr:progress` and `ocr:languagePackDownload:progress`); Phase 6 (0.6.0) adds 8 channels under the new `export:*` domain plus 1 dialog channel (`dialog:pickExportOutputPath`) plus one new event stream (`export:progress`); **Phase 7 (0.7.0) adds 8 channels under three new domains — `update:*` (3), `telemetry:*` (3), `i18n:*` (2) — plus one new event stream (`update:onProgress`)**. This document is the lookup; [`api-contracts.md`](api-contracts.md) is the architectural spec with the rationale behind every shape (Wave 1 + Wave 6 + Wave 11 + Wave 15 + Wave 19 + Wave 23 + Wave 27, frozen — with the Wave 13.5 §13.9 `flattenForms` amendment, the Phase 4.1 §15 `fs:readBytesByHandle` amendment, the Phase 5 §16 OCR + scan amendment, the Phase 6 §17 export amendment, and the **Phase 7 §18 update + telemetry + i18n amendment**). Source of truth for types: [`../src/ipc/contracts.ts`](../src/ipc/contracts.ts).

> **Phase 7 channel status (honest, current at 0.7.6):** the `telemetry:*` and `i18n:*` channels are **LIVE, fully exercisable** — telemetry stores to an in-memory ring buffer (nothing leaves the machine), i18n persists the locale and returns the static locale list. The `update:*` channels are **LIVE end-to-end** — the electron-updater integration is wired and the GitHub publish target is real (`owner: SuperiorAg`, `repo: PDF_Viewer_Editor`, `releaseType: draft` for publish safety). `update:check` contacts the live `latest.yml` feed and returns the honest result (`up-to-date`, `update-available`, or a real feed/network error). `update:install` is gated on a code-signing certificate (`electron-updater` correctly refuses to apply an unsigned bundle); check + download work, install returns an error until the cert is provisioned. `update:install` carries an `unsaved-work` gate (`confirmedDiscardUnsaved` request field + `unsaved_work_blocks_install` error variant) resolved end-to-end in 0.7.2 — see [`update:install`](#updateinstall--live-controller-placeholder-feed).

> **Phase 5.1 channel status (honest, current at 0.7.3+):** the `scan:listDevices` and `scan:acquire` channels are **LIVE on Windows** via the custom pure-Node-API WIA COM addon (`native/wia-scanner/`). `listDevices` returns the enumerated `IWiaDevMgr2::EnumDeviceInfo` device list; `acquire` runs `IWiaTransfer::Download` and returns a document handle for the composed PDF (ADF multi-page composes into a single PDF; the handle chains directly into the OCR pipeline). On macOS / Linux both channels return `'scanner_unavailable'` — the addon isn't built / loaded on those platforms (pure-N-API means a single binary works under Node + Electron with no two-ABI dance, but WIA itself is a Windows API). Earlier (0.5.0–0.7.2) builds returned `'not_implemented_phase_5_1'`; that variant is retired.

> **Phase 6 channel status (honest, current at 0.7.6):** all four export channels — `export:toXlsx` / `export:toDocx` / `export:toPptx` / `export:toImages` — are **LIVE end-to-end** since 0.7.1. The production `createProdSourceLoader` pdf.js binding landed, and the 0.7.1 backlog-fix wave fixed the image-export standard-font glyph defect (standard-font text rendered blank). All six output formats (docx / xlsx / pptx / PNG / JPEG / TIFF) produce valid files; verified from the packaged 0.7.1 binary (PNG text render: 25,688 dark pixels versus 0 / blank in 0.6.1). The `export:cancelJob` / `export:listJobs` / `export:listFormats` / `dialog:pickExportOutputPath` support channels are LIVE.

This reference card is **contributor-facing**: it shows the channel surface and how to call it from a renderer thunk or component. The frozen architectural contract is in [`api-contracts.md`](api-contracts.md) §1-§13 with the design rationale for every shape. The two docs are kept in sync — when a channel's request/response shape changes, both docs amend.

For each channel:

- **Channel** — the string constant in `Channels` (e.g. `'dialog:openPdf'`)
- **Status** — `Live` (works today), `Stub` (returns `'not_implemented'`), `Read-only` (Phase 1 limit)
- **Request / Response** — TS types from `contracts.ts`
- **Errors** — variant strings and what each means
- **Renderer example** — one-line call through `api`

All responses are `Result<T, E>`:

```ts
type Result<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message: string; details?: Record<string, unknown> };
```

Handlers never throw. All failures map to `{ ok: false, error, message }`.

---

## Status summary (Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6 + Phase 7)

| Namespace                   | Live channels | Stub channels | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dialog:*`                  | **3**         | 0             | Phase 6 added `dialog:pickExportOutputPath` (native save-as for export output paths)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `fs:*`                      | **5**         | 0             | `fs:writePdf` accepts `kind:'bytes'`; Phase 2 path is `fs:applyEditOps` (replay-engine entry point); Phase 4.1 added `fs:readBytesByHandle` for renderer pdf.js rendering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `recents:*`                 | 3             | 0             | Persisted in SQLite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `settings:*`                | 3             | 0             | Persisted in SQLite. Phase 3 added 4 keys; Phase 4 added 11 keys (7 `signatures.*` + 4 `annotations.*`); Phase 5 added 11 keys (all `ocr.*`); Phase 6 added 17 keys (all `export.*`); **Phase 7 added 4 keys (`telemetry.optIn` / `i18n.locale` / `update.channel` / `update.lastCheckedAt`)** — see [Phase 7 setting keys](#phase-7-setting-keys-and-data-models) below.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `bookmarks:*`               | 6             | 0             | Phase 1 `list/upsert/delete` + Phase 2 `listTree/move/rename`; persisted in SQLite, keyed by `fileHash`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pdf:*`                     | 6             | 1             | `combine` is a Phase 1 typed stub (returns `'not_implemented'`). `export` is LIVE in Phase 2 (dual engine; Phase 3 added the additive `flattenForms?: boolean` request field). `getOutline` typed stub. Phase 2 added `embedImage`, `replaceText`, `identifyTextSpan` (scanner stubbed; channel live), `print`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `app:*`                     | 3             | 2             | `setDefaultPdfHandler` and `getDefaultPdfHandlerStatus` are stubs at the runtime layer; the installer checkbox covers the install-time path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `window:*`                  | 4             | 0             | Not consumed by the Phase 2 renderer; reserved for future custom chrome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `forms:*` (Phase 3)         | 10            | 0             | All 10 channels LIVE in 0.3.0+                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `signatures:*` (Phase 4)    | 7             | 0             | All 7 channels LIVE in 0.4.2. `certLoad / certRelease / applyVisual / applyPades / requestTimestamp / verify / listAudit`. Cert + password discipline per conventions §15 (Buffer-wrap ≤5 lines + zero-on-finally).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `annotations:*` (Phase 4)   | 3             | 0             | All 3 channels LIVE in 0.4.2. `addShape / setMeasureCalibration / getMeasureCalibration`. Covers 7 shape subtypes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`ocr:*` (Phase 5)**       | **7**         | **0**         | All 7 channels LIVE in 0.5.0. `detectLanguages / runOnPage / runOnDocument / cancelJob / listJobs / languagePackDownload / languagePackRemove`. Worker pool discipline per conventions §16 (single funnel + releaseAll on quit + watchdog + LRU eviction). Bytes-stay-in-main extensions apply (no raster bytes echoed to renderer, no `LanguagePack.filePath` at IPC boundary). **English bundled; the 9 downloadable languages (spa / fra / deu / por / ita / rus / chi_sim / chi_tra / jpn) all have real SHA-256 hashes as of 0.7.1 — multi-language download works.**                                                                                                                                                                                                                                          |
| **`scan:*` (Phase 5.1)**    | **2**         | **0**         | **LIVE on Windows as of 0.7.3** via the custom pure-Node-API WIA COM addon (`native/wia-scanner/`). `listDevices` enumerates real WIA devices via `IWiaDevMgr2::EnumDeviceInfo`; `acquire` runs `IWiaTransfer::Download` and composes ADF multi-page into a single PDF that chains directly into the OCR pipeline. On macOS / Linux both channels return `'scanner_unavailable'`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`export:*` (Phase 6)**    | **8**         | **0**         | All 8 channels are wired and reachable in 0.6.0. `export:toXlsx` is **LIVE end-to-end**; `export:toDocx` / `export:toPptx` / `export:toImages` are **LIVE engine, LIVE-pending source-loader wire** (`createProdSourceLoader` typed-throwing stub — Julian M-25.4; David Wave 25.1). `cancelJob` / `listJobs` / `listFormats` are LIVE support channels. Read-only-on-source + export-bytes-stay-in-main discipline per conventions §17. The `ExportQueue` (concurrency=1 FIFO) is documented but not implemented — Julian H-25.1; engine runs inline at concurrency=1 with a `queue_full` HARD CAP.                                                                                                                                                                                                                |
| **`update:*` (Phase 7)**    | **3**         | **0**         | `check` / `download` / `install` + the `onProgress` event. **LIVE end-to-end against the real `SuperiorAg/PDF_Viewer_Editor` GitHub release feed since 0.7.2.** `update:check` returns `up-to-date` / `update-available` / a real feed/network error — never a fabricated status. `autoDownload=false` always; default channel `manual` (no auto-check). Signature verification NOT disabled (`signature_verification_failed` for unsigned bundles). The unsaved-work gate (`confirmedDiscardUnsaved` + `unsaved_work_blocks_install`) is reachable end-to-end (Julian H-29.1 / H-FIX.1 closed). `update:install` is gated on a Windows code-signing certificate — `electron-updater` correctly refuses to apply an unsigned bundle; check + download work, install returns an error until the cert is provisioned. |
| **`telemetry:*` (Phase 7)** | **3**         | **0**         | `recordEvent` / `setOptIn` / `getStatus`. **LIVE, fully exercisable.** Hand-rolled, zero new deps. Opt-in default OFF; `recordEvent` schema is `.strict()` (the structural PII guard — rejects any field beyond `{name, dayBucket}`); silent no-op gate returns before buffering; in-memory ring buffer (default 500); NO network transport, NO `telemetry_events` table, NO payload logging. `getStatus { includeBuffer: true }` feeds the debug panel.                                                                                                                                                                                                                                                                                                                                                            |
| **`i18n:*` (Phase 7)**      | **2**         | **0**         | `setLocale` / `getAvailableLocales`. **LIVE.** `setLocale` persists `settings.i18n.locale` (rejects unsupported locales); the renderer applies the live switch via i18next. `getAvailableLocales` returns the static descriptor list with a `complete` flag (the proof locale's `complete: false` drives the picker's "translation sample" subtext — trust-floor obligation #4).                                                                                                                                                                                                                                                                                                                                                                                                                                    |

The `'not_implemented'` variant convention: every stub channel includes `'not_implemented'` in its error union. The renderer pattern-matches it to surface a "coming soon" toast or disable the affordance, rather than treat it as a failure. See [api-contracts.md §9.5](api-contracts.md#95-stub-channel-error-variant-not_implemented).

---

## `dialog:*` — native open and save dialogs

### `dialog:openPdf` — **Live**

Show the native open-file dialog. On user selection, main reads the file, validates the PDF header, registers a handle, and returns metadata.

| Field    | Value                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request  | `DialogOpenPdfRequest` — empty `{}`, multi-select disabled in Phase 1                                                                                                                                     |
| Response | `DialogOpenPdfResponse = Result<DialogOpenPdfValue, DialogOpenPdfError>`                                                                                                                                  |
| Value    | `{ handle, displayName, fileHash, pageCount, pdflibLoadWarnings }`                                                                                                                                        |
| Errors   | `'user_cancelled'` user dismissed dialog; `'invalid_pdf'` file failed `%PDF-` header check; `'fs_read_failed'` filesystem read error; `'too_large'` exceeds `open.maxFileSizeMB` setting (default 500 MB) |

```ts
const res = await api.dialog.openPdf();
if (res.ok) console.log('Opened:', res.value.displayName, res.value.pageCount);
```

### `dialog:saveAs` — **Live**

Show the native save dialog. Returns an opaque `destinationToken` that the renderer passes to `fs:writePdf`. The renderer never sees the absolute path. Token expires after 60s.

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| Request  | `{ suggestedName: string }`                                    |
| Response | `Result<{ destinationToken, displayName }, DialogSaveAsError>` |
| Errors   | `'user_cancelled'`, `'invalid_path'`                           |

```ts
const res = await api.dialog.saveAs({ suggestedName: 'edited.pdf' });
```

---

## `fs:*` — file I/O against a handle

### `fs:readPdf` — **Live**

Drag-drop variant of `dialog:openPdf`. Takes a `droppedPath` from the renderer's drop event, sanitizes it in main, and reads the file. Renderer-supplied paths are validated against the OS-reported drop list.

| Field    | Value                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Request  | `{ droppedPath: string }`                                                                                          |
| Response | `Result<DialogOpenPdfValue, FsReadPdfError>`                                                                       |
| Errors   | All `DialogOpenPdfError` variants plus `'path_rejected'` (path failed sanitizer or wasn't a real OS-surfaced drop) |

```ts
const res = await api.fs.readPdf({ droppedPath: event.dataTransfer.files[0].path });
```

### `fs:writePdf` — **Live (bytes branch)**

Write the document at a handle to the destination behind a `destinationToken`. The contract accepts the `kind:'bytes'` payload — the renderer hands main the final bytes. **Phase 2 replaced the `kind:'ops'` path with the dedicated [`fs:applyEditOps`](#fsapplyeditops) channel** (architecture-phase-2.md §2.5 — clean async surface, replay-engine entry point). Existing `kind:'ops'` payloads to `fs:writePdf` still return `invalid_payload`; renderer thunks route Phase 2 saves through `fs:applyEditOps` directly.

| Field    | Value                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request  | `{ handle, destinationToken, payload: { kind: 'bytes', bytes } \| { kind: 'ops', originalHandle, ops, annotations } }`                                                                                       |
| Response | `Result<{ bytesWritten, newFileHash }, FsWritePdfError>`                                                                                                                                                     |
| Errors   | `'token_expired'` token > 60s old; `'handle_not_found'` stale handle; `'fs_write_failed'`; `'disk_full'`; `'invalid_payload'` (returned for legacy `kind: 'ops'` payloads — route through `fs:applyEditOps`) |

```ts
const res = await api.fs.writePdf({
  handle: doc.handle,
  destinationToken: savedToken,
  payload: { kind: 'bytes', bytes },
});
```

### `fs:closePdf` — **Live**

Release a document handle and the in-memory buffer.

| Field    | Value                            |
| -------- | -------------------------------- |
| Request  | `{ handle: DocumentHandle }`     |
| Response | `Result<{}, 'handle_not_found'>` |

---

## `recents:*` — recent-files list

Backed by SQLite `recent_files` table. See [data-models.md](data-models.md) §2.1 for the schema.

### `recents:list` — **Live**

| Request | `{ limit?: number }` (default 20) |
| Response | `Result<{ items: RecentsListItem[] }, 'db_unavailable'>` |
| Item | `{ path, displayName, lastOpenedAt, fileHash, fileStillExists }` — `fileStillExists` is computed via `existsSync` so the renderer can dim missing entries. |

### `recents:add` — **Live**

Called internally on every successful open; the renderer rarely calls directly.

| Request | `{ path, displayName, fileHash }` |
| Errors | `'db_unavailable'`, `'invalid_payload'` |

### `recents:clear` — **Live**

| Response | `Result<{ cleared: number }, 'db_unavailable'>` |

---

## `settings:*` — typed key/value persistence

Backed by SQLite `app_settings`. Values are JSON-serialized on write and parsed on read. Strongly typed per key:

```ts
type SettingKey =
  | 'recents.maxItems' // number
  | 'open.maxFileSizeMB' // number
  | 'export.defaultEngine' // 'auto' | 'pdf-lib' | 'chromium'
  | 'export.showWarningsToast' // boolean
  | 'file_association.pdf.requested' // boolean
  | 'theme' // 'system' | 'light' | 'dark'
  | 'undo.maxHistory' // number
  // Phase 3 additions:
  | 'forms.dateLocale' // 'system' | 'en-US' | 'en-GB' | 'ISO'; default 'system'
  | 'forms.flattenOnExportDefault' // boolean; default false (default state of the "Flatten forms in output" checkbox in Export + Mail Merge)
  | 'mailMerge.lastOutputFolder' // string; auto-populates wizard step 4 folder picker
  | 'mailMerge.defaultOutputMode'; // 'folder' | 'concat'; default 'folder' (wizard step 4 default)
```

### `settings:get` — **Live**

| Request | `{ key: K }` |
| Response | `Result<{ value: SettingValue<K> \| null }, 'db_unavailable' \| 'unknown_key'>` (null when never set; renderer applies its own default) |

### `settings:set` — **Live**

| Request | `{ key: K, value: SettingValue<K> }` |
| Errors | `'db_unavailable'`, `'unknown_key'`, `'invalid_value'` |

### `settings:getAll` — **Live**

Renderer boot-time call to hydrate the entire settings slice.

| Response | `Result<{ entries: Partial<Record<SettingKey, ...>> }, 'db_unavailable'>` — only set keys are returned; renderer merges with defaults |

---

## `bookmarks:*` — user-authored bookmarks per file

Distinct from the file's native PDF outline (which is read via `pdf:getOutline`). Keyed by `fileHash` so bookmarks survive file moves and rename.

### `bookmarks:list` — **Live**

| Request | `{ fileHash: FileHash }` |
| Response | `Result<{ items: BookmarkRow[] }, 'db_unavailable'>` |
| Row | `{ id, fileHash, pageIndex, title, createdAt }` |

### `bookmarks:upsert` — **Live**

| Request | `{ fileHash, pageIndex, title, id? }` (id present → update; absent → insert) |
| Response | `Result<{ id: number }, BookmarksUpsertError>` |
| Errors | `'db_unavailable'`, `'invalid_payload'`, `'duplicate'` |

### `bookmarks:delete` — **Live**

| Request | `{ id: number }` |
| Errors | `'db_unavailable'`, `'not_found'` |

---

## `pdf:*` — document operations

Two of the three are LIVE end-to-end (`pdf:combine` since 0.7.6 closed H-30.1; `pdf:export` since Phase 2). `pdf:getOutline` is an honest stub with zero renderer callers (dead code; the type is removable in a future cross-process wave).

### `pdf:combine` — **Live end-to-end (since 0.7.6 — H-30.1 closure)**

Merge multiple PDFs into a new document. Runs in main via pdf-lib so the renderer stays responsive. The Phase-1 `not_implemented` stub was removed in 0.7.6; David's real engine at `src/main/pdf-ops/combine.ts` + the new `dialog:pickPdfFiles` channel + Riley's modal wire-up form the end-to-end path.

| Request | `{ sources: Array<{ kind: 'handle', handle, pageRange? } \| { kind: 'path', path, pageRange? }> }` |
| Response | `Result<{ handle, pageCount, displayName }, PdfCombineError>` |
| Errors | `'invalid_source'`, `'handle_not_found'`, `'fs_read_failed'`, `'pdf_load_failed'`, `'invalid_page_range'`, `'no_pages'`, `'compose_failed'` |

JS / open-action / outline strip is **automatic-by-construction** via pdf-lib's `copyPages` — the page tree is copied but the source catalog's document-level entries (`/Names → /JavaScript`, `/OpenAction`, `/AcroForm`, `/Outlines`) never come along into a `PDFDocument.create()`-rooted output. Verified structurally: the output catalog's `Names`/`OpenAction` keys are `undefined`. **Note for test authors:** for the source-side sanity check, save the JS-laden fixture with `useObjectStreams: false` so the JS marker is visible as plain text in the buffer; the default `useObjectStreams: true` compresses those markers and a byte-substring search will give a false negative.

Diego added the `PdfCombineSource` type alias in Wave 3 to absorb the source-union directly without indexed-access workarounds:

```ts
export type PdfCombineSource = PdfCombineRequest['sources'][number];
```

The companion **`dialog:pickPdfFiles`** channel (new in 0.7.6) is the path-only multi-file picker the Combine modal calls when the user clicks **Add files…**. It returns absolute paths only (no main-side `app:openPdf` read or handle registration); `pdf:combine` reads each source itself with per-source error mapping. The path-only shape is a deliberate divergence from `dialog:openPdf` (which is the canonical open + read + register flow) — overloading `openPdf` with a paths-only response would have broken the discriminated-response invariant.

| Channel               | Request               | Response                                                                                 |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `dialog:pickPdfFiles` | `{ multi?: boolean }` | `Result<{ paths: string[] }, DialogPickPdfFilesError>` (`paths` is empty on user-cancel) |

### `pdf:export` — **Live (Phase 2, Phase 3 extension)**

Print-to-PDF channel. Phase 2 replaced the Phase 1 stub with a dual-engine implementation: pdf-lib (default, byte-stable, deterministic) and Chromium (fallback for documents with unauthorable annotations, ≥10 overlay objects per page, or text-replace ops).

| Field    | Value                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Request  | `{ handle, preference: 'auto' \| 'pdf-lib' \| 'chromium', flattenForms?: boolean }`                                                            |
| Response | `Result<{ engine, reason, forcedBy, warnings, outputBytes }, PdfExportError>`                                                                  |
| `engine` | `'pdf-lib'` \| `'chromium'` — which engine actually ran                                                                                        |
| `reason` | `'default'` \| `'forced-by-setting'` \| `'forced-by-overlay-threshold'` \| `'forced-by-unauthorable-annotation'` \| `'forced-by-text-replace'` |
| Errors   | `'handle_not_found'`, `'engine_failed_pdflib'`, `'engine_failed_chromium'`, `'no_dirty_changes'`, `'cancelled'`, `'not_implemented'`           |

#### Phase 3 extension — `flattenForms?: boolean`

Additive, backwards-compatible. When `true`, the engine calls `form.flatten()` on the output document before writing — interactive AcroForm fields are baked into the page content streams (no `/AcroForm` left in the file). Default `false` (omit the field for unflattened output, preserving Phase 2 behavior).

The renderer wires this to the "Flatten forms in output" checkbox in the Export-to-PDF dialog. Default state is read from the `forms.flattenOnExportDefault` setting. Greyed out when the engine choice is `chromium` (Chromium output is always flattened by construction) or when the document has no AcroForm. See [`api-contracts.md §13.11`](api-contracts.md#1311-pdfexport-phase-3-extension-additive).

The Chromium engine uses an offscreen `BrowserWindow` with the L-001 security floor preserved (`enableDragDropFiles` left at default) and calls `webContents.printToPDF()`. Chromium output bytes are non-deterministic across runs (Chromium's `printToPDF` is non-reproducible by design); for byte-stable output, force `pdf-lib`.

Phase 3 also DROPS the Phase 2 auto-Chromium routing for AcroForm-bearing documents — pdf-lib now preserves AcroForms cleanly, so the heuristic is no longer needed. JS-actions still bias toward Chromium (pdf-lib strips JS actions on save per locked decision P3-L-2).

For documents > 50 MB, the engine streams progress via `pdf:export:progress`. The Phase 2 implementation ships the bytes-in-response model; a temp-file-token streaming model is a future enhancement.

### `pdf:export:progress` — **Event stream** (main → renderer; Phase 2)

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
  percent: number; // 0..100; -1 for indeterminate
  message?: string;
}
```

Subscribe through the preload-exposed registration helper:

```ts
const unsubscribe = api.events.onExportProgress((evt) => {
  console.log(evt.phase, evt.percent);
});
```

### `pdf:getOutline` — **Stub** (Wave 2 follow-up)

Read the file's native PDF outline (read-only in Phase 1).

| Request | `{ handle }` |
| Response | `Result<{ outline: OutlineNode[] }, PdfGetOutlineError>` |
| Node | `{ title, pageIndex (or null for chapter-headers), children: OutlineNode[] }` |
| Errors | `'handle_not_found'`, `'parse_failed'`, `'not_implemented'` |

---

## `app:*` — application-level operations

### `app:getVersion` — **Live**

| Response | `Result<{ appVersion, electronVersion, chromiumVersion, nodeVersion }, never>` |

### `app:quit` — **Live**

| Request | `{ confirmUnsaved: boolean }` |
| Errors | `'unsaved_changes'` — main returns this if `confirmUnsaved` is `false` and there are dirty documents; renderer surfaces a confirm modal and re-calls with `true` |

### `app:openExternal` — **Live**

Open a path-validated external location. Phase 1 supports only the "show in Explorer" affordance for an open document handle. Never opens arbitrary URLs.

| Request | `{ kind: 'show_in_explorer', handle }` |
| Errors | `'handle_not_found'`, `'os_failed'` |

### `app:setDefaultPdfHandler` — **Stub** (Phase 2; installer-checkbox path is Live)

Runtime toggle to request the OS make this app the default `.pdf` handler. The installer checkbox covers Phase 1's "default ON during install" path; the in-app runtime toggle is Phase 2.

| Request | `{ enable: boolean }` |
| Errors | `'os_denied'`, `'unsupported_os'`, `'registry_write_failed'`, `'already_in_requested_state'`, `'not_implemented'` |

### `app:getDefaultPdfHandlerStatus` — **Stub** (Phase 2)

| Response | `Result<{ isDefault, currentDefaultName? }, 'os_query_failed' \| 'not_implemented'>` |

---

## `window:*` — window chrome controls

Added by David in Wave 2 to support Phase-2 custom chrome. **The Phase 1 renderer does not consume these** (Electron's native chrome covers Phase 1). They are documented here so the contract reflects shipped reality and Julian's audit covers them. All four are wired live in main; the renderer hooks land in Phase 2.

### `window:minimize` — **Live (not consumed Phase 1)**

| Response | `Result<{}, 'no_window'>` |

### `window:maximize` — **Live (not consumed Phase 1)**

Toggles between maximized and unmaximized. Returns the resulting state so a custom-chrome icon can swap.

| Response | `Result<{ isMaximized: boolean }, 'no_window'>` |

### `window:close` — **Live (not consumed Phase 1)**

Fires the standard `before-close` flow including the unsaved-changes prompt. Renderers with dirty state should rely on the existing close-confirmation modal rather than call this.

| Response | `Result<{}, 'no_window'>` |

### `window:getState` — **Live (not consumed Phase 1)**

Read-only snapshot for Phase-2 custom chrome at startup.

| Response | `Result<{ isMinimized, isMaximized, isFullScreen, isFocused }, 'no_window'>` |

---

## Phase 2 channels

Phase 2 adds 8 new IPC channels plus retires the `pdf:export` Phase 1 stub (now live; see [pdf:export](#pdfexport-live-phase-2) above). The full architectural contract for these channels lives in [`api-contracts.md`](api-contracts.md) §12 (frozen Wave 6). The data-models for the `EditOperation` discriminated union and `MoveBookmarkResult` are in [`data-models.md`](data-models.md) §7 (with the Wave 8.5 §7.5 amendment for `MoveBookmarkResult`).

### `fs:applyEditOps` — **Live (Phase 2)**

Replay-engine entry point. The Phase 2 path for "save with edits preserved". Takes the document handle, the renderer's op log, and the annotation list; main parses the original bytes (kept in main per the Phase 2 lynchpin), runs the [edit-replay engine](edit-replay-engine.md), emits annotations, and writes via atomic temp-rename to either a `destinationToken` (from a prior `dialog:saveAs`) or an explicit `outputPath` (Phase 3 headless mode).

| Field                      | Value                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request                    | `{ handle, ops: EditOperationSerialized[], annotations: AnnotationModelSerialized[], outputPath?, destinationToken?, engine?: 'auto' \| 'pdf-lib' }`                                                                                                                                                             |
| Response                   | `Result<{ bytesWritten, newFileHash, annotationRefAssignments, warnings }, FsApplyEditOpsError>`                                                                                                                                                                                                                 |
| `bytesWritten`             | Number of bytes written to disk                                                                                                                                                                                                                                                                                  |
| `newFileHash`              | Content hash of the saved file                                                                                                                                                                                                                                                                                   |
| `annotationRefAssignments` | Map of annotation id → assigned PDF object number (for re-edits in the same session)                                                                                                                                                                                                                             |
| `warnings`                 | Non-fatal warnings (e.g. "multi-page TIFF: first page only", "image-overlay-edit on non-existent overlay (no-op)")                                                                                                                                                                                               |
| Errors                     | `'handle_not_found'`, `'invalid_payload'`, `'token_expired'`, `'fs_write_failed'`, `'disk_full'`, `'op_apply_failed'` (details payload identifies the op kind), `'annotation_emit_failed'`, `'image_decode_failed'`, `'text_span_not_found'`, `'missing_glyph'`, `'serialize_failed'`, `'encrypted_unsupported'` |

```ts
const res = await api.fs.applyEditOps({
  handle: doc.handle,
  ops: dirtyOps,
  annotations: doc.annotations,
  destinationToken: savedToken,
});
```

Engine choice: the engine is always **pdf-lib** for Save. The `'auto' | 'pdf-lib'` enum is forward-compatible for a future Chromium-save mode; today only pdf-lib runs. The dual-engine choice (`pdf-lib` vs `chromium`) only applies to [`pdf:export`](#pdfexport-live-phase-2).

### `pdf:embedImage` — **Live (Phase 2)**

Embed a PNG / JPEG / TIFF image as a new page or as an overlay on an existing page. Main decodes the image (using `pdf-lib` for PNG/JPEG and `utif` for TIFF first-page), stores the bytes in the per-handle image cache keyed by SHA-256 content hash, and returns the serialized `EditOperation` for the renderer to append to its op log.

| Field      | Value                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request    | `{ handle, image: { bytes, mimeType, width, height }, placement: { kind: 'new-page', atIndex, orientation? } \| { kind: 'overlay', pageIndex, rect, overlayId? } }` |
| `mimeType` | `'image/png'` \| `'image/jpeg'` \| `'image/tiff'`                                                                                                                   |
| Response   | `Result<{ op, contentHash, warnings }, PdfEmbedImageError>`                                                                                                         |
| Errors     | `'handle_not_found'`, `'invalid_payload'`, `'image_decode_failed'`, `'tiff_decode_failed'`, `'out_of_range'`                                                        |

```ts
const res = await api.pdf.embedImage({
  handle: doc.handle,
  image: { bytes: imageBytes, mimeType: 'image/png', width, height },
  placement: { kind: 'new-page', atIndex: 0 },
});
```

Multi-page TIFFs surface a `'multi_page_tiff_first_only'` entry in `warnings`. Image bytes are deduplicated by SHA-256 content hash in main's per-handle image cache; re-importing the same image multiple times is cheap.

### `pdf:replaceText` — **Live (Phase 2)**

Replace text inside an existing text run with new text, preserving the original font and run position. Phase 2 is replace-only (no reflow, no font substitution). The renderer first calls [`pdf:identifyTextSpan`](#pdfidentifytextspan-live-channel-scanner-stubbed) to resolve a click point to a text span; this channel commits the replacement as an edit op.

| Field        | Value                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request      | `{ handle, pageIndex, objectId, newText }`                                                                                                                          |
| Response     | `Result<{ op, willClip, overflowPt? }, PdfReplaceTextError>`                                                                                                        |
| `willClip`   | `true` if the replacement is wider than the original run's width (save will return `'missing_glyph'` or `'clipped'`; the renderer surfaces an amber clip indicator) |
| `overflowPt` | Overflow distance in points (only present when `willClip === true`)                                                                                                 |
| Errors       | `'handle_not_found'`, `'invalid_payload'`, `'text_span_not_found'`, `'missing_glyph'`, `'out_of_range'`                                                             |

Failure modes are documented in [`user-guide.md` → Editing text](user-guide.md#failure-modes). The replacement is queued as a `text-replace` `EditOperation`; the actual byte rewrite happens at save time via the edit-replay engine.

### `pdf:identifyTextSpan` — **Live channel; scanner stubbed**

Hit-test a (page, x, y) point to a text-run object id + bounding rect + font metrics. The channel is live and the renderer-cached-metrics path carries the text-edit UX; a real content-stream walker is Phase 2.5. Returns `'no_text_at_point'` when no text run is found at the hit point.

| Field    | Value                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| Request  | `{ handle, pageIndex, x, y }`                                                        |
| Response | `Result<{ objectId, runBoundingRect, currentText, font }, PdfIdentifyTextSpanError>` |
| `font`   | `{ family, size, glyphWidths: Record<charCode, width>, glyphMapSize }`               |
| Errors   | `'handle_not_found'`, `'invalid_payload'`, `'no_text_at_point'`, `'out_of_range'`    |

### `pdf:print` — **Live (Phase 2)**

Dispatch a print job through Electron's `webContents.print()`. Main constructs a hidden BrowserWindow (security floor preserved per L-001), runs the edit-replay engine to produce the up-to-date document bytes, loads them into the offscreen window, and invokes the OS print dialog.

| Field        | Value                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request      | `{ handle, ops, annotations, printerName?, pageRange?, options? }`                                                                                        |
| `options`    | `{ silent?, copies?, color?, duplex?: 'simplex' \| 'short-edge' \| 'long-edge', pageSize?: 'A4' \| 'Letter' \| 'Legal' \| { width, height } }`            |
| Response     | `Result<{ jobDispatched: true, engineUsed, warnings }, PdfPrintError>`                                                                                    |
| `engineUsed` | `'pdf-lib'` (the bytes-build engine for print) — Chromium-based print is not used; the OS print path consumes the pdf-lib output                          |
| Errors       | `'handle_not_found'`, `'invalid_payload'`, `'replay_failed'`, `'no_printers_found'`, `'printer_not_found'`, `'user_cancelled'`, `'print_dispatch_failed'` |

```ts
const res = await api.pdf.print({
  handle: doc.handle,
  ops: dirtyOps,
  annotations: doc.annotations,
});
```

Phase 2 has no in-app print preview (Phase 3 adds a preview pane + print settings UI).

### `bookmarks:listTree` — **Live (Phase 2)**

Return the full bookmark tree for a file as a nested structure (children embedded). Phase 1 `bookmarks:list` returns a flat list and remains for backward compatibility; new callers prefer `listTree`.

| Field          | Value                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Request        | `{ fileHash }`                                                                                 |
| Response       | `Result<{ tree: BookmarkNode[] }, BookmarksListTreeError>`                                     |
| `BookmarkNode` | `{ id, fileHash, pageIndex, title, createdAt, parentId, sortOrder, children: BookmarkNode[] }` |
| Errors         | `'db_unavailable'`                                                                             |

### `bookmarks:move` — **Live (Phase 2)**

Re-parent and/or re-order a single bookmark. Cycle detection runs in the repo (walking the parent chain in-JS — see `data-models.md` §7.5). See the [`MoveBookmarkResult` discriminated union](#movebookmarkresult-repo-side--bookmarksmoveerror-ipc-side) section below for the repo → IPC translation.

| Field    | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Request  | `{ id, newParentId: number \| null, newSortOrder }`                        |
| Response | `Result<{}, BookmarksMoveError>`                                           |
| Errors   | `'db_unavailable'`, `'not_found'`, `'invalid_payload'`, `'cycle_detected'` |

### `bookmarks:rename` — **Live (Phase 2)**

| Field    | Value                                                  |
| -------- | ------------------------------------------------------ |
| Request  | `{ id, title }`                                        |
| Response | `Result<{}, BookmarksRenameError>`                     |
| Errors   | `'db_unavailable'`, `'not_found'`, `'invalid_payload'` |

---

### `MoveBookmarkResult` (repo-side) → `BookmarksMoveError` (IPC-side)

The `BookmarksRepo.move()` repo method returns `MoveBookmarkResult`:

```ts
type MoveBookmarkResult =
  | { ok: true }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'cycle_detected' }
  | { ok: false; error: 'invalid_parent' };
```

The IPC `BookmarksMoveError` union (per `api-contracts.md` §12.6) is:

```ts
type BookmarksMoveError = 'db_unavailable' | 'not_found' | 'invalid_payload' | 'cycle_detected';
```

The handler ([`src/ipc/handlers/bookmarks-phase2.ts`](../src/ipc/handlers/bookmarks-phase2.ts)) maps repo `'invalid_parent'` → IPC `'invalid_payload'`. The semantic mapping reads as "the parent reference is structurally invalid" — accurate given the IPC contract scope. A dedicated `'invalid_parent'` wire variant is a Phase 2.5 candidate (it would surface a distinct renderer toast — "parent doesn't exist or belongs to a different file" — instead of the generic "invalid request"). The amendment touches `api-contracts.md` §12.6 + `src/ipc/contracts.ts` `BookmarksMoveError` + a new renderer toast.

The handler switches on the variant with an exhaustiveness `never`-guard so any future variant added to `MoveBookmarkResult` fails the typecheck until it gets a wire mapping. Don't collapse the union back to boolean at any layer — that was the H-1 BLOCKER Wave 8.5 closed.

---

## Phase 3 channels — `forms:*` and `mail-merge:progress`

Phase 3 adds 10 IPC channels under the new `forms:*` domain plus a second main → renderer event stream (`mail-merge:progress`). All 10 channels are LIVE in 0.3.0. The full architectural contract is in [`api-contracts.md`](api-contracts.md) §13 (frozen Wave 11, with the Wave 13.5 §13.9 `flattenForms` amendment).

`FormFieldDefinition`, `FormFieldValue`, `FormFieldType`, `FormFieldOption`, and `FormTemplateRow` live in [`data-models.md` §8](data-models.md#8-phase-3-additions). The renderer routes these through the gatekeeper at [`src/client/types/ipc-contract.ts`](../src/client/types/ipc-contract.ts) per the ESLint-enforced boundary (`no-restricted-imports`).

### `forms:detect` — **Live (Phase 3)**

Detect AcroForm fields in the open document. Cheap; does not mutate the document. Returns the three honesty flags the Forms sidebar status banner surfaces.

| Field                  | Value                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request                | `{ handle }`                                                                                                                                                                                                                                                        |
| Response               | `Result<{ fields, hasAcroForm, hasXfaForm, hasJavaScriptActions, warnings }, FormsDetectError>`                                                                                                                                                                     |
| `fields`               | `FormFieldDefinition[]` — text/checkbox/radio/dropdown/date/signature types only; unknown types skipped with a warning                                                                                                                                              |
| `hasXfaForm`           | `true` if the catalog's AcroForm dict carries an `/XFA` entry. Renderer surfaces a read-only banner: "This PDF uses XFA forms which aren't editable in Phase 3."                                                                                                    |
| `hasJavaScriptActions` | `true` if the catalog has `/Names /JavaScript` or any field carries `/AA`. Renderer surfaces a toast warning on open and again on save: **"JavaScript actions stripped from document (Phase 3 limitation)."** Locked decision P3-L-2 — JS is stripped at save time. |
| Errors                 | `'handle_not_found'`, `'load_failed'`, `'detect_failed'`                                                                                                                                                                                                            |

```ts
const res = await api.forms.detect({ handle: doc.handle });
if (res.ok) {
  if (res.value.hasJavaScriptActions) showWarningToast('JS actions will be stripped on save');
  if (res.value.hasXfaForm) showWarningBanner('XFA forms not editable');
  // res.value.fields drives the Forms sidebar field list
}
```

### `forms:fill` — **Live (Phase 3)**

Validate a single field-fill value (e.g. dropdown option exists, date parses) and return the normalized value. **Does NOT mutate the document or return an `EditOperation`** — Phase 3's HYBRID commit boundary keeps per-keystroke values transient in `formsSlice.values`; the commit boundary (Save or explicit "Commit form values" button) produces ONE `form-commit` `EditOperation` carrying the whole batch.

| Field             | Value                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request           | `{ handle, fieldName, value: FormFieldValue }`                                                                                                                                             |
| Response          | `Result<{ fieldName, normalizedValue, warnings }, FormsFillError>`                                                                                                                         |
| `normalizedValue` | Echo of `value` after validation (e.g. dates coerced to ISO-8601, dropdown values verified against `options[]`)                                                                            |
| Errors            | `'handle_not_found'`, `'invalid_payload'`, `'field_not_found'`, `'field_type_mismatch'` (e.g. text value on a checkbox), `'option_not_in_field'` (dropdown/radio value not in `options[]`) |

### `forms:flatten` — **Live (Phase 3)**

Flatten every AcroForm field to static page content. Returns an `EditOperation` (kind `form-flatten`) for the renderer to append to its op log — the actual byte mutation happens at the next save via the replay engine.

| Field    | Value                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Request  | `{ handle }`                                                                                          |
| Response | `Result<{ op, flattenedFieldCount, warnings }, FormsFlattenError>`                                    |
| Errors   | `'handle_not_found'`, `'load_failed'`, `'form_not_present'`, `'flatten_failed'`, `'serialize_failed'` |

This is a standalone document-structural op (different from per-row flatten on `forms:runMailMerge`, which uses the wire-level `flattenForms?: boolean` flag on the job — see below — and from `pdf:export`'s additive `flattenForms?: boolean`).

### `forms:designAdd` — **Live (Phase 3)**

Author a new form field. The renderer fires this on click-to-place completion in the form designer (Ctrl+Shift+F mode). Returns the `form-design-add` `EditOperation` for the renderer's op log.

| Field                       | Value                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request                     | `{ handle, fieldDefinition: FormFieldDefinition }`                                                                                                                                |
| Response                    | `Result<{ op, normalizedFieldDefinition, warnings }, FormsDesignAddError>`                                                                                                        |
| `normalizedFieldDefinition` | The submitted `FormFieldDefinition` after sanitization — rect clamped to page bounds, etc.                                                                                        |
| Errors                      | `'handle_not_found'`, `'invalid_payload'`, `'duplicate_field_name'`, `'invalid_field_definition'` (e.g. radio with no options), `'unsupported_field_type'`, `'page_out_of_range'` |

Signature-placeholder fields are authored via `field-dict-authoring.ts` (manual PDFDict construction — `/FT /Sig` field with `/V` intentionally absent). pdf-lib's high-level API does not expose a `createSignatureField`; the engine hand-builds the field dict + widget annotation. See [`form-engine.md §3.7`](form-engine.md#37-signature-placeholder-authorship-manual-pdfdict-path).

### `forms:designRemove` — **Live (Phase 3)**

Remove a form field (authored OR detected). The returned `EditOperation` carries the full `before` definition so undo restores the field.

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| Request  | `{ handle, fieldName }`                                        |
| Response | `Result<{ op, warnings }, FormsDesignRemoveError>`             |
| Errors   | `'handle_not_found'`, `'invalid_payload'`, `'field_not_found'` |

### `forms:listTemplates` — **Live (Phase 3)**

List saved form templates (summary metadata only — `fieldCount`, not the field array; full template via `forms:loadTemplate`). Ordered by `updatedAt DESC`.

| Field    | Value                                                           |
| -------- | --------------------------------------------------------------- |
| Request  | `{}`                                                            |
| Response | `Result<{ items: FormTemplateListItem[] }, 'db_unavailable'>`   |
| Item     | `{ id, name, fieldCount, sourceDocHash, createdAt, updatedAt }` |

### `forms:saveTemplate` — **Live (Phase 3)**

Save the current document's authored fields (typically `formsSlice.fields` filtered to `origin === 'authored'`) as a reusable template. Names are unique across all templates — duplicates return `'name_in_use'` (the dialog does NOT auto-overwrite).

| Field            | Value                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Request          | `{ handle, name, fields, columnMappings? }`                                                                                                 |
| Response         | `Result<{ id, warnings }, FormsSaveTemplateError>`                                                                                          |
| `columnMappings` | Optional — snapshot of mail-merge column→field mapping from a prior wizard run; persisted on the template for next-time auto-pre-population |
| Errors           | `'handle_not_found'`, `'invalid_payload'`, `'name_in_use'`, `'db_unavailable'`                                                              |

### `forms:loadTemplate` — **Live (Phase 3)**

Load a template by id. Returns the full field array + the last persisted column mappings.

| Field    | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Request  | `{ templateId }`                                                           |
| Response | `Result<{ id, name, fields, lastColumnMappings }, FormsLoadTemplateError>` |
| Errors   | `'invalid_payload'`, `'template_not_found'`, `'db_unavailable'`            |

The renderer's `loadFormTemplateThunk` dispatches one `form-design-add` op per field (so each is independently undoable) and caches `lastColumnMappings` in the mail-merge slice for wizard step 3 auto-pre-population.

### `forms:runMailMerge` — **Live (Phase 3, Wave 13.5 amended)**

Execute a mail-merge job. Long-running; streams `mail-merge:progress` events (see below). The runner lives in main, does NOT spawn a worker or new BrowserWindow (L-001 untouched), and writes each per-row output via an **atomic temp+rename** wrapper around the injected `writeFile` (closed in Wave 13.5 H-3.3 — `register.ts:513-527`).

| Field    | Value                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request  | `{ job: MailMergeJob }`                                                                                                                                                                                 |
| Response | `Result<{ jobId, outputPath, rowsWritten, totalRows, wasCancelled, warnings }, FormsRunMailMergeError>`                                                                                                 |
| Errors   | `'handle_not_found'`, `'template_not_found'`, `'invalid_payload'`, `'data_parse_failed'`, `'unmapped_required_field'`, `'row_fill_failed'`, `'output_path_invalid'`, `'fs_write_failed'`, `'cancelled'` |

`MailMergeJob` shape:

```ts
interface MailMergeJob {
  jobId: string; // renderer-generated UUID; correlates progress events
  templateHandle: DocumentHandle | null; // open document used as template
  templateId: number | null; // OR a saved form-template id (one of templateHandle / templateId must be set)
  dataSource:
    | { kind: 'csv'; bytes: Uint8Array; delimiter?: ',' | ';' | '\t' }
    | { kind: 'xlsx'; bytes: Uint8Array }; // bytes streamed from renderer file-pick
  columnMapping: Record<string /* columnName */, string /* fieldName */>;
  outputMode:
    | { kind: 'folder'; outputFolder: string; filenameTemplate: string } // e.g. "contract-{LastName}-{rowIndex:04}.pdf"
    | { kind: 'concat'; outputFile: string };
  fields: FormFieldDefinition[]; // snapshot for coercion; allows per-row mapRowToFieldValues
  /** Phase 3.1 (Wave 13.5 H-3.2): flatten each per-row output. Default false. */
  flattenForms?: boolean;
}
```

**`flattenForms?: boolean`** (Wave 13.5 amendment to `api-contracts.md §13.9`): additive, defaults `false`. When `true`, the runner calls `form.flatten()` on each per-row fill output before the atomic write, producing non-interactive PDFs. Wires to the wizard's step-4 "Flatten forms in output" checkbox (`mail-merge-slice.flattenInOutput` → `WizardFooter` → `job.flattenForms`). Renderer regression tests at [`mail-merge-modal.test.tsx:301-356`](../src/client/components/modals/mail-merge-modal/mail-merge-modal.test.tsx) pin both `true` and `false` permutations end-to-end.

**Path sanitization** is critical and load-bearing. The runner accepts two production sanitizers via `MailMergeRunDeps` — `sanitizePath` for file outputs (concat-mode `outputFile`, folder-mode per-row paths) and `sanitizeDirectoryPath` for folder outputs (extensions whitelist `['', '.pdf']`). Both go through the same hardened `sanitizePathDetailed` pipeline; only the extension whitelist differs. Closed in Wave 13.5 B-3.1 — tests inject the REAL production sanitizers, not permissive `(raw) => raw` stubs (the structural CI-blindspot that hid the BLOCKER for an entire wave). See [`developer-guide.md` → Common pitfalls → Permissive test stubs](developer-guide.md#permissive-test-stubs-mask-production-failures).

```ts
const res = await api.forms.runMailMerge({ job });
if (res.ok)
  console.log(`Wrote ${res.value.rowsWritten}/${res.value.totalRows} to ${res.value.outputPath}`);
```

### `forms:runMailMerge:cancel` — **Live (Phase 3)**

Sub-channel companion to `forms:runMailMerge`. Renderer fires this when the user clicks Cancel in the progress modal. The cancel handler flips the runner's `cancelRequested` flag for the named job; the runner finishes the current row, then returns the partial result via the original `forms:runMailMerge` response Promise.

| Field    | Value                         |
| -------- | ----------------------------- |
| Request  | `{ jobId }`                   |
| Response | `Result<{}, 'job_not_found'>` |

In folder mode, rows already written stay on disk (partial result). In concat mode, no output file is written (atomic semantics — concat keeps each row's bytes in memory and only writes the final concatenation; cancel discards before write).

### `mail-merge:progress` — **Event stream** (main → renderer; Phase 3)

Streams during a `forms:runMailMerge` invocation. Subscribe through the preload-exposed registration helper.

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
  latestWarning?: string; // most-recent warning, if any; accumulator lives in MailMergeValue.warnings
}
```

```ts
const unsubscribe = api.events.onMailMergeProgress((evt) => {
  console.log(
    `[${evt.jobId}] ${evt.phase} row ${evt.currentRow}/${evt.totalRows} (${evt.percent}%)`,
  );
});
// later:
unsubscribe();
```

The subscription is **per-jobId at the renderer**; the mail-merge slice keeps an in-flight job map keyed by `jobId` so multiple concurrent merges can stream independently (though the Phase 3 UI only initiates one at a time).

---

## Phase 4 channels — `signatures:*` and `annotations:*`

Phase 4 adds 10 IPC channels under two new namespaces. All 10 are LIVE in 0.4.2 — the PAdES path is end-to-end after the Phase 4.1 closure of Julian's Wave 17 B-17.1 finding (cert-store now retains PFX bytes + password buffer until `releaseHandle` zeroes them; the orchestrator's `try/finally { releaseHandle() }` envelope bounds the buffer window to one sign call). The full architectural contract lives at [`api-contracts.md §14`](api-contracts.md#14-phase-4-additions-2026-05-26-riley) (frozen Wave 15, with the Wave 17 + Phase 4.1 implementation refinements covered above).

`SignaturePlacement`, `VisualAppearanceSpec`, `PadesAppearanceSpec`, `SignaturePayload`, `ShapeAnnotationModel`, and `MeasureCalibration` live in [`data-models.md §9`](data-models.md). Schema v4 (`signature_audit_log`) DDL is at [`data-models.md §9.4`](data-models.md).

> **Sensitive payloads.** `signatures:certLoad` carries PFX bytes + password. See [`conventions.md §15`](conventions.md) for the five-rule discipline that handlers MUST follow when these payloads enter main — Buffer-wrap at the earliest synchronous opportunity, explicit `Buffer.fill(0)` in a `finally` block, no logging of the raw payload, no echo over IPC. Julian's Wave 17 mechanical greps verify the discipline; the cert-store is the SOLE module that touches raw PFX/password bytes.

### `signatures:certLoad` — **Live (Phase 4)**

Load a PFX/P12 cert blob + password into main-process memory and return an opaque handle. The PFX bytes + password are retained by the cert-store under the auto-release lifecycle (Phase 4.1 B-17.1 closure) — `releaseHandle` zeroes both buffers on the happy path AND every failure path.

| Field                  | Value                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Request                | `{ pfxBytes: Uint8Array, password: string }`                                                                    |
| Response               | `Result<{ handle, subjectCN, issuerCN, notBefore, notAfter, fingerprint, isExpired }, SignaturesCertLoadError>` |
| `handle`               | Opaque UUID v4; treat as opaque                                                                                 |
| `notBefore`/`notAfter` | ms epoch                                                                                                        |
| `fingerprint`          | SHA-256 hex of the cert (64 chars)                                                                              |
| Errors                 | `'invalid_payload'`, `'pfx_decode_failed'`, `'pfx_no_private_key'`, `'pfx_no_cert'`, `'wrong_password'`         |

```ts
const res = await api.signatures.certLoad({ pfxBytes, password });
if (res.ok) {
  // password is already zeroed in main; renderer should clear its own React state immediately
  setPasswordField('');
  setCertHandle(res.value.handle);
}
```

**Renderer hygiene**: clear the password React state field BEFORE awaiting this Promise. See [`user-guide.md` → PAdES trust floor](user-guide.md#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #2.

### `signatures:certRelease` — **Live (Phase 4)**

Explicitly zero + release a cert handle. Idempotent. Renderer fires this on modal close; `app.before-quit` fires it for any retained handle.

| Field      | Value                                                              |
| ---------- | ------------------------------------------------------------------ |
| Request    | `{ handle: string }`                                               |
| Response   | `Result<{ released: boolean }, 'invalid_payload'>`                 |
| `released` | `true` if handle existed and was released; `false` if already gone |

### `signatures:applyVisual` — **Live (Phase 4)**

Apply a visual signature (typed/drawn/image) to a `/Sig` placeholder field OR a freeform position. **Appearance only; no cert; no audit row.** Use `signatures:applyPades` for cryptographic identity.

| Field                    | Value                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request                  | `{ handle, placement: SignaturePlacement, appearance: VisualAppearanceSpec }`                                                                                                                |
| `placement.mode`         | `'placeholder'` (with `fieldName`) OR `'freeform'` (with `pageIndex` + `rect`)                                                                                                               |
| `appearance.source.kind` | `'typed'` (with name + PNG) \| `'drawn'` (with PNG) \| `'image'` (with bytes + mimeType)                                                                                                     |
| Response                 | `Result<{ op, warnings }, SignaturesApplyVisualError>`                                                                                                                                       |
| `op`                     | `EditOperationSerialized`, kind: `'signature-visual-place'`                                                                                                                                  |
| Errors                   | `'handle_not_found'`, `'invalid_payload'`, `'placeholder_field_not_found'`, `'placeholder_field_already_signed'`, `'invalid_placement'`, `'appearance_compose_failed'`, `'serialize_failed'` |

The engine writes an empty `/V <<>>` marker on the signature field to distinguish "visually-signed but not cryptographically signed" from "Phase 3 placeholder". See [`signature-engine.md §5.2`](signature-engine.md) for the R-W15-D distinction.

### `signatures:applyPades` — **Live (Phase 4 + 4.1 B-17.1 closure)**

Apply an ETSI EN 319 142 PAdES cryptographic signature. Detached PKCS#7 / CMS in `/Contents`. Optionally wraps with an RFC 3161 timestamp (TSA off by default — see [`user-guide.md` → PAdES trust floor](user-guide.md#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #3).

| Field               | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request             | `{ handle, placement, certHandle, appearance: PadesAppearanceSpec, tsaUrl: string \| null, reason?, location?, placeholderSize?, autoRelease? }`                                                                                                                                                                                                                                                                                                                                                                                                       |
| `tsaUrl`            | `null` = no TSA; non-null = attempt TSA (fail-loud on TSA failure)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `placeholderSize`   | `/Contents` hex placeholder size; default 16384; raise for long cert chains                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `autoRelease`       | release `certHandle` on completion; default `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Response            | `Result<{ op, auditLogRowId, signerSubjectCN, certFingerprint, signedAt, tsaResponseStatus, warnings }, SignaturesApplyPadesError>`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `auditLogRowId`     | newly-inserted row in `signature_audit_log`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tsaResponseStatus` | `'ok'` \| `'failed'` \| `null` (no TSA)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Errors              | `'handle_not_found'`, `'cert_handle_not_found'`, `'cert_expired'`, `'cert_not_yet_valid'`, `'invalid_payload'`, `'placeholder_field_not_found'`, `'placeholder_field_already_signed'`, `'invalid_placement'`, `'appearance_compose_failed'`, `'pades_sign_failed'`, `'pades_byte_range_failed'`, `'pades_placeholder_too_small'`, `'pades_invalidated_by_subsequent_edit'`, `'tsa_http_error'`, `'tsa_tls_error'`, `'tsa_timeout'`, `'tsa_invalid_response'`, `'tsa_nonce_mismatch'`, `'tsa_genTime_skew'`, `'serialize_failed'`, `'audit_log_failed'` |

**Engine choice:** `node-signpdf` primary (default), `node-forge` + `pkijs` manual fallback via `signatures.padesEngine: 'manual'`. Both engines satisfy the same external contract. Locked decision P4-L-3.

**TSA validation:** TSA URL must be `https://`, no userinfo, no fragment, bounded query. The 5-minute genTime skew check rejects TSAs with badly-skewed clocks.

### `signatures:requestTimestamp` — **Live (Phase 4)**

Standalone RFC 3161 TSA request. Used internally by `applyPades`; also exposed for the Settings "Test TSA URL" affordance.

| Field       | Value                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request     | `{ tsaUrl, hash: Uint8Array, timeoutMs? }`                                                                                                          |
| `hash`      | 32 bytes (SHA-256)                                                                                                                                  |
| `timeoutMs` | default 30000; max 600000                                                                                                                           |
| Response    | `Result<{ tsrBytes, tsTokenBytes, genTime, serialNumber }, SignaturesRequestTimestampError>`                                                        |
| Errors      | `'invalid_payload'`, `'tsa_http_error'`, `'tsa_tls_error'`, `'tsa_timeout'`, `'tsa_invalid_response'`, `'tsa_nonce_mismatch'`, `'tsa_genTime_skew'` |

### `signatures:verify` — **Live (Phase 4)**

Verify a signature applied BY THIS APP. **Informational; NOT a third-party trust verifier.** Re-hashes the current bytes over the byte-range stored in the audit row and compares to the messageDigest in the CMS envelope. Phase 4 makes no claim about the cert's CA trust chain. See [`user-guide.md` → PAdES trust floor](user-guide.md#pades-trust-floor--what-the-app-does-and-doesnt-promise) obligation #4.

| Field               | Value                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Request             | `{ handle, auditLogRowId }`                                                                                          |
| Response            | `Result<{ valid, tamperedSinceSign, certInfo, tsaInfo }, SignaturesVerifyError>`                                     |
| `valid`             | hash matches                                                                                                         |
| `tamperedSinceSign` | `doc_hash` from audit row !== SHA-256 of current bytes                                                               |
| `certInfo`          | `{ fingerprint, subjectCN, issuerCN, notBefore, notAfter, isExpiredNow }`                                            |
| `tsaInfo`           | `{ tsaUrl, genTime, valid }` OR `null`                                                                               |
| Errors              | `'handle_not_found'`, `'invalid_payload'`, `'audit_row_not_found'`, `'signature_not_in_document'`, `'verify_failed'` |

### `signatures:listAudit` — **Live (Phase 4)**

List rows from `signature_audit_log` with optional filters. Backed by Ravi's schema-v4 `signature_audit_log` repo.

| Field                 | Value                                                                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request               | `{ fileHash?, signedByFingerprint?, since?, until?, limit?, offset? }`                                                                                                                                                                                          |
| `fileHash`            | 64 char SHA-256 hex; filters by `doc_hash` OR `pre_sign_doc_hash`                                                                                                                                                                                               |
| `signedByFingerprint` | 64 char SHA-256 hex                                                                                                                                                                                                                                             |
| `limit`               | default 100                                                                                                                                                                                                                                                     |
| Response              | `Result<{ items: SignatureAuditItem[], total }, SignaturesListAuditError>`                                                                                                                                                                                      |
| `SignatureAuditItem`  | `{ id, docHash, preSignDocHash, signedAt, signatureKind, signedByFingerprint, signedBySubjectCN, signedByIssuerCN, certNotBefore, certNotAfter, tsaUrl, tsaResponseStatus, sigBytesOffset, sigBytesLength, byteRange, reason, location, fieldName, createdAt }` |
| Errors                | `'invalid_payload'`, `'db_unavailable'`                                                                                                                                                                                                                         |

`signatureKind` is `'visual' \| 'pades' \| 'pades-tsa'`. `sigBytesOffset` + `sigBytesLength` + `byteRange` are NULL for visual signatures.

### `annotations:addShape` — **Live (Phase 4)**

Author one of the seven new shape / line / callout / measure annotations. Returns an `EditOperation` (kind: `'annot-add-shape'`).

| Field                | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| Request              | `{ handle, annotation: ShapeAnnotationModel }`                                   |
| `annotation.subtype` | `'Square' \| 'Circle' \| 'Polygon' \| 'PolyLine' \| 'Line' \| 'FreeTextCallout'` |
| Response             | `Result<{ op, warnings }, AnnotationsAddShapeError>`                             |
| Errors               | `'handle_not_found'`, `'invalid_payload'`, `'out_of_range'`                      |

The full `ShapeAnnotationModel` type carries shape-specific fields — `vertices` for Polygon/PolyLine, `lineStart`/`lineEnd`/`lineStartStyle`/`lineEndStyle` for Line, `calloutText`/`calloutPointer` for FreeTextCallout, optional `measure` (unit + scale) for Line/PolyLine measure variants. See [`api-contracts.md §14.8`](api-contracts.md) for the full type.

### `annotations:setMeasureCalibration` + `annotations:getMeasureCalibration` — **Live (Phase 4)**

Per-document measure calibration. The `set` channel stores it in main memory keyed by `DocumentHandle`; on save the calibration is serialized into the first measure annotation's `/Measure` dict on the first measure-bearing page. There is one calibration per document.

```ts
interface MeasureCalibration {
  unit: 'inch' | 'cm' | 'mm' | 'pt' | 'px' | 'custom';
  customUnitLabel?: string; // when unit='custom'
  scale: number; // 1 PDF user-space unit = N <unit>
}
```

| Channel                             | Request                   | Response                                                                  | Errors |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------- | ------ |
| `annotations:setMeasureCalibration` | `{ handle, calibration }` | `Result<{}, 'handle_not_found' \| 'invalid_payload'>`                     | —      |
| `annotations:getMeasureCalibration` | `{ handle }`              | `Result<{ calibration: MeasureCalibration \| null }, 'handle_not_found'>` | —      |

### Phase 4 setting keys and data models

Phase 4 adds 11 typed setting keys (schema v4):

```ts
type SettingKey =
  // ...P1+P2+P3 keys...
  | 'signatures.tsaUrl' // string; default ''
  | 'signatures.tsaEnabled' // boolean; default false (P4-L-2)
  | 'signatures.tsaTimeoutMs' // number; default 30000
  | 'signatures.placeholderSize' // number (/Contents hex chars); default 16384
  | 'signatures.defaultShowDate' // boolean; default true
  | 'signatures.defaultShowSubjectCN' // boolean; default true (PAdES only)
  | 'signatures.padesEngine' // 'signpdf' | 'manual'; default 'signpdf'
  | 'annotations.defaultBorderWidth' // number, pt; default 1
  | 'annotations.defaultBorderStyle' // 'solid' | 'dashed' | 'dotted'; default 'solid'
  | 'annotations.defaultFillEnabled' // boolean; default false
  | 'annotations.defaultLineEndStyle'; // 'None' | 'OpenArrow' | 'ClosedArrow'; default 'OpenArrow'
```

Defaults documented at [`data-models.md §9.9`](data-models.md). The settings table layer is unchanged — same `app_settings` SQLite table; values are JSON-serialized on write.

Schema v4 also adds the `signature_audit_log` table (P4-L-6). Full DDL at [`data-models.md §9.4`](data-models.md). Migration `migrations/0004_phase4_signatures.sql` runs forward-only on first launch of 0.4.2.

---

## Phase 4.1 channel — `fs:readBytesByHandle`

### `fs:readBytesByHandle` — **Live (Phase 4.1)**

Renderer fetches the validated document bytes already held in main's `documentStore` by handle. Used by pdf.js to render pages + thumbnails. **Never accepts a path; trust derives from the opaque integer handle.** The motivating bug: `src/client/services/pdf-render.ts` was a Wave-2 stub for 14 waves because exposing paths to the renderer would violate the Phase 1 trust boundary; the bytes-by-handle channel keeps the boundary intact while letting the renderer render.

| Field     | Value                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'fs:readBytesByHandle'`                                                                                                                                                                                               |
| Direction | Renderer → Main (invoke / response)                                                                                                                                                                                    |
| Request   | `{ handle: DocumentHandle }` (positive integer)                                                                                                                                                                        |
| Response  | `Result<{ bytes: Uint8Array }, FsReadBytesByHandleError>`                                                                                                                                                              |
| Errors    | `'unknown_handle'` (never registered OR already closed — observably the same), `'document_evicted'` (reserved for future LRU; not currently produced), `'fs_read_failed'` (reserved for future on-disk-backed handles) |

```ts
const res = await api.fs.readBytesByHandle({ handle: doc.handle });
if (res.ok) {
  // ArrayBuffer is copied by Electron's structured-clone; renderer mutations cannot affect main's copy
  const pdf = await pdfjsLib.getDocument({ data: res.value.bytes }).promise;
}
```

**Behavior + security floor:**

- Looks up the document record in main's `documentStore` by handle; returns the stored bytes verbatim.
- Bytes were validated AT OPEN TIME by `dialog:openPdf` / `fs:readPdf` (sanitizePath + statFile + size cap + `%PDF-` header sniff via `loadPdfMetadata`). They are NOT re-validated on each read.
- The response keys are exactly `['bytes']` — path / fileHash / displayName never appear. The renderer cannot escalate to disk.
- Payload validation via zod (`safeParse`); same discipline as `signatures:certLoad`.

**Performance:**

- One-shot copy per call (Electron structured clone). Acceptable per the 500 MB max-file-size cap.
- Phase 5 may add a streaming variant or an LRU eviction policy; reserved error variant `document_evicted` already exists for the LRU case.

See [`api-contracts.md §15`](api-contracts.md#15-phase-41-additions-2026-05-26-david) for the architectural rationale.

---

## Phase 5 channels — `ocr:*` and `scan:*`

Phase 5 adds 9 IPC channels under two new namespaces plus 2 new event streams. All 7 `ocr:*` channels are LIVE end-to-end since 0.5.0. **As of 0.7.3, both `scan:*` channels are also LIVE on Windows** (the Phase 5.1 native WIA addon shipped in that release); on macOS / Linux they return `'scanner_unavailable'`. Full contract types at [`api-contracts.md §16`](api-contracts.md#16-phase-5-additions-2026-05-27-riley).

> **No secrets in Phase 5.** Unlike Phase 4's `signatures:certLoad` (which carries PFX bytes + password), the Phase 5 IPC surface carries no cryptographic material. The discipline of conventions §16 (new in Phase 5) is about **bytes-stay-in-main** and **OCR-output-trust-floor**, not secret-zeroing.

### `ocr:detectLanguages` — **Live**

List installed + downloadable language packs. The renderer calls this when the OCR wizard opens to populate the language picker, and when the language manager modal opens.

| Field     | Value                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'ocr:detectLanguages'`                                                                                                                                                       |
| Direction | Renderer → Main (invoke / response)                                                                                                                                           |
| Request   | `{}` (empty body)                                                                                                                                                             |
| Response  | `Result<{ installed: LanguagePack[]; downloadable: LanguagePackCatalogEntry[]; defaultLang: string }, OcrDetectLanguagesError>`                                               |
| Errors    | `'catalog_load_failed'` — `language-pack-catalog.json` missing or malformed in the packaged bundle (Julian H-21.2 surfaces this with `console.error` + `dialog.showErrorBox`) |

```ts
const res = await api.ocr.detectLanguages({});
if (res.ok) {
  console.log(
    'Installed:',
    res.value.installed.map((p) => p.lang),
  );
  console.log(
    'Downloadable:',
    res.value.downloadable.map((p) => p.lang),
  );
}
```

The renderer-facing `LanguagePack` DTO strips `filePath` per conventions §16.2 — only `lang`, `source`, `sizeBytes`, `sha256`, `installedAt`, `lastUsedAt`, `displayName` cross the IPC boundary.

### `ocr:runOnPage` — **Live**

Run OCR on a single page of the currently-open document. Short-running (≤30s typical); no progress events. Used by the "re-OCR this page" affordance (renderer-side; the channel is also used by Phase 5.1 tooling).

| Field     | Value                                                                                                                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'ocr:runOnPage'`                                                                                                                                                                                                                                                                                  |
| Direction | Renderer → Main (invoke / response)                                                                                                                                                                                                                                                                |
| Request   | `{ handle, pageIndex, langs: string[], preprocess: { deskew, denoise, contrastBoost }, invalidatesSignaturesConfirmed?: boolean }`                                                                                                                                                                 |
| Response  | `Result<{ pageResult: OcrPageResult; durationMs: number }, OcrRunOnPageError>`                                                                                                                                                                                                                     |
| Errors    | `'invalid_payload'`, `'handle_not_found'`, `'page_out_of_range'`, `'language_pack_not_installed'`, `'signed_pdf_requires_confirm'` (doc has prior PAdES signatures and confirm flag is false), `'pdf_render_failed'` (pdf.js rasterize failed), `'ocr_engine_failed'`, `'worker_watchdog_timeout'` |

```ts
const res = await api.ocr.runOnPage({
  handle: doc.handle,
  pageIndex: 0,
  langs: ['eng'],
  preprocess: { deskew: true, denoise: false, contrastBoost: false },
});
if (res.ok) console.log('Words:', res.value.pageResult.words.length);
```

### `ocr:runOnDocument` — **Live**

Run OCR on a page range. Long-running; emits `ocr:progress` events; returns the `EditOperationSerialized` + job summary on completion. The renderer's `<OcrRunModal>` is the canonical consumer.

| Field        | Value                                                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel      | `'ocr:runOnDocument'`                                                                                                                                                                                       |
| Direction    | Renderer → Main (invoke / response + event stream)                                                                                                                                                          |
| Request      | `{ handle, pageRange: { start, end }, langs, preprocess, invalidatesSignaturesConfirmed? }`                                                                                                                 |
| Response     | `Result<{ jobId, summary: OcrJobSummary, op: EditOperationSerialized }, OcrRunOnDocumentError>`                                                                                                             |
| Event stream | `ocr:progress` — see below                                                                                                                                                                                  |
| Errors       | `'invalid_payload'`, `'handle_not_found'`, `'page_range_out_of_range'`, `'language_pack_not_installed'`, `'signed_pdf_requires_confirm'`, `'ocr_engine_failed'`, `'output_serialize_failed'`, `'cancelled'` |

```ts
const unsubscribe = api.ocr.onProgress((event) => {
  if (event.phase === 'recognizing') {
    setProgress({ page: event.pageIndex, total: event.totalPages, conf: event.confidenceSoFar });
  }
});

try {
  const res = await api.ocr.runOnDocument({
    handle: doc.handle,
    pageRange: { start: 0, end: doc.pageCount - 1 },
    langs: ['eng'],
    preprocess: { deskew: true, denoise: false, contrastBoost: false },
    invalidatesSignaturesConfirmed: false,
  });
  if (res.ok) {
    dispatch(applyEdit(res.value.op));
    openOcrResultsPanel(res.value.summary);
  }
} finally {
  unsubscribe();
}
```

If `res.error === 'signed_pdf_requires_confirm'`, surface the confirm prompt, then re-issue the call with `invalidatesSignaturesConfirmed: true`.

### `ocr:progress` — **Live (event stream)**

Emitted during `ocr:runOnDocument`. Follows the existing Phase 3 `mail-merge:progress` pattern.

| Field     | Value                                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'ocr:progress'`                                                                                                                                                                                                                                           |
| Direction | Main → Renderer (event)                                                                                                                                                                                                                                    |
| Payload   | `OcrProgressEvent` (discriminated union by `phase`)                                                                                                                                                                                                        |
| Phases    | `'starting'`, `'rasterizing'`, `'preprocessing'`, `'recognizing'` (carries `confidenceSoFar: number \| null`), `'composing-text-behind-image'`, `'writing-output'`, `'completed'` (carries `summary`), `'cancelled'`, `'failed'` (carries `error: string`) |

```ts
const unsubscribe = api.ocr.onProgress((event) => {
  switch (event.phase) {
    case 'recognizing':
      setProgressLabel(`Page ${event.pageIndex + 1} of ${event.totalPages}`);
      break;
    case 'completed':
      setSummary(event.summary);
      break;
    case 'failed':
      setError(event.error);
      break;
  }
});
// Call unsubscribe() when the consumer unmounts.
```

The handler MUST debounce + throttle to ≤ 10 events/sec per `phase: 'recognizing'` page to avoid renderer-side rerender storms (conventions §16; Wave 19 design).

### `ocr:cancelJob` — **Live**

Cancel an in-flight OCR job. Idempotent. Graceful (between pages, not mid-page — mid-page cancellation is Phase 5.1+).

| Field     | Value                                                                       |
| --------- | --------------------------------------------------------------------------- |
| Channel   | `'ocr:cancelJob'`                                                           |
| Direction | Renderer → Main                                                             |
| Request   | `{ jobId: number }`                                                         |
| Response  | `Result<{ cancelled: boolean; pagesCompleted: number }, OcrCancelJobError>` |
| Errors    | `'invalid_payload'`, `'job_not_found'`, `'job_already_terminal'`            |

```ts
const res = await api.ocr.cancelJob({ jobId: currentJobId });
// res.value.cancelled is true if the cancel landed; false if the job was already terminal.
```

### `ocr:listJobs` — **Live**

List rows from `ocr_jobs` for the debugging / audit panel.

| Field     | Value                                                                                  |
| --------- | -------------------------------------------------------------------------------------- |
| Channel   | `'ocr:listJobs'`                                                                       |
| Direction | Renderer → Main                                                                        |
| Request   | `{ filters?: { docHash?, status?, since?, until? }; limit?: number; offset?: number }` |
| Response  | `Result<{ jobs: OcrJobRowDto[]; total: number }, 'invalid_payload'>`                   |
| Errors    | `'invalid_payload'`                                                                    |

### `ocr:languagePackDownload` — **Live**

Download a language pack from the upstream tessdata mirror (`tessdata.projectnaptha.com/4.0.0_fast/<lang>.traineddata.gz`). Verifies SHA-256 against the shipped catalog. Long-running; emits `ocr:languagePackDownload:progress` events.

| Field     | Value                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'ocr:languagePackDownload'`                                                                                                                                                    |
| Direction | Renderer → Main (invoke / response + event stream)                                                                                                                              |
| Request   | `{ lang: string }` (must match `/^[a-z]{3}(_[a-z]+)?$/i` and be in the shipped catalog)                                                                                         |
| Response  | `Result<{ pack: LanguagePack }, OcrLanguagePackDownloadError>`                                                                                                                  |
| Errors    | `'invalid_payload'`, `'lang_not_in_catalog'`, `'pack_already_installed'`, `'network_error'`, `'pack_integrity_failed'` (SHA-256 mismatch), `'disk_write_failed'`, `'cancelled'` |

```ts
const unsubscribe = api.ocr.onLanguagePackDownloadProgress((event) => {
  if (event.phase === 'downloading') {
    setProgress({ done: event.bytesDownloaded, total: event.totalBytes });
  }
});
const res = await api.ocr.languagePackDownload({ lang: 'spa' });
unsubscribe();
```

**Catalog status (resolved in 0.7.1):** v0.5.0–0.7.0 shipped sentinel SHA-256 values for the non-`eng` rows, so every non-English download returned `pack_integrity_failed`. The 0.7.1 backlog-fix wave computed real SHA-256 for all 9 downloadable packs (spa / fra / deu / por / ita / rus / chi_sim / chi_tra / jpn), so **multi-language download works.** The integrity check is unchanged — the handler still refuses any pack whose hash doesn't match the catalog. See [`developer-guide.md` → Release-engineering responsibility — language-pack catalog SHA-256](developer-guide.md#release-engineering-responsibility--language-pack-catalog-sha-256-b-211).

### `ocr:languagePackDownload:progress` — **Live (event stream)**

Emitted during `ocr:languagePackDownload`.

| Field     | Value                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'ocr:languagePackDownload:progress'`                                                                                                                                                              |
| Direction | Main → Renderer (event)                                                                                                                                                                            |
| Payload   | `OcrLanguagePackDownloadProgressEvent` (discriminated union by `phase`)                                                                                                                            |
| Phases    | `'starting'` (carries `totalBytes`), `'downloading'` (carries `bytesDownloaded`, `totalBytes`), `'verifying'`, `'completed'` (carries `pack`), `'cancelled'`, `'failed'` (carries `error: string`) |

### `ocr:languagePackRemove` — **Live**

Remove a previously-downloaded pack. Refuses to remove the bundled `eng` pack.

| Field     | Value                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'ocr:languagePackRemove'`                                                                                                       |
| Direction | Renderer → Main                                                                                                                  |
| Request   | `{ lang: string }`                                                                                                               |
| Response  | `Result<{ removed: boolean }, OcrLanguagePackRemoveError>`                                                                       |
| Errors    | `'invalid_payload'`, `'pack_not_installed'`, `'cannot_remove_bundled'` (bundled `eng` cannot be removed), `'disk_unlink_failed'` |

### `scan:listDevices` — **Live on Windows (0.7.3+); `scanner_unavailable` elsewhere**

Enumerates WIA devices via the native addon's `IWiaDevMgr2::EnumDeviceInfo` call. The renderer calls this when the scan modal opens (step 1) and when the user clicks Refresh.

| Field     | Value                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| Channel   | `'scan:listDevices'`                                                                            |
| Direction | Renderer → Main                                                                                 |
| Request   | `{}`                                                                                            |
| Response  | `Result<{ devices: ScanDevice[] }, ScanListDevicesError>`                                       |
| Errors    | `'scanner_unavailable'` (non-Windows / addon failed to load), `'enum_failed'` (WIA COM failure) |

`ScanDevice` shape: `{ deviceId: string; name: string; type: 'scanner' \| 'multi-function-peripheral' \| 'camera'; description: string }`.

The renderer's `<ScanModal>` pattern-matches `scanner_unavailable` to render the disabled menu tooltip on macOS / Linux. On Windows with a missing/broken addon the same variant is returned and the modal surfaces a recovery message (see [user-guide → Scanning from a device → Troubleshooting](user-guide.md#scanner-unavailable-or-scan-from-device-disabled-phase-51)).

### `scan:acquire` — **Live on Windows (0.7.3+); `scanner_unavailable` elsewhere**

Acquires one or more pages from the selected WIA device and composes them into a single PDF via pdf-lib. Returns a `DocumentHandle` registered in main's per-handle store (bytes never cross IPC); the renderer dispatches via the handle to open the document, save it, OCR it, etc.

| Field     | Value                                                                                                                                                                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'scan:acquire'`                                                                                                                                                                                                                                                                                     |
| Direction | Renderer → Main (async; runs on the addon's worker thread via `napi_create_async_work`)                                                                                                                                                                                                              |
| Request   | `{ deviceId: string; resolution?: number; colorMode?: 'bw' \| 'grayscale' \| 'color'; source?: 'flatbed' \| 'feeder'; maxPages?: number }`                                                                                                                                                           |
| Response  | `Result<{ handle: string; displayName: string; pageCount: number; warnings: string[] }, ScanAcquireError>`                                                                                                                                                                                           |
| Errors    | `'scanner_unavailable'`, `'invalid_payload'` (zod boundary), `'device_not_found'`, `'device_busy'`, `'paper_jam'`, `'feeder_empty'`, `'user_cancelled'`, `'acquisition_failed'` (driver returned zero pages or an error), `'page_decode_failed'` (BMP→PNG conversion failed), `'compose_pdf_failed'` |

Multi-page ADF runs return one composed PDF with all pages in order. The PDF is registered as a fresh document handle (NOT a mutation of any existing open document); chaining `ocr.runOnDocument({handle})` on the returned handle is the canonical scan→searchable-PDF flow.

---

## Phase 5 setting keys and data models

**Phase 5 setting keys added in schema v5** (see [`data-models.md §10`](data-models.md) and [`src/db/types.ts:381`](../src/db/types.ts) `SettingKey`):

```ts
type SettingKey =
  // ...P1+P2+P3+P4 keys...
  | 'ocr.defaultLang' // string; default 'eng'; must be one of installed pack langs
  | 'ocr.lowConfidenceThreshold' // number; default 60; range 0..100; applied at render time (raw confidences preserved)
  | 'ocr.rasterDpi' // number; default 300; range 72..600
  | 'ocr.maxConcurrentLanguages' // number; default 4; range 1..8 (LRU eviction past the cap)
  | 'ocr.workerWatchdogSec' // number; default 60; range 10..600 (per-page recognition timeout)
  | 'ocr.preprocess.deskew' // boolean; default true
  | 'ocr.preprocess.denoise' // boolean; default false
  | 'ocr.preprocess.contrastBoost' // boolean; default false
  | 'ocr.denoise.kernel' // number; default 3; odd integers 3..9 (bilateral filter kernel)
  | 'ocr.showConfidenceOverlayByDefault' // boolean; default false (overlay starts ON for docs with OCR results)
  | 'ocr.confirmInvalidateSignaturesOnce'; // boolean; default false; per-session only (conventions §16.5 — never permanent)
```

**Phase 5 EditOperation variants** (mirrored across `data-models.md §10.3` + `src/ipc/contracts.ts`):

```ts
type EditOperation =
  // ...P1-P4 variants...

  | {
      kind: 'ocr-text-behind-applied';
      meta: EditMeta;
      jobId: number; // FK to ocr_jobs.id
      pageRange: { start: number; end: number };
      langs: string[];
      meanConfidence: number;
      totalWordsRecognized: number;
      invalidatesSignatures: boolean; // true if any PAdES widget was present pre-OCR
    }
  | {
      kind: 'ocr-text-behind-removed';
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

**Phase 5 schema v5 amendments** (additive):

| Table                 | Change                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ocr_jobs`            | NEW — per-run state (`status`, `page_range`, `langs`, `started_at`, `completed_at`, `mean_confidence`, `total_words`, `error_message`, `invalidated_signatures`, `created_at`) |
| `ocr_results`         | NEW — per-page summary + words JSON (`job_id`, `page_index`, `total_words`, `low_confidence_words`, `mean_confidence`, `words_json`)                                           |
| `language_packs`      | NEW — installed-pack manifest (`lang`, `source`, `file_path`, `size_bytes`, `sha256`, `installed_at`, `last_used_at`)                                                          |
| `signature_audit_log` | AMENDED — additive nullable column `invalidated_by_ocr_job_id INTEGER REFERENCES ocr_jobs(id)`. Pre-Phase-5 rows have it NULL = "not invalidated by OCR"                       |

Full DDL in [`data-models.md §10`](data-models.md). Migration at [`migrations/0005_phase5_ocr.sql`](../migrations/0005_phase5_ocr.sql).

---

## Phase 6 channels — `export:*` and `dialog:pickExportOutputPath`

Phase 6 adds 8 IPC channels under the new `export:*` namespace, 1 dialog channel (`dialog:pickExportOutputPath`), and 1 event stream (`export:progress`). Full contract types at [`api-contracts.md §17`](api-contracts.md#17-phase-6-additions-2026-05-27-riley).

> **No secrets in Phase 6.** Like Phase 5, the Phase 6 IPC surface carries no cryptographic material. The discipline of conventions §17 is about **read-only-on-source** (export never mutates the source PDF, never updates `signature_audit_log`, never inserts `edit_history`) and **export-bytes-stay-in-main** (the renderer never receives a `Uint8Array` of export output; the `ExportJobRowDto` strips the absolute path to `outputBasename` + `outputDirHint`).

> **Channel status (read this):** `export:toXlsx` is LIVE end-to-end (Diego Wave 25 packaged-binary `.xlsx` proof). `export:toDocx` / `export:toPptx` / `export:toImages` are LIVE-pending-source-loader-wire — the engine + writers run end-to-end against synthetic data, but production extraction throws `'extraction_failed'` until David Wave 25.1 wires `createProdSourceLoader`. The support channels (`cancelJob` / `listJobs` / `listFormats`) and `dialog:pickExportOutputPath` are LIVE.

### `export:toDocx` — **Live engine; Live-pending source-loader**

Run a PDF → Word (.docx) export job. Long-running; emits `export:progress` events; returns the `ExportJobSummary` on completion.

| Field        | Value                                                                                                                                                                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel      | `'export:toDocx'`                                                                                                                                                                                                                                                                                                    |
| Direction    | Renderer → Main (invoke / response + event stream)                                                                                                                                                                                                                                                                   |
| Request      | `{ handle, pageRange: { start, end }, qualityTier: 'text-only' \| 'layout-preserving', includeAnnotations, pageSize: 'letter' \| 'a4' \| 'auto', outputPath }`                                                                                                                                                       |
| Response     | `Result<{ jobId: number; summary: ExportJobSummary }, ExportToDocxError>`                                                                                                                                                                                                                                            |
| Event stream | `export:progress` — see below                                                                                                                                                                                                                                                                                        |
| Errors       | `'invalid_payload'`, `'handle_not_found'`, `'page_range_out_of_range'`, `'output_path_unwritable'`, `'queue_full'`, `'extraction_failed'` (pdf.js / pdf-lib error during text/operator extraction — **this is what the source-loader stub throws today**), `'writer_failed'`, `'output_write_failed'`, `'cancelled'` |

```ts
const unsubscribe = api.export.onProgress((e) => {
  if (e.jobId === jobId && e.phase === 'extracting-text') setPage(e.pageIndex, e.totalPages);
});
try {
  const res = await api.export.toDocx({
    handle: doc.handle,
    pageRange: { start: 0, end: doc.pageCount - 1 },
    qualityTier: 'layout-preserving',
    includeAnnotations: true,
    pageSize: 'auto',
    outputPath, // from dialog:pickExportOutputPath
  });
  if (res.ok) openExportsPanel(res.value.summary);
  else if (res.error === 'extraction_failed')
    showToast('Export engine not yet wired for Word (Phase 6.1).');
} finally {
  unsubscribe();
}
```

### `export:toXlsx` — **Live (end-to-end)**

Run a PDF → Excel (.xlsx) export job. Long-running. **This is the production-verified channel** (Diego Wave 25 packaged-binary proof).

| Field     | Value                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'export:toXlsx'`                                                                                                   |
| Direction | Renderer → Main (invoke / response + event stream)                                                                  |
| Request   | `{ handle, pageRange, qualityTier, includeAnnotations, outputPath }` (default `includeAnnotations: false` for xlsx) |
| Response  | `Result<{ jobId: number; summary: ExportJobSummary }, ExportToXlsxError>`                                           |
| Errors    | same union as `export:toDocx`                                                                                       |

```ts
const res = await api.export.toXlsx({
  handle: doc.handle,
  pageRange: { start: 0, end: doc.pageCount - 1 },
  qualityTier: 'text-only',
  includeAnnotations: false,
  outputPath,
});
if (res.ok)
  console.log(
    'Wrote',
    res.value.summary.outputBasename,
    res.value.summary.outputSizeBytes,
    'bytes',
  );
```

### `export:toPptx` — **Live engine; Live-pending source-loader**

Run a PDF → PowerPoint (.pptx) export job. Long-running. One slide per page; 16:9 widescreen with letterboxing.

| Field     | Value                                                                     |
| --------- | ------------------------------------------------------------------------- |
| Channel   | `'export:toPptx'`                                                         |
| Direction | Renderer → Main (invoke / response + event stream)                        |
| Request   | `{ handle, pageRange, qualityTier, includeAnnotations, outputPath }`      |
| Response  | `Result<{ jobId: number; summary: ExportJobSummary }, ExportToPptxError>` |
| Errors    | same union as `export:toDocx`                                             |

### `export:toImages` — **Live engine; Live-pending source-loader**

Run a PDF → image export job. Format selected via the `format` field. Multi-page emits per-page progress.

| Field     | Value                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'export:toImages'`                                                                                                                                                                                                                                            |
| Direction | Renderer → Main (invoke / response + event stream)                                                                                                                                                                                                             |
| Request   | `{ handle, pageRange, format: 'png' \| 'jpeg' \| 'tiff', dpi (72-600), jpegQuality? (0.1-1.0; jpeg only), multiPageTiff? (tiff only), includeAnnotations, outputPath }`                                                                                        |
| Response  | `Result<{ jobId: number; summary: ExportJobSummary; outputPaths: string[] }, ExportToImagesError>`                                                                                                                                                             |
| Errors    | `'invalid_payload'`, `'handle_not_found'`, `'page_range_out_of_range'`, `'output_path_unwritable'`, `'queue_full'`, `'rasterize_failed'` (pdfjs render error), `'encode_failed'` (canvas.toBuffer / utif.encode error), `'output_write_failed'`, `'cancelled'` |

`outputPaths` has ONE entry per page for single-page formats (PNG / JPEG / single-page TIFF) and ONE entry total for multi-page TIFF. `multiPageTiff` is honored ONLY when `format='tiff'` (silently ignored otherwise — documented behavior, not an error). `jpegQuality` is honored ONLY when `format='jpeg'`.

### `export:progress` — **Live (event stream)**

Emitted during all four `export:to*` channels. Follows the Phase 3 `mail-merge:progress` / Phase 5 `ocr:progress` patterns.

| Field     | Value                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'export:progress'`                                                                                                                                                                                                                                                                                                                                                                                                                |
| Direction | Main → Renderer (event)                                                                                                                                                                                                                                                                                                                                                                                                            |
| Payload   | `ExportProgressEvent` (discriminated union by `phase`)                                                                                                                                                                                                                                                                                                                                                                             |
| Phases    | `'starting'` (carries `totalPages`), `'extracting-text'` (carries `pageIndex`, `totalPages`), `'detecting-tables'`, `'extracting-images'`, `'rasterizing'` (image format only), `'writing-output'` (carries `bytesWritten`, `totalBytesEstimate: number \| null`), `'completed'` (carries `summary`), `'cancelled'` (carries `pagesCompleted`, `totalPages`), `'failed'` (carries `pagesCompleted`, `totalPages`, `error: string`) |

```ts
const unsubscribe = api.export.onProgress((event) => {
  switch (event.phase) {
    case 'extracting-text':
      setLabel(`Page ${event.pageIndex + 1} of ${event.totalPages}`);
      break;
    case 'completed':
      setSummary(event.summary);
      break;
    case 'failed':
      setError(event.error);
      break;
  }
});
// Call unsubscribe() when the consumer unmounts.
```

The handler MUST debounce + throttle to ≤ 10 events/sec per `phase` per page to avoid renderer rerender storms (mirrors Phase 5 throttling discipline).

### `export:cancelJob` — **Live**

Cancel an in-flight export job. Idempotent. Partial output on disk (the `.export-temp` file) is deleted.

| Field     | Value                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Channel   | `'export:cancelJob'`                                                                                      |
| Direction | Renderer → Main                                                                                           |
| Request   | `{ jobId: number }`                                                                                       |
| Response  | `Result<{ cancelled: boolean; pagesCompleted: number }, ExportCancelJobError>`                            |
| Errors    | `'invalid_payload'`, `'job_not_found'`, `'job_already_terminal'` (already completed / cancelled / failed) |

`cancelled` is `true` if a running/queued job was cancelled; `false` if it was already terminal. Graceful (between per-page steps, not mid-page-write).

### `export:listJobs` — **Live**

List rows from `export_jobs` for the Exports sidebar tab + audit.

| Field     | Value                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Channel   | `'export:listJobs'`                                                                                     |
| Direction | Renderer → Main                                                                                         |
| Request   | `{ filters?: { docHash?, format?, status?, since?, until? }; limit? (default 100, max 1000); offset? }` |
| Response  | `Result<{ jobs: ExportJobRowDto[]; total: number }, 'invalid_payload'>`                                 |
| Errors    | `'invalid_payload'`                                                                                     |

`ExportJobRowDto` strips the absolute `output_path` to `outputBasename` + `outputDirHint` per conventions §17.2. Show-in-folder dispatches by `jobId`, NOT by raw path.

### `export:listFormats` — **Live (infallible)**

Returns the static format catalog the renderer uses to render the format picker + per-format defaults. Compiled in; no DB read.

| Field     | Value                                                                            |
| --------- | -------------------------------------------------------------------------------- |
| Channel   | `'export:listFormats'`                                                           |
| Direction | Renderer → Main                                                                  |
| Request   | `{}` (empty body)                                                                |
| Response  | `Result<{ formats: ExportFormatDescriptor[] }, 'never'>` (handler is infallible) |

`ExportFormatDescriptor`: `{ format, displayName, defaultExtension, category: 'office' \| 'image', supportsQualityTier, defaultQualityTier, defaultIncludeAnnotations, settingKeys: string[] }`. Six entries: docx, xlsx, pptx, png, jpeg, tiff.

### `dialog:pickExportOutputPath` — **Live**

Main-process file SAVE-AS dialog for export output. Structurally mirrors Phase 1's `dialog:pickSavePath` / Phase 2's `dialog:pickPdfSavePath`.

| Field     | Value                                                       |
| --------- | ----------------------------------------------------------- |
| Channel   | `'dialog:pickExportOutputPath'`                             |
| Direction | Renderer → Main                                             |
| Request   | `{ defaultBasename: string; format: ExportFormat }`         |
| Response  | `Result<{ outputPath: string \| null }, 'invalid_payload'>` |
| Errors    | `'invalid_payload'`                                         |

The default extension + dialog filter are derived from `format` (catalog-driven; never hardcoded). `outputPath` is `null` if the user cancelled.

```ts
const res = await api.dialog.pickExportOutputPath({ defaultBasename: 'my-doc', format: 'docx' });
if (res.ok && res.value.outputPath) startExport(res.value.outputPath);
```

### Phase 6 validation responsibilities (extends §10 / §14.12 / §16.13)

Phase 6 handlers MUST:

- Validate `pageRange.start <= pageRange.end < doc.pageCount` before any expensive extraction.
- Validate `format` against the static catalog. Mismatches = `invalid_payload`.
- For `export:toImages`, validate `dpi ∈ [72, 600]`; `jpegQuality ∈ [0.1, 1.0]` (when jpeg); `multiPageTiff` honored only when tiff.
- Probe `fs.access(parentDir, W_OK)` BEFORE inserting the `export_jobs` row; reject with `output_path_unwritable` early.
- Enforce `export.maxQueueSize`; reject new enqueues with `queue_full` at the cap (HARD CAP today; FIFO queue in Phase 6.1).
- Be read-only on the source PDF — NO writes to the source's bytes, NO `signature_audit_log` updates, NO `edit_history` inserts (P6-L-9).

---

## Phase 6 setting keys and data models

**Phase 6 setting keys added in schema v6** (see [`data-models.md §11.6`](data-models.md) and [`src/db/types.ts:502-518`](../src/db/types.ts) `SettingKey`):

```ts
type SettingKey =
  // ...P1+P2+P3+P4+P5 keys...
  | 'export.docx.qualityTier' // 'text-only' | 'layout-preserving'; default 'layout-preserving' (Q-D)
  | 'export.docx.pageSize' // 'letter' | 'a4' | 'auto'; default 'auto'
  | 'export.docx.includeAnnotations' // boolean; default true
  | 'export.xlsx.qualityTier' // 'text-only' | 'layout-preserving'; default 'text-only' (Q-D)
  | 'export.xlsx.includeAnnotations' // boolean; default false
  | 'export.pptx.qualityTier' // 'text-only' | 'layout-preserving'; default 'layout-preserving' (Q-D)
  | 'export.pptx.includeAnnotations' // boolean; default true
  | 'export.image.format' // 'png' | 'jpeg' | 'tiff'; default 'png'
  | 'export.image.dpi' // number 72..600; default 150
  | 'export.image.jpegQuality' // number 0.1..1.0; default 0.9
  | 'export.image.multiPageTiff' // boolean; default false
  | 'export.image.includeAnnotations' // boolean; default true
  | 'export.layout.lineEpsilonPt' // number; default 2 (paragraph Y-clustering ε)
  | 'export.layout.paragraphBreakRatio' // number; default 1.5
  | 'export.layout.headingRatio' // number; default 1.3
  | 'export.layout.columnGapPt' // number; default 40 (column X-gap threshold)
  | 'export.maxQueueSize'; // number; default 50
```

**Phase 6 introduces NO new EditOperation variant.** Export does not produce an edit; the `EditOperation` discriminated union is FROZEN by Phase 6. The replay engine is unchanged.

**`ExportJobSummary`** (success payload from the four `export:to*` channels):

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
  contentStats: {
    paragraphsExtracted: number;
    tablesDetected: number;
    imagesEmbedded: number;
  } | null;
  /** Nullable + late-init (Phase 5 lesson reaffirmed). Null until export starts; populated incrementally during run. */
  perPageProgress: Array<{ pageIndex: number; phase: string; completedAt: number | null }> | null;
}
```

**Anti-sentinel discipline:** `contentStats`, `perPageProgress`, and the `ExportJobRowDto` fields `imageOptions` / `outputSizeBytes` / `completedAt` / `durationMs` / `errorMessage` are all `T | null`. Consumers pattern-match on `null` for the "not yet" state; they NEVER read a sentinel zero / empty-string.

**Phase 6 schema v6 amendment** (additive only):

| Table                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export_jobs`        | NEW — per-job state (`doc_hash`, `format`, `quality_tier`, `page_range_start/end`, `include_annotations`, `dpi`, `jpeg_quality`, `multi_page_tiff`, `output_path`, `output_size_bytes`, `status`, `started_at`, `completed_at`, `duration_ms`, `pages_processed`, `paragraphs_extracted`, `tables_detected`, `images_embedded`, `error_message`, `created_at`). 3 indexes on `doc_hash` / `status` / `format`. Nullable fields throughout (anti-sentinel) |
| `settings`           | 17 INSERT OR IGNORE rows for per-format defaults (above)                                                                                                                                                                                                                                                                                                                                                                                                  |
| All Phase 1-5 tables | UNCHANGED — no new column on any prior table (Phase 6 is read-only on source; cross-checked against P6-L-9)                                                                                                                                                                                                                                                                                                                                               |

Full DDL in [`data-models.md §11`](data-models.md). Migration at [`migrations/0006_phase6_export.sql`](../migrations/0006_phase6_export.sql).

---

## Phase 7 channels — `update:*`, `telemetry:*`, `i18n:*`

Phase 7 adds 8 IPC channels under three new namespaces plus 1 event stream (`update:onProgress`). Full contract types at [`api-contracts.md §18`](api-contracts.md#18-phase-7-additions-2026-05-27-riley).

> **No secrets in Phase 7.** Like Phase 5 + 6, the Phase 7 IPC surface carries no cryptographic material. The two disciplines that matter here: **telemetry never carries PII / document content / file paths** (the `.strict()` schema is the structural enforcer), and **the update controller returns the honest result of a real network call against the real release feed** (never a fabricated "up to date"). Earlier 0.7.0–0.7.1 builds returned `'update_not_configured'` because the bundled `app-update.yml` carried a `PLACEHOLDER` owner/repo; that short-circuit is gone in 0.7.2+ binaries published from the official CI workflow.

> **Channel status (read this, current at 0.7.6):** `update:*` is LIVE end-to-end against the real `SuperiorAg/PDF_Viewer_Editor` GitHub release feed (since 0.7.2). `update:check` returns `up-to-date` / `update-available` / a real feed/network error — never a fabricated status. `update:download` works. `update:install` is gated on a code-signing certificate (`electron-updater` correctly refuses to apply an unsigned bundle); it returns `signature_verification_failed` (or an equivalent install-time error) until a cert is provisioned. `telemetry:*` is LIVE end-to-end (in-memory only; nothing leaves the machine). `i18n:*` is LIVE.

### `update:check` — **Live (real feed since 0.7.2)**

Check the configured release feed for an available update. Explicit (About-modal button) OR auto (only when `settings.update.channel === 'check-on-launch'`, default `'manual'`).

| Field     | Value                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'update:check'`                                                                                                                                                |
| Direction | Renderer → Main (invoke / response)                                                                                                                             |
| Request   | `{ trigger: 'explicit' \| 'launch' }` (`'launch'` callers MUST have verified the channel setting first)                                                         |
| Response  | `Result<{ status: UpdateStatus; availableVersion: string \| null; currentVersion: string; lastCheckedAt: number }, UpdateCheckError>`                           |
| Errors    | `'invalid_payload'`, `'update_not_configured'` (publish target is a PLACEHOLDER — **HONEST, not a fake up-to-date**), `'network_failed'`, `'feed_parse_failed'` |

`UpdateStatus` = `'idle' \| 'checking' \| 'available' \| 'downloading' \| 'downloaded' \| 'up-to-date' \| 'error' \| 'not-configured'`. `availableVersion` is `null` unless `status === 'available'` (NO sentinel `''`).

```ts
const res = await api.update.check({ trigger: 'explicit' });
if (res.ok && res.value.status === 'not-configured') showNotice('Update channel not configured.'); // honest placeholder; never a fake "up to date"
```

### `update:download` — **Live controller; placeholder feed**

Download the available update bundle. NEVER auto-invoked — always user-initiated after `update:check` reports `available`. Emits progress via `update:onProgress`.

| Field     | Value                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'update:download'`                                                                                                                                                                                                    |
| Direction | Renderer → Main (invoke / response + event stream)                                                                                                                                                                     |
| Request   | `{ version: string }` (the `availableVersion` from a prior check — guards stale UI)                                                                                                                                    |
| Response  | `Result<{ status: 'downloaded'; version: string }, UpdateDownloadError>`                                                                                                                                               |
| Errors    | `'invalid_payload'`, `'update_not_configured'`, `'no_update_available'`, `'download_failed'`, `'signature_verification_failed'` (bundle signature invalid — the cert dependency, P7-L-2; verification is NOT disabled) |

### `update:install` — **Live controller; placeholder feed**

Quit and install a downloaded update. User-initiated ("Restart and install"). Triggers `autoUpdater.quitAndInstall()`; the app exits.

| Field     | Value                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Channel   | `'update:install'`                                                                                                                                                                                           |
| Direction | Renderer → Main (invoke / response)                                                                                                                                                                          |
| Request   | `{ version: string; confirmedDiscardUnsaved?: boolean }` — `version` must match the downloaded version; `confirmedDiscardUnsaved` (added 0.7.1) tells the gate the user has accepted discarding unsaved work |
| Response  | `Result<{ quitting: true }, UpdateInstallError>`                                                                                                                                                             |
| Errors    | `'invalid_payload'`, `'no_downloaded_update'`, `'install_failed'`, `'unsaved_work_blocks_install'` (added 0.7.1 — there is unsaved work and `confirmedDiscardUnsaved` was not set; NO quit is scheduled)     |

The handler returns `ok({ quitting: true })` immediately, then schedules `quitAndInstall` on the next tick — the renderer observes the ok before the process exits.

**Unsaved-work gate (0.7.1, Julian H-29.1 / H-FIX.1).** After the configured + version-match guards but before the irreversible quit, the controller refuses with `unsaved_work_blocks_install` when there is unsaved work and `confirmedDiscardUnsaved` is not `true`. Because dirty state is renderer-owned, the production renderer is the live trigger: it checks `selectIsDirty` before calling `install` and opens a Save / Discard / Cancel confirm; the main-side gate is defense-in-depth (production passes `hasUnsavedWork: () => false`). **Honest binary note:** this gate is correct in the source; the v0.7.1 packaged binary likely predates the final renderer wire, but the install path is unreachable until a real publish target is configured, so functional impact is zero and the gate activates with the first build after a real channel lands. See the [developer guide → Auto-update architecture](developer-guide.md#auto-update-architecture-phase-7).

### `update:onProgress` — **Live (event stream)**

Emitted during `update:download`. Mirrors the OCR/export progress-emit pattern.

| Field     | Value                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'update:onProgress'`                                                                                                      |
| Direction | Main → Renderer (event)                                                                                                    |
| Payload   | `UpdateProgressEvent` = `{ version: string; percent: number; bytesPerSecond: number; transferred: number; total: number }` |

```ts
const unsubscribe = api.update.onProgress((e) => setDownloadPercent(e.percent));
// call unsubscribe() when the consumer unmounts
```

### `telemetry:recordEvent` — **Live**

Record an allowlisted anonymous usage event. The renderer's opt-in gate already dropped the event if opt-in is OFF; the handler **re-checks** opt-in server-side and re-validates the name against the static allowlist.

| Field     | Value                                                                                                                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'telemetry:recordEvent'`                                                                                                                                                                                                                                       |
| Direction | Renderer → Main (invoke / response)                                                                                                                                                                                                                             |
| Request   | `{ name: TelemetryEventName; dayBucket: string }` — **the zod schema is `.strict()`; NO other field is permitted** (no doc content, no file paths, no field values, no user id). `dayBucket` is `'YYYY-MM-DD'` (sub-day timestamps rejected — anti-fingerprint) |
| Response  | `Result<{ recorded: boolean }, TelemetryRecordEventError>` (`recorded: false` when dropped)                                                                                                                                                                     |
| Errors    | `'invalid_payload'` (the `.strict()` rejection — any extra property → here), `'not_opted_in'` (opt-in OFF; dropped before buffering), `'not_allowlisted'` (name not in the 16-event allowlist; dropped)                                                         |

> **Privacy contract (the structural PII guard):** the request shape PHYSICALLY cannot carry PII — there is no free-text field, no path field, no value field, and `.strict()` rejects any extra property. A leak cannot be introduced by a careless call site; it fails `safeParse` as `invalid_payload`. Test-proven: `{ name, dayBucket, userId: 'x' }` / `filePath` / `docTitle` / sub-day-timestamp all → `invalid_payload`, and the rejected payload is never echoed in the error message. The handler NEVER logs the event payload.

`TelemetryEventName` is a closed 16-member allowlist: `'app.launch' | 'doc.open' | 'doc.save' | 'feature.annotate.add' | 'feature.page.reorder' | 'feature.combine.run' | 'feature.form.fill' | 'feature.mailmerge.run' | 'feature.sign.pades' | 'feature.ocr.run' | 'feature.export.docx' | 'feature.export.xlsx' | 'feature.export.pptx' | 'feature.export.image' | 'feature.update.checked' | 'feature.locale.changed'`.

### `telemetry:setOptIn` — **Live**

Set the telemetry opt-in flag (persists to `settings.telemetry.optIn`, default `false`). Turning opt-in OFF also clears the in-memory ring buffer.

| Field     | Value                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'telemetry:setOptIn'`                                                                                                |
| Direction | Renderer → Main (invoke / response)                                                                                   |
| Request   | `{ optIn: boolean }`                                                                                                  |
| Response  | `Result<{ optIn: boolean; bufferCleared: boolean }, TelemetrySetOptInError>` (`bufferCleared: true` when turning OFF) |
| Errors    | `'invalid_payload'`, `'settings_write_failed'`                                                                        |

### `telemetry:getStatus` — **Live**

Return the current opt-in state + buffer snapshot (for the Settings toggle + the debug panel that makes the opt-in auditable).

| Field     | Value                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel   | `'telemetry:getStatus'`                                                                                                                           |
| Direction | Renderer → Main (invoke / response)                                                                                                               |
| Request   | `{ includeBuffer: boolean }` (debug panel passes `true`)                                                                                          |
| Response  | `Result<{ optedIn: boolean; bufferedCount: number; lastEventAt: number \| null; buffer: Array<{ name; dayBucket }> \| null }, 'invalid_payload'>` |
| Errors    | `'invalid_payload'`                                                                                                                               |

`lastEventAt` is nullable + late-init (NO sentinel 0). `buffer` is present only when `includeBuffer === true` — it is the debug-panel auditable snapshot (event name + day bucket only; no PII column is structurally possible).

### `i18n:setLocale` — **Live**

Persist the selected locale (`settings.i18n.locale`, default `'en-US'`). The renderer applies it live via `i18next.changeLanguage`; this channel only persists.

| Field     | Value                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Channel   | `'i18n:setLocale'`                                                                                     |
| Direction | Renderer → Main (invoke / response)                                                                    |
| Request   | `{ locale: 'en-US' \| 'es-ES' }`                                                                       |
| Response  | `Result<{ locale: AppLocale }, I18nSetLocaleError>`                                                    |
| Errors    | `'invalid_payload'`, `'unsupported_locale'` (locale not in `supportedLngs`), `'settings_write_failed'` |

### `i18n:getAvailableLocales` — **Live (infallible)**

Return the supported locales so the picker is data-driven (NOT hardcoded). Each entry carries a `complete` flag so the UI labels the proof locale honestly.

| Field     | Value                                                                            |
| --------- | -------------------------------------------------------------------------------- |
| Channel   | `'i18n:getAvailableLocales'`                                                     |
| Direction | Renderer → Main (invoke / response)                                              |
| Request   | `{}` (empty body)                                                                |
| Response  | `Result<{ locales: LocaleDescriptor[] }, never>` (always succeeds — static list) |

`LocaleDescriptor` = `{ locale: AppLocale; nativeName: string; complete: boolean }`. Returns `[{ 'en-US', 'English (US)', complete: true }, { 'es-ES', 'Español (España)', complete: false }]`. **The `complete: false` flag is load-bearing for trust-floor obligation #4** — the picker shows "translation sample, some strings may appear in English" beneath the proof locale.

### Phase 7 validation responsibilities (extends §10 / §14.12 / §16.13 / §17.11)

Phase 7 handlers MUST:

- **`update:*`** — gate every call on the placeholder check FIRST; return `update_not_configured` (NOT a fake `up-to-date`) when the `publish` block is a placeholder. `update:download` validates the `version` matches the last `available` check (guards stale UI); `update:install` validates a download exists for that version. Signature verification stays ON (`signature_verification_failed` for unsigned bundles).
- **`telemetry:recordEvent`** — zod schema is `.strict()` (rejects ANY extra property — the structural PII guard). Re-check opt-in server-side (`not_opted_in` → `recorded: false`); re-validate the name against the static allowlist (`not_allowlisted` → `recorded: false`). NEVER log the event payload. NEVER accept a timestamp finer than a day bucket.
- **`telemetry:setOptIn`** — turning opt-in OFF MUST clear the ring buffer (no orphaned events survive opt-out).
- **`i18n:setLocale`** — validate `locale ∈ supportedLngs`; reject others with `unsupported_locale`.

---

## Phase 7 setting keys and data models

**Phase 7 setting keys added in schema v7** (see [`data-models.md §12`](data-models.md) and [`src/db/types.ts`](../src/db/types.ts) `SettingKey`):

```ts
type SettingKey =
  // ...P1+P2+P3+P4+P5+P6 keys...
  | 'telemetry.optIn' // boolean; default false (OFF by design — P7-L-3)
  | 'i18n.locale' // 'en-US' | 'es-ES'; default 'en-US'
  | 'update.channel' // 'manual' | 'check-on-launch'; default 'manual' (no auto-check vs placeholder)
  | 'update.lastCheckedAt'; // number | null; default null (nullable + late-init; NEVER sentinel 0)
```

**Anti-sentinel discipline:** `update.lastCheckedAt` seeds as JSON `null` (raw storage value `'null'`), NOT `0` — a sentinel `0` would render "Jan 1 1970" in the About modal (the four-times-bitten 2026-05-26 lesson). `SettingValue<'update.lastCheckedAt'>` is `number | null`.

**Phase 7 introduces NO new EditOperation variant** (Phase 7 produces no edit) and **NO new in-memory document model**. The `EditOperation` discriminated union is FROZEN.

**Phase 7 schema v7 amendment** (the smallest migration in the project):

| Table                | Change                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_settings`       | 4 INSERT OR IGNORE rows for the Phase-7 keys (above). The migration uses the real table name `app_settings` (the data-models §12.1 spec text writes `settings`; the canonical name from `0001_init.sql` is `app_settings`).                                                                                                               |
| All Phase 1-6 tables | **UNCHANGED** — no new column on any prior table                                                                                                                                                                                                                                                                                          |
| `telemetry_events`   | **DELIBERATELY NOT CREATED** — the telemetry buffer is in-memory only by privacy design (events must not survive a restart, must not be forensically recoverable from the `.sqlite` file, must not be a tamper surface). The migration header documents this as a deliberate non-table; a future maintainer must NOT "helpfully" add one. |

Full DDL in [`data-models.md §12`](data-models.md). Migration at [`migrations/0007_phase7_polish.sql`](../migrations/0007_phase7_polish.sql).

---

## Error variant conventions

A few patterns to know:

- **Channel-specific string literals.** Every channel's error union is a closed set of named string literals. No `error: string` with free-form values.
- **`'not_implemented'`** marks a stub channel. Renderer treats this as a non-error signal and shows "coming soon" instead of a failure toast. See [api-contracts.md §9.5](api-contracts.md#95-stub-channel-error-variant-not_implemented).
- **`'bridge_unavailable'`** is the **renderer-side** fallback that [`src/client/services/api.ts`](../src/client/services/api.ts) returns when `window.pdfApi` is absent (e.g. Vitest, very early boot). It is **not** in any contract's error union; it's the sole deliberate exception to the "named literals" rule. Renderer thunks must tolerate an unrecognized error string and surface a generic toast.
- **`(e as Error).message` leakage** — handlers today thread the raw error message through `Result.message` (e.g. `fs-read-pdf.ts`, `dialog-open-pdf.ts`). Julian flagged this as HIGH-4 in code review; Phase 1.1 adds a `safeMessage(e, fallback)` helper that returns `fallback` in production. Do not consume `Result.message` for any production user-visible toast — use the `error` discriminant.

---

## Cross-references

- Full architectural spec with rationale: [`api-contracts.md`](api-contracts.md) (Phase 1 §1-§9, Phase 2 §12, Phase 3 §13 with Wave 13.5 §13.9 amendment, Phase 4 §14, Phase 4.1 §15, Phase 5 §16, Phase 6 §17, **Phase 7 §18 — update + telemetry + i18n**)
- Source of truth for types: [`../src/ipc/contracts.ts`](../src/ipc/contracts.ts)
- Handler implementations: [`../src/ipc/handlers/`](../src/ipc/handlers/)
- Channel registration: [`../src/ipc/register.ts`](../src/ipc/register.ts)
- Preload bridge: [`../src/preload/index.ts`](../src/preload/index.ts)
- Renderer wrapper: [`../src/client/services/api.ts`](../src/client/services/api.ts)
- Edit-replay engine deep dive: [`edit-replay-engine.md`](edit-replay-engine.md) (Phase 5 adds step 3.9 OCR apply)
- Form engine deep dive (detect / fill / flatten / create / mail-merge runner): [`form-engine.md`](form-engine.md)
- Signature engine deep dive (cert lifecycle, byte-range, CMS envelope, TSA client, library decision walkthrough): [`signature-engine.md`](signature-engine.md)
- **OCR engine deep dive** (worker pool lifecycle, language pack management, text-behind-image authorship, confidence aggregation, preprocessing helpers, job lifecycle, PAdES interaction): [`ocr-engine.md`](ocr-engine.md)
- Phase 2 system design + lynchpin: [`architecture-phase-2.md`](architecture-phase-2.md)
- Phase 3 system design (HYBRID commit boundary, 7 locked decisions): [`architecture-phase-3.md`](architecture-phase-3.md)
- Phase 4 system design (signatures + annotations + audit log, 7 locked decisions, R-W15-A through F risk register): [`architecture-phase-4.md`](architecture-phase-4.md)
- **Phase 5 system design** (OCR engine, language packs, text-behind-image, scan-deferral, 10 locked decisions): [`architecture-phase-5.md`](architecture-phase-5.md)
- **Phase 6 system design** (Export to Office + image formats, per-page streaming engine, layout extractor, table detector, image extractor, four writers, background queue, 10 locked decisions): [`architecture-phase-6.md`](architecture-phase-6.md)
- **Export engine deep dive** (single-funnel pipeline, layout-detect, table-detect, image-extract, four writers, atomic write, job lifecycle, trust-floor obligations): [`export-engine.md`](export-engine.md)
- Data models including `MoveBookmarkResult`: [`data-models.md §7`](data-models.md) + Wave 8.5 §7.5 amendment; Phase 3 `FormFieldDefinition` + `FormTemplateRow`: [`data-models.md §8`](data-models.md#8-phase-3-additions); Phase 4 `SignaturePayload` + `ShapeAnnotationModel` + `MeasureCalibration` + schema v4 `signature_audit_log`: [`data-models.md §9`](data-models.md); **Phase 5 `OcrJob` + `OcrPageResult` + `OcrWord` + `LanguagePack` + schema v5 + additive `signature_audit_log.invalidated_by_ocr_job_id` column**: [`data-models.md §10`](data-models.md)
- Cert + password discipline (5 non-negotiable rules; 6 anti-patterns; Wave 17 mechanical greps): [`conventions.md §15`](conventions.md)
- **OCR engine discipline** (5 worker-lifecycle rules; bytes-stay-in-main extensions; anti-stub-shipped-with-TODO structural encoding; Wave 21 mechanical greps): [`conventions.md §16`](conventions.md)
- **Export-job discipline** (3 read-only-on-source rules; 2 export-bytes-stay-in-main corollaries; required-on-interface writer DI; no-as-any in writers; quality-tier defaults Q-D; Wave 25 mechanical greps): [`conventions.md §17`](conventions.md)
- How to add a new channel: [`developer-guide.md` → Adding a new IPC channel](developer-guide.md#adding-a-new-ipc-channel--worked-example)
- How to add a new `EditOperation` variant: [`developer-guide.md` → Adding a new EditOperation variant](developer-guide.md#adding-a-new-editoperation-variant--worked-example)
- How to add a new form field type: [`developer-guide.md` → Adding a new form field type](developer-guide.md#adding-a-new-form-field-type--worked-example)
- Permissive test stubs anti-pattern (Wave 8.5 + Wave 13.5 lesson): [`developer-guide.md` → Common pitfalls](developer-guide.md#permissive-test-stubs-mask-production-failures)
- Stubs-shipped-with-TODO comments anti-pattern (Phase 4.1 lesson; three instances cost 13+ waves): [`developer-guide.md` → Common pitfalls](developer-guide.md#stubs-shipped-with-todo-comments-become-structural-debt-invisible-to-typecheck--mock-cover)
- **Code-comment contradictions anti-pattern** (Phase 5 Julian H-21.1 lesson; the `renderMode` cast trap on pdf-lib's drawText): [`developer-guide.md` → Common pitfalls](developer-guide.md#code-comment-contradictions--when-the-comment-says-x-but-the-type-system-drops-x)
- PAdES trust floor — what the app does and doesn't promise (user-facing honesty obligations): [`user-guide.md` → PAdES trust floor](user-guide.md#pades-trust-floor--what-the-app-does-and-doesnt-promise)
- **OCR trust floor — what the app does and doesn't promise** (user-facing honesty obligations; four Phase 5 obligations + two cross-cutting from Phase 4): [`user-guide.md` → OCR trust floor](user-guide.md#ocr-trust-floor--what-the-app-does-and-doesnt-promise)
- **Export trust floor — what the app does and doesn't promise** (user-facing honesty obligations; five Phase 6 obligations + one cross-cutting duration reminder; fifth-instance trust-floor ratchet): [`user-guide.md` → Export trust floor](user-guide.md#export-trust-floor--what-the-app-does-and-doesnt-promise)
- **Phase 7 trust floor — what the app does and doesn't promise** (user-facing honesty obligations; the SIXTH-instance trust-floor ratchet — telemetry-OFF-by-default / update-placeholder / mac-linux-unverified / es-ES-sample): [`user-guide.md` → Phase 7 trust floor](user-guide.md#phase-7-trust-floor--what-the-app-does-and-doesnt-promise)
- **Phase 7 architecture** (cross-platform config, auto-update, telemetry, a11y, i18n, schema v7): [`architecture-phase-7.md`](architecture-phase-7.md); accessibility audit: [`a11y-audit.md`](a11y-audit.md); localization strategy: [`i18n-strategy.md`](i18n-strategy.md)
- **Telemetry framework + structural PII guard** (the `.strict()` schema as the exemplar privacy pattern): [`developer-guide.md` → Telemetry framework](developer-guide.md#telemetry-framework-phase-7)
- **Runtime `require()` of in-tree modules anti-pattern** (Phase 6 Diego Wave 25 RCA; the vite tree-shake + Electron 30 ESM rejection packaging gap; second instance): [`developer-guide.md` → Common pitfalls](developer-guide.md#runtime-require-of-in-tree-modules--vite-tree-shake--electron-30-esm-rejection)
- **Release-engineering responsibility — language-pack catalog SHA-256** (B-21.1 — real hashes landed in 0.7.1; the re-fetch/re-hash automation script is the durable follow-up): [`developer-guide.md` → Release-engineering responsibility](developer-guide.md#release-engineering-responsibility--language-pack-catalog-sha-256-b-211)
