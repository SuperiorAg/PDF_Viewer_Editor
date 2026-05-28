# Locked Instructions — PDF_Viewer_Editor

Hard constraints. Equivalent to direct user instructions. **Never weaken.**
Each entry includes the date locked, the agent that locked it, the rationale, and the file(s) it applies to.

---

## L-001 (2026-05-21, Marcus) — `enableDragDropFiles` must remain `true` on the main `BrowserWindow`

**Constraint:** In `src/main/window-manager.ts`, the `webPreferences` object passed to `new BrowserWindow(...)` MUST NOT set `enableDragDropFiles: false`. The Electron default (`true`) is load-bearing for Riley's window-level drag-and-drop file path access in `src/client/app.tsx`, which relies on Electron's non-standard `File.path` property.

**Why locked:** Riley's drag-drop flow in `app.tsx` casts the dropped `File` to read `.path` (a non-standard Electron-only property). If `enableDragDropFiles` is set to `false`, Electron suppresses drag-drop entirely and the cast silently returns `undefined`, breaking open-by-drag without any visible error. Doc-only mention is insufficient — agents will skim past it.

**Enforcement:** Diego adds a Vitest unit test in Wave 3 (`src/main/window-manager.test.ts`) that constructs the `BrowserWindow` options via David's exported factory and asserts `webPreferences.enableDragDropFiles !== false`. The test runs in CI on every PR.

**Affected files:**
- `src/main/window-manager.ts` (David / Diego)
- `src/main/window-manager.test.ts` (Diego — to be created in Wave 3)
- `src/client/app.tsx` (Riley — drag-drop handler reads `File.path`)

**To unlock:** A user-approved decision to rewrite the drag-drop flow to use a different mechanism (e.g. native menu "Open" or an explicit `app:pickPdfPath` channel). The unlock entry must reference the user message that authorized it.

---

## L-002 (2026-05-26, Diego; revised 2026-05-26 same day after Wave-17 false-alarm RCA) — Packaging waves MUST capture an operator-level screenshot of the running binary before marking GREEN

**Constraint:** Diego (and any future packaging agent) MUST capture and embed in `docs/build-report.md` an **operator-level screenshot** of the packaged Windows binary's **actual rendered UI** before marking a packaging wave COMPLETE / GREEN. "Operator-level screenshot" means a PNG (or equivalent image) showing the running window's title bar PLUS recognisable renderer DOM (toolbar buttons, empty-state text, menu strip, sidebar tabs) — i.e. what a real user would see if they double-clicked the .exe. **Process-metadata checks alone are NOT sufficient.** Verification MUST be a picture of the running UI, not just Win32 handle / process-count assertions.

**The core rule (read this twice):**

> **Automated process-metadata checks are insufficient for verifying GUI app launch.** A non-zero `MainWindowHandle`, an `IsWindowVisible == true`, and a 4-process Electron family tree can ALL be present while the renderer is in a broken state (white screen, JS error in the React tree, preload mismatch, CSP failure, IPC contract drift). They prove a window exists; they do NOT prove the user sees a usable application. The only verification that catches the renderer-broken class of defect is an actual screenshot of pixels-on-screen.

