# Phase 7.2 — Test-Harness Contract Design

**Owner:** Riley (front-end-architect)
**Status:** Wave 1 draft, 2026-06-10. Hands off to David (Item A static-import lift) + Diego (Item B fix + Phase D+E live test body + bundler verification).
**Target tag:** `v0.7.20`
**Brief:** `docs/phase-7.2-plan.md` §Wave 1
**Target spec file (Diego):** `tests/e2e/ocr-integration.spec.ts` (Phase D+E body replaces the `test.skip()` at lines 525–528).
**Target test file (Diego):** `src/ipc/handlers/dialog-pick-pdf-files.test.ts` (Item B).
**Target main file (David):** `src/main/index.ts` (Item A static-import lift, lines 254–336).

This is a **design-only** document. Riley writes no production or test code in Wave 1. The contracts below are the source of truth Wave 2 implements; any divergence is a Julian-blocker in Wave 3.

Scope is two items, ordered as Marcus directs:

- **Item B** — Ubuntu CI fragility in `src/ipc/handlers/dialog-pick-pdf-files.test.ts:51`. Lands FIRST in Wave 2.
- **Item A** — `dist/main/` bundle does not include `src/db/repositories/*-repo.js`; six dynamic `require()` sites fall through to the memory bridge under `_electron.launch()`. Lands SECOND in Wave 2 (after B's draft-PR CI is green).

---

## §1 — Item B fix design

### 1.1 What the existing test actually asserts (and where it's fragile)

`src/ipc/handlers/dialog-pick-pdf-files.test.ts` has **five** `it(...)` cases (verified by re-reading the file at 2026-06-10):

| Line | Test                               | Input shape                                      | Asserts on                                                      |
| ---- | ---------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| 26   | `user_cancelled` (dialog canceled) | n/a                                              | error code only                                                 |
| 34   | `user_cancelled` (no paths)        | n/a                                              | error code only                                                 |
| 42   | **happy path (single-select)**     | `'C:/Users/test/a.pdf'`                          | **exact output `['C:\\Users\\test\\a.pdf']`** — line 51         |
| 54   | `multi:true` plumbing              | `['C:/Users/test/a.pdf', 'C:/Users/test/b.pdf']` | `paths.length === 2` + `properties.includes('multiSelections')` |
| 67   | `invalid_path` for traversal       | `[..., 'C:/Users/../etc/passwd.pdf']`            | error code only                                                 |
| 80   | `invalid_path` for non-.pdf        | `'C:/Users/test/a.exe'`                          | error code only                                                 |

**Marcus's plan note (line 226 of `phase-7.2-plan.md`) hedged that lines 67, 80, 54 "may share the Windows shape and need attention." I verified: they do not.**

Only **line 51** asserts on path **content**. The other four cases assert on error codes or array length — and the production sanitizer rejects them identically on Linux (traversal regex at `path-sanitizer.ts:266` fires before `normalize()`; extension check is platform-agnostic; `multi:true` counts only).

A node REPL probe under both platform helpers confirms the divergence is localized:

```
posix.normalize('C:/Users/test/a.pdf') → 'C:/Users/test/a.pdf'
posix.resolve  ('C:/Users/test/a.pdf') → '/<cwd>/C:/Users/test/a.pdf'   ← garbage
win32.normalize('C:/Users/test/a.pdf') → 'C:\\Users\\test\\a.pdf'
win32.resolve  ('C:/Users/test/a.pdf') → 'C:\\Users\\test\\a.pdf'
```

The sanitizer's last line is `resolve(normalized)` (using platform-default `node:path`). On Ubuntu CI, line 51 receives `'/<cwd>/C:/Users/test/a.pdf'`; the assertion (`['C:\\Users\\test\\a.pdf']`) explodes.

### 1.2 Decision — **B-1 (cross-platform path normalization in the test)**

**Picked: B-1.** Reasoning:

- **B-1** preserves the production-sanitizer round-trip on **both** platforms. That round-trip is the whole point of the file (Wave 13.5/17 ratchet, per the header comment). The fix needs only one line of test logic + a small derived expectation; the production sanitizer is unchanged.
- **B-2** (`describe.skipIf(process.platform !== 'win32')`) would silently lose Ubuntu coverage for **the four other tests** in the file — `user_cancelled`, `multi:true`, traversal-rejection, non-.pdf rejection — all of which are _already_ portable today. Skipping the whole describe block is a 5x over-correction.
- **B-3** (mocked sanitizer) erases the very property the file exists to gate (production-sanitizer behavior). Net negative.

A targeted B-2 scoped to **only line 51** is technically equivalent to B-1 in coverage shape, but harder to read three months from now and adds a dead-code branch on Windows. B-1 wins on clarity.

### 1.3 B-1 diff shape (what Diego writes — ~10 lines of test diff, zero production-code change)

**Strategy:** compute the expected output by feeding the **same input string** through the **same production sanitizer** the handler uses. On Windows, expected resolves to `'C:\\Users\\test\\a.pdf'`; on Linux, expected resolves to `'/<cwd>/C:/Users/test/a.pdf'`. Either way, the handler's output must equal what the sanitizer produces — that _is_ the round-trip the test enforces.

**Before** (lines 42–52, current):

```ts
it('happy path: returns a single sanitized path for default (single-select)', async () => {
  const deps = makeDeps({
    showOpenDialog: vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['C:/Users/test/a.pdf'],
    }),
  });
  const res = await handleDialogPickPdfFiles({}, deps);
  const val = expectOk(res);
  expect(val.paths).toEqual(['C:\\Users\\test\\a.pdf']);
});
```

**After** (B-1, ~12 lines, one new `const`):

```ts
it('happy path: returns a single sanitized path for default (single-select)', async () => {
  // Cross-platform: derive the expected shape from the same production
  // sanitizer the handler uses, so this assertion stays load-bearing on
  // BOTH Windows (`C:\Users\test\a.pdf`) and Ubuntu CI (`<cwd>/C:/...`).
  // The point of the test is the production-sanitizer round-trip, not
  // the specific Windows separator.
  const input = 'C:/Users/test/a.pdf';
  const expected = sanitizePath(input); // ← same fn the handler calls
  expect(expected).not.toBeNull(); // sanity gate
  const deps = makeDeps({
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [input] }),
  });
  const res = await handleDialogPickPdfFiles({}, deps);
  const val = expectOk(res);
  expect(val.paths).toEqual([expected!]);
});
```

`sanitizePath` is already imported at line 9 of the file — no new import needed.

### 1.4 OS coverage matrix (post-fix, all five tests on both platforms)

| Test                        | Asserts                                             | Windows               | Ubuntu              |
| --------------------------- | --------------------------------------------------- | --------------------- | ------------------- |
| `user_cancelled` (canceled) | error code                                          | green                 | green               |
| `user_cancelled` (no paths) | error code                                          | green                 | green               |
| happy-path single-select    | sanitizer round-trip equality                       | **green (was green)** | **green (was red)** |
| `multi:true` plumbing       | length 2 + `properties.includes('multiSelections')` | green                 | green               |
| `invalid_path` traversal    | error code                                          | green                 | green               |
| `invalid_path` non-.pdf     | error code                                          | green                 | green               |

All five tests stay load-bearing on both runners. No coverage lost.

### 1.5 Trade-off table

| Option               | Code change               | Windows coverage | Ubuntu coverage        | Sanitizer round-trip preserved | Risk                       |
| -------------------- | ------------------------- | ---------------- | ---------------------- | ------------------------------ | -------------------------- |
| **B-1** (chosen)     | 1 test file, +3 lines net | preserved        | restored               | yes                            | Low                        |
| B-2 (skipIf)         | 1 test file, +1 line      | preserved        | lost (4 tests skipped) | yes (Windows only)             | Low (silent coverage loss) |
| B-3 (mock sanitizer) | 1 test file, +many        | preserved        | green but meaningless  | **no** — defeats purpose       | High                       |

### 1.6 What this fix does NOT do

- It does **not** change the production sanitizer.
- It does **not** change any IPC contract.
- It does **not** add a Vitest snapshot. Snapshots would hide a regression behind a `--update-snapshot` re-blessing; equality against a freshly-computed `sanitizePath(input)` is the same shape with no hidden state.

---

## §2 — Item A bundling design

### 2.1 The six dynamic-require sites (re-verified 2026-06-10)

I re-read `src/main/index.ts:240–336` and grepped the file. **Exactly six** `require('../db/repositories/*-repo.js')` blocks exist, all inside the post-`initDatabase` try/catch chain. All six matter — the in-memory fallback breaks the v0.7.18 reopen-restore catch surface on every one.

| #   | Line | Module                    | Factory                    | Bridge slot      |
| --- | ---- | ------------------------- | -------------------------- | ---------------- |
| 1   | 254  | `form-templates-repo.js`  | `createFormTemplatesRepo`  | `formTemplates`  |
| 2   | 270  | `signature-audit-repo.js` | `createSignatureAuditRepo` | `signatureAudit` |
| 3   | 290  | `ocr-jobs-repo.js`        | `createOcrJobsRepo`        | `ocrJobs`        |
| 4   | 300  | `ocr-results-repo.js`     | `createOcrResultsRepo`     | `ocrResults`     |
| 5   | 312  | `language-packs-repo.js`  | `createLanguagePacksRepo`  | `languagePacks`  |
| 6   | 327  | `export-jobs-repo.js`     | `createExportJobsRepo`     | `exportJobs`     |

Julian's finding 7.1.5 named the three OCR sites (3/4/5) as load-bearing for the v0.7.18 catch surface. The other three (1/2/6) ride along — same packaging gap, same fix.

All six target files **exist on disk today** under `src/db/repositories/` — the original "Wave-N parallel-skew runtime probe" comments at lines 244–249 and elsewhere are stale. Ravi's repos all landed waves ago.

### 2.2 Decision — **A-1 (static-import lift)**

**Picked: A-1.** Reasoning:

- **Global learning (2026-05-27, Nathan, `~/.claude/learnings/global.jsonl`):** "RUNTIME `require()` OF IN-TREE PATHS IN ELECTRON MAIN-PROCESS CODE IS A PACKAGING ANTI-PATTERN under Vite/Rollup. **SECOND cross-project-worthy instance** observed in PDF_Viewer_Editor ... THIRD instance ratchet triggers a backend-engineer Hard-Won Playbook hard ban + locked-instructions pre-commit grep + ESLint `no-restricted-syntax`." **A-2 (manifest-driven include) preserves the anti-pattern by design.** A-1 removes it. We are explicitly choosing not to be the third instance.
- The **export-bootstrap precedent** (Wave 24 → v0.7.x cleanup) already converted `require('./export/export-bootstrap.js')` to a static `import` after the exact same Vite tree-shake gap (`.learnings/failures/2026-05-27-runtime-require-vite-tree-shake-packaging-gap.md`). David already shipped the `import` form for the OCR + auto-update bootstraps. The repo factories are the last cluster still on the dynamic-require pattern; A-1 finishes the unification.
- A-1's diff to `src/main/index.ts` is mechanical and bundler-visible. Vite walks the import graph at build time — there is no manifest to drift, no string list to keep in sync. The bundler's own correctness check (every `import` resolves) IS the verification.
- A-2 would require Diego to add an `include` list to `electron.vite.config.ts` and Julian to spot-check it every time Ravi adds a new repo. Single-source-of-truth violation. A-1 keeps the import graph the source of truth.

The trade is: A-1 has a slightly larger `src/main/index.ts` diff (six try/catch blocks become six top-level imports + an inline factory-presence check). I judge that worth it. David owns this slice.

### 2.3 A-1 mechanics — how the memory-fallback semantics survive

The current code does two distinct things in each try/catch:

1. **Resolve the module** (may fail at packaging time, currently silent → memory fallback).
2. **Probe the factory function exists** (may fail because the export name drifted, currently silent → memory fallback).

After A-1's static-import lift, **(1) cannot fail at runtime** (Vite resolves at build time; bundler crashes the build if a module is missing). That is the desired property — packaging-gap failures become **build-time loud** instead of **runtime silent**.

**(2)** can still fail in two legitimate cases:

- A future repo factory throws at construction time (e.g. SQLite open fails because the prepared statement won't compile against a schema-version skew). David's existing pattern handles this — wrap the factory CALL in `try { ... } catch { fallback }`. The import itself is unconditional; only the _invocation_ is guarded.
- A test scenario that injects a broken repo deliberately (e.g. via `vi.mock` returning `undefined`). David's Wave 2 unit test (`src/main/index.test.ts`) adds this coverage so the memory fallback stays exercised.

**Net effect:** memory fallback semantics are preserved for runtime-construction failures; packaging-gap failures (which were silent and load-bearing on real users) become build-time errors. This is the correct trade. The constructor-throw path is the only legitimate memory-fallback case; the import-missing path was always a bug.

### 2.4 A-1 sketch (illustrative; David writes the final form)

**Top of `src/main/index.ts`** — six new static imports next to the existing `initDatabase` / `createBookmarksRepo` / `createRecentFilesRepo` / `createSettingsRepo` imports:

```ts
import { createFormTemplatesRepo } from '../db/repositories/form-templates-repo.js';
import { createSignatureAuditRepo } from '../db/repositories/signature-audit-repo.js';
import { createOcrJobsRepo } from '../db/repositories/ocr-jobs-repo.js';
import { createOcrResultsRepo } from '../db/repositories/ocr-results-repo.js';
import { createLanguagePacksRepo } from '../db/repositories/language-packs-repo.js';
import { createExportJobsRepo } from '../db/repositories/export-jobs-repo.js';
```

**Bridge-wiring block (replaces lines 244–336)** — each previously-runtime-probed slot becomes a small constructor-call helper with a synchronous try/catch around just the invocation:

```ts
const memoryBridge = createMemoryDbBridge();

function bridgeOrFallback<R, M>(
  factory: ((db: unknown) => R) | undefined,
  adapt: (raw: R) => M,
  fallback: M,
): M {
  if (typeof factory !== 'function') return fallback;
  try {
    return adapt(factory(db));
  } catch {
    return fallback;
  }
}

setDbBridge({
  recents: adaptRecentsRepo(createRecentFilesRepo(db)),
  bookmarks: adaptBookmarksRepo(createBookmarksRepo(db)),
  settings: adaptSettingsRepo(createSettingsRepo(db)),
  formTemplates: bridgeOrFallback(
    createFormTemplatesRepo,
    adaptFormTemplatesRepo,
    memoryBridge.formTemplates,
  ),
  signatureAudit: bridgeOrFallback(
    createSignatureAuditRepo,
    adaptSignatureAuditRepo,
    memoryBridge.signatureAudit,
  ),
  ocrJobs: bridgeOrFallback(createOcrJobsRepo, adaptOcrJobsRepo, memoryBridge.ocrJobs),
  ocrResults: bridgeOrFallback(createOcrResultsRepo, adaptOcrResultsRepo, memoryBridge.ocrResults),
  languagePacks: bridgeOrFallback(
    createLanguagePacksRepo,
    adaptLanguagePacksRepo,
    memoryBridge.languagePacks,
  ),
  exportJobs: bridgeOrFallback(createExportJobsRepo, adaptExportJobsRepo, memoryBridge.exportJobs),
});
```

David is free to inline `bridgeOrFallback` or keep the six try/catch blocks individually — the load-bearing properties are the **six static imports at the top of the file** and the **adapter-call still guarded against constructor throw**. The helper above is a style suggestion, not a contract.

### 2.5 Bundler-visibility argument (Julian's Wave 3 reads this)

Vite/Rollup's tree-shake decision walks the `import` graph. **Anything reached by an `import` statement at the top of an entry file is in the bundle.** Anything reached by `require(<literal-string>)` at runtime depends on bundler-specific heuristics (sometimes preserved, sometimes inlined, sometimes silently dropped — see the v0.7.x export-bootstrap RCA). A-1 puts all six repo modules into the **statically-reachable** category. The verification is the build itself — if `electron-vite build` succeeds, the modules are in `dist/main/`.

### 2.6 A-verification probe — **Decision 3: P-2 (test-only IPC handler exposing `whichBridge`)**

**Picked: P-2.** Reasoning:

- **P-1 (console-log probe + `page.on('console')` capture)** runs into the very Phase F filter the spec uses to assert _no console errors_. The probe would emit at `console.log`, not `console.error`, so it wouldn't trip the filter — but adding observability noise to the bridge-init path widens the future-flake surface. Every future "did we log too much?" question now has to triage this probe.
- **P-3 (extend `__test:seedOcrJob` to return `whichBridge`)** is the cheapest in lines but couples the bridge-introspection concern to the seed channel. The seed channel's job is "insert a row I can later read"; the bridge-introspection probe's job is "tell me which factory built the row's home." Conflating them makes it harder to evolve the seed channel later. Reject on single-responsibility grounds.
- **P-2** adds one tiny test-only channel `__test:whichBridge` with the same `NODE_ENV==='test'` registration gate as `__test:seedOcrJob`. The handler returns `{ ocrJobs: 'sqlite' | 'memory', ocrResults: 'sqlite' | 'memory', languagePacks: 'sqlite' | 'memory', formTemplates, signatureAudit, exportJobs }` — six fields, one per repo. Implementation: the existing `setDbBridge` call site already knows which factory each slot got (the `bridgeOrFallback` helper returned `memoryBridge.X` on fallback; the SQLite factory result otherwise). David adds a tiny tag at construction (`{kind:'sqlite'|'memory', repo}`) read by the probe. Cost: ~25 lines of IPC scaffolding + types.

**Where the probe fires in the test:** Phase A, immediately after `waitForBridgeAndTestNs(window1, 'launch1')`. Assert all six slots are `'sqlite'`. If any are `'memory'`, fail with a load-bearing message:

```
Bridge probe: expected all 6 repos to be 'sqlite' under _electron.launch(); got
  ocrJobs=memory, ocrResults=memory, formTemplates=sqlite, signatureAudit=sqlite,
  languagePacks=sqlite, exportJobs=sqlite. The static-import lift in
  src/main/index.ts is incomplete or vite tree-shook a module. Item A regression.
```

This **also** makes the probe useful as a long-lived guard: any future regression in the import graph trips this assertion at Phase A, before Phase D+E even starts, with an attributable message. P-2 is the only option of the three that doubles as ongoing regression coverage.

### 2.7 Coordination point (David ↔ Diego)

A-1 is **David-heavy**: edits to `src/main/index.ts` + new unit tests in `src/main/index.test.ts` + the `__test:whichBridge` handler + its preload mirror + its IPC contract types. Diego writes **zero** bundler-config changes for A. Diego's A work is downstream — replace the `test.skip()` at `ocr-integration.spec.ts:525-528` with the live Phase D+E body that uses the P-2 probe.

This is cleaner than A-2 would have been (A-2 needed David + Diego to land bundler-config + import-graph changes together; A-1 lets David ship the import lift first, draft-PR-CI-verify, then Diego layers the test body on top).

---

## §3 — Phase D+E live test body (replaces `test.skip()` at `ocr-integration.spec.ts:525-528`)

The Phase 7.1 design (§2.5 + §2.6 of `docs/phase-7.1-test-design.md`) specifies the assertions verbatim. **I re-read both sections at 2026-06-10 and the design still holds** — no deltas. The Phase 7.1 description "After close → relaunch with the same userData dir, `listJobs({limit:100})` returns the original `jobId` with `status === 'completed'`. `listResultsByJob({jobId})` returns a non-empty result whose `page0.words.length` equals the pre-close count. No console errors during the second launch." is reproduced below in test-body sketch form.

### 3.1 Test name and outer shape

Drop the env-gate (`OCR_E2E_RELAUNCH_RESTORE`) entirely. The test runs by default once Item A is done. Header comment notes the gate's removal so future grep doesn't get confused.

```ts
test('OCR overlay restores on close + relaunch', async () => {
  // ... body sketched below ...
});
```

### 3.2 Phase D — close + relaunch

Phase D presumes Phase A–C already ran and captured:

- `userDataDir` (the `mkdtempSync` dir from Phase A — reused for the second launch)
- `originalJobId` (from `runOnDocument`'s `summary.jobId`, line ~440 of current spec)
- `originalPage0WordCount` (Phase C: `state.ocr.pageResultsByPage[0]?.words?.length`)

```ts
// ============================== PHASE D ==============================
// Close app1, relaunch with the SAME userDataDir, wait for the preload
// bridge to re-attach. Phase D budget: BUDGET_RELAUNCH_MS (15s).
const phaseDStart = Date.now();
await app1.close();
// Small settle delay so the SQLite WAL/file handles release on Windows.
// Per Riley §4 risk-register: max 500 ms; default 250 ms.
await new Promise((r) => setTimeout(r, 250));

const { app: app2, window: window2, consoleCollector: errors2 } = await launchApp(userDataDir);
await waitForBridgeAndTestNs(window2, 'launch2');

// Bridge-introspection sanity (Item A P-2 probe). Same six-slot check as
// Phase A — if anything drifted on relaunch it surfaces here.
const bridge2 = await window2.evaluate(async () => {
  const api = (
    window as unknown as {
      pdfApi: { __test: { whichBridge: () => Promise<Record<string, string>> } };
    }
  ).pdfApi;
  return api.__test.whichBridge();
});
expect(bridge2.ocrJobs, `[launch2] ocrJobs bridge: ${bridge2.ocrJobs}`).toBe('sqlite');
expect(bridge2.ocrResults, `[launch2] ocrResults bridge: ${bridge2.ocrResults}`).toBe('sqlite');

// Re-open the same fixture on the second launch.
const reopenResult = await window2.evaluate(async (fixturePath) => {
  const api = (
    window as unknown as {
      pdfApi: { fs: { readPdf: (req: { path: string }) => Promise<{ ok: boolean }> } };
    }
  ).pdfApi;
  return api.fs.readPdf({ path: fixturePath });
}, FIXTURE_1P);
expect(reopenResult.ok, '[launch2] readPdf on relaunch failed').toBe(true);

const phaseDMs = Date.now() - phaseDStart;
expect(phaseDMs, `Phase D exceeded budget: ${phaseDMs}ms > ${BUDGET_RELAUNCH_MS}ms`).toBeLessThan(
  BUDGET_RELAUNCH_MS,
);
```

### 3.3 Phase E — overlay restoration

```ts
// ============================== PHASE E ==============================
// loadOcrResultsThunk fires on doc-open: ocr:listJobs (filter:
// docHash + status='completed') -> ocr:listResultsByJob. With userData
// preserved, the Phase B job + results rows are still present.
// Phase E budget: BUDGET_RESTORE_MS (10s).
const phaseEStart = Date.now();

const restoredJobs = await window2.evaluate(async () => {
  const api = (
    window as unknown as {
      pdfApi: {
        ocr: {
          listJobs: (req: Record<string, unknown>) => Promise<{
            ok: boolean;
            value?: { jobs: { id: number; status: string }[] };
          }>;
        };
      };
    }
  ).pdfApi;
  return api.ocr.listJobs({ limit: 100 });
});
expect(restoredJobs.ok, '[launch2] listJobs failed after relaunch — SQLite repo not loaded?').toBe(
  true,
);

const restoredCompletedJob = restoredJobs.value?.jobs.find(
  (j) => j.id === originalJobId && j.status === 'completed',
);
expect(
  restoredCompletedJob,
  `Phase E: original jobId=${originalJobId} not found after relaunch. ` +
    `Got jobs: ${(restoredJobs.value?.jobs ?? []).map((j) => `${j.id}:${j.status}`).join(',')}. ` +
    `This is the v0.7.18 reopen-restore signature — SQLite row did not persist or listJobs lost it.`,
).toBeDefined();

const restoredResults = await window2.evaluate(async (jobId) => {
  const api = (
    window as unknown as {
      pdfApi: {
        ocr: {
          listResultsByJob: (req: { jobId: number }) => Promise<{
            ok: boolean;
            value?: { pages: { pageIndex: number; words: { text: string }[] }[] };
          }>;
        };
      };
    }
  ).pdfApi;
  return api.ocr.listResultsByJob({ jobId });
}, originalJobId);

expect(restoredResults.ok, '[launch2] listResultsByJob failed').toBe(true);
const restoredPage0 = restoredResults.value?.pages.find((p) => p.pageIndex === 0);
expect(
  restoredPage0,
  `Phase E: no page-0 results restored for jobId=${originalJobId}`,
).toBeDefined();
expect(
  restoredPage0!.words.length,
  `Phase E: restored page-0 word count ${restoredPage0!.words.length} != pre-close ${originalPage0WordCount}. ` +
    `Drift through SQLite serialize/deserialize — v0.7.18 catch surface.`,
).toBe(originalPage0WordCount);

const phaseEMs = Date.now() - phaseEStart;
expect(phaseEMs, `Phase E exceeded budget: ${phaseEMs}ms > ${BUDGET_RESTORE_MS}ms`).toBeLessThan(
  BUDGET_RESTORE_MS,
);

// Phase F (no-console-errors) — same exact-match 'error' filter as Phase A
// (Riley 7.1 §2.7). Must collect BOTH launches' errors.
const allErrors = [...errors1.errors, ...errors2.errors];
expect(
  allErrors,
  `Console errors across launch1+launch2 (${allErrors.length}): ${allErrors.join(' | ')}`,
).toEqual([]);

// Phase G — clean shutdown.
await app2.close();
```

### 3.4 Budget confirmation — Decision 4

The existing constants at `ocr-integration.spec.ts:102 + 104` are:

```ts
const _BUDGET_RELAUNCH_MS = 15_000;
const _BUDGET_RESTORE_MS = 10_000;
```

**I confirm both values unchanged.** Reasoning:

- 15s for relaunch is the same shape as the Phase A `BUDGET_BRIDGE_READY_MS` (15s) — Electron launch + preload bridge is the dominant cost on the Windows GitHub runner.
- 10s for restore is generous for two IPC calls (`listJobs` + `listResultsByJob`) + Redux dispatch. The Phase 7.1 design §4 modeled this at 10s explicitly and that model still holds.
- **Total budget after D+E:** Phase A (15) + B (25) + C (5) + D (15) + E (10) + F+G (5) = **75 s**, still 15 s under the 90 s ceiling. No headroom regression.

Diego removes the `// eslint-disable-next-line @typescript-eslint/no-unused-vars` comments and the underscore prefix (`_BUDGET_RELAUNCH_MS` → `BUDGET_RELAUNCH_MS`) as part of Item A's Wave 2 work.

---

## §4 — Risk register for Phase D+E

| Risk                                                                                                                                                                                                                                                         | Likelihood                                                | Detection                                                                                                           | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1.** SQLite file-lock race on `app.close()` → relaunch on Windows. better-sqlite3 closes the handle synchronously on app quit, but the WAL/SHM sidecar files may take an OS-cycle to release; the second launch's `initDatabase` then sees `SQLITE_BUSY`. | Medium (Windows-specific)                                 | `initDatabase` throw → `[launch2] readPdf failed` (cascade) — message obscures cause.                               | **Default mitigation (Diego implements):** 250 ms settle delay between `await app1.close()` and the second `launchApp(userDataDir)` (already in §3.2 sketch). Riley's plan-doc cap is ≤500 ms; 250 ms covers the observed Windows release latency with margin. **Escalation if flaky in CI:** retry-once with a documented hash of the failure evidence (per `docs/phase-7.2-plan.md` §Risks). Diego adds the retry as a Playwright `test.fixme(...)` rerun-with-evidence pattern; do NOT silently retry. |
| **R2.** `userDataDir` cleanup race — Playwright's per-test temp-dir cleanup runs while app2 still holds a handle.                                                                                                                                            | Low                                                       | `rmSync(userDataDir, {recursive:true, force:true})` warns / fails in `afterEach`.                                   | Per Phase 7.1 §2.1, the spec uses `mkdtempSync` + explicit `rmSync` in `afterEach` after `app2.close()` resolves. Phase 7.2 inherits this. If Diego hits cleanup warnings on CI, switch the cleanup to `{maxRetries:3, retryDelay:100}` (Node 18.13+ `fs.rmSync` options).                                                                                                                                                                                                                                |
| **R3.** Tesseract non-determinism leaking into the restored word count — Phase B's `summary.totalWords` differs from Phase E's `restoredPage0.words.length` by ±1 across Tesseract minor versions.                                                           | Low                                                       | Strict equality assertion fires with a clear delta.                                                                 | The restored count is read from the **SQLite row that Phase B wrote**, not from a fresh Tesseract run. Persistence is deterministic. The only drift surface is the serialize/deserialize round-trip, which is what we want to gate. Equality is correct. **Do not loosen** to `>=` — that would hide the v0.7.18 class.                                                                                                                                                                                   |
| **R4.** `loadOcrResultsThunk` doesn't fire on the relaunch because `currentDocId` is stale from the first launch's Redux state.                                                                                                                              | Low (state is per-process)                                | Phase E `listJobs.ok` returns true but no completed row matches `originalJobId`.                                    | Each launch is a fresh Electron process → fresh Redux store. State is not preserved. The thunk fires on the second launch's first `openPdf` call (Phase D's `readPdf`), which dispatches the docId, which the thunk listens for. Sanity in Phase A's design holds.                                                                                                                                                                                                                                        |
| **R5.** The P-2 `__test:whichBridge` probe leaks into a prod build.                                                                                                                                                                                          | Low (structural gate is identical to `__test:seedOcrJob`) | grep `tests/` for `__test\.whichBridge` outside test code; David's preload registers ONLY when `NODE_ENV==='test'`. | Same gate pattern as Phase 7.1 §3 — registration is at app boot, conditional on `process.env['NODE_ENV'] === 'test'`. A renderer in a prod build that calls `pdfApi.__test.whichBridge` gets `pdfApi.__test === undefined` → TypeError on first property access. The channel does not exist in prod IPC surface.                                                                                                                                                                                          |
| **R6.** Phase B's word count is captured before `pageResultsByPage` finishes hydrating in Phase C, so `originalPage0WordCount` ends up `undefined` and the Phase E equality fails with `NaN === undefined`.                                                  | Low                                                       | Phase E equality throws comparison-of-undefined.                                                                    | Phase C already has a `BUDGET_HYDRATE_MS` wait that gates `pageResultsByPage[0]` becoming non-empty (per Phase 7.1 §2.4). Capture `originalPage0WordCount` AFTER that wait. Add explicit `expect(originalPage0WordCount).toBeGreaterThanOrEqual(FLOOR_TOTAL_WORDS)` immediately after capture so a regression surfaces in Phase C, not Phase E.                                                                                                                                                           |

---

## §5 — Lock compliance

I re-read `.learnings/locked-instructions.md` at pre-flight (2026-06-10). The five locks status:

- **L-001 (`enableDragDropFiles`):** **unaffected.** No `BrowserWindow` `webPreferences` changes in either Item A or B. The drag-drop flow in `app.tsx` is untouched.
- **L-002 (operator-level screenshot on packaging waves):** **applies to release ceremony only.** v0.7.20 publish row in `docs/build-report.md` must carry the L-002 capture per the same rule. Wave 1 does not ship packaging — out of scope here; reaffirmed for Diego at the ceremony step.
- **L-003 (Node 20 baseline; no `better-sqlite3` source rebuild on Node 24):** **applies.** Both David's `src/main/index.test.ts` runs and Diego's `npm run e2e` MUST be on Node 20 (`scripts/check-node.mjs` gate). The static-import lift does not touch better-sqlite3 directly — the repos still use the same ABI binding via `initDatabase`. No new native ABI surface.
- **L-004 (pdf.js `getDocument({data})` copied buffer):** **unaffected.** Phase D+E test body calls `pdfApi.fs.readPdf` + `pdfApi.ocr.listJobs` + `pdfApi.ocr.listResultsByJob` only. Zero direct pdf.js calls in the harness. All pdf.js call sites stay inside `src/main/pdf-ops/ocr-bootstrap.ts` where L-004 is already enforced (`toPdfJsBuffer`).
- **L-005 (pdf.js polyfill order before dynamic import):** **unaffected.** Same argument as L-004 — the harness does not load pdf.js, so the polyfill-order rule is not exercised at the e2e tier.

Julian's Wave 3 review should verify these five claims with a grep over the diff (`pdfjs|getDocument|loadPdfJs|enableDragDropFiles`) and confirm zero hits outside whitelisted files.

---

## §6 — Open questions / non-blocking

1. **P-2 channel name.** I picked `__test:whichBridge` for symmetry with the existing `__test:seedOcrJob`. David may prefer `__test:dbBridgeKinds` (more specific). Non-blocking; David picks at implementation time and notes in his entry.

2. **`bridgeOrFallback` helper vs. six inline try/catches.** §2.4 sketches a helper; David may judge the helper too clever and prefer six explicit blocks. Either shape satisfies the contract. Non-blocking; choose for readability.

3. **L-003-class follow-up — runtime-require ratchet.** Nathan's 2026-05-27 global learning predicted "third instance triggers a Hard-Won Playbook hard ban + locked-instructions pre-commit grep." A-1 _removes_ the third instance preemptively, but the **ratchet itself** (an L-006 lock + a grep script) would prevent regression. This is **out of scope for Phase 7.2** (a Dmitri-between-builds task) but worth flagging for Marcus. If Marcus wants it inside Phase 7.2, Diego can add `scripts/ratchet-no-runtime-require-in-main.mjs` to his slice — cost is ~30 LOC + a CI workflow line. Default: defer; let Dmitri promote.

4. **Bonus evidence on the packaged binary** (per `phase-7.2-plan.md` §Release ceremony). The plan asks Diego to optionally run `npm run e2e -- --grep "OCR overlay restores"` against the **packaged binary** during release ceremony. The current spec uses `_electron.launch()` against the dev tree. Wiring it to point at the packaged `.exe` is a small extra (`executablePath` override on `electron.launch`). Out of design scope; Diego's call at ceremony time.

5. **`OCR_E2E_RELAUNCH_RESTORE` env-gate removal.** §3.1 calls for dropping the gate entirely. Should the gate be left in as a `process.env.OCR_E2E_RELAUNCH_RESTORE === '0'` opt-OUT (for users who want to skip locally)? **My default:** no. The plan removes it; the test runs by default. A user wanting to skip can `npm run e2e -- --grep -v "OCR overlay restores"`. Non-blocking; Diego confirms.

---

## §7 — Hand-off summary

| Wave | Owner  | Reads this doc §                   | Produces                                                                                                                                                                                                                                                |
| ---- | ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | Diego  | §1 (full)                          | Item B fix in `src/ipc/handlers/dialog-pick-pdf-files.test.ts` (lines 42–52 only).                                                                                                                                                                      |
| 2    | David  | §2 (full), §6.1, §6.2              | `src/main/index.ts` static-import lift (lines ~54–60 + ~244–336); `src/main/index.test.ts` memory-fallback coverage; `src/ipc/handlers/test-which-bridge.ts` (new, P-2 channel) + preload mirror + contracts entry.                                     |
| 2    | Diego  | §2.5, §2.6, §3 (full), §4, §5      | Replace `test.skip()` at `ocr-integration.spec.ts:525–528` with Phase D+E live body; remove `_BUDGET_RELAUNCH_MS` / `_BUDGET_RESTORE_MS` underscore + eslint-disable; remove the `OCR_E2E_RELAUNCH_RESTORE` env-gate doc references in the spec header. |
| 3    | Julian | §1.4, §1.6, §2.5, §2.6, §3, §4, §5 | `docs/code-review.md` Phase 7.2 verdict (GREEN/RED).                                                                                                                                                                                                    |
| 4    | Nathan | §3.1, §5, §6.5                     | One amendment to `docs/developer-guide.md` §"Running the OCR integration test" noting the close+relaunch+restore phase runs by default.                                                                                                                 |

End of design.
