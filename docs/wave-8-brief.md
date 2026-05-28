# Wave 8 brief — Phase 2 packaging + audit

**From:** Marcus (orchestration-manager), 2026-05-21
**Wave 7 integration verdict:** YELLOW (proceed; absorb known follow-ups in Wave 8)
**Parallel agents:** Diego (dev-ops-agent) + Julian (code-reviewer)
**Sequential prereq:** Wave 7 complete on disk (verified by Marcus this turn — see build-report.md "Wave 7 Integration — Marcus's Verdict").

Both agents read this brief end-to-end before starting. Then both read:

- `docs/build-report.md` — all Wave 7 status rows + Marcus's verdict section
- `.learnings/learnings.jsonl` — last 6 entries (Wave 7 agents' lessons)
- `.learnings/locked-instructions.md` — L-001 must survive
- `docs/architecture-phase-2.md` §2.2 (export engine), §3.2 (document-store bytes lifecycle), §5 (security floor)
- `docs/edit-replay-engine.md` §10 (atomic save), §12 (fidelity matrix)

Wave 7 ownership boundaries STILL apply. Diego owns `package.json`, `electron-builder.yml`, `.github/`, `scripts/`, `tsconfig.*.json`, ESLint/Prettier configs, `electron.vite.config.ts`, smoke `tests/e2e/`. Julian owns `docs/code-review.md` (append-only — DO NOT overwrite the Phase 1 section). Both READ all of `src/`. Neither writes Riley's, Ravi's, or David's source files (Wave 7 source is frozen; cross-agent fixes route through Marcus in a Wave 8.5 if required).

---

## Background — what Wave 7 shipped

David, Ravi, Riley ran Wave 7 in parallel and all delivered green status rows. Spot-check on disk by Marcus confirms:

| Surface | Verified on disk |
|---|---|
| `replay-engine.ts` exports `replay(input: ReplayInput): Promise<ReplayResult>` with 11 op handlers, pure (no FS/DB/network/console.log) | PASS |
| `migrations/0002_phase2_bookmarks.sql` matches `data-models.md` §7.3 DDL (parent_id FK CASCADE + sort_order + idx) | PASS |
| 9 new IPC channels live in `src/ipc/contracts.ts`; types match `api-contracts.md` §12 (sampled `pdf:embedImage`, `bookmarks:move`, `fs:applyEditOps`) | PASS |
| `src/client/types/ipc-contract.ts` re-exports Phase-2 types (gatekeeper boundary held; David's accidental direct-import was re-routed by Riley) | PASS |
| `src/client/state/middleware/history-middleware.ts` active (computes inverses, compacts image bytes, re-entrancy flag `meta.__history`) | PASS |
| `src/client/state/thunks.ts` `saveDocumentThunk` calls `api.fs.applyEditOps(...)` — H-3 PHASE-1 INLINE block GONE; the pdf-lib import is removed | PASS — Walking-skeleton goal #8 truly functional |
| `src/db/types.ts` Phase-2 SettingKey extension matches `src/ipc/contracts.ts` (no drift between Ravi and David) | PASS |
| File ownership: 150 source files, every path falls under exactly one owner | PASS |

The integration is clean enough to proceed. The YELLOW verdict is because **five known follow-ups must be absorbed in Wave 8** rather than dispatched as a separate remediation wave (see "Triage of Wave 7 discoveries" below).

---

## Triage of Wave 7 discoveries

| # | Discovery | Verdict | Owner in Wave 8 |
|---|---|---|---|
| 1 | `utif` runtime dep not in package.json; `tiff-decoder.ts` dynamic-imports it via string-variable to keep the build green | **FIX-NOW (Diego adds dep).** License is MIT (verified by Marcus against npm registry: `utif@3.1.0` license MIT). On the project's allow-list. | Diego |
| 2 | Chromium export adapter returns `engine_failed_chromium` stub; `pdf-export-pdf.ts` channel is live, the pdf-lib engine is live, only Chromium is deferred | **FIX-NOW (Diego wires).** This is packaging-adjacent work (offscreen `BrowserWindow` factory in `src/main/export/`, `webContents.printToPDF()` integration). Diego owns. Rolled into Wave 8 rather than a Wave 7.5 split because it touches Electron-lifecycle code Diego already owns from Wave 3. | Diego |
| 3 | `pdf:print` channel live but `dispatchPrint` adapter returns `print_dispatch_failed` stub; needs `webContents.print()` wiring | **FIX-NOW (Diego wires).** Same boundary as #2. Both adapters land in the same `src/main/export/` module. | Diego |
| 4 | `pdf:identifyTextSpan` scanner returns `no_text_at_point` — renderer's pdf.js hit-test is the Phase-2 substitute per architecture-phase-2.md §4.3 | **ACCEPT for Phase 2 ship — defer real scanner to Phase 2.5.** Renderer-cached font-metrics works as designed (verified by `text-edit-overlay.test.tsx`). Channel surface is type-correct; the real content-stream walker is a measurable Phase-2.5 ticket. Do NOT block Wave 8 on this. | (Phase 2.5 backlog) |
| 5 | Ravi's `MoveBookmarkResult` discriminated union (`cycle_detected` / `not_found` / `invalid_parent` / `ok`) is BETTER than data-models §7.5's `boolean`, but David's `src/main/db-bridge.ts` re-typed the adapter's `move(...)` as `boolean` and the IPC handler `bookmarks-phase2.ts` now INFERS cycle-vs-not_found from `newParentId === null`. The api-contracts §12.6 demand for distinct `cycle_detected` is at risk: a not-found bookmark moved under a real parent is misclassified as `cycle_detected`. | **YELLOW — fix at the bridge in Wave 8.5 (Marcus dispatches David), AND amend data-models §7.5 doc to match Ravi's shipped reality.** This is the schema-deviation-becomes-contract pattern from Wave 2 lesson #5 (`window:*` ACCEPT). The fix: (a) amend data-models §7.5 to specify `MoveBookmarkResult` union; (b) David widens `RaviBookmarksRepoPhase2.move` return type in `src/main/db-bridge.ts`; (c) `bookmarks-phase2.ts` switches on the variant directly instead of the request-shape heuristic. Julian flags during Wave 8 audit; Marcus dispatches a 30-min David patch as Wave 8.5 after Julian lands. | Julian (flag); Marcus + David (Wave 8.5) |
| 6 | Ravi's 5 SettingKey additions in `src/db/types.ts` were pre-emptively shipped without explicit brief authorization (to unblock David's typecheck) | **ACCEPT.** Verified Ravi's keys exactly match David's keys in `src/ipc/contracts.ts` — zero drift. The cross-wave coordination payoff Ravi documented in her learning is the right precedent. Note in build-report and move on. | (no-op) |

---

## Diego — Wave 8 task list (dev-ops-agent)

**Files Diego may touch:** `package.json`, `package-lock.json`, `electron-builder.yml`, `.github/workflows/*.yml`, `scripts/*.cjs`, `tsconfig.*.json`, `electron.vite.config.ts`, ESLint/Prettier configs, `tests/e2e/*.spec.ts`, `tests/fixtures/phase2/*` (test-only). NEW: `src/main/export/` module — Diego MAY create it (this is packaging-adjacent Electron lifecycle code, not application logic; Wave 3 precedent).

**Files Diego must NOT touch:** anything under `src/client/`, `src/db/`, `migrations/`, `src/main/pdf-ops/`, `src/ipc/`, `src/preload/`, the `src/main/window-manager.ts` file (L-001 — see below), `docs/architecture-phase-2.md`, `docs/edit-replay-engine.md`, `docs/api-contracts.md`, `docs/data-models.md` (these are frozen Phase-2 contracts — amendments route through Marcus in Wave 8.5).

### D-8.1 — Add `utif` runtime dep

Add to `package.json` dependencies:

```json
"utif": "^3.1.0"
```

Verify after install: `npm ls utif` shows it; `node -e "require('utif')"` runs without error. License is MIT (verified by Marcus). Update `LICENSES.md` with the new entry (one line in the existing table; Diego owns LICENSES.md row additions for any dep added in Wave 8 — Nathan rebalances the intro paragraph in Wave 9 only if license policy changes, which it doesn't here).

The `tiff-decoder.ts` dynamic-import will pick it up automatically (David built the graceful-degradation `tiff_decoder_unavailable` branch precisely so utif could land in Wave 8 without renderer changes). After Diego ships the dep, the smoke test should exercise a TIFF import path to confirm the dynamic-import succeeds.

### D-8.2 — Wire Chromium export adapter (`pdf:export` engine: `chromium`)

The replay engine + pdf-lib path is already Live (`pdf-export-pdf.ts`). The Chromium fallback returns `engine_failed_chromium` stub per architecture-phase-2.md §2.2 / §6.1 plan. Diego ships the real adapter.

**Approach (per architecture-phase-2.md §5 security floor):**

1. Create `src/main/export/chromium-export.ts`. Export a function `exportViaChromium(handle: DocumentHandle, destPath: string): Promise<Result<{}, ChromiumExportError>>`.
2. Construct an offscreen `BrowserWindow` with `webPreferences`:
   - `nodeIntegration: false`
   - `contextIsolation: true`
   - `sandbox: true`
   - `enableRemoteModule: false` (already deprecated in Electron 30+; explicit for audit)
   - `webSecurity: true`
   - `allowRunningInsecureContent: false`
   - `disableBlinkFeatures: 'Auxclick'`
   - **OMIT** `enableDragDropFiles` to preserve the Electron default `true` per L-001 (the offscreen window does not need drag-drop, but the explicit-omit pattern is the audit trail).
   - `show: false`
3. Load the in-memory bytes via a `data:application/pdf;base64,...` URL OR a temp file written under `app.getPath('temp')`. Prefer the temp-file path for PDFs >1MB (data: URLs balloon).
4. Wait for `did-finish-load`, then call `webContents.printToPDF({ printBackground: true, landscape: false })`.
5. Atomic-write the resulting buffer via the same temp+rename pattern `pdf-apply-edit-ops.ts` uses.
6. Destroy the BrowserWindow in a `finally` block (even on error). Defense against memory leaks.

**Wire into `register.ts`:** the `pdf-export-pdf.ts` handler currently receives a `chromiumExport` dep stub. Diego replaces the stub with the new function in `src/main/index.ts` deps wiring (similar pattern to `setDbBridge`).

**Test:** Add `src/main/export/chromium-export.test.ts` with at minimum: (a) successful round-trip of a 1-page synthetic PDF, (b) error path when destPath is invalid, (c) destruction-on-error covered.

### D-8.3 — Wire Electron print dispatch (`pdf:print`)

Similar pattern, simpler:

1. Create `src/main/export/print-dispatch.ts`. Export `dispatchPrint(handle: DocumentHandle): Promise<Result<{}, PrintDispatchError>>`.
2. Construct offscreen BrowserWindow same security floor as D-8.2.
3. Load PDF, await ready, call `webContents.print({ silent: false, printBackground: true })`.
4. Resolve when the print job is queued (Electron's print() returns immediately with a callback for success).
5. Destroy window in `finally`.

Wire into `register.ts` deps. Add `src/main/export/print-dispatch.test.ts` (mocked Electron `print` callback for unit test).

**L-001 reaffirmed:** every offscreen BrowserWindow created in D-8.2 / D-8.3 MUST inherit Electron's `enableDragDropFiles: true` default. Diego adds a regex assertion to `src/main/window-manager.test.ts` OR a new `src/main/export/security-floor.test.ts` that constructs every Wave-8 BrowserWindow factory and asserts `webPreferences.enableDragDropFiles !== false`. Pattern: same Vitest mock-electron approach Diego used in Wave 3.

### D-8.4 — CI must pass on Node 20 with Wave 7 source

The existing CI workflow (`.github/workflows/ci.yml`) runs typecheck/lint/test/build/package on Node 20. Diego verifies:

- `npm ci` succeeds after `utif` add (lockfile updates).
- `npm run typecheck` 0 errors across main / preload / renderer / test (Riley reported 0 renderer errors; David reported 0 main+preload; sanity-check after the `utif` dep lands — should remain 0 because tiff-decoder dynamic-imports via string variable).
- `npm run lint` 0 errors (warnings OK).
- `npm test` runs the full Vitest suite (189 main+ipc + 86 renderer + 37 db = 312 expected). The `better-sqlite3` D-1 ABI mismatch will NOT trigger on Node 20 because the prebuild matches; CI is the only place the db suite runs end-to-end.
- `npm run build` succeeds (electron-vite emits main/preload/renderer bundles).
- `npm run package` (electron-builder) produces NSIS installer + portable.

If any step fails, Diego logs to build-report status row and STOPS — do not push forward to D-8.5/D-8.6 with red CI.

### D-8.5 — `electron-builder.yml` review

Verify the new Wave 7 modules pack correctly into the main bundle:

- `src/main/pdf-ops/replay-engine.ts` and siblings (text-replace, image-embed, tiff-decoder).
- `src/ipc/handlers/pdf-apply-edit-ops.ts` and siblings (6 new handlers).
- `src/main/export/chromium-export.ts` and `print-dispatch.ts` (new from D-8.2 / D-8.3).

If `electron.vite.config.ts` already includes `src/main/**/*` via glob, no changes needed (Phase 1 pattern). If it lists explicit entries, Diego adds the new files.

`migrations/0002_phase2_bookmarks.sql` must be packaged as an asset (Phase 1 pattern in `electron-builder.yml` `files:` glob). Verify the existing glob picks it up: `npm run package` then unzip the produced .exe and confirm `migrations/` contains both `.sql` files.

Test-only fixtures under `tests/fixtures/phase2/` MUST NOT be packaged. The existing `electron-builder.yml` `files:` should exclude `tests/**` (verify; add `'!tests/**'` if missing).

### D-8.6 — Native-rebuild check: better-sqlite3 against schema v2

After the Wave 8 dep changes, run:

```
npx electron-builder install-app-deps
npm run test:main
```

This validates the rebuild-for-Electron-ABI binary still loads against `migrations/0002_phase2_bookmarks.sql`. Expected: 189 main+ipc tests still pass, with the migration runner correctly stepping from version 1 to version 2.

If `better-sqlite3` rebuild fails on Node-gyp issues, document the workaround in build-report (Wave 3 lesson: `npm install --ignore-scripts && electron-builder install-app-deps` is the escape hatch). The Wave 7 `npx vitest run src/db` D-1 ABI mismatch should NOT recur on CI (Node 20 prebuild matches); only the local-dev `vitest run src/db` requires the rebuild dance.

### D-8.7 — Smoke test: Phase 2 e2e flow

Update `tests/e2e/smoke.spec.ts` to exercise the H-3-closed flow:

1. Launch app via Playwright + Electron.
2. Open a synthetic 3-page PDF (use a tests/fixtures/phase2/3page.pdf — if not present, create it via pdf-lib in a beforeAll).
3. Rotate page 1 → 90deg (toolbar button or Ctrl+R shortcut).
4. Add a text annotation.
5. Press Ctrl+S, choose a Save-As destination via Playwright dialog stubbing (or use the `app:saveAs` mock).
6. Close the app, relaunch, reopen the saved file.
7. Assert: page 1 rotation is 90deg AND the annotation is present.

The assertion-7 is the H-3 closure proof. If it fails, that's a Wave-8.5 emergency back to David (the replay engine didn't actually replay).

If Playwright's Electron launch is too flaky for CI (Wave 3 history), gate the e2e step behind `if: github.event_name == 'workflow_dispatch'` — but the local-dev run must succeed at least once and be documented in build-report.

### D-8.8 — Document the Chromium engine integration approach

Append a "Wave 8 Chromium engine implementation notes" section to `docs/build-report.md` (Diego's row) explaining:

- Security floor inheritance from `src/main/window-manager.ts` (or the new `src/main/export/security-floor.ts` if Diego splits it).
- L-001 enforcement strategy (`enableDragDropFiles` default reaffirmed).
- Why offscreen BrowserWindow + temp-file PDF load over `data:` URL for >1MB documents.
- The destruction-in-finally pattern for memory hygiene.

This becomes a runbook entry. Optionally promote to `D:\Vault\Agents\Projects\PDF_Viewer_Editor\Runbooks\chromium-export.md` if Diego chooses.

### Diego deliverable summary

| Output | Format |
|---|---|
| `package.json` + `package-lock.json` updates | EDIT |
| `src/main/export/chromium-export.ts` + test | NEW |
| `src/main/export/print-dispatch.ts` + test | NEW |
| `src/main/export/security-floor.test.ts` (or extend window-manager.test.ts) | NEW or EDIT |
| `src/main/index.ts` deps-wiring extensions | EDIT |
| `electron-builder.yml` review (likely no changes) | VERIFY |
| `.github/workflows/ci.yml` (likely no changes) | VERIFY |
| `tests/e2e/smoke.spec.ts` + fixtures | EDIT or NEW |
| `LICENSES.md` `utif` row | EDIT |
| Status row appended to `docs/build-report.md` | APPEND |

---

## Julian — Wave 8 task list (code-reviewer)

**Files Julian may touch:** `docs/code-review.md` (APPEND a new "Wave 8 Phase 2 review" section — do NOT overwrite the Phase 1 section). Julian READS all of `src/`, all of `docs/`, all tests. No source edits.

**Files Julian must NOT touch:** any source under `src/`, `migrations/`, `tests/`. Findings flow to `code-review.md`; remediation is a separate wave.

### J-8.1 — Audit scope

Review every file in the Wave 7 deliverables matrix (rows from David, Ravi, Riley in `build-report.md` "Wave 7 ... 2026-05-21" sections). That's ~50 source files. Phase 1 review surfaced 4 HIGH / 14 MEDIUM / 13 LOW / 5 NIT — Phase 2 likely surfaces fewer per-file but the new surfaces matter more.

Findings ladder (same as Wave 3):

- **BLOCKER:** ships a bug that breaks a documented user flow OR violates a locked decision (P2-L-2/3/4/6 or L-001).
- **HIGH:** correctness defect that survives green tests (Wave 3 set the bar: "memory fallback IS the production bridge by accident").
- **MEDIUM:** maintainability / structure / performance / accessibility issues that don't break the user flow.
- **LOW:** style, naming, comment freshness.
- **NIT:** picky stuff.

### J-8.2 — Security focus areas

#### J-8.2.1 — Chromium offscreen window (Diego's D-8.2 / D-8.3)

If Diego finishes the offscreen-window code in time for Julian's pass, audit it for:

- `webPreferences` security floor: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`. CSP inheritance: confirm the offscreen window does NOT load arbitrary URLs (only data: or temp-file URLs under `app.getPath('temp')`).
- URL allowlist: any `loadURL` call MUST take a path Diego controls. No user-controlled URL leaks.
- L-001: `enableDragDropFiles` omitted (preserving default `true`). The exception NEVER goes to `false`.
- Destruction-in-finally: every `new BrowserWindow(...)` paired with a `try / finally { win.destroy() }`.

If D-8.2 / D-8.3 land AFTER Julian's pass, Julian flags as "deferred to Wave 8.5 review" and Diego's status row carries the unaudited-code marker.

#### J-8.2.2 — Image-embed buffer handling

`src/main/pdf-ops/image-embed.ts`:

- Is there a maximum-bytes-per-image cap? Bombing the document-store with a 10GB synthetic image would OOM main.
- Content-hash collision attacks: the cache dedups by SHA-256 (or similar) of `image.bytes`. Verify it's a cryptographic hash (not Murmur, not FNV), 256+ bits, and consumed via `node:crypto`.
- MIME-type validation: `detectImageMimeType` MUST reject unknown signatures (returns `unsupported_image_format` per `data-models.md` §7.7). Don't trust the renderer's declared MIME.

#### J-8.2.3 — Text-replace input sanitization

`src/main/pdf-ops/text-replace.ts`:

- `newText` is user-controlled and gets drawn via pdf-lib `drawText(newText, ...)`. pdf-lib escapes content-stream characters, but verify by inspecting the produced output for any test fixture with embedded `(` / `)` / `\` characters. PDF content-stream injection is a real concern.
- Max-length cap on `newText`? A 100MB string would balloon the saved PDF.

#### J-8.2.4 — Bookmarks tree cycle detection coverage

`src/db/repositories/bookmarks-repo.ts` `move()`:

- Tested for trivial cycle (self-as-parent) ✓ (Ravi's tests cover it)
- Tested for deep cycle (A→B→C, move A under C) ✓
- Cross-file parent attempts ✓ (`invalid_parent` variant)
- Adversarial input: malformed tree (parent_id pointing to nonexistent row, parent_id pointing to a different file's bookmark). Ravi flagged "orphaned rows promoted to root in listTree" — verify that `move()` doesn't go into the 10,000-hop loop on a deliberately-cyclic legacy database (e.g. if a future migration introduces a cycle, does the safety cap catch it?).

### J-8.3 — Replay-engine purity verification

`grep -rn "from 'fs'\|from 'node:fs'\|from 'node:path'\|better-sqlite3\|console\." src/main/pdf-ops/replay-engine.ts src/main/pdf-ops/text-replace.ts src/main/pdf-ops/image-embed.ts src/main/pdf-ops/tiff-decoder.ts`

Expected: ZERO hits except in comments (and `node:crypto` for content-hash; `node:zlib` for PNG re-encode; both pure-computation modules that don't touch external state). Marcus already verified `replay-engine.ts` — Julian verifies the siblings.

If any pdf-ops module imports `node:fs` directly, that's a HIGH (the engine must remain pure so it can be unit-tested without FS mocking).

### J-8.4 — Atomic-save pattern check

`src/ipc/handlers/pdf-apply-edit-ops.ts`:

- Temp-file path generated under SAME directory as destination (not `os.tmpdir()` — cross-volume rename can be non-atomic on Windows).
- Pattern: `.{basename}.tmp-{pid}-{ts}`.
- `unlink(tempPath).catch(() => {})` on error path (don't leak the temp file).
- `rename()` (NOT `copyFile + unlink`) — atomic on Windows-NTFS within the same volume.

Marcus already verified the temp+rename present in lines 122-131. Julian verifies the failure-path cleanup and the same-directory invariant.

### J-8.5 — Memory leak check: document-store bytes retention

`src/main/pdf-ops/document-store.ts`:

- Is there a bound on `getTotalBytesHeld()`? A user opening 100 large PDFs without closing them would OOM.
- LRU eviction policy or cap (per architecture-phase-2.md §3.2). If absent, this is MEDIUM (Phase 2 lives; Phase 3 multi-document may hit it).
- `setBytes()` on close (or document unload) — verify the store releases the bytes (no orphan retention).

### J-8.6 — History-middleware re-entrancy guard correctness

`src/client/state/middleware/history-middleware.ts`:

- `meta.__history === true` check at top of the function (must short-circuit before `pushEntry`). Marcus verified the structure; Julian verifies the EXHAUSTIVENESS — any code path that dispatches into the middleware without setting the flag would infinite-loop.
- Riley's test covers 3 cases (push, undo, redo). Are there edge cases not covered? E.g., a non-undoable action between two undoable ones — does the past stack stay correctly ordered?

### J-8.7 — The renderer-gatekeeper boundary (Riley's catch on David's drift)

This is the **Wave 7 process win Julian should formalize as a convention recommendation**:

- Riley's catch (`FsApplyEditOpsRequest` direct-imported from `../../ipc/contracts` rerouted through gatekeeper) reinforces conventions §4.3.
- Diego's Wave 3 ESLint `no-restricted-imports` rule should already enforce this. Julian verifies the rule is configured to flag imports from `../../ipc/contracts` in any file under `src/client/` except `src/client/types/ipc-contract.ts`.
- If the rule is absent or misconfigured, this is HIGH (the gatekeeper boundary depends on it; manual catches are not scalable).

If the rule is present and the lint passes clean: NIT — recommend Riley's catch be promoted to a `## Lessons` row in `conventions.md` §4.3.

### J-8.8 — `MoveBookmarkResult` boundary issue (Marcus's spot-check finding)

This is the **load-bearing Wave 7 finding** Julian must escalate:

- `src/main/db-bridge.ts` adapter types `move()` return as `boolean`.
- `src/db/repositories/bookmarks-repo.ts` actually returns `MoveBookmarkResult` (`'ok' | 'cycle_detected' | 'not_found' | 'invalid_parent'`).
- `src/ipc/handlers/bookmarks-phase2.ts` heuristically maps `false + newParentId === null` → `not_found`, `false + newParentId !== null` → `cycle_detected`. A genuine `not_found` with a non-null parent gets MIS-CLASSIFIED as `cycle_detected`. A genuine `invalid_parent` gets MIS-CLASSIFIED similarly.
- `docs/api-contracts.md` §12.6 promises distinct `cycle_detected` — current implementation breaks the promise.

Severity: HIGH or MEDIUM (depending on whether Julian considers heuristic-misclassification a correctness defect or a UX nuisance). Marcus's recommended remediation:

- Amend `docs/data-models.md` §7.5 to specify the union (Ravi's shipped reality is better; Wave 2 lesson #5 reality-amendment > spec-retraction).
- Patch `src/main/db-bridge.ts` to widen `RaviBookmarksRepoPhase2.move` return type to `MoveBookmarkResult` and update the adapter to map directly to the IPC `Result` variants.
- Patch `src/ipc/handlers/bookmarks-phase2.ts` to switch on the variant, not the request shape.

Marcus dispatches this as a Wave 8.5 30-minute David patch IF Julian rates it HIGH or above. If MEDIUM, fold into Phase 2.5 backlog.

### Julian deliverable summary

| Output | Format |
|---|---|
| `docs/code-review.md` — APPEND `## Wave 7 Phase 2 review` section | APPEND (do NOT overwrite Phase 1 section) |
| Status row in `docs/build-report.md` summarizing findings count by severity | APPEND |
| Specific recommendations for Marcus's Wave 8.5 dispatch decision (if any HIGHs) | INLINE in code-review.md |

---

## Locked-decision compliance check (mandatory for both agents)

Before submitting status rows, both agents grep their touched files for `enableDragDropFiles` and `webPreferences`:

- Diego: any new BrowserWindow in `src/main/export/*` MUST NOT set `enableDragDropFiles: false`. The test must catch this regression.
- Julian: audit confirms L-001 holds across the Phase 2 surface (David, Riley both reaffirmed; Diego's new offscreen windows are the new exposure surface).

Also verify the 4 P2-locked decisions hold:

- **P2-L-2 (main keeps bytes per handle):** Renderer holds zero bytes (Riley); `document-store.ts` retains bytes (David). No Uint8Array smuggle into Redux store.
- **P2-L-3 (replace-only text editing with original font):** `text-replace.ts` ships stamp-overlay (not reflow). No automatic font substitution in the engine.
- **P2-L-4 (image-import dual-mode):** `image-import-modal/` supports new-page (5 positions) + overlay. PNG/JPEG/TIFF format set.
- **P2-L-6 (PDF-native annotations, no sidecar):** Annotations flow through replay engine into PDF bytes. No `.annotations.json` sidecar files.

All four locked decisions verified by Marcus on disk this turn (see build-report verdict section). Diego and Julian must NOT regress any of them.

---

## Wave 8 success criteria

GREEN to dispatch Wave 9 (Nathan documentation) when ALL of:

1. `utif` dep added and `npm test` green (Diego D-8.1).
2. Chromium export adapter live; e2e smoke test exercises a Chromium-export round-trip OR Diego flags reason for deferral with build-report (Diego D-8.2).
3. Print dispatch adapter live; manual smoke captured in screenshot OR e2e drives a print job (Diego D-8.3).
4. CI green on Node 20 across typecheck/lint/test/build/package (Diego D-8.4).
5. Smoke test passes the H-3-closure proof (open → edit → save → reopen → verify edits) (Diego D-8.7).
6. Julian's code-review.md Wave 7 review section appended with severity counts (Julian J-8.1).
7. Any Wave-7 HIGHs Julian surfaces get a Wave 8.5 disposition (Marcus dispatches David patch, or backlog-defers, before Wave 9).
8. L-001 + 4 P2-locked decisions verified intact by both agents.

YELLOW to proceed if 1-4 pass but 5-7 partial. RED if any of 1, 2, 3, 8 fail.

---

## Post-wave learnings ratchet

After Wave 8 closes, Marcus rotates these into `.learnings/learnings.jsonl`:

- The `MoveBookmarkResult` schema-deviation-becomes-contract pattern (Ravi's better shape → doc amendment, not spec-retraction).
- The renderer-gatekeeper-must-be-actively-defended lesson (Riley's catch on David's drift, formalized via ESLint rule).
- The H-3 closure precedent (Phase-N walking-skeleton fidelity boundary retired by Phase-N+1's real engine).

---

## Marcus dispatch path (in this session)

Marcus's Task tool is NOT loaded in the current session (established pattern since Wave 1). The main session dispatches Diego and Julian in parallel by reading this brief and the Wave 7 build-report. No further action required from Marcus until Wave 8 status rows land in `docs/build-report.md`.