**Required verification evidence (BOTH must be present in the wave's build-report entry):**

1. **Operator-level screenshot.** A PNG capturing the running window with title bar + at least three distinct UI elements (e.g. menu items, toolbar buttons, empty-state text, sidebar tabs). Stored under `release/wave<N>-v<version>-launch-shot*.png`. The build-report entry MUST cite the absolute path and describe what is visible on it. Captured via:
   - `mcp__desktop-operator__screenshot` if the operator MCP is available in the agent's tool surface, OR
   - PowerShell `System.Drawing.Bitmap` + `Graphics.CopyFromScreen` after `AttachThreadInput` + `SetForegroundWindow` to bring the target window to the foreground (Wave 17 reference: `release/wave17-v040-launch-shot-full.png` 57 KB shows the full v0.4.0 chrome + menu + toolbar + "Open a PDF to get started" empty state — that is the gold-standard exemplar), OR
   - Playwright `_electron.launch({ args: ['.'] })` + `page.screenshot({ fullPage: true })` if the renderer is exercisable via DevTools protocol.
2. **Supplementary process-metadata sanity check** (still useful as a fast pre-screenshot gate, but no longer sufficient on its own): `$p.MainWindowHandle != 0`, `IsWindowVisible($p.MainWindowHandle) == true`, window geometry has non-zero width/height, process-count >= 4 (main + GPU + utility + renderer — single-process count is the hallmark signature of an `ELECTRON_RUN_AS_NODE=1` environment misfire). Note this is the **floor**, not the ceiling.

**Pre-launch environment hygiene (do this FIRST every time):**

Before launching, explicitly clear `ELECTRON_RUN_AS_NODE` from the current process environment:

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

When `ELECTRON_RUN_AS_NODE=1` is set in the parent environment, the Electron binary behaves as a plain Node interpreter — it loads `dist/main/index.js` as a Node script, never spawns helper processes, never creates a window, but **the process stays alive indefinitely** because `app.whenReady()` returns a Promise that never resolves under Node. The result looks identical to a stalled bootstrap: 44MB / 224 handles / single process / no window / no stderr.

**Why this lock was revised (Wave 17, 2026-05-26):** The original L-002 was written in response to a false alarm. Diego launched the v0.3.0 packaged binary and observed (via `Get-Process` polling) that the process exited within 500ms with handle counts decaying — and concluded the bootstrap was stalled / broken. The user took an actual screenshot of the same binary from the OS-native UI and showed it launches with a fully-rendered window: menu bar, toolbar, sidebar with Pages/Bookmarks/Forms tabs, "No pages" empty state. The v0.3.0 binary was **not** broken; Diego's PowerShell-only diagnostic methodology was. Process-metadata polling from an automated shell mis-attributed normal process churn (children spawn-and-fork during Electron bootstrap; the parent PID Diego was watching is not the long-lived window owner) as "crash in <1s". Half a day of root-cause hunting on a non-existent bug. The actual remaining bugs that day were renderer-side (File menu z-index, File→Open handler not wired) — both visible only via screenshot, both invisible to any process-metadata check. **That is the canonical failure mode this lock now prevents.**

A secondary motivation persists: Phase 3 v0.3.0 packaging ALSO shipped a real defect (preload-path extension mismatch — `dist/preload/index.js` referenced but `dist/preload/index.cjs` emitted) that broke `window.pdfApi` entirely. Every IPC-driven feature was a silent no-op. A screenshot would have shown the window opens but every toolbar action fails — process-metadata alone would have shown clean handles and called it green. Two independent failure modes (one false alarm, one missed real defect) point to the same fix: capture pixels, not handles.

**Affected files:**
- `electron-builder.yml`, `electron.vite.config.ts`, `package.json` scripts (Diego)
- `.github/workflows/ci.yml` — long-term: add a CI smoke job that launches the packaged binary in a headed Windows runner with a real display and captures the screenshot artifact for upload (Phase 7 ergonomics; tracked as a follow-up).
- Every packaging-wave entry in `docs/build-report.md` — the "build evidence" section MUST cite the visual-verification artifact path AND describe what the screenshot shows (title bar present, menu strip present, toolbar present, empty-state UI present, etc.).

**To unlock:** Replace with an equally strong automated check — e.g. a CI job that captures a screenshot of the packaged binary's window AND runs a vision-based assertion (pixel-diff against a baseline, or LLM-as-judge over the screenshot) that the renderer is in the expected state. The unlock entry must point to the green CI run that demonstrates the replacement is equivalent. A handle-count assertion alone is NOT a valid replacement and never will be — it is the same class of check this lock was created to supplement.

---

## L-003 (2026-05-28, Diego; ratified by Marcus) — Node 20 is the enforced local + CI baseline; never from-source-rebuild `better-sqlite3` on Node 24

**Constraint:** The project's supported runtime is Node 20 (`engines.node: ">=20.10.0 <21"`). Local test runs and CI MUST use Node 20. The `pretest` guard `scripts/check-node.mjs` gates the suite and MUST NOT be removed or weakened. No agent may run a from-source rebuild of `better-sqlite3` on a Node 24 host — use `scripts/rebuild-native-for-node.mjs` (non-destructive cache-prebuild swap) as the only sanctioned escape hatch.

**Why locked:** The Node-24 vs better-sqlite3-ABI skew silently broke ~350 db-dependent tests across six waves (13, 21, 24, 28a, 30, and the Backlog-Fix wave). Worse, a prior from-source rebuild attempt **deleted the working Electron-ABI binding**, corrupting the packaging tree. better-sqlite3 11.10.0 publishes prebuilds only up to Node 22 (v131) + the Electron ABI (v123); Node 24 (v137) has neither, and node-gyp fails (Python 3.14 dropped distutils). Node 20 (v115) has both a published prebuild AND matches the CI matrix — it is the single version where the full suite runs green without intervention.

**Enforcement:** `scripts/check-node.mjs` wired into `pretest`; `engines.node` strictness + `.npmrc` `engine-strict`; CI `check` job rebuilds the Node ABI before tests (the latent CI bug Diego fixed in this wave). The documented green path: `nvm use 20 && npm ci && npm test` (Node 20), or `node scripts/rebuild-native-for-node.mjs && npm test` (Node 24 escape hatch).

**Affected files:**
- `package.json` (`engines.node`, `pretest`), `.npmrc`, `.nvmrc` (Diego)
- `scripts/check-node.mjs`, `scripts/rebuild-native-for-node.mjs` (Diego)
- `.github/workflows/ci.yml` (Diego — Node-ABI rebuild in the test job)

**To unlock:** A better-sqlite3 release with Node 24 prebuilds (or a migration to a pure-JS / WASM SQLite binding with no native ABI), demonstrated by a green full-suite run on Node 24 without the rebuild script. The unlock entry must cite that run.
