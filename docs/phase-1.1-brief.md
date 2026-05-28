# Phase 1.1 — Cleanup Wave Brief

**Author:** Marcus (orchestration-manager)
**Date:** 2026-05-21
**Status:** Brief on disk. Dispatchable as Wave 5. Single wave, 3-4 agents in parallel.
**Locked decisions in play:** License = MIT.

---

## 0. Purpose of Phase 1.1

Close the small, mostly-mechanical follow-ups carried out of Wave 3.5 + Wave 4 that:

1. Affect every downstream wave's CI signal (the 74 latent TS4023 errors in the renderer).
2. Are required for project-policy compliance (LICENSE file, the `spawn-command@0.0.2` license-not-declared item).
3. Improve test quality at the source so Phase 2's larger handler surface inherits the better pattern (`expectErr<E>()`).
4. Are <2-agent-hour deltas — anything bigger gets routed to Phase 2 or Phase 2.1.

**Phase 1.1 is NOT:** a place for new features, new IPC channels, new schema migrations, or anything requiring contract amendment.

## 1. Ordering recommendation — RUN BEFORE WAVE 6 (PHASE 2 ARCHITECTURE)

**Recommendation: Phase 1.1 sequential-before Wave 6, not in parallel.**

Rationale:
1. Cost: Phase 1.1 is ~1-2 agent-hours total wall-time (single parallel wave). Phase 2 design (Wave 6) is sequential Riley-solo, will take a multi-hour pass producing 4-5 doc deltas. Running them in series adds ~2h to the calendar, not days.
2. Signal quality: the TS4023 cascade fix (Diego, drop `composite: true`) means Wave 7 implementation will run against a clean renderer typecheck. If Phase 1.1 lags into Wave 7, every Phase-2 file Riley touches in the renderer will surface fresh TS4023 errors that mix with real new errors and burn triage cycles. Pre-cleaning is cheap insurance.
3. Conventions §6.3 is already corrected; the broken-pattern risk is closed. Phase 1.1's `expectErr<E>` helper does **not** block Wave 6 design — it sits at the test boundary, not the architecture boundary. Riley does not need it to design Phase 2.
4. The F1 Help decision is a Riley UX call but it lands as a single small modal/external-URL handler, not as architecture surface. Riley can include it in Phase 2 design as a one-line confirmation rather than blocking on it.

