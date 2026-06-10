# Phase 7.2 — CI Coverage Restoration + Dev-Mode SQLite Bundling

**Owner:** Marcus (Chief Delivery Officer)
**Status:** Planning — awaiting principal review before Wave 1 dispatch
**Targets:** Tag `v0.7.20`
**Shape:** One-off Phase 7.x hardening wave continuing the Phase 7.1 line. Two scoped items, ordered B-then-A.

---

## Why this wave exists

Phase 7.1 (v0.7.19) closed the v0.7.13 → v0.7.18 OCR-chain arc with a real-PDF end-to-end integration test that catches 4/6 historical bug classes at the e2e tier and a 5th at the unit tier. Julian's review verdict was **GO-with-follow-up** (`docs/code-review.md` §Phase 7.1, 2026-06-05). Two specific gaps surfaced in the closure:

1. **`tests/e2e/ocr-integration.spec.ts` is not actually firing in CI.** The `check` job has been red on Ubuntu since v0.7.18 due to a Windows-shaped path literal in `src/ipc/handlers/dialog-pick-pdf-files.test.ts:51`. Because `e2e` declares `needs: check` in `.github/workflows/ci.yml:131`, the new Phase 7.1 Playwright spec + fixture-hash gate have **not run in CI on any PR for the v0.7.18 or v0.7.19 releases.** Phase 7.1's regression coverage is local-only until this is repaired. The v0.7.19 build-report row explicitly flags this as "the highest-leverage Phase 7.2 candidate after Julian's 7.1.5 finding" (`docs/build-report.md` lines 10241).

2. **Phase D + E of `ocr-integration.spec.ts` are `.skip()`'d on the dev-mode harness** (lines 525-528 + 535-539; gated behind `OCR_E2E_RELAUNCH_RESTORE=1`) because `dist/main/` does not bundle `src/db/repositories/*.js`. Five dynamic `require('../db/repositories/...js')` call sites in `src/main/index.ts` (lines 254, 270, 290, 300, 312, 327 — `form-templates`, `signature-audit`, `ocr-jobs`, `ocr-results`, `language-packs`, `export-jobs`) fall back to the in-memory bridge under `_electron.launch()`, which means the v0.7.18 reopen-restore bug class is **not caught at the e2e tier**. This is Julian's finding 7.1.5 (`docs/code-review.md` §2844), the only HIGH-severity finding in the Phase 7.1 review. Defense in depth at the unit tier (`loadOcrResultsThunk` × 6 references in `src/client/state/thunks-phase5.test.ts`) keeps this from blocking, but the e2e tier should also surface it.

Phase 7.2 closes both gaps. The wave is small and tightly scoped — two engineering items, no feature work.

---

## Acceptance criteria (the contract)

1. `docs/phase-7.2-plan.md` (this file) decomposes the wave per the structure below.
2. **Item B (Ubuntu CI fix):** `src/ipc/handlers/dialog-pick-pdf-files.test.ts` is platform-portable. The `check` job is green on **both** `windows-2025-vs2026` and `ubuntu-latest` on the same PR. The `e2e` job runs (not skipped) on that PR, exercises `tests/e2e/ocr-integration.spec.ts`, and is green. The `build` job runs (not skipped) on the post-merge `main` push and is green.
3. **Item A (dev-mode SQLite bundling):** `dist/main/index.js` resolves `src/db/repositories/{form-templates,signature-audit,ocr-jobs,ocr-results,language-packs,export-jobs}-repo.js` successfully in a `_electron.launch()` run. The Phase D + E `.skip()` at `tests/e2e/ocr-integration.spec.ts:525-528` is replaced by a live test that asserts (a) the seeded OCR job survives close + relaunch, (b) `listResultsByJob` returns the same word count for page 0 after relaunch, (c) the v0.7.18 reopen-restore regression class is caught at the e2e tier.
4. Julian's review has no blocker findings on Phase 7.2.
5. `docs/build-report.md` gets a Phase 7.2 wave row.
6. v0.7.20 published to GitHub Releases with the L-002 capture in the build-report row.
7. `.learnings/learnings.jsonl` entries per the parallel-write protocol (each agent returns its entry to Marcus; Marcus appends serially).

---

## Order — B first, then A. Why.

**B (Ubuntu CI fix) must land first.** Three structural reasons:

