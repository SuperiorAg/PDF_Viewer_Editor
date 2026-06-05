# Phase 7.1 — Real-PDF End-to-End OCR Integration Test (CI)

**Owner:** Marcus (Chief Delivery Officer)
**Status:** Active — Wave 1 dispatched 2026-06-05
**Targets:** Tag `v0.7.19`
**Shape:** One-off pre-Phase-3 hardening wave, similar in spirit to Phase 2.5 cleanup.

---

## Why this wave exists

Every release in the v0.7.13 -> v0.7.18 OCR arc (six releases in 24h) closed a bug that an integration test would have caught earlier. The Phase 5.2 build-report row at `docs/build-report.md` lines 10040-10137 flags this for the seventh release in a row:

> Phase 7.1 candidate: real-PDF e2e OCR integration test. Each release has shipped because the next-deepest defect was caught by a real-world capture or by hand; an integration test would have caught all six earlier and prevented the cascade.

The exit point of the OCR chain is now structurally clean — v0.7.18's L-002 capture caught the OCR modal mid-recognition on the downloaded portable. But that evidence was incidental (a stale queued job in userData). Phase 7.1 makes that pattern **reproducible in CI**, gated on every PR.

---

## Acceptance criteria (the contract)

1. `docs/phase-7.1-plan.md` (this file) decomposes the wave per the structure below.
2. `tests/e2e/ocr-integration.spec.ts` exists, passes locally on Node 20, passes in CI on `windows-2025-vs2026`.
3. The test exercises end-to-end:
   - open a real PDF fixture
   - trigger OCR (programmatically via a test-only IPC seed or via the UI)
   - wait for the OCR modal to reach completion
   - assert the OCR overlay paints onto the page
   - close the app
   - reopen the same PDF
   - assert the overlay restored from the DB via `ocr:listResultsByJob`
4. CI runtime delta on the `e2e` job is **< 90s**.
5. Julian's review has no blocker findings.
6. `docs/build-report.md` gets a Phase 7.1 wave row.
7. v0.7.19 published to GitHub Releases with the L-002 capture in the build-report row.
8. `.learnings/learnings.jsonl` entries per the parallel-write protocol — each agent returns its entry to Marcus, Marcus appends serially.

---

## Locked instructions in effect for this wave

- **L-001** (drag-drop preserve): unaffected.
- **L-002** (operator-level screenshot on packaging waves): the v0.7.19 release ceremony at the end of this wave MUST include the L-002 capture.
- **L-003** (Node 20 baseline + no from-source `better-sqlite3` rebuild on Node 24): all test runs MUST be on Node 20.
- **L-004** _(landing in parallel via Dmitri)_: pdf.js `getDocument({data})` must receive a copied buffer. Any rasterize call in the test harness MUST use the copy helper. Each agent re-reads `.learnings/locked-instructions.md` at pre-flight.
- **L-005** _(landing in parallel via Dmitri)_: polyfill install must precede the dynamic `await import('pdfjs-dist/.../pdf.mjs')`. The test must use the `loadPdfJs()` helper. Each agent re-reads `.learnings/locked-instructions.md` at pre-flight.

---

## Out of scope (do not allow scope creep)

- Code-signing cert procurement (Phase 7.x separate).
- macOS / Linux verification (Phase 7 proper).
- Any feature work beyond the integration test (no Phase 3 form designer creep).
- Editing Marcus's agent prompt (deferred).
- Changing existing prod-render or `ocr-bootstrap.prod-render.test.ts` assertions.

---

## Wave decomposition

### Wave 1 (sequential) — Riley: test-harness contract design

**Outputs:** `docs/phase-7.1-test-design.md` (NEW)

**Riley owns the design of:**

- **Fixture selection.** Which PDFs to ship under `tests/fixtures/pdfs/`:
  - one **scanned-image-only** PDF (must invoke real OCR, no embedded text layer)
  - one **mixed-text** PDF (has text + needs OCR on an image region) — _stretch, optional_
  - one **rotated** PDF (90 or 270 degrees) — _stretch, optional_
  - one **multi-page** PDF (>= 2 pages so the "Recognizing page N of M" path runs)
  - one **CMYK** PDF — _stretch, optional_
  - Hard rule: **all fixtures must be originally authored or public-domain.** No copyrighted documents, no PII, no logos owned by third parties. Riley documents provenance per fixture.
