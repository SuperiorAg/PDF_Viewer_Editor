# Wave 3 Brief — Diego + Julian (parallel)

**Author:** Marcus (Chief Delivery Officer)
**Date:** 2026-05-21
**Status:** Drafted, awaiting user dispatch go-ahead.
**Wave 3 verdict:** YELLOW — fire on go-ahead. No blockers. Five Diego deltas absorb Wave-2 follow-ups (item-by-item in §1 below).

Both agents work in parallel. Diego owns infrastructure (build, packaging, CI, tooling config). Julian owns the security + quality audit and writes `docs/code-review.md`. No file conflicts: Diego owns `package.json`, root `tsconfig.json` + per-target tsconfigs, `electron-builder.yml`, `.github/`, `scripts/`, top-level config files (`.eslintrc*`, `.prettierrc*`, `vitest.config.ts` if rooted). Julian reads everything under `src/` and writes only `docs/code-review.md`.

---

## 0. Required reading (both agents)

Before any edit:

- `d:/Projects/PDF_Viewer_Editor/CLAUDE.md` — project rules
- `d:/Projects/CLAUDE.md` — swarm rules
- `d:/Projects/PDF_Viewer_Editor/ARCHITECTURE.md` — especially §2 (security), §3 (library inventory), §5 (Redux), §6 (dual-engine export)
- `d:/Projects/PDF_Viewer_Editor/docs/api-contracts.md` (now includes §9 window namespace and §9.5 `'not_implemented'` convention)
- `d:/Projects/PDF_Viewer_Editor/docs/data-models.md`
- `d:/Projects/PDF_Viewer_Editor/docs/conventions.md`
- `d:/Projects/PDF_Viewer_Editor/docs/build-report.md` — especially the Wave 2 sections and "Wave 2 Integration — Marcus's Verdict"
- `.learnings/learnings.jsonl` (last 200 lines) and `c:/Users/ahudson/.claude/learnings/global.jsonl` (filter on your own `agent` slug)
- `.learnings/locked-instructions.md` if present — hard constraints

---

## 1. Diego — Director of Platform Engineering & Release Operations

**Slug:** `dev-ops-agent`
**Owns (writes):**