1. **B unblocks A's verification.** Item A's acceptance criterion is "the new live Phase D+E test runs green in CI." If `check` is red, `e2e` is skipped, and we cannot verify A in CI — A would land "locally green" with the same exact problem Phase 7.1 has today. Fixing B first gives A a green CI lane.
2. **B is a 1-line code change.** Cross-platform path normalization (`path.win32.normalize(...)` or equivalent) inside the test, or a `describe.skipIf(process.platform !== 'win32')` gate around the Windows-shaped assertion block. The blast radius is one test file; risk is near-zero. A is a build-config change to `electron.vite.config.ts` (or equivalent) — multi-file, requires a Diego+David coordination, and has measurable bundle-size implications.
3. **B's value is immediate and accumulating.** Every PR after B's merge gets Phase 7.1's full regression coverage. Every day B is deferred, Phase 7.1's e2e is silently inactive in CI. A's value (catching the v0.7.18 class at e2e) is real but additive — the unit-tier defense already covers that class today.

Wave 1 (Riley design) and Wave 2 (David implementation + Diego CI) are sequenced accordingly: B's design + fix lands in Wave 1 + early-Wave-2 so Marcus can verify on CI before Wave 2's Item-A work joins.

---

## Out of scope (do not allow scope creep)

- Code-signing cert procurement (Phase 7.x separate).
- macOS / Linux packaging verification (Phase 7 proper).
- Any feature work beyond the two scoped items (no Phase 3 form designer creep, no new OCR features).
- Editing Marcus's agent prompt (still deferred; Dmitri's release-ceremony Hard-Won Playbook promotion is a Dmitri-between-builds task, not a Phase 7.2 item).
- The 4 LOW/MEDIUM Phase 7.1 follow-ups (7.1.1, 7.1.2, 7.1.3, 7.1.4) — track as a separate cleanup wave if/when they become load-bearing.
- Lifting the multi-page e2e skip at `tests/e2e/ocr-integration.spec.ts:535-539` (separate budget-driven decision; not blocking).

---

## Locked instructions in effect for this wave

- **L-001** (drag-drop `enableDragDropFiles`): unaffected.
- **L-002** (operator-level screenshot on packaging waves): the v0.7.20 release ceremony MUST include the L-002 capture.
- **L-003** (Node 20 baseline; no from-source `better-sqlite3` rebuild on Node 24): all test runs MUST be on Node 20.
- **L-004** (pdf.js `getDocument({data})` copied buffer): unaffected — no pdf.js call sites added or moved this wave.
- **L-005** (pdf.js polyfill order before dynamic import): unaffected — same.

Each agent re-reads `.learnings/locked-instructions.md` at pre-flight per the inherited self-improvement protocol.

---

## Wave decomposition

### Wave 1 (sequential) — Riley: design contract for the live relaunch+restore test

**Owner:** Riley (front-end-architect — owns test-harness contracts per Phase 7.1 precedent).

**Output:** `docs/phase-7.2-test-design.md` (NEW).

**Riley designs:**

- **Item B fix shape.** Recommend the smallest viable change to `src/ipc/handlers/dialog-pick-pdf-files.test.ts:51` that makes it pass on `ubuntu-latest` without losing the production-sanitizer coverage on Windows. Options to weigh:
  - (B-1) Cross-platform path normalization via `path.win32.normalize` inside the test assertion + matching cross-platform input.
  - (B-2) `describe.skipIf(process.platform !== 'win32')` around the Windows-shaped block.
  - (B-3) Mocked sanitizer that is platform-agnostic by construction.
  - Riley picks one with reasoning. Recommendation: B-1 if cleanly expressible, B-2 as the safer fallback. The test's value is the production sanitizer round-trip; preserve that.