- **Assertion surface.** What the spec asserts at each step:
  - OCR modal opens
  - modal reaches `Phase: complete` (or equivalent terminal state) within a budget
  - overlay paints (DOM probe via `page.evaluate` — count overlay spans, assert > 0)
  - no console errors during the run (gather `page.on('console')`, fail on `error` severity)
  - exit code 0
  - close + reopen: overlay restored (DOM probe again, same overlay span count)
- **Deterministic seeding.** How to make the test reproducible:
  - Option A: a test-only IPC channel `__test:seedOcrJob` (gated behind `NODE_ENV === 'test'`) that pre-populates the userData DB with a queued OCR job + fixture path, so the auto-resume path fires on launch.
  - Option B: drive the OCR start through the UI (click Tools -> Run OCR -> select fixture).
  - Riley picks one and writes the reasoning. Likely Option A for determinism; Option B can be a follow-up.
  - The v0.7.18 OCR-modal-mid-capture was non-deterministic; this test should make that evidence pattern reproducible.
- **Runtime budget.** Riley proposes a budget per phase (open + OCR-run + assert + close + reopen + assert). Diego will validate the budget against the CI <90s target in Wave 2.
- **Failure messages.** What each failure looks like (so Julian can review false-positive / false-negative risk in Wave 3).

**Reporting:** Riley reports back to Marcus. Marcus pauses, sanity-checks the design in <300 words, then dispatches Wave 2.

---

### Wave 2 (parallel) — David + Diego: implementation

**Owners:**

- David — Electron main / preload / IPC test-only surface
- Diego — Playwright spec + CI wiring + fixture PDFs

**David's slice (`src/main/`, `src/preload/`, `src/ipc/`):**

- If Riley's design picks Option A: add a `__test:seedOcrJob` IPC channel gated behind `NODE_ENV === 'test'`. Channel accepts a fixture path + queues an OCR job in the userData DB so the auto-resume path fires on next launch.
- The handler MUST refuse to register when `NODE_ENV !== 'test'`. The refusal is structural (early return at IPC registration time), not just runtime.
- Update `docs/api-contracts.md` if a new channel lands.
- If Riley's design picks Option B (UI-driven): David's slice is a no-op; he confirms in his return entry.
- David commits when his slice typechecks + lints + tests green (per-wave commit; do NOT batch).

**Diego's slice (`tests/e2e/ocr-integration.spec.ts`, `tests/fixtures/pdfs/`, `.github/workflows/ci.yml`):**

- Author `tests/e2e/ocr-integration.spec.ts` per Riley's contract. Use `_electron.launch({ args: ['.'] })` (same pattern as the existing `tests/e2e/smoke.spec.ts`).
- Place fixtures under `tests/fixtures/pdfs/` with a `README.md` documenting provenance per Riley's call.
- **L-004 compliance:** any rasterize call in the test harness MUST pass a copied buffer to `getDocument({ data })`. Use the project's copy helper.
- **L-005 compliance:** any pdf.js use in the harness MUST install the polyfill before the dynamic import; use the `loadPdfJs()` helper.
- Wire the spec into the existing `e2e` job in `.github/workflows/ci.yml` (it should already pick up `tests/e2e/*.spec.ts`; confirm and add config if needed).
- Pick a fixture small enough that the test finishes in **< 90s** in CI. Single-page scanned image at ~200 DPI is typically <30s on Tesseract eng; multi-page tests can be `.skip()` with a TODO if the budget would blow.
- Diego commits when the spec passes locally + the CI job is green on a draft branch.