- `package.json` (root, replacing David's stub)
- `tsconfig.json` (root)
- `tsconfig.main.json` (replacing David's stub) + `tsconfig.preload.json` + `tsconfig.renderer.json`
- `.eslintrc.cjs` (or flat `eslint.config.js` — Diego picks; document the choice)
- `.prettierrc` (+ `.prettierignore`)
- `vitest.config.ts` (root config that picks up `src/**/*.test.ts(x)` in both renderer + main)
- `playwright.config.ts`
- `vite.config.ts` (root — folding in Riley's `src/client/vite.config.ts` patterns; Riley's renderer-side config is a Phase-1 placeholder)
- `electron.vite.config.ts` if going with `electron-vite` (recommended per ARCHITECTURE §3)
- `electron-builder.yml`
- `.github/workflows/ci.yml` (and any release workflow)
- `scripts/` — any `scripts/rebuild-native.{sh,ps1}`, `scripts/postinstall.cjs`, etc.
- `.npmrc`, `.nvmrc` if needed

**Reads (never writes):** everything else.

### 1.1 Package.json — required dep set

Compile this from the three Wave-2 agent wishlists. Verify each against their status rows in `docs/build-report.md`:

**runtime deps (`dependencies`):**

- `electron@^30` — David
- `react@^18.3`, `react-dom@^18.3` — Riley
- `@reduxjs/toolkit@^2.2`, `react-redux@^9` — Riley
- `pdfjs-dist@^4.4` — Riley (needed to flip `pdf-render.ts` from stub to real)
- `pdf-lib@^1.17` — Riley + David
- `better-sqlite3@^11` — Ravi
- `@dnd-kit/core@^6`, `@dnd-kit/sortable@^8` — Riley (Phase-2 reorder UX uses these; ship Phase 1 too so the disabled affordance compiles)
- `zod@^3.23` — David (payload validation per ARCHITECTURE §2.3)

**dev deps (`devDependencies`):**

- `typescript@^5.4`
- `@types/node@^20` — David
- `@types/better-sqlite3` — Ravi
- `@types/react@^18`, `@types/react-dom@^18` — Riley implicit
- `vite@^5`, `@vitejs/plugin-react@^4`, `electron-vite@^2`
- `electron-builder@^24`
- `vitest@^1.6`, `@vitest/ui@^1.6` (optional)
- `@testing-library/react@^15`, `@testing-library/jest-dom@^6`, `jsdom@^24` — Riley
- `playwright@^1.44`, `@playwright/test@^1.44`
- `eslint@^8`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-plugin-import`
- `prettier@^3`
- `concurrently` (for `dev` script orchestrating main+renderer+preload watch)

If `electron-vite` covers the multi-process orchestration cleanly, drop the separate `vite.config.ts` paths and use its conventions.

### 1.2 Required npm scripts

- `dev` — multi-process dev with reload (main+preload+renderer)
- `build` — TS compile + Vite build per process + collect into `dist/`
- `start:built` — boot `dist/main/index.js` (smoke)
- `lint` — ESLint over `src/**/*.{ts,tsx}` + `--max-warnings 0`
- `format` — Prettier write
- `typecheck` — three `tsc --noEmit` runs (main, preload, renderer)
- `test` — Vitest
- `test:watch`, `test:ui` (optional)
- `e2e` — Playwright (enables Riley's currently-`test.skip` placeholder)
- `pack` — `electron-builder --dir` (unpackaged, for quick smoke)
- `dist` — `electron-builder` full MSI + portable .exe per Phase 1 packaging spec
- `rebuild` — `electron-builder install-app-deps` (native modules — required after install for `better-sqlite3`)

### 1.3 ESLint rule decisions (Wave 2 follow-ups)

**a) `jsx-a11y/aria-proptypes` decision (Marcus verdict: configure rule, don't lock in Riley's workarounds):**

Set `'jsx-a11y/aria-proptypes': ['warn', { allowedDynamic: true }]` if the shipped plugin version supports that option. Verify by reading the version's rule docs before committing. If `allowedDynamic` isn't supported in the installed version, fall back to: downgrade rule to `warn`, add a top-of-file `// eslint-disable-next-line jsx-a11y/aria-proptypes` exception in `toolbar-button.tsx`, and log a Phase-7 a11y backlog item to restore strict + add proper tab-pattern ARIA in sidebar/settings. Either way, **don't make the renderer permanently revert tab semantics** — that's a Phase-7 follow-up.

**b) `no-restricted-imports` for renderer boundary (per conventions §4.3 and Riley's gatekeeper-module pattern):**

Constrain `src/client/**` to forbid imports from `src/main/**`, `src/ipc/handlers/**`, `src/preload/**`, `src/db/**`, and the `electron` package (the renderer must access Electron only via `window.pdfApi`). The only legal cross-boundary import is `src/client/types/ipc-contract.ts` → `src/ipc/contracts.ts` (type-only). Document the rule in the ESLint config with a comment referencing Riley's gatekeeper.

**c) `consistent-return-result` (placeholder per `api-contracts.md` §10):**

If a custom rule isn't ready, skip — note it as Phase-2 backlog. The existing TS exhaustive-check + handler test coverage already enforces the contract in practice.

### 1.4 Diego delta tasks from Wave 2 (Marcus's verdict items)

| #   | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | Tiny David coord: ask David to export `PdfCombineSource = PdfCombineRequest['sources'][number]` from `src/ipc/contracts.ts`. Once exported, Riley's `types/ipc-contract.ts` swap its derived alias for a re-export. Diego coordinates; do not edit David's contract file unilaterally.                                                                                                                                                                                                                                     |
| 5   | `aria-proptypes` config — see §1.3a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | Add `pdfjs-dist@^4.4` to deps. Wire worker per pattern documented at top of `src/client/services/pdf-render.ts`. Flip stub to real.                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | Enable Playwright Electron e2e — flip `test.skip` to `test` in `tests/e2e/smoke.spec.ts`, add Electron launch fixture, wire into CI.                                                                                                                                                                                                                                                                                                                                                                                       |
| 8   | **drag-drop lock:** add a Vitest unit test (`src/main/window-manager.test.ts`) that constructs the `BrowserWindow` options via David's exported factory and asserts `webPreferences.enableDragDropFiles !== false`. Without this test, a future agent edit silently breaks drag-drop. (Marcus will additionally add a `.learnings/locked-instructions.md` entry — Diego: do not toggle `enableDragDropFiles` in `webPreferences`; the default `true` is load-bearing for Riley's drag-drop file path access in `app.tsx`.) |

### 1.5 electron-builder config

- Windows targets: MSI installer + portable .exe (Phase 1 packaging spec)
- Installer file-association checkbox **default ON** per locked Decision 4 — use NSIS `addPdfHandlerCheckbox` or equivalent; verify the registry entries match David's runtime toggle channels (`app:setDefaultPdfHandler`/`getDefaultPdfHandlerStatus`)
- Code-signing placeholder block (commented-out cert/passphrase env vars; do not commit certs)
- `asar: true`, but exclude `node_modules/better-sqlite3/build/**` from asar packing (native modules need extraction)
- `electronVersion` pinned to `electron` dependency version
- `appId: 'com.superiorag.pdfviewer'` (placeholder — verify with user before final ship; flag in handoff)
- `productName: 'PDF Viewer & Editor'`
- File association: register `.pdf` extension, ProgId `PdfViewerEditor.Document`