If you (the user) need Phase 1.1 to run *in parallel* with Wave 6 anyway (calendar pressure), the file-ownership boundaries still work — Phase 1.1 touches `tsconfig.renderer.json`, `LICENSE` (new), `package.json` license bump, `LICENSES.md` (Nathan), handler test files (David), one new component (Riley's F1 modal). Wave 6 touches only `docs/`. No conflict. But the signal-cleanup rationale still favors sequential.

## 2. Task list per agent (Wave 5)

### 2.1 Diego — `dev-ops-agent` (3 tasks)

| ID | Task | File(s) | Effort |
|---|---|---|---|
| **D-1.1** | Drop `composite: true` from `tsconfig.renderer.json`. Verify cold-build `npx tsc -p tsconfig.renderer.json --noEmit` reports 0 TS4023 errors. If it still reports some, add explicit `(state: RootState) => T` return-type annotations to the affected `createSelector` exports per the Wave 3.5 verdict's Phase-1.1 fix-option #2. | `tsconfig.renderer.json` | 15 min |
| **D-1.2** | Resolve `spawn-command@0.0.2` license-not-declared. Two paths: **(a)** Bump `concurrently` to a version that no longer transitively pulls `spawn-command` (check `concurrently@8.3+` or `9.x` release notes); rerun `npm install`; verify with a license-walk script. **(b)** If no concurrently version drops it: add an explicit allowlist entry in `LICENSES.md` with rationale (upstream is dormant, build-tool only, MIT-presumed via package's own readme, etc.) AND open a GitHub issue against `mmalecki/spawn-command` requesting a declared license. Default to (a) if available. | `package.json`, `package-lock.json`, `LICENSES.md` (joint edit with Nathan — see §3) | 30 min |
| **D-1.3** | Verify CI's renderer typecheck job remains green after D-1.1. If the `package.json`/`tsconfig` deltas require CI adjustments (cache key bump, project-reference resolution paths), apply them. | `.github/workflows/ci.yml` (only if D-1.1 needs it) | 10 min |

**Diego does NOT:** add a LICENSE file (Nathan's), touch source under `src/`, modify electron-builder.yml.

### 2.2 Nathan — `documentation-expert` (3 tasks)

| ID | Task | File(s) | Effort |
|---|---|---|---|
| **N-1.1** | Write the MIT `LICENSE` file at the repo root. Standard SPDX MIT text. Copyright line: `Copyright (c) 2026 PDF_Viewer_Editor contributors` (or, if the user supplies a different attribution in this thread, use that). The `package.json` already declares `"license": "MIT"` — no change needed there. | `LICENSE` (NEW at repo root) | 5 min |
| **N-1.2** | Update `LICENSES.md` introductory paragraph to reflect: (a) the project's own license is now MIT and the source-of-truth is the new `LICENSE` file at the root, (b) the `spawn-command` flagged item's resolution from D-1.2 — either remove the row (if D-1.2 picked path (a)) or rewrite the row to reflect the explicit-allowlist rationale (if path (b)). | `LICENSES.md` | 15 min |
| **N-1.3** | Add a `## Phase 1.1` row to the README's `## Phase 1 known limitations` section noting (a) LICENSE file now present (link to it), (b) the TS4023 cascade fix is in main, (c) Phase 2 work in progress (link to `docs/phase-2-plan.md`). Keep it brief — 3 bullets. | `README.md` | 10 min |

**Nathan does NOT:** screenshot any UI (deferred to Phase 1.2 per Marcus brief), touch the user guide except the Phase 1.1 note (defer larger user-guide changes to Phase 2 Wave 9 when Phase-2 features ship), modify `docs/api-reference.md` (no API surface changes in 1.1).

### 2.3 David — `backend-engineer` (1 task)

| ID | Task | File(s) | Effort |
|---|---|---|---|
| **DV-1.1** | Add the `expectErr<E>(res, e: E)` test helper to a new test-support module at `src/ipc/handlers/test-support.ts` (NEW). Refactor all 13 handler test files under `src/ipc/handlers/*.test.ts` to use it: replace ad-hoc `if (!res.ok) expect(res.error).toBe('…')` chains with `expectErr(res, '…')` calls. Implementation: `function expectErr<E extends string>(res: Result<unknown, E>, e: E) { expect(res.ok).toBe(false); if (!res.ok) expect(res.error).toBe(e); }` plus a sibling `expectOk<T>(res): asserts res is OkVariant`. Run `vitest src/ipc` to confirm 0 regressions. Per Julian's MEDIUM finding (Section G first row), this closes the silent-pass risk where a regression returning `ok: true` would pass tests that only assert inside the `if (!res.ok)` branch. | `src/ipc/handlers/test-support.ts` (NEW), `src/ipc/handlers/*.test.ts` (13 files) | 30-45 min |

**David does NOT:** touch any production handler in this wave, modify `src/ipc/contracts.ts` (frozen contract), add new IPC channels.

### 2.4 Riley — `front-end-architect` (1 task)

| ID | Task | File(s) | Effort |
|---|---|---|---|
| **R-1.1** | Wire F1 Help. Decision: **in-app modal**, not external URL — the codebase has no docs hosting yet and we want F1 to work offline. Create a new `HelpModal` component (`src/client/components/modals/help-modal/index.tsx` + `.module.css`) that opens on F1 and renders the same content as `docs/user-guide.md` shortcut table + "Phase 1 limitations" summary. Source: hand-port the key sections from `docs/user-guide.md` as JSX (don't import .md at runtime — that wants a bundler config change). Add `helpModal` open state to `ui-slice.ts`. Update `hooks/use-app-shortcuts.ts` to dispatch the open action on F1 (currently disabled, per Julian's Wave 2 finding). Add a "Help" entry to any existing menu/about affordance if convenient; otherwise F1 only. | `src/client/components/modals/help-modal/index.tsx` (NEW), `src/client/components/modals/help-modal/help-modal.module.css` (NEW), `src/client/state/slices/ui-slice.ts` (edit — add helpModalOpen), `src/client/hooks/use-app-shortcuts.ts` (edit — enable F1) | 45-60 min |

**Riley does NOT:** modify any docs (Nathan's territory in 1.1), touch the IPC contract, change conventions §6.3 (already retracted in 3.5), make this a "real" docs viewer (markdown rendering at runtime is Phase 2+).

## 3. Coordination notes (parallel-wave hygiene)

- `LICENSES.md` is touched by both Diego (D-1.2) and Nathan (N-1.2). To avoid Hard-Won Playbook §1 contention, **Diego writes D-1.2's spawn-command resolution first**, commits/saves, then Nathan layers N-1.2 introductory paragraph on top. If parallel write conflict: Diego owns the table entries and footer; Nathan owns the introductory paragraph and any cross-reference text. One-file-one-section ownership.
- Diego (D-1.1 tsconfig) and Riley (R-1.1 new component) operate on disjoint file sets; no contention.
- David (DV-1.1) touches only handler tests + new test-support file; disjoint from everyone.
- **Post-flight log writes:** dispatch this wave with the standard "return JSON to Marcus, Marcus appends serially" pattern from Hard-Won Playbook §1. Avoids JSONL contention.

## 4. Acceptance criteria for Wave 5 close

- [ ] `LICENSE` exists at repo root, contains standard MIT text with correct copyright line. `package.json` `license: "MIT"` unchanged.
- [ ] `npx tsc -p tsconfig.renderer.json --noEmit` reports **0 TS4023 errors** on a cold build (delete `.tsbuildinfo` first).
- [ ] `LICENSES.md` no longer flags `spawn-command@0.0.2` as an unresolved Phase-1.1 follow-up — either the dep is gone or the entry has an explicit rationale + upstream issue link.
- [ ] All 13 handler test files use `expectErr<E>` / `expectOk` from `src/ipc/handlers/test-support.ts`. `vitest src/ipc` passes 100%.
- [ ] F1 opens an in-app Help modal showing the shortcut table + Phase 1 limitations summary. Modal closes with Esc and click-outside. Verified by manual launch (no operator-skill required).
- [ ] README has a Phase 1.1 row with three bullets (LICENSE, TS4023 fix, Phase 2 link).
- [ ] One JSONL entry per agent in `.learnings/learnings.jsonl` (serialized post-flight per §3).

If any criterion fails, log in `docs/build-report.md` and do not auto-promote to Wave 6.

## 5. Julian's 14 MEDIUM findings — triage

Read `docs/code-review.md` §I "Cross-cutting nits" + §G "Test coverage gaps" + §E "Redux + state" + §B "IPC handler security" for the source text on each.

### 5.1 Bucket: 1.1-NOW (close in Wave 5)

| Finding | Rationale | Owner |
|---|---|---|
| **G-1** `if (!res.ok) expect(res.error)` silent-pass pattern across 9-13 handler test files | Pattern fix; Julian explicitly suggested `expectErr<E>` helper. Worth ~30 min as a single PR. Closes a systemic test-quality risk before Phase 2 quadruples the handler surface. | **David (DV-1.1)** |
| **I-1** `combine-modal/index.tsx:34-48` accepts arbitrarily many broken `{kind:'path', path:''}` entries from "+ Add file..." | Tied directly to Phase 1's `app:pickPdfPath` Phase-2 placeholder. Fix is to disable the button entirely with a "Coming in Phase 2" tooltip until Wave 7 wires it. Single small UI delta. | **Riley (add to R-1.1 if time, else defer to Phase 2 Wave 7)** |
| **H-4** `(e as Error).message` leakage across handlers — `safeMessage()` helper | Julian's section B HIGH finding. Net effect: production toasts can leak filesystem paths. Helper is a tiny 10-line module; applying it across the 14 cite sites is mechanical. Phase-2 grows the handler set significantly so doing this NOW makes Phase 2 handlers inherit the right pattern. **Promote to Wave 5 if David has bandwidth** — DV-1.1 is the natural pair task. If DV-1.1 alone takes the budget, defer H-4 to Phase 2.1. | **David — joint with DV-1.1** (if bandwidth), else defer |

### 5.2 Bucket: PHASE-2 (handled inside Wave 7-8 as part of the normal Phase 2 implementation)

| Finding | Rationale | Owner-when |
|---|---|---|
| **B-1** `pdf-ops.ts:51-55` `handlePdfExport` wrong-preference returns `'handle_not_found'` instead of `'invalid_payload'` | Phase-2 work — `pdf:export` becomes a real handler in Wave 7, gets the `'invalid_payload'` variant added to its error union, and the Zod schema rejects wrong-preference before the handler is reached. Test coverage (G-4) lands in the same wave. | **David Wave 7** |
| **E-1** `selectedPageIndices` inline-selector ref-identity (thumbnail-strip) | Bundle into the Phase-2 Wave-7 Riley refactor of `selection-slice` for bookmarks-tree authoring (which already touches selection patterns). Single sub-fix. | **Riley Wave 7** |
| **E-2** `document-slice.test.ts` missing `delete`/`annot-edit`/`annot-delete`/reorder-with-annotations round-trip tests | Phase 2 wires real undo/redo UI. These tests become CRITICAL when the undo button is live — until the button is live, the round-trip is unobservable. Riley adds them in Wave 7 as a prerequisite to enabling Ctrl+Z. | **Riley Wave 7** |
| **G-2** `document-store.test.ts` no test for 60-second token TTL | Phase 2 stress-tests the destination-token surface as more flows mint tokens (`pdf:print` outputs, `pdf:embedImage` round-trips). David injects a `now()` provider and adds the time-passing test as part of Wave 7's destination-token expansion. | **David Wave 7** |
| **G-4** `pdf-ops.test.ts` no test for wrong-preference path (the B-1 regression) | Companion to B-1; same wave. | **David Wave 7** |
| **G-5** `thunks.ts` no direct thunk tests (error-mapping branches uncovered) | Riley already touches thunks heavily in Wave 7 (new edit-replay flows, image-import flows). Add the missing thunk tests as part of that work — the error-branch table grows in Wave 7 anyway. | **Riley Wave 7** |
| **I-2** `empty-state/index.tsx` recents list not clickable | Phase-2 UI polish; Riley folds it into the Wave 7 UI sweep when extending recents with the bookmarks-authoring panel layout. | **Riley Wave 7** |
| **I-3** `thumbnail-item.tsx` missing keyboard activator (Enter/Space/Arrows/Delete) | Phase-2 a11y minimum — Wave 7 ships full keyboard nav across the thumbnail strip as part of the new bookmarks-authoring + image-overlay flows that also need keyboard. | **Riley Wave 7** |
| **I-4** `bookmarks-panel/index.tsx` missing Space activator on bookmark rows | Phase-2 — bookmarks-panel is being substantially rewritten for the authoring flow (Wave 7), Space-activator drops into the rewrite. | **Riley Wave 7** |

### 5.3 Bucket: PHASE-2.1 (after Phase 2 ships)

| Finding | Rationale | Owner-when |
|---|---|---|
| **B-3** `path-sanitizer.ts` no allow-listed root; no UNC/device-namespace rejection | Phase 2's image-import surface introduces new path-bearing channels (`pdf:embedImage`). The hardening pass should happen as Phase 2.1 after the new attack surface is live and Julian can audit holistically. The test-vector table (`tests/fixtures/path-vectors.md`) is the deliverable. | **Diego/David Phase 2.1** |
| **B-4** `dialog-save-as.ts` `suggestedName` validator too loose (reserved Windows device names, control chars) | Cosmetic, downstream sanitizer catches it anyway; tighten when path-sanitizer gets its Phase-2.1 hardening pass. | **David Phase 2.1** |
| **G-3** `path-sanitizer.test.ts` adversarial vectors (UNC, device-namespace, reserved names, null-byte, Unicode `..`) | Companion to B-3; same wave. | **Diego/David Phase 2.1** |
| **G-6** Sparse React component tests (3 in 91-file renderer); Diego e2e to pick up slack | Wave 8 Diego adds Playwright component tests for the new Phase-2 modals (image-import, text-edit overlay, print dialog). Phase 2.1 backfills component tests for the Phase-1 modals (combine, settings, export, confirm-close) once the e2e fixture set is mature. | **Diego Phase 2.1** |
| **I-5** Replace `bridge_unavailable` magic-string with first-class contract variant | Cross-channel error-union expansion; large delta, low value at this size. Defer until Phase 2.1 when Julian's full security re-audit may want it. | **David Phase 2.1** |

### 5.4 Bucket: WONTFIX / KEEP-AS-IS (Julian explicitly said "Keep")

None. Julian's "Keep" verdicts are not findings — they are the positive-discipline calibration in §"What's good". The 14 MEDIUM findings are all live; none are wontfix.

### 5.5 Bucket: ALREADY CLOSED in Wave 3.5

- **H-1** setDbBridge wiring — closed.
- **H-2** factory selectors + conventions §6.3 — closed.
- **H-3** `saveDocumentThunk` `kind:'ops'` rejection — closed by Phase-1 boundary (degrade-but-honest). Phase 2 closes the fidelity gap; not a Phase-1.1 task.

## 6. NOT in Phase 1.1 (explicit defers)

- **Screenshots for user guide** — deferred to Phase 1.2 or Phase 2 Wave 9. Wants signed binaries + operator-skill smoke run; both are calendar items.
- **Code-signing cert** — deferred to Phase 1.2. Awaiting cert acquisition (org-level decision).
- **better-sqlite3 ABI failure cleanup** — Diego's known Wave 3 baseline issue (35 ABI-mismatch test failures locally). CI uses Node LTS with matching prebuilds and is green. Not a Phase-1.1 blocker.

## 7. Wave 5 dispatch order (sequential within parallel where needed)

1. Diego D-1.1 (tsconfig drop). [parallel-start]
2. Diego D-1.2 (spawn-command). [serial after D-1.1 so npm install can run on a clean tsconfig]
3. Nathan N-1.1 (LICENSE file). [parallel-start with Diego]
4. David DV-1.1 (test helper). [parallel-start, fully independent]
5. Riley R-1.1 (F1 modal). [parallel-start, fully independent]
6. Nathan N-1.2 (LICENSES.md intro) AFTER Diego D-1.2 commits. [serial]
7. Nathan N-1.3 (README row) AFTER Diego D-1.1 (so the "TS4023 fix done" bullet is true). [serial]

Marcus collects all five status rows, appends serialized JSONL entries, writes the Wave 5 / Phase 1.1 section in `build-report.md`, and only then green-lights Wave 6 dispatch.