**Both David and Diego return their learnings entries to Marcus instead of writing to `learnings.jsonl` directly** (per Marcus's Hard-Won Playbook on parallel-write contention). Marcus appends serially after the wave joins.

---

### Wave 3 (sequential) — Julian: review

**Output:** `docs/code-review.md` (updated).

**Julian reviews:**

- Fixture sanity — no copyrighted PDFs, no PII, no logos owned by third parties. Each fixture has documented provenance.
- CI runtime budget — does the spec genuinely fit in <90s on `windows-2025-vs2026`?
- False-positive risk — what does the test flake on? Tesseract non-determinism? Modal-state polling races?
- False-negative risk — what regression would slip through THIS test? (For example: would v0.7.14's Path2D ordering bug be caught? v0.7.15's buffer-detach? v0.7.16's tesseract.js v7 shape? v0.7.17's mount-overlay wire-up? v0.7.18's rotation handling? Julian walks the six prior releases and answers per release.)
- L-004 + L-005 compliance on any rasterize / pdf.js usage in the spec.
- Test-only IPC channel: confirmed gated behind `NODE_ENV === 'test'` structurally, not just runtime.

**Verdict:** GREEN / RED with a one-line summary. Blocker findings stop the wave; non-blockers are filed as follow-ups.

---

### Wave 4 (sequential) — Nathan: documentation

**Output:** **One section added** to `docs/developer-guide.md` titled "Running the OCR integration test". No new top-level docs.

**Section contents:**

- How to run locally (`npm run e2e` filter syntax)
- What the test exercises (one paragraph summary)
- Fixture provenance pointer (link to `tests/fixtures/pdfs/README.md`)
- How to add a new OCR fixture (one-paragraph runbook)

Nathan commits when his diff lints + the markdown renders cleanly.

---

### Release ceremony (Diego — sequential after Wave 4)

**Dispatch:** Marcus invokes `dev-ops-agent` for the v0.7.19 release ceremony. Per the Phase 5.2 handoff-seam learning logged on 2026-06-04, this step is **non-negotiable** — Marcus's wave subagents do not have `git push` / `gh release` primitives, and skipping this step means the wave is locally green but the release never ships.

**Ceremony checklist (Diego owns):**

- Bump `package.json` version 0.7.18 -> 0.7.19.
- Tag push (pre-push hook runs typecheck + lint + push).
- CI watch -> green.
- Promote draft -> Latest.
- Download portable + SHA256 verify against published digest.
- 7z extract inner archive + version verify.
- Launch the downloaded portable + 4-process verify.
- **L-002 capture** via PrintWindow + PW_RENDERFULLCONTENT. Capture at a point where the OCR modal is reachable (e.g. after the test fixture seeds a job and the auto-resume path fires) — the v0.7.18 incidental modal capture demonstrated this works in practice.
- Build-report row appended with full L-002 evidence per the v0.7.18 template.

---

## Learnings protocol (parallel-write avoidance)

Per Marcus's Hard-Won Playbook: **wave subagents in Waves 2 and 3 MUST NOT write to `.learnings/learnings.jsonl` directly.** Each returns its post-flight entry as a JSON object in its final report to Marcus. Marcus appends the entries serially after the wave joins, ensuring no contention and no `\b` / `\s` regex corruption.

Wave 1 (Riley alone) and Wave 4 (Nathan alone) are single-agent waves — they MAY write directly, but Marcus prefers the serial-append pattern for uniformity.

---

## Reporting cadence

- **After Wave 1 (Riley):** Marcus reports back to the user in <300 words with design summary + Wave 2 dispatch shape. Pause for sanity check.
- **After Wave 4 + release ceremony:** Marcus reports final status with build-report row path + v0.7.19 release URL.

---

## File ownership map (single-owner per file)

| Path                                                               | Owner                    |
| ------------------------------------------------------------------ | ------------------------ |
| `docs/phase-7.1-plan.md` (this file)                               | Marcus                   |
| `docs/phase-7.1-test-design.md`                                    | Riley                    |
| `tests/e2e/ocr-integration.spec.ts`                                | Diego                    |
| `tests/fixtures/pdfs/**` + `tests/fixtures/pdfs/README.md`         | Diego                    |
| Test-only IPC channel in `src/main/` + `src/preload/` + `src/ipc/` | David                    |
| `.github/workflows/ci.yml`                                         | Diego                    |
| `docs/code-review.md`                                              | Julian                   |
| `docs/developer-guide.md` (one new section)                        | Nathan                   |
| `docs/build-report.md` (Phase 7.1 wave row + v0.7.19 publish row)  | Marcus                   |
| `package.json` version bump                                        | Diego (release ceremony) |
