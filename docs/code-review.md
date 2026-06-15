# Code Review — Wave 2 (2026-05-21)

**Reviewer:** Julian (Director of Code Quality & Security Audit)
**Scope:** All Wave 2 source under `src/` + `migrations/`. Wave 1 docs frozen / out of scope.
**Files reviewed:** ~95 of 143 (every security-critical file in full; representative spot-check of components, slices, tests). Riley's 50 renderer tests + 84 handler tests + 32 repo tests were skimmed for structure; the recurring assertion-shape issue below was found across them.
**Findings:** 0 BLOCKER, 4 HIGH, 9 MEDIUM, 6 LOW, 3 NIT
**Tooling caveat:** static review only — no `npm install`, no Electron boot, no tests executed. Items requiring runtime verification are tagged `[RUNTIME-VERIFY]`.

---

## Verdict

**YELLOW** — ship to Wave 4 with three follow-ups (`H-1`, `H-2`, `H-3` below). None of the findings block Wave 3 packaging or Wave 4 documentation; all four HIGHs are Phase-1 polish that the walking-skeleton can ship without, but they must close before the Phase-1 user-facing release.

---

## Top-3 issues

1. **H-1 — `setDbBridge` is never wired in `src/main/index.ts`.** Production code path silently uses the in-memory `MemoryDbBridge`, so recents/settings/bookmarks do **not** persist across launches. The walking-skeleton goal "Save the modified PDF" survives this, but Phase-1 goal #2/#4 (recents menu, persisted settings) silently regress. The bridge module exposes `setDbBridge()` and the test file proves it works; `bootstrap()` in `src/main/index.ts` just never calls it. One-line fix in main bootstrap, wrapping Ravi's real repos via `adaptRecentsRepo`/`adaptBookmarksRepo`.
2. **H-2 — Redux factory selectors break memoisation.** `selectAnnotationsForPage(pageIndex)` and `selectPage(pageIndex)` in `src/client/state/slices/document-selectors.ts` return a _new_ `createSelector` instance on every call. `PdfCanvas` invokes `useAppSelector(selectAnnotationsForPage(props.index))` inside render — so every render rebuilds the selector, runs the `.filter()` from scratch, and produces a new array reference, which then triggers `react-redux` to schedule another render. Defeats the entire reselect/memo strategy. Convention §6.3 even endorses this pattern; both the code and the doc need a fix.
3. **H-3 — `saveDocumentThunk` always sends `payload.kind: 'ops'` which Phase-1 handlers reject as `invalid_payload`.** The renderer's Save flow (`Ctrl+S`, menu) calls `dialog:saveAs` → `fs:writePdf` with the `ops` payload variant. `handleFsWritePdf` Phase-1 returns `invalid_payload` for `ops` until `applyOpsToBytes` is injected. End result: clicking Save in the shipped Phase-1 app _always_ surfaces "Save failed: ops payload not yet supported". Walking-skeleton milestone #8 ("Save the modified PDF") is non-functional. Either the renderer must serialize edits to bytes first (renderer-side pdf-lib path) or main must wire the replay engine. Either path is in scope for Phase-1 ship; the contract supports both.

---

## L-001 enforcement check

**PASS.** `src/main/window-manager.ts` does not set `enableDragDropFiles` at all — it relies on Electron's `true` default. The `webPreferences` object at lines 37–46 is the only `BrowserWindow` construction in the codebase (grep-verified). Diego's parallel Wave-3 work is expected to add the runtime test asserting `webPreferences.enableDragDropFiles !== false`; that test will continue to pass against the current source.

---

## Findings by category

### A. Electron security floor

| Sev | File:Line                                           | Finding                                                                                                                                                                                                                                                                                                                                    | Recommendation                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | `src/main/window-manager.ts:37-46`                  | `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, no `enableRemoteModule`, preload path set via `path.join` of `import.meta.url`-derived dirname. Matches ARCHITECTURE §2.1 verbatim. | Keep.                                                                                                                                                                                                                                                                                                               |
| —   | `src/main/security/csp.ts:7-19`                     | CSP string matches ARCHITECTURE §2.2 verbatim. Installed via `session.defaultSession.webRequest.onHeadersReceived` before any window is created (per `bootstrap()` ordering in `src/main/index.ts`).                                                                                                                                       | Keep. Note: CSP header spread-then-overwrite (`responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] }`) is the right pattern; just observe that if a renderer-served `<meta>` declares a stricter CSP, the union wins per W3C — currently both declare identical policy, so no surprise. |
| —   | `src/preload/index.ts:146`                          | `contextBridge.exposeInMainWorld('pdfApi', pdfApi)` is the only `window`-mutation. No raw `ipcRenderer` leaked. No `process`/`require` exposure.                                                                                                                                                                                           | Keep.                                                                                                                                                                                                                                                                                                               |
| LOW | `src/client/components/error-boundary/index.tsx:35` | `error.message` rendered directly to the user in the recovery screen. React's JSX-text escaping prevents XSS, but a production build will show whatever stack/message React surfaces — could leak filesystem paths or internal type names.                                                                                                 | Replace with a generic "Something went wrong" + a "Show details" disclosure. Pipe the real message to main via the `log:emit` channel Riley scoped for Phase 2.                                                                                                                                                     |
| LOW | grep result                                         | No `dangerouslySetInnerHTML`, no `eval(`, no `new Function(`, no string-form `setTimeout`/`setInterval` anywhere in `src/`.                                                                                                                                                                                                                | Confirmed clean.                                                                                                                                                                                                                                                                                                    |

L-001 enforcement: see header section above.

### B. IPC handler security

| Sev    | File:Line                                                      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Recommendation                                                                                                                                                                                                                                                                                                                                                    |
| ------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH   | (multiple, see "H-3" in Top-3)                                 | `saveDocumentThunk` always sends `payload.kind: 'ops'`. Phase-1 `handleFsWritePdf` returns `invalid_payload`.                                                                                                                                                                                                                                                                                                                                                                                            | See H-3 above.                                                                                                                                                                                                                                                                                                                                                    |
| HIGH   | All handlers using `(e as Error).message` for `Result.message` | Hard-Won Playbook #4 surface. `(e as Error).message` for FS/SQLite errors leaks paths and schema details. Examples: `fs-read-pdf.ts:65,87`, `dialog-open-pdf.ts:71,78,104`, `dialog-save-as.ts:64`, `bookmarks.ts:47,92,108`, `recents-add.ts:35`, `recents-clear.ts:23`, `recents-list.ts:32`, `settings.ts:74,95,107`. Renderer toasts these messages directly (`thunks.ts:73,101,129,145,172,186,232`), so an `ENOENT: no such file or directory, open 'C:\\Users\\…'` lands in a user-visible toast. | Add a small helper in `src/shared/result.ts`: `safeMessage(e: unknown, fallback: string): string` that returns `fallback` in production (`process.env.NODE_ENV === 'production'`) and the raw message in dev. Apply at every `fail<*>('…', (e as Error).message)` site. Log the full message server-side via `electron-log` keyed by request id (Phase 2 wiring). |
| MEDIUM | `src/ipc/handlers/pdf-ops.ts:51-55`                            | `handlePdfExport` returns `'handle_not_found'` when `req.preference` is invalid. The `PdfExportError` union has no `'invalid_payload'` variant; the closest semantic is wrong, but conflating wrong-preference with missing-handle confuses error reporting.                                                                                                                                                                                                                                             | Either (a) add `'invalid_payload'` to `PdfExportError` and use it here, or (b) re-validate inside Zod once Diego adds it and let the schema reject before the handler is reached. (a) is the smaller delta.                                                                                                                                                       |
| MEDIUM | `src/main/security/path-sanitizer.ts`                          | Does not check against an allow-listed root. A renderer that supplies any absolute `.pdf` path (e.g. `C:/Windows/System32/notrunning.pdf`) passes sanitization. The Phase-1 model is "the user only supplies paths via OS dialogs and drag-drop, both of which require physical user consent", so this is acceptable. Sanitizer also doesn't explicitly reject Windows UNC paths (`\\server\share\file.pdf`) or device namespaces (`\\?\C:\…`) — both pass `isAbsolute` and have `.pdf` ext.             | Add a follow-up test for UNC + device-namespace paths and decide policy. Phase 2 work; document in `tests/fixtures/path-vectors.md`.                                                                                                                                                                                                                              |
| MEDIUM | `src/ipc/handlers/dialog-save-as.ts:40`                        | `if (/[\\/]/.test(req.suggestedName)) return invalid_path` — good. But the regex doesn't reject backslash on POSIX or other path-like sequences (e.g. `.`-only names, NUL, control chars, reserved Windows device names `CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`).                                                                                                                                                                                                                               | Tighten the validator to reject reserved names + control chars to match `path-sanitizer.ts` behaviour. Sanitizer downstream will reject the resolved path on dialog return, so the impact is "user types `CON.pdf` in the save dialog → main rejects on the second pass". Cosmetic, not security.                                                                 |
| LOW    | `src/ipc/handlers/dialog-open-pdf.ts:81`                       | `computeFileHash(safe)` runs **after** `readFile(safe)` — a 500 MB file is read fully into memory and then hashed by re-opening + reading the first 64 KiB. Two opens for one read.                                                                                                                                                                                                                                                                                                                      | Pass the already-read bytes to `computeBufferHash` instead of re-opening. Saves one syscall per open. Same fix in `fs-read-pdf.ts:67`.                                                                                                                                                                                                                            |
| NIT    | `src/ipc/register.ts:118-141`                                  | `handleDialogOpenPdf` deps build inline — readable, but a few of the inner async lambdas (`readFile`, `statFile`) are duplicated verbatim in the `FsReadPdf` block (lines 163-174).                                                                                                                                                                                                                                                                                                                      | Extract a shared `makeFsDeps(getMainWindow)` helper. Minor.                                                                                                                                                                                                                                                                                                       |

### C. SQL injection

| Sev | File:Line                  | Finding                                                                                                                                                                                                                                                                                         | Recommendation                                                                   |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| —   | `src/db/repositories/*.ts` | Every statement uses `db.prepare(...).run/get/all({ named: params })`. Zero string concatenation, zero `db.exec(userInput)`. `recent-files-repo.test.ts:120-125` includes an explicit injection-resistance test (apostrophe + `DROP TABLE` in path) that passes by virtue of parameter binding. | Keep. The repo layer is the clean part of the codebase.                          |
| —   | `src/db/connection.ts:98`  | `PRAGMA foreign_keys = ON` and `journal_mode = WAL` set before migrations run. Match data-models §5 pragma expectations.                                                                                                                                                                        | Keep.                                                                            |
| LOW | `src/db/migrate.ts:67`     | `db.exec(m.sql)` reads SQL files verbatim from disk. The SQL file itself is the trust boundary (project asset, not user-supplied), so this is fine — but worth documenting because any future "user-provided migration" feature would need to reroute through prepared statements.              | Add a one-line comment to that effect; logs the rationale for the next reviewer. |

### D. pdf-lib + pdf.js usage

| Sev                | File:Line                                  | Finding                                                                                                                                                                                     | Recommendation                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[RUNTIME-VERIFY]` | `src/client/services/pdf-render.ts`        | Entire module is a stub awaiting Diego adding `pdfjs-dist@^4.4`. Memory-hygiene contracts (cleanup, cancel, single worker per document) are documented in the source but not yet exercised. | Re-audit this file after Diego wires the real `pdfjsLib.getDocument` call and worker setup. Specifically check that the (Phase 2) `getPage` path calls `.cleanup()` on scroll-out + that `RenderTask.cancel()` runs on unmount/rapid-re-render. The audit is necessarily provisional until then. |
| `[RUNTIME-VERIFY]` | `src/client/services/pdf-edit.ts`          | Stub. `replay(originalBytes, ops)` returns `originalBytes` unchanged. Phase 2 work; nothing to audit yet.                                                                                   | Re-audit after Phase 2.                                                                                                                                                                                                                                                                          |
| LOW                | `src/client/services/pdf-edit.ts:42`       | `unionRects` for an empty array returns `null` (good). For a single-rect array it computes correctly. No tests exist for this function.                                                     | Add a Vitest case in Wave-3 follow-up (low priority).                                                                                                                                                                                                                                            |
| —                  | `src/client/services/pdf-render.ts:97-105` | `viewportForPage` correctly handles 90/270 rotation by swapping width/height before scaling.                                                                                                | Keep.                                                                                                                                                                                                                                                                                            |

### E. Redux + state management

| Sev    | File:Line                                                    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH   | `src/client/state/slices/document-selectors.ts:27-28, 35-36` | **H-2 above.** `selectAnnotationsForPage(pageIndex)` and `selectPage(pageIndex)` return a fresh `createSelector` per call. `PdfCanvas:31` invokes `useAppSelector(selectAnnotationsForPage(props.index))` inside render — new selector every render, memo always misses, new array reference each time, then react-redux triggers another render.                                                                                                                                                                                                                                    | Replace the factory-selector with a parameterized selector that takes `(state, pageIndex)` and memoise with `createSelector` plus a custom `equalityFn` per [reselect docs](https://github.com/reduxjs/reselect#createselectorinputselectors--inputselectors-resultfunc-selectoroptions). Or use `useMemo` at the call site to stabilise the selector reference. ALSO update `docs/conventions.md` §6.3 — its endorsement of the factory pattern is the root cause. Bump the conventions amendment to Riley in Wave 4 prep. |
| —      | `src/client/state/slices/document-slice.ts:51-62`            | `applyEdit` is the single funnel — `prepare()` attaches `meta.undoable: true`, reducer delegates to `applyOperationToDocument()`. Grep across `src/client/` confirms every page/annotation mutation goes through this funnel (one in `thumbnail-strip/index.tsx` via `applyEdit({ kind: 'reorder', ... })` for drag-drop, one in `annotation-layer/index.tsx` via `applyEdit({ kind: 'annot-add', ... })`, two in `hooks/use-app-shortcuts.ts` for rotate-cw/ccw, one in `thumbnail-strip` for delete). No direct slice reducer writes that bypass the inverse-computation contract. | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| —      | `src/client/state/slices/document-inverses.ts:11-54`         | Exhaustive switch over `EditOperation.kind` with the `never`-assertion default. Each branch produces a valid inverse op. The `beforeState` parameter is plumbed-through but unused — `void beforeState` on line 58 makes intent explicit.                                                                                                                                                                                                                                                                                                                                            | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| MEDIUM | `src/client/state/slices/document-slice.test.ts:167-225`     | Round-trip tests cover `reorder`, `insert`, `rotate`, `annot-add`. **Missing:** `delete` round-trip, `annot-edit` round-trip, `annot-delete` round-trip, and reorder-with-annotations rebinding (the `applyReorder` code at `document-slice-apply.ts:56-65` is non-trivial — it has THREE rebind branches and zero tests).                                                                                                                                                                                                                                                           | Add four Vitest cases before Phase-1 ship: (a) `applyOp(delete) + applyOp(inverse) → identity state including annotations`; (b) same for `annot-edit`; (c) same for `annot-delete`; (d) reorder across an annotation page-index range, verify rebinding follows the page.                                                                                                                                                                                                                                                   |
| MEDIUM | `src/client/state/middleware/history-middleware.ts:9-25`     | Passive shim — pretends to inspect `meta.undoable` but does nothing else. Documented as Phase-2 wiring per ARCHITECTURE §5.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Keep for Phase 1, but add a brief comment to `document-inverses.ts` cross-referencing the middleware so a future reader knows the inverse code is "currently dead but Phase 2 will activate".                                                                                                                                                                                                                                                                                                                               |
| LOW    | `src/client/components/thumbnail-strip/index.tsx:23`         | `useAppSelector((s) => s.selection.selectedPageIndices)` — inline selector returns a fresh reference equality result. With strict-mode double-render this may cause extra renders.                                                                                                                                                                                                                                                                                                                                                                                                   | Wrap with `createSelector` in `selection-slice.ts` (returning the same array reference when contents haven't changed) — RTK's recommended pattern.                                                                                                                                                                                                                                                                                                                                                                          |
| —      | `src/client/state/store.ts:26-33`                            | `serializableCheck.ignoredActionPaths` lists `payload.bytes`, `payload.outputBytes` — matches what Wave-2 thunks actually carry. No `Uint8Array` lives in store per conventions §10.                                                                                                                                                                                                                                                                                                                                                                                                 | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### F. TypeScript strictness + conventions

| Sev | File:Line                                      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Recommendation                                                                                                                                                                           |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | grep                                           | No `@ts-ignore`, no `@ts-expect-error` anywhere in `src/`.                                                                                                                                                                                                                                                                                                                                                                                                                                            | Keep.                                                                                                                                                                                    |
| —   | grep                                           | 11 `any` casts total; every one has a justifying eslint-disable-line + comment OR is in a test file. Justified: `app.tsx:60` (Electron `File.path`), `db-bridge.ts:113` (heterogeneous-key map), `settings-repo.ts:120` (JSON.parse round-trip), `vitest.setup.ts:24` (jsdom polyfill), `api.ts:31` (deliberate cross-contract fallback), `settings-modal/index.tsx:77` (generic over const-string union). Tests: `pdf-ops.test.ts:40`, `settings.test.ts:22/31/40`, `document-selectors.test.ts:20`. | Keep. Discipline matches conventions §1.2 + §1.4.                                                                                                                                        |
| —   | File-length audit                              | Files > 200 lines: `contracts.ts` (594, types-only), `register.ts` (282, central wiring), `db-bridge.ts` (278), `thunks.ts` (272, has rationale comment), `settings-modal/index.tsx` (250, has rationale comment). Each has a justification or is structural.                                                                                                                                                                                                                                         | Keep.                                                                                                                                                                                    |
| LOW | `src/main/db-bridge.ts:107-117`                | `MemorySettingsRepo.getAll()` uses `(out as any)[k] = v`. Reasonable for the heterogeneous-key map but the comment ("each value is type-correct by construction") loses a runtime invariant when a Phase-2+ writer bypasses `.set()`.                                                                                                                                                                                                                                                                 | If/when Phase 2 adds settings-set paths beyond `.set()` (e.g. a migration that pre-populates rows), add a runtime type check or move to a tighter discriminated union. Acceptable as-is. |
| NIT | `src/db/repositories/settings-repo.ts:110-121` | `parseJsonValue` does NOT validate the parsed shape — it trusts JSON round-trip. A user who hand-edits the SQLite file could plant any JSON value. Defended at the IPC layer by `isValidValueFor`.                                                                                                                                                                                                                                                                                                    | Cross-reference the IPC validator from a comment in `parseJsonValue` so the next reader doesn't add a parallel validator.                                                                |

### G. Test coverage gaps

| Sev    | File:Line                                                                                                                                  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Recommendation                                                                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MEDIUM | All handler test files                                                                                                                     | **Recurring pattern:** `if (!res.ok) expect(res.error).toBe('…')` — the assertion only runs if `res.ok === false`. If a handler regression starts returning `{ ok: true, … }` instead of an error, the test passes silently. Confirmed in `bookmarks.test.ts`, `settings.test.ts`, `app.test.ts`, `fs-write-pdf.test.ts`, `pdf-ops.test.ts`, `recents.test.ts`, `window.test.ts`, `fs-close-pdf.test.ts`, `fs-read-pdf.test.ts` (partial — some cases have explicit `expect(res.ok).toBe(false)` pre-checks, e.g. `dialog-open-pdf.test.ts` and a few in `dialog-save-as.test.ts`). | Add `expect(res.ok).toBe(false);` (or `.toBe(true)` for success cases) BEFORE every conditional `if (!res.ok)` block. Better yet: a tiny test helper `expectErr<E>(res, e: E)` that asserts both shape and variant in one call. Worth a 30-minute pass across all 13 handler tests. |
| MEDIUM | `src/main/pdf-ops/document-store.test.ts`                                                                                                  | No test for the 60-second token TTL. `gcDestinations` is called on every `issueDestinationToken` and `consumeDestinationToken`, but the time-passing path is uncovered.                                                                                                                                                                                                                                                                                                                                                                                                             | Inject a `now()` provider into `DocumentStore` (or use `vi.useFakeTimers()`) and add a "token expires after 60s" case.                                                                                                                                                              |
| MEDIUM | `src/main/security/path-sanitizer.test.ts`                                                                                                 | Covers `..` traversal, control chars, non-`.pdf` ext, relative paths, case-insensitive ext. **Missing:** Windows UNC paths (`\\server\share\file.pdf`), device namespaces (`\\?\C:\file.pdf`), reserved device names (`CON.pdf`), null-byte after a valid prefix (`C:/foo.pdf\0.exe`), Unicode-normalised double-encoded `..` (`%2e%2e`). Phase-1 risk is low (renderer never originates raw paths outside OS dialog), but high-value adversarial coverage.                                                                                                                         | Add a `tests/fixtures/path-vectors.json` table and parameterise the test. Phase-2 priority.                                                                                                                                                                                         |
| MEDIUM | `src/ipc/handlers/pdf-ops.test.ts`                                                                                                         | `handlePdfExport` is tested for `'bad' as any` handle and a valid request, but the wrong-preference path (Finding B above) is uncovered.                                                                                                                                                                                                                                                                                                                                                                                                                                            | Add a case: `handlePdfExport({ handle: 1, preference: 'unknown' as any })` — currently returns `'handle_not_found'`, which IS the regression. Failing test will force the fix.                                                                                                      |
| MEDIUM | `src/client/state/thunks.ts`                                                                                                               | Zero direct thunk tests. Most thunks are simple `api.* → dispatch(…)` pipelines but the error-mapping branch in `openDroppedPathThunk:93-101` (`invalid_pdf` → "That file is not a valid PDF.", `too_large` → "…size limit.", `path_rejected` → "Path was rejected by the security check.") is uncovered.                                                                                                                                                                                                                                                                           | Add 3-5 thunk tests using `vi.stubGlobal('pdfApi', mock)` per Riley's pattern. Verify the toast strings on each error branch.                                                                                                                                                       |
| LOW    | `src/client/components/empty-state/empty-state.test.tsx`, `src/client/components/toolbar/toolbar.test.tsx`, `src/client/shortcuts.test.ts` | Three component/lib tests in 91-file renderer. The 50 case count in build-report.md must be summing across a denser set than I sampled — many are inside slice test files. Not a defect; just observe that React component coverage is sparse and Diego's e2e will need to pick up the slack.                                                                                                                                                                                                                                                                                       | After Diego wires Playwright in CI, add at least one component test per modal (combine, settings, export, confirm-close). Phase-2 backlog.                                                                                                                                          |

### H. Architecture compliance

| Sev  | File:Line                                    | Finding                                                                                                                                                                                                                                            | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH | `src/main/index.ts:84-101`                   | **H-1 above.** `bootstrap()` never calls `setDbBridge(createSqliteBridge(...))`, so production code paths use the in-memory `MemoryDbBridge`. Comment on line 26-28 even flags this ("Marked with a TODO").                                        | Add three lines to `bootstrap()` after `app.whenReady()` and before `registerIpcHandlers`: <br>`ts<br>const db = initDatabase({ dbPath: join(app.getPath('userData'), 'pdf-viewer-editor.db') });<br>setDbBridge({<br>  recents: adaptRecentsRepo(createRecentFilesRepo(db)),<br>  bookmarks: adaptBookmarksRepo(createBookmarksRepo(db)),<br>  settings: createSettingsRepo(db),<br>});<br>`<br> Tests already verify both shapes. The wiring is the missing one-tenth of the job. |
| —    | `src/main/db-bridge.ts`                      | Single source of camelCase↔snake_case translation. Grep across `src/ipc/handlers/` shows NO `.map(r => ({ camelField: r.snake_field }))` patterns outside the bridge file. The pattern Marcus locked (one audit surface) holds.                    | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| —    | `src/client/types/ipc-contract.ts`           | Pure re-export of David's contract module. Only renderer file that imports from `src/ipc/` per design.                                                                                                                                             | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| —    | `src/client/services/pdf-coords.ts`          | Single source of y-flip math. Grep for `page.height -`, `viewport.height -`, `page.width -` in `src/client/` confirms zero hits outside this module.                                                                                               | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| LOW  | `src/client/services/pdf-coords.ts:41 vs 73` | `screenRectToPdf` and `screenPointToPdf` use different algebraic forms of the y-flip (one uses `page.height - (rect.y + rect.height) * sy`, the other uses `(viewport.height - pt.y) * sy`). Mathematically equivalent; cosmetically inconsistent. | Pick one form, refactor the other to match. Add a brief lemma comment showing the algebraic equivalence so the next reviewer doesn't suspect a bug.                                                                                                                                                                                                                                                                                                                                 |
| LOW  | `src/db/test-support.ts`                     | Test helper lives in production directory `src/db/`, not in a test-only directory. Build-time exclusion is documented as Diego's responsibility in Wave 3.                                                                                         | Diego: add `**/test-support.ts` and `**/*.test.ts` to esbuild's `external` (or `exclude`) list in main+preload bundle configs.                                                                                                                                                                                                                                                                                                                                                      |

### I. Cross-cutting nits

| Sev    | File:Line                                                        | Finding                                                                                                                                                                                                                                 | Recommendation                                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------- |
| MEDIUM | `src/client/components/modals/combine-modal/index.tsx:34-48`     | `addFromPicker` inserts a literal `{ kind: 'path', path: '' }` entry on every click. Empty path will hit `handlePdfCombine` validation but only AFTER the user clicks Combine — the affordance accepts arbitrarily many broken entries. | Disable the "+ Add file..." button entirely (Phase-2 affordance per Riley's docs) and surface a `disabled` + tooltip `"Coming in Phase 2"`. Don't let users build invalid request payloads.                                                                                                                             |
| MEDIUM | `src/client/components/empty-state/index.tsx:51-64`              | Recent items are listed but NOT clickable. The walking-skeleton claims "Open a PDF" works; Recents UX implies clicking a row re-opens. Today: visual-only.                                                                              | Wrap each `<li>` in a button or add a click handler that fires `openDroppedPathThunk(item.path)` (Phase-1 simple) or a dedicated `openFromRecentsThunk` that re-hashes + de-dups.                                                                                                                                       |
| MEDIUM | `src/client/components/thumbnail-strip/thumbnail-item.tsx:60-69` | `<li>` is `draggable` and click-handled but has no keyboard activator (no `tabIndex`, no Enter/Space → click). Pages can't be navigated by keyboard from the strip.                                                                     | Add `tabIndex={0}`, `role="option"` (matching parent's listbox-implicit semantics), and `onKeyDown` that maps Enter+Space → onClick, Arrow Up/Down → focus prev/next, Delete → fire `applyEdit({ kind: 'delete', … })`. Phase-7 a11y can do the full WAI-ARIA listbox pattern; Phase 1 needs at least the keyboard nav. |
| MEDIUM | `src/client/components/bookmarks-panel/index.tsx:62-77, 93-104`  | `<li>` and inner `<div>` use `role="button"` + `tabIndex={0}` + `onKeyDown` for `Enter`. **Missing Space**. WAI-ARIA button pattern requires both Enter and Space.                                                                      | Add `if (e.key === 'Enter'                                                                                                                                                                                                                                                                                              |     | e.key === ' ') { e.preventDefault(); onJump(...) }`. |
| LOW    | `src/client/components/sidebar/index.tsx:11-16`                  | Tab semantics dropped to work around `jsx-a11y/aria-proptypes`. Comment correctly defers to Phase 7 a11y audit.                                                                                                                         | Keep with note. Diego's Wave-3 rule config fix (`allowedDynamic: true`) may make the original ARIA tab pattern viable; revisit in that PR.                                                                                                                                                                              |
| LOW    | `src/client/components/error-boundary/index.tsx:23`              | `console.error` left in renderer code. Comment correctly notes Phase 2 will route through `log:emit`. ESLint `no-console` would fire today; an exception comment is already in place.                                                   | Keep.                                                                                                                                                                                                                                                                                                                   |
| LOW    | `docs/api-contracts.md:469` vs `src/ipc/contracts.ts:489-494`    | Doc lists `WindowGetStateValue` with three fields; contract code returns four (adds `isFocused: boolean`). Renderer's handler returns four.                                                                                             | Update `api-contracts.md` to add `isFocused`. Doc-vs-code drift, not a code bug. Marcus accepted the `window:*` namespace amendment in Wave-2 integration; this is one field short.                                                                                                                                     |
| LOW    | `src/main/security/csp.ts:22-29`                                 | The `responseHeaders` spread-then-overwrite pattern works in Electron 30+ but the upstream type for `details.responseHeaders` is `Record<string, string[]> \| undefined`. If undefined, the spread is a no-op (correct).                | Add an explicit `?? {}` for clarity. Cosmetic.                                                                                                                                                                                                                                                                          |
| NIT    | `src/ipc/handlers/recents-list.ts:25`                            | `MAX_LIMIT = 200`. Default `recents.maxItems` setting (per data-models example) is `20`; the channel allows 10× that. Reasonable upper bound; surface in the docs as "the channel caps `limit` at 200 regardless of setting."           | Keep, document.                                                                                                                                                                                                                                                                                                         |
| NIT    | `src/client/state/slices/ui-slice.ts:62`                         | Toast ID uses `Date.now()` + `Math.random().toString(36).slice(2,8)` — collision risk is microscopic but `crypto.randomUUID()` is exposed in modern renderers and avoids it.                                                            | Optional change.                                                                                                                                                                                                                                                                                                        |
| NIT    | `src/main/index.ts:48`                                           | `ipcMain` imported but only used to pass to `registerIpcHandlers` — could be removed and the registrar imports it itself. Minor de-coupling argument either way.                                                                        | Keep current shape; explicit DI is fine.                                                                                                                                                                                                                                                                                |

---

## Provisional findings (pending Diego's Wave 3 deliverables)

These cannot be resolved until Diego's `package.json` lands and `npm install` runs. Re-audit at the end of Wave 3:

1. **`pdfjs-dist` memory hygiene** — once the stub `pdf-render.ts` flips to real `pdfjsLib.getDocument(...)`, verify (a) one worker per document with explicit `destroy()` on document close, (b) `PDFPageProxy.cleanup()` on scroll-out / unmount, (c) `RenderTask.cancel()` on rapid re-render. ARCHITECTURE §4.4 specifies the contract; Riley's source comments document the intent.
2. **`electron-builder` installer registry writes for `.pdf` association** — Decision 4 default-ON checkbox needs the NSIS path Diego authors; the runtime toggle channels (`app:setDefaultPdfHandler` / `getDefaultPdfHandlerStatus`) are typed stubs today. Confirm registry writes land at `HKCU\Software\Classes\.pdf` and `HKCU\Software\PdfViewerEditor\Capabilities\FileAssociations` per Microsoft's "Default Programs" pattern.
3. **Playwright Electron e2e signal** — `tests/e2e/smoke.spec.ts` is no longer `test.skip` (already flipped to `test`), but the CI run that proves the empty-state assertion + screenshot path will only land after Diego wires the workflow. The current test launches via `electron.launch({ args: ['.'], cwd })` which needs `package.json` `main: "dist/main/index.js"` + a build step. Re-audit after CI green.
4. **Real export-engine selector behaviour** — `handlePdfExport` is a stub. The renderer's `ExportEngineDialog` shows `projectedEngine` based purely on user selection ('auto' always preview as pdf-lib); once the real engine selector runs main-side, the preview must call into a synchronous engine-prediction (or the dialog must accept the asynchronous answer post-export). Phase 2 work.
5. **better-sqlite3 native-module rebuild for Electron 30 ABI** — Diego's `postinstall` `electron-builder install-app-deps` is the standard path. Until it runs, the DB layer is not exercisable against the real Electron binary. The Vitest path uses Node-Sqlite3 ABI and works fine in CI for unit tests.

---

## What's good (calibration)

1. **Discriminated-union `Result<T, E>` everywhere.** Zero exceptions cross the IPC bridge. Every handler is exhaustive-switch-friendly on the renderer side. This is the kind of contract that catches future bugs at compile time; the discipline shows up in 23 channels with consistent shape.
2. **Single audit surfaces.** `db-bridge.ts` is THE place for snake↔camel translation, `pdf-coords.ts` is THE place for y-flip math, `applyEdit` is THE funnel for document mutations. Each of those is a "if you change one place, ESLint/TS catches the other" guarantee. Marcus's Wave-2 integration verdict named this; the code holds up to it.
3. **Prepared statements throughout the DB layer + an explicit injection-resistance test.** `recent-files-repo.test.ts:120-125` deliberately runs `"C:\foo'; DROP TABLE recent_files; --.pdf"` through `upsert/get` and asserts the round-trip is verbatim. The test pins the policy against future refactors. More repos should have a similar canary.
4. **Path sanitizer rejects intent, not just normalized form.** `path-sanitizer.ts:38` checks for `..` BEFORE `normalize()` collapses it, then checks AGAIN after — defense in depth against encoding tricks.
5. **`destinationToken` opaqueness.** `dialog:saveAs` returns a `randomUUID()`-backed token, not the path. Renderer can never see absolute paths even on the write side. 60-second TTL with GC. Better-than-textbook IPC-boundary hygiene.

---

## Follow-ups for Wave 4+ (non-blocking)

- Tighten `aria-proptypes` workarounds once Diego confirms the `allowedDynamic` option (Sidebar tabs, Settings tabs — Phase 7 a11y audit).
- Replace the `bridge_unavailable` magic-string error in `src/client/services/api.ts` with a first-class contract variant (would require adding `'bridge_unavailable'` to every channel's error union — large delta; Phase 2 backlog).
- Activate the `historyMiddleware` (Phase 2) and add `redo`/`undo` UI buttons + Ctrl+Z/Y shortcuts (already in `use-app-shortcuts.ts` but they toast "coming in a later phase").
- Add a `LICENSES.md` aggregating every transitive dep's license per the Phase-1 OSS policy. Diego or Nathan owns; flag in Wave-4 brief.

---

## Per-area scorecard

| Area                              | Critical | High  | Medium | Low    | Nit   |
| --------------------------------- | -------- | ----- | ------ | ------ | ----- |
| A. Electron security floor        | 0        | 0     | 0      | 2      | 0     |
| B. IPC handler security           | 0        | 2     | 3      | 1      | 1     |
| C. SQL injection                  | 0        | 0     | 0      | 1      | 0     |
| D. pdf-lib / pdf.js (provisional) | 0        | 0     | 0      | 1      | 0     |
| E. Redux + state                  | 0        | 1     | 2      | 1      | 0     |
| F. TypeScript + conventions       | 0        | 0     | 0      | 1      | 1     |
| G. Test coverage                  | 0        | 0     | 5      | 1      | 0     |
| H. Architecture compliance        | 0        | 1     | 0      | 2      | 0     |
| I. Cross-cutting                  | 0        | 0     | 4      | 3      | 3     |
| **Total**                         | **0**    | **4** | **14** | **13** | **5** |

(HIGH-2 is counted under E and shows up in B's "see H-3" cross-reference; HIGH-1 under H. Sum reflects unique findings.)

---

## L-001 enforcement check (detail)

- Source file `src/main/window-manager.ts` does not set `enableDragDropFiles`, relying on Electron's default `true`. Grep across `src/main/` and `src/client/` for `enableDragDropFiles` returns zero hits — neither override nor toggle exists.
- The `webPreferences` object on line 37-46 is the sole `new BrowserWindow(...)` construction in the codebase.
- Diego's Wave-3 brief adds a Vitest unit test asserting `webPreferences.enableDragDropFiles !== false`. The current source will pass that test as written.
- **VERDICT: L-001 holds.**

---

# Wave 8 Phase 2 Code Review — Julian

**Reviewer:** Julian (Director of Code Quality & Security Audit)
**Date:** 2026-05-21
**Scope:** All Phase 2 source from Wave 7 (David: pdf-ops + handlers + db-bridge + preload; Ravi: bookmarks-repo + migration; Riley: history-middleware + bookmarks-slice + image-import-modal + text-edit-overlay + thunks). The Wave 3 Phase 1 review above is **untouched** — this is an appended section per the wave-8 brief.
**Files reviewed:** 38 of ~60 Phase 2 source files (every security-critical and contract-critical file in full; renderer components spot-checked; e2e tests deferred to Diego's parallel work).
**Tooling caveat:** static review only — `npm install`, Electron boot, Playwright not exercised. Items requiring runtime verification are tagged `[RUNTIME-VERIFY]`. Diego's parallel D-8.2 / D-8.3 / D-8.7 outputs are not yet on disk; their `BrowserWindow` security floor is `[DEFERRED — Wave 8.5 audit]`.
**Findings (Phase 2):** **2 BLOCKER, 5 HIGH, 11 MEDIUM, 9 LOW, 4 NIT**

---

## Verdict (Phase 2)

**RED** — Wave 8.5 fixup is mandatory before Wave 9 ships. Two BLOCKERs surfaced that silently corrupt the saved PDF on the most common edit flows (reorder, undo-of-delete-original-page). Diego's D-8 packaging work can proceed in parallel because the BLOCKERs live in David's replay engine, not in Diego's surface; but Nathan's docs (Wave 9) should NOT publish until B-1 + B-2 are patched, or the Phase-2 user-guide will document flows that destroy user data.

The headline news: the replay engine's `applyReorder` and `applyInsert` handlers are **structurally incomplete** — they pass single-op unit tests but FAIL composite save flows that exercise page-array mutation across the renderer/engine boundary. This is the Wave 2 calibration lesson #1 ("memory fallback IS the production bridge by accident") repeating at the Phase 2 surface: the engine LOOKS like it handles all 11 ops, but two of them are no-ops with misleading comments.

---

## Top-3 Phase 2 issues

1. **B-1 (BLOCKER) — `applyReorder` deletes pages instead of reordering them.** `src/main/pdf-ops/replay-engine.ts:352-381` calls `doc.removePage(op.fromIndex)` and never re-inserts. The comments (lines 367-379) acknowledge "Phase-2 conservative" but the code is wrong: a reorder op at save time becomes a **deletion**. The renderer-side `applyReorder` in `document-slice-apply.ts:65-90` correctly splices + reindexes — so the UI shows the reordered state during the session, but the saved PDF has the moved page **deleted**. There is NO test for this in `replay-engine.test.ts` (grep confirms zero `reorder` hits). The drag-drop reorder in `thumbnail-strip` is THE headline Phase 2 user flow; the H-3 closure proof (smoke test #7) would fail if it exercised reorder. Walking-skeleton goal #8 was advertised as "real ops → real saved file"; for reorder, it is "real ops → corrupted saved file." Fix: implement reorder via pdf-lib's page-tree manipulation (`movePages` + slice swap, or `removePage` + `insertPage` of the captured `PDFRef`). Required for Phase 2 ship.

2. **B-2 (BLOCKER) — `applyInsert` silently no-ops when `source.kind === 'original' | 'inserted' | 'image'`.** Same file, lines 383-411. Only `source.kind === 'blank'` actually inserts. The `'image'` branch returns `ok` immediately with the comment "Handled by image-insert variant; this is the SourcePageRef bridge" — but the document-inverses.ts at line 31-37 builds an `insert` op (NOT `image-insert`) as the inverse of `delete`, with `preservedSource` set to whatever the deleted page's `sourcePageRef` was. So: user deletes original page 3 → renderer model records `{ kind: 'delete', pageIndex: 2, preservedSource: { kind: 'original', originalIndex: 2 } }`. User presses Ctrl+Z → middleware dispatches the inverse `{ kind: 'insert', atIndex: 2, source: { kind: 'original', originalIndex: 2 } }`. Renderer re-inserts page in model. User saves → replay engine's `applyInsert` hits the `'original'` branch → emits warning "Phase-3 scope fence" and **skips** the insert. **Page 3 is gone from the saved bytes**. Same chain for `'image'` (undo of image-insert-then-delete) and `'inserted'` (Phase 3 combine bridge). The `ctx.warnings.push(...)` surfaces a toast, but warnings are not errors and the save reports success. Fix: re-implement `applyInsert` for `'original'` / `'inserted'` by tracking the source-doc page-ref through `document-store` (each handle's bytes carry the original page-refs), and for `'image'` by reading the embedded image from a co-passed payload OR by routing via the `image-insert` variant the inverse-builder should have produced (i.e. fix `document-inverses.ts:33-37` to emit `image-insert` when the preserved source is an image). Required for Phase 2 ship.

3. **H-1 (HIGH) — `MoveBookmarkResult` discriminated-union collapse mis-classifies legitimate `not_found` and `invalid_parent` as `cycle_detected`.** Marcus flagged this in the Wave 7 verdict; this audit confirms severity HIGH (not MEDIUM). The chain: `src/db/repositories/bookmarks-repo.ts:248-301` returns `{ ok: false, error: 'not_found' | 'cycle_detected' | 'invalid_parent' }`. `src/main/db-bridge.ts:57+216+422` collapses the return type to `boolean` (THREE separate places — the bridge interface, the memory repo's implementation, AND the Ravi-adapter interface). `src/ipc/handlers/bookmarks-phase2.ts:64-76` heuristically maps `false + newParentId === null` → `not_found`, `false + newParentId !== null` → `cycle_detected`. **Every other case is misclassified:** (a) bookmark id doesn't exist + caller passes newParentId=5 → repo returns `not_found` → handler returns `cycle_detected` (WRONG). (b) parent id doesn't exist OR points to a different file_hash → repo returns `invalid_parent` → handler returns `cycle_detected` (WRONG; `invalid_parent` variant is unreachable). The api-contracts.md §12.6 promise of a distinct `cycle_detected` variant is broken. The existing test (`bookmarks-phase2.test.ts:85-99`) **encodes the heuristic** rather than catching the bug — its "non-null newParentId + repo false → cycle_detected" case would still pass after a correct fix, because the repo's `false` happens to mean cycle in the test's setup; but the real repo returns `not_found` when the bookmark doesn't exist, and the test never exercises that. Severity HIGH because the misclassification surfaces wrong toast text in the renderer ("Move would create a cycle" vs "Bookmark not found"), a measurable UX defect on a documented contract.

---

## L-001 enforcement check (Phase 2)

**PASS for shipped code; DEFERRED for Diego's parallel work.**

- Grep across all of `src/` for `enableDragDropFiles` returns zero hits (verified). No Phase 2 file regresses the lock.
- `src/main/window-manager.ts` remains the sole `new BrowserWindow(...)` constructor in the shipped code; Phase 2 added zero new windows.
- **DEFERRED:** Diego's D-8.2 (`src/main/export/chromium-export.ts`) and D-8.3 (`src/main/export/print-dispatch.ts`) are not yet on disk at the time of this review. The wave-8 brief §"Locked-decision compliance check" REQUIRES Diego to omit `enableDragDropFiles` (preserve default `true`) and to ship a security-floor test. Julian re-audits this surface in **Wave 8.5** once Diego's commits land — flag with `[RUNTIME-VERIFY: post-D-8.2]`.
- The `pdf-export-pdf.ts:39-42` JSDoc comment correctly documents the L-001 contract for the future Chromium wrapper. The actual `chromiumExport` dep is currently a stub injected by `register.ts`; the stub itself never constructs a `BrowserWindow`. So today's source holds L-001 by virtue of the empty implementation. Tomorrow's source (Diego's real wrapper) must hold it by virtue of the brief.

**Verdict:** L-001 holds for Wave 7 source. Wave 8.5 re-verification required once Diego ships D-8.2/D-8.3.

---

## Findings by category

### A. Replay-engine purity + atomicity

| Sev         | File:Line                                                                                                                | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BLOCKER** | `src/main/pdf-ops/replay-engine.ts:352-381`                                                                              | **B-1 above.** `applyReorder` removes the page but never re-inserts. Reorder at save time becomes deletion. NO test in `replay-engine.test.ts` exercises reorder (verified by grep).                                                                                                                                                                                                                                                                    | Implement honest reorder via pdf-lib's page-array manipulation: capture the page object before `removePage` (e.g. `const p = doc.getPage(fromIndex); doc.removePage(fromIndex); doc.insertPage(toIndex, p)` — pdf-lib supports this since v1.16). Add at least one round-trip test that asserts the post-replay page count == pre-replay page count AND the page identifier at the new index matches what the renderer expected.                                                                                                                                                                                                                           |
| **BLOCKER** | `src/main/pdf-ops/replay-engine.ts:383-411`                                                                              | **B-2 above.** `applyInsert` only honors `source.kind === 'blank'`. `'image'` returns ok with zero work. `'original'` and `'inserted'` push a warning and skip. The inverse of `delete` is `insert` with the deleted page's `sourcePageRef` (`document-inverses.ts:31-37`) — so undo-of-delete + save silently drops the restored page.                                                                                                                 | Two-part fix: (1) Amend `document-inverses.ts:31-37` `case 'delete'` to emit `image-insert` when `op.preservedSource.kind === 'image'` (currently lossy: image-insert → delete → undo → insert{kind:'image'} → save → page lost). (2) Implement `applyInsert` for `'original'` by reading the page ref from the document-store's snapshot of the file's original page tree (pdf-lib's `copyPages` from a fresh `PDFDocument.load(originalBytes)` to the in-progress `doc`, then `insertPage(atIndex, ref)`). The original-bytes are already held per handle (P2-L-2). The `'inserted'` source-kind is Phase 3 combine — leaving that as a warning is fine. |
| HIGH        | `src/main/pdf-ops/replay-engine.test.ts` overall                                                                         | 12 test cases; covers rotate/delete/image-overlay/image-insert/annotation/multi-op (rotate+delete+annot) and image-cache dedup. **MISSING:** reorder, text-replace round-trip from non-empty runs (impossible today because `listTextRuns` returns []), insert with `'original'` source, delete→undo→save round-trip, image-overlay-edit, image-overlay-delete. The two BLOCKERs above would have been caught by either of the first two missing cases. | Add four round-trip cases before Phase 2 ship: (a) reorder pages 0→2 in a 3-page PDF and assert post-replay page hashes match the expected permutation; (b) delete page 1 then insert it back via inverse → assert page count stable + identity; (c) image-overlay then image-overlay-edit → assert overlay rect is the edited one; (d) image-overlay then image-overlay-delete → assert overlay is gone. Each test is ~20 lines using existing `createSimplePdf` + `createBlankPng` helpers.                                                                                                                                                              |
| —           | `src/main/pdf-ops/replay-engine.ts:122-284`, `image-embed.ts`, `text-replace.ts`, `tiff-decoder.ts`, `document-store.ts` | **Purity confirmed.** Grep `from 'node:fs'\|from 'fs'\|console\.\|require(\|process.env\|better-sqlite3\|electron` across the four pdf-ops modules: zero matches (only `console.log` reference is inside a comment header). `file-hash.ts` and tests are FS-touching but those are Phase 1 (file hashing requires disk) and test-only. The engine is genuinely pure.                                                                                    | Keep. This is the headline Phase 2 architectural promise (P2-L-2 + conventions §13.2) holding under audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| —           | `src/main/pdf-ops/replay-engine.ts:122-160`, fold-then-emit ordering                                                     | Order: load → ctx build → fold ops (step 3) → defer-render overlays (step 3.5) → emit annotations (step 4) → emit outline (step 4.5) → serialize (step 5). Matches edit-replay-engine.md §4 verbatim.                                                                                                                                                                                                                                                   | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| —           | `src/ipc/handlers/pdf-apply-edit-ops.ts:122-137`                                                                         | Atomic write pattern correct: temp file path constructed via `join(dirname(destPath), '.{basename}.tmp-{pid}-{ts}')` — same-directory invariant (cross-volume Windows rename pitfall avoided), `unlink(tempPath).catch(() => {})` in error path, `rename()` (not copy+unlink). ENOSPC mapped to `disk_full`. Test coverage in `pdf-apply-edit-ops.test.ts:100-141` exercises the cleanup.                                                               | Keep. Pattern is exemplary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| MEDIUM      | `src/ipc/handlers/fs-write-pdf.ts:106-111`                                                                               | **Legacy `fs:writePdf` path bypasses atomic-save.** `await deps.writeFile(dest.path, bytesToWrite)` writes DIRECTLY to the destination path with no temp+rename. Partial-write on power loss leaves a corrupted file at the user-visible name. Phase 2 introduced `fs:applyEditOps` which handles atomic write correctly; `fs:writePdf` is now the legacy `kind:'bytes'` path used by combine (and the now-dead `kind:'ops'` path).                     | Mirror the temp+rename pattern from `pdf-apply-edit-ops.ts:122-137` in `fs-write-pdf.ts`. Or — better — deprecate the `kind:'ops'` branch of `fs:writePdf` entirely (the `saveDocumentThunk` now goes through `applyEditOps`) and document that `fs:writePdf` is for bytes-only. The `kind:'ops'` code path is still live and would silently corrupt on partial write.                                                                                                                                                                                                                                                                                     |
| LOW         | `src/main/pdf-ops/replay-engine.ts:264-272`                                                                              | `doc.save({ updateFieldAppearances: false })` — confirmed against edit-replay-engine.md §10 expectation. The `addDefaultPage: false` also matches.                                                                                                                                                                                                                                                                                                      | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| LOW         | `src/main/pdf-ops/replay-engine.ts:541`                                                                                  | `isDirtyOrUnsaved` filter is correct: only dirty OR unsaved annotations get re-emitted. Clean-and-saved annotations are skipped (their objects are already in the source PDF).                                                                                                                                                                                                                                                                          | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| LOW         | `src/main/pdf-ops/replay-engine.ts:611-616`                                                                              | Phase-4 shape annotations (`Square` / `Circle` / `Line`) emit a warning + return `objectNumber: null` — clean scope fence.                                                                                                                                                                                                                                                                                                                              | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### B. Image-embed security

| Sev    | File:Line                                   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Recommendation                                                                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —      | `src/ipc/handlers/pdf-embed-image.ts:30`    | `MAX_IMAGE_BYTES = 50 * 1024 * 1024` (50 MB) cap enforced on raw bytes before any decode. Validation runs `detectImageMimeType` (magic-byte sniff) and rejects when the sniff disagrees with declared MIME OR is null.                                                                                                                                                                                                                                                                                                     | Keep. The cap is documented in edit-replay-engine.md §11.2 — explicit.                                                                                                                                                                                                                                  |
| —      | `src/main/pdf-ops/image-embed.ts:31`        | `computeImageContentHash` uses `createHash('sha256')` — cryptographic, 256-bit, from `node:crypto`. Resistant to second-preimage attacks within the dedup-cache scope (per-replay-invocation `Map<string, PDFImage>`). No collision attack vector even in adversarial documents.                                                                                                                                                                                                                                           | Keep.                                                                                                                                                                                                                                                                                                   |
| —      | `src/main/pdf-ops/image-embed.ts:164-187`   | `detectImageMimeType` does PNG/JPEG/TIFF magic-byte sniff (PNG `89 50 4E 47`, JPEG `FF D8 FF`, TIFF `II*\0` / `MM\0*`). No format-confusion route.                                                                                                                                                                                                                                                                                                                                                                         | Keep. The sniff is consumed BEFORE the renderer's declared mimeType is trusted — defense in depth.                                                                                                                                                                                                      |
| MEDIUM | `src/main/pdf-ops/tiff-decoder.ts:51-103`   | TIFF magic + version sniff rejects BigTIFF (version 0x2b) explicitly. The dynamic `import('utif')` is wrapped in try/catch returning `tiff_decoder_unavailable` — graceful degradation. **HOWEVER:** the decoder calls `input.buffer.slice(...)` TWICE (lines 107-110 + 135-138) — once for `utif.decode` and once for `utif.decodeImage`. For a 50MB TIFF that's two 50MB allocations. Memory amplification on the embed path. Diego's `utif` dep should hit MAX_IMAGE_BYTES first so this is bounded, but it's wasteful. | Pass `arrayBuffer` once and reuse. Minor perf — promote to LOW if you prefer.                                                                                                                                                                                                                           |
| MEDIUM | `src/main/pdf-ops/tiff-decoder.ts:158-163`  | `rgba.byteLength !== ifd.width * ifd.height * 4` check is good defense against malformed TIFFs, BUT a 32K×32K TIFF passing the magic-byte sniff would allocate 4GB before hitting this check (width and height come from utif's decode and are NOT bounded by MAX_IMAGE_BYTES — the raw file might be small, the uncompressed pixel buffer enormous).                                                                                                                                                                      | Add a hard cap on `ifd.width * ifd.height` (e.g. 100 megapixels = 400MB) before calling `utif.decodeImage`. Phase-2 spec doesn't mandate this but adversarial TIFFs are a documented attack class (libtiff CVEs). Mark `[RUNTIME-VERIFY]` once Diego adds the `utif` dep so the limit can be exercised. |
| MEDIUM | `src/ipc/handlers/pdf-embed-image.ts:73-81` | TIFF is pre-decoded at ingest (`await decodeTiff(req.image.bytes)`) — good UX (errors surface as toasts before save). But the decoded PNG bytes are THROWN AWAY after the check; `embedImage` decodes a SECOND time at replay. For multi-MB TIFFs across many image-inserts, that's 2x the decode cost. Cache the decoded PNG bytes inside the EditOperation (or in the content-hash map).                                                                                                                                 | Optional optimization. Phase 2 ship cost: TIFF imports are slow. Document in the handler header as a known follow-up.                                                                                                                                                                                   |
| LOW    | `src/main/pdf-ops/tiff-decoder.ts:96-97`    | `const utifModule = 'utif'; utif = (await import(/* @vite-ignore */ utifModule)) as typeof utif` — variable-bound dynamic import keeps the build green without `utif` in deps. The pattern is sound but the `@vite-ignore` comment is fragile (electron-vite may rename the directive in a future bump).                                                                                                                                                                                                                   | Pin `electron-vite` major in package.json (Diego owns) and add a comment cross-referencing Diego's Wave 8 D-8.1 `utif` add so the next reader knows the indirection is intentional.                                                                                                                     |
| LOW    | `src/main/pdf-ops/tiff-decoder.ts:197-262`  | Self-contained PNG encoder (~100 LOC) — no `sharp`/`canvas` dep. Implementation is RFC-compliant (sig + IHDR + IDAT + IEND, zlib-wrapped deflate, filter byte 0/None per scanline).                                                                                                                                                                                                                                                                                                                                        | Keep. Avoids ~50MB of native deps. The CRC32 is via `node:zlib` `crc32` (Node 18+) — pinned in `engines` field? Verify Diego's package.json `engines.node` ≥ `18.18` (where `zlib.crc32` exists).                                                                                                       |

### C. Text-replace input sanitization

| Sev    | File:Line                                                                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MEDIUM | `src/main/pdf-ops/text-replace.ts:181-201`                                             | `page.drawText(newText, ...)` — pdf-lib internally escapes content-stream characters (verified against pdf-lib's `PDFPageDrawText.encodeText` source: `(`, `)`, `\\` are octal-escaped). NO PDF-operator injection route via newText.                                                                                                                                                                                                                                                                                                                                                         | Keep. Cross-reference the pdf-lib escape behaviour in a comment so the next reviewer doesn't suspect a hole.                                                                                                                                                                                                                                                                                                  |
| MEDIUM | `src/ipc/handlers/pdf-replace-text.ts:28`                                              | `MAX_REPLACE_TEXT_LEN = 5_000` — reasonable cap. UTF-16 string length, not byte length, so a 5000-char string of CJK runes is ~15KB UTF-8 — fine.                                                                                                                                                                                                                                                                                                                                                                                                                                             | Keep.                                                                                                                                                                                                                                                                                                                                                                                                         |
| MEDIUM | `src/main/pdf-ops/text-replace.ts:111-204` `applyTextReplace` + `listTextRuns:220-249` | **Engine always returns `text_span_not_found`.** `listTextRuns` returns `[]` (intentional Phase-2.5 stub). `applyTextReplace` checks `runs.length === 0` at line 136 and returns `text_span_not_found`. So every text-replace op fails at save time. Since the renderer text-edit-overlay needs an `activeSpan` populated by `pdf:identifyTextSpan` (which itself returns `no_text_at_point` because `listTextRuns` is the same stub), the user-facing flow is effectively blocked at step 1. NO data corruption, just dead-end UX. Brief §"Triage of Wave 7 discoveries" row 4 accepts this. | Document loudly in `user-guide.md` (Nathan's Wave 9): "Text editing in Phase 2 is preview-only; right-click a text run and choose 'Replace text' from the context menu — Phase 2.5 ships the inline overlay." Track Phase 2.5 ticket for the real walker. Marking as MEDIUM (not LOW) because the brief says the channel is "live" — that's misleading; the dispatch succeeds but the operation always fails. |
| LOW    | `src/main/pdf-ops/text-replace.ts:160-170`                                             | Glyph-coverage check uses `font.getCharacterSet().includes(cp.charCodeAt(0))` — works correctly for WinAnsi. The check rejects any codepoint outside Helvetica's character set with `missing_glyph`. No Unicode-normalization (NFC) before the check; codepoints in NFD form may mis-match what WinAnsi expects (e.g. precomposed é vs e + combining acute).                                                                                                                                                                                                                                  | Normalize newText with `newText.normalize('NFC')` before iterating codepoints. Cosmetic for ASCII flows; matters for diacritic-heavy languages.                                                                                                                                                                                                                                                               |

### D. Bookmarks cycle detection + MoveBookmarkResult boundary

| Sev      | File:Line                                                                                                                                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HIGH** | `src/main/db-bridge.ts:57, 216, 395-399, 422` + `src/ipc/handlers/bookmarks-phase2.ts:64-76` + `src/ipc/handlers/bookmarks-phase2.test.ts:85-99` | **H-1 above. `MoveBookmarkResult` discriminated-union collapse.** Three sites of boolean drift (bridge interface, memory impl, Ravi-adapter interface) + one heuristic handler + one test that encodes the heuristic instead of testing the contract. Severity HIGH because: (a) `invalid_parent` variant is completely unreachable (no UI surface for "the parent doesn't exist" — the user gets "cycle detected"); (b) the misclassification surfaces in the renderer toast, not a silent log; (c) the api-contracts.md §12.6 promise is broken. | Marcus's recommended remediation in the Wave 8 brief is correct: amend `docs/data-models.md` §7.5 to the union (Wave 2 lesson #5 reality-amendment > spec-retraction), widen the three `boolean` types in `db-bridge.ts` to `MoveBookmarkResult`, and switch on the variant in the handler. ~30 lines of source delta + 3 doc lines + 2 new test cases (`not_found-with-non-null-parent` and `invalid_parent`). **REQUIRED in Wave 8.5 before Wave 9.** |
| —        | `src/db/repositories/bookmarks-repo.ts:248-301`                                                                                                  | Cycle-detection walks parent chain with a `MAX_DEPTH = 10_000` safety cap. Rejects: (a) self-as-parent (`newParentId === id`), (b) cycle via chain walk, (c) cross-file parent (`parent.file_hash !== self.file_hash`), (d) parent doesn't exist, (e) malformed tree (depth > 10k → treats as cycle). Discriminated-union return is correct at the repo.                                                                                                                                                                                           | Keep. The repo is the clean part — the bug is downstream.                                                                                                                                                                                                                                                                                                                                                                                               |
| —        | `src/db/repositories/bookmarks-repo.ts:322-347`                                                                                                  | `buildTree` promotes orphaned rows (dangling parent_id, cross-file id) to root. Comment is honest about the safety floor.                                                                                                                                                                                                                                                                                                                                                                                                                          | Keep.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| LOW      | `src/db/repositories/bookmarks-repo.ts:148, 156, 177`                                                                                            | `listTreeStmt` orders by `sort_order ASC, id ASC` — sparse-integer ladder works correctly. But there's no index on `(file_hash, sort_order)` — only `(parent_id)` per the migration. For very large bookmark sets (>10K), `listTree` does a full-file scan. Phase 2 cap is implicit (< few-hundred per file).                                                                                                                                                                                                                                      | Document the implicit cap in `migrations/0002_phase2_bookmarks.sql` header. Or add a composite index in a follow-up migration. Phase-3 scope.                                                                                                                                                                                                                                                                                                           |

### E. Chromium print-window security

| Sev                            | File:Line                                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                 | Recommendation                                                                                             |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `[RUNTIME-VERIFY: post-D-8.2]` | `src/main/export/chromium-export.ts` (not on disk yet) | Diego's parallel D-8.2 work — review deferred to Wave 8.5. Brief mandates: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `disableBlinkFeatures: 'Auxclick'`, `enableDragDropFiles` OMITTED (Electron default true; L-001 preserved), `show: false`, temp-file-based PDF load for >1MB docs, destruction in `finally`. | Re-audit once Diego's commits land. Add a `[RUNTIME-VERIFY]` row to Diego's status row in build-report.md. |
| `[RUNTIME-VERIFY: post-D-8.3]` | `src/main/export/print-dispatch.ts` (not on disk yet)  | Same as above for print dispatch.                                                                                                                                                                                                                                                                                                                                                                       | Same.                                                                                                      |
| —                              | `src/ipc/handlers/pdf-export-pdf.ts:33-50`             | The `chromiumExport` dep is correctly typed with the L-001 contract documented in JSDoc. The handler's pdf-lib path (lines 110-131) is correct and reviewed in section A. The Chromium dispatch path (133-148) is one-call-and-map, looks clean.                                                                                                                                                        | Keep.                                                                                                      |
| LOW                            | `src/ipc/handlers/pdf-print.ts:33-42`                  | `dispatchPrint` dep is currently a stub returning `print_dispatch_failed`. Documented in brief as Diego's D-8.3 work. Handler logic itself is sound.                                                                                                                                                                                                                                                    | Re-audit after D-8.3 lands.                                                                                |

### F. History middleware

| Sev    | File:Line                                                                                | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Recommendation                                                                                                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH   | `src/client/state/middleware/history-middleware.ts:60-83` + `document-inverses.ts:31-37` | **Inverse of `delete` for `image` / `original` / `inserted` source kinds is structurally wrong.** This is the renderer-side mirror of B-2 (BLOCKER). When the user deletes an image-inserted page and undoes, the inverse is `insert { source.kind: 'image' }` — the renderer model re-inserts the page (UI looks right), but at save time `applyInsert` no-ops on `'image'`. The fix needs to land in BOTH `document-inverses.ts` (emit `image-insert` instead of `insert` when the preserved source is an image) AND `replay-engine.ts:applyInsert` (handle `'original'` via copyPages from original-bytes). | See B-2 recommendation. Both files need the fix in the same Wave 8.5 patch.                                                                                                                                                                   |
| MEDIUM | `src/client/state/middleware/history-middleware.ts:42`                                   | Re-entrancy guard: `if (meta.__history === true) return false;` — short-circuits BEFORE `pushEntry`. **Correct.** The undo/redo branches (lines 56-85) dispatch with `meta.__history: true` so the inner `applyEdit` doesn't re-enter. Verified by reading the dispatch shape on lines 60-64 and 76-81.                                                                                                                                                                                                                                                                                                        | Keep. Riley's worry was correct to flag; the guard is exhaustive.                                                                                                                                                                             |
| MEDIUM | `src/client/state/slices/history-slice.ts:31-35`                                         | `maxHistory: 100` cap enforced via `shift()` (FIFO). The slice clears `future` on every new push — correct redo-after-edit semantics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Keep.                                                                                                                                                                                                                                         |
| MEDIUM | `src/client/state/middleware/history-middleware.ts:97-104`                               | Image compaction via `compactImageOpForHistory` zeroes `image.bytes` to `new Uint8Array(0)` and preserves `contentHash`. Storing only the hash means redo of `image-insert` requires the main-side image cache to still hold the bytes — and it does (per-handle, lifetime of the document). Compaction halves history memory for image flows.                                                                                                                                                                                                                                                                 | Keep. Pattern is the right call.                                                                                                                                                                                                              |
| MEDIUM | `src/client/state/middleware/history-middleware.test.ts`                                 | Only 3 cases (push, undo, redo) — all using `rotate`. **Missing:** undo round-trip for `delete`, `image-insert`, `image-overlay`, `text-replace`, all annotation variants. Each new EditOperation variant should have at least one undo→redo→assert-identity case. The Phase-2 inverses in `document-inverses.ts:59-105` are completely untested at the middleware level.                                                                                                                                                                                                                                      | Add 7 cases (one per Phase 2 EditOperation variant). Each is ~15 lines copy-pasta from the existing rotate test. The fact that the BLOCKERs above weren't caught is precisely because no test exercises the delete→undo→redo→save round trip. |
| LOW    | `src/client/state/middleware/history-middleware.ts:108-110`                              | `// eslint-disable-next-line no-console` for `console.warn` on inverse failure. Renderer console is visible only with devtools; production users won't see it. Phase 2 stamped this as known.                                                                                                                                                                                                                                                                                                                                                                                                                  | Keep. Phase 7 a11y / log-emit work routes through `log:emit` IPC.                                                                                                                                                                             |

### G. Renderer-gatekeeper boundary

| Sev      | File:Line                                                 | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Recommendation                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HIGH** | `.eslintrc.cjs:147-153`                                   | **The `no-restricted-imports` rule does NOT block `src/ipc/contracts`.** The pattern group lists `'**/src/main/**', '**/src/preload/**', '**/src/db/**', '**/src/ipc/handlers/**'` but NOT `'**/src/ipc/contracts*'`. A renderer file directly importing `from '../../ipc/contracts'` (e.g. `src/client/state/thunks.ts` if a future agent slips up) would PASS lint silently. Riley's catch on David's Wave 7 drift was a MANUAL review catch; the lint that conventions §4.3 says should enforce this boundary doesn't. | Add `'**/src/ipc/contracts*'` to the pattern group with `message: 'Renderer must route through src/client/types/ipc-contract.ts (the gatekeeper). See conventions §4.3.'`. Diego's parallel D-8 work can absorb this 3-line ESLint change without disturbing other tasks; or route through Wave 8.5. Required before Wave 9 because Nathan's Phase-2 docs reference the gatekeeper pattern as a hard rule. |
| —        | grep across `src/client/**` for `from '...ipc/contracts'` | Only matches are in `src/client/types/ipc-contract.ts` itself (lines 182, 187, 194). Riley's catch held.                                                                                                                                                                                                                                                                                                                                                                                                                  | Keep.                                                                                                                                                                                                                                                                                                                                                                                                      |
| LOW      | `src/client/types/ipc-contract.ts:1-21`                   | Header docstring explains the gatekeeper pattern clearly. After H above is fixed, this file's pattern is fully load-bearing.                                                                                                                                                                                                                                                                                                                                                                                              | Cross-reference the new ESLint rule from here once it lands.                                                                                                                                                                                                                                                                                                                                               |

### H. TypeScript strictness

| Sev    | File:Line                                                                                                                                                                                                                                                                                                                                                                                                        | Finding                                                                                                                                                                                                                                                                                                                                                                            | Recommendation                                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —      | grep across Phase 2 main + ipc                                                                                                                                                                                                                                                                                                                                                                                   | Zero `any` casts, zero `@ts-ignore`, zero `@ts-expect-error` across `src/main/pdf-ops/*.ts` and `src/ipc/handlers/pdf-*.ts` + `bookmarks-phase2.ts`. Discipline matches conventions §1.2.                                                                                                                                                                                          | Keep. Striking compared to the Phase-1 baseline (11 justified `any`s).                                                                                       |
| —      | grep across renderer                                                                                                                                                                                                                                                                                                                                                                                             | Phase 2 renderer adds zero new `any`s. The five from Wave 2 (`app.tsx:60`, `api.ts:28`, `settings-modal:77`, `vitest.setup.ts:24`, `document-selectors.test.ts:23`) remain — all from Phase 1.                                                                                                                                                                                     | Keep.                                                                                                                                                        |
| MEDIUM | `src/main/pdf-ops/replay-engine.ts` (655 lines), `src/client/components/modals/image-import-modal/index.tsx` (427), `src/db/repositories/bookmarks-repo.ts` (375), `src/client/state/slices/bookmarks-slice.ts` (271), `src/main/pdf-ops/text-replace.ts` (249), `src/client/components/text-edit-overlay/index.tsx` (223), `src/main/pdf-ops/tiff-decoder.ts` (263), `src/ipc/handlers/pdf-export-pdf.ts` (212) | Files >200 lines per CLAUDE.md modularization rule. Each is structural — split candidates: replay-engine into `replay-engine.ts` (entry + fold) + `replay-engine-ops.ts` (per-op handlers) + `replay-engine-annotations.ts` (emit); image-import-modal into shell + form + overlay-fields sub-components; bookmarks-repo into the SQL-statements module + the tree-builder module. | Phase 2.5 backlog. Modularization is cosmetic when the file IS the contract surface — replay-engine particularly is a single conceptual unit. NOT a blocker. |
| LOW    | `src/client/state/slices/bookmarks-slice.ts:75`                                                                                                                                                                                                                                                                                                                                                                  | `queue.shift()!` non-null assertion. The BFS is structurally correct (loop body only runs when length > 0), but the assertion can be removed: `const item = queue.shift(); if (!item) continue;`. Minor.                                                                                                                                                                           | Optional clean-up.                                                                                                                                           |
| LOW    | `src/main/pdf-ops/text-replace.ts:222-223`                                                                                                                                                                                                                                                                                                                                                                       | `_pageObjectNumber: number, _contentStreamIndex: number` — leading-underscore-ignored params. Conventions §1.4 endorses this for "this Phase-2 stub will accept these args once Phase 2.5 implements the walker".                                                                                                                                                                  | Keep. Honest.                                                                                                                                                |
| NIT    | `src/main/pdf-ops/replay-engine.ts:251-258`                                                                                                                                                                                                                                                                                                                                                                      | `emitBookmarksToOutline` pushes a warning string "Bookmarks-to-outline write-through deferred to Phase 2.5"; the bookmarks are NOT actually emitted to the /Outlines dictionary. The export flow returns ok with the warning.                                                                                                                                                      | Keep. Brief accepts this as Phase 2.5. Document in user-guide.                                                                                               |

### I. Test coverage gaps

| Sev    | File:Line                                                | Finding                                                                                                                                                                                                                                               | Recommendation                                                            |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| HIGH   | `src/main/pdf-ops/replay-engine.test.ts`                 | NO reorder test (B-1 root cause). NO insert-from-`original` test (B-2 root cause). NO undo-of-delete round-trip. NO image-overlay-edit test. NO image-overlay-delete test. The 12 tests look comprehensive but skip exactly the ops the BLOCKERs hit. | See A. Required before Phase 2 ship.                                      |
| HIGH   | `src/client/state/middleware/history-middleware.test.ts` | Only `rotate` is exercised. Every Phase 2 EditOperation variant needs a round-trip.                                                                                                                                                                   | See F.                                                                    |
| MEDIUM | `src/ipc/handlers/bookmarks-phase2.test.ts:85-99`        | Test ENCODES the heuristic instead of testing the contract. Add: (a) bookmark-not-found with non-null parent (should be `not_found`, currently mis-classified `cycle_detected`); (b) `invalid_parent` (parent doesn't exist OR wrong file_hash).      | Add the two cases as part of the Wave 8.5 H-1 fix.                        |
| MEDIUM | `src/main/pdf-ops/text-replace.test.ts` (77 lines)       | Three negative tests + one objectId encoding test. NO positive happy-path (because `listTextRuns` returns []). NO test for `applyTextReplace` with a manually-supplied bbox hint (the engine's stamp-overlay path can't be unit-tested today).        | Acceptable for Phase 2; Phase 2.5 work blocked on the walker.             |
| MEDIUM | `src/main/pdf-ops/document-store.test.ts`                | Phase 1 review flagged a gap in 60s-TTL coverage; Phase 2 adds `setBytes` + `getBytes`. Verify those have tests (likely yes given 143 lines).                                                                                                         | Read-only check; not blocking.                                            |
| MEDIUM | `src/main/pdf-ops/image-embed.test.ts` (142 lines)       | TIFF dynamic-import not exercised end-to-end (utif not in package.json until Diego's D-8.1). The unit test stub-paths the decoder.                                                                                                                    | Re-audit once Diego ships utif. Smoke test (D-8.7) provides e2e coverage. |
| MEDIUM | `src/main/pdf-ops/tiff-decoder.test.ts` (48 lines)       | Only header sniff + BigTIFF rejection are tested. Real decode path is utif-dep-blocked.                                                                                                                                                               | Same as above.                                                            |

---

## Recommendation on MoveBookmarkResult drift (Marcus's flag)

**Severity rating: HIGH.** Justification:

1. The `invalid_parent` discriminated-union variant is unreachable. Every "parent doesn't exist" or "parent belongs to different file" case is mis-routed as `cycle_detected`. The user sees a wrong toast.
2. The `not_found` + non-null-parent case mis-classifies as `cycle_detected`. A user dragging a stale bookmark (id from a previous session, since deleted) onto a real parent sees "Move would create a cycle" instead of "Bookmark not found — refresh the panel."
3. The api-contracts.md §12.6 promise of distinct error variants is broken. Wave 9 documentation will publish the contract; the contract doesn't match the implementation.
4. The test in bookmarks-phase2.test.ts ENCODES the bug as the expected behaviour. A naive refactor that "fixes" the bug would break the test, then a future agent would "fix" the test back to match the heuristic. The test is a future-bug magnet.

**Wave 8.5 fix is REQUIRED before Wave 9.** The 30-minute David patch Marcus scoped is the right size; my recommended scope:

- `docs/data-models.md` §7.5: amend `move(...)` return type to `MoveBookmarkResult` union (3 lines + amendment note).
- `src/main/db-bridge.ts`: widen the `BookmarksRepo.move` interface (line 57), the `MemoryBookmarksRepo.move` implementation (line 216), AND the `RaviBookmarksRepoPhase2.move` interface (line 422) — all three from `boolean` to `MoveBookmarkResult`. The `MemoryBookmarksRepo.move` body needs to return the discriminated shape instead of `true`/`false`.
- `src/ipc/handlers/bookmarks-phase2.ts:62-76`: switch on the variant directly. Map `'not_found'` → `fail('not_found', ...)`, `'cycle_detected'` → `fail('cycle_detected', ...)`, `'invalid_parent'` → `fail('invalid_parent', ...)` (the IPC error union already has this variant). Remove the request-shape heuristic.
- `src/ipc/handlers/bookmarks-phase2.test.ts:85-99`: replace the two heuristic-encoding cases with: (a) repo returns `{ ok: false, error: 'not_found' }` → handler returns `not_found` (regardless of newParentId shape); (b) repo returns `{ ok: false, error: 'cycle_detected' }` → handler returns `cycle_detected`; (c) repo returns `{ ok: false, error: 'invalid_parent' }` → handler returns `invalid_parent`.

This is mechanical work that closes a documented contract drift. Defer-to-Phase-2.5 would be wrong — the contract is in api-contracts.md §12.6 and Wave 9 documentation publishes it.

---

## What's good (Phase 2 calibration)

1. **Replay-engine purity is genuinely held.** No `fs`/`db`/`network`/`console` calls across the pdf-ops modules; pdf-lib + node:crypto + node:zlib only. The engine can be unit-tested headlessly. This is the architectural promise behind P2-L-2; it's holding.
2. **Atomic-save pattern in `pdf-apply-edit-ops.ts` is exemplary.** Same-directory temp file, pid+ts collision-resistance, cleanup-on-error via `.catch(() => {})`, `rename()` not `copyFile+unlink`. Two-byte test coverage (happy + cleanup). This is the right Phase 2 surface.
3. **SHA-256 for image content-hash + 50 MB byte cap + magic-byte sniff** in `pdf-embed-image.ts` — exactly the defense-in-depth posture the brief asked for. Zero MD5/CRC shortcuts. The hash is consumed via `node:crypto`, not a npm dep with its own attack surface.
4. **Bookmarks cycle detection at the repo** (`bookmarks-repo.ts:248-301`) is well-designed: discriminated-union return, trivial-cycle + chain-walk + cross-file + dangling-FK all handled, 10K-hop safety cap. The bug is the downstream collapse, not the algorithm.
5. **Renderer-gatekeeper boundary held by Riley's catch.** Despite ESLint not enforcing it (finding G-H above), Riley's manual review re-routed David's Wave 7 drift. The Phase 2 surface ships clean.
6. **TypeScript hygiene improved over Phase 1.** Zero new `any` casts in 38 files. Zero `@ts-ignore` / `@ts-expect-error`. Conventions §1.2 holding.
7. **L-001 holds across Wave 7 source.** No new `BrowserWindow` constructions added, and the future Chromium wrapper's JSDoc reaffirms the contract.

---

## Follow-ups (non-blocking for Phase 2 ship)

- Modularize replay-engine.ts (655 lines) into entry + per-op + emit modules. Phase 2.5.
- Modularize image-import-modal/index.tsx (427 lines) into shell + form + overlay sub-components. Phase 2.5.
- Replace `wouldCreateCycle` BFS in bookmarks-slice.ts with the same chain-walk pattern as the server-side repo (consistency + performance for deep trees). Phase 3.
- Add UTF-8 byte-length cap on `newText` (currently UTF-16 char count). Phase 2.5.
- Add a composite index `(file_hash, sort_order)` migration for bookmarks once user-document bookmark sets routinely exceed 100 entries. Phase 3.
- Document in user-guide that text-replace in Phase 2 is preview-only; right-click context-menu is the working flow. Phase 2.5 ships inline overlay (Nathan's Wave 9).
- Cross-reference pdf-lib's content-stream escape behaviour in a comment in text-replace.ts (audit trail).

---

## Per-area scorecard (Phase 2)

| Area                                | Blocker | High  | Medium | Low   | Nit   |
| ----------------------------------- | ------- | ----- | ------ | ----- | ----- |
| A. Replay-engine purity + atomicity | 2       | 1     | 1      | 2     | 0     |
| B. Image-embed security             | 0       | 0     | 3      | 2     | 0     |
| C. Text-replace input sanitization  | 0       | 0     | 3      | 1     | 0     |
| D. Bookmarks cycle + boundary       | 0       | 1     | 0      | 1     | 0     |
| E. Chromium print-window security   | 0       | 0     | 0      | 1     | 0     |
| F. History middleware               | 0       | 1     | 4      | 1     | 0     |
| G. Renderer-gatekeeper boundary     | 0       | 1     | 0      | 1     | 0     |
| H. TypeScript strictness            | 0       | 0     | 1      | 2     | 1     |
| I. Test coverage gaps               | 0       | 1     | 4      | 0     | 0     |
| **Total (unique)**                  | **2**   | **5** | **11** | **9** | **4** |

(HIGH inverse-of-delete shows in F and cross-references B-2 in A; HIGH lint-gap shows in G; HIGH MoveBookmarkResult in D; HIGH test-gap in I cross-references A. Sum reflects unique findings.)

---

## Required for Wave 9 dispatch (Marcus's gate)

**Wave 8.5 fixup MUST land before Nathan starts Wave 9 documentation.** The patches:

1. **B-1 fix:** correct `applyReorder` in replay-engine.ts + add reorder round-trip test. ~40 lines source + 25 lines test. Owner: David.
2. **B-2 fix:** correct `applyInsert` for `'original'` + `'image'` source kinds + amend `document-inverses.ts` to emit `image-insert` from delete-of-image. ~30 lines source + 40 lines test. Owner: David + Riley (paired).
3. **H-1 (MoveBookmarkResult) fix:** widen three `boolean` returns to `MoveBookmarkResult` + switch on variant + fix 2 tests + amend `data-models.md` §7.5. ~30 lines source + 15 lines test + 3 doc lines. Owner: David + Marcus (doc amendment).
4. **G-H (ESLint pattern) fix:** add `'**/src/ipc/contracts*'` to `no-restricted-imports` pattern group in `.eslintrc.cjs`. 3 lines. Owner: Diego (ESLint owner per his Wave 3 scope).

Total Wave 8.5 budget: ~150 lines source + 80 lines test + 5 lines doc. ~90 minutes of paired David+Riley work plus Diego's lint patch.

**If any of these slip past Wave 8.5, Wave 9 documentation will publish broken contracts.** Phase 2 ship is RED until they close.

---

# Wave 8.5 Re-audit — Julian

**Reviewer:** Julian (Director of Code Quality & Security Audit)
**Date:** 2026-05-21
**Scope:** Focused re-audit of B-1, B-2, H-1, H-2 fixes from Wave 8.5. NOT a full Wave 8 re-pass; the other 4 HIGHs from Wave 8 (H-3 test-coverage gap, H-5 inverse-of-delete duplicate of B-2, plus the F-history-middleware HIGH and I-test-coverage HIGH that fold into H-3) are touched only as part of the regression sweep.
**Files reviewed:** 10 specific files — `src/main/pdf-ops/replay-engine.ts`, `src/main/pdf-ops/replay-engine.test.ts`, `src/main/db-bridge.ts`, `src/ipc/handlers/bookmarks-phase2.ts`, `src/ipc/handlers/bookmarks-phase2.test.ts`, `src/client/state/slices/document-inverses.ts`, `src/client/state/slices/document-inverses.test.ts`, `.eslintrc.cjs`, `docs/data-models.md` §7.5, plus cross-checks against `src/main/pdf-ops/image-embed.ts`, `src/client/state/middleware/history-middleware.ts`, `src/client/types/ipc-contract.ts`.
**Tooling caveat:** static review only — no `npm install`, no Vitest run, no Electron boot. Test results trusted from David's + Riley's + Diego's build-report verification rows (224/224 main; 94/94 renderer; lint clean).

---

## Verdict (Wave 8.5)

**YELLOW** — three of the four Wave 8.5 fixes (B-1, H-1, H-2) are CLOSED cleanly with full test coverage. B-2 is CLOSED on its own terms (the engine no longer drops original/image-inserted pages on save), but the patches surface a follow-on contract gap (NEW finding N-1 below) in the renderer image-undo-of-delete → save path. N-1 is a HIGH, not a BLOCKER, because the user-facing fault mode is **save failure** (`invalid_image` error toast), not silent data corruption — the atomic-save pattern in `pdf-apply-edit-ops.ts` correctly rolls the whole save back when any op fails. The user sees an error toast and the original file on disk is unchanged.

Wave 9 (Nathan's documentation) CAN dispatch in parallel — the documented contracts are now honest. Phase 2 user-guide ships flows that either succeed end-to-end (the B-1/B-2 BLOCKERs) or fail-safely with a clear error message (N-1, on the image-undo-of-delete-then-save flow). Document N-1 as a Phase 2.5 follow-up in the user-guide's known-limitations section OR fix it in a fast Wave 8.6 patch (~30 lines).

---

## Closure status

| Finding                              | Pre-Wave-8.5 | Status now               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-1** reorder silent delete        | BLOCKER      | **CLOSED**               | `replay-engine.ts:368-409` correctly captures `doc.getPage(fromIndex)` → `removePage` → `insertPage(toIndex, captured)`. No-op when `fromIndex === toIndex` (correct). Out-of-range guard returns `op_apply_failed`. `ctx.pages` rebuilt post-mutation so downstream ops in the same fold see the new ordering. pdf-lib API choice verified against `node_modules/pdf-lib` docs — `insertPage(index, page)` re-wires `catalog.insertLeafNode(page.ref, index)`. **Tests (5 new):** forward (0→2), reverse (2→0), no-op (1→1), out-of-range, composition with rotate (rotation survives the move). Width-tagged fixture approach is structurally sound (avoids the content-stream-compression-defeats-text-grep trap David called out).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **B-2** applyInsert variant handling | BLOCKER      | **CLOSED** (engine side) | `replay-engine.ts:411-535` now handles all four `source.kind` variants:<br>- `'blank'` — works (Wave 7 baseline).<br>- `'image'` — full `embedImage` + `insertPage` + `drawImage` path; honors caller-provided pageWidth/pageHeight with A4-fit fallback.<br>- `'original'` — lazily loads `originalDoc` from `ctx.originalBytes`, validates `originalIndex` (non-negative integer + within page count), uses `doc.copyPages(originalDoc, [origIdx])` then `insertPage(atIndex, copied)`. `ReplayContext` gained `originalBytes` + `originalDoc: PDFDocument \| null` fields (lines 123+129+172-173); memoization correct (one parse per replay regardless of N original-page inserts).<br>- `'inserted'` — still a Phase-3 warning; correct scope fence given the engine has no access to other handles' bytes.<br><br>Riley's renderer-side `document-inverses.ts:case 'delete'` now correctly branches on `op.preservedSource.kind`: image → `image-insert`, original/blank/inserted → uniform `insert`. The asymmetric §7.1.3 contract is now honored end-to-end. **Tests (6 main + 8 renderer):** insert-original round-trip with width assertions, out-of-range originalIndex, insert-image re-creation, insert-blank regression, insert-inserted warning, delete+insert round-trip preserves rotation. Riley's 8 inverses tests cover per-variant inverse + 3 round-trip-identity cases + 1 annotation-regression pin.<br><br>**Caveat: see N-1 below.** The B-2 engine fix closes the structural gap (`'original'`/`'image'`/`'inserted'` no longer no-op). The remaining UX gap is on the renderer-history compaction path: undo of a delete-image-page produces an `image-insert` inverse whose `image.bytes` is zeroed by `compactImageOpForHistory` before reaching `dirtyOps`. On save, `embedImage` rejects empty bytes. Not B-2 itself — it's the next layer below. |
| **H-1** MoveBookmarkResult collapse  | HIGH         | **CLOSED**               | Three boolean sites widened: `BookmarksRepo.move` interface (`db-bridge.ts:83`), `MemoryBookmarksRepo.move` implementation (`db-bridge.ts:242-281` — also added the missing `invalid_parent` checks for non-existent or cross-fileHash newParentId), `RaviBookmarksRepoPhase2.move` interface (`db-bridge.ts:471-482`), and the adapter (`db-bridge.ts:439-450`). Handler (`bookmarks-phase2.ts:80-109`) switches on `result.error` with an exhaustiveness `never`-guard. All 4 variants tested explicitly (`bookmarks-phase2.test.ts`) — including the previously-impossible `not_found + non-null newParentId → not_found` case (the original heuristic mis-classified this as `cycle_detected`). The two Wave-7 heuristic-encoding tests are gone (not renamed; replaced). `data-models.md §7.5` amended honestly with a Wave 8.5 banner and the `MoveBookmarkResult` union block.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **H-2** ESLint enforcement           | HIGH         | **CLOSED**               | `.eslintrc.cjs:152-161` adds a fourth pattern-group entry covering `**/src/ipc/contracts`, `**/src/ipc/contracts.*`, `**/ipc/contracts`, `**/ipc/contracts.*` (the relative-path variant `'../../ipc/contracts'` is what the gatekeeper actually uses, so the `**/ipc/contracts*` variant is load-bearing). The `excludedFiles: ['src/client/types/ipc-contract.ts']` glob inherited from Wave 3 keeps the gatekeeper legal. Grep-verified: only the gatekeeper imports from `'../../ipc/contracts'` (3 sites at lines 182, 187, 194). Diego's negative test (temp file `src/client/__negative_test_h2.ts`) confirmed the rule fires with the expected message; temp file deleted. Existing renderer code lints clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## Boundary translation recommendation: `invalid_parent` → `'invalid_payload'`

**Recommendation: ACCEPT as Wave 8.5 ship state; ESCALATE to Phase 2.5 amendment.**

David's mapping is contract-correct given his scope (he was prohibited from editing `docs/api-contracts.md` §12.6, which is a frozen Wave 1 doc). The IPC `BookmarksMoveError` union per §12.6 is `'db_unavailable' | 'not_found' | 'invalid_payload' | 'cycle_detected'` — no `'invalid_parent'` variant exists at the wire. Mapping repo `invalid_parent` → IPC `invalid_payload` reads semantically as "the parent reference is structurally invalid" — accurate, if blunt.

**Why this isn't ideal:**

1. The renderer toast for `'invalid_payload'` will surface as a generic "Move failed — invalid request" rather than the precise "Parent bookmark doesn't exist or belongs to a different file." UX precision is lost.
2. The mapping conflates two distinct error classes: client-side payload-shape errors (`id` not an integer, `newSortOrder` negative) AND server-side reference-integrity errors (`newParentId` points to a non-existent or cross-file row). A future renderer might want to differentiate (retry vs. refresh-then-retry).
3. The `invalid_parent` variant exists at the repo (Ravi's Wave 7) and now at the bridge (David's Wave 8.5), but is unreachable at the IPC surface. Three layers carry the precision; the wire throws it away.

**Phase 2.5 follow-up:** amend `docs/api-contracts.md §12.6` to add `'invalid_parent'` to `BookmarksMoveError`, then change David's handler line 92-96 to `fail<BookmarksMoveError>('invalid_parent', ...)`. ~3 lines doc + 3 lines source + 1 test rename. Wave 8.5 didn't include this because the brief explicitly froze Wave 1 docs. Marcus's call whether to absorb this into Wave 8.6 or defer to Phase 2.5.

Not blocking Wave 9. Nathan's user-guide should describe the "parent doesn't exist" failure mode generically ("the bookmark move failed — refresh the bookmarks panel and retry") until the variant lands properly.

---

## New findings (Wave 8.5 patch-induced)

### N-1 (HIGH) — Renderer history compaction defeats engine's image-undo-of-delete save path

**Files:** `src/client/state/middleware/history-middleware.ts:101-104` + `src/client/state/slices/document-inverses.ts:39-46` + `src/main/pdf-ops/image-embed.ts:69-71`.

**The chain:**

1. User inserts an image page → renderer dispatches `image-insert` with full `bytes`. Op pushed to `dirtyOps`. History middleware computes `inv = inverseOf(image-insert) = delete{preservedSource:{kind:'image', image:{...,bytes:full}}}`. Both `fwdCompact` and `invCompact` are pushed to history (bytes zeroed for storage hygiene per conventions §13.3). Good so far — `dirtyOps` has the raw forward op with full bytes.
2. User deletes the image page → renderer dispatches `delete{preservedSource:{kind:'image',image:{...bytes:full}}}` (the deleted page's `sourcePageRef` carries the bytes). Riley's `inverseOf` correctly emits `inv = image-insert{image:preservedSource.image}` with full bytes. **But** before this inverse is pushed to history, the middleware compacts both fwd AND inv (`history-middleware.ts:102-103`). The compacted inverse has `image.bytes = new Uint8Array(0)`.
3. User undoes → middleware reads `entry.inv` (the COMPACTED inverse, zero bytes) and dispatches it as `payload: entry.inv` (`history-middleware.ts:62`). The renderer's `applyEdit` reducer pushes this compacted op to `dirtyOps` (`document-slice-apply.ts:62`). **`dirtyOps` now contains an `image-insert` with empty bytes.**
4. User saves → engine receives dirtyOps, calls `applyImageInsert` → `embedImage(doc, ctx.imageCache, op.image)` → `image-embed.ts:69-71` rejects on empty bytes → `invalid_image`. Atomic-save rolls back. User sees a save failure toast.

**Riley flagged this at contract-observation #3 in her status row:** "David's `applyImageInsert` MUST look up by `contentHash`, not consume `bytes` from the op payload. Verify this assumption holds in David's main-side fix; if not, the compaction order needs revisiting in a follow-up." David's fix did NOT add a content-hash lookup; `embedImage:69-71` rejects empty bytes BEFORE the content-hash cache check at line 73. **The contract observation was correct; the verification step didn't happen.**

**Severity HIGH (not BLOCKER):** The atomic-save pattern catches the failure and leaves the on-disk file untouched. The user sees a toast and loses the unsaved edit chain, but their original file is intact. This is the difference between "saves a broken file" (B-2 pre-fix BLOCKER) and "fails to save with a clear error" (N-1 HIGH).

**Two viable fix paths:**

A. **Reorder compaction so `dirtyOps` carries the raw op, not the compacted op.** Today `history-middleware.ts` dispatches `payload: entry.inv` where `entry.inv` is compacted. Change to: store both `inv` and `invCompact` in the history entry; dispatch the raw `inv` on undo (it ends up in `dirtyOps` with real bytes); the compacted form is only for the history slice's storage footprint. Cost: ~10 lines of history-middleware + history-slice changes. Risk: doubles the in-memory bytes during the brief window between dispatch and history-store update. Acceptable for image payloads bounded at 50MB.

B. **Add a content-hash lookup at `embedImage`.** Move the empty-bytes check after the cache check; if `image.bytes.byteLength === 0` AND `cache.get(contentHash)` returns nothing, THEN fail. The cache is per-replay so the first save's freshly-embedded image is gone by the second save — to make this work, main needs a persistent per-handle image cache (the `document-store.ts` would gain a `setImageBytes(handle, contentHash, bytes)` / `getImageBytes(handle, contentHash)` API). Cost: ~50 lines across `document-store.ts`, `image-embed.ts`, the handler. Architecturally bigger but matches the design intent in `ipc-contract.ts:230-234` ("Main's image-cache holds the real bytes for the handle's lifetime; redo retrieves by hash").

**Recommendation:** Path B is the contract-correct fix per the doc comment in `ipc-contract.ts:230-234`. Path A is a faster patch if Wave 8.6 budget is tight. Either way, fix in Wave 8.6 OR document the limitation in `user-guide.md` ("Undo of a deleted image-page must be redone before saving, OR re-import the image — this is a known Phase 2 limitation, scheduled for Phase 2.5"). Don't ship the user-guide silent on this.

### N-2 (LOW) — `applyInsert` is now async; rest of the case branches are sync in the dispatcher

`replay-engine.ts:411` changed `applyInsert` from sync to `async`. The dispatcher `applyOp` is already async so this is local. No regression. Cosmetic observation: the function gained two `await` points (line 489 `PDFDocument.load` and line 508 `doc.copyPages`) — both correct. The `'blank'` branch (line 421-428) and the `'inserted'` warning branch (line 530-534) don't actually need `async`; pre-existing sync paths now wrap in a Promise. Trivial. Not worth fixing.

### N-3 (NIT) — `MoveBookmarkResult` is exported from `db-bridge.ts` and imported by `bookmarks-phase2.ts`

The type is correctly placed at the bridge boundary (`db-bridge.ts:60-62` exports it; `bookmarks-phase2.ts:8` imports it). A purist would say the discriminated-union type belongs in `src/ipc/contracts.ts` (the contract module) rather than the bridge. But contracts.ts is locked Wave 1 doc territory and David honored the freeze. Acceptable.

---

## L-001 + H-3 + locked decisions still hold?

| Item                                                                                           | Status    | Evidence                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-001 (`enableDragDropFiles` default-true preservation)                                        | **HOLDS** | `src/main/window-manager.ts` untouched in Wave 8.5. `src/main/window-manager.test.ts` 2/2 passing per David's verification row. Grep across `src/` for `enableDragDropFiles` returns zero hits. No new BrowserWindow construction added. |
| L-001 deferred Wave 8.5 check (Diego's D-8.2 `chromium-export.ts` + D-8.3 `print-dispatch.ts`) | **HOLDS** | Diego's D-8 work landed in Wave 8. Their security floor was outside Wave 8.5 scope and is not re-audited here. Re-flagging for completeness: `[RUNTIME-VERIFY: post-D-8.2/D-8.3]` from Wave 8 carries forward.                           |
| H-3 retirement (Phase-1 fidelity-boundary closure)                                             | **HOLDS** | `src/main/pdf-ops/h3-retirement.test.ts` 3/3 passing per David's verification row. B-1 and B-2 patches do not touch the H-3 surface (`fs:writePdf` ops branch retirement).                                                               |
| Locked Decision 1 (Hybrid Print-to-PDF)                                                        | **HOLDS** | No replay-engine change affects the engine selector.                                                                                                                                                                                     |
| Locked Decision 2 (PDF-native annotations)                                                     | **HOLDS** | No annotation-emit changes in Wave 8.5.                                                                                                                                                                                                  |
| Locked Decision 3 (Redux Toolkit)                                                              | **HOLDS** | Riley's inverse-map fix is within `@reduxjs/toolkit@2.2` + reselect. No state-library churn.                                                                                                                                             |
| Locked Decision 4 (Windows file-association installer)                                         | **HOLDS** | No installer changes in Wave 8.5.                                                                                                                                                                                                        |

---

## Regression sweep (broader)

| Check                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The other 4 HIGHs from Wave 8 (H-3 test-gap, H-5 inverse-delete, F-history-middleware-test-gap, I-test-gap) | **H-5 closed** (Riley's fix matches the requirement). **H-3 test-gap closed for B-1 and B-2 coverage** (5 reorder + 6 insert tests added). **F + I test-gap partially closed** — `history-middleware.test.ts` still only exercises rotate per Wave 8 audit; Riley added inverse-map tests in `document-inverses.test.ts` (8 tests covering per-variant + round-trip). Strictly speaking, the round-trip identity tests in `document-inverses.test.ts` ARE the missing F/I tests, just located in a different file. Re-rate F + I from HIGH to MEDIUM post-Wave-8.5 — the gap is now "exhaustive coverage of every Phase 2 op kind through the full undo/redo cycle in middleware tests", not "no undo/redo round-trip tests at all". Phase 2.5 backlog. |
| `applyInsert` `'original'` lazy-load memory leak risk?                                                      | **None.** `ctx.originalDoc` is scoped to one replay invocation and garbage-collected when the `ctx` goes out of scope after `replay()` returns. No persistent reference. The 50MB cap on `originalBytes` is enforced upstream at the handle level (per P2-L-2). For a multi-op chain with 100 original-page inserts, one parse cost (~50MB working set briefly) and then reused.                                                                                                                                                                                                                                                                                                                                                                        |
| `applyInsert` `'original'` correctness across rotated pages                                                 | **Holds.** David's test case `delete + insert round-trip preserves rotation on the restored page (B-2 composition)` pins the documented "original = fresh-from-bytes" contract: rotate(0,90) + delete(0) + insert(0, original) → restored page has rotation 0. This matches `edit-replay-engine.md §4.1`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `db-bridge.ts` `MemoryBookmarksRepo.move` cycle-detection correctness                                       | **Holds.** The new in-JS BFS at lines 263-276 mirrors Ravi's chain-walk in `bookmarks-repo.ts:248-301`. Correctness verified by reading: starts with `descendants = Set([id])`, grows fixed-point until stable, returns `cycle_detected` if `newParentId ∈ descendants`. The cross-file `fileHash` check (line 259-261) and self-parent check (line 256) are honest belt-and-suspenders for the memory fallback.                                                                                                                                                                                                                                                                                                                                        |
| Existing renderer code clean under new H-2 lint rule                                                        | **Holds.** Grep across `src/client/**` for `from ['"][^'"]*ipc/contracts` returns only the 3 gatekeeper imports (`types/ipc-contract.ts:182,187,194`). No violation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Pre-existing `src/db/*.test.ts` better-sqlite3 ABI-mismatch failures                                        | **Unchanged.** 35-59 failures in repository tests are the Node/Electron ABI mismatch David flagged in his Wave-8.5 verification row — same as Wave 3 Issue D-1. Diego's responsibility; not caused by Wave 8.5 patches. CI uses Node 20 where the prebuild exists, so these pass in CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Atomic-save pattern still wraps all ops                                                                     | **Holds.** `pdf-apply-edit-ops.ts:122-137` temp-rename pattern unchanged. The new async behavior of `applyInsert` doesn't escape the per-op `Result<void, ApplyOpError>` discipline, so partial failure in a multi-op chain still triggers the handler's `mapReplayError` rollback. The on-disk file is never half-written.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| pdf-lib `copyPages` correctness for original-page restore                                                   | **Verified by spec.** pdf-lib's `copyPages(srcDoc, indices)` deep-clones via the PDFCopier — content streams, fonts, images, annotations all carried. The restored page is byte-equivalent (modulo metadata) to the original. David's width-tagged round-trip test pins this for at least the page-size dimension.                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## Per-fix scorecard

| Fix                             | Code quality                                                                                          | Test quality                                                                                                | Doc honesty                                      | Net                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| B-1 (applyReorder)              | Clean — captures page ref, identity no-op, out-of-range guard, ctx.pages rebuild                      | Strong — 5 cases including composition                                                                      | N/A                                              | CLOSED                         |
| B-2 (applyInsert + inverse map) | Clean — all 4 variants honest, `originalDoc` memoized, validation guards present                      | Strong on engine side (6 cases) + strong on renderer side (8 cases)                                         | N/A                                              | CLOSED on terms; N-1 follow-on |
| H-1 (MoveBookmarkResult)        | Clean — exhaustiveness guard via `never`-cast, all 3 bridge sites widened, memory fallback correct    | Strong — 4 explicit variants + throw → db_unavailable; the heuristic-encoding tests are gone (not retained) | data-models.md §7.5 amended honestly with banner | CLOSED                         |
| H-2 (ESLint enforcement)        | Clean — 4 glob variants for belt-and-suspenders coverage, gatekeeper excluded, negative test verified | Negative test was a temp file (acceptable for lint verification)                                            | N/A                                              | CLOSED                         |

---

## Wave 9 dispatch verdict

**GREEN with N-1 caveat for Nathan.**

Wave 9 (Nathan, documentation) MAY dispatch. The four Wave-8 patches close their respective findings cleanly; the documented contracts now match the implementation:

- B-1: reorder no longer silently deletes. User-guide can document "drag a thumbnail to reorder, then save" without lying.
- B-2: undo of delete-original-page restores the original page byte-for-byte. User-guide can document "Ctrl+Z restores deleted pages."
- H-1: bookmark-move errors are correctly classified. `api-reference.md` can list the actual error variants the wire returns.
- H-2: the renderer-gatekeeper boundary documented in `conventions.md §4.3` is now ENFORCED by ESLint, not just by manual review. `developer-guide.md` can describe the gatekeeper pattern with the lint rule as the mechanical backstop.

**Nathan must include in `user-guide.md`:**

1. **N-1 limitation:** "Undo of a deleted image-inserted page must be followed by re-importing the image before saving — saving immediately after undo will fail with 'Image data unavailable'. This is a known Phase 2 limitation; Phase 2.5 fixes the underlying image-cache lookup." OR wait for Wave 8.6 if Marcus dispatches it.
2. **Bookmark-move `invalid_parent` UX:** "If moving a bookmark fails with 'Move failed — invalid request', refresh the bookmarks panel (the parent may have been deleted by another action) and retry."

These two notes are ~6 lines of doc. Nathan can absorb in his Wave 9 budget.

**If Marcus prefers RED → fix in Wave 8.6, then GREEN:** N-1 (Path A — reorder compaction) is ~10 lines. ~30 minutes paired David + Riley work. Then Wave 9 dispatches with no documented limitation. This is the cleanest finish.

**Recommendation:** Wave 8.6 to close N-1 via Path A (~30 minutes), then Wave 9 dispatch. The marginal time is worth shipping a clean Phase 2.

---

## Remaining Phase 2 HIGH/MEDIUM backlog (Phase 2.5 candidates)

These were in the Wave 8 audit (not addressed by Wave 8.5) and remain open:

| Sev          | Item                                                                                 | Recommended phase                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH→MED     | `history-middleware.test.ts` only exercises `rotate` (F-history-middleware test gap) | Phase 2.5 — add 7 round-trip cases (one per EditOperation variant). Riley's new `document-inverses.test.ts` partially covers the gap. |
| HIGH→MED     | `replay-engine.test.ts` missing positive text-replace happy-path (I-test-gap)        | Phase 2.5 — blocked on Phase 2.5 walker implementation.                                                                               |
| MED          | `fs-write-pdf.ts` legacy `kind:'ops'` path bypasses atomic-save                      | Phase 2.5 — deprecate the `kind:'ops'` branch entirely once `fs:applyEditOps` is the only save route.                                 |
| MED          | TIFF 32K×32K pixel-bomb (`tiff-decoder.ts:158-163`)                                  | Phase 2.5 — add hard cap on `ifd.width * ifd.height` before `utif.decodeImage`.                                                       |
| MED          | api-contracts §12.6 missing `invalid_parent` variant                                 | Phase 2.5 — see "Boundary translation recommendation" above.                                                                          |
| MED          | Bookmarks `(file_hash, sort_order)` composite index                                  | Phase 3 — implicit cap at <100 bookmarks/file in Phase 2 makes the cost acceptable.                                                   |
| LOW          | `replay-engine.ts` (now 700+ lines after Wave 8.5) modularization                    | Phase 2.5 — split into entry + per-op + emit.                                                                                         |
| LOW          | `inserted` source.kind cross-doc copy (engine + UI)                                  | Phase 3 combine work.                                                                                                                 |
| **NEW HIGH** | **N-1 image-undo-of-delete save failure**                                            | **Wave 8.6 OR Phase 2.5 (with user-guide caveat).**                                                                                   |

---

## Per-area scorecard (Wave 8.5 delta only)

| Area                             | Pre-Wave-8.5           | Post-Wave-8.5                                                                            |
| -------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Replay-engine purity + atomicity | 2 BLOCKER / 1 HIGH     | 0 BLOCKER / 1 HIGH (the HIGH demoted to MEDIUM since B-1/B-2 round-trips are now tested) |
| Bookmarks cycle + boundary       | 1 HIGH                 | 0 HIGH (1 NEW LOW: `invalid_parent` → `invalid_payload` mapping)                         |
| History middleware               | 1 HIGH                 | 1 HIGH (NEW N-1; the previous H-5 closed)                                                |
| Renderer-gatekeeper boundary     | 1 HIGH                 | 0 HIGH                                                                                   |
| Test coverage gaps               | 1 HIGH                 | 0 HIGH (the gap closed for B-1/B-2; remaining are MEDIUM Phase-2.5 candidates)           |
| **Net delta**                    | **2 BLOCKER + 5 HIGH** | **0 BLOCKER + 1 HIGH (N-1)**                                                             |

Net Wave 8.5 delivery: 2 BLOCKER + 4 HIGH → 1 HIGH. Phase 2 ship status: **RED → YELLOW** with N-1 as the one open HIGH, fixable in ~30 minutes (Wave 8.6) or documented honestly in Nathan's Wave 9 user-guide.

---

# Phase 2.5 Cleanup Re-audit — Julian

**Reviewer:** Julian (Director of Code Quality & Security Audit)
**Date:** 2026-05-22
**Scope:** Wave 10 patches — David (D-10.1 through D-10.4) + Riley (R-10.1 through R-10.3) + Diego (Di-10.1 through Di-10.3). Re-audit verifies closure of the 14 acceptance criteria in `phase-2.5-brief.md §5` + rules on the routing-typo D-10.3 flag + sweeps for patch-induced regressions.
**Files reviewed (10):** `docs/api-contracts.md §12.6`, `src/ipc/handlers/bookmarks-phase2.ts`, `src/ipc/handlers/bookmarks-phase2.test.ts`, `src/ipc/handlers/pdf-identify-text-span.ts`, `src/ipc/handlers/pdf-identify-text-span.test.ts`, `src/ipc/contracts.ts` (lines 215-280), `src/client/types/ipc-contract.ts` (full re-read of lines 1-279), `src/client/state/middleware/history-middleware.ts`, `src/client/state/thunks.ts` (moveBookmarkThunk only), `src/main/security/path-sanitizer.test.ts`, `.eslintrc.cjs`, `LICENSES.md` (header dates only).
**Tooling caveat:** static review only — Vitest + tsc + dist:win results trusted from David's + Riley's + Diego's build-report verification rows (266 main+ipc / 99 renderer / 47 path-sanitizer / dist:win @ 95.8 MB). L-001 + H-3 confirmed unchanged via grep.

---

## Verdict (Phase 2.5)

**GREEN.** All 8 acceptance criteria in the brief §5 are closed (14 of 14 sub-line-items if expanded). The 4 Wave-8 BLOCKERs + 5 HIGHs are now formally retired. **One new MEDIUM finding (M-1)** introduced by Diego's path-sanitizer "KNOWN GAP" block — public test documentation of 13 unaddressed attack vectors. Severity MEDIUM (not HIGH) because the Phase 1 risk model documented these as acceptable; the new exposure is that the test file now publishes a runbook of known-bypass inputs. Acceptable tradeoff vs. closing the source, but the orchestrator should weigh whether Phase 2.5.1 (sanitizer hardening + assertion-flip) should be ratcheted before any source distribution outside the build team.

David's D-10.3 routing-typo flag is a **false positive** — see "Routing typo ruling" below. Recommendation: option (b) — accept as-is, no follow-up patch needed.

Phase 3 dispatch readiness: **GREEN.** Marcus may dispatch Wave 11 architecture work in parallel with optional Phase 2.5.1 patches (sanitizer hardening, modularization, text-replace.ts walker) if budget permits.

---

## Acceptance criteria closure (14 line-items in phase-2.5-brief.md §5)

| #   | Criterion                                                             | Status                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `api-contracts.md §12.6` has `invalid_parent` + Phase 2.5 banner      | **CLOSED**                                | Read §12.6 (line 760-786). Banner present at line 784 with David's name + 2026-05-22 date. Union includes `'invalid_parent'`. Rationale sentence at line 782 matches the brief verbatim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | `bookmarks-phase2.ts` no longer translates; passes variant through    | **CLOSED**                                | Lines 91-115 switch on `result.error` with all 3 failure variants returning `fail<BookmarksMoveError>` of the same name. Header comment block 80-86 records the Wave-10 D-10.1 chain. `never`-cast exhaustiveness guard at line 110-114.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | `bookmarks-phase2.test.ts` covers 4 wire variants explicitly          | **CLOSED**                                | Lines 94/106/120/132/153 → `not_found+null`, `not_found+non-null`, `cycle_detected`, `invalid_parent` (NEW wire variant), `throw→db_unavailable`. The `invalid_parent` test (line 132-150) explicitly asserts `expectErr(r, 'invalid_parent')` — was `'invalid_payload'` pre-Wave-10. 18 tests total in handler.                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4   | `pdf:identifyTextSpan` returns real text-span data + clean error      | **CLOSED**                                | 615-line handler with a manual content-stream tokenizer + text-state simulator. Sampled 3 edge cases: (a) literal-string `\(` paren escape lines 434-435 handled; (b) hex-string odd-length pad line 488 adds trailing `0` per ISO 32000-1 §7.3.4.3; (c) TJ array with numeric kerning adjustments lines 358-373 — strings concatenated; kerning ignored (acknowledged in line 365-368 comment as honest approximation absorbed by bbox tolerance). 7/7 tests pass per David's verification row.                                                                                                                                                                                                                       |
| 5   | `ipc-contract.ts:230-234` comment matches Wave 8.6 dual-store reality | **CLOSED** (with routing rec — see below) | The doc comment ROUTING was wrong in the brief, not the substance. See "Routing typo ruling" — both files are now correct at their respective line-230 surfaces.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | `compactImageOpForHistory` handles `delete{preservedSource:image}`    | **CLOSED**                                | `src/client/types/ipc-contract.ts:267-277` adds the fourth branch with the Wave 10 R-10.1 banner. The asymmetry Riley flagged in Wave 8.6 observation #2 (forward `image-insert` was compacted, but forward `delete-of-image-page` was the silent leak path through the fall-through `return op`) is closed. Test at `history-middleware.test.ts` asserts `entry.fwd.preservedSource.image.bytes.byteLength === 0` AND `entry.rawFwd.preservedSource.image.bytes.byteLength === payload.bytes.byteLength` per Riley's status row.                                                                                                                                                                                      |
| 7   | Memory dedup decision sound (Path B chosen)                           | **CLOSED**                                | Riley chose Path B (documented + pinned, no code change). The identity-pinning invariant — `rawFwd.image.bytes === rawInv.preservedSource.image.bytes` for image-insert and the symmetric pair for delete-of-image — is documented at `history-middleware.ts:39-46` and PINNED by a new test. The architectural claim "~25 MB actual ceiling, not 50 MB" is correct under Object.is reference semantics: `inverseOf` reads the SAME ImageEmbedPayload reference from `op.image` (insert→delete inverse) or from `op.preservedSource.image` (delete→insert inverse) and rewires it into the inverse. JS heap holds one buffer per entry, not two. Decision defensible. (See N-1 below for the future-refactor concern.) |
| 8   | Renderer thunks handle `invalid_parent`                               | **CLOSED**                                | `src/client/state/thunks.ts:599-606` branches `wireError === 'invalid_parent'` with the toast `"Cannot move bookmark to that location."` Distinct from the `cycle_detected` toast at 592-598. String-widened comparison technique (line 580-588 comment) makes the branch forward-compatible regardless of D-10.1 landing order — sound engineering.                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | Path-sanitizer negative-test fixtures present (47-test split)         | **CLOSED**                                | `src/main/security/path-sanitizer.test.ts` — 7 pre-Wave-10 cases preserved unchanged at lines 5-65, +24 regression-pin cases (traversal × 7, control-chars × 6 + DEL pin, ext × 7 + case-variants × 3, relative-mode × 6, allow-list × 2 = 31; brief said 24; counting it.each table rows yields 24 fail-cases + 7 accept-cases in regression-pin; close enough), +13 known-gap cases (UNC × 2, device-namespace × 2, reserved-names × 7, percent-encoded `..` × 1, U+202E × 1, zero-width × 1 = 14; 13 ± rounding). 47/47 PASS per Diego's verification row.                                                                                                                                                          |
| 10  | `npm run dist:win` still produces a working installer                 | **CLOSED**                                | Diego ran end-to-end: NSIS @ 95,785,971 bytes (~95.8 MB), portable @ 95,557,510 bytes (~95.6 MB). Both produce 0.2.0 build. Default-icon + code-signing warnings remain Phase 7 polish. Accept Diego's result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 11  | Typecheck × 3 projects: 0 errors                                      | **CLOSED**                                | Main, preload, renderer all 0 errors per David + Riley + Diego verification rows (cross-checked across 3 status rows).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 12  | Test suite: 358+ passing                                              | **CLOSED**                                | David: 266 main+ipc. Riley: 99 renderer. Diego: 47 path-sanitizer (subset of David's 266). DB layer ABI-mismatched on Diego's post-dist:win run (60 fail) but PASS in CI with Node 20 ABI (321 pre-dist:win baseline + 41 net Wave 10 additions = 362 documented). Brief target ≥358 met (266 + 99 = 365 main+renderer count; the brief's 402+ from the dispatch summary mis-counted DB tests separately).                                                                                                                                                                                                                                                                                                             |
| 13  | L-001 lock holds                                                      | **CLOSED**                                | `src/main/window-manager.ts` untouched. `enableDragDropFiles` grep across `src/` → zero hits (verified). `window-manager.test.ts` 2/2 PASS per Diego. None of the Wave 10 touches landed in `src/main/window-manager.ts`, `src/main/index.ts` BrowserWindow construction, or any drag-drop surface.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 14  | H-3 retirement test still holds                                       | **CLOSED**                                | `h3-retirement.test.ts` 3/3 PASS per Diego. The `fs:writePdf` ops-branch retirement boundary is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Net:** 14/14 acceptance criteria CLOSED.

---

## Routing typo ruling — D-10.3 flag from David

**Recommendation: (b) Accept as-is, no follow-up patch needed.**

David flagged that the dispatch brief routed the dual-store doc-comment fix to `src/ipc/contracts.ts:230-234` (his file) but suggested the "matching" narrative actually lives at `src/client/types/ipc-contract.ts:230-234` (Riley's gatekeeper). He added the comment to HIS file and asked me to rule on whether the renderer-side comment needs a Wave 10.5 micro-patch.

**Reading both files in full at the line-230-234 range:**

1. `src/ipc/contracts.ts:230-244` — David inserted a NEW informational comment block above the `// 4. fs: channels` section banner. Describes the dual-store flow at the IPC boundary: "renderer dispatches raw image-insert op with bytes; history middleware stores a compacted form; raw form preserved separately in HistoryEntry and reaches IPC at save time." This block is accurate, correctly placed at the fs-channels surface (where `fs:writePdf` consumes the raw bytes), and explains why `applyImageInsert` doesn't need a content-hash lookup. **Correct and well-placed.**

2. `src/client/types/ipc-contract.ts:230-279` — This is **NOT a stale comment** as David's flag implied. Lines 230-249 are the JSDoc above `compactImageOpForHistory`, and Riley UPDATED IT in R-10.1 to include the Wave 10 R-10.1 banner at line 243 (the new fourth variant `delete{preservedSource:kind:'image'}`) and cross-refers to "Wave 8.6 N-1 two-state rationale" at line 236. The narrative accurately describes the current shipped behavior of the compactor.

**The dispatch brief's "doc comment at lines 230-234" routing was inherited from my Wave 8.5 re-audit text (line 484-486 of this file), where I wrote "the doc comment in `ipc-contract.ts:230-234` promises 'Main's image-cache holds the real bytes for the handle's lifetime; redo retrieves by hash'". Grepping the current `src/client/types/ipc-contract.ts` for those phrases returns zero hits — that text never existed in the renderer file; my Wave 8.5 audit was paraphrasing the architectural intent from `architecture-phase-2.md`, and the brief author treated my paraphrase as a literal source quotation.** Both files at line-230 now carry accurate, complementary narratives:

- David's file: how the dual-store reaches the IPC boundary (raw-bytes-on-dispatch contract from main's perspective).
- Riley's file: how the compactor builds the compacted form for storage (history-side compaction asymmetry closed).

The two are complementary, not duplicative. There is **no stale comment to retire**. The "Wave 10.5 micro-patch" David suggested is unnecessary.

(Light future-housekeeping note: my Wave 8.5 audit text at lines 484-486 of THIS file refers to a quote that doesn't exist verbatim in the source — purely cosmetic, no action required, but flagging so a future reviewer doesn't chase the same false trail.)

---

## New findings (regression sweep)

### M-1 (MEDIUM) — Path-sanitizer "KNOWN GAP" block publishes a runbook of attack vectors

**File:** `src/main/security/path-sanitizer.test.ts:188-232` (Diego's Di-10.1 addition).

The 13 known-gap cases now sit in the test file with `.not.toBeNull()` assertions and inline comments explicitly documenting: UNC paths, Win32 device namespaces, Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9 case-insensitive), percent-encoded `..` traversal, U+202E RTL override, zero-width chars (U+200B/U+200C). This is **explicitly documented attack-vector intelligence** in the source tree.

**The tradeoff:** publishing the runbook is the standard "make-it-loud" pattern (assertions flip when the source is hardened, forcing test review). The alternative (closing the sanitizer first) requires David source touches outside Wave 10 scope. Diego made the right call given his ownership boundary.

**The cost:** any user of the open-source repo (or any AI tool training on it) sees the exhaustive list of bypass vectors before the fixes. The Phase 1 risk model (paths only originate from OS dialog / drag-drop / recents — physical user consent gates input) makes this acceptable for the shipped Electron app, but if the codebase is later reused in a context where renderer-supplied paths come from network or untrusted sources, the runbook becomes a security gift.

**Recommendation:** Phase 2.5.1 wave with David hardening the sanitizer (one source file) + Diego flipping the assertions (one test file). ~90 minutes paired work. Track as MEDIUM — not blocking Phase 3 dispatch, but should land before any external code release.

### M-2 (MEDIUM) — Content-stream tokenizer parses untrusted PDF bytes; no fuzz coverage

**File:** `src/ipc/handlers/pdf-identify-text-span.ts:393-615` (David's D-10.2 tokenizer).

The new manual tokenizer + text-state simulator processes 50 MB of attacker-controllable PDF content-stream bytes. I sampled the parsing paths for the recurring failure modes (`readLiteralString` parenthesis depth at line 416-473, `readHexString` odd-length pad at line 488, `readArray` recursive items at line 508-539, nested `<<...>>` dict skip at line 572-588):

- **No infinite-loop risk on malformed streams:** every loop terminates on `i >= n` (line 420, 479, 511, 543, 552). Buffer-bound iteration; no unbounded recursion (only the array reader is recursive, but it only recurses via `readToken/readLiteralString/readHexString`, none of which call back into `readArray`).
- **No buffer overrun:** all indexed reads use `bytes[i]!` after `i < n` checks; `subarray(start, i)` is bounded by `i ≤ n`. JS arrays don't crash on OOB but the `!` non-null assertion is undefined at OOB — could surface as `String.fromCharCode(undefined)` → `"NaN"` in the token stream. Not a security issue, but a fuzzing target.
- **No prototype-pollution route:** the tokenizer produces plain `{kind, value}` objects via object literals — no `Object.assign` from untrusted keys.
- **HOWEVER:** zero fuzz tests. The 7 happy-path tests cover well-formed pdf-lib-generated content streams. Malformed inputs (unbalanced parens, truncated escapes, mid-token EOF, nested arrays at depth > stack-safe, BI...EI inline-image fixtures, attacker-crafted operand stacks like `Tf` with 0 operands which falls through silently per line 286-292) aren't tested. The handler returns `no_text_at_point` or `invalid_payload` from the OUTER wrapper if pdf-lib's `PDFDocument.load` fails, but the scanner itself silently swallows malformed-stream parser state and may emit phantom runs at (0,0) origin.

**Severity MEDIUM:** worst case is a renderer hit-test miss or a spurious bbox that confuses the text-edit overlay — no save-time data corruption, no escape into other layers. The pdf-lib `PDFDocument.load` wrapper already validates the broader document shape before the scanner runs.

**Recommendation:** Phase 3 add fuzz tests via `fast-check` or similar (5-10 property-based cases against deliberately-malformed content streams). The brief allotted David ~2 hours for D-10.2; a fuzz harness is +1 hour and worth doing before the scanner output starts gating production saves in Phase 3.

### L-1 (LOW) — Identity-pinning test depends on Object.is reference semantics; structuredClone refactor would break it

**File:** `src/client/state/middleware/history-middleware.test.ts` (the new R-10.2 dedup invariant test).

Riley pinned `rawFwd.image.bytes === rawInv.preservedSource.image.bytes` via strict equality. If a future agent refactors history-middleware to defensive-clone payloads (e.g. adds `structuredClone(action.payload)` before pushing to history to harden against renderer-side mutation after dispatch), the dedup-by-reference invariant breaks AND the ~25 MB ceiling becomes ~50 MB. The test catches it (fails loud), but the symptom is a confusing memory-ceiling regression rather than an obvious test breakage.

**Recommendation:** add a one-line comment in the test asserting the connection: "If this test fails, the rawFwd↔rawInv buffer-sharing invariant has been broken. Consult history-middleware.ts:39-46 for the architectural choice before changing the test." Cosmetic; not blocking.

### What's NOT a new finding

- David's tokenizer security (per above) — no exploitable surface; M-2 is process improvement.
- Riley's identity-pinning depending on Object.is — the test catches the regression; L-1 is documentation improvement.
- `LICENSES.md` scan-basis date refresh — diff is one date line; no content changes; no risk.
- ESLint safety-floor additions — all 5 rules verified zero-impact by Diego (10 errors / 87 warnings baseline preserved); pure ratchets.

---

## Phase 2 MEDIUM/LOW backlog status

Walking the Phase 2 Wave 8 review (lines 195-413) + Wave 8.5 re-audit backlog table (line 562-577) item by item:

| Backlog item                                                                                                                                  | Wave 10 status                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fs-write-pdf.ts` legacy `kind:'ops'` bypasses atomic-save                                                                                    | **still-open**                                                        | David did not touch fs-write-pdf.ts in Wave 10. Deferred to Phase 2.5.1 or Phase 3 (deprecate `kind:'ops'` branch entirely once `fs:applyEditOps` is the only save route).                                                                                                                                                                                                                                                     |
| TIFF 32K×32K pixel-bomb in `tiff-decoder.ts:158-163`                                                                                          | **still-open**                                                        | No tiff-decoder changes in Wave 10. Phase 2.5.1 candidate.                                                                                                                                                                                                                                                                                                                                                                     |
| api-contracts §12.6 missing `invalid_parent` variant                                                                                          | **closed-in-2.5**                                                     | D-10.1 closed end-to-end.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Bookmarks `(file_hash, sort_order)` composite index                                                                                           | **deferred-to-Phase-3**                                               | No migration changes in Wave 10. Implicit cap <100 bookmarks/file makes Phase 3 timing appropriate.                                                                                                                                                                                                                                                                                                                            |
| `replay-engine.ts` (700+ lines) modularization                                                                                                | **still-open**                                                        | No replay-engine refactor in Wave 10. Phase 2.5.1 or Phase 3 candidate.                                                                                                                                                                                                                                                                                                                                                        |
| `inserted` source.kind cross-doc copy                                                                                                         | **deferred-to-Phase-3-combine**                                       | Out of scope for Wave 10.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `history-middleware.test.ts` only exercises `rotate`                                                                                          | **closed-in-2.5**                                                     | Riley's R-10.1 + R-10.2 tests cover the image-bearing variants (forward delete-of-image + image-insert dedup invariant). The remaining 5 EditOperation variants (rotate already covered, plus annot-add/edit/delete, image-overlay, image-overlay-delete, text-replace) are still uncovered as round-trip tests in middleware, but the gap is narrower than Phase 2; downgrade from MEDIUM to LOW. Phase 3 absorbs as touched. |
| `replay-engine.test.ts` text-replace happy-path                                                                                               | **still-open**                                                        | Blocked on `listTextRuns` walker implementation in `text-replace.ts` (out of Wave 10 scope per brief — refactor of existing helper is Phase 3).                                                                                                                                                                                                                                                                                |
| Phase 1 path-sanitizer harder tests (UNC, device-namespace, reserved names)                                                                   | **closed-in-2.5** (test coverage) / **still-open** (source hardening) | Diego's 47-test split documents the gaps via the "KNOWN GAP" block. Source hardening deferred to Phase 2.5.1. See M-1 above.                                                                                                                                                                                                                                                                                                   |
| Phase 1 path-vectors.md fixture                                                                                                               | **closed-in-2.5**                                                     | Diego inlined the fixtures in the test file via `it.each` tables — equivalent coverage, no separate JSON file needed.                                                                                                                                                                                                                                                                                                          |
| `bridge_unavailable` first-class IPC variant                                                                                                  | **still-open**                                                        | Diego declined to pick up (requires source touches across every channel's error union — out of his file ownership). Phase 2.5.1 paired David+Riley wave candidate.                                                                                                                                                                                                                                                             |
| `dialog-save-as.ts` reserved-name/control-char tighter validator                                                                              | **still-open**                                                        | No dialog-save-as.ts changes in Wave 10. Cosmetic per Phase 2 review.                                                                                                                                                                                                                                                                                                                                                          |
| Renderer LOW: `combine-modal` empty-path validation, `empty-state` clickable recents, thumbnail-strip keyboard nav, bookmarks-panel Space key | **still-open**                                                        | No client component changes in Wave 10 (Riley's scope was middleware + types + thunks only). Phase 7 a11y or as-touched in Phase 3.                                                                                                                                                                                                                                                                                            |
| Image-embed N-1 (image-undo-of-delete save failure)                                                                                           | **closed-in-2.5** (was Wave 8.6)                                      | Riley's Wave 8.6 two-state HistoryEntry closed N-1 before Wave 10. R-10.1 + R-10.2 retire the last asymmetry (forward delete-of-image-page compaction).                                                                                                                                                                                                                                                                        |
| `image-embed.ts` content-hash lookup option (Path B from Wave 8.5)                                                                            | **still-open** but **superseded**                                     | Riley's Wave 8.6 + Wave 10 R-10.2 dedup-by-reference made Path B unnecessary. The dispatch contract now guarantees raw bytes at the IPC boundary; main doesn't need a per-handle image-cache. Architecturally cleaner than Path B. Mark as superseded, not still-open.                                                                                                                                                         |
| `tests/fixtures/path-vectors.md` (Phase 1 §G recommendation)                                                                                  | **closed-in-2.5**                                                     | Inlined via Diego's it.each tables (see above).                                                                                                                                                                                                                                                                                                                                                                                |
| 60-second token TTL test for `document-store.ts`                                                                                              | **still-open**                                                        | No document-store test changes in Wave 10. Phase 3 absorb as touched.                                                                                                                                                                                                                                                                                                                                                          |
| Test-helper `expectErr<E>(res, e)` across 13 handler tests                                                                                    | **partially-closed**                                                  | David's `expectErr` helper exists in `bookmarks-phase2.test.ts:13-18` and `pdf-identify-text-span.test.ts`. Not retrofitted to the other 11 handler tests. Phase 3 absorb.                                                                                                                                                                                                                                                     |

**Summary:** 5 items `closed-in-2.5`, 8 items `still-open` (most deferred to Phase 2.5.1 or Phase 3), 2 items `deferred-to-Phase-3`. Net backlog reduced from ~15 to ~10 open items, with the highest-impact closures (N-1, invalid_parent wire, identify-text-span, history compaction symmetry) landed.

---

## L-001 + H-3 + locked decisions still hold?

| Item                                                                            | Status    | Evidence                                                                                                                                                         |
| ------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-001 (`enableDragDropFiles` default-true preservation)                         | **HOLDS** | Grep across `src/` for `enableDragDropFiles` returns zero hits. `window-manager.test.ts` 2/2 PASS per Diego. No Wave 10 touches in `src/main/window-manager.ts`. |
| H-3 retirement (Phase-1 fidelity-boundary closure for `fs:writePdf` ops-branch) | **HOLDS** | `h3-retirement.test.ts` 3/3 PASS per Diego. No fs-write-pdf.ts changes in Wave 10.                                                                               |
| Locked Decision 1 (Hybrid Print-to-PDF)                                         | HOLDS     | No engine-selector changes in Wave 10.                                                                                                                           |
| Locked Decision 2 (PDF-native annotations)                                      | HOLDS     | No annotation changes in Wave 10.                                                                                                                                |
| Locked Decision 3 (Redux Toolkit)                                               | HOLDS     | Riley's history-middleware changes are within `@reduxjs/toolkit@2.2`. No state-library churn.                                                                    |
| Locked Decision 4 (Windows file-association installer)                          | HOLDS     | No installer changes in Wave 10.                                                                                                                                 |

---

## Per-area scorecard (Phase 2.5 delta only)

| Area                                         | Pre-Wave-10                           | Post-Wave-10                                |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| Bookmarks (H-1 / `invalid_parent` wire)      | 1 LOW (Wave 8.5 boundary translation) | **0**                                       |
| Image-undo-of-delete save (N-1 chain)        | 1 HIGH (N-1)                          | **0** (closed in Wave 8.6)                  |
| Compaction asymmetry (Riley Wave 8.6 obs #2) | 1 LATENT bug                          | **0** (R-10.1 closes)                       |
| `pdf:identifyTextSpan` scanner               | 1 stub (Phase 2.5 carry-over)         | **0** + 1 NEW MEDIUM (M-2 fuzz gap)         |
| Path-sanitizer test coverage                 | 1 MEDIUM (Phase 1 deferral)           | **0** + 1 NEW MEDIUM (M-1 runbook exposure) |
| ESLint safety floor                          | partial                               | full (5 rules ratcheted, zero impact)       |
| dist:win regression risk                     | unverified for Wave 10                | **0** (95.8 MB installer verified)          |
| **Net delta**                                | **1 HIGH + 4 MEDIUM + 1 latent**      | **0 HIGH + 2 MEDIUM (NEW)**                 |

Phase 2 ship status: **YELLOW → GREEN.** Phase 3 dispatch readiness: **GREEN.**

---

## Phase 3 dispatch verdict

**GREEN — Marcus dispatches Wave 11 architecture.**

The Wave 10 patches close every acceptance criterion in the brief. The 2 new MEDIUM findings (M-1 sanitizer runbook, M-2 tokenizer fuzz gap) are Phase 2.5.1 or Phase 3 candidates, not Wave 11 blockers. The Phase 2 backlog is reduced from ~15 items to ~10, with the highest-impact items closed.

Recommended ordering for Marcus:

1. **Wave 11** (Phase 3 architecture — Riley) dispatched in parallel with any of:
2. **Optional Phase 2.5.1 micro-wave** (paired David + Diego, ~90 minutes) to close M-1 (sanitizer source hardening + Diego flips the 13 KNOWN GAP assertions). Worth doing before any external release; not blocking Phase 3.
3. **Phase 3 absorb-as-touched:** M-2 fuzz harness for the content-stream tokenizer when Phase 3 lights up text-replace's save-time use of the scanner.

No Wave 10.5 patch needed. David's D-10.3 routing-flag is a false positive — both line-230 sites carry accurate, complementary narratives.

---

## Per-fix scorecard

| Fix                                                         | Code quality                                                                                 | Test quality                                                                  | Doc honesty                                                            | Net                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------- |
| D-10.1 (invalid_parent wire variant)                        | Clean — exhaustiveness `never`-guard, Phase 2.5 amendment banner                             | Strong — 4 wire variants asserted explicitly + 1 throw→db_unavailable         | api-contracts §12.6 amended with provenance banner                     | CLOSED                 |
| D-10.2 (pdf:identifyTextSpan scanner)                       | Clean — 615 LOC manual tokenizer, terminating loops, no buffer overrun, BI...EI skip         | Adequate — 7 tests including 3 new scanner tests; fuzz coverage missing (M-2) | Handler header documents approximation honestly                        | CLOSED + M-2 follow-up |
| D-10.3 (dual-store doc comment)                             | Clean — new info block at `contracts.ts:230-244` describes the fs-channels boundary contract | N/A (comment-only)                                                            | Riley's gatekeeper-side comment already accurate (false positive flag) | CLOSED                 |
| R-10.1 (compactImageOpForHistory delete-image branch)       | Clean — 4th variant added; symmetric with image-insert                                       | Strong — byte-zero assertion + raw-form preservation pin                      | JSDoc updated with Wave 10 R-10.1 banner                               | CLOSED                 |
| R-10.2 (memory dedup — Path B)                              | N/A (no code change)                                                                         | Strong — identity-pinning test fails loud on future Object.is breakage        | history-middleware.ts:39-46 self-documents                             | CLOSED + L-1 cosmetic  |
| R-10.3 (thunks invalid_parent toast)                        | Clean — string-widened comparison forward-compatible regardless of D-10.1 landing order      | Adequate — thunk test coverage gap is pre-existing Phase 2 backlog            | Toast strings distinct and user-precise                                | CLOSED                 |
| Di-10.1 (path-sanitizer 40 new tests + ESLint safety floor) | Clean — test-only + lint-only, zero source touches                                           | Strong — 47/47 PASS; 24 regression-pin + 13 known-gap + 10 existing           | KNOWN GAP block self-documents Phase 2.5.1 candidates                  | CLOSED + M-1 follow-up |
| Di-10.2 (LICENSES.md re-verification)                       | N/A                                                                                          | N/A                                                                           | Scan basis refreshed to 2026-05-22                                     | CLOSED                 |
| Di-10.3 (dist:win smoke)                                    | N/A (release verification)                                                                   | N/A (build artifact)                                                          | NSIS 95.8 MB + portable 95.6 MB                                        | CLOSED                 |

---

# Wave 13 Phase 3 Code Review — Julian

**Reviewer:** Julian
**Date:** 2026-05-22
**Scope:** All Phase 3 source from Wave 12 (David + Ravi + Riley)
**Files reviewed:** 41 (form-engine, field-dict-authoring, mail-merge-runner, csv-excel-parser, replay-engine extension, all 11 forms-\* handlers, register.ts forms wiring, preload forms namespace, db-bridge formTemplates adapter, form-templates-repo + migration, db/types.ts Phase 3 additions, forms-slice / mail-merge-slice / forms-templates-slice, form-commit-middleware, document-inverses Phase 3 branches, thunks Phase 3 additions, form-fill-overlay + form-designer + forms-panel + mail-merge-modal + save-template-modal + flatten-on-export-checkbox)
**Findings (Phase 3):** 1 BLOCKER, 4 HIGH, 6 MEDIUM, 5 LOW, 3 NITS

## Verdict (Phase 3)

**RED** — one BLOCKER (B-3.1) makes folder-mode mail-merge fail on every production invocation. Phase 3 cannot ship until the sanitizePath wiring is fixed. The other four HIGHs are quality / security / contract gaps that should be patched in a Wave 13.5 fixup; none of them risks data corruption on the user's source PDF, but two of them (H-3.1 JS-action leak, H-3.2 MailMergeJob.flattenForms gap) materially change the documented Phase 3 behavior. Code quality, type-safety, and HYBRID commit-boundary discipline are otherwise solid.

## Top-3 Phase 3 issues

1. **B-3.1** (Critical) — `register.ts:509` wires the production mail-merge runner with `sanitizePath: (raw) => sanitizePath(raw)`. The default `sanitizePath` rejects any path whose extension is not `.pdf` (path-sanitizer.ts:31, 258-262). In folder-mode mail-merge the runner calls `deps.sanitizePath(job.outputMode.outputFolder)` (mail-merge-runner.ts:157) with a _directory_ path — `extname` returns `''` — sanitizer returns null — runner aborts with `output_path_invalid`. Folder-mode is the wizard's default `outputMode` (mail-merge-slice.ts:81). Tests inject permissive `(raw) => raw` (mail-merge-runner.test.ts:109, forms-run-mail-merge.test.ts:61, 93) so the gap is structurally hidden from CI. **Production folder-mode mail-merge is 100% broken.** Fix: wrap with `sanitizePath(raw, { allowedExtensions: new Set(['', '.pdf']) })` for folder-mode, OR provide a separate folder-sanitizer in path-sanitizer.ts.

2. **H-3.1** (High, security/integrity) — `stripDocLevelJavaScript` is called ONLY inside the `formOps.length > 0` conditional in replay-engine.ts:288-374. Any save that touches annotations / image overlays / text-replace / page-structure but no form ops retains the document's `/Names /JavaScript` actions across the save. Worse: the mail-merge runner's `fillForm` save path (form-engine.ts:401-470) never calls `stripDocLevelJavaScript` at all, so every mail-merge output PDF carries the template's JS actions verbatim. Per P3-L-2 (conventions §14.6, locked decision 2), Phase 3 MUST strip doc-level JS on save. Fix: move the strip call outside the `formOps.length > 0` conditional in replay-engine, AND add it to `fillForm` (before the `doc.save`).

3. **H-3.2** (High, contract gap, confirms Riley's flag) — `MailMergeJob` (contracts.ts:1113-1121) has no `flattenForms` field. The UI checkbox state `flattenInOutput` in mail-merge-slice.ts:82-145 is `void`-discarded at mail-merge-modal/index.tsx:172 with the misleading comment "runner reads mailMergeSlice.flattenInOutput directly" — the runner has no access to the renderer slice. Every mail-merge output, regardless of the wizard checkbox, comes out unflattened. **Severity HIGH** (not LOW as the brief tentatively rated): users will report "flatten checkbox is broken" as their first usability complaint; the wire-level contract gap is observable to the end user. Fix: amend `MailMergeJob` to carry `flattenForms: boolean`, plumb through mail-merge-modal at `job:` construction, and have the runner pass `{ flattenForms }` into `fillForm` (which today doesn't accept that flag — `fillForm` itself needs a flatten branch).

## Findings by category

### A. Replay-engine extension correctness

**STRONG.** 5 new EditOperation variants (form-commit, form-design-add, form-design-remove, form-design-edit, form-flatten) integrate cleanly with the Phase 2 fold-then-emit + atomic-save invariant. The two-stage architecture (per-op fold validates shape only; form-ops collected and applied in a single pass at step 3.6 — replay-engine.ts:281-374) is faithful to architecture-phase-3.md §5.7 and preserves the existing pure-function contract.

- **Inverses (document-inverses.ts:128-201):** all 5 round-trip cleanly. form-commit's inverse symmetrically swaps `fieldValues` / `previousValues` (correctly handling `previousValues[name] === undefined` as "reset to defaultValue at save"). form-design-add ↔ form-design-remove are symmetric snapshot/snapshot. form-flatten's composite inverse is honestly documented as the simplified form (emits a form-commit only; the comment at document-inverses.ts:181-196 surfaces the limitation).
- **Field-creation boundary respected:** text/checkbox/dropdown/radio routed through pdf-lib's `form.createTextField` / `createCheckBox` / `createDropdown` / `createRadioGroup`. Signature uses `createSignaturePlaceholder` (field-dict-authoring.ts) which hand-authors `/FT /Sig` + widget annotation + wires both into `/AcroForm /Fields` AND the target page's `/Annots`. Field-dict authoring is well-formed: correct field-dict + widget-annotation pairing, `/F` print bit set, `/Ff` Required bit when applicable, idempotent over `/AcroForm` already-existing.
- **JS-action strip (H-3.1 above):** the contract is on paper but the call site is wrong. **HIGH.**
- **M-3.1 (form-design ordering re-shuffle):** replay-engine.ts:292-325 applies form-design-add → form-design-edit → form-design-remove regardless of the user's authored op sequence. If a user adds field `X`, removes `X`, then adds another `X` in the same save, the order at save-time is: add (1st add), add (2nd add) [duplicate-name fail], edit, remove. The fold-time order ignores intent. Phase 3 risk is low (designer modal won't typically produce this sequence) but worth documenting as a known limitation; Phase 3.1 fix would interleave correctly using op insertion order.
- **M-3.2 (form-flatten ordering):** if a user dispatches `form-flatten` THEN authors a new field, the per-op fold's collect-and-defer means the flatten consumes ONLY pre-flatten fields. After flatten any subsequent `form-design-add` op succeeds at save (no duplicate-name conflict since flatten removed the field), but the user's UX expectation may be that flatten is terminal. Document as a P3-L extension or in user-guide.
- **L-3.1 (encrypted-PDF path):** `replay` returns `encrypted_unsupported` (replay-engine.ts:168-172) but `detectForms` / `fillForm` / `flattenForms` / `createField` / `removeField` / `editField` all pass `ignoreEncryption: false` (or omit, which defaults to false) and surface as `load_failed` with no encrypted-discrimination. Consider widening the error union for consistency with replay.

### B. Mail-merge runner safety

- **Cancellation (mail-merge-runner.ts:185-188):** polled at the top of each row loop iteration. Atomic semantics: concat-mode honors cancel by emitting no output (line 257-259). Folder-mode honors by leaving partial outputs on disk (some written, others not). The user-facing toast in thunks.ts:986 says "Mail merge cancelled" — clear. **L-3.2:** the partial-folder-output semantics aren't documented user-facing; consider a Phase 3 toast: "Cancelled after N of M rows; partial outputs in folder."
- **Progress events (register.ts:511-520):** `MailMergeProgressEvent` carries `jobId, phase, currentRow, totalRows, percent, latestWarning?` — NO PII (no row contents, no field values). Good.
- **Atomic write per row (H-3.3, High):** mail-merge-runner.ts:218 calls `await deps.writeFile(dest, fillRes.value.newBytes)`. The runner's JSDoc at line 56 says "Atomic-rename write: caller decides folder vs file path resolution." But register.ts:506-508 wires `writeFile: async (p, b) => { await fsPromises.writeFile(p, b); }` — direct write, NOT atomic temp+rename. Compare fs-apply-edit-ops at register.ts:283-288 which uses `writeFile` + `rename` separately. Power-loss / disk-full during a row write leaves a corrupt PDF on disk. Particularly bad for the concat-mode final write (the big one). Fix: route through `documentStore.atomicWrite` or duplicate the temp-rename pattern (`await fsPromises.writeFile(p + '.tmp', b); await fsPromises.rename(p + '.tmp', p);`) at the register.ts wire.
- **Cached template strategy (correct):** `templateBytes` loaded ONCE via `loadTemplateBytes` (line 144); `fillForm(templateBytes, ...)` per-row internally calls `PDFDocument.load(bytes)` afresh each invocation (form-engine.ts:408) — state doesn't accumulate. Good.
- **Per-row error handling (M-3.3, Medium):** mail-merge-runner.ts:193-199 returns immediately on the first `fillForm` failure. The brief said "continues + accumulates" — but the runner short-circuits. Reasonable design choice for v1 (one malformed row stops the batch with a clear error), but the comment at the top of the file says "per-row error handling: continues" — contract drift between the runner and the brief. Pick one: either continue and accumulate row errors in `warnings`, or document that the current behavior is fail-fast. Phase 3 ship: leave fail-fast but update the doc comment.
- **L-3.3 (event-loop yielding):** `setTimeout(0)` every 10 rows (line 241-243) is correct cross-runtime; `setImmediate` not available in browsers (renderer never runs this anyway). Good.
- **M-3.4 (concat memory):** `filledBytesForConcat: Uint8Array[]` accumulates ALL filled PDFs in memory. 100-row × 1 MB template = 100 MB. Plus the `PDFDocument` instances held during `concatPdfs`. Practical mail-merge sizes will OOM on large jobs. Phase 3.1 stream the concat (open the output doc once, append each filled doc, save once).
- **B-3.1 (above) is also a mail-merge runner finding** but escalated to BLOCKER because folder-mode is broken at the wire.

### C. CSV/Excel parser safety (David's built-in RFC 4180 tokenizer)

- **RFC 4180 (csv-excel-parser.ts:101-164):** handles quoted fields with embedded `,`, escaped `""`, CRLF/LF/lone-CR. Strong implementation; matches the spec well.
- **UTF-8 + BOM:** `TextDecoder('utf-8', { fatal: false })` handles UTF-8; BOM stripped at line 58.
- **M-3.5 (UTF-16 NOT handled):** Excel's "Save As Unicode Text (.csv)" produces UTF-16 LE with BOM (`FF FE`). `TextDecoder('utf-8')` on UTF-16 bytes produces mojibake (one-character-per-two-bytes interpreted as garbage). The parser doesn't detect the UTF-16 BOM (`0xFF 0xFE`) and switch decoders. Likely user-visible: "the header row decodes to symbols." Fix: detect 2-byte BOM at the start, branch to `TextDecoder('utf-16le')` / `utf-16be`.
- **Malformed input:** rejects with `invalid_data_source` for empty rows / missing header — does not crash. Good.
- **Excel fallback (csv-excel-parser.ts:184-201):** dynamic-import with actionable error message when exceljs is not installed. Diego's Wave 13 packaging adds the dep — fallback is the right pattern until then. Good.
- **L-3.4 (header dedupe collision):** if input has headers `[A, A_2, A]` the dedupe produces `[A, A_2, A_2_2]` — correct but the warning string says "Renamed duplicate header 'A' -> 'A_2_2'" which mis-implies the second `A` was renamed to `A_2_2`. Tiny improvement: include the column index in the warning.
- **N-3.1 (ragged-row drop):** lines 89 drops rows that are entirely empty (`cells.length === 1 && cells[0] === ''`), which is the right CSV semantics, but rows with N-1 empty cells + a trailing empty are NOT dropped. Probably fine; document if a user complains.

### D. Form-templates repo

- **Discriminated-union return (form-templates-repo.ts:66-68):** `UpsertFormTemplateResult` correctly typed; `name_in_use` / `not_found` variants distinguishable at the repo boundary.
- **Adapter preserves the union (db-bridge.ts:750-781):** forwards `name_in_use` verbatim, intentionally downgrades `not_found` → `invalid_payload` because the wire (api-contracts §13.7) doesn't carry a `not_found` variant. This is the Wave 8.5 H-1 lesson applied correctly: when the wire is narrower than the repo, the bridge is the boundary that explicitly narrows. Good.
- **JSON-in-TEXT encoding (db-bridge.ts:706-724):** `parseFields` / `parseMappings` use try/catch + array/object check. Malformed JSON degrades to `[]` / `null` (silent), not to a thrown error. **L-3.5:** silent degradation hides a corrupt DB row; consider pushing a `warnings` entry through the bridge contract or surfacing as a per-template error in `list()`. Phase 3.1 nice-to-have.
- **Prepared statements:** all 7 statements (form-templates-repo.ts:110-184) use parameterized `@name` / `@id` bindings. No string interpolation. Good.
- **Transaction wrapping:** upsert wraps the name-collision-check + insert/update in a single `db.transaction(...)`. Correct.
- **Migration (0003_phase3_forms.sql):** 1 table + 2 indexes (idx on name, idx on updated_at DESC for list ordering). Forward-only. Schema_migrations row written by the runner. Conforms to data-models §8.4. Good.

### E. Renderer HYBRID commit-boundary discipline (conventions §14)

**STRONG.** This was the highest-risk integration risk in Phase 3 and Riley nailed it.

- **`formsSlice.values` is transient (forms-slice.ts:38-39):** never dispatched as EditOperations. Per-keystroke writes go through `setFieldValue` reducer; no `applyEdit` call.
- **`formCommitMiddleware` (form-commit-middleware.ts:62-106):** listens for `formCommit/trigger`, diffs `values` vs `committedValues`, constructs ONE `form-commit` EditOperation, dispatches through `applyEdit`. Clean.
- **`saveDocumentThunk` auto-fires (thunks.ts:168):** `dispatch(triggerFormCommit())` runs before the save-IPC. Integration verified.
- **Form-design ops (thunks.ts:765, 788, 815):** each dispatches `applyEdit(res.value.op as EditOperation)` per-op — they DO go through history. Per-op undo of designer field changes works as documented.
- **Mail-merge bypass (thunks.ts:970-1021):** `runMailMergeThunk` dispatches NO `applyEdit`. Confirmed via grep — only `runStarted` / `progressTick` / `runCompleted` / `runFailed` / `pushToast`. The open document's `dirtyOps` is unchanged across a mail-merge run. Good — conforms to conventions §14.4 anti-pattern.
- **L-3.6 (operationId collision):** form-commit-middleware.ts:96 builds `operationId` from `Date.now() + Math.random().toString(36).slice(2, 8)`. Two commits in the same ms with the same 6-char random suffix would collide (~1 in 2^31). Non-security but worth pinning to `crypto.randomUUID()` like the other handlers (forms-design-add.ts:7, forms-flatten.ts:7).

### F. Renderer-gatekeeper boundary

- **ESLint no-restricted-imports:** Diego's Wave 8.5 H-2 ratchet at `.eslintrc.cjs:171-179` blocks any renderer file from importing `**/src/ipc/contracts*`. Verified: only `src/client/types/ipc-contract.ts` (the gatekeeper, line 156 excludedFiles) imports from `../../ipc/contracts`. All Phase 3 renderer files (slices, components, thunks, middleware) import from `'../../types/ipc-contract'` correctly.
- **No direct `electron` imports** in any Phase 3 renderer code. Preload is the only `electron` consumer.
- **N-3.2 (gatekeeper coverage):** verified that `MailMergeJob`, `MailMergeOutputMode`, `MailMergeProgressEvent`, `FormFieldDefinition`, `FormFieldValue`, `FormTemplateListItem`, and all 11 Phase 3 Request/Response types are re-exported from `src/client/types/ipc-contract.ts` (types-only). Nothing leaks past the boundary.

### G. UI safety

- **Form-fill validation:** the handler (forms-fill.ts:50-86) validates type-match, option-membership for radio/dropdown, and normalizes dates. Errors surface as `field_type_mismatch` / `option_not_in_field` / `field_not_found`. Renderer toasts in thunks.
- **Mail-merge wizard step 3:** `nextDisabledFor` (mail-merge-modal/index.tsx:232-253) blocks the Next button when ANY required field has no column mapping. Matches the runner's `unmapped_required_field` guard. Defense in depth. Good.
- **M-3.6 (perf — detect-per-fill-call):** `forms-fill.ts:40`, `forms-design-add.ts:97`, `forms-design-remove.ts:37`, `forms-flatten.ts:37` all call `await detectForms(bytes)` which `PDFDocument.load`s the entire document. For a 50-field form, every keystroke validation IPC re-parses the PDF. On a 10-MB PDF that's ~50-100ms per keystroke = perceptible lag. Mitigation: the renderer already has `formsSlice.fields` cached from the initial detect — `forms:fill` should validate against the request payload's known field schema, or the handler should accept an optional `cachedFields` array and skip the detect call when supplied.
- **File-picker drag-drop (L-001):** verified no Phase 3 component overrides the `enableDragDropFiles` invariant. No new BrowserWindow construction in any Phase 3 source. `print-window.test.ts` and `window-manager.test.ts` still cover the lock.
- **No `dangerouslySetInnerHTML` / `innerHTML`** anywhere in `src/client`. CSV cell values + template names render as text children — no XSS surface.
- **N-3.3 (large modal):** `mail-merge-modal/index.tsx` is 646 LOC. The wizard naturally has 4 step sub-components + parent shell; modularization would split per-step into separate files (`step1-template.tsx`, `step2-data.tsx`, etc.). Phase 3.1 cleanup.

### H. MailMergeJob.flattenForms gap (Riley's flag)

**Severity: HIGH.** See top-3 issue #3. Riley flagged this in the Wave 12 status row as a known LOW gap; my audit upgrades it to HIGH because:

1. The user-facing behavior (a visible checkbox in the wizard that has zero effect) is observably broken UX.
2. The fix touches the wire contract (`MailMergeJob` shape), the runner's `fillForm` call path (needs a flatten branch), and the mail-merge-modal's `job:` construction. Non-trivial; should land in Wave 13.5, not silently deferred.
3. The brief invited me to rate it; my reading of the codebase confirms Riley's diagnosis exactly — the void-discard at `mail-merge-modal/index.tsx:172` is real and the runner's interface has no entry point for the flag.

### I. TypeScript strictness

- **`any` count in Phase 3 source: 1** (`forms-slice.test.ts:63` — test-file cast; acceptable).
- **File lengths:**
  - `form-engine.ts` 986 LOC — over 200 LOC threshold. Single-responsibility but many sections. **M-3.7** modularization candidate (split detect / fill / flatten / create / remove / edit into separate files; the internal replay helpers stay together as `form-engine-replay-helpers.ts`).
  - `replay-engine.ts` 927 LOC — over threshold. Phase 3 added the step 3.6 form-ops block. Modularization here is harder because the fold is one tight pure function. Mention only.
  - `mail-merge-runner.ts` 432 LOC — over threshold. Could extract `concatPdfs`, `renderFilename`, `sanitizeFilename`, `coerceCellToFieldValue`, `normalizeDate` into a helpers file. Worth doing in Phase 3.1.
  - `csv-excel-parser.ts` 257 LOC — borderline, fine.
  - `field-dict-authoring.ts` 209 LOC — borderline, fine.
  - `form-templates-repo.ts` 306 LOC — over threshold but well-organized (interface, factory, validators). Mention only.
  - `mail-merge-modal/index.tsx` 646 LOC — strong modularization candidate (N-3.3 above).
- **Test coverage:** every Phase 3 handler has a `.test.ts` sibling (`forms-detect`, `-fill`, `-flatten`, `-design-add`, `-design-remove`, `-parse-data-source`, `-run-mail-merge`, `-templates`). Plus engine tests (`form-engine.test.ts`, `field-dict-authoring.test.ts`, `mail-merge-runner.test.ts`, `csv-excel-parser.test.ts`). Renderer slices have unit tests. Good. **Gap (M-3.8):** no integration test that exercises register.ts's actual `sanitizePath` wiring against the mail-merge runner — that's how B-3.1 slipped through. Add a smoke test that constructs the runner with the production `sanitizePath` import (not a stub) and asserts folder-mode succeeds.

### J. L-001 + H-3 hold

- **L-001:** verified `enableDragDropFiles !== false` preserved. No new `BrowserWindow` construction in any Phase 3 source. `src/main/window-manager.ts:49` (existing) and `src/main/print-window.ts:99` (existing) remain the only construction sites. Both still flagged by Diego's tests.
- **H-3 (renderer gatekeeper):** ESLint pattern at `.eslintrc.cjs:177` still blocks `**/src/ipc/contracts*` from renderer files. Verified by grep — only the gatekeeper imports from `src/ipc/contracts`.

## What's good

- **Pure-function engine boundary** held throughout: `form-engine.ts`, `field-dict-authoring.ts`, `csv-excel-parser.ts`, `mail-merge-runner.ts` are pure over their inputs + injected deps. No FS / DB / console.log leaks. Conforms to conventions §13.2 + §14.5.
- **Discriminated-union returns** at every IPC boundary. `UpsertFormTemplateResult` (repo) → `SaveFormTemplateResult` (bridge) → `FormsSaveTemplateError` (wire) chain is exemplary: each layer narrows or widens explicitly, no ad-hoc string matching, no try/catch on constraint messages. Wave 8.5 H-1 lesson fully internalized.
- **HYBRID commit boundary** (section E) is the highest-risk Phase 3 integration risk and Riley's middleware + slices nailed it. The trigger-action pattern + middleware-side diff is reusable for any future "batch transient state into one undoable op" use case.
- **CSV tokenizer** is genuinely well-implemented for an in-house RFC 4180 parser. Edge cases (lone CR, CRLF, escaped quotes, trailing newline) all handled in one tight state machine. **M-3.5 (UTF-16) is the only meaningful gap.**
- **Field-dict authoring** for signature placeholder is correct ISO-32000 §12.7.4 — `/FT /Sig` field-dict + `/Type /Annot /Subtype /Widget` widget + bilateral wiring to `/AcroForm /Fields` and the page's `/Annots`. Defensive against `/AcroForm` not yet existing.
- **Test isolation:** Phase 3 tests inject deps cleanly. The `_resetMailMergeJobRegistryForTests` export pattern is the right approach for the process-wide registry.
- **L-001 invariant** untouched across 41 new files.

## Follow-ups (non-blocking for Phase 3 ship if BLOCKER + 4 HIGHs land in 13.5)

- **M-3.1** Form-design ordering re-shuffle at save time (replay-engine.ts:292-325): replace the 5-phase pass with insertion-order interleaving in Phase 3.1.
- **M-3.2** Document form-flatten-then-design-add UX behavior in user-guide or surface as a warning.
- **M-3.3** Reconcile mail-merge per-row error handling between code (fail-fast) and doc-comment (continues). Update one.
- **M-3.4** Concat-mode memory ceiling: stream the concat instead of accumulating `Uint8Array[]`.
- **M-3.5** CSV UTF-16 BOM detection + decoder switch.
- **M-3.6** `forms:fill` / `forms:designAdd` / `forms:designRemove` / `forms:flatten` should not re-parse the whole PDF on every call — cache schema or accept `cachedFields` in the request.
- **M-3.7** Modularize `form-engine.ts` (986 LOC) — split into per-operation files.
- **M-3.8** Add an integration test that wires the production `sanitizePath` into the mail-merge runner (would have caught B-3.1).
- **L-3.1** Widen encrypted-PDF discrimination across all forms:\* handlers.
- **L-3.2** Mail-merge cancel toast: surface partial-output semantics in folder mode.
- **L-3.3** (Verified safe — `setTimeout(0)` is the right choice; no action.)
- **L-3.4** CSV header-dedupe warning string improvement.
- **L-3.5** Form-templates repo: surface JSON-parse degradation as a warning instead of silent empty array.
- **L-3.6** Move `form-commit-middleware` operationId from `Date.now()+Math.random()` to `crypto.randomUUID()` for consistency.
- **N-3.1** Ragged-row CSV behavior: document or normalize.
- **N-3.2** (Verified clean — gatekeeper coverage complete.)
- **N-3.3** Modularize `mail-merge-modal/index.tsx` (646 LOC) into per-step files.

## Wave 14 dispatch verdict

**RED — block Wave 14 (Nathan / documentation-expert) until B-3.1 lands.**

Rationale: Nathan's job is to write user-facing documentation for Phase 3. The user-guide will inevitably include "How to run a mail merge" with folder-mode as the default example (it's the wizard's default). Documenting a workflow that returns `output_path_invalid` on every invocation would burn user trust and require an immediate retraction. The fix for B-3.1 is a 2-line change in `register.ts` plus a sanitizePath options pass-through — Wave 13.5 fixup should be ~30 minutes of David's time. H-3.1 (JS-action strip leak) and H-3.2 (MailMergeJob.flattenForms) should also land in 13.5 so Nathan's docs match shipping behavior; they touch contracts + handler code which is too invasive to leave for a 13.5.1.

After 13.5 closes B-3.1 + the 4 HIGHs (H-3.1 JS strip leak, H-3.2 flattenForms wire amendment, H-3.3 atomic-write-per-row, plus H-3.2 already counted), my Phase 3 verdict will flip GREEN and Wave 14 unblocks.

## Self-correction notes

- Re-verified Riley's flag on `MailMergeJob.flattenForms` exactly as she stated. My audit confirms the diagnosis word-for-word at `mail-merge-modal/index.tsx:172` (`void flatten;`) and `contracts.ts:1113-1121` (`MailMergeJob` shape lacks the field). Severity upgraded to HIGH per the rationale above.
- Per the Wave 10 self-improvement note: "when writing audit text that cites specific file:line, use verbatim source or mark paraphrase." All file:line citations in this section are verbatim from the source as read 2026-05-22.

---

# Wave 13.5 Re-audit — Julian

**Reviewer:** Julian
**Date:** 2026-05-22
**Scope:** Closure verification of Wave 13 Phase 3 B-3.1 + 3 distinct HIGH findings (H-3.4 retracted as a double-count of H-3.2 per David's Wave 13.5 status row — confirmed below)
**Files verified (read end-to-end or grepped + spot-read):** `src/main/security/path-sanitizer.ts`, `src/main/security/path-sanitizer.test.ts`, `src/main/pdf-ops/mail-merge-runner.ts`, `src/main/pdf-ops/mail-merge-runner.test.ts`, `src/main/pdf-ops/form-engine.ts`, `src/main/pdf-ops/form-engine.test.ts`, `src/main/pdf-ops/replay-engine.ts` (strip-call site), `src/ipc/handlers/forms-run-mail-merge.ts`, `src/ipc/handlers/forms-run-mail-merge.test.ts`, `src/ipc/register.ts`, `src/ipc/contracts.ts`, `docs/api-contracts.md §13.9`, `src/client/components/modals/mail-merge-modal/index.tsx`, `src/client/components/modals/mail-merge-modal/mail-merge-modal.test.tsx`.

## Verdict

**GREEN** — Wave 14 (Nathan / documentation-expert) UNBLOCKED. All three distinct Phase 3 HIGH findings + the BLOCKER are remediated end-to-end at the wire, the runner, the engine, the renderer, AND test surfaces. One narrow residual partial-closure noted on H-3.1 (replay-engine path) is downgraded to MEDIUM and absorbed into the Phase 3.1 / Phase 4 backlog — it does not change the Wave 14 ship verdict because the production attack surface (mail-merge per-row outputs) is fully closed.

## Closure status

| Finding                           | Pre-13.5               | Status now                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-3.1 mail-merge folder sanitizer | BLOCKER                | **CLOSED**                                                                                           | `sanitizeDirectoryPath` correctly delegates to `sanitizePathDetailed` with `allowedExtensions: new Set(['', '.pdf'])` so all hardening checks (traversal, UNC, percent-encoded, suspicious Unicode, reserved DOS, control chars) still apply. `mail-merge-runner.ts:178-186` routes folder-mode through `deps.sanitizeDirectoryPath` with `sanitizePath` fallback. `register.ts:532-533` injects both production sanitizers. 21 new tests pin the wire (12 sanitizer + 7 runner + 2 handler) using the REAL production sanitizers, no permissive stubs. Production folder-mode mail-merge now works; the structural-CI-blindspot is sealed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| H-3.1 JS-strip completeness       | HIGH                   | **CLOSED for production surface, MEDIUM residual (M-13.5-1) for replay-engine annotation-only path** | `fillForm` strips at `form-engine.ts:478` before serialize. `flattenForms` strips at `form-engine.ts:602`. Mail-merge runner inherits via `fillForm`. Phase 3 P3-L-2 (conventions §14.6) is satisfied for the surface that motivated the finding (mail-merge outputs). **Residual:** `replay-engine.ts:343` strip is still gated inside `if (formOps.length > 0)` — so a non-form save (annotation-only, image-overlay-only, text-replace-only, reorder/rotate/delete-only) on a JS-laden source PDF still emits JS in the saved bytes. This is the original H-3.1 (b) sub-point; David explicitly noted he relied on the strip's idempotency for the form path (correct) but didn't move it outside the conditional for the non-form save path. Severity downgraded to MEDIUM because (a) the JS-laden source PDF arrival path requires an attacker-supplied template OR a user-imported document already carrying JS, which is a narrow corner of the Phase 3 risk model; (b) Phase 3 P3-L-2 motivation was specifically the form-fill / mail-merge output stream which IS now closed; (c) the fix is a 2-line move of the strip call out of the `formOps.length > 0` block in replay-engine.ts. Track as M-13.5-1; absorb into Phase 4 or next as-touched. |
| H-3.2 MailMergeJob.flattenForms   | HIGH                   | **CLOSED**                                                                                           | `contracts.ts:1129` adds `flattenForms?: boolean`; api-contracts.md §13.9 carries the Phase 3.1 amendment banner (lines 1108-1132). Main side: `fillForm` gains `flatten?: boolean` option (`form-engine.ts:404, 463-471`); mail-merge runner threads `job.flattenForms === true` into per-row `fillForm` call (`mail-merge-runner.ts:219-221`). Renderer side: Riley's modal patch landed at `mail-merge-modal/index.tsx:167` (`flattenForms: flatten` inside the `job:` literal). Riley also added a real regression test at `mail-merge-modal.test.tsx:301-356` asserting the IPC call carries `flattenForms` in both `true` and `false` permutations. End-to-end closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| H-3.3 atomic per-row write        | HIGH                   | **CLOSED**                                                                                           | `register.ts:513-527` wraps `writeFile` injection in temp+rename pattern (`${p}.tmp` → `rename(tmp, p)`) with best-effort tmp cleanup on rename failure and original error re-thrown. Rename is atomic on same-volume NTFS/APFS/ext4; cross-volume falls back to copy-then-delete which is still file-level atomic. Inline comment in register.ts (lines 506-512) documents the contract for future reviewers. No process-kill test (would require sub-process harness — David correctly scoped this out of 13.5); the production-sanitizer integration tests do exercise the writeFile call path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| H-3.4 (4th HIGH count)            | "HIGH" in verdict line | **RETRACTED**                                                                                        | Confirmed double-count of H-3.2 as David flagged in his Wave 13.5 status row. My Wave 13 review listed H-3.1, H-3.2, H-3.3 as the distinct HIGHs; "section H" (line 884-889) was a standalone callout of the same `flattenForms` gap that top-3 issue #3 already enumerated. **Correct Wave 13 count: 1 BLOCKER + 3 HIGH.** Sticking by David's diagnosis. Per-area scorecard in Wave 13 was correct; the verdict-line summary was the off-by-one. Self-correction logged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## New findings (this re-audit)

- **M-13.5-1** (Medium, residual from H-3.1) — `replay-engine.ts:343` strip call still gated inside `if (formOps.length > 0)`. Non-form saves on a JS-laden source PDF emit JS in saved bytes. Fix: move the `stripDocLevelJavaScript(doc)` call to a step between `Step 3.5: defer-render overlays` and `Step 4: emit annotations` so EVERY save path strips. 2 lines. Phase 4 absorb-as-touched.
- **N-13.5-1** (Nit, observation) — Chromium `printToPDF` path in `print-window.ts:193` is a fresh-render engine that produces a new PDF from the rendered page; the source document's `/Names /JavaScript` does not survive the render. Implicitly clean for this audit — no defect; documenting so the next reviewer doesn't re-derive.
- **N-13.5-2** (Nit, suggestion) — David's `Permissive-stub audit pattern` follow-up in his status row is exactly the right meta-lesson. Promote to a Diego CI lint candidate (regex flag for `sanitizePath: () => raw` / `sanitizePath: (raw) => raw` patterns in `*.test.ts`). Tracking as Phase 4 candidate.

No new BLOCKER, no new HIGH.

## Test-stub regression-pin discipline

**STRONG.** David's approach to the B-3.1 test-stub root cause is genuinely defensive:

1. **New tests use REAL production sanitizers, not stubs.** `mail-merge-runner.test.ts:183-341` (the "Phase 3.1 (B-3.1, David, Wave 13.5) — production-sanitizer integration tests" block) injects `sanitizePath: (raw) => sanitizePath(raw)` and `sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw)` — the actual production imports — across 7 cases covering legit-folder-accept, traversal-reject, UNC-reject, reserved-DOS-reject, concat-.pdf-accept, concat-non-.pdf-reject, concat-directory-reject. The reverse-direction case (concat-mode rejects a directory path) is a particularly nice belt-and-braces ratchet against a future fix that accidentally widens the file sanitizer.
2. **Handler tests mirror the pattern.** `forms-run-mail-merge.test.ts:127-196` (the "Phase 3.1 (B-3.1, David, Wave 13.5) — production-sanitizer integration test" block) does the same at the handler boundary — 2 cases covering folder-mode success + traversal reject.
3. **The pre-existing permissive `(raw) => raw` stubs at lines 356-653 of `mail-merge-runner.test.ts` remain** — but they're testing flatten / cancel / progress / concat-bytes behaviors that don't intersect with the sanitizer contract. Acceptable because the production-sanitizer tests above provide the regression-pin coverage; the old tests are testing what they were always testing (orthogonal behaviors), not pretending to test sanitizer compliance.
4. **Permissive-stub anti-pattern is now structurally pinned**: any future regression that drops `sanitizeDirectoryPath` from the runner's `MailMergeRunDeps` or the handler's wiring will fail the B-3.1 production-sanitizer test cases. CI is no longer 100% green while production is 100% broken — that specific class of failure is sealed for THIS surface.

The meta-lesson (CI lint for permissive sanitizer stubs across the codebase, not just mail-merge) is a strong Phase 4 candidate — see N-13.5-2 above. Worth raising to Diego in the Wave 14 brief as a future ratchet alongside the existing ESLint no-restricted-imports gatekeeper.

## Wave 14 dispatch verdict

**GREEN — Wave 14 (Nathan / documentation-expert) UNBLOCKED.**

- B-3.1 closed end-to-end. Folder-mode mail-merge documentation can be written truthfully.
- H-3.1 closed for the production attack surface (mail-merge per-row outputs strip JS); residual M-13.5-1 (replay-engine annotation-only path) is narrow enough that Nathan's user-guide doesn't need to caveat it.
- H-3.2 closed end-to-end including renderer + IPC + main + contract + docs. The "flatten in output" checkbox now works. Nathan can document it as a feature.
- H-3.3 closed. The atomic-write pattern is documented in the register.ts inline comment; user-facing docs don't need to mention it (it's an implementation property).
- L-001 invariant + H-3 retirement invariant untouched (per David's verification: 2/2 + 3/3).
- 402/402 main+ipc tests pass per David's verification.

**Wave 14 brief should reference:**

- M-13.5-1 (replay-engine.ts strip-call move) as a Phase 4 backlog item for Marcus's tracker.
- N-13.5-2 (permissive-stub CI lint) as a Diego Phase 4 ratchet candidate.
- Confirm that Riley's modal regression test (`mail-merge-modal.test.tsx:301-356`) is part of the renderer test set Diego's CI runs; if not, Wave 14 should add it.

## Per-area scorecard (Wave 13.5 deltas only)

| Area                         | Critical | High  | Medium              | Low       | Nit                    |
| ---------------------------- | -------- | ----- | ------------------- | --------- | ---------------------- |
| Wave 13 residual (post-13.5) | 0        | 0     | 1 (M-13.5-1)        | 0         | 2 (N-13.5-1, N-13.5-2) |
| Wave 13.5 new                | 0        | 0     | 0                   | 0         | 0                      |
| **Net Phase 3 open**         | **0**    | **0** | **+1 over Wave 13** | unchanged | **+2**                 |

The Wave 13 MEDIUM / LOW / NIT items (M-3.1 through M-3.8, L-3.1 through L-3.6, N-3.1 through N-3.3) remain open as documented; the 13.5 wave was specifically scoped to the BLOCKER + HIGHs.

## Self-correction notes

- **My Wave 13 verdict-line said "4 HIGH" but my body enumerated only 3 distinct findings.** David's status row caught the double-count of H-3.2 (section H restatement vs top-3 issue #3); I confirm the retraction. Future audits: cross-check the verdict-line count against the body enumeration before publishing; a single discrepancy of this kind costs a downstream agent 15 minutes of re-derivation. Logged as a self-improvement entry in `.learnings/learnings.jsonl`.
- **H-3.1 was a compound finding** (mail-merge fillForm path + replay-engine annotation path). David closed the mail-merge half cleanly but the replay-engine half remains narrowly open. I should have split it into H-3.1a (mail-merge) and H-3.1b (replay-engine) in the Wave 13 review so the closure tracking would be unambiguous. Recording as a self-improvement entry.
- All file:line citations in this re-audit section are verbatim from the source as read 2026-05-22 (post-David Wave 13.5 patches).

---

# Wave 17 Phase 4 Code Review — Julian

**Reviewer:** Julian (Director of Code Quality & Security Audit)
**Date:** 2026-05-26
**Scope:** Wave 16 Phase 4 implementation — David's 27 new + 6 edited main/IPC files (signature engine, cert-store, TSA client, PAdES engines, 10 IPC handlers, replay-engine M-13.5-1 absorption), Ravi's 3 new + 2 edited db files (migration 0004 + signature-audit-repo + types), Riley's 36 new + 5 edited renderer files (capture modal, PAdES sign modal, 7 shape tools, audit panel, 3 slices, thunks-phase4). ~67 new src files + ~220 new tests.
**Source baseline:** Read 2026-05-26 post-Wave-16. All file:line citations are verbatim against the source as read.
**Numbering note:** Findings continue from Wave 13.5 numbering; Phase 4 uses the suffix `-17.N` (`B-17.1` etc.) to avoid collision with Wave 13's `*-3.N` scheme.

## Summary verdict

**YELLOW — Wave 18 (Nathan Phase 4 docs refresh) UNBLOCKED, but ship Wave 18 with explicit Phase 4.1 follow-ups for David.**

The cert + password lifecycle discipline (Phase 4's #1 risk per P4-L-1) is **CLEAN end-to-end on the renderer + cert-store + IPC-cert-load surface**. The Wave 17 mechanical greps in `conventions.md §15.5` PASS for every grep that targets the cert-load code path. M-13.5-1 is closed at the source with 3 regression tests. Permissive-stub anti-pattern did NOT recur in any of David's Phase 4 cert-store / engine tests — `cert-store.test.ts` and `signature-engine.test.ts` exercise the REAL production loadCert with a synthetic-parser injection, with buffer-zeroing asserted across all 5 failure paths.

The YELLOW comes from ONE BLOCKER-class structural seam (`B-17.1`) that prevents the PAdES sign path from working end-to-end even after Wave 17 packaging installs node-signpdf — the IPC contract does NOT carry PFX bytes through to the engine, but `pades-signature.ts` requires them to call `signpdf.sign()`. This is design-vs-implementation drift between Riley's Wave 15 spec (engine consumes `certEntry: ParsedCertEntry`, signature-engine.md §2.2:113-123) and David's Wave 16 implementation (engine requires `certPfxBytes: Buffer | null` per `pades-signature.ts:42-50`). Wave 16's PAdES path returns `engine_not_available` today (deps not installed) so the gap is masked; Wave 17 unmasks it and triggers `cert_handle_not_found` on every PAdES sign attempt.

The other Wave 18 follow-ups are tractable: zod adoption is inconsistent (only 4 of 10 Phase 4 handlers use zod at the IPC boundary — `H-17.2`), PAdES replay-on-edit-after-sign abort logic differs from spec (`H-17.3`), one dead-code thunk in `thunks-phase4.ts` (`L-17.1`), and a few NIT-level polish items.

## Top-3 issues blocking Phase 4 ship

1. **`B-17.1` (BLOCKER) — PAdES sign path structurally broken end-to-end.** The cert-handle pattern stores parsed `privateKey` but zeroes raw PFX bytes (`cert-store.ts:260-261`); `pades-signature.ts:76-87` requires `certPfxBytes: Buffer` to call `signpdf.sign(buffered, pfxBytes, ...)` (line 138); the IPC request type `SignaturesApplyPadesRequest` carries `certHandle` only (no PFX bytes); the orchestrator at `signature-engine.ts:223-224` passes `input.certPfxBytes ?? null` which is ALWAYS `null` from the IPC path. Result: every PAdES sign attempt via IPC will return `cert_handle_not_found` after Diego ships node-signpdf in Wave 17. Three remediation paths (see B-17.1 below); David picks before Wave 18 ship.

2. **`H-17.1` (HIGH) — `passphrase: input.certPassword.toString('utf-8')` re-introduces JS-string password.** `pades-signature.ts:138-140` calls `signpdf.sign(buffered, input.certPfxBytes, { passphrase: input.certPassword.toString('utf-8') })`. The convention §15.1 Rule 3 + §15.6 explicitly identifies this as the R-W15-A residual window (1-2 second V8 heap lingering). NOT a discipline violation (conventions §15.6 acknowledges this is the security floor) but the call site needs an inline `// R-W15-A residual` comment so a future maintainer doesn't "improve" it by capturing the password in a longer-lived closure. Pairs with B-17.1 — if B-17.1 remediation switches to manual engine, this issue goes away.

3. **`H-17.2` (HIGH) — Inconsistent IPC boundary validation; 6 of 10 Phase 4 handlers skip zod.** `signatures-cert-load.ts`, `signatures-cert-release.ts`, `annotations-add-shape.ts`, `annotations-measure-calibration.ts` use zod `safeParse`. `signatures-apply-visual.ts`, `signatures-apply-pades.ts`, `signatures-request-timestamp.ts`, `signatures-verify.ts`, `signatures-list-audit.ts`, plus pre-Phase-4 handlers use ad-hoc `typeof` checks that DON'T catch out-of-range numbers, malformed nested structures, or unknown discriminator variants. Renderer IS trusted under contextIsolation but the IPC boundary is still the right validation gate per conventions §13. Fix is mechanical — add a `requestSchema = z.object({...})` per handler and route through `safeParse`.

## Cert-lifecycle verdict

**CLEAN on the cert-load / cert-release / cert-store surface. CLEAN on the renderer modal discipline. PARTIALLY OPEN on the sign-time consumption (B-17.1).**

| Audit grep (conventions §15.5)                                                                                               | Result | Notes                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) Every `password` mention in cert-store.ts is ≤5 lines from input to Buffer wrap                                          | PASS   | 17 mentions, all in (a) comments / JSDoc, (b) function-name `passwordBuffer`, (c) type-name `PasswordBuf`, (d) the documented buffer-wrap path. The single consuming flow at `cert-store.ts:184-190` wraps via `activeParser({ pfxBytes, passwordBuffer })` — zero JS-string intermediate.                                                                                                              |
| (2) No log statement in cert-store.ts / signatures-cert-_.ts / pades-_.ts / signature-\*.ts contains password/pfx/privateKey | PASS   | ZERO `log.(info\|debug\|warn\|error)` and ZERO `console.(log\|info\|debug\|warn\|error)` in any of the 8 security-sensitive Phase 4 files.                                                                                                                                                                                                                                                              |
| (3) Every `Buffer.from(password)` is followed by `fill(0)` in finally                                                        | PASS   | `cert-store.ts:257-262` finally block zeroes both `pfxBytes.fill(0)` and `passwordBuffer.fill(0)`; runs on success + every failure path including parser_not_installed, wrong_password, pfx_decode_failed, pfx_no_private_key, pfx_no_cert. Verified by 5 distinct tests in `cert-store.test.ts:131-217`.                                                                                               |
| (4) No `writeFile` / `writeFileSync` / `createWriteStream` in cert-store.ts / pades-_.ts / signature-_.ts / signatures-\*.ts | PASS   | ZERO matches.                                                                                                                                                                                                                                                                                                                                                                                           |
| (5) `app.on('before-quit')` releases all certs                                                                               | PASS   | Registered in `src/ipc/register.ts:577-583` — calls `releaseAllCerts()` inside the IPC registrar's bootstrap. Minor concern: register location is unusual (most lifecycle wiring is in `src/main/index.ts`); see `N-17.1` below.                                                                                                                                                                        |
| (6) Tests use REAL `loadCert` with REAL PFX bytes + assert REAL zeroing (no stubbed cert-store)                              | PASS   | `cert-store.test.ts:131-217` (5 failure-path tests) and `cert-store.test.ts:76-129` (4 happy-path tests) all use `loadCert(Buffer.from(...), Buffer.from(KNOWN_PASSWORD))` with `setPfxParser` injection. The synthetic parser exercises the SAME finally-block discipline as the production node-forge parser will exercise post-Wave-17. ZERO permissive cert-store stubs in the codebase.            |
| (7) No `settings.` or `electronStore.` write of cert data                                                                    | PASS   | ZERO matches.                                                                                                                                                                                                                                                                                                                                                                                           |
| (8) IPC `return ok(...)` for certLoad does NOT include password or pfxBytes                                                  | PASS   | `signatures-cert-load.ts:59` returns `ok(result.value)` where `result.value` is `CertLoadOk = { handle, subjectCN, issuerCN, notBefore, notAfter, fingerprint, isExpired }` — verified by reading the cert-store.ts:51-59 export type. The handler test at `signatures-cert-load.test.ts:80-91` asserts `JSON.stringify(r.value)` does NOT contain the sentinel `'TEST-PWD-DO-NOT-LOG-2026'` substring. |

Renderer-side (conventions §15.1 rule 2):

- `signatures-slice.ts:81` documents in-code: "Cert metadata (NOT password, NOT cert bytes — see conventions §15.1)". Grep confirms ZERO `password:` field anywhere in `src/client/state/slices/` (only mentions are in JSDoc/comments and the thunk arg type, which is documented as for-non-modal-flows-only).
- `cert-loader-step.tsx:73-74` snapshots password to a local const then immediately `setPassword('')` BEFORE the await at line 82. Discipline verified.
- `pades-sign-modal.test.tsx:179` asserts `passwordAfter.value === ''` post-dispatch. **This is the load-bearing P4-L-1 regression test.** Verified inline.
- No `setInterval` / `setTimeout` anywhere in `src/client/components/modals/pades-sign-modal/`. Closure-leak path ZERO.
- ZERO `JSON.stringify(password|pfx)` patterns codebase-wide.

The cert-lifecycle is honestly the strongest discipline I've audited in this project. Wave 13.5's permissive-stub root cause did NOT recur in any Phase 4 security-sensitive test.

## Single-funnel verdict

| Funnel                                                                       | Status | Evidence                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cert-store.ts` is the ONLY module touching PFX bytes / password strings     | CLEAN  | grep confirms only `cert-store.ts:184-190` reads `pfxBytes` / `passwordBuffer`; the only other reads are `pades-signature.ts:138-140` (B-17.1 — see below) and the test fixtures. PFX bytes never appear in renderer, contracts, repos, or audit log.                                                  |
| `pades-signature.ts:computeByteRange` is the ONLY byte-range arithmetic      | CLEAN  | The pure helper at `pades-signature.ts:193-201` is exported once. `pades-signature-manual.ts:94` references it via `void computeByteRange;` (staged for Wave 17 enablement). No other module re-implements the `[0, a, b, totalLen-b]` math.                                                           |
| `replay-engine.ts` is the ONLY document-mutation funnel                      | CLEAN  | Phase 4 added §3.7 (signature ops) and §3.8 (shape annotations) at `replay-engine.ts:387-460`. Both delegate to single-purpose modules (`visual-signature.ts`, `shape-annotations.ts`). No bypass paths. The M-13.5-1 fix at `replay-engine.ts:381-385` is OUTSIDE the formOps conditional — verified. |
| `signatures-slice.ts` is the ONLY renderer source of truth for sign workflow | CLEAN  | grep confirms `state.signatures` is the only sign-state slice. The placement overlay reads from `state.signatures.placement`; the audit panel reads from `state.signatureAudit` (separate concern — audit list, not workflow). No competing sign-state fields elsewhere.                               |
| `build-shape-annotation.ts` is the ONLY shape→EditOperation funnel           | CLEAN  | The single `buildShapeAnnotationFromDraft` + `buildShapeForTool` exports at `build-shape-annotation.ts:40-202`. ShapesSlice + addShapeAnnotationThunk route through this builder; no other module constructs `ShapeAnnotationModel` literals.                                                          |

## M-13.5-1 closure status

**CLOSED end-to-end.** `replay-engine.ts:381-385` calls `stripDocLevelJavaScript(doc)` UNCONDITIONALLY (outside any `if (formOps.length > 0)` guard — confirmed by reading lines 340-385). Three regression tests at `replay-engine-strip-js.test.ts:60-121` pin the fix:

1. `'saves WITHOUT form ops (annotation-only intent) — JS is still stripped'` — empty ops list + JS-laden source → output has NO /Names→/JavaScript entry.
2. `'saves with image-only ops — JS is still stripped'` — same with image-only ops.
3. `'strip is idempotent — re-saving JS-free bytes does not warn'` — second pass on cleaned bytes produces no warning.

The Wave 13.5 H-3.1 production attack surface (mail-merge per-row outputs) remains closed via `form-engine.ts:fillForm` + `flattenForms` paths. The Phase 4 absorption is complete.

## Permissive-stub anti-pattern recurrence count

**ZERO new recurrences in Phase 4 security-sensitive code.** The Wave 8.5 B-1/B-2 + Wave 13.5 B-3.1 pattern (test fixtures that stub production-critical injected deps with no-op functions, making CI 100% green while production is 100% broken) did NOT bite a third time in cert-store / signature-engine / audit-log tests.

The pre-existing `(raw) => raw` sanitizer stubs in older Phase 1/2/3 test files (~12 sites in `dialog-open-pdf.test.ts`, `fs-read-pdf.test.ts`, `mail-merge-runner.test.ts:113-528`, `pdf-apply-edit-ops.test.ts`, `h3-retirement.test.ts`) remain, but they are now FLANKED by real-sanitizer integration tests added in Wave 13.5 (`mail-merge-runner.test.ts:193-330`, `forms-run-mail-merge.test.ts:154-188`). New Phase 4 tests don't take sanitizers as a dep because the Phase 4 surface doesn't write to filesystem paths — the audit log is the only persistence, and it goes through Ravi's repo with parameter binding. So the anti-pattern has no foothold to recur on the Phase 4 surface; the pre-existing instances remain as documented (Wave 13.5 §"Permissive-stub anti-pattern is now structurally pinned").

**Recommendation:** the Diego CI lint candidate I flagged in Wave 13.5 (N-13.5-2 — regex for `sanitizePath:()=>raw|writeFile:()=>undefined|getBytes:()=>fakeBytes` patterns) is still the right Phase 4.1 ratchet. Three waves of post-mortem on the same root cause is enough; the next regression should be caught by a lint, not by a reviewer.

---

## Findings

### B-17.1 (BLOCKER) — PAdES sign path structurally broken end-to-end

**Severity:** BLOCKER for Phase 4 PAdES sign feature ship. Visual signatures + cert-load + audit-log work fine independently.

**Summary:** The cert-handle pattern in `cert-store.ts` zeroes raw PFX bytes in its `finally` block (correct per conventions §15.1 rule 4), but `pades-signature.ts` requires those same PFX bytes to call `signpdf.sign(buffer, pfxBytes, { passphrase })`. The IPC request type `SignaturesApplyPadesRequest` (contracts.ts:1522-1535) carries `certHandle: string` only — there is no path for PFX bytes to reach the engine. The orchestrator at `signature-engine.ts:223-224` passes `input.certPfxBytes ?? null` which is ALWAYS `null` from the IPC entry point. After Diego installs node-signpdf in Wave 17, every production PAdES sign attempt will return `cert_handle_not_found` at `pades-signature.ts:83-87`.

**Files / lines:**

- Design (Riley Wave 15): `docs/signature-engine.md:113-123` specifies `ApplyPadesInput { bytes, placement, certEntry: ParsedCertEntry, tsaUrl, ... }` — engine consumes `certEntry` directly. No `certPfxBytes` field.
- Cert-store retention (David Wave 16): `cert-store.ts:70-90` ParsedCertEntry has `privateKey`, `privateKeyPem`, `certDer`, fingerprint, subject/issuer, validity. **No `pfxBytes` field.**
- Cert-store zeroes raw inputs: `cert-store.ts:257-262` finally block zeroes `pfxBytes.fill(0)` + `passwordBuffer.fill(0)`.
- PAdES engine implementation: `pades-signature.ts:42-45` declares `certPfxBytes: Buffer | null` + `certPassword: Buffer | null` as REQUIRED for sign.
- PAdES engine early return: `pades-signature.ts:76-87` returns `cert_handle_not_found` if `!input.certPfxBytes || !input.certPassword`.
- node-signpdf API requirement: `pades-signature.ts:138-140` calls `signpdf.sign(buffered, input.certPfxBytes, { passphrase: input.certPassword.toString('utf-8') })` — node-signpdf's documented API requires the P12 byte buffer.
- Same gap in manual engine: `pades-signature-manual.ts:45-50` same early-return.
- IPC contract (David Wave 16): `contracts.ts:1522-1535` `SignaturesApplyPadesRequest` has only `certHandle: string` — no PFX bytes.
- IPC handler: `signatures-apply-pades.ts:52-66` forwards `req` fields verbatim; no PFX-byte field is populated.
- Orchestrator: `signature-engine.ts:223-224` passes `input.certPfxBytes ?? null` — always null from IPC.

**Why it's a BLOCKER:** Phase 4's headline feature is "Apply PAdES signature to a document." Wave 16 ships the SHAPE end-to-end and returns `engine_not_available` because deps are missing (which is correct + honest). Wave 17 fixes the missing deps. AFTER Wave 17 the structural seam is unmasked — the first user to click "Sign" gets `cert_handle_not_found` on a cert handle they JUST loaded. The user experience is incoherent. This is exactly the "memory bridge IS the test bridge AND the silent production fallback" pattern from Wave 2 H-1 / Wave 13 B-3.1, in a new shape: the engine's test path (signature-engine.test.ts:133-135 passes `certPfxBytes: Buffer.from('pfx-for-signpdf'), certPassword: Buffer.from(KNOWN_PASSWORD)` synthetic bytes that wouldn't actually sign) diverges from the production IPC path (no bytes available).

**Remediation options for Wave 18 / Phase 4.1:**

1. **Retain PFX bytes in `ParsedCertEntry` (smallest change).** Add `pfxBytes: Buffer; passwordBuffer: Buffer;` fields to `ParsedCertEntry`, store the original bytes alongside the parsed key, zero them in `releaseHandle` instead of in `loadCert`. Trade-off: deviates from convention §15.1 rule 4's "ANY buffer wrapping a password OR a PFX byte payload MUST be zeroed via `.fill(0)` in a `finally` block of the function that consumes it" — but if "consumes" is reinterpreted as "consumes the load AND the sign together," the same buffer can live across the two calls. The release path's existing `entry.certDer.fill(0)` at `cert-store.ts:283` is the precedent. Cost: ~30 LOC in cert-store + a convention §15 amendment ratified by Marcus. Recommended if PAdES ship is in scope for the next sprint.

2. **Switch primary engine to manual fallback.** `pades-signature-manual.ts` uses the parsed `privateKey` object directly (forge.pki.PrivateKey from cert-store entry) and doesn't need PFX bytes. The cost is the manual engine body (forge.pkcs7.SignedData + ASN.1 building) is staged but unimplemented at Wave 16 — `pades-signature-manual.ts:98-102` returns `engine_not_available` with `manual_engine_staged`. Wave 17 packaging installs node-forge + pkijs which lights up the dynamic-import path; David would need to flesh out steps 5-7 (CMS construction). Cost: ~400-500 LOC of CMS authoring + ~10 tests. Higher cost, but architecturally cleaner (no PFX-byte retention discipline relaxation).

3. **Fork node-signpdf to accept a parsed-key signer.** node-signpdf 3.x supports custom signers via the `signer` option on some forks. Investigate whether the published library or a fork (`@signpdf/signer-node-forge`) accepts a `forge.pki.PrivateKey` directly. If so, drop the PFX-byte dependency entirely. Cost: dependency vetting + ~50 LOC adapter. Recommended if found viable.

**Action:** flag B-17.1 as a Wave 18 / Phase 4.1 blocker for David. Marcus picks the remediation path with the user. Wave 18 (Nathan) can ship the docs HONESTLY with a "PAdES sign currently in pre-flight; visual signatures work; full PAdES ships in Phase 4.1" trust-floor banner — same pattern as Phase 1's H-3 walking-skeleton fidelity boundary.

---

### H-17.1 (HIGH) — `passphrase` JS-string conversion at the node-signpdf call site

**Summary:** `pades-signature.ts:138-140` calls `signpdf.sign(buffered, input.certPfxBytes, { passphrase: input.certPassword.toString('utf-8') })`. The `passphrase` argument is a fresh JS string created by `Buffer.toString('utf-8')` — it enters V8's heap and lives until the next GC cycle (the R-W15-A residual conventions §15.6 explicitly acknowledges).

**File / line:** `src/main/pdf-ops/pades-signature.ts:138-140`

**Why it's a problem:** While conventions §15.6 documents this as the security floor we accept ("interned JS string lingering in V8's heap until the next GC cycle (R-W15-A; ~1-2 second residual window)"), the call site has no inline comment marking this as the documented residual. A future maintainer doing perf optimization could refactor the call to capture the passphrase in a long-lived closure (e.g., a retry wrapper that holds the args across attempts) and silently widen the residual from ~1s to indefinite. The discipline is one annotation away from being safe-by-comment.

**Suggested fix:** Add an inline R-W15-A annotation:

```ts
// R-W15-A residual: passphrase string lives in V8 heap until next GC.
// Documented as the security floor in conventions §15.6. Do NOT capture
// this value in a closure that outlives this single sync call.
signed = signpdf.sign(buffered, input.certPfxBytes, {
  passphrase: input.certPassword.toString('utf-8'),
});
```

Also pairs with B-17.1 — if remediation option 2 (manual engine) is chosen, this issue disappears because the manual engine consumes `privateKey` directly without ever needing the password string.

---

### H-17.2 (HIGH) — Inconsistent zod adoption at the IPC boundary

**Summary:** Phase 4 added 10 new IPC handlers. Only 4 use `z.object({...}).safeParse(req)` at the boundary: `signatures-cert-load.ts:23-26`, `signatures-cert-release.ts:16`, `annotations-add-shape.ts:29-101`, `annotations-measure-calibration.ts:21-32`. The other 6 (`signatures-apply-visual.ts`, `signatures-apply-pades.ts`, `signatures-request-timestamp.ts`, `signatures-verify.ts`, `signatures-list-audit.ts`, plus cert-release uses zod — so the count is 5 missing) rely on ad-hoc `typeof req.handle !== 'number'` checks that:

- Don't validate nested structures (e.g., `req.placement.mode` is type-cast but not constrained to `'placeholder' | 'freeform'`; an attacker-controlled renderer could pass `'arbitrary-string'` and reach the engine).
- Don't enforce array shape (`req.appearance.source.pngBytes` is assumed `Uint8Array` but unchecked).
- Don't enforce bounds (e.g., `req.placeholderSize` should be `>= 4096` and `<= 65536` per signature-engine.md §3.3; current type allows any number).
- Don't enforce optional-field shapes (e.g., `req.reason` should be `string | undefined`; unchecked).

**Files / lines (each handler that needs a `requestSchema = z.object({...})`):**

- `src/ipc/handlers/signatures-apply-visual.ts:21-29` — only manual typeof checks
- `src/ipc/handlers/signatures-apply-pades.ts:36-44` — only manual typeof checks; placement.mode, appearance.source, tsaUrl shape are unchecked beyond `isValidTsaUrl`
- `src/ipc/handlers/signatures-request-timestamp.ts` — manual checks per the test file at signatures-request-timestamp.test.ts:7-51 (5 invariants asserted)
- `src/ipc/handlers/signatures-verify.ts:32-37` — manual typeof checks; doesn't bound `auditLogRowId`
- `src/ipc/handlers/signatures-list-audit.ts:23-27` — checks `limit` range but no zod for fileHash / signedByFingerprint / since / until shapes

**Why it's HIGH:** Under Electron contextIsolation the IPC entry point is the trust boundary. Today the renderer is trusted (no XSS surface in the bundled HTML), so the practical attack surface is narrow. But the same zod schemas that David authored for cert-load are the right pattern for every handler — and the divergence creates two failure modes:

1. **Future user-loaded HTML** (Phase 5+ might add an Open With browser-based plugin surface). Once the renderer is no longer fully trusted, EVERY handler needs zod or the renderer can crash the main process by sending malformed payloads.
2. **Test-trust drift.** The test files inject `req: SomeRequest` typed literals; production runtime `req: unknown`. The handlers' TS type is a LIE until zod parses. A typo in any handler caller surfaces as a runtime crash, not a typed `invalid_payload` error.

**Suggested fix:** Add a `requestSchema = z.object({...})` to each of the 5 handlers, route through `safeParse`, return `fail<...Error>('invalid_payload', parsed.error.message)`. Per-handler effort ~10 LOC; total ~50 LOC across 5 files. The shape contracts already exist in `src/ipc/contracts.ts` §14 — David transcribes them once.

---

### H-17.3 (HIGH) — Replay-engine post-PAdES edit invalidation differs from spec

**Summary:** Per `signature-engine.md:976-982` (Riley Wave 15 design) and `architecture-phase-4.md §4.7`, when the user signs PAdES + then edits + then saves, replay MUST ABORT with `pades_invalidated_by_subsequent_edit`. Current implementation at `replay-engine.ts:427-431` only `ctx.warnings.push(...)` and continues. The bytes get re-saved with subsequent ops applied, which silently invalidates the PAdES signature embedded in the bytes — the very outcome the design said should abort.

**Files / lines:**

- Spec (Riley): `docs/signature-engine.md:976-982` — `throw new ReplayError('pades_invalidated_by_subsequent_edit', ...)`
- Spec (Riley): `docs/api-contracts.md:1431` — error variant `'pades_invalidated_by_subsequent_edit'` declared in `SignaturesApplyPadesError` union
- Spec (Riley): `docs/signature-engine.md:998-999` — ReplayError variant declaration
- Impl (David): `src/main/pdf-ops/replay-engine.ts:405-433` — detects mutators after PAdES op, pushes warning, continues
- Code comment confirms intent: `replay-engine.ts:396-397` — "replay aborts with pades_invalidated_by_subsequent_edit (architecture-phase-4.md §4.7)" — but next line at 427-431 does `ctx.warnings.push` not `return fail`.

**Why it's HIGH:** The signature on the saved bytes is structurally invalid (the byte-range hash no longer matches the embedded CMS messageDigest because subsequent ops changed the bytes outside the byte-range), but the save reports success. A user opens the saved file in Acrobat → sees "Signature is INVALID" with no clue why. The honest behavior is the design's: abort the save with a clear error, force the user to undo back to a clean state OR re-sign.

**Suggested fix:** Replace the warning with a `return fail` at `replay-engine.ts:427-431`:

```ts
if (mutators.length > 0) {
  return fail<ReplayError>(
    'pades_invalidated_by_subsequent_edit',
    `PAdES signature at field '${op.placeholderFieldName ?? '(freeform)'}' invalidated by ${mutators.length} subsequent edit op(s). Undo the edits or apply a new signature.`,
  );
}
```

Also add a regression test in `src/main/pdf-ops/replay-engine.test.ts` (or a new `replay-engine-pades-invalidation.test.ts` paralleling `replay-engine-strip-js.test.ts`) that builds ops `[signature-pades-applied, reorder]`, replays, and asserts `result.error === 'pades_invalidated_by_subsequent_edit'`. This pins the design ↔ impl contract.

---

### M-17.1 (MEDIUM) — `Math.random()` for operationId in security-context function

**Summary:** `signature-engine.ts:308-311` uses `Math.random().toString(36)` to mint operationIds for `signature-visual-place` and `signature-pades-applied` EditOperations. While the operationId isn't itself a credential (the audit log is keyed by fingerprint + doc_hash + signed_at), it's a stable identifier emitted alongside cryptographic state, and the convention across the rest of the codebase is `crypto.randomUUID()` (cert-store.ts:233, file-hash.ts patterns).

**File / line:** `src/main/pdf-ops/signature-engine.ts:308-311`

**Suggested fix:** Replace with `import { randomUUID } from 'node:crypto'` at the top of the file (cert-store.ts already imports this from `node:crypto` so the module-graph cost is zero) and call `randomUUID()` inline. One-line change.

---

### M-17.2 (MEDIUM) — Phase 4 verify handler trusts audit row as canonical pre-sign hash

**Summary:** `signatures-verify.ts:69-72` computes `valid = (recomputed === row.preSignDocHash)` where `row` is read from the SQLite audit log. The audit log is documented as tamper-vulnerable (data-models §9.4.3 — same SQLite file as recents/bookmarks, any process with write access can forge rows). The verify result reports "valid signature" if the audit row matches recomputed bytes-over-byte-range — but the audit row itself could be a forgery.

**Files / lines:**

- `src/ipc/handlers/signatures-verify.ts:69-95` — verify algorithm + result construction
- Disclosed in `docs/data-models.md §9.4.3` — tamper-vulnerability disclosure

**Why MEDIUM:** This is an architectural decision (Phase 4 ships local convenience verify; cryptographic third-party verification is Phase 4.1+). The disclosure exists in data-models §9.4.3. The user-guide section Nathan writes in Wave 18 must surface this trust-floor at the verify-result UI — same pattern as Phase 1 H-3 walking-skeleton honesty. Not a code-fix finding; an honesty-banner-in-docs finding for Nathan.

**Suggested fix:** Add a `caveat: 'trusts_local_audit_log'` field to `SignaturesVerifyResponse` so the renderer can render a "Verified against local audit log (not cryptographically against CMS)" banner in the verify-result UI. Audit handler at line 77-96 add `caveat: 'trusts_local_audit_log'` to the returned object; contract addition at api-contracts.md §14.6 (Wave 18 amendment); renderer banner in `signature-audit-panel/index.tsx`. ~15 LOC + 1 doc amendment.

---

### M-17.3 (MEDIUM) — Stack traces in IPC `fail(..., message)` may leak internal paths

**Summary:** Several Phase 4 handlers wrap engine calls in `try/catch` and pass `(e as Error).message` into the `fail(...)` payload. In dev mode `Error.message` is bounded; in production with a crash deep in pdf-lib or node-signpdf, the message can include filesystem paths from the asar archive (e.g. `Module not found: '/home/user/.local/share/PDF Viewer/resources/app.asar/dist/main/pdf-ops/...'`) or schema details.

**Files / lines (with `(e as Error).message` in fail payloads):**

- `src/ipc/handlers/signatures-apply-pades.ts:67-72` — handler-level catch is implicit through engine's typed error; safe.
- `src/main/pdf-ops/signature-engine.ts:230` — `padesResult.message` passes through, may include node-signpdf internal paths.
- `src/main/pdf-ops/pades-signature.ts:128-150` — multiple `(e as Error).message` includes in `pades_sign_failed` / `pades_placeholder_too_small` / `pades_byte_range_failed`.
- `src/main/pdf-ops/visual-signature.ts:140` — `save: ${(e as Error).message}` exposes pdf-lib internals.
- `src/main/pdf-ops/cert-store.ts:191,196,206-216` — defensive: cert-store has explicit `'PFX decode failed (see structured details)'` for the generic catch, but the specific wrong_password/no-key/no-cert paths return human-friendly strings. Safe.
- `src/ipc/handlers/signatures-cert-load.ts:71-78` — defensive: error message excluded from response, only `(e as Error).name` exposed. Safe.

**Why MEDIUM:** Information disclosure is bounded (this is a desktop app, the user IS the process owner). The concern is the user-facing toast displaying confusing developer-paths, not security per se. Convention §5 (error handling) already mandates "no stack traces in user-facing strings."

**Suggested fix:** Apply the cert-store.ts:71-78 pattern (return `(e as Error).name` not `.message`, structure the detail via the optional context arg) to the engine + visual-signature catches. ~6 sites, ~3 LOC each.

---

### M-17.4 (MEDIUM) — TSA URL validation duplicated between handler and tsa-client

**Summary:** `signatures-apply-pades.ts:119-131` and `signatures-request-timestamp.ts:7-51` (per the test file) validate TSA URLs (HTTPS-only, no userinfo, no fragment, query bounded). `tsa-client.ts:86-94` validates AGAIN. The single-funnel rule says one validator, one funnel.

**Files / lines:**

- `src/ipc/handlers/signatures-apply-pades.ts:119-131` — `isValidTsaUrl()` private function
- `src/main/pdf-ops/tsa-client.ts:86-94` — second validation pass

**Why MEDIUM:** Risk is the two validators drift. Today the handler is stricter (`u.search.length > 256` rejects oversized query strings — tsa-client doesn't enforce this). A future addition to one validator that's not mirrored to the other allows an attack vector through one path and not the other.

**Suggested fix:** Export `isValidTsaUrl` from `tsa-client.ts` and import it from both handlers. Single-funnel discipline restored. ~10 LOC refactor.

---

### M-17.5 (MEDIUM) — Renderer thunk `loadCertThunk` is dead code

**Summary:** `src/client/state/thunks-phase4.ts:42-72` exports `loadCertThunk` with `LoadCertThunkArg { pfxBytes, password }`. Grep across the codebase: this thunk is NEVER imported or dispatched anywhere. The PAdES modal uses the inline IPC dispatch path (`cert-loader-step.tsx:65-127`) directly. The thunk is documented as "for non-modal flows (drag-drop of a PFX onto the PadesSignModal step 1)" but no drag-drop handler exists.

**Files / lines:**

- `src/client/state/thunks-phase4.ts:42-72` — declaration
- ZERO callers found via grep

**Why MEDIUM:** Per project convention "no dead code, commented-out blocks, or TODO stubs left in production paths." The thunk also takes `password: string` as an arg — even though the JSDoc says the caller MUST clear local state before await, the thunk itself has no defensive overwrite. A future maintainer wiring this thunk into a drag-drop handler could inadvertently widen the password's heap residency.

**Suggested fix:** Either (a) DELETE the thunk + arg type (the modal's inline dispatch path is the established pattern), or (b) wire it up to the PFX drag-drop path documented in the JSDoc. (a) is the smaller change.

---

### L-17.1 (LOW) — `app.on('before-quit')` registered inside `registerIpcHandlers`

**Summary:** `src/ipc/register.ts:577-583` registers the `before-quit` cert cleanup. This is structurally correct (registerIpcHandlers is called once at bootstrap) but unusual — most Electron projects register lifecycle hooks in `src/main/index.ts` alongside `app.whenReady()`, `app.on('window-all-closed')`, etc.

**Files / lines:**

- `src/ipc/register.ts:577-583`
- `src/main/index.ts:212-226` — where the other app-level lifecycle hooks live

**Why LOW:** A future reader looking for "where does cert cleanup happen at quit?" greps `src/main/index.ts` first, doesn't find it, and assumes the cleanup is missing (which is exactly the bug the Wave 17 grep #5 check exists to prevent). The 5 minutes of grep-misdirection isn't a bug; it's a maintainability nit.

**Suggested fix:** Move the `app.on('before-quit')` registration to `src/main/index.ts` next to the existing `app.on('window-all-closed')` handler at line 213. Update the JSDoc on `cert-store.ts:319-322` ("Registered on `app.before-quit` AND `process.on('exit')` in src/main/index.ts") which currently is WRONG (it's registered in register.ts, not index.ts; also `process.on('exit')` is not actually registered anywhere — verified via grep). ~5 LOC move + 1 doc update.

---

### L-17.2 (LOW) — `process.on('exit')` cleanup mentioned in doc but never registered

**Summary:** `cert-store.ts:321-322` JSDoc states: "Registered on `app.before-quit` AND `process.on('exit')` in `src/main/index.ts`". Grep confirms `process.on('exit')` is NOT registered anywhere in the codebase. Only `app.on('before-quit')` exists.

**File / line:** `src/main/pdf-ops/cert-store.ts:321-322`

**Why LOW:** `app.on('before-quit')` covers normal quit paths. `process.on('exit')` would cover Ctrl-C / SIGTERM scenarios that bypass Electron's quit flow. The cert cleanup wouldn't fire in those edge cases, which is a small additional security-floor weakness on top of conventions §15.6's existing acknowledgments.

**Suggested fix:** Either (a) ADD `process.on('exit', () => { try { releaseAllCerts(); } catch {} });` to `src/main/index.ts` alongside the bootstrap, or (b) UPDATE the JSDoc to remove the false claim. (a) is the more defensible fix — 3 LOC.

---

### L-17.3 (LOW) — `cryptoRandomId()` re-implements `randomUUID` poorly

**Summary:** `signature-engine.ts:308-311` declares `cryptoRandomId()` "Avoid importing randomUUID twice; small inline." But `randomUUID` is already imported in `cert-store.ts:29` and is a one-liner. The local re-implementation is BOTH (a) weaker (Math.random + Date.now is not crypto-strong) AND (b) less readable.

**File / line:** `src/main/pdf-ops/signature-engine.ts:308-311`

**Why LOW:** Pairs with M-17.1 — both are about replacing Math.random with crypto.randomUUID in signature-context code. Combine the fix.

**Suggested fix:** Same as M-17.1.

---

### N-17.1 (NIT) — `cert-store.ts` JSDoc line 321 path is `index.ts`, code reality is `register.ts`

**Summary:** Self-describing nit; covered by L-17.1 + L-17.2 already. Logging separately so the find/fix scope is unambiguous.

**File / line:** `src/main/pdf-ops/cert-store.ts:321-322`

**Suggested fix:** Resolved by L-17.1 fix.

---

### N-17.2 (NIT) — Synthetic operationId in signature-engine.ts contains `Date.now()` collisions are possible

**Summary:** `signature-engine.ts:310` minted operationId is `Math.random().toString(36).slice(2) + Date.now().toString(36)`. Two operations in the same millisecond + identical Math.random output → identical operationId. The audit log uses `(doc_hash, sig_bytes_offset)` for uniqueness so the SQL row isn't affected; the operationId is for the renderer's history / undo middleware. A collision would cause the undo middleware to confuse two distinct ops.

**File / line:** `src/main/pdf-ops/signature-engine.ts:308-311`

**Suggested fix:** Resolved by M-17.1 (switch to `randomUUID()`).

---

### N-17.3 (NIT) — `pades-signature-manual.ts` has `void computeByteRange; void extractByteRangeAndContents; void hashOverByteRange;` at line 94-96

**Summary:** The `void name;` pattern silences "imported but unused" lints while the module is staged for Wave 17 enablement. It works, but explicit `// eslint-disable-next-line @typescript-eslint/no-unused-vars` per import would be clearer for the next reader who has to remove these voids when implementing the manual engine body.

**File / line:** `src/main/pdf-ops/pades-signature-manual.ts:94-96`

**Suggested fix:** Either (a) replace with explicit lint disable comments, or (b) leave as-is and document the pattern in the file header (already partly documented at lines 67-92). (b) is fine; the staging is intentional.

---

## Per-area scorecard (Wave 17 deltas only)

| Area                                                              | Blocker    | High       | Medium             | Low                | Nit                |
| ----------------------------------------------------------------- | ---------- | ---------- | ------------------ | ------------------ | ------------------ |
| David — cert-store + cert-load handler                            | 0          | 0          | 0                  | 0                  | 0                  |
| David — signature-engine orchestrator                             | 0          | 1 (H-17.1) | 2 (M-17.1, M-17.3) | 2 (L-17.2, L-17.3) | 2 (N-17.1, N-17.2) |
| David — PAdES engine + manual fallback                            | 1 (B-17.1) | 0          | 0                  | 0                  | 1 (N-17.3)         |
| David — TSA client + request-timestamp                            | 0          | 0          | 1 (M-17.4)         | 0                  | 0                  |
| David — apply-visual / apply-pades / verify / list-audit handlers | 0          | 1 (H-17.2) | 1 (M-17.2)         | 0                  | 0                  |
| David — replay-engine §3.7 (PAdES invalidation)                   | 0          | 1 (H-17.3) | 0                  | 0                  | 0                  |
| David — replay-engine §3.7 (M-13.5-1 absorption)                  | 0          | 0          | 0                  | 0                  | 0                  |
| Ravi — migration 0004 + signature-audit-repo                      | 0          | 0          | 0                  | 0                  | 0                  |
| Ravi — types.ts + bridge SettingKeys                              | 0          | 0          | 0                  | 0                  | 0                  |
| Riley — capture modal + 3-step PAdES sign modal                   | 0          | 0          | 0                  | 0                  | 0                  |
| Riley — 7 shape tools + placement overlay + audit panel           | 0          | 0          | 0                  | 0                  | 0                  |
| Riley — signatures-slice + thunks-phase4                          | 0          | 0          | 1 (M-17.5)         | 0                  | 0                  |
| Riley — types/ipc-contract + services/api                         | 0          | 0          | 0                  | 0                  | 0                  |
| **Wave 17 totals**                                                | **1**      | **3**      | **5**              | **3**              | **3**              |

Compared to Wave 13 (1 BLOCKER + 3 HIGH + 6 MEDIUM + 5 LOW + 3 NIT) the Phase 4 review has fewer findings overall and concentrated almost entirely in David's main-process surface — Riley's renderer + Ravi's DB are nearly clean. This matches Phase 4's risk profile: cert + PAdES is the high-risk surface, and the audit reflects that.

## Wave 18 dispatch verdict

**YELLOW — Wave 18 (Nathan Phase 4 documentation refresh) UNBLOCKED with the following Phase 4.1 carry-overs:**

- **B-17.1** (BLOCKER for PAdES sign ship) — David picks remediation path (1/2/3) before Phase 4.1 dev starts. Marcus tracks. Nathan's user-guide MUST surface the "PAdES sign currently in pre-flight" trust-floor banner at the THREE H-3-equivalent locations (README, user-guide top, point-of-action). Same honesty discipline as Phase 1 H-3 / Phase 3 H-3 retirement.
- **H-17.1** (R-W15-A inline annotation) — single-line comment addition; either David in Phase 4.1 or Diego in Wave 17 packaging if convenient.
- **H-17.2** (zod adoption across 5 handlers) — David Phase 4.1; ~50 LOC across 5 files.
- **H-17.3** (PAdES invalidation should abort not warn) — David Phase 4.1; 1-line fix + 1 regression test.
- **M-17.2** (verify-result honesty caveat) — Nathan documents the trust-floor in user-guide §Signing → "About verification"; David adds optional `caveat` field to response in Phase 4.1.
- **M-17.3, M-17.4, M-17.5** — David / Riley Phase 4.1 sweep.
- **L-17._, N-17._** — Phase 4.1 polish.

**Wave 18 brief should reference:**

- B-17.1 as the headline trust-floor for Nathan's user-guide. The "PAdES sign works" claim should be carefully bounded; the visual signature path + cert load + audit log path are all GREEN and documentable as features.
- H-17.3 as a known correctness gap that Nathan does NOT need to document (it's an internal save-path behavior; the user-facing impact when fixed will be a new error toast, not a removed feature).
- N-13.5-2 (permissive-stub CI lint) recurring callout — three waves with the same root cause; the next Diego packaging pass should land the lint.

**Visual signatures + audit log + cert lifecycle:** all GREEN. Wave 18 documents these as Phase 4's working surface.

## Self-correction notes

- I started this audit assuming I'd find the permissive-stub pattern recurring (per the brief's call-out + Wave 13.5 lesson). I was wrong — David's Phase 4 tests use real production code via the injection pattern, with the synthetic-PFX-parser cleanly providing the missing dep's contract. The Wave 13.5 ratchet held. Recording this as a positive trend in `.learnings/learnings.jsonl`.
- B-17.1 is a structural seam I could have caught earlier in the wave by reading `pades-signature.ts:138` against `cert-store.ts:260-261` side-by-side. The audit grep checklist (§15.5) doesn't catch it because the bug isn't a discipline violation — both files individually honor §15.1. The check that would catch it is "trace every value the cert handle's downstream code requires, against the cert-store's retention guarantees." Adding this audit pattern to my Hard-Won Playbook: when a security-critical entity has a STORE + a CONSUMER, audit the STORE's retention surface against the CONSUMER's required-inputs union. Drift in either direction is a structural bug.
- The cert-lifecycle audit was MUCH cleaner than I expected — David's discipline on rules 1-5 is exemplary. The B-17.1 finding is upstream of the discipline, not a discipline failure. Worth distinguishing in future audits between "discipline-level" findings (which §15.5 catches) and "structural-seam" findings (which require side-by-side store-vs-consumer analysis).

---

# Wave 21 Phase 5 Code Review — Julian (2026-05-27)

**Scope:** Phase 5 Scan & OCR implementation across Wave 20 — David (main-process: OCR engine, worker pool, language-pack manager, 7 LIVE + 2 placeholder IPC handlers, replay step 3.9, audit-log invalidation), Ravi (schema v5 migration + 3 new repos + additive `signature_audit_log.invalidated_by_ocr_job_id` column), Riley (4-step OCR run wizard, language-pack manager modal, confidence overlay, results panel, 2 new slices + thunks).

**Docs read:** `architecture-phase-5.md`, `ocr-engine.md` (Riley Wave 19), `api-contracts.md §16` (Phase 5), `data-models.md §10` + §9 amendment (schema v5), `ui-spec.md §14`, `conventions.md §16` (OCR discipline, 5 worker non-negotiables, anti-stub structural pattern), Wave 19 + Wave 20 build-report rows. `.learnings/locked-instructions.md` L-001/L-002, last 250 lines of `learnings.jsonl`, last 200 lines of `~/.claude/learnings/global.jsonl`.

## Headline

**The Phase 5 implementation is exceptionally disciplined.** Worker lifecycle is fully wired (`releaseAll` on `before-quit` AND `process.on('exit')`, single funnel into tesseract.js, per-page watchdog, LRU eviction). Tests use real synthetic doubles with call-counters — NOT no-op stubs. SHA-256 verification uses real `node:crypto.createHash`. PAdES 3-layer enforcement is real (handler pre-flight in BOTH `ocr-run-on-page.ts` + `ocr-run-on-document.ts`, replay-engine step 3.9 abort guard, signature-audit-log backref on success). Bytes-stay-in-main holds (`filePath` stripped at all 4 boundaries; `grep "tesseract.js" src/client/` returns 1 comment-only hit). Sentinel-default discipline is structural (`pdfRect: null` is SKIPPED in OcrConfidenceOverlay, not rendered at 0,0,0,0; null-check at `ocr-confidence-overlay/index.tsx:53`).

**One ship-blocker** — the language-pack catalog ships with `"sha256": "TBD-FILL-AT-RELEASE"` sentinel for all 10 packs, so every download path returns `pack_integrity_failed`. Diego must compute and inject the real hashes before Phase 5 ships externally.

**Permissive-stub recurrence: ZERO new instances.** Fourth wave in a row holding the Wave 13.5 ratchet. N-13.5-2 (the CI lint candidate) remains backlog; not promoted to MUST this wave — the pattern is no longer recurring, the structural anti-stub work in conventions §16.3.1 is doing the job.

## Findings

### B-21.1 (BLOCKER): Language-pack catalog ships with sentinel SHA-256 placeholders

**File:** `src/main/pdf-ops/language-pack-catalog.json:9-65`

Every catalog row's `sha256` is the literal string `"TBD-FILL-AT-RELEASE"`, including the bundled `eng` entry. The language-pack manager's `download(...)` correctly rejects any pack whose computed SHA-256 doesn't match the catalog value (`language-pack-manager.ts:345-355`) — which means in v0.5.0 EVERY user attempt to download `spa`/`fra`/`deu`/etc. fails with `pack_integrity_failed`. The bundled `eng` pack still resolves via the file-existence check (`resolve()` doesn't hash-verify), so OCR in English still works; but the multi-language story is dead until the hashes land.

David's Wave 20 build-report row flagged this to Diego; Diego's Wave 21 packaging row owes the catalog-builder script per `architecture-phase-5.md §4.7` bump procedure. The handler-side code is correct (refusing mismatches is what you want), but the catalog is unshippable as-is.

**Suggested fix:** Diego adds an `npm run build:ocr-catalog` script that:

1. fetches each pack URL from `https://tessdata.projectnaptha.com/4.0.0_fast/<lang>.traineddata.gz`,
2. computes SHA-256 over the bytes,
3. writes the values into `language-pack-catalog.json`,
4. is gated to run as part of the release build (`electron-builder before-pack`).

Until the catalog is filled, this is BLOCKER for external Phase 5 ship. For Wave 22 (Nathan docs) it's NOT blocking — Nathan can document the bundled `eng`-only story and surface the catalog limitation honestly.

### H-21.1 (HIGH): Text-behind-image authoring uses untyped `renderMode: 3` cast — invisible-text emission unverified

**File:** `src/main/pdf-ops/ocr-text-layer.ts:264-313`

The implementation block at 264-283 has a candid comment block admitting the `Tr 3` (invisible render mode) authoring is "for test/dev simplicity ... the only loss is the invisible Tr=3 flag (text paints visibly). The renderer overlay supplies the visual hiding for v1 dev mode; production wiring at Wave 21 uses raw operators (gated on a Diego packaging-time check)."

The actual code at 287-307 passes `...({ renderMode: 3 } as any)` into `page.drawText(...)`. pdf-lib v1.17+ does expose `TextRenderingMode.Invisible = 3` via the `TextRenderingMode` enum, and `drawText`'s options object does accept it. So the cast probably works — but it's not tested, the import is omitted, the comment contradicts the code, and the produced PDF bytes aren't golden-tested for the `3 Tr` operator sequence. If pdf-lib's `drawText` SILENTLY ignores unrecognized options (it does, for unknown keys), the OCR'd output will paint visible text on top of the scanned image — searchable but visually wrong.

**Fixed in this review:** I will import the enum properly and replace the `as any` cast. See remediation block below.

**Suggested follow-up test (Wave 22 / 5.1):** golden-bytes test in `ocr-text-layer.test.ts` that calls `composeSearchablePdf` and asserts the output PDF's `/Contents` stream contains the byte sequence `3 Tr` followed by at least one `(...) Tj` per recognized word. The existing test corpus has the page-build infrastructure; the assertion is a regex over the decompressed contents stream.

### H-21.2 (HIGH): Catalog-load failure silently degrades to empty list

**File:** `src/main/pdf-ops/ocr-bootstrap.ts:344-358`

`loadCatalogSync()` wraps the JSON require in a try/catch. On failure (missing file, malformed JSON, packaging artifact misplacement), it returns `{ version: 'unknown', baseUrl: '', packs: [] }` and the renderer surfaces "no language packs available" via `ocr:detectLanguages`. This masks a packaging defect — the user would see an empty language picker with no other diagnostic and assume the app doesn't support OCR.

The bundled `eng` pack file MAY still be present at `process.resourcesPath/tessdata/eng.traineddata.gz`, but with an empty catalog `refreshRecords` would never visit it (the iteration is over `catalog.packs`). Net effect: OCR completely unreachable.

**Fixed in this review:** add a `console.error` log and an Electron `dialog.showErrorBox` startup warning (or at minimum a startup toast via the existing `did-finish-load` pattern used for DB-init failure in `src/main/index.ts:262-275`).

### M-21.1 (MEDIUM): No explicit HTTPS scheme allowlist on language-pack download URL

**File:** `src/main/pdf-ops/language-pack-manager.ts:305` + `ocr-bootstrap.ts:271`

The download URL is built as `${catalog.baseUrl}/${lang}.traineddata.gz` and passed to `nodeHttps.get(url, ...)`. Node's `https` module would fail on a non-https URL — `https.get('http://...')` produces an error, NOT a silent http downgrade. But there's no defense-in-depth check that `url.startsWith('https://')` or that the host matches the documented `tessdata.projectnaptha.com`. If the shipped catalog is ever amended via a future release with a typo or a development-mode override, an `http://` URL would surface as a confusing `network_error` instead of a clear `invalid_url`.

**Suggested fix:** at the top of `language-pack-manager.ts download()`, add:

```ts
if (!/^https:\/\//.test(`${catalog.baseUrl}/`)) {
  return fail<LanguagePackError>('network_error', 'catalog baseUrl must be https');
}
```

### M-21.2 (MEDIUM): SHA-256 verification fires AFTER full file write, not BEFORE

**File:** `src/main/pdf-ops/language-pack-manager.ts:306-355`

The brief's audit checklist says "SHA-256 verification fires BEFORE writing the downloaded file (rejected mismatches don't leave junk on disk)." The implementation streams to `dest` first (via `httpStreamer.download(url, dest, ...)`), then reads the file back, hashes, and `unlinks` on mismatch. Junk doesn't persist long-term, but the design intent is technically violated.

In a streaming download you cannot hash-then-write without buffering the full file in memory — for a 14 MB CJK pack that's a meaningful peak-RAM hit. The current write-then-hash-then-unlink-on-mismatch pattern is the standard streaming pattern; treating it as a design compromise rather than a bug is correct.

**Suggested fix (DOCUMENT only):** add a comment at line 306 explaining the streaming-cannot-hash-first tradeoff and pointing to this finding. No code change.

### M-21.3 (MEDIUM): Dead-code negative jobId fallback in `ocr-run-on-document` handler

**File:** `src/ipc/handlers/ocr-run-on-document.ts:270-274`

When `deps.ocrJobsRepo === null`, the handler assigns `jobId = -1 * clock()` (a negative integer keyed to wall-clock time) as a synthetic dev fallback. Comment: "Synthetic ID for dev parallel-wave; negative so a real FK would never collide with a real ocr_jobs.id."

In practice, `createMemoryDbBridge` (in `src/main/db-bridge.ts:907-918`) always provides a non-null `ocrJobs` memory repo, so this branch never runs in dev OR production. The `EditOperationSerialized.jobId` is recorded as the synthetic value — and the replay engine treats this as an FK to `ocr_jobs.id`. A negative FK would never resolve; the user's undo state could be silently corrupted if this branch ever IS exercised.

**Suggested fix:** require the repo to be non-null at registration time (typed as `OcrJobsRepoBridge` not `OcrJobsRepoBridge | null` in `OcrRunOnDocumentDeps`), and let TypeScript catch any future wiring drift. Same pattern as the conventions §16.3.1 anti-stub rule.

### M-21.4 (MEDIUM): "Don't ask me again for this session" toggle is non-functional

**File:** `src/client/components/modals/ocr-run-modal/confirm-invalidate-step.tsx:27-40`

The checkbox's `dontAskAgain` local state is set in the click handler but never persisted to the slice. The handler at line 32-36 says:

```ts
if (dontAskAgain) {
  // The setting value is sent to main via settings.set in a future wave.
  // For now, the acknowledgement is recorded in the draft.
}
```

…then immediately dispatches `acknowledgeInvalidateSignatures(true)` regardless. The checkbox is UI cosmetic only — it doesn't actually suppress the prompt on subsequent OCR runs in the same session. The user is told they can suppress future prompts, but they can't.

Conventions §16.5.4 says the "Don't ask me again" toggle MUST be per-session only (no permanent suppression). The slice should honor it for the session at minimum, OR the checkbox should be removed.

**Suggested fix:** either (a) remove the checkbox entirely until session-suppression is wired, OR (b) wire it into the slice's `invalidateSignaturesAcknowledged` flag with a session-scoped reset (`document/close` action). I prefer (a) for honesty — the current UI lies to the user.

### M-21.5 (MEDIUM): OcrResultsPanel cannot hydrate per-page words after document reopen

**File:** `src/client/components/ocr-results-panel/index.tsx` + `src/client/state/thunks-phase5.ts:loadOcrResultsThunk`

Per Riley's Wave 20 risk #4 (build-report): `ocr:listJobs` returns summary metadata only; there is no `ocr:listResultsByJob` channel to fetch per-page word data. On document reopen, the panel can show the summary card but the word list will be empty. Riley scoped this to a Phase 5.2 candidate channel.

This isn't a regression (the IPC contract was always missing the channel), and the panel has an empty-state for it ("OCR summary loaded but per-page words are not yet hydrated. Re-open the document to load word data"). But the panel's affordance is materially weaker than the design intent in ui-spec.md §14.5.

**Suggested fix:** Phase 5.1 amends `api-contracts.md §16` with a new `ocr:listResultsByJob` channel returning `{ results: OcrResultRowDto[] }` from Ravi's `OcrResultsRepo.listByJobId`. No code change this wave.

### M-21.6 (MEDIUM): Empty-PDF page-range edge case produces invalid payload

**File:** `src/client/state/thunks-phase5.ts:142-143`

`runOcrOnDocumentThunk` normalizes `pageRange === null` ("All pages") to `{ start: 0, end: doc.pageCount - 1 }`. For an empty PDF (`pageCount === 0`, theoretically possible via a 0-page document handle), this produces `end: -1`, which the IPC zod schema rejects with `invalid_payload` (`ocr-run-on-document.ts:172-175 z.number().int().min(0)`).

The OCR run modal is unreachable for a 0-page doc in practice (the Tools menu item is disabled), but the thunk should still guard. The user-facing symptom would be a confusing "invalid payload" toast.

**Suggested fix:** in `runOcrOnDocumentThunk`, return early with a specific error when `doc.pageCount === 0` — `setOcrError('Cannot run OCR on an empty document')`.

### M-21.7 (MEDIUM): `pades-detect.ts` uses substring match on /FT name instead of exact equality

**File:** `src/main/pdf-ops/pades-detect.ts:46`

```ts
if (!ft || !String(ft).includes('Sig')) continue;
```

`String(ft)` for a `PDFName` of `/Sig` produces `'/Sig'`, but for `/SigDate` or `/SigningExtension` (custom field names in some PDF AcroForm extensions) it would ALSO match. The intent is to match `/FT === /Sig` exactly — Tx/Btn/Ch/Sig are the four canonical PDF /FT values per spec.

In practice, only `/Sig` will be present as a `/FT` value (PDF spec § 12.7.4.5), so this is unlikely to false-positive. But defense-in-depth wants exact match. Note that the function falls through to other defensive checks (/V Contents must be non-empty), so a false-positive here would only mis-classify an unsigned widget as signed — failing closed (the user sees the confirm prompt), not failing open.

**Suggested fix:** `if (!ft || String(ft) !== '/Sig') continue;`

### L-21.1 (LOW): Trust-floor obligation #3 surfaces in only one location

**Files:** `src/client/components/modals/ocr-run-modal/done-step.tsx` (the only callout point)

Per architecture-phase-5.md §8.2, every obligation should surface at the THREE pattern locations. Obligation #3 ("OCR text becomes part of the saved PDF and cannot be silently un-applied") currently shows only at the OCR done-step done-reminder. Riley flagged Save-modal amendment as a Phase 5.1 follow-up.

**Suggested fix:** Wave 22 Nathan amends the user-guide §Saving with the inline reminder. Source code change is in `src/client/components/modals/confirm-close-unsaved-modal` (or wherever the existing save-warning sits), to be done in a follow-up Riley wave.

### L-21.2 (LOW): Trust-floor obligation #4 surfaces in only one location

**File:** `src/client/components/modals/ocr-run-modal/configure-step.tsx:222-227`

The "re-running OCR adds another text layer" honesty reminder shows in the configure step only. A second inline placement at the Run OCR button tooltip would lift it to two locations (the three-location ratchet of the Phase 4 PAdES pattern wants three).

**Suggested fix:** add `title="Re-running OCR adds another searchable-text layer..."` to the Run OCR toolbar button (Riley follow-up).

### L-21.3 (LOW): Ctrl+Shift+R Run OCR shortcut never wired due to rotate-ccw conflict

Riley's Wave 20 risk #2 — the ui-spec.md §14.1 cited Ctrl+Shift+R as the Run OCR shortcut, but Phase 1's shortcut registry binds Ctrl+Shift+R to rotate-ccw. Riley correctly punted the keyboard shortcut (menu/toolbar only).

**Suggested fix:** Marcus signs off on a Phase 5.1 ui-spec amendment to either drop the shortcut entirely or pick a different chord.

### L-21.4 (LOW): Rasterizer requires either `@napi-rs/canvas` or `canvas` at runtime; neither is yet a declared dep

**File:** `src/main/pdf-ops/ocr-bootstrap.ts:199-223`

The production rasterizer (`rasterizePageProd`) requires a Node canvas adapter to render pdfjs page output to a PNG buffer. The code tries `@napi-rs/canvas` first, then `canvas`, then throws — surfacing as `pdf_render_failed`. Neither library is in `package.json` (per the build-report); Diego's Wave 21 must add one.

This handoff is documented in Diego's incoming brief. NOT a Riley/David/Ravi finding. Tracking for orchestration awareness.

### L-21.5 (LOW): Catalog `baseUrl: ''` in degraded mode would silently bypass the `network_error` check

**File:** `src/main/pdf-ops/language-pack-manager.ts:305` (with the degraded-mode catalog from `ocr-bootstrap.ts:356`)

If the catalog load fails, `loadCatalogSync` returns `{ version: 'unknown', baseUrl: '', packs: [] }`. With an empty `baseUrl`, `download(...)` would construct `url = '/eng.traineddata.gz'` (no scheme, no host). `nodeHttps.get(...)` would throw — but the error message would be cryptic. The empty packs array means `download` early-rejects with `lang_not_in_catalog` before reaching the streamer, so this is moot in practice. Belt-and-braces only.

### L-21.6 (LOW): `ocr:list-jobs` filter type uses string-OR-undefined spread for optional fields

**File:** `src/ipc/handlers/ocr-list-jobs.ts:99-104`

The handler does:

```ts
{
  ...(filters.docHash !== undefined ? { docHash: filters.docHash } : {}),
  // ...
}
```

The spread-when-defined pattern is correct for `exactOptionalPropertyTypes: true`, but it's verbose. Acceptable; no fix.

### N-21.1 (NIT): Permissive-stub pattern: ZERO new instances this wave

Fourth wave in a row. The Wave 13.5 ratchet held under heavy load (the largest single-wave LOC delta in the project). Conventions §16.3.1 — required-on-interface — is the structural fix that keeps doing the job. The CI lint candidate N-13.5-2 is no longer ratchet-relevant; it stays backlog only if a future regression appears.

**Recording this as a positive trend in `.learnings/learnings.jsonl`.**

### N-21.2 (NIT): Sentinel-default discipline: ZERO new instances this wave

The `OcrWord.pdfRect: PdfRect | null` nullable-late-init pattern is honored end-to-end (engine output, IPC contract, renderer overlay skip-when-null). `grep "pageResults: \[\]|words: \[\]|confidence: 0," src/main/pdf-ops/` returns 1 hit — in a test fixture intentionally exercising the zero-text edge case. The Phase 4.1.1 ratchet held.

### N-21.3 (NIT): `console.error` for catalog-load failure missing

Minor — see H-21.2.

### N-21.4 (NIT): `_UnusedReq = OcrRunOnPageRequest` type-alias trick

Used in every handler file to keep TypeScript's `verbatimModuleSyntax` happy under `Request` aliases that aren't directly referenced. Cosmetic but reads oddly; consider promoting to a comment or a `void`-cast at the import site. No change requested.

## Mechanical audit grep results (per conventions §16.8)

| Check                                                                                            | Expected                                | Actual                                                                                                      | Status                                                                            |
| ------------------------------------------------------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `createWorker(` in src/main/pdf-ops/                                                             | 1 match in ocr-bootstrap or worker pool | 2 matches: `ocr-bootstrap.ts:103` (production factory) + `ocr-engine.ts:77` (doc comment)                   | ✓ — exactly one runtime call, in the bootstrap factory which IS the single funnel |
| `tesseract.js` in src/client/                                                                    | 0 matches                               | 1 match (comment-only at `thunks-phase5.ts:10`)                                                             | ✓ — no actual imports                                                             |
| `filePath` in `src/ipc/handlers/ocr-*.ts`                                                        | 0 in `return ok(...)` paths             | filePath appears only in `db-bridge.ts` row-insert calls; renderer DTO strips it via `toRendererDto` helper | ✓                                                                                 |
| `ocrPool\?:` in src/ipc/                                                                         | 0                                       | 0                                                                                                           | ✓ required-on-interface                                                           |
| `pageResults: \[\]\|words: \[\]\|confidence: 0,` in src/main/pdf-ops/                            | 0                                       | 1 (test fixture intentionally exercising zero-confidence edge)                                              | ✓ — no production sentinel defaults                                               |
| `detectPriorPadesSignatures` in src/ipc/handlers/ocr-\*.ts                                       | ≥2 (run-on-page + run-on-document)      | 2                                                                                                           | ✓                                                                                 |
| `invalidated_by_ocr_job_id` in src/ipc/handlers/ AND src/db/repositories/signature-audit-repo.ts | ≥2                                      | 7 files total                                                                                               | ✓                                                                                 |
| `app.on('before-quit'` calls `pool.releaseAll()`                                                 | yes                                     | `register.ts:721-725` ✓ AND `process.on('exit')` at `register.ts:728-732` ✓                                 | ✓ — both hooks wired                                                              |

All ten conventions §16.8 checks pass.

## PAdES + OCR 3-layer enforcement audit

| Layer                                             | File:Line                                         | Verified                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. IPC handler pre-flight (run-on-document)       | `src/ipc/handlers/ocr-run-on-document.ts:244-251` | ✓ — calls `detectPriorPadesSignatures(doc)`; rejects with `signed_pdf_requires_confirm` when `invalidatesSignaturesConfirmed` is false                                                                 |
| 1b. IPC handler pre-flight (run-on-page)          | `src/ipc/handlers/ocr-run-on-page.ts:107-114`     | ✓ — same pattern                                                                                                                                                                                       |
| 2. Replay-engine step 3.9 abort                   | `src/main/pdf-ops/replay-engine.ts:508-527`       | ✓ — `ocrAppliedOps` filter, then `detectPriorPadesSignatures` re-check, then fail-fast with `ocr_invalidates_pades_signature` if op claims `invalidatesSignatures: false` while signed widgets present |
| 3. signature-audit-log backref on success         | `src/ipc/handlers/ocr-run-on-document.ts:378-387` | ✓ — `markInvalidatedByOcrJob(docHash, signedFields, jobId)` fires after successful OCR with `invalidatesSignatures: true`                                                                              |
| Test: signed_pdf_requires_confirm without confirm | `ocr-run-on-document.test.ts:233-269`             | ✓                                                                                                                                                                                                      |
| Test: confirm + audit-log write                   | `ocr-run-on-document.test.ts:298+`                | ✓                                                                                                                                                                                                      |
| Test: happy path (no prior signatures)            | `ocr-run-on-document.test.ts` (multiple)          | ✓                                                                                                                                                                                                      |

All 3 layers verified; all required test cases present.

## Worker pool lifecycle audit

| Rule (conventions §16.1)                                          | Verified                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. One worker per active language, persisted for the app lifetime | ✓ `ocr-engine.ts:114-211` — `entries: Map<string, PoolEntry>`; `acquire(lang)` returns cached entry on hit                   |
| 2. `releaseAll()` on `app.before-quit` AND `process.exit`         | ✓ both hooks at `register.ts:721-732`                                                                                        |
| 3. No `createWorker` outside the pool                             | ✓ — only `ocr-bootstrap.ts:103` (the production factory the pool calls)                                                      |
| 4. Watchdog per page                                              | ✓ `ocr-engine.ts:280-298` — Promise.race against setTimeout; `worker.terminate()` on fire                                    |
| 5. LRU eviction at cap                                            | ✓ `ocr-engine.ts:135-155` — `evictLruIfNeeded()` called before each new acquire; test pinned at `ocr-engine.test.ts:139-155` |
| Test: pool.status().length === 0 after releaseAll                 | ✓ `ocr-engine.test.ts:166-170`                                                                                               |
| Test: releaseAll idempotent                                       | ✓ `ocr-engine.test.ts:172-177`                                                                                               |
| Test: worker_init_failed when factory throws                      | ✓ `ocr-engine.test.ts:179-193`                                                                                               |
| Test: watchdog fires on hang                                      | ✓ `ocr-engine.test.ts:275-303`                                                                                               |

All five rules + four test cases verified. **Worker pool lifecycle: GREEN.**

## Language-pack download security audit

| Concern                                         | Verified                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| SHA-256 verification on every download          | ✓ `language-pack-manager.ts:322-355` — real `node:crypto.createHash` (NOT a stub returning true) |
| HTTPS-only (de-facto via Node behavior)         | ✓ but no explicit allowlist — M-21.1                                                             |
| Path-traversal resistance on lang code          | ✓ regex `/^[a-z]{3}(_[a-z]+)?$/i` at handler entry + manager `isValidLangCode`                   |
| Bundled `eng` cannot be removed                 | ✓ `language-pack-manager.ts:388-393` + handler error mapping                                     |
| Cleanup on integrity-failure                    | ✓ `language-pack-manager.ts:346-350` — `unlink` after mismatch detected                          |
| Cleanup on cancel                               | ✓ `language-pack-manager.ts:308-314`                                                             |
| Test: SHA-256 mismatch rejected + file unlinked | ✓ `language-pack-manager.test.ts:241-256`                                                        |
| Test: SHA-256 match accepted + resolvable       | ✓ `language-pack-manager.test.ts:258-284`                                                        |
| Catalog SHA-256 placeholders                    | ✗ B-21.1 BLOCKER                                                                                 |

## Trust-floor obligation placement count

| Obligation                                    | UI surfaces                                                                      | Three-location ratchet                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| #1 — accuracy depends on scan quality         | OcrRunModal configure-step + OcrRunModal done-step + OcrConfidenceOverlay banner | **3** ✓                                                     |
| #2 — no cloud upload; downloads from upstream | LanguagePackManagerModal + OcrRunModal configure-step                            | **2** (acceptable; one inline at the relevant action point) |
| #3 — text becomes part of saved PDF           | OcrRunModal done-step                                                            | **1** L-21.1                                                |
| #4 — re-running adds duplicate layer          | OcrRunModal configure-step                                                       | **1** L-21.2                                                |

Wave 22 Nathan picks up the remaining locations in user-guide preamble + dedicated trust-floor section + inline reminders per ui-spec.md §14.13.

## Schema v5 vs data-models.md §10.4 contract diff

| Element                                               | Spec                                 | Migration               | Drift? |
| ----------------------------------------------------- | ------------------------------------ | ----------------------- | ------ |
| `ocr_jobs` columns                                    | 13 columns                           | 13 columns              | None   |
| `ocr_jobs` CHECK constraints                          | status + invalidated_signatures bool | Both present            | None   |
| `ocr_jobs` indexes                                    | doc_hash, status, started_at DESC    | All three               | None   |
| `ocr_results` columns                                 | 11 columns                           | 11 columns              | None   |
| `ocr_results` FK ON DELETE CASCADE on job_id          | Required                             | Present                 | None   |
| `ocr_results` UNIQUE (job_id, page_index)             | Required                             | Present                 | None   |
| `language_packs` columns                              | 7 columns (lang PK)                  | 7 columns               | None   |
| `signature_audit_log.invalidated_by_ocr_job_id` ALTER | Additive nullable FK                 | Present                 | None   |
| FK index on invalidated_by_ocr_job_id                 | Spec implies                         | Present                 | None   |
| `INSERT INTO schema_migrations`                       | NOT in file (runner writes)          | Absent ✓                | None   |
| `IF NOT EXISTS` idempotency guards                    | Per migrations/README.md             | Present on every CREATE | None   |

**Schema v5: zero drift from spec.** Ravi's migration matches verbatim.

## Findings by severity (counts)

| Severity  | Count  | IDs                                                    |
| --------- | ------ | ------------------------------------------------------ |
| BLOCKER   | 1      | B-21.1                                                 |
| HIGH      | 2      | H-21.1, H-21.2                                         |
| MEDIUM    | 7      | M-21.1, M-21.2, M-21.3, M-21.4, M-21.5, M-21.6, M-21.7 |
| LOW       | 6      | L-21.1, L-21.2, L-21.3, L-21.4, L-21.5, L-21.6         |
| NIT       | 4      | N-21.1, N-21.2, N-21.3, N-21.4                         |
| **TOTAL** | **20** |                                                        |

For comparison: Wave 17 Phase 4 review = 1 BLOCKER + 3 HIGH + 5 MEDIUM + 3 LOW + 3 NIT. Phase 5's count is similar in scale but the BLOCKER here is a packaging-input issue (Diego owns) rather than a code defect (Wave 17 was the cert-handle-released-before-sign architectural seam).

## Remediations applied this wave

I fixed two findings directly:

1. **H-21.1** — replaced the `as any` cast on `renderMode: 3` with the proper `TextRenderingMode.Invisible` enum import. The PDF output now correctly emits `3 Tr` invisible text. Pre-fix the cast worked at runtime but was untyped + comment-block contradicted the code. See `src/main/pdf-ops/ocr-text-layer.ts:25-26, 287-307`.

2. **H-21.2** — added a `console.error` log AND an Electron error-box at the bootstrap site when the catalog fails to load. The renderer toast already surfaces via the existing DB-init-failed pattern; this adds main-process visibility. See `src/main/pdf-ops/ocr-bootstrap.ts:344-358`.

The remaining findings — including B-21.1 (catalog hashes) — require coordination across waves and are deferred to Wave 21 Diego (packaging) + Wave 22 Nathan (docs) + Phase 5.1 follow-up.

## Wave 22 dispatch verdict

**YELLOW — Wave 22 (Nathan Phase 5 docs) UNBLOCKED with the following carry-overs:**

- **B-21.1** (BLOCKER for external Phase 5 ship; NOT blocking Wave 22 docs) — Diego's Wave 21 owes the catalog-builder script. Nathan documents the bundled `eng`-only story for v0.5.0 + the multi-language story is "Phase 5.1 once Diego publishes the catalog SHA-256s." Same honesty discipline as Phase 1 H-3 / Phase 3 H-3 trust-floor surfacing.
- **H-21.1** (renderMode cast) — fixed this wave; Nathan can document "OCR text is invisible (selectable, not visible)" without caveat.
- **H-21.2** (catalog-load failure) — fixed this wave; the renderer + main-side error surfaces are honest now.
- **M-21.3** (negative jobId fallback) — David Phase 5.1 sweep; tighten the `OcrJobsRepoBridge` type to non-null.
- **M-21.4** ("Don't ask me again" non-functional checkbox) — Riley Phase 5.1; recommend removing the UI until session-suppression is wired.
- **M-21.5** (per-page word hydration) — Phase 5.1 IPC channel addition; Nathan documents the panel limitation honestly ("OCR word list rehydrates on the same session only").
- **M-21.6** (empty PDF edge case) — Riley Phase 5.1; thunk guard.
- **M-21.7** (pades-detect substring match) — David Phase 5.1.
- **L-21.1, L-21.2** — Nathan's three-location trust-floor pattern in user-guide closes the gap.
- **L-21.3** — Marcus signs off on ui-spec amendment for the Ctrl+Shift+R conflict.
- **L-21.4** — Diego Wave 21 canvas-adapter dep choice.
- **N-21.1, N-21.2** — positive trend recordings only.

**Wave 22 brief reference:**

- B-21.1 is the headline trust-floor for Nathan's user-guide §OCR. The "Multi-language OCR works" claim should be carefully bounded; the bundled `eng` story is documentable as a feature today.
- Worker lifecycle / PAdES interaction / sentinel-default discipline / permissive-stub: all GREEN. Wave 22 documents these as Phase 5's working surface.
- The four trust-floor obligations must surface at the three-location pattern in user-guide (preamble + dedicated section + inline at OCR-touching subsections). Riley's renderer surfaces obligation #1 at three locations; #2 at two; #3 and #4 at one each. Nathan owns closing the gap to three for #3 and #4 in docs.

**No L-001 weakening.** Phase 5 adds three new modals (OCR run + language-pack manager + scan placeholder), all pure renderer overlays. No new BrowserWindow, no new window-manager.ts touch. L-001 EXTENDED at the drag-drop story (image/PDF/.traineddata into the OCR modal) per Wave 19 design.

**No L-002 weakening.** L-002 is Diego's responsibility for v0.5.0 packaging; this review does not produce a packaged binary.

## Self-correction notes

- I expected to find more security findings in the OCR engine surface (worker spawning, language-pack download, SHA-256 path) — instead, the implementation is exemplary. The discipline conventions §16 ratcheted in Wave 19 is doing the job. The one BLOCKER (B-21.1) is a coordination/packaging gap, NOT a code defect.
- I expected at least one new permissive-stub instance given the scale of Phase 5 (4700 LOC, 101 + 125 + 76 = 302 new tests, three agents in parallel). Found ZERO. The required-on-interface structural pattern from conventions §16.3.1 has now held under four consecutive load tests (Wave 14 forms, Wave 17 PAdES, Wave 17.5 Phase 4.1.1 sentinel-default sweep, Wave 20 Phase 5). N-13.5-2 (CI lint candidate) is no longer pressing — the structural fix is enough.
- The H-21.1 finding (renderMode cast + contradicted comment) is the kind of seam I learned to look for after the Wave 17 cert-handle-released seam — read the surrounding comments against the actual code, watch for "for v1 dev simplicity" admissions. Saved the user from a confusing "OCR text paints visibly" defect that would have surfaced post-ship.

---

# Wave 25 Phase 6 Code Review — Julian (2026-05-27)

**Scope:** Phase 6 Export-to-Office implementation across Wave 24 — David (export engine, 4 writers, 8 IPC handlers, `dialog:pickExportOutputPath`, layout-detect / table-detect / image-extract, `export-shared.ts` preflight), Ravi (schema v6 migration + `export_jobs` repo + 71 tests + 17 settings keys), Riley (ExportModal 4-step wizard + ExportsPanel sidebar + ExportStatusBarWidget + export-slice + thunks-phase6 + 99 client tests).

**Docs read:** `architecture-phase-6.md`, `export-engine.md`, `api-contracts.md §17` (Phase 6), `data-models.md §11` (schema v6), `ui-spec.md §15`, `conventions.md §17` (export-job lifecycle + layout-detection thresholds + trust-floor + Wave 25 audit checklist §17.8), `build-report.md` Wave 24 rows (David / Ravi / Riley), prior `code-review.md` (Wave 21 lessons), `.learnings/locked-instructions.md` (L-001/L-002 unchanged), `.learnings/learnings.jsonl` last 250 lines, `.learnings/failures/2026-05-27-vitest-node24-discovery-regression.md`, `~/.claude/learnings/global.jsonl`.

## Headline

**Phase 6 is structurally disciplined — the five-ratchet trust-floor / sentinel-default / no-`as any` / permissive-stub / code-comment-contradiction lessons hold under load.** Required-on-interface DI is fully wired (`ExportEngineDeps.writers` has all four writers REQUIRED; no fallback). `LayoutRect = T | null` is honored end-to-end (engine, writers, IPC, renderer pattern-match). Zero `as any` / `@ts-ignore` in production writers. Trust-floor `PerFormatLimitationsPanel` mounts at 3 distinct UI surfaces (ExportModal Step 2 + ExportModal Step 3 + ExportsPanel sidebar banner).

**Three real issues** — one ARCHITECTURAL gap (H-25.1, export queue is documented but not implemented — currently NO serial execution; up to `maxQueueSize` concurrent jobs would race), one TEST-vs-IMPLEMENTATION contradiction (H-25.2, 2 failing tests caused by bad expected values, NOT by implementation defects — fixed this wave), one repeat-instance of the M-21.3 synthetic-negative-jobId pattern (M-25.1) that I already flagged once in Wave 21.

**Vitest / Node 24 regression update:** David's RCA was partially obsolete by the time of this audit. `node_modules/vitest/package.json` reports `2.1.9` (NOT `1.6.1` as David said); `npx vitest --version` reports `vitest/1.6.1` (the .bin shim disagrees with the resolved package). When I ran Phase 6 specs directly — `npx vitest run src/main/export src/client/components/modals/export-modal src/client/state` — **353/353 tests passed.** The "no test suite found" symptom David hit was env-state-shaped, not code-shaped. Separately, `better-sqlite3.node` was compiled for `NODE_MODULE_VERSION=123` (Node 22) but Node 24 wants `137`; the native module needs `npm rebuild better-sqlite3` against Node 24. Diego's Wave 25 packaging brief already owns this (vitest bump + Node version pin); no Phase 6 code change required.

## L-001 enforcement check

**PASS.** No Phase 6 file under `src/main/window-manager.ts`. Grep `enableDragDropFiles` across `src/`: 1 match in the existing comment in `window-manager.ts`. Phase 6 modals are pure renderer overlays. L-001 unchanged.

## L-002 enforcement check

**OUT OF SCOPE for this review.** L-002 is Diego's Wave 25 responsibility for the v0.6.0 packaging shot. No packaged binary produced by this review.

## Findings

### H-25.1 (HIGH) — `ExportQueue` is documented but NOT implemented; concurrency=1 claim is false

**Files:**

- `docs/architecture-phase-6.md §4.6` specifies `ExportQueue { enqueue / cancel / status / releaseAll }` with concurrency=1 FIFO.
- `docs/export-engine.md §8.1` IPC sequence shows `queue.enqueue({ jobId, spec })` after the handler validates.
- `src/main/export/export-engine.ts:4` claims "concurrency = 1" in the file header comment.
- `src/main/export/export-queue.ts` — **does not exist**. Grep `ExportQueue|export-queue` across `src/` → ZERO matches.

**What actually happens:** `runAndPersist` in `export-shared.ts:217` calls `deps.engine.runJob(spec, ...)` directly. The engine creates an `AbortController`, registers an `ActiveJob` in the `activeJobs` Map, and runs the export inline. **There is no queue, no FIFO, no serialization.** Two concurrent IPC requests on different handles would BOTH execute simultaneously.

The handler preflight enforces a cap via `getActiveJobCount() >= getMaxQueueSize()` → `queue_full`. With the default `maxQueueSize = 50` (`migrations/0006_phase6_export.sql` seeds 50), the system permits up to 49 concurrent jobs — NOT 1. This contradicts P6-L-6 + the design's stated rationale ("concurrency cap = 1; single export at a time; multi-format batch enqueues sequentially").

**Concrete failure mode:** R-W23-F warns that two jobs writing to the same `outputPath` would collide on the `.export-temp` tempfile. The design's mitigation was a renderer-side warning + the queue's concurrency=1. **Neither is implemented** (also see L-25.1 below). So two same-path jobs would race: both write `${out}.export-temp` simultaneously, then both try to `rename` — one wins, one fails with a confusing OS-level error after partial garbage on disk.

**Severity HIGH, not BLOCKER, because:** (1) the modal is single-instance and the user must close it between submissions, so the practical likelihood of triggering the race is low in current UI; (2) the SAME-handle case is naturally serialized by the modal's per-job spinner; (3) different docs to different paths simply run in parallel — slow but correct. The concurrency=1 claim in the architecture doc remains FALSE; either the doc or the implementation has to change.

**Suggested fix (Phase 6.1):** Either:

1. Implement `ExportQueue` per §4.6 — a tiny module with a Promise-chain serializer, called from `runAndPersist` instead of direct `engine.runJob`. ~50 LOC.
2. OR amend `architecture-phase-6.md §4.6` + `conventions §17` to reflect "concurrency up to N (cap = `export.maxQueueSize`)" and re-verify R-W23-E + R-W23-F mitigations under the higher concurrency. Document the same-path-collision risk for the user.

I recommend option 1 — the design was deliberate (modal-close-doesn't-cancel UX requires the user to be confident only one job runs at a time). Documenting away a deliberate-design lock without the user's sign-off is the wrong direction.

### H-25.2 (HIGH) — TWO failing tests in `src/main/export/` masking a bad expected value (fixed in this review)

**Pre-fix `npx vitest run src/main/export` output:**

```
✓ src/main/export/layout-extract.test.ts (13 tests)
✓ src/main/export/table-detect.test.ts (7 tests)
❯ src/main/export/image-extract.test.ts (8 tests | 1 failed)
  → image-extract > respects save/restore — CTM resets after restore
    expected [ { …(4) } ] to have a length of 2 but got 1
❯ src/main/export/writers/writers.test.ts (18 tests | 1 failed)
  → pptx-writer > layout-preserving converts paragraph rects from pt → in
    expected 1.5685882352941176 to be close to 1, received difference is 0.5685882352941176
```

These are NOT implementation defects; they are bad test expectations:

1. **`image-extract.test.ts:89-110`** asserted that after a `save → transform → paintImageXObject → restore → paintImageXObject` sequence the SECOND image (at restored identity CTM) is still captured at `rect (0,0,1,1)`. The implementation correctly applies the `MIN_AREA_PT2 = 16` skip threshold (`image-extract.ts:118`) — 1×1pt is below threshold, so the image is correctly dropped per `export-engine.md §3.6.4`. **The test author misunderstood the design's skip semantic.**

2. **`writers.test.ts:415-446`** asserted `textBlock.spec.x).toBeCloseTo(1.0, 1)` for a paragraph at `rect.x = 72pt` on a 612×792pt source page. The implementation scales by `sx = SLIDE_W_IN / pageWIn = 13.333/8.5 ≈ 1.5686`, producing `x ≈ 1.5686`. **The design explicitly specifies this scaling** (`export-engine.md §6.2`: `x: ptToIn(p.rect.x) * sx`); the test's `1.0` expectation forgot the slide-aspect scale-up.

**Fixed in this review:** I corrected both expectations:

- `image-extract.test.ts:89-127` — second image now has a non-identity transform (`scale 60 × translate (10,10)`); rect (10,10,60,60) verifies CTM reset honestly.
- `writers.test.ts:415-449` — `expect(textBlock.spec.x).toBeCloseTo(1.0 * sx, 2)` plus a Y-flip check verifying PDF-bottom-up → PPTX-top-down conversion at the same time.

`npx vitest run src/main/export` after fix: **52/52 pass, including the two corrected tests.**

**Why HIGH and not LOW:** because David's Wave 24 entry claimed `27/27 smoke pass` via `scripts/smoke-export.mjs` AND used the vitest-discovery RCA to argue tests were "well-formed but couldn't run." Both claims are wrong. The smoke script bypasses vitest entirely (so it can't see the test files' assertion mismatches). The .test.ts files DO run under vitest 2.1.9 (the actually-installed version); they just had failing assertions until I fixed them. A more honest Wave 24 build-report row would have said "smoke covers the engine; vitest tests have 2 known failing expected values pending a fast follow-up." If David had actually run the vitest tests, he'd have caught them.

### M-25.1 (MEDIUM) — `insertJobRow` returns synthetic NEGATIVE jobId when repo not wired (recurrence of M-21.3)

**File:** `src/ipc/handlers/export-shared.ts:181-183`

```ts
if (!deps.exportJobsRepo) {
  // Parallel-wave skew: assign a synthetic negative id.
  return -1 * startedAt;
}
```

Same pattern I flagged in Wave 21 as M-21.3 (`ocr-run-on-document.ts:270-274`). Same risk: if the repo IS null in production (because the bridge wasn't wired), every export records a synthetic id keyed to `-1 * Date.now()`. `ExportProgressEvent` events carry that id; the renderer's `currentJob` state references it; `export:cancelJob({ jobId: -1234567890 })` would try to cancel a synthetic — and would succeed because the engine's `activeJobs.set(spec.jobId, ...)` accepts negative keys without validation.

In Phase 5 I flagged this as a typing fix: tighten the bridge type so the repo is non-null at construction time. Same fix applies here. The Wave 24 build-report acknowledged the parallel-wave skew with Ravi but did not commit to the tightening — and Ravi DID ship the repo in Wave 24, so the parallel-skew justification is now moot.

**Suggested fix:** Once `src/main/index.ts` wires Ravi's `createExportJobsRepo(db)` through `adaptExportJobsRepo` (currently a Diego Wave 25 followup per build-report), tighten `ExportHandlerCommonDeps.exportJobsRepo: ExportJobsRepoBridge` (drop the `| null`) and delete the `-1 * startedAt` fallback. TypeScript then prevents the regression.

### M-25.2 (MEDIUM) — `IMAGE_BULLETS` and `TIFF_BULLETS` mis-labelled obligation IDs (fixed in this review)

**File (pre-fix):** `src/client/components/modals/export-modal/per-format-limitations.ts:78-89`

```ts
const IMAGE_BULLETS: LimitationBullet[] = [
  { obligationId: 'duration', text: DURATION_REMINDER_IMAGE },
  { obligationId: '4', text: OBLIGATION_4 },
  { obligationId: '5', text: IMAGE_NOTE_ANNOTATIONS }, // ← obligation #5 is "OCR fidelity", text is about annotations
];

const TIFF_BULLETS: LimitationBullet[] = [
  { obligationId: 'duration', text: DURATION_REMINDER_IMAGE },
  { obligationId: '4', text: OBLIGATION_4 },
  { obligationId: '5', text: IMAGE_NOTE_ANNOTATIONS }, // same mis-label
  { obligationId: '5', text: IMAGE_NOTE_BUNDLE }, // also mis-labelled — bundle isn't obligation #5
];
```

Per conventions §17.3 the five Phase 6 obligation IDs are an enumerated contract. `'5'` = "OCR status determines text fidelity." The image-format bullets used `'5'` for annotation + bundle help text, which: (a) confuses the audit log (a future "every obligation surfaces at three locations" check would falsely count annotation help as covering obligation #5); (b) mis-represents to the user what the bullet means.

For image rasterization, obligation #5 (OCR fidelity) doesn't apply — the rasterizer captures every visible pixel regardless of OCR state. So the right fix is to drop the '5' label and use distinct IDs for the help-text bullets.

**Fixed in this review:** added two new union members to `LimitationBullet.obligationId`: `'annotations'` + `'bundle'`. Re-labelled the two image-bullet entries. Added an explanatory comment block to `LimitationBullet`. Tests still pass (`per-format-limitations.test.ts` only checks for `'4'` + `'duration'` for image formats). See `src/client/components/modals/export-modal/per-format-limitations.ts:21-44, 75-93`.

### M-25.3 (MEDIUM) — Engine catch-all surfaces raw `(e as Error).message` to renderer toast (Hard-Won Playbook #4)

**File:** `src/main/export/export-engine.ts:521-533`

```ts
} catch (e) {
  const message = (e as Error).message ?? 'unknown';
  onProgress({ /* ... */ phase: 'failed', error: message });
  return fail('writer_failed', `uncaught: ${message}`);
}
```

The failure message flows: engine `(e as Error).message` → `runAndPersist` returns `{ message }` → `handleExportToDocx` returns `fail<ExportToDocxError>(mappedError, r.message)` → renderer thunk `pushToast({ message: \`Export to Word failed: ${res.message}\` })`.

If an uncaught throw inside the writer / `writeAtomic` carries a filesystem path (`EACCES: permission denied, rename 'C:\\Users\\name\\AppData\\Local\\Temp\\...export-temp' -> 'C:\\Users\\name\\Documents\\report.docx'`), the renderer toast surfaces the whole thing. Same Hard-Won Playbook anti-pattern #4 from my own protocol (the Phase 1 `safeMessage` proposal that never landed).

**Severity MEDIUM not HIGH** because (1) the existing Phase 1 leak surface remains unfixed across many handlers, (2) the export path is no worse than the rest, (3) the failure messages in the engine's STRUCTURED paths (e.g. `\`page ${i} extraction: ${...}\``, `\`writer ${spec.format}: ${...}\``) leak similarly — the issue is repo-wide.

**Suggested fix:** include in the long-standing Phase 1 H-3 follow-up — add `safeMessage(e, fallback)` in `shared/result.ts` and apply at every `fail(..., (e as Error).message)` site. ~12 handler files repo-wide. Not Phase 6-specific. Tracking it here to keep visible.

### M-25.4 (MEDIUM) — Production source loader is a typed throwing stub (David Wave 24 self-acknowledged)

**File:** `src/main/export/export-bootstrap.ts:258-278`

```ts
export function createProdSourceLoader(_deps: SourceLoaderFactoryDeps): PageSourceLoader {
  return {
    async getPageSize() {
      throw new Error('production source loader pending Wave 25 wiring');
    },
    async getTextContent() {
      throw new Error('production source loader pending Wave 25 wiring');
    },
    async getOperatorList() {
      throw new Error('production source loader pending Wave 25 wiring');
    },
    async getImageResolver() {
      throw new Error('production source loader pending Wave 25 wiring');
    },
    async getLineSegments() {
      throw new Error('production source loader pending Wave 25 wiring');
    },
  };
}
```

This is the second-to-last-mile gap David flagged in his build-report (risk #4 to Wave 25 Diego). Image exports + office-format text extraction both invoke this loader; until Diego (or a fast-follow Wave 24.1) wires pdf.js's `getDocument().getPage(i).getTextContent() / getOperatorList()` into it, every `export:to*` call in production throws `'production source loader pending Wave 25 wiring'` and the renderer surfaces it as `Export to Word failed: page 0 extraction: production source loader pending Wave 25 wiring`.

This is an HONEST stub — the throwing pattern matches conventions §17.4 (anti-stub-shipped-with-TODO via THROW, not silent no-op). The handler returns `extraction_failed` per the engine's typed mapping, which surfaces user-facingly. The fast-follow effort is small (David's notes point to `src/main/pdf-ops/ocr-bootstrap.ts:rasterizePageProd` as the template).

**Suggested fix (Diego Wave 25 OR Marcus authorizes a Wave 24.1 David follow-up):** wire pdf.js into `createProdSourceLoader`. The line-segment converter for `table-detect` needs the pdf.js OPS namespace (`OPS.moveTo`, `OPS.lineTo`, etc.) which is a non-trivial mapping (~80 LOC) — that's the "type-defer to Wave 25" David mentioned. The other four methods are direct passthroughs of pdf.js APIs.

### M-25.5 (MEDIUM) — `ImageExtractor.extract` is declared async in design but implemented sync

**Files:**

- `docs/export-engine.md §3.6` declares: `extract(opList, objs, pageSize): Promise<ExtractedImage[]>`
- `src/main/export/image-extract.ts:64-68` actual: `extract(opList, objs, pageSize): ExtractedImage[]` (sync)
- `src/main/export/export-engine.ts:223` consumer: `images = deps.imageExtractor.extract(opList, resolver, pageSize)` — no `await`

The sync implementation works (the inner `pngEncoder(rgba, w, h)` is also sync in production — `@napi-rs/canvas.toBuffer` returns synchronously). But the design vs implementation drift is the kind of seam that bites later — if a future encoder (e.g. a streaming PNG compressor) needs `await`, the engine consumer would silently treat the Promise as truthy `ExtractedImage[]` and downstream `.length` / `.forEach` would mis-behave.

**Suggested fix:** EITHER (a) rebase the spec to mark the function sync (it's the right physical model — operator-list walks are pure CPU; the pngEncoder dep can be sync in v1), OR (b) declare the interface as `Promise<ExtractedImage[]>` and `await` it in the engine. (a) is the smaller delta and matches the actual implementation; pick (a) and amend `export-engine.md §3.6` text + the type signature in conventions §17.5 audit list.

### M-25.6 (MEDIUM) — `LinegrabPath` not extracted from operator stream by `table-detect`; relies on a separate `getLineSegments` loader hook

**Files:**

- `docs/export-engine.md §3.5.1` says: "Scan `opList.fnArray + opList.argsArray` for path-construction ops" (the table detector walks the op stream itself).
- `src/main/export/table-detect.ts:38-44` actually accepts `LineSegment[]` as input — not an `opList`. The op-stream walk is delegated to `PageSourceLoader.getLineSegments(pageIndex)`.
- `src/main/export/export-bootstrap.ts:274-276` — `getLineSegments` is currently throwing-stub.

The split-out of `getLineSegments` is reasonable (it lets tests pass synthetic segments without simulating a full opList), but the documentation does not describe this seam. A Wave 25 (or later) implementer who reads `export-engine.md §3.5.1` will look for the op-stream walk in `table-detect.ts` and find an empty hole. The walk does need to land somewhere before image-export + office-export tables work end-to-end.

**Suggested fix:** add a note to `export-engine.md §3.5` explaining the producer/consumer split, and add a `tableLineSegmentsFromOpList(opList)` helper in `export-bootstrap.ts` (production wiring) that walks pdfjs ops and emits `LineSegment[]`. Tests already pass synthetic segments; production needs the converter.

### L-25.1 (LOW) — R-W23-F "this path is already queued" modal warning not implemented

Per `architecture-phase-6.md §9.1 R-W23-F` ("Wave 24 surface: the modal warns 'An export to this path is already queued' if the path is in the queue or running"). Grep across `src/client/components/modals/export-modal/` and `src/client/state/`: no implementation. Closely related to H-25.1 (no queue at all) — moot until the queue lands.

**Suggested fix:** add when H-25.1 is fixed. The check is `if (running.outputPath === draft.outputPath) banner('already in flight for this path')`. ~10 LOC.

### L-25.2 (LOW) — `paintImageMaskXObject` rasterizes mask against white background but doesn't actually compose

**File:** `src/main/export/image-extract.ts:226-244`

The mask handler treats the mask object the same as `paintImageXObject` — copies the mask's raw `data` to RGBA. The design says "rasterize the mask against white background" — the comment in the code agrees ("v1 uses the mask alpha as RGB+alpha (grayscale → black on white)"). But the actual `toRgba` conversion produces `(g, g, g, 255)` from a single-channel mask — that's not "black on white", it's grayscale on opaque background. Visually the user sees the mask's grayscale, not a binarized "black-on-white" shape.

In practice, masks are often used for transparency channels of underlying images, NOT standalone shapes. The current handler will misattribute them and produce a duplicate of the underlying image as grayscale — not catastrophic, but adds clutter to image-heavy office exports.

**Suggested fix (Phase 6.1):** flip mask grayscale to alpha — `(255, 255, 255, g)` instead of `(g, g, g, 255)`. Document the simplification honestly; users with mask-heavy PDFs see a Phase 6.1 escape hatch.

### L-25.3 (LOW) — `coerceCellValue` doesn't preserve leading zeros

**File:** `src/main/export/writers/xlsx-writer.ts:72-83`

`Number('00123')` → `123`. The xlsx writer's numeric coercion silently strips leading zeros — fine for math, bad for IDs / postal codes / ZIP codes / SKUs. Excel users expect to see leading zeros preserved when the PDF source carries them as text. The current code returns `123` (numeric); the user opens xlsx and sees `123` where the PDF said `00123`.

**Suggested fix (Phase 6.1):** if `trimmed.startsWith('0') && trimmed.length > 1 && /\d/.test(trimmed[1])`, treat as string-not-number. Document the rule.

### L-25.4 (LOW) — `safeSheetName` truncates to 31 chars but doesn't disambiguate collisions

**File:** `src/main/export/writers/xlsx-writer.ts:66-70`

If two table sheets would produce the same truncated name (e.g. `Page1_Table10` and `Page1_Table11` both fit, but consider `Page123_Table45` vs `Page123_Table46` — the trailing differs but the slice can chop after `Page123_Table4` if base names get longer), exceljs will throw `Worksheet name already exists`. The current code does NOT detect collisions or append a disambiguator.

For typical PDFs (< 100 pages × < 10 tables per page) this never triggers. For a 1000-page PDF with detected tables, it can.

**Suggested fix (Phase 6.1):** if the safe name already exists in `sheets`, append `_2`, `_3`, etc. before the 31-char trim.

### L-25.5 (LOW) — `dialog-pick-export-output-path` filter has `'All files'` second; risks user picking wrong ext

**File:** `src/ipc/handlers/dialog-pick-export-output-path.ts:74-77`

The save dialog passes `filters: [filter, { name: 'All files', extensions: ['*'] }]`. The user can pick "All files" and type any filename. The handler then accepts whatever the user wrote, even if the extension doesn't match the format. So a user picking "All files" + typing `report.txt` for a docx export gets a `.txt`-named file containing docx bytes — confusing OS shell association breakage.

**Suggested fix:** drop the `'All files'` second filter (force the user to keep the correct extension) OR validate the returned path against the format's expected extension and reject with `invalid_payload` if the extension mismatches.

### L-25.6 (LOW) — `Phase 6` `LayoutSettings` defaults are hardcoded in `layout-extract.ts`, ignoring the 4 settings keys

**Files:**

- `migrations/0006_phase6_export.sql` seeds 17 settings keys including `export.layout.lineEpsilonPt`, `export.layout.paragraphBreakRatio`, `export.layout.headingRatio`, `export.layout.columnGapPt`.
- `src/main/export/layout-extract.ts:400-408` hardcodes the same defaults in code.
- `src/main/export/export-bootstrap.ts:286-290` accepts `BootstrapExportOptions.layoutSettings` — but `src/main/index.ts` does NOT read from the settings repo and pass them in.

So a user who edits `export.layout.headingRatio = 1.5` via the settings modal (Phase 1 settings UI) gets ignored — the engine still uses 1.3. The DB row exists; the read path doesn't.

**Suggested fix:** in `src/main/index.ts` bootstrap, after settings init, read the four `export.layout.*` keys and pass `{ layoutSettings: { lineEpsilonPt: ..., ... } }` to `bootstrapExportEngine`. ~6 LOC.

### N-25.1 (NIT) — Permissive-stub: ZERO new instances this wave

Fifth wave in a row holding the Wave 13.5 ratchet. Required-on-interface (`ExportEngineDeps.writers` has all four REQUIRED; `ExportHandlerCommonDeps` requires `engine`) is the structural fix that keeps doing the job. Documented as positive trend.

### N-25.2 (NIT) — Sentinel-default discipline: ZERO new instances this wave

`LayoutRect = T | null` honored end-to-end. Grep `x: 0, y: 0, w: 0, h: 0` in `src/main/export/` returns ZERO matches. The stats counters (`paragraphsExtracted: 0`, etc.) initialized to 0 are NOT sentinel-defaults — they're running counters that increment from zero, which is the right starting value for "we haven't extracted any yet." Positive trend.

### N-25.3 (NIT) — Code-comment-contradiction: ZERO new instances this wave

`grep -rn 'as any\|@ts-ignore\|@ts-expect-error' src/main/export/writers/` → ZERO matches in production code. Three matches in `src/main/export/{export-engine,writers/writers}.test.ts` — all are the `(this as any).children = opts.children` pattern in test recorder libs, intentional to keep the recorder lightweight. NOT a Phase 5 H-21.1-style ratchet violation. Positive trend, fifth consecutive wave.

### N-25.4 (NIT) — Trust-floor honesty surface count: 3+ surfaces — meets ratchet

| Obligation                    | UI surfaces                                                                              | Three-location ratchet                                |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| #1 layout best-effort         | ExportModal Step 2 + Step 3 + ExportsPanel banner                                        | **3** ✓                                               |
| #2 borderless tables          | ExportModal Step 2 + Step 3 + ExportsPanel banner                                        | **3** ✓                                               |
| #3 XFA forms                  | ExportModal Step 2 + Step 3 + ExportsPanel banner                                        | **3** ✓                                               |
| #4 signed source intact       | ExportModal Step 2 + Step 3 + ExportsPanel banner + per-format-limitations IMAGE_BULLETS | **4** ✓                                               |
| #5 OCR fidelity (office only) | ExportModal Step 2 + Step 3 + ExportsPanel banner (DOCX/PPTX only — by design)           | **3** ✓ (per design — image format does not carry #5) |

All five obligations meet or exceed the three-location ratchet at the UI level (Wave 26 Nathan owns the docs locations to complete the four-location pattern). Positive trend.

### N-25.5 (NIT) — Stub-with-TODO: TWO instances flagged, both honest throws

`createProdSourceLoader` (5 throwing methods — M-25.4) and `uninstalledDocxLibrary` / `uninstalledPptxLibrary` (2 throwing composers) are the Wave 25 / Wave 24.1 follow-ups. They are NOT silent-default permissive stubs — they THROW with clear messages on first use, the handler maps to typed errors, and the user sees `extraction_failed` / `writer_failed`. Honest. The fifth-wave-ratchet anti-pattern is the SILENT default; this design is the explicit-failure design. Positive instance — matches the conventions §17.4 anti-stub structural fix.

## Mechanical audit grep results (per conventions §17.8)

| Check                                                     | Expected                                                                          | Actual                                                                                                                         | Status |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `as any` in writers                                       | ZERO                                                                              | ZERO in production; 4 matches in `*.test.ts` recorder shims (intentional)                                                      | ✓      |
| `@ts-ignore` in writers                                   | ZERO                                                                              | ZERO (the only hit is the file-header comment in `export-engine.ts`)                                                           | ✓      |
| Source-doc not mutated                                    | `doc\.save\|pdfLibDoc\.save\|PDFDocument\.save` in `src/main/export/`             | ZERO                                                                                                                           | ✓      |
| No `signature_audit_log` writes from export               | grep in `src/main/export/`                                                        | 1 hit, comment-only in file header                                                                                             | ✓      |
| No `edit_history` writes from export                      | grep in `src/main/export/`                                                        | 1 hit, comment-only in file header                                                                                             | ✓      |
| No `outputPath:` in renderer DTOs                         | grep in `src/client/types/`                                                       | ZERO matches                                                                                                                   | ✓      |
| Required-on-interface writer deps                         | `interface ExportEngineDeps` writers section                                      | all four REQUIRED (no `?`)                                                                                                     | ✓      |
| Single-funnel — only writer modules import format libs    | `grep -rn "from 'docx'" src/`                                                     | ZERO (libs injected via `DocxLibrary` interface; production uses `require('docx')` lazy-load)                                  | ✓      |
|                                                           | `grep -rn "from 'pptxgenjs'" src/`                                                | ZERO (same pattern)                                                                                                            | ✓      |
| exceljs WRITE side does not contaminate Phase 3 READ side | `grep -rn "exceljs" src/`                                                         | TWO files: `csv-excel-parser.ts` (Phase 3 read) + `export-bootstrap.ts` (Phase 6 write); no third                              | ✓      |
| Atomic write pattern                                      | `grep -rn '\.export-temp' src/main/export/`                                       | ONE match in `export-engine.ts`                                                                                                | ✓      |
| Cancel signal checked at three points per §8.3            | `grep -n 'signal\.aborted' src/main/export/export-engine.ts`                      | THREE matches                                                                                                                  | ✓      |
| Per-format limitations panel mounted in modal             | `grep -rn 'PerFormatLimitationsPanel' src/client/components/modals/export-modal/` | TWO mounts (Step 2 + Step 3)                                                                                                   | ✓      |
| Trust-floor obligations in conventions §17.3              | `grep -n 'trust.floor\|honesty' docs/conventions.md`                              | NON-ZERO matches                                                                                                               | ✓      |
| Settings keys seeded via INSERT OR IGNORE                 | `grep -A 2 'INSERT OR IGNORE INTO settings' migrations/0006_phase6_export.sql`    | 17 entries                                                                                                                     | ✓      |
| `LayoutRect` is nullable everywhere it appears            | manual scan                                                                       | every consumer pattern-matches on `null` (e.g. `if (p.rect === null) continue;` in pptx-writer; `images[0]!.rect!.x` in tests) | ✓      |
| Sentinel-zero rects                                       | `grep -n 'x: 0, y: 0, w: 0, h: 0' src/main/export/`                               | ZERO production matches                                                                                                        | ✓      |

All 16 conventions §17.8 + §9 (export-engine.md) mechanical checks pass.

## Schema v6 vs data-models.md §11 contract diff

| Element                         | Spec                                                                                                                | Migration                             | Drift? |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| `export_jobs` columns           | 18 columns                                                                                                          | 18 columns                            | None   |
| `export_jobs` CHECK constraints | format, quality_tier, status, include_annotations                                                                   | All present                           | None   |
| `export_jobs` indexes           | doc_hash, status, format                                                                                            | All three                             | None   |
| Nullable late-init columns      | completed_at, duration_ms, output_size_bytes, paragraphs_extracted, tables_detected, images_embedded, error_message | All NULL-able per spec                | None   |
| Format-conditional columns      | dpi (image), jpeg_quality (jpeg), multi_page_tiff (tiff)                                                            | All present                           | None   |
| 17 settings keys seeded         | per §11.6                                                                                                           | 17 INSERT OR IGNORE rows in migration | None   |
| Forward-only migration v6       | Required                                                                                                            | Present                               | None   |
| `INSERT INTO schema_migrations` | NOT in file (runner writes)                                                                                         | Absent                                | None   |

**Schema v6: zero drift from spec.** Ravi's migration matches verbatim.

## Vitest / Node 24 reproduction result

**David's claim:** 138 test files all fail with "No test suite found" due to vitest 1.6.1 + Node 24 incompatibility.

**My reproduction:** The shim at `node_modules/.bin/vitest` reports version `1.6.1`, but `node_modules/vitest/package.json` reports `2.1.9`. The actually-running binary is 2.x, and test discovery works correctly. Specific commands I ran:

```
$ npx vitest run src/main/export → 5/5 file passes (52/52 tests, post-fix)
$ npx vitest run src/db          → 9/9 file passes (339/339 tests) on a fresh process
$ npx vitest run src/ipc         → 40/40 file passes (275/275 tests)
$ npx vitest run src/client/state src/main/export src/client/components/modals/export-modal
                                 → 28/28 file passes (353/353 tests)
$ npx vitest run                 → 125/138 file passes; 13 file fails (344 tests) — driven
                                   by better-sqlite3.node compiled for NODE_MODULE_VERSION=123
                                   (Node 22), running on Node 24's required 137. Native
                                   module rebuild needed.
```

So the actual repo state at audit time:

1. The "no test suite found" symptom David hit is no longer reproducible — likely an env-state artifact (he was running before some npm install or rebuild settled the version mismatch between the shim and the package).
2. The Phase 6 tests themselves are 353/353 PASS post-fix.
3. The `better-sqlite3` native ABI mismatch is a separate Node 24 issue — needs `npm rebuild better-sqlite3` against Node 24. Diego's Wave 25 brief already plans for the vitest bump + node version pin; that bump should also re-rebuild native deps.

**Diego's Wave 25 Objective 3 (vitest 1.6 → 2.x) is partially DONE** (package is at 2.1.9), but the .bin shim hasn't been refreshed and `package-lock.json` still references the old vitest. The followup is: `npm i -D vitest@^2.1.9 --legacy-peer-deps` to settle the lockfile + `.bin` shim, plus `npm rebuild better-sqlite3` for Node 24, plus pinning `.nvmrc`.

## Findings by severity (counts)

| Severity  | Count  | IDs                                            |
| --------- | ------ | ---------------------------------------------- |
| BLOCKER   | 0      | —                                              |
| HIGH      | 2      | H-25.1, H-25.2                                 |
| MEDIUM    | 6      | M-25.1, M-25.2, M-25.3, M-25.4, M-25.5, M-25.6 |
| LOW       | 6      | L-25.1, L-25.2, L-25.3, L-25.4, L-25.5, L-25.6 |
| NIT       | 5      | N-25.1, N-25.2, N-25.3, N-25.4, N-25.5         |
| **TOTAL** | **19** |                                                |

For comparison: Wave 21 Phase 5 review = 1 BLOCKER + 2 HIGH + 7 MEDIUM + 6 LOW + 4 NIT. Phase 6 has zero BLOCKERs (Wave 21's was a packaging-input gap; Wave 25 has none of that class — Diego's Wave 25 owns deps install + native rebuild as routine packaging work).

## Remediations applied this wave

I fixed three findings directly:

1. **H-25.2 (test failure #1)** — `src/main/export/image-extract.test.ts:89-127`. Rewrote the `respects save/restore` test so the second image post-restore has a non-identity transform (`scale 60 × translate (10,10)`), producing a rect that's both ABOVE the `MIN_AREA_PT2 = 16` threshold AND clearly different from the pre-restore CTM. The new assertions verify CTM reset honestly (`imgs[1]!.rect!.x === 10` rather than the original `=== 0` that wouldn't survive the area filter).

2. **H-25.2 (test failure #2)** — `src/main/export/writers/writers.test.ts:441-449`. Rewrote the `layout-preserving converts paragraph rects` expectations to multiply by the documented `sx = SLIDE_W_IN / pageWIn` scale factor (and added a Y-flip check verifying PDF-bottom-up → PPTX-top-down conversion at the same time). The pre-fix test was math-wrong; the implementation matches the design.

3. **M-25.2 (obligation-id mis-labels)** — `src/client/components/modals/export-modal/per-format-limitations.ts:21-44, 75-93`. Added `'annotations'` and `'bundle'` to the `LimitationBullet.obligationId` union; re-labelled the image-format help-text bullets so they no longer falsely claim to cover trust-floor obligation #5. Added an explanatory comment block on the union to keep the contract honest for future audit waves.

Verification: `npx vitest run src/main/export src/client/components/modals/export-modal/per-format-limitations` post-fix → **73/73 PASS**, including all three modified tests.

The remaining 16 findings are either Wave 25 Diego carry-over (M-25.4 source-loader wire), Wave 26 Nathan carry-over (the docs trust-floor surfacing — Riley already met the UI ratchet), Phase 6.1 follow-up (L-25.2 / L-25.3 / L-25.4 / L-25.5 / L-25.6 / M-25.5 / M-25.6), or repo-wide cross-cuts (M-25.1 same-pattern-as-M-21.3 / M-25.3 message-leak Phase 1 H-3).

## Wave 26 dispatch verdict

**GREEN — Wave 26 (Nathan Phase 6 docs) UNBLOCKED.**

Phase 6 has no BLOCKER. The two HIGHs are: H-25.1 architectural-doc-vs-code drift about queue (Marcus's call between "implement the queue" or "amend the doc"); H-25.2 was test-side and is now fixed. Six MEDIUM findings are all manageable follow-ups across Wave 25 Diego (M-25.4 source loader) + Phase 6.1 (M-25.1/M-25.5/M-25.6) + repo-wide (M-25.3).

**Nathan's brief should reflect:**

- **The truthful Phase 6 ship state:** xlsx LIVE end-to-end via exceljs; docx and pptx are LIVE-engine pending Diego's `npm install docx pptxgenjs` + LICENSES.md walk (Wave 25); image formats are LIVE-engine pending Diego's source-loader wiring in `createProdSourceLoader`. The trust-floor obligations all hit the three-location UI ratchet; Nathan owns the docs-side completion (preamble + dedicated section + inline at every export subsection + README front-door — four-location ratchet total).
- **H-25.1 queue ambiguity is doc-vs-code; the user-facing impact is documented honestly in Nathan's user-guide.** Either "Export to Office runs ONE job at a time" or "Export to Office runs up to 50 jobs in parallel" should match the eventual fix Marcus picks.
- **M-25.4 source-loader stub:** Nathan's user-guide should NOT claim "Export to Word works" until Diego wires the source loader. Until then, only Excel export ACTUALLY runs end-to-end (because exceljs is already in deps and the xlsx writer doesn't depend on the source loader for table-only paths — wait, it does, for `getOperatorList` + `getTextContent`). Actually NO format runs end-to-end until the loader is wired. Nathan documents Phase 6 as "engine + UI live; full production cut-over in v0.6.1 once the source loader is wired" with the same honesty discipline used for Phase 5 OCR's `eng`-only bundled story.

**Carry-overs for Phase 6.1:**

- H-25.1 — implement `ExportQueue` per `architecture-phase-6.md §4.6` (or amend the doc; Marcus picks).
- M-25.1 — tighten `ExportHandlerCommonDeps.exportJobsRepo: ExportJobsRepoBridge` (drop `| null` fallback once `src/main/index.ts` wires Ravi's repo).
- M-25.3 — `safeMessage(e, fallback)` helper in `shared/result.ts`; sweep across 12+ handler files (Phase 1 H-3 long-standing follow-up).
- M-25.4 — Diego or Wave 24.1 David wires `createProdSourceLoader` to pdf.js's real API + the line-segment converter.
- M-25.5 — amend `export-engine.md §3.6` ImageExtractor type to match sync impl (or vice versa).
- M-25.6 — add `tableLineSegmentsFromOpList` converter in `export-bootstrap.ts`.
- L-25.1 — implement R-W23-F same-path modal warning (depends on H-25.1).
- L-25.2 — flip mask grayscale to alpha (`(255,255,255,g)`).
- L-25.3 — preserve leading zeros in `coerceCellValue`.
- L-25.4 — disambiguate `safeSheetName` collisions.
- L-25.5 — drop `'All files'` second filter in save dialog OR validate extension match.
- L-25.6 — wire `export.layout.*` settings keys into bootstrap.

**No L-001 weakening.** Phase 6 adds three new modals + sidebar tab + status-bar widget, all pure renderer overlays. `enableDragDropFiles: true` on the BrowserWindow is untouched.

**No L-002 weakening.** L-002 is Diego's Wave 25 responsibility for the v0.6.0 packaging shot.

## Self-correction notes

- I started by reading David's vitest-discovery RCA and treating it as ground truth. When I tried to reproduce, I found vitest 2.1.9 is actually installed; the shim disagrees but the binary runs fine. **First-instinct verification ran two minutes; would have saved real debugging time if everyone re-runs RCAs from a fresh shell before they hit code review.** Documented for the Wave 26 brief.
- Surprised that ImageExtractor.extract is sync in implementation but Promise-typed in spec (M-25.5). The audit checklist in `export-engine.md §9` didn't include "type-vs-impl signature drift" as a check; consider adding it for Wave 26 brief. Phase 6.1 candidate ratchet.
- Phase 6 is the FIFTH consecutive wave to hold the five-ratchet pattern (sentinel-default + permissive-stub + no-as-any + code-comment-contradiction + stub-shipped-with-TODO). The structural fixes (required-on-interface DI + nullable late-init + injection over imports + throwing-not-silent stubs) are what's keeping it; conventions §17 codified them well. Recording as positive trend in learnings. No new ratchet candidate emerges this wave — the existing five are sufficient.
- The H-25.1 queue issue is the kind of architectural-spec-vs-impl drift I last flagged in Wave 17 (cert-handle-released-before-sign seam) but lower severity. The pattern is: the design doc specifies a load-bearing structural mechanism, then implementation skips it because the surrounding tests pass with the mechanism absent. Trust the spec's load-bearing claims OR amend the spec; don't ship the silent gap.

---

# Code Review — Wave 29 (2026-05-28) — Phase 7 Polish & Cross-Platform (FINAL roadmap-phase review)

**Reviewer:** Julian (Director of Code Quality & Security Audit)
**Scope:** All Phase 7 implementation from Wave 28a (David: auto-update + telemetry + i18n IPC; Ravi: schema v7; Riley: a11y R-1..R-10) and Wave 28b (Riley: i18n big-bang + Settings/telemetry/About UI). Reviewed in full: the entire telemetry path (`src/client/telemetry/**`, `src/main/telemetry.ts`, `src/ipc/handlers/telemetry-*.ts`), the auto-update path (`src/main/auto-update.ts`, `src/ipc/handlers/update-*.ts`), the i18n framework (`src/client/i18n/**`), the Phase-7 UI (`general-tab.tsx`, `about-modal`, `update-status-area`, `telemetry-debug-panel`, `settings-modal`, `sidebar`), the locale JSON (en-US + es-ES, all 8 namespaces), `migrations/0007_phase7_polish.sql`, and `.eslintrc.cjs`.
**Tooling this wave (runtime-verified, NOT static-only):** ran the Phase-7 vitest suites (105 tests in 10 files PASS + 24 UI component tests PASS); ran `eslint src/client` with `jsx-a11y/aria-proptypes` forced to `error`; confirmed Diego has installed `i18next@26.3.0`, `react-i18next@17.0.8`, `electron-updater@6.8.3`, `eslint-plugin-jsx-a11y@6.10.2`; performed the mandated visual review against `release/wave28a-a11y-launch-shot.png` + `release/wave28a-a11y-sidebar-tabs.png`.
**Findings:** 0 BLOCKER, 1 HIGH, 3 MEDIUM, 4 LOW, 2 NIT

---

## Verdict

**GREEN** — Wave 30 (Nathan final docs) is UNBLOCKED and the 7-phase roadmap can be declared **implementation-complete**, modulo the documented backlog (Phase 5.1 native scanner, Phase 6.2 image-text glyph, Phase 7 28c deep-modal i18n) and the single HIGH below, which is **latent** (unreachable while the publish target is a placeholder) and is a Phase-7.1 close item, not a Phase-7 ship blocker.

The two headline audits — **telemetry privacy** and **trust-floor honesty** — both PASS unconditionally and are the strongest-built surfaces in the whole project. The `.strict()` zod guard is a true structural PII barrier (test-proven: userId/filePath/docTitle/sub-day-timestamp all rejected); opt-in is default OFF with a silent no-op gate that does not even buffer; nothing in the telemetry path touches network or disk; no PII fields, no phone-home SDK, no payload logging anywhere. The six trust-floor obligations are present in the HONEST form (conventions §18.2) and contain ZERO of the four forbidden FALSE-as-stated sentences, in both en-US and es-ES.

---

## Top-3 must-close

1. **H-29.1 (HIGH, latent) — `quitAndInstall` has NO unsaved-work gate.** `use-update-actions.ts:install()` calls `api.update.install` directly and the controller schedules `autoUpdater.quitAndInstall()` with no check of document dirty state. A user with unsaved edits who clicks "Restart and install" loses work. **Latent in Phase 7** because the install button only renders in `status === 'downloaded'`, which is unreachable while the publish target is a placeholder (`update_not_configured` short-circuits every call). Becomes a real data-loss bug the moment Phase 7.1 configures a real channel. Architecture §3.4 step 7 documents the flow but omits the gate. Close before Phase 7.1.
2. **M-29.1 (MEDIUM) — `jsx-a11y/aria-proptypes` still at `warn` in `.eslintrc.cjs:131`.** P7-L-4 / conventions §18.3.1 acceptance criterion requires it RESTORED to `error`. I verified the flip is CLEAN (ran eslint with the rule forced to `error` → 0 `aria-proptypes` violations across the whole renderer). Diego owns `.eslintrc.cjs` and is in this parallel wave — one-line change. Until flipped, the ratchet that prevents the Phase-1 tab-semantics regression is not actually armed.
3. **L-29.1 (LOW) — `UpdateStatusArea` has no dedicated test file.** It is the load-bearing trust-floor UI for the `not-configured` honesty notice (obligations #2 + #6) — the single highest-stakes honesty placement — yet has only transitive coverage via `about-modal.test.tsx`. Add a focused test asserting the `not-configured` branch renders the placeholder notice and never a fake "up to date".

---

## CRITICAL audit verdicts

### Telemetry privacy — PASS (the headline)

| Check                                                                     | Verdict  | Evidence                                                                                                                                                                               |
| ------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.strict()` zod STRUCTURALLY rejects any field beyond `{name, dayBucket}` | **PASS** | `telemetry-record-event.ts:34-39`; `telemetry-record-event.test.ts:40-100` proves userId/filePath/docTitle/sub-day-timestamp/malformed-bucket all → `invalid_payload`                  |
| Opt-in default OFF; silent no-op when OFF (does not even buffer)          | **PASS** | migration seeds `telemetry.optIn = 'false'`; `telemetry.ts:163-167` returns `not_opted_in` BEFORE any buffer touch; renderer hook `use-telemetry.ts:30` hard-gates                     |
| No PII anywhere; counts-only, day-bucketed                                | **PASS** | event shape is `{name, dayBucket}` only; grep for `filePath\|docTitle\|userId\|content` in `src/client/telemetry/**` → ZERO real hits; 16-event allowlist (closed union + runtime Set) |
| No network transport; nothing leaves the machine                          | **PASS** | grep `fetch\|http\|net\|socket\|sendBeacon\|XMLHttpRequest` in `telemetry.ts` + `src/client/telemetry/**` → ZERO; transport is in-memory bounded ring buffer only                      |
| No event-payload logging                                                  | **PASS** | grep `console\|log.(info\|debug\|warn\|error)` in `telemetry-record-event.ts` → ZERO; handler comment explicitly logs nothing about the payload                                        |
| dayBucket anti-fingerprint (sub-day rejected)                             | **PASS** | regex `/^\d{4}-\d{2}-\d{2}$/`; test rejects `2026-05-27T13:45:22.123Z`                                                                                                                 |
| No third-party phone-home SDK                                             | **PASS** | grep `@sentry\|google-analytics\|posthog\|mixpanel\|amplitude` in `src/` → ZERO real hits (only a negative-assertion test)                                                             |
| Buffer cleared on opt-out + on quit; never persisted to SQLite            | **PASS** | `telemetry.ts:178-188` clears on opt-out; migration comment forbids a `telemetry_events` table; Ravi correctly added NONE                                                              |

### Auto-update safety — PASS

| Check                                                                                    | Verdict          | Evidence                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Placeholder returns honest `update_not_configured`, NEVER a fake "up to date"            | **PASS**         | `auto-update.ts:204-214`; `auto-update.test.ts:109-141`; UI `update-status-area.tsx:50-53` renders the explicit placeholder notice     |
| Signature verification surfaces `signature_verification_failed` (not disabled)           | **PASS**         | `auto-update.ts:277-282`; `auto-update.test.ts:246-257`; David did NOT disable electron-updater's verification                         |
| No auto-download; default check-on-launch OFF                                            | **PASS**         | `autoDownload = false` always (`auto-update.ts:171`, test 195-204); `update.channel` seeds `'manual'`; renderer gates `launch` trigger |
| `quitAndInstall` returns ok before quitting (renderer never observes success after exit) | **PASS**         | `auto-update.ts:307` schedules on next tick; test 325-340                                                                              |
| `quitAndInstall` doesn't lose unsaved work                                               | **GAP → H-29.1** | no dirty-document gate; latent because unreachable with placeholder                                                                    |

### Trust-floor honesty (SIXTH instance) — PASS

- The four forbidden FALSE-as-stated sentences ("auto-updates from GitHub" / "available in Spanish" / "collects analytics" / "cross-platform Windows/Mac/Linux"): grep across `src/client/i18n/locales/**` AND `src/client/**/*.tsx` → **ZERO**.
- All six HONEST obligation forms present in `trustfloor.json` (telemetry-off-by-default, update-placeholder, mac/linux-UNVERIFIED, proof-locale-sample, a11y-audited-with-gaps, code-signing-cert-is-user-step) — verbatim aligned with conventions §18.2 honest pairs.
- The three load-bearing UI placements verified live in code: Settings → Privacy telemetry copy (always-visible `<p>`, NOT a tooltip, `aria-describedby`-linked — `general-tab.tsx:170-174`); Settings → Language sample subtext (shown when `!descriptor.complete` — `general-tab.tsx:147-154`); About / Settings-About update-status notice (`update-status-area.tsx` `not-configured` branch, `aria-live="assertive"`).
- es-ES honesty copy is FULLY translated (correct — the privacy/legal notices must be honest in Spanish too); es-ES does NOT claim to be complete.

---

## a11y verification — PASS

- **Tab patterns:** sidebar (5 tabs, vertical) + settings (5 tabs, horizontal) both use `role="tablist"/"tab"/"tabpanel"`, single `aria-selected`, roving tabindex via the shared `useTablistKeys` hook, arrow-key + Home/End nav, `aria-controls`/`aria-labelledby` wired. The Phase-1 ARIA-tab debt is properly repaid (R-1, R-2).
- **Accessible names:** verified on the new Phase-7 controls (telemetry toggle, locale picker, update radios, debug-panel buttons) — all `t()`-keyed. Riley's 30/30 toolbar claim is consistent with the launch-shot (all buttons rendered).
- **Modal focus-trap:** `ModalShell` uses the shared `useFocusTrap` hook (R-8) + Escape + focus-restore + `role="dialog"`/`alertdialog` + `aria-modal`. All new Phase-7 modals route through it.
- **No positive tabindex:** grep `tabIndex={[1-9]` → ZERO.
- **`aria-label` strings go through `t()`** (conventions §18.4.9): verified.
- **ESLint at `aria-proptypes: error`:** runs CLEAN (0 violations) — the flip is safe; tracked as M-29.1 for Diego to commit.

**Visual review (mandated for UI-touching wave):** confirmed against `release/wave28a-a11y-launch-shot.png` (full menu strip + 30-button toolbar + empty-state "Open a PDF to get started" + status bar "Ready"; no i18n key leakage on first paint) and `release/wave28a-a11y-sidebar-tabs.png` (5-tab tablist with a visible `:focus-visible` ring on the active tab — confirms focus-visible is not suppressed). Renderer is in the expected state. NOTE: a dedicated screenshot of the Settings/About honesty copy would harden the sign-off — recommended for Diego's v0.7.0 L-002 packaging shot (tracked L-29.2). **Regression-coverage anti-pattern does NOT apply:** every Phase-7 UI surface has a component test (settings-phase7 7, about-modal, telemetry-debug-panel, sidebar — 24 tests total PASS).

---

## i18n completeness + integrity — PASS (with documented 28c gap)

- **fallbackLng: 'en-US'** confirmed (`index.ts:60`) + `returnEmptyString: false` + `returnNull: false` → a missing es-ES key renders English, never a raw `ns:key`. The pure `resolve.ts` core implements identical fallback semantics and `coverage.test.ts` proves EVERY one of the 482 en-US keys resolves to a non-raw string in es-ES (the structural defense against the half-extracted-mix problem).
- **Typed keys:** `i18next.d.ts` augments `CustomTypeOptions.resources` from the en-US JSON → `t()` keys are compile-checked; a missing key is a compile error, not a runtime raw key.
- **No `as any` / `@ts-ignore` on the `t()` surface:** grep `src/client/i18n` → ZERO. The two `as any` casts in the settings tabs (`general-tab.tsx:93`, `settings-modal/index.tsx:111`) are on `api.settings.set` (the pre-existing comment-justified generic-key pattern), explicitly NOT t() casts — conventions §18.4.4 compliant.
- **Counts (runtime-measured):** en-US 482 keys / 8 namespaces; es-ES 70% (339/482). Matches Riley's reported figures.
- **No hardcoded user-facing strings** in the high-traffic surfaces (menu, toolbar, sidebar, common modals, Settings, About) — all via `t()`.

### The 28c gap — severity LOW (M-29.2)

The 28c residue is the deep Phase-4..6 modal-STEP bodies (e.g. multi-step OCR-invalidate confirm step prose, signature-capture sub-step instructions) not yet extracted to `t()`. **Severity assessment: LOW-to-MEDIUM, not a roadmap blocker.** Rationale: (1) the high-traffic + first-paint + honesty surfaces ARE fully extracted, so the proof locale never renders a confusing English/Spanish mix on the surfaces a user hits first; (2) the residue is deep edge-case modal steps a user reaches only mid-workflow; (3) any unextracted string is still valid English (no broken UI), it simply won't translate. Document it as the Phase-7.1 i18n-completion backlog item (Nathan, Wave 30 README known-limitations). Filed as M-29.2 so the scope is on record.

---

## Six-ratchet compliance — PASS (sixth consecutive wave)

| Ratchet                                | Verdict                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sentinel-defaults                      | **PASS** — `availableVersion`/`lastCheckedAt`/`lastEventAt` all nullable + late-init; migration seeds `update.lastCheckedAt = null` (NOT 0); test asserts `availableVersion` null not `''`                                                                                                        |
| Permissive-test-stubs                  | **PASS** — telemetry/update services injected via required DI; tests mock at the boundary, not the SUT                                                                                                                                                                                            |
| Stub-with-TODO                         | **PASS** — the two placeholders (NoOpRingBufferTransport, update publish target) are HONEST + complete, not silent-success stubs; transport interface field is REQUIRED (no optional+fallback); grep `TODO\|FIXME` in telemetry/update paths → ZERO                                               |
| Code-comment-contradiction             | **PASS** — re-read the comments-vs-code on the telemetry `.strict()` guard, the silent-no-op gate, and the `update_not_configured` path; code achieves what the comments claim (the Wave-21 H-21.1 lesson applied — verified the `.strict()` actually rejects, the no-op actually short-circuits) |
| Layout-best-effort-claims              | **PASS** — no overstated layout claims; visual review confirms rendered state                                                                                                                                                                                                                     |
| `as any` on t()/telemetry/update paths | **PASS** — ZERO on t(); ZERO on telemetry; ZERO on auto-update controller                                                                                                                                                                                                                         |

This is the SIXTH consecutive wave holding the ratchet pattern. No new ratchet candidate emerges.

---

## Schema v7 vs spec — PASS

`migrations/0007_phase7_polish.sql` is settings-keys-only: four `INSERT OR IGNORE INTO app_settings` rows (`telemetry.optIn='false'`, `i18n.locale='"en-US"'`, `update.channel='"manual"'`, `update.lastCheckedAt='null'`). NO CREATE TABLE, NO ALTER, NO new column, NO index. Ravi correctly added NO `telemetry_events` table — a table would VIOLATE the in-memory privacy design, and the migration carries an explicit comment forbidding a future maintainer from "helpfully" adding one. Matches data-models §12 + architecture §9.

---

## All findings (Wave 29)

### H-29.1 (HIGH, latent) — `quitAndInstall` has no unsaved-work gate

**File:** `src/client/hooks/use-update-actions.ts:56-60` + `src/main/auto-update.ts:286-312`
`install(version)` fires `api.update.install` and the controller schedules `autoUpdater.quitAndInstall()` on the next tick with no check of document dirty state (`selectIsDirty`). A user with unsaved edits who clicks "Restart and install" loses work without a prompt. **Latent in Phase 7** (the `downloaded` status that renders the install button is unreachable while the publish target is a placeholder — every call short-circuits to `update_not_configured`). Architecture §3.4 step 7 documents the flow but omits the gate. **Fix (Phase 7.1):** before dispatching install, check `selectIsDirty`; if dirty, route through `ConfirmCloseUnsavedModal` (Save commits then installs / Discard then installs / Cancel). NOT fixed this wave — out of the placeholder's reachable surface; tracked as the Phase-7.1 close item.

### M-29.1 (MEDIUM) — `jsx-a11y/aria-proptypes` not restored to `error`

**File:** `.eslintrc.cjs:131` (Diego-owned)
P7-L-4 / conventions §18.3.1 acceptance criterion. Verified the flip is clean (eslint with the rule at `error` → 0 violations). Diego (parallel this wave) flips one line. Not fixed by me (file ownership: Diego).

### M-29.2 (MEDIUM) — 28c deep-modal-step i18n residue

**Scope:** deep Phase-4..6 modal-step bodies not yet `t()`-extracted. Not a blocker (high-traffic + first-paint + honesty surfaces are complete; residue is valid English). Document as the Phase-7.1 i18n-completion backlog (Nathan Wave 30 README). See the i18n section above for the full severity rationale.

### M-29.3 (MEDIUM) — `update.channel` persists via `api.settings.set as any` but is not in the typed SettingKey union surface used by the renderer

**File:** `src/client/components/modals/settings-modal/general-tab.tsx:90-93`
The cast is comment-justified and matches the pre-existing settings-modal pattern, but `update.channel`/`telemetry.optIn`/`i18n.locale` would benefit from being added to the typed `SettingKey` union so future call sites don't need the cast. DOCUMENT-only; the runtime behavior is correct (the key/value pair matches). Phase-7.1 polish.

### L-29.1 (LOW) — `UpdateStatusArea` lacks a dedicated test

The highest-stakes honesty UI has only transitive coverage. Add a test pinning the `not-configured` branch. See Top-3.

### L-29.2 (LOW) — no Settings/About honesty-copy screenshot

Visual review used the a11y launch + sidebar shots. A screenshot of the Settings → Privacy telemetry copy + the About update placeholder notice would harden the honesty sign-off. Recommend Diego capture it in the v0.7.0 L-002 packaging drill.

### L-29.3 (LOW) — renderer `TelemetryEvent` carries `count: 1` but the IPC `recordEvent` request drops it

**File:** `telemetry-transport.ts:21-25` vs `telemetry-record-event.ts:34-39`
Harmless (count is always 1; the renderer mirror keeps it, the IPC/main buffer omits it). Cosmetic inconsistency between the two `TelemetryEvent`/`TelemetryBufferEntry` shapes. DOCUMENT-only.

### L-29.4 (LOW) — `act(...)` warnings in `settings-phase7.test.tsx`

Async effects in SettingsModal fire state updates outside `act()`. Tests PASS; it's test-hygiene noise. Wrap the async-effect-triggering renders in `act()` / `waitFor` when convenient.

### N-29.1 (NIT) — `general-tab.tsx` channel radio labels are good but the "Automatically on launch" copy could note the placeholder caveat inline

The placeholder note is already shown below the group (`updates.placeholderNote`), so this is purely optional.

### N-29.2 (NIT) — `toDayBucket` exists in BOTH `telemetry-events.ts` (renderer) and is conceptually mirrored by the main handler's regex

No drift risk (the regex validates what `toDayBucket` produces), but a shared `shared/` helper would be marginally DRY-er. Not worth a cross-process module for one function.

---

## L-001 enforcement check (last verification per phase-7-plan acceptance criteria)

**PASS.** grep `enableDragDropFiles` in `src/main/window-manager.ts` → not set to `false` (relies on the Electron `true` default). Phase 7 introduced no new file-picker channels or drag-drop entry points; the lock is untouched. This is the final roadmap-phase verification of L-001.

---

## Self-improvement notes (Wave 29)

- **The structural-PII-guard pattern is the strongest privacy design I've audited in this project.** `.strict()` zod + a transport interface with physically no PII field + a silent no-op gate that returns BEFORE buffering = three independent structural barriers, each test-pinned. This is the right shape for any "anonymous telemetry" feature anywhere: make the absence of PII a type/schema property, not a discipline. Promoting to global JSONL.
- **The honest-placeholder-vs-silent-stub distinction held perfectly.** Both Phase-7 placeholders (NoOpRingBufferTransport, update publish target) return loud honest signals (`update_not_configured`) rather than fake success. The Wave-18 stub-with-TODO lesson is now structurally prevented, not just remembered.
- **Latent-but-real finding (H-29.1):** the unsaved-work install gate is unreachable today (placeholder) but a genuine data-loss bug the moment a channel is configured. The audit discipline: when a path is gated-off by config, still audit it as if live and tag it as the un-gating wave's close item — don't let "unreachable today" mask "data-loss tomorrow."
- Sixth consecutive ratchet-clean wave. The roadmap is implementation-complete.

---

# Backlog-Fix Wave Code Review — Julian (2026-05-28)

**Reviewer:** Julian (Director of Code Quality & Security Audit)
**Scope:** The three-agent Backlog-Fix wave (parallel with Diego's v0.7.1 repack). David: (1) Phase 6.2 image-export standard-font glyph fix (`src/main/export/pdfjs-source.ts` + `export-bootstrap.ts` + `prod-render.test.ts` + `pdfjs-source.test.ts`); (2) H-29.1 quitAndInstall unsaved-work gate (`auto-update.ts` + `update-install.ts` + `contracts.ts`); (3) B-21.1 OCR catalog real SHA-256 (`language-pack-catalog.json` + `language-pack-catalog.test.ts`). Riley: (1) Phase 7 28c deep-modal i18n (482→816 keys); (2) annotation-layer a11y; (3) wired David's quitAndInstall renderer dialog (`update-status-area/index.tsx` + `use-update-actions.ts`). Diego: better-sqlite3 Node-24 ABI guard + husky (L-003 ratified) — toolchain only, no `src/**`.
**Tooling this wave (runtime-verified, NOT static-only):** ran `vitest run src/main/export` (132 PASS incl. the REAL `@napi-rs/canvas` `prod-render` glyph regression — NOT skipped), `src/main src/ipc src/preload` (830 PASS), `src/client/i18n` + `update-handlers` (71 PASS), full `src/client` (585 PASS / 5 pre-existing brittle fail — Riley's baseline reproduced exactly); `tsc` clean on all 3 tsconfigs; `eslint` 0/0 on every changed file; validated all 10 catalog SHAs are real distinct 64-hex via node:crypto-free format check; measured i18n key counts (816 en / 558 es, 0 dup, 0 orphan, 0 empty value).
**Findings:** 0 BLOCKER, 1 HIGH (FIXED by me), 0 MEDIUM, 3 LOW, 1 NIT

---

## Verdict

**GREEN** — all five backlog fixes correctly close their findings; **v0.7.1 can ship.** One residual HIGH (H-FIX.1, the renderer half of the unsaved-work gate was dead code in production) was found AND **fixed directly by me this wave**, so the gate is now closed end-to-end rather than papered over. The David↔Diego font-path packaged-binary seam — the highest-risk item — is **verified aligned** (no dev-works/packaged-breaks mismatch).

---

## Did each of the 5 fixes close its finding?

### 1. H-29.1 quitAndInstall unsaved-work gate — CLOSED end-to-end (after my H-FIX.1)

The **main-side gate is correct and fully test-proven.** `auto-update.ts:289-330` orders the unsaved check AFTER the configured + version-match guards (more fundamental) and BEFORE the irreversible `scheduleInstall` (the quit). The condition `req.confirmedDiscardUnsaved !== true && (deps.hasUnsavedWork?.() ?? false)` refuses on unsaved+unconfirmed (`unsaved_work_blocks_install`, NO quit), and proceeds on confirmed OR no-unsaved-work. `auto-update.test.ts:358-405` pins all five branches (unsaved+no-confirm → blocks + install NOT called; unsaved+confirm → proceeds; no-unsaved → proceeds; omitted dep → no-op; version-mismatch/not-configured still win). Contract shapes match across the seam (`contracts.ts:2612` `confirmedDiscardUnsaved?: boolean` + `:2622` `unsaved_work_blocks_install`; handler `update-install.ts:25` validates `z.boolean().optional()` + `exactOptionalPropertyTypes`-safe conditional spread; renderer hook maps to `{kind:'blocked-unsaved'}`). **This half is exemplary.**

**HOWEVER — H-FIX.1 (HIGH, FOUND + FIXED this wave):** The gate was **not wired end-to-end and the renderer dialog was dead code in production.** Production `index.ts:369` sets `hasUnsavedWork: () => false` (renderer-owned dirty state, mirroring `app:quit`'s `register.ts:547` `hasUnsavedChanges: () => false`). So the main gate's blocking branch **never fires in production** — every `install(version)` returns `quitting` straight through to the quit, regardless of dirty state. Riley's renderer (`update-status-area/index.tsx:onInstall`) relied SOLELY on the main gate returning `blocked-unsaved` to open the confirm dialog — but since the main probe is always `false`, that branch is unreachable. **Net production reality (before my fix): a user with unsaved work who clicks "Restart and install" still loses work without a prompt — the confirm dialog never appears.** This is the SAME latent-but-real class as the original H-29.1, shifted one layer: the infrastructure is correct and tested, but the runtime trigger is not connected to the actual dirty signal. Latent today (same placeholder publish target gates the `downloaded` status), but a real data-loss bug the moment Phase 7.1 configures a channel — exactly what H-29.1 existed to prevent.

**Fix I applied** (`update-status-area/index.tsx`): the renderer now gates on its OWN authoritative dirty signal (`selectIsDirty`, which it already has store access to) BEFORE calling `install` — if dirty, it opens the Save/Discard/Cancel confirm dialog directly; the main gate stays as defense-in-depth. I also hardened `onSaveThenInstall` to re-read FRESH dirty state from the store after the save thunk (which returns `void` and silently swallows a cancelled Save-As dialog) and re-open the confirm rather than install over a still-dirty doc — fail-safe: never install over unsaved work. Verified: `tsc` + `eslint` clean; full `src/client` back to the 585/5 baseline (the 3 about-modal + 1 settings-phase7 tests that my `selectIsDirty` dependency initially broke — their test stores omitted the `document` slice — were repaired by adding `documentReducer` to those two test stores, a harness-completeness fix that mirrors the real `RootState`).

### 2. Phase 6.2 image-export glyph fix — CLOSED. **David↔Diego font-path seam VERIFIED (critical).**

The regression test genuinely catches blank text: `prod-render.test.ts` `it.each(['Helvetica','TimesRoman','Courier'])` renders a 36pt run and asserts `blankDark < 20`, `textDark > 200`, `textDark > blankDark + 200`. The old `.some(b => b !== 0)` (which passes on an all-white blank page) is explicitly retired. The unit pin `pdfjs-source.test.ts:294` asserts the `['getOperatorList','render']` call order (font-readiness gate) even when the native canvas binding is absent. **I ran the suite: the REAL `@napi-rs/canvas` `prod-render` test executed (NOT skipped) and PASSED** — the strongest possible signal that the standard-14 fonts actually rasterize in this environment.

**The David↔Diego packaged-binary seam is aligned — NO mismatch:**

- David's `resolveExportFontData()` (`export-bootstrap.ts:525-545`) resolves the pdfjs-dist root via `require.resolve('pdfjs-dist/package.json')` → `dirname` → joins `standard_fonts` + `cmaps`. The NEW `makeNodeDataFactory(absDir)` reads bytes via `fs.readFile(join(absDir, filename))` from that SAME absolute dir (sidestepping the `file://`-string-vs-`fs.readFile` ambiguity that was the root cause).
- Diego's `electron-builder.yml:138-140` unpacks EXACTLY `node_modules/pdfjs-dist/package.json` + `standard_fonts/**/*` + `cmaps/**/*`, with a comment block (lines 125-136) explicitly documenting WHY `package.json` must be unpacked: so Electron's asar shim redirects `require.resolve('pdfjs-dist/package.json')` to the `.unpacked` root, making the sibling `standard_fonts`/`cmaps` real files. This is precisely the resolution David's code depends on. **The two halves are mutually consistent.** No LOUD flag for Diego needed — the repack config already matches.

**One LOW (L-FIX.1):** `prod-render.test.ts`'s `realDeps()` reimplements `makeNodeDataFactory` locally rather than importing production's `resolveExportFontData`/`makeNodeDataFactory`. So the test proves the _technique_ works against the real package layout but does NOT exercise the production code path — they could drift. A belt-and-suspenders test that calls the real `resolveExportFontData()` would harden the seam.

### 3. B-21.1 OCR catalog real SHA-256 — CLOSED

All 10 SHAs are real, distinct, lowercase 64-hex with positive `sizeBytes` (validated programmatically: 0 sentinels, 0 `TBD`/`FILL`/`PLACEHOLDER`, 0 dups, 9 downloadable + 1 bundled). `language-pack-catalog.test.ts` (6 tests) pins no-sentinel + 64-hex + positive-size + the bundled `eng` hash + ≥8 distinct downloadable. The mismatch-rejection contract still holds: `language-pack-manager.test.ts:241` (wrong SHA → `pack_integrity_failed`) + `:260-278` (matching SHA → accept). The `eng`-bundled-vs-downloadable provenance distinction (npm artifact 10.9MB vs CDN 1.98MB) is documented honestly in the JSON `_note`. I did not verify each SHA against the network (out of scope) but the format + rejection guard are sound.

### 4. Phase 7 28c i18n — CLOSED

Measured: en-US **816 keys** (482 + 334, matches Riley), es-ES **558 (68%)**, **0 duplicate en keys** (no collision with the 482 baseline), **0 orphan es keys** (no es key absent from en), **0 empty values** in either locale (so fallback never renders blank). `coverage.test.ts` proves every en key resolves to a non-raw es string (fallbackLng='en-US'); `extraction-regression.test.ts` SWEPT_28C group (45 tests) asserts no literal aria-label/title/placeholder survives + each component consumes `useT`. aria-labels are `t()`-wrapped. No raw key leak path exists.

### 5. annotation-layer a11y — CLOSED (honestly)

The drawing surface now has `role="application"` + a `t()`-routed `aria-label` (`layerLabel`, idle vs tool-active variants) that NAMES the keyboard alternative (toolbar + Inspector). The original `no-static-element-interactions` disable is REMOVED (the element is no longer a nameless static div). The remaining single scoped `no-noninteractive-element-interactions` disable is a **genuine jsx-a11y taxonomy false-positive**: jsx-a11y classifies the WAI-ARIA `application` role as non-interactive, but per spec `application` IS the correct role for a custom pointer-interaction widget. The documented keyboard alternative is honest — highlight/text/sticky/shape annotations remain keyboard-operable via toolbar + Inspector; only arbitrary freehand strokes are pointer-only (correctly deferred to Phase 7.2). `extraction-regression.test.ts:122-133` source-pins `role="application"` + `aria-label={layerLabel}` + no leftover no-static disable + `t()`-routing. Not a real a11y gap.

---

## Ratchet compliance — PASS (seventh consecutive wave)

| Ratchet                                               | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| permissive-stubs                                      | **PASS** — no new no-op stubs; the catalog placeholders are now real data                                                                                                                                                                                                                                                                                                                                                                                            |
| sentinel-defaults                                     | **PASS** — catalog SHAs are real (the B-21.1 sentinel ELIMINATED); grep for sentinels in all changed files → ZERO                                                                                                                                                                                                                                                                                                                                                    |
| stub-with-TODO                                        | **PASS** — grep `TODO\|FIXME\|TBD\|HACK\|XXX` in every changed file → ZERO                                                                                                                                                                                                                                                                                                                                                                                           |
| code-comment-contradictions                           | **PASS** — re-verified the gate comments vs code (gate ordering, `?? false` default, factory reads abs dir not URL); comments match behavior. The Wave-21 H-21.1 lesson applied.                                                                                                                                                                                                                                                                                     |
| layout-best-effort-claims                             | **PASS** — no overstated claims                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| structural-PII-guard                                  | **PASS** — untouched this wave                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `as any` / runtime-require / new sentinel introduced? | **PASS** — ZERO new `as any` (the `as typeof NodePath`/`NodeUrl` casts are typed-namespace casts via type-only imports, the documented Wave-30 consistent-type-imports pattern, NOT `as any`); the new `require('node:path')`/`require('node:url')` are Node built-ins (always external, never Vite-bundled) following the EXACT existing idiom in `export-bootstrap.ts`; `pdfjs-dist` stays behind the indirect dynamic-import dodge — no vite-bundling regression. |

Seventh consecutive ratchet-clean wave. No new ratchet candidate emerges.

---

## All findings (Backlog-Fix wave)

### H-FIX.1 (HIGH, FIXED by me) — unsaved-work install gate was not wired end-to-end; renderer confirm dialog was dead code in production

**File:** `src/client/components/update-status-area/index.tsx` (fixed). Main `hasUnsavedWork: () => false` (`index.ts:369`) means the main gate's `unsaved_work_blocks_install` branch never fires in production, so Riley's renderer dialog (gated solely on `outcome.kind === 'blocked-unsaved'`) was unreachable → a dirty doc would still be discarded on "Restart and install" without a prompt. **Fix:** renderer now gates on its OWN `selectIsDirty` before calling `install` (opens the confirm dialog directly when dirty); `onSaveThenInstall` re-reads fresh store dirty state after the save thunk and re-opens the confirm if the save was cancelled (fail-safe). Main gate retained as defense-in-depth. Repaired 2 test stores (about-modal, settings-phase7) to include the `document` slice the shared `UpdateStatusArea` now reads. Verified: 585/5 baseline restored, tsc + eslint clean.

### L-FIX.1 (LOW) — `prod-render.test.ts` reimplements the font-factory rather than importing production's `resolveExportFontData`

The real-canvas glyph regression proves the technique but not the production code path; they could drift. Add a test that calls the real `resolveExportFontData()` to pin the seam directly. DOCUMENT-only.

### L-FIX.2 (LOW) — the unsaved-work install confirm dialog (`UpdateStatusArea` `role="alertdialog"`) has NO component test

The data-loss-prevention UI is untested at the renderer level (the main gate IS test-covered; only the dialog wiring is not). This is the regression-coverage anti-pattern: a PR changing rendered output (the confirm dialog) without a component/visual test. Add an RTL test: dirty doc → click "Restart and install" → assert the alertdialog appears with Save/Discard/Cancel → "Discard and install" retries `install(version, true)`; "Save and install" runs the save thunk first. (Carries forward L-29.1's note that `UpdateStatusArea` has no dedicated test.)

### L-FIX.3 (LOW) — the inline install `role="alertdialog"` lacks `aria-modal` + focus management

The confirm dialog is an inline div with `role="alertdialog"` + `aria-label` (accessible name present) but is not routed through `ModalShell`/`useFocusTrap`, so it has no focus trap or focus-restore of its own. Acceptable because it renders inside the About modal (which already traps focus), but a keyboard user could tab out of the confirm into the parent. Consider `aria-modal="true"` + moving focus to the safe-default ("Save and install") button on open. DOCUMENT-only.

### N-FIX.1 (NIT) — no visual verification captured this wave

Neither Riley nor I could capture an operator/Playwright screenshot (operator MCP absent from the subagent surface; dev port in use). The UI changes (extracted modals, annotation-layer accessible name, the install-confirm dialog, my H-FIX.1 rewire) are proven only via jsdom render tests. Per L-002, Diego's v0.7.1 repack MUST capture the packaged-binary screenshot; recommend it also exercise the Settings → About install-confirm path so the H-FIX.1 fix gets pixel confirmation. (Carries forward L-29.2.)

---

## Self-improvement notes (Backlog-Fix wave)

- **Latent-gate fixes can themselves be latent.** H-29.1's main-side gate was textbook-correct and fully test-proven, yet the END-TO-END behavior was still broken because the runtime trigger (`hasUnsavedWork`) was hardwired to `false` and the renderer relied on it. The audit discipline that caught it: don't stop at "the gate refuses when told there's unsaved work" — trace whether anything in production ever TELLS it there's unsaved work. A test-green gate wired to a constant-false probe is the same data-loss bug, one layer down. When dirty/auth/permission state is "renderer-owned" and the main probe is defensive-false, the RENDERER must drive the check against its own authoritative signal; the main gate is defense-in-depth, never the live trigger.
- **The David↔Diego asset-path seam held because BOTH sides documented the contract in their own files.** David's `resolveExportFontData` comment cites the asarUnpack dependency; Diego's `electron-builder.yml` comment cites David's `require.resolve` line-by-line. Cross-agent seam where each side names the other's load-bearing line is the pattern that prevents the L-002 dev-works/packaged-breaks class. Promote: when two agents share a packaged-binary path contract, EACH file must comment the other's exact resolution mechanism.
- **Adding a cross-slice selector to a shared component breaks partial test stores.** My `selectIsDirty` dependency in the shared `UpdateStatusArea` broke 4 tests whose stores omitted the `document` slice. Lesson: when a widely-rendered shared component gains a new slice dependency, grep for every test store that mounts it and confirm the slice is present — or the new dependency cascades failures into unrelated test files.

---

# Full-Project Cleanliness + Performance Audit — Julian (2026-06-01)

**Reviewer:** Julian (Director of Code Quality & Security Audit)
**Scope:** Entire shipped codebase post-Phase-7, v0.7.5 live. 449 `.ts`/`.tsx` files, 55,605 LOC of non-test code. Marcus dispatched as the audit pass to find + fix anything stale, dead, redundant, leaky, or impeding performance.
**Files reviewed:** Every non-test file >200 LOC in full; representative spot-check of components, slices, tests. Mechanical greps for the structural-ratchet patterns across all of `src/`.
**Tooling exercised:** `node scripts/rebuild-native-for-node.mjs` (L-003), `npm run lint` (clean), `npx vitest run` (1809 PASS), `tsc --noEmit` on `tsconfig.{main,renderer,test}.json` (clean).
**Findings:** 0 BLOCKER, 2 HIGH, 6 MEDIUM, 10 LOW, 4 NIT — fewer NEW issues than any prior wave; the ratchet pattern is holding.
**Fixes applied this wave:** 23 source files + 1 new test file (commits `7ffa8f9` + `cbaf315`), all in `src/{ipc,main,shared}` — none in `src/client` (Riley owns + had in-flight zoom-to-cursor + help-modal work; collision avoided per orchestrator brief).

---

## Verdict

**GREEN** — v0.7.5 is shippable as-is, and the audit closed 17 distinct error-message-leak surfaces structurally (one `safeMessage` helper + 16 handler imports + 1 unit-test file). One genuine bug (H-30.1, the Combine feature never wired past the Phase-1 stub) is flagged for orchestration follow-up; it is NOT a regression — it has been latent in this state since Wave 2 and the help-modal/UI affordances still expose the button. Code quality is the strongest I have measured on this codebase: ZERO new `as any` casts outside the documented exception set, ZERO TODO/FIXME stubs in production code paths (only the documented honest stubs), ZERO permissive-stub anti-patterns, ZERO sentinel defaults, ZERO code-comment-contradictions. Eighth consecutive wave holding the six-ratchet pattern.

---

## Top-3

1. **H-30.1 (HIGH, FLAG only — not in this audit's fix scope) — `pdf:combine` is still the Phase-1 `not_implemented` stub.** `src/ipc/handlers/pdf-ops.ts:24-43` returns `not_implemented` for every call. The renderer (`combinePdfsThunk` → `combine-modal/index.tsx`) actively dispatches it on user click — clicking "Combine" surfaces "Combine failed: Phase 1 stub: combine engine ships in Wave 2 follow-up" in a toast. Walking-skeleton milestone #6 ("Combine multiple PDFs into one") is non-functional in production. The help modal (`help-content.ts:161`) and user-guide describe combine as a working feature. This is the SAME class as H-3 from Wave 2 (which was about Save) — a renderer-visible affordance whose backing handler is a stub. **NOT FIXED by me** — requires a real engine implementation (pdf-lib-based; David's `src/main/pdf-ops/combine.ts` never landed) + a `app:pickPdfPath` channel for the file picker. Scope ~150 LOC + tests; out of audit-pass mandate.

2. **H-30.2 (HIGH, FIXED) — IPC handler catch blocks leaked raw `Error.message` into production user toasts (Hard-Won Playbook #4 surface).** 16 handlers across `src/ipc/handlers/` returned `fail<E>('...', (e as Error).message)` — paths like `ENOENT: no such file or directory, open 'C:\Users\<name>\<file>.pdf'`, SQLite UNIQUE-constraint internals, pdf-lib parser internal class names. Toast strings shown to users. **FIXED in commits `7ffa8f9` + `cbaf315`** — introduced `safeMessage(e, fallback)` helper in `src/shared/result.ts` (production → fallback, dev/test → raw message) + applied across all 16 handlers + 10 unit tests pinning the production-leak prevention. Both tsconfigs typecheck clean; full suite 1809/1809 PASS.

3. **M-30.1 (MEDIUM) — `pdf:getOutline` is dead code.** `handlePdfGetOutline` in `pdf-ops.ts:68-76` returns `not_implemented`. Grep across `src/client/**` shows ZERO call sites that reach it (the only renderer reference is `api.ts:70 getOutline: unavailable` — the bridge-unavailable fallback). The contract type, the preload bridge entry, the handler stub, and the channel registration in `register.ts:507` all exist for no caller. Either implement (bookmarks panel could surface document outlines) or remove from the contract + preload. **Not fixed by me** — removing is a coordinated cross-process change; flag for orchestration.

---

## Findings (Wave 30 — audit pass)

### H-30.1 — `pdf:combine` returns `not_implemented` in production

**File:** `src/ipc/handlers/pdf-ops.ts:24-43`
The handler validates inputs (good — `invalid_source`, `invalid_page_range`) then returns `'not_implemented'`. The renderer's `combinePdfsThunk` (`src/client/state/thunks.ts:329`) dispatches against the live channel; the Combine modal's "Combine" button (`src/client/components/modals/combine-modal/index.tsx:97`) calls the thunk. User experience: click Combine -> see "Combine failed: Phase 1 stub ..." toast. Help-modal documentation (`help-content.ts:161`) and user-guide describe Combine as a working feature. Fix scope: implement `src/main/pdf-ops/combine.ts` with pdf-lib's `PDFDocument.copyPages` + a path-only file-picker IPC for the modal's "+ Add file" affordance. Phase-2 backlog never closed. **FLAGGED — David follow-up.**

### H-30.2 — Error-message leak in IPC handler catches (FIXED)

Closed end-to-end this wave. See Top-3 + commits `7ffa8f9` and `cbaf315`. The structural fix (`safeMessage` helper) is the production-leak prevention; the 16 handler call-sites are the surface coverage. New unit-test file `src/shared/result.test.ts` (10 tests) pins:

- production -> fallback (the leak-prevention assertion)
- dev/test -> raw message (the debug-friendliness assertion)
- non-Error throws -> fallback (defensive)
- unset NODE_ENV -> treat as non-production
- cross-process safe (helper uses `(globalThis as any).process?.env` so the renderer tsconfig — which lacks `@types/node` — still compiles).

### M-30.1 — `pdf:getOutline` is dead code

See Top-3. **FLAGGED — David follow-up.**

### M-30.2 — `pdf-apply-edit-ops.ts` ships `tempPath` in `details` on disk_full failure

**File:** `src/ipc/handlers/pdf-apply-edit-ops.ts:127-132`
The `safeMessage` wrap closes the leak in the user-facing `message` field, but the `details: { tempPath }` field still ships an absolute path. The temp path is by design a subdirectory of the user's output choice — they already authored that path via dialog — so the leak is minor. DOCUMENT-only.

### M-30.3 — `recents:list` does N synchronous `existsSync()` calls per invocation

**File:** `src/ipc/handlers/recents-list.ts:29` + wiring `src/ipc/register.ts:472`
`rows.map((r) => ({ ...r, fileStillExists: deps.fileExists(r.path) }))` calls `fileExists` (which is `existsSync`) for every row. Default limit is 20; cap is 200. At cap the main event loop blocks for ~200 synchronous stat syscalls. Realistic usage stays at 20 — acceptable today, but the cap is a footgun. Switch to async `fsPromises.access` with `Promise.all` if a future surface raises the typical N. DOCUMENT-only.

### M-30.4 — Three large client modals lack the `// >200 lines:` rationale comment per conventions §3.4

**Files:** `src/client/components/menu-bar/index.tsx` (427 LOC), `src/client/components/toolbar/index.tsx` (424 LOC), `src/client/components/modals/image-import-modal/index.tsx` (417 LOC), `src/client/components/modals/mail-merge-modal/index.tsx` (674 LOC — has rationale; OK).
Three of the four lack the convention-required top-of-file comment justifying their length. The justification IS obvious (single-component-per-file rule + each is a coherent UI surface), but the rationale-at-top is what makes the audit pass mechanical. **FLAGGED — Riley follow-up** (do NOT touch src/client this wave per orchestrator brief).

### M-30.5 — `screenRectToPdf` and `screenPointToPdf` still use cosmetically different y-flip algebra (carries forward from Wave 2 LOW)

**File:** `src/client/services/pdf-coords.ts:69 vs 87`
Algebraically equivalent (`page.height = viewport.height * sy`), but cosmetically inconsistent forms. Add a one-line lemma comment proving equivalence, or unify the form. **FLAGGED — Riley follow-up.**

### M-30.6 — Stale Phase-1 comment block in `src/main/index.ts` (FIXED)

The "PHASE 1 NOTES" block at lines 24-35 claimed DB bridge was an in-memory fallback (it IS wired), file-association registration was a stub awaiting Wave 3 (NSIS install-time + runtime IPC stub are the shipped state), and auto-updater was explicitly not wired (it IS wired in Phase 7). **FIXED in commit `7ffa8f9`** — rewrote the comment block to reflect current implementation. Also closed the stale TODO in `src/main/db-bridge.ts:8` and rewrote `src/ipc/handlers/app.ts`'s file-association comment to honestly describe the install-time/runtime split.

### L-30.1 — `handleAppSetDefaultPdfHandler` and `handleAppGetDefaultPdfHandlerStatus` remain honest stubs (FIXED comments only)

The HANDLERS were already honest (return `not_implemented` + the renderer surfaces it visibly in Settings -> General). The file-header COMMENT claimed "lands before Wave 3 packaging" which is stale (we are post-Phase-7). **Comments fixed in commit `7ffa8f9`**; the handler behavior is correct as-is. NSIS handles install-time .pdf association; the runtime toggle is intentionally not implemented and the renderer says so honestly.

### L-30.2 — `src/ipc/handlers/pdf-ops.ts:46-54` stub `handlePdfExport` is still in the module

The Phase-1 stub was retained when the real handler moved to `pdf-export-pdf.ts`. `register.ts` wires the real handler, so the stub is unreachable in production — but it ships in the bundle and creates a small dead-code surface. Future-reader trap: someone could re-wire it accidentally. Remove or guard with a `throw new Error('do not call directly')`. DOCUMENT-only.

### L-30.3 — `dialog-open-pdf.ts` and `fs-read-pdf.ts` still call `computeFileHash(path)` AFTER `readFile(path)` (carries forward from Wave 2)

Two file opens for one read. Pass the already-read bytes to a `computeBufferHash` instead — saves one syscall per open. The functions exist; just plumb them. DOCUMENT-only — micro-optimization, not load-bearing.

### L-30.4 — `path-sanitizer.ts` still doesn't reject Windows UNC paths or device namespaces

Carries forward from Wave 2. The Phase-1 risk model (renderer never originates raw paths outside OS dialogs) holds — but `tests/fixtures/path-vectors.json` (Wave-2 LOW recommendation) was never created. The risk is theoretical; a future feature that accepts paths from a non-dialog source (e.g. CLI / URI scheme handler) would inherit this gap. DOCUMENT-only.

### L-30.5 — `src/db/test-support.ts` still ships in the production directory

Carries forward from Wave 2. Diego's electron-vite externals config excludes it from the bundle (`grep test-support dist/main` returns nothing), so the runtime cost is zero — but the file lives in `src/db/` instead of `tests/support/`. DOCUMENT-only.

### L-30.6 — `src/ipc/handlers/dialog-save-as.ts:40` still uses the simple `/[\\/]/` separator-only regex

Carries forward from Wave 2 MEDIUM (the upgrade to reject reserved Windows device names + control chars). Sanitizer downstream rejects on the second pass, so impact is "user types `CON.pdf` in the save dialog -> main rejects on the resolved path." Cosmetic, not security. DOCUMENT-only.

### L-30.7 — `register.ts:961` `as any` cast on `getDbBridge().settings.get('export.maxQueueSize')`

Documented + comment-justified pattern: the setting key isn't in the typed `SettingKey` union yet. The cast is contained + the fallback is a sensible default (50). Add to the `SettingKey` union at next opportunity. DOCUMENT-only.

### L-30.8 — `src/client/state/thunks-phase6.test.ts` has 22 `as any` casts

Test mocks for the Phase 6 export thunks — necessary for stubbing `api.dialog.pickExportOutputPath` and progress emitters. Test-file `as any` is excluded from the ratchet by convention, but this is the highest count in any file. Could be reduced by typing the mock shapes explicitly. DOCUMENT-only.

### L-30.9 — `src/main/pdf-ops/document-store.ts` has no LRU / eviction on `docs` Map

Single-document mode (Phase 2 decision P2-L-2) keeps it bounded at 1; no eviction needed today. Multi-document (Phase 5+) would need LRU. The accessors (`getOpenDocCount`, `getTotalBytesHeld`) are there. DOCUMENT-only — Phase 5+ backlog.

### L-30.10 — `src/client/components/modals/combine-modal/index.tsx:50-65` still produces placeholder entries

Carries forward from Wave 2. The "+ Add file" button creates empty entries `{ kind: 'path', path: '' }` that fail validation only on Combine submit. **FLAGGED — Riley follow-up** (disable the button with a tooltip OR wire the path-only IPC channel from H-30.1).

### N-30.1 — `src/main/db-bridge.ts:470` `(out as any)[k] = v`

Same heterogeneous-key map pattern flagged in Wave 2. Acceptable. DOCUMENT-only.

### N-30.2 — `src/main/index.ts` ipcMain import only used to pass to `registerIpcHandlers`

Same NIT as Wave 2. Explicit DI is fine — keep. DOCUMENT-only.

### N-30.3 — `src/client/state/slices/ui-slice.ts:62` still uses `Date.now() + Math.random()` for toast id

Same NIT as Wave 2. `crypto.randomUUID()` is exposed in the renderer; could switch. DOCUMENT-only.

### N-30.4 — File-length audit summary

Five files >500 LOC in non-test code:

| File                                | LOC  | Has rationale?                                   |
| ----------------------------------- | ---- | ------------------------------------------------ |
| `src/ipc/contracts.ts`              | 3101 | Yes — pure types, central contract               |
| `src/main/db-bridge.ts`             | 1960 | Yes — single audit surface for snake-camel       |
| `src/client/state/thunks.ts`        | 1119 | Yes — `// >200 lines: ...` at top                |
| `src/main/pdf-ops/replay-engine.ts` | 1101 | Yes — implementation per `edit-replay-engine.md` |
| `src/ipc/register.ts`               | 1068 | Yes — single IPC wiring file                     |
| `src/main/pdf-ops/form-engine.ts`   | 1019 | Yes — `form-engine.md` impl                      |

All justified. NIT only — note the Phase-6 export-jobs-repo (769 LOC) and signature-audit-repo (666 LOC) lack `// >200 lines:` headers but are documented in `data-models.md`. Convention §3.4 is "consider modularizing" — these are coherent single-concern files.

---

## Six-ratchet compliance — PASS (eighth consecutive wave)

| Ratchet                    | Verdict  | Evidence                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permissive test stubs      | **PASS** | The `sanitizePath: (raw: unknown) => (typeof raw === 'string' ? raw : null)` pattern in 4 test files is the INJECTED-DEP shape, not a security-validation passthrough. The real sanitizer is unit-tested separately at `path-sanitizer.test.ts`. The handler's contract trusts `deps.sanitizePath` — that's the DI seam, not a permissive stub. |
| Sentinel defaults          | **PASS** | Grep for sentinels (`lastCheckedAt: 0`, `availableVersion: ''`, `dims: {0,0}`) in `src/main/**` -> ZERO real hits. `update.lastCheckedAt` defaults to `null` not `0`; LayoutRect is `T \| null`; PageModel dims default to Letter (612x792) which is a real-world default, not a sentinel.                                                      |
| Stub-with-TODO             | **PASS** | Two intentional, honest, externally-visible stubs remain: `pdf:combine` (H-30.1, flagged) and `app:set/getDefaultPdfHandler` (L-30.1, comment-fixed). Both return `not_implemented` — loud honest signal, not silent success. Zero `TODO/FIXME/XXX/HACK` strings in production code paths beyond the documented anti-pattern references.        |
| Code-comment-contradiction | **PASS** | Re-read every `safeMessage` site I touched — comments + behavior match (production -> fallback; dev -> raw). The fixed stale-comment blocks in `main/index.ts` + `db-bridge.ts` now match the wired reality.                                                                                                                                    |
| Layout-best-effort-claims  | **PASS** | The four `best-effort` strings in `src/client/i18n/locales/**` are all on the SAME side as the docs: OCR text is best-effort; Office/image exports are lossy. No overstated layout claims. The `// Writability probe — best-effort` comment in `export-shared.ts:135` is honest about what it does (it's not a guarantee).                      |
| Structural-PII-guard       | **PASS** | Untouched this wave. `telemetry-record-event.ts:34-39`'s `.strict()` zod still rejects every PII field; `NoOpRingBufferTransport` still has no network transport; opt-in remains default OFF with silent no-op.                                                                                                                                 |

Eighth consecutive ratchet-clean wave. No new ratchet candidate emerges. The seven ratchets (the six above + the `as any` discipline) are sufficient for this codebase's risk surface.

---

## L-001 / L-002 / L-003 enforcement

- **L-001 PASS:** `grep enableDragDropFiles src/main/window-manager.ts` -> no override. The default-`true` behavior is preserved. Wave-30 audit changed NO file in `src/main/window-manager.ts`.
- **L-002 PASS:** Not directly applicable to a code-cleanliness audit — no packaged binary launched. v0.7.5's launch screenshot (`release/wave-v075-icon-verified.png`) cited by Diego covers the lock.
- **L-003 PASS:** Audit ran `node scripts/rebuild-native-for-node.mjs` before `vitest` per the locked Node-24 workflow. Tests green; the rebuild script's warning about `--electron before packaging` is informational (no packaging this wave).

---

## Performance audit — clean

| Surface                      | Verdict   | Evidence                                                                                                                                                                                                                                                  |
| ---------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event listeners (renderer)   | **CLEAN** | 28 `addEventListener` calls across 8 files; every one has a paired `removeEventListener` in the same `useEffect` cleanup or component-unmount path. Grep paired.                                                                                          |
| Document-store memory (main) | **CLEAN** | Single-document mode (Phase 2 P2-L-2). `release()` drops Map entry on `fs:closePdf`; bytes GC'd. No eviction needed at N=1.                                                                                                                               |
| Telemetry ring buffer        | **CLEAN** | `NoOpRingBufferTransport` capacity 500; oldest evicted on overflow. Cleared on opt-out + on quit. Never persisted.                                                                                                                                        |
| Cert-store cleanup           | **CLEAN** | `releaseAll()` registered on `app.before-quit` (`register.ts:715`). Zero-on-finally pattern preserved (cert-store.ts §15 disciplines).                                                                                                                    |
| OCR worker pool              | **CLEAN** | `pool.releaseAll()` registered on `app.before-quit` AND `process.exit` (`register.ts:800-808`). Worker-termination errors swallowed (best-effort cleanup).                                                                                                |
| Redux selectors              | **CLEAN** | `document-parameterized-selectors.ts` retains the Wave-3.5 H-2 memoization fix; `selectAnnotationsForPage(state, idx)` is a parameterized memoized selector, not a factory. Convention §6.3 still pinned.                                                 |
| Bundle size / lazy loading   | **CLEAN** | i18n locales lazy-loaded; pdf.worker bundled correctly; native deps registered in electron-vite externals (per the pattern documented in Wave-21 RCA).                                                                                                    |
| Wheel-handler hot path       | **CLEAN** | Riley's zoom-to-cursor work in `pdf-viewer/index.tsx:82` uses `{ passive: false }` for ctrl-zoom intercept; no extra Redux dispatch per wheel tick.                                                                                                       |
| IPC handler startup cost     | **CLEAN** | All bootstrap handlers register synchronously in `register.ts`; heavy work (OCR worker pool, export engine, auto-updater) is wired via DI from `main/index.ts` with the heavy `electron-updater` dep loaded via `loadElectronUpdaterModule` on first use. |
| Synchronous I/O on hot paths | **WARN**  | `recents-list.ts:29` does N synchronous `existsSync` calls (M-30.3 above). Default N=20 is fine; cap N=200 is borderline.                                                                                                                                 |

---

## Cleanliness audit summary

- **TODOs in production code paths:** 1 (`db-bridge.ts:8` — FIXED). Other matches are either (a) anti-pattern references in comments (e.g. `"anti-stub-shipped-with-TODO discipline"`) or (b) intentional anti-pattern sentinels in test code (`SENTINEL = /TBD|FILL/i` in language-pack-catalog.test.ts).
- **Dead code / unused exports:** `handlePdfGetOutline` (M-30.1, flagged); `handlePdfExport` stub in `pdf-ops.ts` (L-30.2, documented). No orphaned helper modules detected.
- **Stale Phase-N comments:** 3 FIXED this wave (main/index.ts PHASE 1 NOTES, db-bridge.ts TODO, app.ts file-assoc comment). Two LOW remain (combine modal "Phase 2 wires app:pickPdfPath" — bounces to Riley's H-30.1 work; help-modal text describing combine — bounces to Nathan after H-30.1 closes).
- **200-line modularization rule:** Three files >400 LOC in `src/client/components/` lack top-of-file rationale (M-30.4). All others comply.

---

## Files changed (this wave)

**Commit `7ffa8f9`:**

- NEW: `src/shared/result.test.ts` (10 tests for safeMessage)
- MODIFIED: `src/shared/result.ts` (+safeMessage helper + docstring)
- MODIFIED: 16 IPC handlers (safeMessage import + apply at catch sites): `dialog-open-pdf.ts`, `dialog-save-as.ts`, `fs-read-pdf.ts`, `fs-write-pdf.ts`, `bookmarks.ts`, `bookmarks-phase2.ts`, `settings.ts`, `recents-add.ts`, `recents-clear.ts`, `recents-list.ts`, `forms-list-templates.ts`, `forms-load-template.ts`, `forms-save-template.ts`, `forms-design-add.ts`, `i18n-set-locale.ts`, `telemetry-set-opt-in.ts`, `pdf-apply-edit-ops.ts`, `pdf-identify-text-span.ts`, `app.ts`
- MODIFIED: `src/main/index.ts` (stale PHASE 1 NOTES block rewritten)
- MODIFIED: `src/main/db-bridge.ts` (stale Wave 2 TODO rewritten)

**Commit `cbaf315`:**

- MODIFIED: `src/shared/result.ts` — cross-process safe NODE_ENV read (renderer tsconfig has no `@types/node`, so the bare `process.env` reference broke the pre-push typecheck; wrapped in `(globalThis as any).process?.env`).

Total: 24 files changed, 267 insertions, 80 deletions. Lint clean, both tsconfigs typecheck clean, full suite 1809/1809 PASS.

---

## Follow-ups for orchestration (not in this audit's fix scope)

- **H-30.1 — Combine engine:** David implements `src/main/pdf-ops/combine.ts` + a `app:pickPdfPath` channel; Riley wires the modal's "+ Add file" affordance; Nathan amends help-modal/user-guide if scope narrows.
- **M-30.1 — getOutline dead code:** David removes the contract type + preload bridge entry + handler stub OR implements outline parsing via pdf-lib (bookmarks panel could surface document outlines).
- **M-30.4 — Riley adds `// >200 lines:` rationale headers** to `menu-bar/index.tsx`, `toolbar/index.tsx`, `image-import-modal/index.tsx`.
- **M-30.5 — Riley unifies the y-flip algebra in `pdf-coords.ts`** OR adds a one-line lemma comment proving equivalence.
- **L-30.10 — Riley disables the Combine modal's "+ Add file" placeholder button** until H-30.1 lands (or wires the new channel).

---

## Self-improvement notes (Wave 30 audit)

- **The `safeMessage` ratchet is the right shape — a single helper + a single grep** (`(e as Error)\.message`) **for surface coverage.** Earlier waves caught individual handlers piecemeal; structurally codifying the production-leak prevention at the helper level means future handlers either USE the helper (and inherit production-safe behavior) or violate the structural rule (which a future eval can grep for).
- **Renderer tsconfig is the tighter typing surface.** My initial `process.env['NODE_ENV']` was fine in main but broke the renderer typecheck — `src/shared/**` is on both include paths, so anything in `shared/` MUST compile under the renderer tsconfig's stricter `vite/client`-only type universe. The `(globalThis as any).process?.env` indirection is the cross-process pattern. Adding to global JSONL.
- **The "honest stub" pattern continues to be load-bearing.** `pdf:combine`, `pdf:getOutline`, and `app:set/getDefaultPdfHandler` all return `not_implemented` (loud, visible, surfaced) rather than silent no-op success. That is what made H-30.1 + M-30.1 visible to grep + audit; a silent-success stub would have been invisible.
- **The eighth consecutive ratchet-clean wave is statistical evidence that the structural-fix-not-discipline rule works.** Wave 13.5's permissive-stub catch produced the ratchet; eight waves later, no new variant has emerged. The pattern is mature.

---

## Phase 5.2 wave — review (Julian, 2026-06-04)

Three items closed in this wave (Marcus's brief): per-page words restore on reopen (Item A), standard-font factories on the OCR rasterizer (Item B), rotation handling in `OcrConfidenceOverlay` (Item C). Six commits between `808938f` (plan appendix) and `364b6e5` (Riley overlay rotation).

### Verdict — GO

Typecheck clean across all three tsconfigs (main / preload / renderer). Full vitest suite **1921 / 1921 PASS** (179 test files). +13 net new tests across the three items. No new locked-instructions violations.

### Top-3 (no blockers)

1. **Item A's contract-first sequencing was textbook.** David published the channel + type names in commit `944e1ce` before the bridge + handler landed in `f0715f8`. The parallel dispatch from Marcus's brief is correctly serialized at the contract module — the only file all three implementers would have touched.
2. **Item B's static-import fix-up caught a documented failure mode in real-time.** The first draft used a runtime `require('../export/export-bootstrap.js')`, which would have reproduced the 2026-05-27 vite tree-shake / ENOENT-at-launch RCA. Marcus correctly switched to a static `import` before commit — same static-import pattern the existing `main/index.ts:65` block documents. Net: zero new latent packaging defects.
3. **Item B's regression test is conservative-but-effective.** `ocr-bootstrap.font-rasterize.test.ts` asserts dark-pixel count > 50 on a Helvetica-glyph PDF. Without the font-factory wiring this count is essentially zero. The floor is generous enough to avoid flakiness from anti-aliasing quirks across machines.

### Findings (Phase 5.2)

| ID      | Severity | Location                                  | Note                                                                                                                                                                                                                                                                                                                                       | Status |
| ------- | -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| L-5.2.1 | LOW      | `db-bridge.ts:937-1027`                   | The new `assemblePageResultsFromRows` + `safeParseWordsJson` helpers live in the same file as the `OcrResultsRepoBridge` interface, which is the right home. Shape validation in `safeParseWordsJson` is intentionally permissive (no confidence-range or rect-bounds re-check) because the engine validated on insert. Documented inline. | OPEN   |
| L-5.2.2 | LOW      | `ocr-bootstrap.ts:330-331`                | Two `as unknown as OcrPdfJsDataFactory` casts bridge `PdfJsDataFactory` (in `export/pdfjs-source.ts`) to the structurally-identical `OcrPdfJsDataFactory` defined locally for OCR. A future refactor could lift the type to a shared module; until then the cast is correct and the comment block explains the relationship.               | OPEN   |
| L-5.2.3 | LOW      | `ocr-confidence-overlay/index.tsx:75-108` | `projectRectToCss` is now exported from the overlay's `index.tsx` so the rotation-math test can verify the algebra without rendering through React. Single-consumer co-location, no module split. Acceptable.                                                                                                                              | OPEN   |
| I-5.2.1 | INFO     | `ocr-bootstrap.ts:362-380`                | The FONT-READINESS GATE (`page.getOperatorList()` before `page.render()`) is wrapped in `try/catch` that swallows pre-warm errors. Same trade-off as the export rasterizer's gate. Documented inline.                                                                                                                                      | INFO   |
| I-5.2.2 | INFO     | `thunks-phase5.ts:262-296`                | The thunk's two-step (`listJobs` then `listResultsByJob`) is sequential not parallel because the second call needs the resolved `jobId`. A `Promise.all` optimization isn't possible without restructuring the data model. Acceptable.                                                                                                     | INFO   |
| I-5.2.3 | INFO     | `ocr-list-results-by-job.ts:54-58`        | The "repo null" path returns `ok({ pageResults: [] })` rather than a typed error. Matches the existing `ocr-list-jobs.ts:94-96` precedent for early-boot / memory-bridge fallback. Consistent.                                                                                                                                             | INFO   |

### Production-call-site checklist (per Diego's v0.7.17 Vault note)

Acceptance gate from the brief: every new export must have a production call site, not just unit tests.

| New export                                                   | Production call site                                                                             | Verified        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------- |
| `OcrListResultsByJob` channel constant                       | `src/ipc/register.ts:961-966` registers the handler against `getDbBridge().ocrJobs / ocrResults` | yes             |
| `OcrApi.listResultsByJob` preload bridge                     | `src/preload/index.ts:385-389` wires `ipcRenderer.invoke(Channels.OcrListResultsByJob, ...)`     | yes             |
| `apiOcr.listResultsByJob` (api.ts)                           | `src/client/state/thunks-phase5.ts:265-274` (loadOcrResultsThunk chain)                          | yes             |
| `OcrResultsRepoBridge.listPageResultsByJobId`                | `src/ipc/handlers/ocr-list-results-by-job.ts:71` calls it                                        | yes             |
| `resolveExportFontData` (now exported from export-bootstrap) | `src/main/pdf-ops/ocr-bootstrap.ts:312` (`tryResolveOcrFontData`)                                | yes             |
| `_resetOcrFontDataCacheForTests`                             | `src/main/pdf-ops/ocr-bootstrap.font-rasterize.test.ts:67`                                       | yes (test-only) |
| `projectRectToCss`                                           | Used internally by `ConfidenceBox`; exported for `ocr-confidence-overlay.test.tsx`               | yes             |
| `OverlayRotation` type                                       | Used by `OcrConfidenceOverlayProps` + `pdf-canvas/index.tsx` call site                           | yes             |

All eight new public exports have at least one production call site OR a documented test-only consumer. Acceptance gate: PASS.

### Locked-instruction compliance

| Lock                                     | This wave                                                                        | Status  |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| L-001 (enableDragDropFiles)              | Not touched                                                                      | NEUTRAL |
| L-002 (operator-level screenshot)        | Diego's packaging wave (next) must capture the screenshot for v0.7.18            | PENDING |
| L-003 (Node 20 + no from-source rebuild) | Suite ran on the supported Node baseline; no rebuild of better-sqlite3 attempted | PASS    |

### Ratchet compliance — PASS (ninth consecutive wave)

- No new `(e as Error).message` direct reads (no new handler `catch` sites added).
- No new `pageResults: []` sentinel-default assignments. `loadOcrResultsThunk` now passes either a real array (happy path) or `null` (degraded path), respecting the late-init contract.
- No new `as any` in production code. Two `as unknown as` casts are documented and structural, not type-laundering.
- No new permissive-stub variants.
- No new `(e as Error)` direct access.
- No new direct `(rec as { bytes: Buffer })` casts.

### Verdict (final)

**GO — Diego cleared to cut v0.7.18.** No blockers, no L-001/L-002/L-003 violations, no ratchet regressions. Three documented LOW findings + three INFO notes are all acceptable. The Phase 5.2 closure of the OCR pipeline is complete: on-reopen overlay restore, standard-font glyph rendering, and rotation-correct confidence-box placement are all in place with regression tests guarding each.

---

## Phase 7.1 — Real-PDF e2e OCR integration test (review 2026-06-05)

**Reviewer:** Julian (Director of Code Quality & Security Audit).
**Scope:** `tests/e2e/ocr-integration.spec.ts` (Diego, b61f516), `tests/fixtures/pdfs/**` (Diego, 67c74c5), `.github/workflows/ci.yml` fixture-verify step (Diego, 85b0325), `src/ipc/handlers/test-seed-ocr-job.ts` + `src/ipc/register.ts` + `src/preload/index.ts` + `src/ipc/contracts.ts` + `docs/api-contracts.md` Phase 7.1 amendment (David, 4f272e8).
**Design contract:** `docs/phase-7.1-test-design.md` (Riley).

### Summary table

| Focus area                           | Verdict              | Critical | High | Medium | Low |
| ------------------------------------ | -------------------- | -------: | ---: | -----: | --: |
| 1. Fixture sanity + lockfile ratchet | PASS                 |        0 |    0 |      0 |   1 |
| 2. CI runtime budget vs. 90s         | PASS                 |        0 |    0 |      0 |   1 |
| 3. False-positive risk               | PASS                 |        0 |    0 |      1 |   1 |
| 4. False-negative risk + catch-cov   | ACCEPT-with-followup |        0 |    1 |      0 |   0 |
| 5. L-004 + L-005 grep compliance     | PASS                 |        0 |    0 |      0 |   0 |
| 6. Structural NODE_ENV gate          | PASS                 |        0 |    0 |      0 |   0 |

**Final verdict: GO-with-follow-up.** Wave 3 clears Wave 2 to advance to Nathan (Wave 4) and the v0.7.19 release ceremony. The single major finding (Phase D+E `.skip()` on dev-mode harness) is **accepted** with an explicit Phase 7.2 follow-up obligation logged in this review and Diego's wave learnings. Rationale below in §4.

### Focus 1 — Fixture sanity, provenance, lockfile ratchet

**Verdict: PASS.**

Findings:

1. **Provenance:** every PDF in `tests/fixtures/pdfs/` is regenerable from `scripts/generate-fixtures.mjs`. Source text in `source/lorem.txt` + `source/lorem-page2.txt` is canonical public-domain Lorem Ipsum (no copyrighted authorship, no PII, no third-party logos). README.md explicitly cites OFL 1.1 with the verbatim copyright lines from `node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION`.
2. **Font license:** I re-verified `LICENSE_LIBERATION` at `node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION`. First 15 lines confirm "Digitized data copyright (c) 2010 Google Corporation... Copyright (c) 2012 Red Hat, Inc.... This Font Software is licensed under the SIL Open Font License, Version 1.1." Same license family as the DejaVu Sans Riley §1.3 proposed (also OFL 1.1). Riley §7.2 explicitly authorized a bundled-font fallback; Liberation Sans is bundled, OFL 1.1, metric-compatible with Arial. Compliant with the project's permissive-OSS-only policy.
3. **Lockfile ratchet pattern:** `expected-hashes.json` pins SHA256 + byte counts of both fixtures. `verify-hashes.mjs` runs in CI BEFORE Tesseract (5-second hash check vs. ~3-4 min wasted recognition on substituted bytes). The generator's in-memory determinism self-check (`generate-fixtures.mjs` line 181-191) aborts WITHOUT writing if the same input yields different output. I re-hashed both fixtures on disk; both match the lockfile exactly:
   - `scan-1p-eng.pdf`: `2119bd7635792b2d7cbaba0c9003b5ca0b826d16fa45046bcd7fba18ea866b51` (91767 bytes) ✓
   - `scan-2p-eng.pdf`: `dc55bf1b315a540cb2d44c95fc6097de918883a55c3233f7dbb50a0fa8e4180b` (183654 bytes) ✓
4. **L-004/L-005 generator-script scope:** the generator imports `pdf-lib` directly (line 58). This is correct — pdf-lib is NOT pdf.js (different library, different code path), and the locks specifically protect `pdfjs.getDocument({data})` + `await import('pdfjs-dist/...')` patterns. The generator never loads pdf.js. Riley §6.2 explicitly distinguishes the harness scope; generator tooling is offline / ahead-of-time, not part of the harness.

| ID    | Severity | Location                        | Description                                                                                                                                                                                                                                                                                                       | Status |
| ----- | -------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.1.1 | LOW      | `generate-fixtures.mjs:166-172` | The `useObjectStreams: false` choice produces a classic xref table for byte-stability. Note for future maintainers: a pdf-lib minor that changes default whitespace inside content streams would break the lockfile. The README already says "regenerate + commit both in the same commit"; accept as documented. | OPEN   |

### Focus 2 — CI runtime budget vs. 90s ceiling

**Verdict: PASS.**

Findings:

1. **Local wall time observed:** Diego's wave entry reports 4.0s on his local Windows. Riley §4 budget was 75s with 15s headroom. The 4.0s figure is for Phases A–C only (Phase D+E skipped — see §4 below).
2. **Phase A budget tail:** Diego's spec adds a `BUDGET_BRIDGE_READY_MS = 15_000` for first-launch preload bridge attach. The CI runner cold-starts: `npm ci` + Electron bundle build + `npx playwright install chromium` + `npm rebuild` already happened earlier in the job. By the time `npm run e2e` runs, SQLite ABI is bound, Playwright Chromium is cached. Cold first-launch ≤15s is realistic.
3. **Phase B (Tesseract):** the bundled `eng.traineddata.gz` is seeded into `userDataDir/tessdata` in `beforeEach` (spec lines 211-219). No language pack download at runtime. Single-page DejaVu/Liberation Lorem @ 200 DPI on tesseract.js v7 measured 2.1s locally per Diego. 25s budget = 12x slack. No cold network download risk.
4. **Playwright config vs. spec override:** `playwright.config.ts:9` sets `timeout: 60_000`. The spec calls `test.setTimeout(90_000)` (line 240) which overrides per-test. This works in Playwright — per-test override takes precedence. No conflict, but worth noting that any future maintainer who removes the per-test `setTimeout` would silently regress the e2e to a 60s ceiling.

| ID    | Severity | Location                      | Description                                                                                                                                                                                                                                                                                                                     | Status |
| ----- | -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.1.2 | LOW      | `ocr-integration.spec.ts:240` | The spec's `test.setTimeout(90_000)` is what gives this test the 90s ceiling — playwright.config.ts global is 60s. A future test that copy-pastes the structure without the override silently downgrades to 60s. Consider promoting the 90s ceiling to the playwright config for the OCR suite once a second e2e spec needs it. | OPEN   |

### Focus 3 — False-positive risk

**Verdict: PASS** (one medium worth tracking).

Walk of every assertion floor for flake risk on the slow `windows-2025-vs2026` runner:

1. **`summary.totalWords >= 20`** (FLOOR_TOTAL_WORDS, line 107). Calibration runs report 81 words on Liberation Sans Lorem @ 200 DPI (Diego's wave entry). The floor is **4x** under calibration — Tesseract minor-version word-count drift on the same image would have to lose 75%+ of words to trip. Acceptable.
2. **`summary.meanConfidence >= 60`** (FLOOR_MEAN_CONFIDENCE, line 108). Calibration: 93.7%. Floor is 33 percentage points below calibration. Tesseract drift would have to drop mean confidence by a third to flake. Acceptable.
3. **`status === 'completed'`** (line 357). This is binary — no flake surface.
4. **`pageResults.length >= 1`** (line 412). Binary — no flake surface.
5. **`page0.words.length >= FLOOR_TOTAL_WORDS`** (line 418). Same 4x slack as #1. Acceptable.
6. **`completedJobs.length >= 1`** (line 490). Binary — no flake surface.
7. **`allErrors === []`** (line 504). Diego's wave entry flags: **GPU warning on stderr does NOT trip the renderer console gate today, but a future Chromium update could.** Diego pre-emptively scoped the filter to exact-match `msg.type() === 'error'` (line 122) excluding `'warn'`. Worth tracking — a Chromium major could emit new error-level renderer messages (especially Webgl / GPU-blocklist messages on the headless GitHub runner). Medium risk because the assertion message gives a complete error string in failure, which makes diagnosis fast.
8. **Phase-level budget assertions** (lines 374-377, 421): each phase has an internal `expect(phaseMs).toBeLessThan(budget)` clause. If the runner is slower than calibration, Phase B's 25s assertion fires with `Phase B exceeded 25000ms budget` rather than the test-level 90s timeout killing it silently. Good failure-localization.

| ID    | Severity | Location                          | Description                                                                                                                                                                                                                                                                                                            | Status |
| ----- | -------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 7.1.3 | MEDIUM   | `ocr-integration.spec.ts:121-126` | The console-error collector filters exact-match `'error'`. A future Chromium update could promote a renderer warning (WebGL / GPU-blocklist) to `error` level on the headless GitHub runner. Recommend: file as an allow-list followup (specific known-benign strings allowed) before the first false-positive lands.  | OPEN   |
| 7.1.4 | LOW      | `ocr-integration.spec.ts:107-108` | The 20-word / 60% floors are correct given 81/93.7% calibration. Recommend: log the actual calibration numbers in the spec's header comments so a future maintainer doesn't lower the floor on a `localized fixture without re-calibrating. (Diego's commit msg + Riley §5.1 already cover this; minor docs nit only.) | OPEN   |

### Focus 4 — False-negative risk + v0.7.13→v0.7.18 catch-coverage walk

**Verdict: ACCEPT-WITH-FOLLOWUP** (the only major finding of this review).

Per-release walk, verified against the spec code (not just Riley's §5.2 design):

| Release | Bug class                                                           | Riley §5.2 prediction | Spec verifies?                                                                                                                                                                                                     | Verdict                                                                                                                                 |
| ------- | ------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| v0.7.13 | Diagnostic logs + Diagnostics tile (observability, not runtime)     | NO (n/a)              | Out of scope. Console-error collector exists.                                                                                                                                                                      | N/A                                                                                                                                     |
| v0.7.14 | Path2D ordering crash during cold-start rasterize (L-005 ancestor)  | YES                   | Spec line 354-357: `summary.status === 'completed'`. Polyfill-ordering bug → main process throws inside rasterize → `runOnDocument` returns `{ok:false}` → assertion fails with attributable message citing L-005. | CAUGHT                                                                                                                                  |
| v0.7.15 | Buffer-detach: pdf.js detaches the rasterize input (L-004 ancestor) | YES                   | Spec line 358-362: `summary.totalWords >= 20`. v0.7.15 signature was zero-length tesseract reads → 0 words returned. The 20-word floor is exactly that signature. Failure msg cites L-004.                         | CAUGHT                                                                                                                                  |
| v0.7.16 | tesseract.js v7 output-shape drift (blocks tree + PNG IHDR dims)    | YES                   | Spec line 354-357: status would not reach `completed`. Modal stalls in `recognizing`; 25s budget asserts at line 374-377.                                                                                          | CAUGHT                                                                                                                                  |
| v0.7.17 | Mount-overlay + dispatch wire-up missing in production call sites   | YES                   | Spec line 408-412: `pageResults.length >= 1` against `listResultsByJob`. v0.7.17 signature was successful OCR but no ocr_results rows inserted into the DB. Exactly this probe.                                    | CAUGHT                                                                                                                                  |
| v0.7.18 | `ocr:listResultsByJob` channel + reopen restore + rotated overlay   | YES                   | Phase D+E `.skip()`d in dev-mode harness because `dist/main/` doesn't bundle the SQLite repo modules. v0.7.18 reopen-restore bug would NOT be caught on a dev-mode CI run as currently configured.                 | **NOT-CAUGHT in dev harness** — covered at unit tier by `loadOcrResultsThunk` 6 references in `src/client/state/thunks-phase5.test.ts`. |

**Catch-coverage summary: 4/6 v0.7.x releases caught at the e2e tier**, +1 covered at unit tier, +1 observability-only (uncatchable by integration test). Riley §5.2 claimed 5/6; the actual count drops by 1 because of the Phase D+E skip.

**Why I'm calling this ACCEPT-with-follow-up, not BLOCK:**

1. Phase 7.1's **stated goal** in the plan is "make the modal-mid-recognition capture reproducible in CI" — that is Phases A–C, which all land cleanly.
2. The reopen-restore bug (v0.7.18) has **defense in depth at the unit tier**: `loadOcrResultsThunk` has 6 references in `thunks-phase5.test.ts` covering the listJobs→listResultsByJob chain. A regression of the v0.7.18 class would fail at the unit job before reaching the e2e job.
3. Phase 7.2 fix is real engineering work (dev-mode SQLite repo bundling = a build-config change to `electron.vite.config.ts` to include `src/db/repositories/*.ts` in the main bundle, or an electron-builder install hook). Out of scope for Phase 7.1.
4. The `OCR_E2E_RELAUNCH_RESTORE=1` env-gated escape hatch is properly documented in `ocr-integration.spec.ts:525-528` for packaged-binary runs.
5. The release-ceremony L-002 capture for v0.7.19 can still trigger the OCR modal by seeding via the production-side path (David's `pdfApi.__test` is test-only, but the natural path — open a fixture + run OCR — is operative on the packaged binary).

| ID    | Severity | Location                          | Description                                                                                                                                                                                                                                                                                                                                                                                                       | Status           |
| ----- | -------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 7.1.5 | HIGH     | `ocr-integration.spec.ts:423-528` | Phase D+E `.skip()` on dev-mode harness because `dist/main/` doesn't bundle SQLite repo modules. v0.7.18 reopen-restore bug NOT caught on dev-mode CI run. Mitigated by unit-tier coverage of `loadOcrResultsThunk`. Phase 7.2 follow-up obligation: wire dev-mode SQLite repo bundling (Diego: electron.vite config change OR David: lift the dynamic-require to a static import path that the bundler can see). | OPEN — Phase 7.2 |

### Focus 5 — L-004 + L-005 compliance (grep ratchet)

**Verdict: PASS.**

Per Riley §6.3, the harness must contain zero direct pdf.js invocations. Grep results:

| File                                                | Grep `pdfjs\|getDocument\|pdf-lib` | Match disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/e2e/ocr-integration.spec.ts`                 | **0**                              | Zero matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/ipc/handlers/test-seed-ocr-job.ts`             | **4**                              | All 4 in **comments only** (lines 18, 20, 21, 124) explicitly explaining "this file does NOT load pdf.js". Zero call sites. PASS.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/ipc/contracts.ts` (TestSeedOcrJob\* types)     | **0** (in the Phase 7.1 amendment) | The amendment adds only `interface TestSeedOcrJobRequest/Value`, `type TestSeedOcrJobError/Response`, and `Channels.TestSeedOcrJob` — zero pdf.js / pdf-lib references.                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/ipc/register.ts`                               | **5**                              | All 5 are unrelated to pdf.js OR are in comments: line 175 doc-string about main-process pdfjs, line 223 doc-string about pdf-lib metadata loader (pre-existing), line 414/636/702 are `documentStore.getDocument(handle)` / `getDocumentPath` / `getDocumentHash` (handle lookups, not pdf.js). PASS.                                                                                                                                                                                                                                                             |
| `src/preload/index.ts` (David's Phase 7.1 slice)    | **0**                              | The `__test` namespace is a pure ipcRenderer.invoke wrapper. Zero pdf.js / pdf-lib references.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests/fixtures/pdfs/scripts/generate-fixtures.mjs` | **11**                             | All 11 references are: (a) documentation comments explaining the L-004/L-005 boundary, (b) the literal string `'pdfjs-dist'` in the path to the bundled font, (c) the literal `pdf-lib` string in the producer metadata, and (d) the actual `import { PDFDocument } from 'pdf-lib'` on line 58. **pdf-lib ≠ pdf.js** — pdf-lib does NOT trigger `getDocument({data})` or the polyfill capture path. The generator is offline tooling, not part of the runtime harness. Riley §6.2 distinguished generator/tooling scope from harness scope; this is correct. PASS. |

**The architectural posture is right:** the e2e tier exercises pdf.js _through_ `src/main/pdf-ops/ocr-bootstrap.ts` (which enforces L-004 via `toPdfJsBuffer` and L-005 via `loadPdfJs`). The harness does not duplicate enforcement; it inherits it. A future regression that removes the copy helper or the polyfill-loader helper would fail the spec at the v0.7.14/v0.7.15 catch surface (Phase B status + totalWords floor).

### Focus 6 — Structural NODE_ENV gate (registration-time, not runtime)

**Verdict: PASS.**

The gate is the registration-time early-return in `src/ipc/handlers/test-seed-ocr-job.ts` at the exit point of the file:

```ts
// src/ipc/handlers/test-seed-ocr-job.ts:213-218
export function registerTestSeedOcrJob(opts: { ipcMain: IpcMain; deps: TestSeedOcrJobDeps }): void {
  if (process.env['NODE_ENV'] !== 'test') return;
  opts.ipcMain.handle(Channels.TestSeedOcrJob, (_evt, payload: unknown) =>
    handleTestSeedOcrJob(payload as TestSeedOcrJobRequest, opts.deps),
  );
}
```

The check is at REGISTRATION time, BEFORE `ipcMain.handle(...)`. In any production bootstrap (`NODE_ENV !== 'test'`), the function returns immediately and `__test:seedOcrJob` is **never** added to the IPC handler table. A hostile renderer probing for the channel name receives the standard "No handler registered" rejection because there is no handler.

Verification chain:

1. `src/ipc/register.ts:1141-1147` calls `registerTestSeedOcrJob({ ipcMain, deps: ... })`. This is the **only** call site.
2. Inside `registerTestSeedOcrJob`, the `if (process.env['NODE_ENV'] !== 'test') return;` is line 214 — first statement of the function, BEFORE `ipcMain.handle`.
3. `src/preload/index.ts:511-518` conditionally spreads the `__test` namespace ONLY when `process.env['NODE_ENV'] === 'test'`. Defense-in-depth — but as the David's wave entry correctly notes: "the registration-time gate is the boundary of record; the preload mirror is a courtesy."

This is the **strongest form of structural gating**: a runtime check inside the handler would still leak the channel name to a probe ("not_in_test_mode" error returned). The registration-time gate leaves nothing to probe. Compliant with Riley §3 and David's own design.

### L-004 + L-005 + L-001 + L-002 + L-003 compliance summary

| Lock                              | This wave                                                                                                                              | Status  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L-001 (enableDragDropFiles)       | Not touched.                                                                                                                           | NEUTRAL |
| L-002 (operator-level screenshot) | Diego's v0.7.19 release ceremony (next) MUST capture the L-002 screenshot per the plan's release-ceremony checklist.                   | PENDING |
| L-003 (Node 20 baseline)          | Spec runs on the Node-20 CI matrix; `npm rebuild` (Electron ABI) step precedes Playwright. No from-source rebuild attempted.           | PASS    |
| L-004 (pdf.js copied buffer)      | Zero direct pdf.js call sites in harness, seed handler, or fixture generator (pdf-lib in generator is correct; not pdf.js). Compliant. | PASS    |
| L-005 (pdf.js polyfill order)     | Zero direct `await import('pdfjs-dist/...')` in harness. Production rasterize path (which the spec exercises) already enforces.        | PASS    |

### Production-call-site checklist (David's slice)

| New export                                         | Production call site                                                                           | Verified |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| `Channels.TestSeedOcrJob`                          | `src/ipc/register.ts:1141-1147` (gated)                                                        | yes      |
| `registerTestSeedOcrJob`                           | `src/ipc/register.ts:1141`                                                                     | yes      |
| `handleTestSeedOcrJob` (pure handler)              | `src/ipc/handlers/test-seed-ocr-job.ts:215` + future test file consumes it directly per design | yes      |
| `TestSeedOcrJobRequest/Value/Error/Response` types | `src/preload/index.ts:514-515`, `tests/e2e/ocr-integration.spec.ts:248-268`                    | yes      |
| `pdfApi.__test.seedOcrJob` (preload)               | `tests/e2e/ocr-integration.spec.ts:267`                                                        | yes      |

All five new public exports have at least one production call site (the test-only ones go through the structurally-gated channel). PASS.

### Ratchet compliance (Phase 7.1 surface)

- No new `(e as Error).message` direct reads — the seed handler uses `safeMessage(e, fallback)` (line 132, 162, 197).
- No new `as any` — David's slice uses `as unknown as TestSeedOcrJobRequest` only at the IPC boundary (line 216), which is the documented pattern for unknown IPC payloads.
- Zod schema validation at the handler entry (`requestSchema.safeParse` line 106). Strong validation.
- No new permissive-stub variants — the structural NODE_ENV gate is strictly stronger than a stub.
- L-001/L-002/L-003 unchanged.

### Findings (Phase 7.1) — consolidated

| ID    | Severity | Location                          | Description                                                                                                                                                                                                                                              | Status           |
| ----- | -------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 7.1.1 | LOW      | `generate-fixtures.mjs:166-172`   | `useObjectStreams: false` byte-stability is correct; document the pdf-lib whitespace-stream risk for future regenerations. (README already covers regenerate-with-commit; minor only.)                                                                   | OPEN             |
| 7.1.2 | LOW      | `ocr-integration.spec.ts:240`     | Per-test `test.setTimeout(90_000)` overrides the 60s playwright.config.ts ceiling. A copy-paste of the spec without this line silently downgrades to 60s. Promote OCR-suite timeout to config when a second OCR e2e spec lands.                          | OPEN             |
| 7.1.3 | MEDIUM   | `ocr-integration.spec.ts:121-126` | Console-error gate is exact-match `'error'`. Future Chromium update could promote a benign WebGL/GPU-blocklist warning to error severity on the headless runner. Track for allowlist-pattern when first false-positive lands.                            | OPEN             |
| 7.1.4 | LOW      | `ocr-integration.spec.ts:107-108` | Document the 81-word / 93.7% calibration numbers next to the floor constants so a future fixture maintainer doesn't drop the floor without re-calibrating.                                                                                               | OPEN             |
| 7.1.5 | **HIGH** | `ocr-integration.spec.ts:423-528` | Phase D+E `.skip()` on dev-mode harness because `dist/main/` doesn't bundle SQLite repo modules. v0.7.18 reopen-restore bug class NOT caught at e2e in dev harness. Mitigated by unit-tier coverage. Phase 7.2 follow-up: wire dev-mode SQLite bundling. | OPEN — Phase 7.2 |

No blockers. No criticals.

### Verdict (final)

**GO-with-follow-up.** Wave 3 clears Wave 2 to advance to Nathan (Wave 4) and the v0.7.19 release ceremony.

Phase 7.1 lands Phases A–C cleanly — the modal-mid-recognition capture is now reproducible in CI, exactly as the plan stated. Four of six historical v0.7.x bug classes are caught at the e2e tier (v0.7.14, v0.7.15, v0.7.16, v0.7.17), one is covered at the unit tier (v0.7.18 reopen-restore via `loadOcrResultsThunk`), and one was inherently uncatchable by integration test (v0.7.13 observability). Five-out-of-six total catch coverage with a documented Phase 7.2 obligation to lift the dev-mode SQLite bundling so v0.7.18-class regressions also surface at the e2e tier.

L-004 and L-005 grep ratchet is clean across all Phase 7.1 files. The structural NODE_ENV gate is the strongest form (registration-time, not runtime); the preload mirror provides defense-in-depth. Fixture provenance is fully reproducible from source text + a bundled OFL-1.1 font; the SHA256 lockfile + CI verifier catch any substitution in 5 seconds before Tesseract wastes 3-4 minutes.

The HIGH finding (7.1.5) is the catch-coverage gap from the dev-mode skip. It is **accepted, not blocking**: (a) Phase 7.1's stated goal is the modal-mid-recognition reproducibility surface, which lands; (b) the v0.7.18 bug class has unit-tier defense in depth; (c) Phase 7.2 is the right scope for the build-config change to make dist/main/ bundle the SQLite repos. Marcus should track 7.1.5 explicitly as a Phase 7.2 candidate.

---

## Phase 7.2 — Wave 3 review (Julian, 2026-06-10)

### Verdict

**STOP.** The static-import lift (Item A-1) is structurally correct AND the bundler-visibility check passes, but it exposed a pre-existing latent adapter/repo signature drift in `adaptOcrJobsRepo` that deterministically breaks Phase B of the canonical e2e spec on every run. The acceptance criterion "the new live Phase D+E test runs green in CI" cannot be satisfied as the codebase stands — Phase D+E never executes, the test fails at Phase B with `status must be one of queued|running|completed|cancelled|failed|superseded_by_undo (got undefined)`. **One blocker (7.2.1, CRITICAL). David fixes the adapter, then re-dispatch.** Items B + A-test ship correctly when 7.2.1 is closed.

### 1. Item B walkthrough (Diego, 5d2ac3b)

All six tests in `src/ipc/handlers/dialog-pick-pdf-files.test.ts` run green locally (`6/6` in 7 ms). The B-1 fix at lines 42–63 substitutes `expected = sanitizePath(input)` for the previous hardcoded `'C:\\Users\\test\\a.pdf'` literal.

**Five-test rubric on BOTH platforms (post-fix):**

| Line | Test                           | Asserts                                             | Windows | Ubuntu |
| ---- | ------------------------------ | --------------------------------------------------- | ------- | ------ |
| 26   | user_cancelled (canceled flag) | error code only                                     | green   | green  |
| 34   | user_cancelled (empty paths)   | error code only                                     | green   | green  |
| 42   | happy-path single-select       | `paths === [sanitizePath(input)]`                   | green   | green  |
| 65   | multi:true plumbing            | length 2 + `properties.includes('multiSelections')` | green   | green  |
| 78   | invalid_path traversal         | error code only                                     | green   | green  |
| 91   | invalid_path non-.pdf          | error code only                                     | green   | green  |

The four error-code / length tests assert on platform-portable surfaces only (sanitizer rejection regex fires before `path.resolve` on both platforms; `multiSelections` is array content, not path content). Riley's claim that **only line 51** carried Windows-shaped content is verified — confirmed by reading the actual test bodies. Lines 67/80/54 are clean.

**"Is the test still meaningful or has it become a tautology?"** The assertion is now `expect(handlerOutput).toEqual([sanitizePath(input)])`, and the handler internally calls `sanitizePath(input)`. The test is not strictly a tautology because:

1. The handler does not return `sanitizePath(input)` directly — it returns `paths`, an Array. The assertion gates the round-trip: showOpenDialog → handler → sanitizer → response shape. If the handler regressed to e.g. returning the raw filePaths un-sanitized, both Windows and Ubuntu would fail. If it returned an unwrapped string instead of an array, both fail. If it lost the input-passthrough, both fail.
2. The sanity gate at line 53 (`expect(expected).not.toBeNull()`) guards against a regression where the production sanitizer starts rejecting every input.

It is true that a future regression that affects ONLY the sanitizer's transformation (e.g. it changes its normalization rule) would no longer be caught — the test would silently accept the new shape. That is a genuine coverage loss vs the old literal-equality assertion. Riley's design call (§1.6) acknowledges this implicitly by saying the test "is the same shape with no hidden state" — but "no hidden state" is exactly the property that closes the back-door: snapshots would silently re-bless under `--update-snapshot`, this derivation does too. **Mitigation**: the production sanitizer has its own dedicated test file at `src/main/security/path-sanitizer.test.ts` that gates transformations directly. As long as that file stays load-bearing, the coverage loss here is acceptable. **Net judgment: B-1 is the right call.** No follow-up.

### 2. Item A walkthrough (David, 8343da6)

**Bundling-visibility: PASS.** Ran `npm run build` after the joined main. `dist/main/index.js` grew from **450,550 → 505,500 bytes** (+54,950 / +12.2 %). Grep counts in the new bundle:

- `createOcrJobsRepo|createOcrResultsRepo|createFormTemplatesRepo|createSignatureAuditRepo|createLanguagePacksRepo|createExportJobsRepo` → **12 hits** (six imports, six call sites).
- SQL table names `ocr_jobs|ocr_results|form_templates|signature_audit_log|language_packs|export_jobs` → **51 hits**.
- The static-import lift unambiguously put all six repo modules into the bundle. Vite did NOT tree-shake any of them. The dev-mode `_electron.launch()` now resolves SQLite-backed factories.

**Bundle-size delta: +54 KB / +12.2 %.** The plan §Risks budgeted this row at "low likelihood" / ~100 KB/repo expected — actual is well under. Acceptable; no Electron startup regression risk at this magnitude.

**Memory-fallback reachability — verified by direct unit test.** `src/main/index.test.ts` adds three new tests against the lift:

1. "all six factories succeed → kinds all sqlite" — happy path
2. "ocrJobs factory throws → kinds reports ocrJobs=memory, others=sqlite" — single-slot constructor-throw fallback path
3. "every factory throws → kinds reports all memory" — full-degrade path

All three pass locally (`7/7` in 84 ms; stderr emits the deliberate `[main] repo factory threw; using memory fallback:` log lines per the `tryConstruct` helper). The legitimate memory-fallback path (factory throws at construction time) is reachable per design. The illegitimate import-missing path is gone, which is the desired outcome — packaging gaps now become build-time errors, not silent runtime memory-bridge falls.

The `tryConstruct<F,R,S>(factory, adapt, fallback)` helper is single-responsibility: it guards only the factory invocation, not the import. Cast through `unknown as (db: unknown) => R` is the same shape the old dynamic-require carried; no NEW unsafe surface introduced.

### 3. `__test:whichBridge` safety walkthrough

**Structural gate at registration:** `src/ipc/handlers/test-which-bridge.ts:89` early-returns when `process.env['NODE_ENV'] !== 'test'`. Identical pattern to `__test:seedOcrJob`. `ipcMain.handle` is never called in production, so the channel name is NOT a probeable IPC surface in prod even if hostile code attempts it — `ipcMain.handle` was never registered.

**Production-build absence check (caveat — important).** Grepped the **rebuilt** `dist/main/index.js` after the lift:

- `__test:whichBridge|TestWhichBridge|whichBridge|registerTestWhichBridge|handleTestWhichBridge` → **6 hits**.
- `__test:seedOcrJob|seedOcrJob|registerTestSeedOcrJob` → **3 hits** (pre-existing Phase 7.1 pattern).

The channel name strings AND the handler bodies DO appear in the production bundle. The runtime `NODE_ENV !== 'test'` early-return prevents `ipcMain.handle` from binding the channel, so on a normal launch the surface is unreachable. **However:** if an attacker can set `NODE_ENV=test` in the parent environment before launching the packaged binary, the channel binds and becomes invokable. This is the same risk Riley acknowledged in design §4 R5 — and the same risk that already applies to `__test:seedOcrJob` since v0.7.19. **This is NOT a Phase 7.2 regression** — it inherits the Phase 7.1 gate model exactly. It IS a latent risk-of-the-class. Tracked as 7.2.3 (MEDIUM) — the gate model should at minimum be ratified at build-time with a Vite `define` constant so production builds dead-code-eliminate both the registration AND the handler module.

**Preload mirror review:** `src/preload/index.ts:514-525`. The `...(process.env['NODE_ENV']==='test'?{__test:{...}}:{})` spread reads `process.env.NODE_ENV` at **preload-context load time**. Electron preload runs in its own V8 context. The renderer cannot mutate `process.env.NODE_ENV` after preload init. If a prod build's preload sees `NODE_ENV !== 'test'`, `pdfApi.__test` is `undefined` and the renderer-side type access `pdfApi.__test.whichBridge` throws `TypeError: Cannot read properties of undefined`. Defense in depth holds.

**Return shape vs spec assertion:** spec evaluates `bridge2.value!.ocrJobs === 'sqlite'` and pulls the other five slot names from `Object.entries(bridgeKinds)`. Handler returns `{formTemplates, signatureAudit, ocrJobs, ocrResults, languagePacks, exportJobs}`. **Match.** The spec's `memorySlots` filter would catch any slot misnamed in the handler.

### 4. L-001 through L-005 — compliance verification

Grepped the three Wave 2 diffs and the joined main for each lock's load-bearing surface:

- **L-001 (`enableDragDropFiles` must not be `false`)**: `git show 5d2ac3b 9d69f83 8343da6 | grep enableDragDropFiles` → **0 hits**. None of the diffs touched `window-manager.ts`'s `webPreferences`. Compliant. **PASS.**
- **L-002 (operator-level screenshot on packaging waves)**: Phase 7.2 Wave 3 is review, not packaging. Diego's v0.7.20 release ceremony (next) MUST capture per the plan §"Release ceremony" checklist. **PENDING — not Phase 7.2 Wave 3 scope.**
- **L-003 (Node 20 baseline)**: David's wave entry notes `npm test full suite — 179 files / 1927 tests green (Node 24 via L-003 escape hatch)`. The escape hatch is `scripts/rebuild-native-for-node.mjs` per the lock — sanctioned. CI matrix unchanged at Node 20 (`.github/workflows/ci.yml`). The new e2e Phase D+E body adds no Node-24-only feature (vanilla `Date.now`, `setTimeout`, Playwright `_electron`, `window.evaluate`). **PASS.**
- **L-004 (`pdf.js getDocument({data})` copied buffer)**: Grepped the three diffs for `getDocument|loadPdfJs|pdfjs-dist|toPdfJsBuffer` → only matches are in comments + tests-which-bridge.ts noting "this module does NOT load pdf.js". No pdf.js call sites added or moved. **PASS.**
- **L-005 (polyfill order before dynamic import)**: same grep — zero `await import('pdfjs-dist...`)` additions across all three commits. No new pdf.js loader call sites. **PASS.**

Riley's §5 claims are verified end-to-end.

### 5. Phase D+E false-positive risk — local 3× run results (FLAKE WALK)

Ran `npx playwright test tests/e2e/ocr-integration.spec.ts` twice locally on the joined main (`dda9753` + post-build). **Both runs failed deterministically at the same line (Phase B, line 313)** with the same error:

```
Error: Error invoking remote method 'ocr:runOnDocument':
  Error: status must be one of queued|running|completed|cancelled|failed|superseded_by_undo (got undefined)
```

Phase A: 2,576 ms. Phase B: ABORTED. Phase C/D/E/F/G: NOT REACHED. Total time-to-fail: ~5.3 s per run.

This is **not a flake** (R1 SQLite file-lock race, R2 userdata cleanup, R3 Tesseract non-determinism, R4 thunk stale-state, R6 page-0 capture race) — those would manifest after Phase A succeeded. This is a **deterministic regression at the OCR-run IPC layer**, traced and root-caused in finding 7.2.1 below. The third run was elided as it would only confirm determinism.

Phase D/E budgets (15 s + 10 s) are unverifiable until Phase B passes.

### 6. Phase D+E false-negative risk (v0.7.18 catch) — bug-shape walk

The v0.7.18 reopen-restore bug shape: OCR results in SQLite, but `loadOcrResultsThunk` got nothing back from `listResultsByJob` because the SQLite repo wasn't in the bundle in dev mode. The new test body:

1. **Line 313**: `ocr:runOnDocument` → writes via `ocrJobsRepo`. **Would PASS for the v0.7.18 binary** (the writes worked then too, the bug was in restore).
2. **Phase A line ~450**: `listJobs` finds the completed job in launch1. **Would PASS for v0.7.18.**
3. **Phase D bridge probe `bridge2`**: asserts all six slots are 'sqlite' on launch2. **Would FAIL for v0.7.18** — the dynamic require silently fell through, so the slots would be 'memory'.
4. **Phase E `listJobs` on launch2**: returns the completed job. **Would FAIL for v0.7.18** — memory bridge has no rows from launch1.
5. **Phase E `listResultsByJob`**: `restoredPage0.words.length === originalPage0WordCount`. **Would FAIL for v0.7.18** — `restoredPage0` is undefined.

The new body catches v0.7.18 at THREE distinct assertion points, each with an attributable message. **False-negative risk: zero, when the regression in 7.2.1 is fixed.**

### 7. CI status — Option C-2

I chose **C-2** (recommend Marcus push the draft PR after the 7.2.1 blocker is fixed) rather than C-1 (push myself now). Reasoning: with 7.2.1 deterministically red, pushing a draft PR right now would tell us only what `npm run e2e` already told us locally. CI cycle (~7-10 min) is not load-bearing data until the blocker fix is in. Marcus should push a draft PR after the 7.2.1 follow-up dispatch lands, and the CI run URL should be cited in the re-review.

**Pre-blocker note:** the unit-test suite, lint, typecheck, and the dialog-pick-pdf-files Vitest all run green on the joined main. The CI `check` job (typecheck + lint + Vitest matrix on both OSes) WILL pass on this commit; only the `e2e` job will fail. Item B's CI-unblock goal is met for `check` and `build` — only `e2e` is gated by 7.2.1.

### 8. Findings list

| ID    | Severity               | Location                                                                                                                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                          |
| ----- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 7.2.1 | **CRITICAL — BLOCKER** | `src/main/db-bridge.ts:1774-1781` + adapter at `:1815-1832`                                                                      | `RaviOcrJobsRepo.updateStatus` is declared with positional args `(id, status, completedAt, meanConfidence, totalWords, errorMessage)` but the **actual** SQLite repo signature at `src/db/repositories/ocr-jobs-repo.ts:351` is `updateStatus(id: number, input: UpdateOcrJobStatusInput): boolean`. The adapter at db-bridge.ts:1820-1832 calls `raw.updateStatus(id, update.status, update.completed_at, ...)` — positional. When the lift wires the real SQLite repo, Ravi's `updateStatus` receives the status STRING (e.g. `'completed'`) as its `input` arg, then does `input.status` → undefined → `assertOcrStatus` throws `status must be one of … (got undefined)`. **Deterministic failure on every `ocr:runOnDocument` call in dev mode and packaged.** Was previously hidden because the dynamic-require gap meant the adapter never connected to the real repo — memory fallback was used. **The static-import lift exposed (did not cause) a pre-existing latent adapter drift dating from Phase 5.2.** | **BLOCKS Phase 7.2 acceptance** |
| 7.2.2 | MEDIUM                 | `src/main/db-bridge.ts:1820-1832` + sibling adapters (export-jobs, ocr-results, signature-audit, language-packs, form-templates) | **Same adapter-drift class needs audit on the other five slots.** If `updateStatus` signature drifted, `insert`/`updateProgress`/`upsert` may have drifted too. The lift made all six adapters newly load-bearing in dev. The export-jobs adapter at `:1163` has the same shape risk (also takes object input on Ravi's side per `export-jobs-repo.ts:706`). Recommend David do a full adapter-vs-Ravi-shape audit as part of the 7.2.1 follow-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | OPEN — fix with 7.2.1           |
| 7.2.3 | MEDIUM                 | `src/ipc/handlers/test-which-bridge.ts:89` + `test-seed-ocr-job.ts` (inherited)                                                  | Test-only channel registration is gated at runtime (`NODE_ENV !== 'test'` early-return) but the channel name strings and handler bodies appear in the production bundle (6 hits / 3 hits respectively). If an attacker can set `NODE_ENV=test` in the parent env before launching the packaged binary, the channels bind. Same pattern as Phase 7.1's `__test:seedOcrJob` — not a 7.2 regression, an inherited model. Recommend a Vite `define: {'process.env.NODE_ENV': '"production"'}` constant in `electron.vite.config.ts` for the prod build, which would dead-code-eliminate the registration AND the handler module.                                                                                                                                                                                                                                                                                                                                                                                           | OPEN                            |
| 7.2.4 | LOW                    | `src/main/db-bridge.ts:1820`                                                                                                     | Comment "Phase 5 only valid terminal statuses come through this method; queued/running/superseded_by_undo move via insert / separate flows." — but `src/ipc/handlers/ocr-run-on-document.ts:327-340` clearly calls `updateStatus` with `status: 'cancelled'` and `'failed'` (terminal) AND `src/ipc/handlers/ocr-run-on-page.ts` likely transitions queued → running via updateStatus. The comment is stale and misleading. Refresh as part of 7.2.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | OPEN                            |
| 7.2.5 | LOW                    | `tests/e2e/ocr-integration.spec.ts:472-477`                                                                                      | Pre-close `originalPage0WordCount` is captured from the Phase-C `page0` variable. Riley §4 R6 mitigation specifies a `FLOOR_TOTAL_WORDS` floor assertion immediately after capture (line 477 does this). Good — but the variable is captured via `page0?.words.length ?? 0`, which silently substitutes 0 when `page0` is undefined. The `>= FLOOR_TOTAL_WORDS` floor catches the 0 case loudly. Compliant; flagging for the reader.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | NOTE only — no fix needed       |
| 7.2.6 | LOW                    | `dist/main/index.js` (rebuilt)                                                                                                   | Bundle size grew +54 KB (+12.2 %) post-lift. Within the plan's "low likelihood" budget. No startup regression expected at this magnitude. Track for Phase 7.x if the cumulative repo growth exceeds 100 KB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | NOTE only — no fix needed       |

### 9. Closing note on finding 7.1.5

**7.1.5 is NOT yet closed.** The structural cause (dev-mode `dist/main/` not bundling the SQLite repos) IS closed by David's Item A-1 — the static-import lift is correct and the bundle now contains all six repos. But the **operational consequence** (Phase D+E catches the v0.7.18 reopen-restore class at the e2e tier) is NOT met until 7.2.1 unblocks Phase B. Phase D+E exists in the spec body, is structurally correct per Riley's §3 design, and would fire correctly against the v0.7.18 bug shape — but it cannot execute because the OCR-run pipeline is broken upstream.

**Recommended unblock:** dispatch David for a targeted Item A-1.1 fix on `adaptOcrJobsRepo` (and audit the sibling adapters per 7.2.2). Fix should be: change the bridge's `RaviOcrJobsRepo` interface and adapter to pass an object input matching Ravi's actual SQLite signature. Estimated cost: ~30 LOC across `db-bridge.ts`. Add a regression test that exercises the round-trip through the real SQLite repo (not the memory mock) so this class of drift cannot regress silently again. Then re-run Phase 7.2 Wave 3.

When 7.2.1 is closed and the e2e spec runs green locally + CI, finding 7.1.5 will be closed.

## Phase 7.2 — Wave 3 re-review (Julian, 2026-06-10)

### 1. Updated verdict

**GO-with-follow-up.** David's Item A-1.1 (commit `491341f`) closes the 7.2.1 blocker cleanly — every spot-check verifies, the new round-trip integration test (24 tests, all six adapters, real `better-sqlite3` via `makeTestDatabase()`) is the right ratchet for the drift class, the canonical e2e spec runs green in CI for the first time in months, and the bridge-introspection probe asserts all six slots are SQLite-backed on relaunch. The single carry-forward is 7.2.3 (prod-build dead-code-elimination of `__test:*` channels) — MEDIUM, deferred to Diego.

### 2. 7.2.1 closure — adapter fix confirmed

`src/main/db-bridge.ts:1862-1882` now declares `RaviOcrJobsRepo.updateStatus(id, input: {status, completed_at?, mean_confidence?, total_words?, error_message?})` — an object payload matching Ravi's actual SQLite signature at `src/db/repositories/ocr-jobs-repo.ts:351` exactly. The adapter at `db-bridge.ts:1922-1945` forwards the object verbatim with conditional spreads that respect Ravi's COALESCE-pattern UPDATE semantics — missing-field undefined is preserved as "do not overwrite" rather than collapsed to a positional placeholder. The Phase B e2e abort signature (`status must be one of … (got undefined)`) is structurally impossible against this code path.

### 3. Sibling adapter audit verification

I read each adapter and its paired `Ravi*Repo` interface against the corresponding `src/db/repositories/*-repo.ts`. Every "Phase 7.2 (David, 2026-06-10) — Item A-1.1 drift fix." marker maps to a real shape difference David resolved:

- **ocrJobs** — CONFIRMED. `updateStatus` positional→object; `listAll` re-assembled from Ravi's `listAll(filters, limit?, offset?)` + `countAll(filters)` into `{items, total}`. Both fixes are load-bearing for the e2e.
- **ocrResults** — CONFIRMED. `insert` now routes via `upsert` (which is Ravi's actual surface — there is no `insert` method on `createOcrResultsRepo`); idempotent on `UNIQUE(job_id, page_index)` per the integration test. Rationale fully matches Ravi's repo at `src/db/repositories/ocr-results-repo.ts`.
- **signatureAudit** — CONFIRMED. `insert` unwraps the discriminated union (Ravi returns `{kind:'inserted',id}|{kind:'duplicate',id}`); `markInvalidatedByOcrJob` rewritten to resolve `(docHash, fieldNames[]) → rowIds[]` via the existing `listAll` filter, then forward Ravi's `(rowIds[], ocrJobId)` signature. This is the right ownership boundary — the bridge converts UI-shaped lookup keys to SQL primary keys; Ravi's repo stays SQL-native.
- **languagePacks** — CONFIRMED. `remove` unwraps the `{kind:'downloaded',true}|{kind:'bundled_protected',false}` discriminated union to a plain boolean; `touchLastUsed` swallows the boolean return (handler doesn't need it). Both match Ravi's repo at `src/db/repositories/language-packs-repo.ts`.
- **exportJobs** — CONFIRMED. The most ambitious adapter — Ravi's repo exposes four single-axis list methods (`listAll`, `listInProgress`, `listByDocHash`, `listByStatus`) but the bridge contract wants a generic `listAll(filters, limit, offset) → {items, total}`. David's adapter dispatches to the narrowest matching Ravi method (e.g. `status='queued'|'running'` → `listInProgress`, fallback `listByStatus`) and filters the remainder in-memory. Acceptable per L1 ("don't grow Ravi's surface for bridge ergonomics") and the dataset is low-volume. `updateProgress` positional→object, same shape fix as ocrJobs.
- **formTemplates** — CONFIRMED CLEAN. David's audit found NO drift here. I re-checked: `adaptFormTemplatesRepo` at `db-bridge.ts:1495` matches `createFormTemplatesRepo` at `src/db/repositories/form-templates-repo.ts` field-for-field. Reported "no fix needed" stands.

### 4. Round-trip integration test verification

`src/main/db-bridge.integration.test.ts` (654 LOC) is the right ratchet:

- **Real SQLite, not memory mock**: imports `BetterSqlite3` + `makeTestDatabase()` from `src/db/test-support.ts`, which spins a fresh `:memory:` DB with the canonical migration list applied. Each test gets a fresh DB via `beforeEach`/`afterEach`.
- **24 tests across 7 describe blocks**: ocrJobs (5), ocrResults (3), signatureAudit (3), languagePacks (4), formTemplates (2), exportJobs (4), and a "no-drift smoke" block (3) covering recents/bookmarks/settings. Counts verified by `grep -c "  it("` and `grep -c "  describe("`.
- **Coverage breadth**: every adapter method exercised through real SQLite. The exact Phase-B abort code path (`updateStatus({status:'completed', completed_at, mean_confidence, total_words})`) is the second test in `ocrJobs` and is labeled "this is the v0.7.20 catch." `markInvalidatedByOcrJob` has its own test that confirms the `docHash + fieldNames → rowIds → mark` chain — closing the silent-no-op risk David noted in his learnings L4.
- **Local note**: vitest run failed locally for me with `NODE_MODULE_VERSION 123 vs 137` — that's the L-003 better-sqlite3 ABI rebuild gap (my Node 24 vs the Electron-targeted rebuild). The escape hatch at `scripts/rebuild-native-for-node.mjs` would resolve, but CI ran the canonical Node 20 baseline and the suite is GREEN there (see §5).

### 5. CI confirmation — local re-run substituted

CI is the authoritative wall clock since L-003 holds my Node-24 local at the ABI gate. From `gh run view 27277743488 --log`:

- **Vitest** (both Windows + Ubuntu): `src/main/db-bridge.integration.test.ts (24 tests)` GREEN. Full suite **1949 passed / 2 skipped** across **180 files**.
- **Playwright e2e** (Windows): Phase A=8294ms, Phase B=3476ms, Phase C=29ms, Phase D=1442ms, Phase E=38ms, total=**13279ms** (75s target, 90s ceiling). All 6 bridge slots probed `'sqlite'` post-relaunch (else Phase D's `expect.fail` would have fired). David's local Windows numbers (A=961, B=2727, C=25, D=1417, E=19, total=5149ms) were the warm-cache lower bound; CI's cold-start matches expectations within budget. **No flake** — the 3 Playwright tests passed cleanly in 17.4s.

### 6. CI status — first-greens

Workflow run: https://github.com/SuperiorAg/PDF_Viewer_Editor/actions/runs/27277743488. PR: https://github.com/SuperiorAg/PDF_Viewer_Editor/pull/1.

- `Lint / Typecheck / Test (windows-2025-vs2026)` — GREEN.
- `Lint / Typecheck / Test (ubuntu-latest)` — GREEN. **First Ubuntu `check`-green in months** (Diego's Item B was the unlock; the dialog-pick-pdf-files sanitizePath round-trip is now platform-portable per §1 of the prior STOP review).
- `Playwright e2e (windows-2025-vs2026)` — GREEN. **First CI run of the Phase 7.1 canonical spec, ever** (it was env-gated `OCR_E2E_RELAUNCH_RESTORE=1` until Diego's Item A-test live-body lift in `9d69f83`).
- `Build Windows artifacts` — correctly SKIPPED (PR-only; runs on main push during the v0.7.20 release ceremony).

All three plan §"Wave 3 (sequential)" gates (line 138) satisfied.

### 7. Findings closure

- **7.1.5** — CLOSED. Structural cause was Item A-1's static-import lift; operational consequence is now demonstrated by a green CI run of the spec body that catches the v0.7.18 reopen-restore class at three distinct assertion points (bridge probe + listJobs match + listResultsByJob word-count equality).
- **7.2.1** — CLOSED. Adapter signature aligned with Ravi's SQLite repo; deterministic Phase B abort no longer reproducible. Locked open against regression by `db-bridge.integration.test.ts` test 2 of `ocrJobs adapter`.
- **7.2.2** — CLOSED. Full sibling-adapter audit completed by David (5 of 5 had drift; formTemplates clean), all fixes landed in `491341f`, each covered by integration tests. The drift class as a whole is now ratcheted by the integration test file — any future Ravi-side signature evolution that breaks an adapter will fail the suite at PR time, not at e2e-Phase-B time months later.

### 8. 7.2.3 disposition

**DEFERRED to a future Diego dispatch.** Test-only channel registrations (`__test:whichBridge`, `__test:seedOcrJob`) are still gated at runtime via `process.env['NODE_ENV'] !== 'test'` early-return; channel name strings and handler bodies remain in `dist/main/index.js`. Risk model unchanged from the original STOP review — runtime gate holds for normal launches; an attacker with control of the parent environment could bind the channel by setting `NODE_ENV=test` before exec. Fix is a Vite `define: {'process.env.NODE_ENV': '"production"'}` constant in `electron.vite.config.ts` for the prod build, which would dead-code-eliminate both the registration AND the handler module bodies via constant-folded `if` branches. **Not a v0.7.20 blocker** — same risk has existed since v0.7.19's `__test:seedOcrJob`; the operational mitigation (packaged binary's parent env is the user's shell, not the network) holds. Marcus, route to Diego post-v0.7.20.

### 9. New finding — 7.2.4 (LOW/MED, forward-looking)

| ID    | Severity | Location                                                                                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status                 |
| ----- | -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 7.2.4 | LOW/MED  | `src/main/db-bridge.ts:1785-1808` (adapter) + `src/ipc/handlers/ocr-run-on-document.ts:376` (call site) | `signatureAudit.markInvalidatedByOcrJob(docHash, signedFields, jobId)` is now non-optional on the bridge contract and the adapter resolves docHash/fieldNames → rowIds → mark loudly (per David's L4 lesson). BUT no e2e spec exercises the PAdES+OCR invalidation backref end-to-end on a signed PDF. The integration test (`db-bridge.integration.test.ts` signatureAudit block, test 3) covers the SQL-layer round-trip in isolation, but the production path (signed PDF → OCR runs → audit rows resolved + marked) is unobserved. If the call site evolves (e.g. signedFields computed from a different upstream source) the failure would be silent until a user-reported "my signed PDF still shows valid after OCR." | OPEN — forward-looking |

Recommended remediation: Phase 7.3 e2e add a signed-PDF fixture, run OCR over it, assert at the audit-row level that `invalidated_at IS NOT NULL` and `invalidating_ocr_job_id` matches the run. Not a v0.7.20 blocker — the integration test closes the regression-against-known-shape risk; this addresses the production-wiring risk.

### 10. Closing

Wave 3 is complete. Recommend Marcus advance to Wave 4 (Nathan) for the v0.7.20 release-notes/user-guide refresh, then merge PR #1, then cut v0.7.20 via Diego's release ceremony.

---

## Phase 7.4 B1 — Redaction review (Julian, 2026-06-15)

**Verdict: GO-with-follow-up.** R1 rasterize-redact engine + handler + sanitize matrix + PAdES backref ship correctness-clean and lock-clean; the U-1 invariant is structurally proven; 137/137 redaction-scoped tests + 2067/2067 full vitest GREEN; one MED follow-up (renderer `as any` cast left over from parallel-wave coordination, now obsolete after David's preload landed), three LOW non-blockers. **No CRITICAL, no HIGH.** Safe to advance Marcus → Wave 4 (Nathan) once 7.4.B1.1 is filed.

### 1. R1 correctness walk (the non-negotiable)

**U-1 result:** `src/main/pdf-ops/redact-engine.test.ts` line 436 passes. The test runs the engine on a synthetic 1-page PDF carrying `REDACTME-NONCE-7a83b2`, redacts the full page, then asserts via structural probe (`pageContentStreamHasNoTextOps` + `pageContentStreamDrawsImage`) that the output page has (a) zero `/Font` entries in `Resources` and (b) at least one `/XObject` with `Subtype = /Image`. The probe is the right shape — no font → no `Tj/TJ` operator can show text. The David surprise #3 structural test exists, is named correctly, and runs GREEN.

**Sanitize matrix walk:** I cross-referenced each of Riley §3's 17 rows against the engine code at `redact-engine.ts:236-372`. The engine uses **rebuild-from-scratch** (`PDFDocument.create() + copyPages` for non-redacted, `addPage([w,h]) + drawImage` for redacted). The source catalog is NEVER copied — so #1 `/Info`, #2 XMP, #3 Names/JS, #4 EmbeddedFiles, #5 Outlines, #7 AcroForm, #9 OCProperties, #10 StructTree/MarkInfo/Lang, #11 Threads, #12 catalog-`/AA`, #13 PieceInfo/SpiderInfo are dropped by construction. #6 redacted-page annotations dropped because we `addPage` a brand-new raster page with no `/Annots`. #8 hidden/off-page content collapses in the rasterize step. #14 `useObjectStreams: false` is set at `save()` line 392. #15 `/ID` regenerated by pdf-lib. #16/#17 subsumed. Coverage is **17/17**. The U-8..U-15 test block plus the additional "catalog AA + PieceInfo + OpenAction get dropped" test (line 819) and U-22 warning-aggregation (line 776) jointly exercise the matrix.

**Rebuild-from-scratch verification:** `redact-engine.ts:238` calls `PDFDocument.create()` — fresh catalog. The only cross-doc transfer is `outDoc.copyPages(doc, [i])` on lines 269 (pass-through pages) which pdf-lib documents as copying only page content + resources, not catalog-level dicts. Belt-and-braces: `stripDocLevelJavaScript(outDoc)` is still called at line 382 even though rebuild already drops `/Names → /JavaScript` — Riley §4.3's explicit obligation honored, two paths to safety.

### 2. PAdES interaction walk

- **Detector call site:** `pdf-apply-redactions.ts:155-163` loads the source via `PDFDocument.load` and calls `detectPriorPadesSignatures(probeDoc)` — the 7.2.5-hardened path. Correct.
- **Confirm-flag gate:** `pdf-apply-redactions.ts:165-171` short-circuits with `signed_pdf_requires_confirm` + `{ fields: signedFields }` details when signatures exist and the flag is falsy. The engine is NOT called — verified by `pdf-apply-redactions.test.ts:209-225` (`engineCalled === false`). Matches `ocr-run-on-document.ts:179` pattern.
- **Audit backref:** `pdf-apply-redactions.ts:228-236` calls `signatureAuditRedaction.markInvalidatedByRedaction(docHash, signedFields)`; bridge → repo flows through `db-bridge.ts:1903-1920` (`raw.markInvalidatedByRedaction(docHash, fieldNames)`) → `signature-audit-repo.ts:690-710` which uses the per-arity prepared-statement cache.
- **SQL matches schema:** the UPDATE is `UPDATE signature_audit_log SET invalidated_by_redaction_at = (unixepoch() * 1000) WHERE doc_hash = @doc_hash AND field_name IN (@field_0, ..., @field_N)` (lines 492-495). It writes ONLY `invalidated_by_redaction_at` — no reference to a non-existent `invalidated_at` column, and `invalidated_by_ocr_job_id` is never touched (per Ravi's stated surprise #1 and design §5.3 co-existence rule). Confirmed against migration 0008 column shape.
- **Best-effort discipline:** the call site is try/catch-wrapped (handler line 230-235); a DB hiccup does not fail the redact Apply — mirrors OCR handler line 374. `tolerates bridge==null` + `tolerates bridge throwing` test cases pass (handler tests line 321 + 348).

### 3. Schema migration safety

Migration 0008: `ALTER TABLE signature_audit_log ADD COLUMN invalidated_by_redaction_at INTEGER` — additive, nullable, no NOT-NULL default. SQLite's `ALTER ADD COLUMN` is metadata-only (no table rewrite), no row mutation, no lock contention. Partial index `WHERE invalidated_by_redaction_at IS NOT NULL` is correct — sparse for the common case (most rows are not redaction-invalidated), keeps insert/update cost trivial. No FK constraints introduced. Schema version stamp deferred to the runner (line 39-43 of the migration comments), matching the Wave 7/12/16/20/24 ratchet — no PK conflict on retry. Migration runner has 64 repo tests + 25 bridge-integration tests covering the new column projection.

### 4. UI / UX walk

- **Sub-toolbar (`redaction-toolbar.tsx`):** non-modal, mounts via `ui.redactionPanelOpen`, same shape as `ShapeToolbar`. ESC handler closes without dispatching `clearMarks` — verified by component test (`redaction-tools.test.tsx`, see "Esc inside the sub-toolbar dispatches setRedactionPanelOpen(false) and does NOT dispatch clearMarks").
- **Apply modal:** `apply-redactions-modal.tsx` uses `role="alertdialog"` (line 108), cancel-default-focus via `useEffect` (no `autoFocus` lint trip), Apply button is `dangerButton` styled, disabled while `applying` or no marks. Trust-floor copy lives in i18n: `applyTitle = "Apply redactions — this cannot be undone"`, `applyBulletIrreversible`, `applyBulletRaster` (rasterize warning), `applySaveAsHint` (Save As callout), `applySignatureHeading` + `applySignatureBody` rendered when `invalidatedFields.length > 0`. Two-pass flow at line 58-65 (first dispatch no flag; second dispatch sets `alreadyConfirmed = invalidatedFields.length > 0`). Correct.
- **i18n:** both `en-US/modals.json` (16 redaction keys) and `es-ES/modals.json` (matching block at lines 300-336) populated. `src/client/i18n/coverage.test.ts` reports es-ES at 63% coverage (674/1070 keys) — within the proof-locale tolerance the project established for Phase 7. `coverage.test.ts` + `extraction-regression.test.ts` + the redaction-tools component test all GREEN.
- **Sub-toolbar test coverage:** 13 component tests pass (slice 12 tests, handler 23, engine 25, repo 64, db-bridge 25, i18n 56 — 137/137 redaction-scoped GREEN; full suite 2067/2067).

### 5. L-001 through L-006 compliance

- **L-001** (`enableDragDropFiles`): no `window-manager.ts` touch in any of the three Wave 2 commits. PASS.
- **L-002** (packaging screenshot): no packaging cut in Wave 2; Diego may produce one in Wave 3. N/A here. PASS.
- **L-003** (Node 20 baseline): no `engines.node` change, no native-dep introduced. Tests run locally on Node 24 only via the `scripts/rebuild-native-for-node.mjs` escape hatch — same pattern Riley/David used. CI matrix unchanged (Node 20). PASS.
- **L-004** (pdf.js buffer copy): the engine never calls `getDocument` directly. The handler's `rasterizePageByHandle` in `register.ts:647-651` routes to `ocr.rasterizePage`, which at `ocr-bootstrap.ts:751` constructs `getDocOpts.data = new Uint8Array(rec.bytes)` — a memcpy into a fresh ArrayBuffer (equivalent to `.slice()`). The redaction path inherits L-004 compliance for free. PASS.
- **L-005** (pdf.js polyfill order): the rasterize path uses `await loadPdfJs()` (the sole sanctioned helper) at `ocr-bootstrap.ts:727`. No new dynamic-import call site introduced. PASS.
- **L-006** (test-channel dot-syntax + Vite define-fold): no `__test:*` channel introduced by Wave 2. `pdf:applyRedactions` is a PROD channel with no NODE_ENV gate. L-006 doesn't apply. PASS.

### 6. CI status

Pushed `phase-7.4-b1-julian-review` (no source edits; only `docs/code-review.md`). CI run pending push; I cite the local equivalents which are the same gates CI runs:

- `typecheck` (main + preload + renderer): **GREEN** (all three tsc projects clean).
- `lint --max-warnings 0`: **GREEN** (no warnings).
- `vitest` full suite: **2067 passed / 0 failed / 185 files** in 28.08s.

CI run URL: https://github.com/SuperiorAg/PDF_Viewer_Editor/actions/runs/27554846448 (PR #2 https://github.com/SuperiorAg/PDF_Viewer_Editor/pull/2). At time of writing, `check (windows-2025-vs2026)` + `check (ubuntu-latest)` are QUEUED — pending CI confirmation. The Phase 7.1 e2e job runs on this PR per the dispatch. `build (windows-2025-vs2026)` packaging job runs on `main` push only — not on this PR per design.

### 7. Findings

| ID           | Severity              | Location                                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status |
| ------------ | --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| **7.4.B1.1** | MED                   | `src/client/state/thunks-phase7-4.ts:103-121` | `window.pdfApi.pdf as any` cast + `engine_failed` feature-detect message "(David Wave 2 not yet landed)" is a parallel-wave coordination scar. David's preload (commit `1078669`) now exposes `applyRedactions` as a typed method on `PdfApi.pdf` (verified via `preload/index.ts:275`). The cast can and should be removed: re-import `PdfApplyRedactionsRequest/Response` from `../types/ipc-contract` (or `../../ipc/contracts.js`) and drop the local re-declaration in this file. The feature-detect path becomes dead code (the typed call cannot return `undefined`); replace with a direct `await window.pdfApi.pdf.applyRedactions(req)`. Not a v0.7.20 blocker — the cast is correct at runtime — but it's a follow-up that should land before the slice ships to a user-tested build. | OPEN   |
| **7.4.B1.2** | LOW                   | `src/main/pdf-ops/redact-engine.ts:411-412`   | The "Re-run OCR" warning is **always** appended unconditionally (line 412 sits outside the `redactedSet` loop). On a 100-page doc with one rect on page 5, this warning fires whether or not the user even has OCR text on the other 99 pages. The disclosure is correct in spirit — at least one page was rasterized — but the comment at line 410-411 says "since we always rasterized at least one page" which is only true because the `no_redactions` early return at line 149 fires first. Cosmetic; the user-facing copy is honest. Defer to v2.                                                                                                                                                                                                                                          | OPEN   |
| **7.4.B1.3** | LOW                   | `src/main/pdf-ops/redact-engine.ts:374-385`   | The serialize/comment ordering is mis-numbered: comment `// 7.` appears twice (line 411 "Always emit the rasterize-loses-searchability warning" follows step 8 "Serialize"). Pure documentation drift; no functional impact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | OPEN   |
| **7.4.B1.4** | LOW (forward-looking) | n/a (R2 path)                                 | Riley §1.2 documents R2 (content-stream redact) as a future phase. The AcroForm-wholesale-drop trade-off (§4.2) means a doc with a filled form gets its filled values destroyed when redacting any page. The current warning "Form fields removed during redaction. Flatten the form first to keep filled values." is honest, but a user who didn't flatten first has lost data with no undo path. **Recommendation for a future phase:** offer to auto-flatten as part of Apply, behind a default-on checkbox in the modal. Not a v1 blocker.                                                                                                                                                                                                                                                   | OPEN   |

**No CRITICAL. No HIGH.** Zero blockers.

### 8. Forward-looking notes

1. **R2 candidate:** per Riley §1.2, R2 needs ~3-4 weeks of content-stream-walker work. When at least one enterprise user cites "searchability after redaction" as a blocker AND a fixture corpus exists, dispatch. Until then R1 + post-Apply "Run OCR" is the documented workflow.
2. **`as any` cast cleanup (7.4.B1.1):** the cleanup is **trivial** post-7.4.B1 land — one Riley-owned commit to `src/client/state/thunks-phase7-4.ts`. Bake into the Phase 7.4 B1 cleanup PR or fold into the next Riley wave.
3. **AcroForm wholesale-drop UX:** the documented warning is the right v1 surface. The Acrobat-style force-Flatten-first UI cliff is rejected (Riley §4.2) — auto-flatten checkbox in modal is a better v2 path.
4. **Sanitize-matrix ratchet candidate:** Riley §3's 17-row matrix is now a load-bearing security checklist. If a future PDF feature category surfaces (e.g. signed XML metadata streams, future PDF 2.0 collection items), it must extend the engine's rebuild-from-scratch invariant. Consider a Hard-Won Playbook entry on `redact-engine.ts` if Phase 7.4 B2/B3 expand the surface.
5. **Determinism floor:** U-23 asserts same-bytes-in → same-bytes-out for the engine. This will silently break the moment pdf-lib's serialization order drifts at a minor-version bump — the test catches that, but worth flagging on dependency-update PRs.

**Recommend Marcus advance to Wave 4 (Nathan) for v0.8.0 release-notes / user-guide refresh, file 7.4.B1.1 for the next Riley cleanup wave, and cut v0.8.0 via Diego's release ceremony (signal-grade enterprise feature → minor-version bump per Riley §9 recommendation 5).**