- **Item A live-test surface.** The relaunch+restore test body that replaces `tests/e2e/ocr-integration.spec.ts:525-528`. Riley §2.5 / §2.6 of `docs/phase-7.1-test-design.md` already specifies this verbatim — Riley confirms the design holds or revises with deltas. Key assertions to enforce:
  - After close → relaunch with the same userData dir, `listJobs({ limit: 100 })` returns the original `jobId` with `status === 'completed'`.
  - `listResultsByJob({ jobId: originalJobId })` returns a non-empty result whose `page0.words.length` equals the pre-close word count.
  - No console errors across the second launch (same exact-match `'error'` filter as Phase A).
  - Phase D + E budgets: `BUDGET_RELAUNCH_MS = 15_000`, `BUDGET_RESTORE_MS = 10_000` (the constants already exist at spec lines 102 + 104, presently unused).
  - Total spec runtime stays under the 90s ceiling (acceptance #3 inherited from Phase 7.1).
- **Item A acceptance verification path.** Riley specifies how Diego will verify that the dynamic-require sites in `src/main/index.ts:254-329` now resolve in `_electron.launch()`. A console-log probe? A new IPC handler exposing `whichBridge: 'sqlite' | 'memory'`? A test-only assertion via the existing seed channel? Riley picks one.

**Reporting:** Riley reports back to Marcus. Marcus pauses, sanity-checks the design in <300 words, then dispatches Wave 2.

---

### Wave 2 (parallel) — David + Diego: implementation

**Owners:**

- **David** — Item A (dev-mode SQLite bundling: lift the dynamic-require sites to a bundler-visible form OR coordinate with Diego on the electron-vite config).
- **Diego** — Item B (Ubuntu CI fix) + Item A's CI-side electron-vite config change + the Phase D+E live-test body in `ocr-integration.spec.ts`.

**Order discipline:** Diego lands Item B FIRST in this wave (it is a 1-line change with broad unblock value). Then David + Diego work Item A in parallel within their respective domains.

#### David's slice (`src/main/index.ts` + companion tests)

- Choose one of:
  - **(A-1) Static-import lift.** Convert the 6 dynamic `require('../db/repositories/*-repo.js')` blocks in `src/main/index.ts` to static `import` statements at the top of the file. The try/catch fallback to the memory bridge becomes a constructor-failure fallback inside the SQLite repo factories (or a feature-flag at runtime). Pro: bundler-visible, no electron-vite config change needed. Con: changes the bootstrap shape; needs careful review of the memory-fallback semantics.
  - **(A-2) Manifest-driven include.** Coordinate with Diego: keep the dynamic requires AS-IS but add an explicit include list to `electron.vite.config.ts` so the bundler walks the dynamic paths. Pro: minimal `src/main/index.ts` diff. Con: bundler config now depends on a string-list outside the import graph (drift risk).
- Riley's design call (Wave 1) drives the choice. David documents the chosen option + rationale in his return entry.
- Add / update unit tests in `src/main/index.test.ts` so the SQLite bridge is exercised in a dev-mode `_electron.launch()`-equivalent fixture (memory-fallback path must remain green when SQLite repos are absent — e.g. tests using `vi.mock` on the repo modules).
- L-004 / L-005 unaffected (no pdf.js touched).
- David commits when his slice typechecks + lints + tests green (per-wave commit; do NOT batch).

#### Diego's slice (`src/ipc/handlers/dialog-pick-pdf-files.test.ts`, `electron.vite.config.ts`, `tests/e2e/ocr-integration.spec.ts`, `.github/workflows/ci.yml`)

- **B-fix:** Land Riley's chosen B-1 / B-2 / B-3 fix in `dialog-pick-pdf-files.test.ts`. The test must pass on `windows-2025-vs2026` AND `ubuntu-latest` against the production sanitizer (per the file's own header comment about the production sanitizer round-trip).
- **A-build:** If Riley chose A-2 manifest-driven include, edit `electron.vite.config.ts` per David's coordination. If A-1, this is a no-op for Diego on the build side.
- **A-test:** Replace the `test.skip(...)` at `tests/e2e/ocr-integration.spec.ts:525-528` with the live Phase D + E test body per Riley's design. Use the `BUDGET_RELAUNCH_MS` + `BUDGET_RESTORE_MS` constants that already exist at lines 102 + 104 (remove the `// eslint-disable-next-line @typescript-eslint/no-unused-vars` comments and the underscore prefix). Preserve the `OCR_E2E_RELAUNCH_RESTORE` env-gated escape hatch as a no-op alias (delete the gate now that the test runs by default; document the removal in the test header comment).
- **CI verification:** Confirm `.github/workflows/ci.yml` paths are correct (the fixture-hash verify step at line 178 already runs; the new Phase D+E test extends the existing `npm run e2e` step). Verify on a draft PR that `check` (both OSes) → `e2e` → `build` all run green.
- Diego commits when the spec passes locally + the CI job is green on a draft branch.

**Both David and Diego return their learnings entries to Marcus instead of writing to `learnings.jsonl` directly** (per Marcus's Hard-Won Playbook on parallel-write contention). Marcus appends serially after the wave joins.

---

### Wave 3 (sequential) — Julian: review

**Output:** `docs/code-review.md` (updated, new Phase 7.2 section).

**Julian reviews:**

- **Item B:** does the path-normalized test still gate the production sanitizer's rejection paths? (The file's existing tests cover user_cancelled, happy path, multi:true, invalid_path traversal, non-.pdf rejection. All five must remain effective on both platforms post-fix.)
- **Item A:** does the chosen bundling approach actually make `dist/main/` load the SQLite repos under `_electron.launch()`? Is the memory-fallback still reachable in the legitimate case (e.g. a future repo not yet present)? Any new bundle-size delta worth tracking?
- **L-001/L-002/L-003/L-004/L-005 compliance:** all five locks survive intact.
- **False-positive risk on the new Phase D+E test:** what does the relaunch flake on? Userdata-dir cleanup races? SQLite-file-lock races on Windows close + reopen? Tesseract-result non-determinism leaking into the restored word count?
- **False-negative risk:** is the v0.7.18 reopen-restore signature now genuinely caught at the e2e tier? (Julian walks the v0.7.18 bug shape against the new test body and answers per the Phase 7.1 catch-coverage methodology.)
- **CI green on a draft PR:** Julian re-runs the workflow link Diego cites and confirms `check` (both OSes) → `e2e` → `build` are all green.

