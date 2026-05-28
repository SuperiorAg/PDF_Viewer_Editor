# Wave 3.5 Brief — Remediation Delta (David + Riley, parallel)

**Author:** Marcus (Chief Delivery Officer)
**Date:** 2026-05-21
**Status:** Drafted, awaiting user dispatch go-ahead.
**Why this wave exists:** Wave 3 closed YELLOW. Diego shipped a green build + a signed-installer-ready package; Julian filed 4 HIGH findings. Three of those HIGHs (H-1, H-2, H-3) **individually defeat the Phase-1 walking-skeleton acceptance criteria** even though `npm run build` succeeds and 136/172 tests pass. We do not ship Wave 4 docs describing an app that doesn't persist state, re-renders every frame, and fails to save. This wave closes those three plus the type/lint debris Diego flagged in Issues D-2 and D-3.

Both agents work in parallel. No file conflicts: David owns main-process + IPC + thunk file. Riley owns renderer state, components, conventions doc, and renderer test. Marcus does not amend `docs/api-contracts.md` — Julian's H-3 is implementation drift from the contract, not contract drift from reality (see §4 below for the rationale).

---

## 0. Required reading (both agents)

Before any edit:

- `d:/Projects/PDF_Viewer_Editor/CLAUDE.md` — project rules
- `d:/Projects/CLAUDE.md` — swarm rules
- `d:/Projects/PDF_Viewer_Editor/docs/code-review.md` — Julian's full review (read all of it, not just your assigned HIGHs — context for the MEDIUM/LOW backlog Phase-1.1 will absorb)
- `d:/Projects/PDF_Viewer_Editor/docs/build-report.md` — Wave 3 sections (Diego + Julian status rows) and "Wave 3 Integration — Marcus's Verdict" below
- `d:/Projects/PDF_Viewer_Editor/docs/api-contracts.md` §3.2 (`fs:writePdf`) — pay close attention to the `payload` union; the contract is right, the renderer is wrong
- `d:/Projects/PDF_Viewer_Editor/docs/conventions.md` §6.3 — Riley owns the §6.3 amendment
- `.learnings/learnings.jsonl` (last 200 lines) and `c:/Users/ahudson/.claude/learnings/global.jsonl` (filter on your own `agent` slug — `backend-engineer` for David, `front-end-architect` for Riley)
- `.learnings/locked-instructions.md` — L-001 must continue to hold; do not change `enableDragDropFiles` handling

---

## 1. David — Senior Backend API Engineer (slug: `backend-engineer`)

### Owns (writes):

- `src/main/index.ts` — wire `setDbBridge` in `bootstrap()`
- `src/client/state/thunks.ts` — fix `saveDocumentThunk` payload selection (renderer-side Phase-1 path, see §1.3)
- `src/ipc/handlers/bookmarks.ts` — TS2379 fix
- `src/main/db-bridge.ts` — TS2379 fix (lines 226, 251)
- May touch (read-only, no edits): `src/db/repositories/*` to confirm Ravi's factory signatures; `src/db/connection.ts` for `initDatabase` signature

### Does NOT touch:

- Anything under `src/client/components/`, `src/client/state/slices/` (Riley)
- `src/client/components/error-boundary/index.tsx` (Riley — TS4114 fix)
- `src/client/state/slices/selection-slice.test.ts` (Riley — frozen-sort fix)
- `docs/conventions.md` (Riley)
- `package.json`, ESLint/Prettier configs, electron-builder, CI workflows (Diego owns those, untouched this wave)
- `docs/api-contracts.md` (Marcus — no amendment needed per §4 verdict below)

### Tasks

#### 1.1 H-1 — Wire `setDbBridge` in `bootstrap()` (BLOCKER for Phase-1 ship)

