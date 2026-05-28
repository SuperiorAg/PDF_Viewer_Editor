# Phase 2.5 — Cleanup Wave (Wave 10)

**Author:** Main session (Marcus's planning dispatch hit API overload; inlining the brief)
**Date:** 2026-05-22
**Status:** Dispatchable. Single wave, 4 agents in parallel + Julian re-audit at the end.
**Purpose:** Close accumulated carry-overs from Phase 1.1 + Phase 2 Wave 8/8.5/8.6 before Phase 3 architecture (Wave 11) begins. Each item is <2 agent-hours and either (a) closes a documented contract/code mismatch, (b) absorbs a Julian MEDIUM finding, or (c) clears a perf/storage smell flagged in code review.

**Out of scope for 2.5:** screenshots (defer to Phase 7 polish — needs operator-skill smoke run after a11y audit), code-signing cert acquisition (defer until a real cert is purchased — a 1-day procurement task, not engineer work).

---

## File ownership (no overlap)

| Owner | Files |
|---|---|
| **David** | `docs/api-contracts.md §12.6` amendment, `src/ipc/handlers/bookmarks-phase2.ts` cleanup (retire `invalid_parent → invalid_payload` translation), `src/ipc/handlers/pdf-identify-text-span.ts` real scanner, `src/main/pdf-ops/text-replace.ts` (text-span scan helper if needed) + tests for each |
| **Riley** | `src/client/state/middleware/history-middleware.ts` (`compactImageOpForHistory` delete handler + history-entry memory dedup), `src/client/types/ipc-contract.ts` (sync with David's §12.6 amendment) + tests |
| **Diego** | `src/ipc/contracts.ts` doc comment at lines 230-234 (Wave 8.6 ruling — see §3 below), Phase 1 + Phase 2 Julian MEDIUM items that are pure config/lint fixes (path-sanitizer hardening test fixtures, ESLint rule additions if any), `package.json` version verification (should be 0.2.0 — already bumped) |
| **Julian** (sequential, after others) | `docs/code-review.md` Phase 2.5 re-audit section APPENDED. Confirms closure + flags any new issues |

---

## §1. David's tasks (4 items)

### D-10.1 — Amend `docs/api-contracts.md §12.6` with `invalid_parent` wire variant
**Why:** Wave 8.5 H-1 fix preserved `MoveBookmarkResult` discriminated union end-to-end except at the IPC wire: David mapped repo `invalid_parent` → IPC `'invalid_payload'` because §12.6 didn't define the variant. Julian re-audit accepted this as Phase 2.5 follow-up.

**Fix:**
1. Open `docs/api-contracts.md` §12.6 (`bookmarks:move` channel)
2. Add `'invalid_parent'` to the error variant union
3. Add a sentence: "Returned when the requested `newParentId` does not exist OR belongs to a different `fileHash` than the bookmark being moved."
4. Banner: `### Phase 2.5 amendment (2026-05-22, David)` — same pattern as Wave 8.5 §7.5 amendment
5. In `src/ipc/handlers/bookmarks-phase2.ts`, remove the `invalid_parent → invalid_payload` translation. Pass the variant through verbatim.
6. Update `src/ipc/handlers/bookmarks-phase2.test.ts` — the `invalid_parent` test case should now assert the wire response is `invalid_parent`, not `invalid_payload`.
7. Sync renderer thunk error-handling (if it checks for the specific string) — coordinate with Riley if needed.

### D-10.2 — Implement real `pdf:identifyTextSpan` scanner
**Why:** Channel exists but currently returns a stubbed-with-warning result. Phase 2 spec said this was Phase-2.5 work.

**Fix:** Implement the actual text-span scan logic in `src/ipc/handlers/pdf-identify-text-span.ts`. Algorithm:
1. Load the page via pdf-lib (already in `document-store.ts` cached bytes)
2. Extract the content stream
3. Parse the BT...ET text-block sections; for each text-show operator (Tj, TJ, ', "), capture position + matrix-transformed bbox + the actual text bytes
4. Match the requested visual coords `{ pageIndex, x, y, width, height }` to a span — the smallest span whose bbox overlaps the requested rect
5. Return `{ spanId, originalText, fontMetrics: { fontName, fontSize, advanceWidth } }` per the api-contracts §12.4 spec

If pdf-lib's API doesn't expose content-stream parsing cleanly, drop down to manual stream parsing (pdf-lib exposes `PDFContentStream` and operator iteration via `PDFOperator`). Document the approach in the handler comment.

Tests: 3 cases — single-line text span, multi-run text span, out-of-bounds coords (return `{ ok: false, error: 'no_span_found' }`).

### D-10.3 — Reconcile `ipc-contract.ts:230-234` doc comment with Wave 8.6 dual-store model
**Why:** Julian Wave 8.6 finding #1. The doc comment at lines 230-234 promises content-hash lookup that `applyImageInsert` doesn't do; Riley's Wave 8.6 fix made the renderer bypass the issue via dual-store. The comment is now misaligned with main-side reality.

**Ruling (locked by main session):** Fix the COMMENT (not the main-side behavior). The dual-store works; main-side content-hash lookup would be redundant. Update the comment to describe the actual behavior:

```
// Renderer dispatches the raw image-insert op (with `image.bytes`) on undo.
// History middleware stores a compacted form (content-hash reference) for
// audit-trail compactness; the raw form is preserved separately in the
// HistoryEntry and is what reaches the IPC layer at save time.
// See: docs/edit-replay-engine.md §9, src/client/state/middleware/history-middleware.ts
```

### D-10.4 — Coordinate with Riley on file boundary
**Why:** If your D-10.1 amendment changes the wire error string `bookmarks:move` returns for `invalid_parent`, Riley's renderer thunk for `moveBookmark` may need to update its error-handling. Either:
- (a) You write the renderer-side update — but `state/thunks.ts` is Riley's. Coordinate via brief.
- (b) Riley does the renderer update in his Wave 10 work — flag the change in your status row so he sees it.

Pick (b). David flags; Riley handles. Standard pattern.

### David's verification
1. `npx tsc -p tsconfig.main.json --noEmit` — 0 errors
2. `npx vitest run src/main src/ipc` — 224+ pass (your new D-10.2 tests + D-10.1 test assertion update; D-10.3 is comment-only, no test impact)
3. Document changes in build-report Wave 10 row

---

## §2. Riley's tasks (3 items)

### R-10.1 — Fix `compactImageOpForHistory` to handle `delete{preservedSource:image}`
**Why:** Riley Wave 8.6 flagged this as a latent storage-footprint bug (~5 LOC fix).

**Fix:** Extend `compactImageOpForHistory` in `src/client/state/middleware/history-middleware.ts` to recognize `delete-page` ops whose `preservedSource.kind === 'image'`. The image bytes inside the preservedSource should be compacted (referenced by content-hash) just like the forward `image-insert` form.

### R-10.2 — History-entry memory dedup
**Why:** Riley Wave 8.6 flagged: HistoryEntry dual-store doubles entry size for image ops only (~50 MB ceiling per architecture §6).

**Fix:** Investigate whether `rawFwd` and `rawInv` can share buffer references for paired image-ops (e.g. `image-insert` + `delete{preservedSource:image}`). If yes, dedup by sharing the `Uint8Array` reference. If no (because the byte content actually differs between fwd and inv, e.g. different page contexts), document why and accept the ceiling as architectural.

Acceptance: if dedup is viable, image-op history entries no longer double in memory. If not, add a top-of-file comment in `history-middleware.ts` explaining the architectural choice and the ~50 MB practical ceiling.

### R-10.3 — Sync gatekeeper after David's §12.6 amendment
**Why:** If David's D-10.1 adds `invalid_parent` to the wire union, `src/client/types/ipc-contract.ts` may need to re-export the updated type (gatekeeper is a pure re-export). Verify.

**Also:** if `src/client/state/thunks.ts` `moveBookmarkThunk` or selectors check the error string, update to handle `invalid_parent` as a first-class case (probably a toast: "Cannot move bookmark to that location"). Per David's D-10.4 coordination, this is yours.

### Riley's verification
1. `npx tsc -p tsconfig.renderer.json --noEmit` — 0 errors
2. `npx vitest run src/client/state/middleware src/client/state/slices/document-inverses` — your tests pass
3. Full renderer suite ≥ 97 pass

---

## §3. Diego's tasks (3 items)

### Di-10.1 — Phase 1 + Phase 2 Julian MEDIUM/LOW backlog (pure config items only)
**Why:** Code-review backlog has been accumulating. Pick off the items that are pure config/lint/test-infrastructure (don't touch source).

**Items to pick off (read `docs/code-review.md` for full list):**
- Path-sanitizer harder tests (Phase 1.1 deferral) — add negative test fixtures for traversal attempts (`../`, absolute paths, UNC, symlinks)
- `bridge_unavailable` as a first-class IPC variant (small contract surface; coordinate with David's D-10.1 amendment if your test crosses)
- ESLint rule audit for any new lint cleanups Phase 2 introduced

Do NOT touch David/Riley/Ravi source files. If a Julian MEDIUM item requires source touches, leave it for a real Phase 2.5.1 wave; just lint+test in this pass.

### Di-10.2 — Verify package.json + LICENSES.md consistency
**Why:** Phase 1.1 added utif; Phase 2 ran `npm install`; verify nothing drifted.

**Check:**
1. `package.json` version is `0.2.0` (already bumped inline at Phase 2 close)
2. `LICENSES.md` lists `utif@^3.1.0`
3. `npm ls` has no UNMET PEER DEPENDENCY warnings introduced by Phase 2 deps
4. No undeclared-license packages reappeared

### Di-10.3 — Smoke verify Phase 2 dist:win still produces a working installer
**Why:** Belt and braces. Phase 2 closed Wave 8 with a passing build; verify no regressions accumulated since.

**Check:** `npm run dist:win` produces `release/*.exe` of expected size (~95 MB). H-3 retirement test still passes. L-001 test still passes.

### Diego's verification
1. All Phase 1 + Phase 2 CI jobs would pass (typecheck × 3, lint, test, build, dist)
2. Document changes in build-report Wave 10 row

---

## §4. Julian's re-audit (sequential, after David + Riley + Diego)

**Trigger:** All three implementer tasks reported complete in build-report.

**Scope:** Focused re-audit of:
- D-10.1 `invalid_parent` variant flows through end-to-end (repo → bridge → handler → wire → renderer thunk)
- D-10.2 `pdf:identifyTextSpan` scanner correctness (read the implementation, sample 3 edge cases)
- D-10.3 comment matches actual Wave 8.6 behavior
- R-10.1 `compactImageOpForHistory` correctly handles the new variant
- R-10.2 dedup decision is defensible (either dedup works, or the doc explains why not)
- Diego's Julian-MEDIUM picks closed cleanly
- No new findings introduced by the 2.5 patches

**Output:** APPEND to `docs/code-review.md` — "Phase 2.5 Cleanup Re-audit — Julian" section. Verdict GREEN / YELLOW / RED for proceeding to Phase 3.

---

## §5. Acceptance criteria for Wave 10 close

- [ ] `docs/api-contracts.md` §12.6 has the `invalid_parent` variant + Phase 2.5 amendment banner
- [ ] `src/ipc/handlers/bookmarks-phase2.ts` no longer translates `invalid_parent → invalid_payload`; passes variant through
- [ ] `bookmarks-phase2.test.ts` covers all 4 wire variants explicitly, including `invalid_parent` as itself
- [ ] `pdf:identifyTextSpan` returns real text-span data for in-bounds requests; clean error for out-of-bounds
- [ ] `ipc-contract.ts:230-234` comment accurately describes Wave 8.6 dual-store behavior
- [ ] `compactImageOpForHistory` handles `delete{preservedSource:image}` (test added)
- [ ] History image-op memory dedup either implemented OR architectural choice documented in code
- [ ] `src/client/types/ipc-contract.ts` re-exports the updated wire types; renderer thunks handle `invalid_parent`
- [ ] Path-sanitizer negative-test fixtures present (or documented why not)
- [ ] `npm run dist:win` still produces a working installer (~95 MB)
- [ ] Typecheck × 3 projects: 0 errors
- [ ] Test suite: 358+ passing, no regressions
- [ ] L-001 lock holds
- [ ] Julian Phase 2.5 re-audit verdict: GREEN

---

## §6. Out of scope for Wave 10 (explicit; deferred to Phase 7 or noted as wontfix)

- Screenshots for user-guide.md — needs operator-skill smoke run; Phase 7 polish
- Code-signing cert acquisition + SmartScreen caveat removal — needs real cert procurement; Phase 7 polish
- Julian MEDIUM items that require source refactors — leave for Phase 2.5.1 if surfaced
- Phase 1 Julian "component test backfill" — would expand scope significantly; absorb into Phase 3+ as touched

---

## §7. Dispatch sequence

1. **Parallel:** Diego + David + Riley dispatched simultaneously (disjoint file sets per §1, §2, §3)
2. **After all 3 return:** Julian dispatched sequentially with the build-report Wave 10 rows visible
3. **Julian returns GREEN** → Marcus writes phase-3-plan.md + wave-11-brief.md (or main session inlines if Marcus blocked again)
4. **Julian returns YELLOW/RED** → Wave 10.5 patch cycle before Phase 3

Standard return-JSON-to-main pattern; main session appends learnings JSONL serially to avoid contention.