**Verdict:** GREEN / RED with a one-line summary. Blockers stop the wave; non-blockers become follow-ups.

---

### Wave 4 (sequential) — Nathan: documentation

**Output:** **One section updated** in `docs/developer-guide.md` — the existing "Running the OCR integration test" section gets an amendment (or a new sub-section) noting that the close+relaunch+restore phase now runs by default (no env var). No new top-level docs. Nathan also updates `tests/fixtures/pdfs/README.md` if Riley's design touches fixture provenance (unlikely).

Nathan commits when his diff lints + the markdown renders cleanly.

---

### Release ceremony (Diego — sequential after Wave 4)

**Dispatch:** Marcus invokes `dev-ops-agent` for the v0.7.20 release ceremony. Per the v0.7.18 + v0.7.19 handoff-seam learning (now eight-for-eight in the v0.7.x arc), this is **non-negotiable** — Marcus's wave subagents do not have `git push` / `gh release` primitives.

**Ceremony checklist (Diego owns):**

- Bump `package.json` version 0.7.19 → 0.7.20.
- Tag push (pre-push hook runs typecheck + lint + push).
- CI watch → green on **both OSes** (this is the first release where Ubuntu `check` should also be green — that is itself the v0.7.20 evidence).
- Release workflow watch → green.
- Promote draft → Latest.
- Download portable + SHA256 verify (4 assets, all match).
- 7z extract inner archive + version verify.
- Launch the downloaded portable + 4-process verify.
- **L-002 capture** via PrintWindow + PW_RENDERFULLCONTENT.
- Build-report row appended with full L-002 evidence per the v0.7.19 template.
- **Bonus evidence:** if feasible, run `npm run e2e -- --grep "OCR overlay restores"` against the packaged binary to demonstrate the live Phase D+E test in action (capture stdout); this is the "first execution as a per-Marcus-wave rule" pattern.

---

## Learnings protocol (parallel-write avoidance)

Per Marcus's Hard-Won Playbook: **Wave 2 subagents (David + Diego) MUST NOT write to `.learnings/learnings.jsonl` directly.** Each returns its post-flight entry as a JSON object in its final report to Marcus. Marcus appends serially after the wave joins.

Wave 1 (Riley alone), Wave 3 (Julian alone), and Wave 4 (Nathan alone) are single-agent waves — direct writes are safe but Marcus prefers the serial-append pattern for uniformity.

---

## Reporting cadence

- **After Wave 1 (Riley):** Marcus reports back to the user in <300 words with design summary + Wave 2 dispatch shape. Pause for sanity check.
- **After Wave 2 (David + Diego):** Marcus reports CI status (draft PR green-or-red) + Wave 3 dispatch.
- **After Wave 4 + release ceremony:** Marcus reports final status with build-report row path + v0.7.20 release URL.

---

## Risks

| Risk                                                                                                                          | Likelihood | Mitigation                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item A's static-import lift changes the memory-fallback semantics in a way that breaks an existing test path.                 | Medium     | Riley's Wave 1 design enumerates the fallback paths; David's Wave 2 unit-test deltas cover them; Julian's Wave 3 review walks each.                                                                             |
| Item A's bundle-size delta is significant enough to slow Electron startup.                                                    | Low        | The 6 repos are small (~100 KB each in source). Diego measures the post-bundling `dist/main/index.js` size delta and reports in his entry.                                                                      |
| Phase D + E test flakes on Windows CI runner due to SQLite file-lock races on close + reopen.                                 | Medium     | Diego adds a small post-close settle delay (≤500 ms) before relaunch; Riley's design specifies the value. If still flaky, retry-once with a documented hash of evidence in the failure message.                 |
| Item B's path-normalization fix accidentally weakens the production-sanitizer coverage on Windows.                            | Low        | Julian's Wave 3 review explicitly walks all 5 existing tests on both platforms.                                                                                                                                 |
| Phase 7.1's existing local-only coverage was hiding additional regressions that surface as soon as `e2e` actually runs in CI. | Medium     | This is GOOD — surfacing them is the point. If new failures appear, they are bugs to fix, not Phase 7.2 blockers. Diego files them as separate issues; Phase 7.2 ships if its own scope is green.               |
| Dmitri's release-ceremony Hard-Won Playbook promotion (deferred from Phase 7.1) is needed before v0.7.20.                     | Low        | Not blocking — the rule is already operative as a per-Marcus-wave dispatch (eight-for-eight). The agent-prompt edit is a Dmitri-between-builds task; Phase 7.2 release uses the same dispatch shape as v0.7.19. |