### 1.6 GitHub Actions CI

`.github/workflows/ci.yml`:

- Triggers: PR + push to main
- Matrix: Windows latest (primary), Ubuntu latest (smoke for tests only, no packaging)
- Steps: checkout → setup-node (LTS, cache npm) → `npm ci` → `npm run rebuild` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run e2e` (Windows only) → `npm run build`

Optional release workflow on tag push that runs `npm run dist` and uploads MSI + portable artifacts.

### 1.7 Native module rebuild

`better-sqlite3` is a native module. Add a `postinstall` script that runs `electron-builder install-app-deps`. In CI add an explicit `npm run rebuild` step before lint/test so the binary matches Electron's Node ABI.

### 1.8 Diego post-flight

Append one JSONL entry to `.learnings/learnings.jsonl` with `agent: dev-ops-agent`. Log specifically: (a) any dep version that didn't resolve cleanly with the others (peer conflicts), (b) whether `allowedDynamic` is actually a `jsx-a11y/aria-proptypes` option in the installed plugin version (this is what triggers the fallback), (c) whether `better-sqlite3` rebuild against Electron 30's Node ABI worked first-try or needed env vars.

---

## 2. Julian — Director of Code Quality & Security Audit

**Slug:** `code-reviewer`
**Owns (writes):** `docs/code-review.md` only.
**Reads:** everything under `src/`, `migrations/`, `docs/`, `ARCHITECTURE.md`.

### 2.1 Audit scope (Wave 2 deliverables, not infrastructure)

Julian runs in parallel with Diego. Do not wait for Diego's `package.json` — review code as it stands. Note in the review output that certain dynamic behaviors (pdf.js memory hygiene, e2e Playwright signal, real export-engine selector behavior, real default-handler registry writes) only become testable once Diego's deps land, and explicitly call those out as "provisional pending Diego's wave deliverables" rather than skipping.

### 2.2 Required audit areas

**a) Electron security checklist (ARCHITECTURE §2):**

- `webPreferences` in `src/main/window-manager.ts`: confirm `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, no `enableRemoteModule`, preload path correct.
- **Locked:** `enableDragDropFiles` is not toggled to `false` (Marcus's Wave 2 lock — see `.learnings/locked-instructions.md`).
- CSP in `src/main/security/csp.ts`: matches ARCHITECTURE §2.2 string; verify installation BEFORE first navigation (per index.ts ordering).
- Preload (`src/preload/index.ts`): exposes only typed `pdfApi`; no `ipcRenderer`/`process`/`require` leak; uses `contextBridge.exposeInMainWorld`.
- Renderer attack surface: search `src/client/` for `dangerouslySetInnerHTML`, `eval`, `new Function`, string-form `setTimeout`/`setInterval`. Flag every hit.

**b) IPC path-traversal guards (`src/main/security/path-sanitizer.ts`):**

- Rejects `..` segments, control chars, non-`.pdf` extensions, relative paths (unless explicitly allowed for the channel).
- Used by every path-bearing handler (`dialog:openPdf`, `dialog:saveAs`, `fs:readPdf`, `fs:writePdf`, `fs:closePdf`, `app:openExternal`).
- Confirm the save-as opaque destination token is actually opaque (60s TTL; renderer never sees absolute path) — `src/ipc/handlers/dialog-save-as.ts` + `src/main/pdf-ops/document-store.ts`.

**c) SQL injection in repos (`src/db/repositories/*`):**

- Every query MUST use `better-sqlite3` prepared statements with positional or named params — never string concatenation. Skim for any `db.exec(` or `db.prepare(...).run(${...})` template-literal injection.
- Confirm `foreign_keys = ON` and WAL mode in `src/db/connection.ts` per data-models §5.
- Migration runner (`src/db/migrate.ts`): version-watermark logic correct; one transaction per migration; failed migration rolls back atomically (no half-applied state).

**d) The db-bridge adapter as a single audit surface (`src/main/db-bridge.ts`):**

- Confirm it is the only place camelCase↔snake_case translation happens. Grep `src/ipc/handlers/` for any `.map(r => ({ camelField: r.snake_field }))` patterns — those would be a duplicate-translation regression and need to flow through the bridge instead.
- Confirm the in-memory fallback (`createMemoryDbBridge()`) is wired only for tests and pre-bridge boot, not as a production code path.
- Confirm `setDbBridge` is called once at app startup with Ravi's real repos wrapped via `adaptRecentsRepo`/`adaptBookmarksRepo` (or directly for settings).

**e) Redux action surface (`src/client/state/`):**

- Confirm every document mutation flows through `applyEdit(EditOperation)` per ARCHITECTURE §5.3 + Riley's locked decision encoding. No direct slice reducer writes that bypass the inverse computation in `document-inverses.ts`.
- Confirm history middleware (`state/middleware/history-middleware.ts`) wraps every undoable action; `meta.undoable: true` is the single gate.
- Confirm selectors are memoized (`createSelector` from RTK) for anything iterating over `pages[]` or `annotations[]`.