**Where:** `src/main/index.ts:bootstrap()` (around line 84–101 per Julian's review).

**Current state:** `bootstrap()` registers IPC handlers but never calls `setDbBridge(...)`. The in-memory `MemoryDbBridge` defined in `src/main/db-bridge.ts` is therefore the production code path. Recents/settings/bookmarks reset on every app restart.

**Required wiring** (Julian's recommended shape from `code-review.md:111`):

```ts
import { app } from 'electron';
import { join } from 'node:path';
import { initDatabase } from '../db/connection.js';
import { createRecentFilesRepo } from '../db/repositories/recent-files-repo.js';
import { createBookmarksRepo } from '../db/repositories/bookmarks-repo.js';
import { createSettingsRepo } from '../db/repositories/settings-repo.js';
import { adaptRecentsRepo, adaptBookmarksRepo, setDbBridge } from './db-bridge.js';

// inside bootstrap(), after app.whenReady() and BEFORE registerIpcHandlers:
const db = initDatabase({
  dbPath: join(app.getPath('userData'), 'pdf-viewer-editor.db'),
});
setDbBridge({
  recents: adaptRecentsRepo(createRecentFilesRepo(db)),
  bookmarks: adaptBookmarksRepo(createBookmarksRepo(db)),
  settings: createSettingsRepo(db),  // no adapter needed — settings is key-based
});
```

**Migrations directory resolution:** `initDatabase` resolves the migrations directory differently in dev vs packaged Electron. If `initDatabase` needs an explicit `migrationsDir` for the packaged app (where `process.cwd()` is unreliable), pass `join(app.getAppPath(), 'migrations')`. Verify against Ravi's `initDatabase` signature in `src/db/connection.ts` and `src/db/migrate.ts` — Ravi's status row in `build-report.md` calls this out as a known handoff point. If a `migrationsDir` option exists, use it; otherwise rely on the cwd-probe default and add a one-line TODO.

**Error handling:** Wrap the `initDatabase` + `setDbBridge` block in a try/catch. On failure, log via `console.error` (the codebase doesn't have `electron-log` wired yet per Phase 1 plan), surface a single "Database initialization failed; running in non-persistent mode" toast at the renderer once the window is ready, and continue to register handlers — the in-memory bridge is the safe fallback. Do NOT call `app.quit()`; an app that crashes on first launch because of a corrupted SQLite file is worse than an app that runs with non-persistent state.

**Acceptance:**
- Launching the packaged app (`release/PDF Viewer & Editor-0.1.0-x64-portable.exe` or the installer) and confirming via Recents that an opened file survives a restart. **Diego or the user manually verifies this** — David's automated test for this would require booting Electron, which is the e2e path, not the unit path.
- No regression in existing 172-test suite (allowing for the 35 ABI-mismatch failures that are environmental).

#### 1.2 H-3 — Fix `saveDocumentThunk` payload selection

**Where:** `src/client/state/thunks.ts:111-161` (the `saveDocumentThunk` definition).

**The bug:** thunk always sends `payload.kind: 'ops'` (lines 135–141). Phase-1 `handleFsWritePdf` rejects `kind: 'ops'` as `invalid_payload` because `applyOpsToBytes` is not injected yet (Phase-2 work). End result: every Save click in the shipped Phase-1 app fails.

**The contract is correct.** `api-contracts.md` §3.2 defines:

```ts
payload:
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'ops'; originalHandle: DocumentHandle; ops: ...; annotations: ... };
```

Phase-1 ship must use the `bytes` branch. Phase-2 wires the `ops` branch.

**Required Phase-1 fix:**

Replace the `payload: { kind: 'ops', ... }` block in `thunks.ts` with logic that **always** sends `{ kind: 'bytes', bytes: <original bytes round-tripped from the open handle> }` in Phase 1, since the renderer has no pdf-lib edit-engine wired yet. The current document's edits (rotations, deletes, annotations) are NOT yet persisted to bytes — `pdf-edit.ts` is a stub per Riley's Wave-2 status row and Julian's review §D. So Phase-1 Save is semantically "save the original bytes back to a user-chosen destination" — a degenerate Save that proves the IPC pipe works end-to-end and seeds the Phase-2 work.

**Two acceptable Phase-1 implementations** (pick the simpler):

1. **Round-trip the open handle's bytes.** Add a `getDocumentBytes(handle)` method to David's preload-exposed `api.fs.*` surface that returns the bytes main holds for the open document. The renderer reads, then writes. Adds a new IPC channel. **NOT recommended for this wave** — channel surface change spills past Phase-1 scope.
2. **Recommended:** at `setDocument(...)` time the renderer already receives bytes via `dialog:openPdf` → `fs:readPdf` value? **Check:** read `src/client/state/slices/document-slice.ts` and `src/client/state/thunks.ts:setDocument` flow to confirm whether `bytes` are held in renderer state. They are NOT today (`PDFDocumentModel` per data-models has no `bytes` field, and conventions §10 explicitly forbids `Uint8Array` in store). So this path needs the renderer to re-read via a new channel anyway.

**Pragmatic third option:** keep the `ops` branch in the thunk BUT also add a `applyOpsToBytes` shim wired in David's main process that simply returns the open document's original bytes verbatim (no actual replay). Document the shim in a comment. This satisfies the IPC contract round-trip without touching the renderer, requires no new channel, and makes Save succeed end-to-end on the walking skeleton. Phase 2 swaps the shim for the real pdf-lib replay.

**This wave: use option 3.** Concretely:

- In `src/main/index.ts:bootstrap()`, after `registerIpcHandlers`, the registrar already wires `handleFsWritePdf` with deps. Diego's IPC `register.ts` constructs the deps object inline. Modify the dep build (or add a wrapping factory in `db-bridge.ts` neighbours — David's call) so `applyOpsToBytes` is injected with a one-line Phase-1 shim:

  ```ts
  applyOpsToBytes: async ({ originalBytes }) => originalBytes,
  ```

  Add a `// Phase 1 shim: returns originalBytes unchanged. Phase 2 wires the pdf-lib replay engine per ARCHITECTURE §7.` comment immediately above.

- **Do NOT touch the thunk** — the contract says `ops` is the right payload kind when the renderer holds ops + annotations and lets main do the replay. The thunk is correct; main was missing the dep. This realigns the implementation to the contract instead of the other way around.

**Acceptance:**
- `Ctrl+S` on an opened PDF surfaces "Saved X.pdf (Y bytes)" success toast.
- The saved file exists at the chosen destination and opens in a separate reader.
- `handleFsWritePdf` test suite continues to pass (the existing test of the `'ops' rejected when deps.applyOpsToBytes undefined'` path still works — David's deps in tests don't inject the shim; production deps do).

**Note for Julian's re-audit:** the shim is correct contract-wise but functionally a no-op. The H-3 followup at Phase 2 must replace it with the real engine. This wave only restores walking-skeleton correctness (Save round-trips bytes); it does not implement editing-persistence.

#### 1.3 D-2 — Fix 5 TS2379 errors (`exactOptionalPropertyTypes`)

Diego's `npm run typecheck:main` fails with 5 TS2379 errors:

- `src/ipc/handlers/bookmarks.ts:80`
- `src/main/db-bridge.ts:226`
- `src/main/db-bridge.ts:251`
- `src/main/index.ts:97` (`CreateMainWindowOptions.rendererUrl`)
- `src/main/index.ts:111` (`CreateMainWindowOptions.rendererFile`)

**Pattern:** assigning `number | undefined` (or `string | undefined`) into an optional property that's typed as `number` (without `| undefined`). Either:
- Widen the property type to `T | undefined`, OR
- Use conditional spread: `...(value !== undefined ? { id: value } : {})`

Diego's brief recommends the conditional-spread pattern at the assignment site to avoid widening the contract types. Apply that pattern. The `index.ts:97,111` cases for `rendererUrl`/`rendererFile` are mutually exclusive options on the window factory — conditional spread fits there cleanly:

```ts
new BrowserWindow({
  ...(rendererUrl !== undefined ? { rendererUrl } : {}),
  ...(rendererFile !== undefined ? { rendererFile } : {}),
  // ...
});
```

**Acceptance:** `npm run typecheck:main` returns 0 errors.

#### 1.4 Lint errors in David's files

Diego's `npm run lint` reports `no-control-regex` in `src/main/security/path-sanitizer.ts`. That regex (control-character rejection in path validation) is intentional and required. Add an inline ESLint disable with justification:

```ts
// eslint-disable-next-line no-control-regex -- intentional: path-sanitizer rejects control chars by design (security floor)
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
```

Apply to any other `no-control-regex` hits in `src/main/security/*` or `src/ipc/handlers/*`. Do NOT touch lint errors in Riley's renderer files (those are Riley's in §2.4).

**Acceptance:** `npm run lint` reports 0 errors in `src/main/**` and `src/ipc/**`. Warnings may remain — only errors block.

### David's deliverables checklist

- [ ] `src/main/index.ts` — `setDbBridge` wired in `bootstrap()` with try/catch fallback
- [ ] `src/main/index.ts` + `src/ipc/register.ts` (read-only verify) — Phase-1 `applyOpsToBytes` shim injected at handler registration
- [ ] `src/ipc/handlers/bookmarks.ts` — TS2379 fix
- [ ] `src/main/db-bridge.ts` — TS2379 fix (×2 sites)
- [ ] `src/main/index.ts` — TS2379 fix on rendererUrl/rendererFile (×2 sites)
- [ ] `src/main/security/path-sanitizer.ts` (and any other main/ipc `no-control-regex` site) — eslint-disable with justification comment
- [ ] `.learnings/learnings.jsonl` entry per protocol (return as JSON object, do NOT write the file yourself — Marcus appends serially after the wave joins; see §5 below)

---

## 2. Riley — VP of Product Design & Frontend Engineering (slug: `front-end-architect`)

### Owns (writes):

- `src/client/state/slices/document-selectors.ts` — H-2 memoization fix
- `docs/conventions.md` §6.3 — retract the broken factory-selector pattern
- `src/client/components/pdf-canvas/*` — update consumer to use the new parameterized selector signature
- Any other `useAppSelector(selectXForY(y))` call sites — Riley audits via grep and updates each
- `src/client/components/error-boundary/index.tsx` — TS4114 `override` fix
- `src/client/state/slices/selection-slice.test.ts` — frozen-array-sort fix
- jsx-a11y warning hotspots: `src/client/components/thumbnail-strip/index.tsx`, `src/client/components/thumbnail-strip/thumbnail-item.tsx`

### Does NOT touch:

- Anything under `src/main/`, `src/ipc/`, `src/preload/`, `src/db/`, `src/shared/` (David / Ravi)
- `src/client/state/thunks.ts` (David owns this turn; the H-3 fix is in main, not the thunk)
- Root configs (Diego)
- `docs/api-contracts.md`, `docs/data-models.md`, `docs/ui-spec.md`, `ARCHITECTURE.md` (frozen)

### Tasks

#### 2.1 H-2 — Fix factory selectors and update conventions §6.3 (BLOCKER for Phase-1 ship)

**Where:**
- Code: `src/client/state/slices/document-selectors.ts` — `selectAnnotationsForPage` and `selectPage`
- Doc: `docs/conventions.md` §6.3 (the `selectPage = (pageIndex) => createSelector(...)` example endorses the broken pattern)
- Consumer: `src/client/components/pdf-canvas/*:31` (per Julian, `PdfCanvas` calls `useAppSelector(selectAnnotationsForPage(props.index))` inside render — defeats memo)
- Also audit: grep `useAppSelector\(select.*\(` across `src/client/` to find every factory-selector consumer.

**Current broken pattern:**

```ts
// ❌ DEFEATS MEMOIZATION
export const selectAnnotationsForPage = (pageIndex: number) =>
  createSelector(
    (s: RootState) => s.document.current?.annotations ?? [],
    (annotations) => annotations.filter((a) => a.pageIndex === pageIndex),
  );

// usage in PdfCanvas:
const annotations = useAppSelector(selectAnnotationsForPage(props.index));
// ↑ new createSelector instance every render → cache miss every time → new array reference → react-redux schedules another render
```

**Required parameterized-selector pattern (use this):**

```ts
// ✅ MEMOIZED CORRECTLY
import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../store';

const selectAnnotationsList = (s: RootState) => s.document.current?.annotations ?? [];
const selectPageIndexArg = (_s: RootState, pageIndex: number) => pageIndex;

export const selectAnnotationsForPage = createSelector(
  [selectAnnotationsList, selectPageIndexArg],
  (annotations, pageIndex) => annotations.filter((a) => a.pageIndex === pageIndex),
);

// usage in PdfCanvas:
const annotations = useAppSelector((s) => selectAnnotationsForPage(s, props.index));
```

Same shape for `selectPage`. The selector is created **once** at module scope; subsequent calls with the same `(state, pageIndex)` pair return the cached array reference. The default `reselect` cache size is 1, which is fine for a single-page-at-a-time render. If multiple pages render simultaneously (thumbnail strip + main canvas), bump the cache via `createSelector` factory options:

```ts
import { createSelectorCreator, lruMemoize } from 'reselect';
const createPagedSelector = createSelectorCreator(lruMemoize, { maxSize: 32 });
```

**Note on RTK version:** `@reduxjs/toolkit@2.2` re-exports `createSelector` from `reselect@5.x`. Per `reselect@5` docs, `createSelector` uses a `weakMapMemoize` by default for the standalone import; RTK's re-export may pin a different memoizer. **Verify via the RTK 2.2 source** that the default cache size handles the multi-page case before assuming `maxSize: 32` is needed. If RTK's default is already LRU with adequate size, drop the custom creator.

**Then update `docs/conventions.md` §6.3:**

Replace the broken example with the parameterized one. Add a NOTE block:

> **Anti-pattern (do not use):** A "factory selector" that returns a fresh `createSelector` per call (`selectX = (arg) => createSelector(...)`) defeats memoization when called inside `useAppSelector` — every render builds a new selector, the cache is always cold, and `react-redux` schedules another render off the new reference. Use the parameterized form (state, arg) instead. This is enforced by code review until a custom ESLint rule lands (Phase-2 backlog).

Add a one-line cross-reference to `docs/code-review.md` H-2 finding so the next reader sees the source of the amendment.

**Acceptance:**
- `npm run lint` and `npm run typecheck:renderer` clean for the changed files.
- A new Vitest case in `src/client/state/slices/document-selectors.test.ts` asserts memoization: call `selectAnnotationsForPage(state, 0)` twice with the same state and assert both calls return the **same array reference** (`===` identity, not just deep-equal). If the convention amendment authorizes a different pattern (e.g. RTK 2.2's default memoizer is sufficient without `maxSize`), pin the assertion to that behaviour explicitly so a future regression is caught.
- Render-loop check: a Vitest case (or a comment-flagged manual smoke note) confirming `PdfCanvas` re-renders only when its dependencies actually change. Riley's call on which form is testable in jsdom.

#### 2.2 D-3 — Fix frozen-array-sort in `selection-slice.test.ts`

**Where:** `src/client/state/slices/selection-slice.test.ts` (per Diego's report — test mutates a frozen RTK reducer result via `.sort()` and throws `Cannot assign to read only property '0' of object '[object Array]'`).

**Fix:** clone before sorting.

```ts
// before:
const result = selectionReducer(state, action);
expect(result.selectedPageIndices.sort()).toEqual([1, 2, 3]);

// after:
const result = selectionReducer(state, action);
expect([...result.selectedPageIndices].sort()).toEqual([1, 2, 3]);
```

**Acceptance:** `npm test` for this file passes.

#### 2.3 D-2 — Fix TS4114 in `error-boundary/index.tsx`

**Where:** `src/client/components/error-boundary/index.tsx:14` per Diego's report.

**Fix:** add the `override` modifier to the React lifecycle method that overrides a base class member. Likely `componentDidCatch` and/or `getDerivedStateFromError` (note: the latter is `static`, so it inherits differently — verify which method TS is complaining about):

```ts
override componentDidCatch(error: Error, info: ErrorInfo): void {
  // ...
}
```

Also: Julian's LOW finding (`error-boundary/index.tsx:35`) flags rendering `error.message` directly to the user. **Do NOT fix that in this wave** — it's a LOW backlog item for Phase-1.1, not a HIGH. Keep scope tight.

**Acceptance:** `npm run typecheck:renderer` clean.

#### 2.4 jsx-a11y warnings in `thumbnail-strip/*` and `thumbnail-item.tsx`

Diego's lint reports `jsx-a11y/no-noninteractive-*` warnings on Riley's thumbnail strip + item. Per Julian's MEDIUM finding (review §I): `<li>` is draggable + click-handled but has no keyboard activator.

**Two-part fix:**

1. **Lint hygiene (this wave):** add inline ESLint disables with justification where the element really is interactive but the rule misfires (drag-drop `<li>` is a known false-positive shape). Use `// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- li is keyboard-activated via onKeyDown handler below; Phase 7 a11y audit will refactor to proper listbox` and similar.

2. **Phase-1 minimal keyboard nav (this wave, ONLY if it's a 10-minute add):** `tabIndex={0}`, `role="option"` on the `<li>`, `onKeyDown` mapping Enter+Space to onClick. **Skip arrow-key focus management and Delete-key — that's Phase 7.** If the 10-minute estimate slips to 30+ minutes, defer the whole keyboard-nav pass to Phase-1.1 and just add the eslint-disable comments.

**Acceptance:** `npm run lint` reports 0 errors. Warnings count may drop or stay similar; not a blocker.

### Riley's deliverables checklist

- [ ] `src/client/state/slices/document-selectors.ts` — parameterized memoized selectors
- [ ] `src/client/state/slices/document-selectors.test.ts` — memoization assertion test added
- [ ] `src/client/components/pdf-canvas/*` and any other call sites — updated to `(s, arg)` form
- [ ] `docs/conventions.md` §6.3 — retracted factory pattern, added anti-pattern note
- [ ] `src/client/components/error-boundary/index.tsx` — `override` modifier added
- [ ] `src/client/state/slices/selection-slice.test.ts` — clone-before-sort
- [ ] `src/client/components/thumbnail-strip/index.tsx` + `thumbnail-item.tsx` — lint warnings addressed (eslint-disable + comment, OR Phase-1 minimal keyboard nav if under 10 min)
- [ ] `.learnings/learnings.jsonl` entry per protocol (return as JSON object, Marcus appends serially)

---

## 3. Out of scope for this wave

The following items from `docs/code-review.md` are deliberately NOT in scope. They roll into a Phase-1.1 follow-up after the walking skeleton ships:

- Julian's 4th HIGH (the `(e as Error).message` leak across handlers — needs a `safeMessage()` helper and ~14 file edits)
- All 14 MEDIUM findings (handler-test assertion-shape `expectErr()` helper, recents-clickable in empty-state, combine-modal "+ Add file" affordance, bookmarks-panel Space-key activator, document-slice round-trip tests for `delete`/`annot-edit`/`annot-delete`/reorder-with-annotations rebinding, path-sanitizer adversarial-vectors fixture, etc.)
- All 13 LOW findings (file-hash double-read, csp.ts cosmetic null-coalesce, error-boundary message-leak, etc.)
- All 5 NIT findings
- Phase-2 stub channels (`pdf:combine`, `pdf:export`, `pdf:getOutline`, `fs:writePdf` ops with real engine)
- `build/icon.ico` provisioning (Nathan or Diego — flagged for Wave 4)

---

## 4. Marcus's contract-vs-implementation verdict for H-3

**Question Julian raised:** is the bug in the renderer thunk (always sends `ops`), or in `docs/api-contracts.md` (the contract is wrong)?

**Verdict: implementation drift, NOT contract drift.** No amendment to `docs/api-contracts.md`.

**Rationale:**
- `api-contracts.md` §3.2 defines `payload` as a discriminated union of `'bytes' | 'ops'`. Both kinds are first-class. The `ops` branch is the **architecturally correct** Phase-2 design: renderer holds the dirty ops + annotations, main holds the original bytes, main replays. This minimises round-tripping a multi-MB byte buffer through the IPC bridge.
- Phase-1 walking skeleton needs `Ctrl+S` to round-trip *something* end-to-end. The renderer thunk picking `kind: 'ops'` is correct for the contract; what's missing is the main-side `applyOpsToBytes` dep that the handler explicitly checks for (`if (!deps.applyOpsToBytes) return invalid_payload`). The contract anticipated Phase 1 not having the engine and surfaces the gap as a clean error — that's *good* contract design. The implementation just didn't supply the Phase-1 shim.
- Fixing the contract to use `bytes` Phase-1 would require the renderer to fetch the document bytes via a new channel (currently `Uint8Array` is forbidden in the renderer store by conventions §10), then upload them via `fs:writePdf`. That's a worse design and would need a Phase 2 reversal.
- David's task §1.2 wires the shim. No contract amendment.

This decision is logged in this brief and in the Wave 3 verdict section of `build-report.md`. Future agents (Julian's re-audit, Nathan's docs) read from there.

---

## 5. Logging discipline (parallel-write JSONL contention)

Both David and Riley run in parallel. Per the Marcus Hard-Won Playbook on JSONL contention (`orchestration-manager.md` §1):

**Do NOT write to `.learnings/learnings.jsonl` directly.** Return your post-flight entry as a JSON object in your final response (one JSON object per agent). Marcus appends both entries serially after the wave joins. This eliminates parallel-write corruption and the `\b`-in-detail-field eval-004 failure mode.

Format of the returned object (Marcus copies verbatim into the JSONL log, one line each):

```json
{
  "ts": "2026-05-21THH:MM:SSZ",
  "agent": "<your-slug>",
  "task": "Wave 3.5 remediation (PDF_Viewer_Editor)",
  "outcome": "success | failure | correction",
  "detail": "<what you did, non-obvious takeaways — string-safe per JSON.stringify>",
  "fix": "<recurrence-prevention insight — string-safe>",
  "locked": false,
  "refs": ["<absolute-path-1>", "<absolute-path-2>"]
}
```

**Honesty clause:** outcome must reflect reality. If Save still doesn't work end-to-end on a smoke-launch, mark `failure` and explain. Dishonest entries break the loop for Julian's re-audit and Nathan's docs.

---

## 6. Verification after both agents return

Marcus does NOT re-dispatch Diego for this wave. Re-verification path:

1. **Diego's existing CI workflow runs on the next push.** Marcus instructs the user to commit Wave 3.5 changes and let `windows-latest` + `ubuntu-latest` jobs run. The CI is the source of truth for typecheck + lint + test + build.
2. **Local smoke (user or Marcus operator-skill):** launch `release/PDF Viewer & Editor-0.1.0-x64-portable.exe`, open a PDF, save it via Ctrl+S, restart, confirm Recents shows the file. If the install icon issue blocks dist, the portable exe is sufficient.
3. **Julian's re-audit fires only if H-1/H-2/H-3 pass smoke.** Marcus reviews the two returned learnings entries; if outcomes are honest and CI is green, the re-audit is a 30-minute spot-check (Marcus or Julian via a tiny follow-up brief), NOT a full re-run.
4. **If smoke fails:** Marcus drafts a Wave 3.6 with the residual fix and does NOT proceed to Wave 4.

Goal: ship Wave 4 (Nathan docs) against a walking skeleton that **actually walks**, not against a green build whose features silently no-op.

---

## 7. Wave 4 — already drafted

Once Wave 3.5 closes GREEN, dispatch Nathan against `docs/wave-4-brief.md` (stub in this repo). No changes to Wave 4 scope from the Wave 3.5 fixes — Nathan documents the working app, not the broken one.

---

## 8. Locked-decision compliance check (re-verified for this wave)

The four locked decisions remain in effect through this wave. Neither David's nor Riley's tasks change any of them:

1. **Hybrid Print-to-PDF (pdf-lib default + Chromium fallback)** — untouched. `exportSlice` and `pdf:export` channel remain Phase-2 stubs as designed.
2. **PDF-native annotations, no sidecar** — untouched. Annotations live on `document.annotations[]` and round-trip through the `payload.ops + annotations` save path (Phase 1 ship: shim returns bytes unchanged; Phase 2 ship: real replay).
3. **Redux Toolkit (NOT Zustand)** — H-2 fix is *more* RTK-aligned (parameterized memoized selectors are the canonical RTK pattern).
4. **Windows file-association installer checkbox, default ON** — untouched. NSIS `installer.nsh` and electron-builder fileAssociations stand as Diego shipped.

L-001 (`enableDragDropFiles`) holds — neither agent touches `window-manager.ts` or `enableDragDropFiles`.

---

**End of Wave 3.5 brief.** Awaiting user go-ahead to dispatch David + Riley in parallel.