---

## File ownership map (single-owner per file)

| Path                                                               | Owner                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| `docs/phase-7.2-plan.md` (this file)                               | Marcus                                                    |
| `docs/phase-7.2-test-design.md`                                    | Riley                                                     |
| `src/ipc/handlers/dialog-pick-pdf-files.test.ts`                   | Diego (Wave 2, Item B)                                    |
| `src/main/index.ts`                                                | David (Wave 2, Item A — static-import lift if chosen)     |
| `src/main/index.test.ts`                                           | David (Wave 2, Item A — fallback-path unit tests)         |
| `electron.vite.config.ts`                                          | Diego (Wave 2, Item A — bundling config if A-2 chosen)    |
| `tests/e2e/ocr-integration.spec.ts` (Phase D+E live test body)     | Diego (Wave 2, Item A — replaces the `.skip()`)           |
| `.github/workflows/ci.yml`                                         | Diego (Wave 2, verification only — should not need edits) |
| `docs/code-review.md` (new Phase 7.2 section)                      | Julian                                                    |
| `docs/developer-guide.md` (amend the OCR integration test section) | Nathan                                                    |
| `tests/fixtures/pdfs/README.md`                                    | Nathan (only if Riley's design touches fixtures)          |
| `docs/build-report.md` (Phase 7.2 wave row + v0.7.20 publish row)  | Marcus                                                    |
| `package.json` version bump                                        | Diego (release ceremony)                                  |

No file is assigned to two agents.

---

## Notes on candidates surfaced during scoping

- **Candidate A (Julian 7.1.5)** — confirmed in scope. The dynamic `require('../db/repositories/*-repo.js')` pattern at `src/main/index.ts:254, 270, 290, 300, 312, 327` is exactly Julian's diagnosis; Riley's Wave 1 picks the static-import-lift vs manifest-include trade-off.
- **Candidate B (Ubuntu path test)** — confirmed in scope, sequenced FIRST. `src/ipc/handlers/dialog-pick-pdf-files.test.ts:51` literally hardcodes `'C:\\Users\\test\\a.pdf'` as expected output of a path that came in as `'C:/Users/test/a.pdf'` — a Windows-only path-separator round-trip. The test's input fixtures (lines 18, 44, 73, etc.) also use Windows-shaped paths throughout. Three additional tests in the same file (lines 67, 80, 54) carry the same Windows-shaped expectations and may also need attention; Riley's Wave 1 design decides whether a single fix addresses all or whether each needs its own treatment.
- **Other candidates considered, deferred:**
  - **Dmitri's release-ceremony Hard-Won Playbook promotion** — flagged in the v0.7.19 build-report row (line 10231) and Diego's wave entry. Right scope is Dmitri-between-builds, not Phase 7.2. Captured as a follow-up for the Dmitri dispatch after v0.7.20 ships.
  - **Phase 7.1's 4 LOW/MEDIUM findings** (7.1.1, 7.1.2, 7.1.3, 7.1.4) — none are load-bearing; defer.
  - **Multi-page e2e skip lift** (`ocr-integration.spec.ts:535-539`) — budget-driven, not coverage-driven; defer until a multi-page-specific bug class surfaces.
  - **CI-time L-002 capture job** — flagged in L-002 itself as a Phase 7-ergonomics follow-up. Larger scope; not Phase 7.2.

---

## Sequencing summary

```
Wave 1 (sequential)   →  Riley            docs/phase-7.2-test-design.md (B-fix + Phase D+E live test body + A-bundling shape choice)
Wave 2 (parallel)     →  David + Diego    Item B fix (Diego), Item A static-import lift (David), Item A bundling config if A-2 (Diego), Phase D+E live test body (Diego)
                                          [Discipline: Item B lands FIRST in Wave 2 to unblock CI verification of Item A]
Wave 3 (sequential)   →  Julian           docs/code-review.md (Phase 7.2 section)
Wave 4 (sequential)   →  Nathan           docs/developer-guide.md (OCR integration test section update)
Release ceremony      →  Diego            v0.7.20 publish + L-002 capture + build-report row
```

End of plan.