**f) pdf-lib usage patterns (`src/client/services/pdf-edit.ts`, `src/main/pdf-ops/*`):**

- Document mutability: pdf-lib's `PDFDocument` instances are mutable and not safe to share across Redux state. Confirm they live in a service-level WeakMap or main-process document-store, never in Redux state.
- Save path: each `fs:writePdf` call constructs a fresh PDFDocument or mutates the in-memory cached one — confirm no stale-handle reuse after save.

**g) pdf.js render contexts (`src/client/services/pdf-render.ts`, `src/client/components/pdf-canvas/`):**

- pdf.js page render returns a `RenderTask` that holds GPU/canvas resources. Confirm cleanup on unmount (`cancel()` + setting refs to null per ARCHITECTURE §4.4).
- Worker lifecycle: confirm a single worker for the renderer (not one per page or per document).
- **Note Julian: this audit area is provisional until Diego adds `pdfjs-dist`; flag your findings as "to verify post-Diego" if the stub is still in place when you read.**

**h) Coordinate system funnel (`src/client/services/pdf-coords.ts`):**

- Confirm this module is the single source for y-flip / scaling / quad-point conversion per ARCHITECTURE §7.3. Grep `src/client/` for any inline `1 - y` or `pageHeight - y` patterns outside this module — those would be a regression.

**i) Tests — coverage and quality (not just count):**

- 84 handler tests + 50 renderer tests + 32 repo tests = ~166 cases. Skim for: assertion-free tests, tautological assertions, missing error-path coverage on Result types. Note any handler that doesn't have a "valid input → ok variant" AND "invalid input → err variant" pair.

**j) `any` usage:**

- Riley's status row claims 7 `any` casts with justification comments. Verify each is actually justified (not a TypeScript laziness escape hatch). David's count is unstated — Julian grep `src/main/` + `src/ipc/` + `src/preload/` for `: any\b` and `as any\b` and assess.

### 2.3 `docs/code-review.md` output structure

Suggested template (Julian picks; the structure is not normative):

```
# Code Review — Wave 2 (2026-05-21)

## Verdict
[GREEN / YELLOW / RED] — one-sentence justification.

## Critical findings
(must-fix before Phase-1 ship; if YELLOW/RED, these block)

## Major findings
(should-fix in Wave 3 follow-up; not ship-blocking but technical-debt-incurring if deferred)

## Minor findings
(style, naming, micro-optimizations)

## Provisional findings (pending Diego)
- pdf.js worker setup — to verify once pdfjs-dist lands
- electron-builder installer registry writes for file-association — to verify against the Decision-4 NSIS flow
- (others)

## Test-quality notes
(per audit area 2.2.i above)

## Per-area scorecard
[table mapping each of §2.2 a-j to a finding count]
```

### 2.4 Julian post-flight

Append one JSONL entry to `.learnings/learnings.jsonl` with `agent: code-reviewer`. The detail field should capture (a) the verdict color, (b) the single most surprising finding (the one a future agent should know about even if they don't read the full code-review.md), and (c) any recurring pattern across multiple findings that suggests a Hard-Won Playbook entry is warranted.

---

## 3. Coordination notes

- Diego and Julian work in parallel — different files, no merge conflicts. Julian writes only `docs/code-review.md`; Diego touches no doc except possibly `README.md` (if it doesn't exist — but it does, owned by Nathan in Wave 4, so Diego should not touch).
- If Diego's package.json changes a dep version vs ARCHITECTURE §3's library inventory, Diego must (a) document the bump and reason in `docs/build-report.md` Wave 3 status row, and (b) flag it to Marcus for an ARCHITECTURE amendment in Wave 4 prep.
- Both agents follow the parallel-write JSONL discipline from Marcus's Hard-Won Playbook: write your post-flight entry as a JSON object and consider returning it to Marcus for serial append rather than writing concurrently. If you do write concurrently, ensure your `detail` field has no unescaped backslashes (`\b`, `\s`, etc. — round-trip through `JSON.stringify`).

---

## 4. Out of scope for Wave 3

- Phase-2 backlog items (`pinRecent`, `reorderBookmarks`, `parent_id` bookmark nesting, real `app:setDefaultPdfHandler` registry implementation, `pdf:export` two-engine implementation, `fs:writePdf` ops-payload replay engine, `app:pickPdfPath` combine-modal channel) — defer.
- README.md, docs/api-reference.md, docs/developer-guide.md — Wave 4 (Nathan).
- Any code changes outside the ownership boundaries in §1 and §2 above.
- Running `npm install` or any build commands — Wave 3 is the wave that makes that possible; Marcus does not run it during the integration check.
