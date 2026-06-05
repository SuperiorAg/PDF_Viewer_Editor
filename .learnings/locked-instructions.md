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

---

## L-004 (2026-06-05, Dmitri) — pdf.js `getDocument({data})` MUST receive a copied buffer the call site owns

**Constraint:** Every call to `pdfjs.getDocument({ data: <bytes> })` (legacy or modern build, main or renderer) MUST pass a _copied_ `Uint8Array` whose underlying `ArrayBuffer` is owned by the call site — never the raw `Buffer` returned by `fs.readFile`, never an IPC payload, never a cached `Uint8Array` shared with any other consumer. pdf.js v4's fake-worker path transfers the underlying ArrayBuffer via `postMessage(..., transferList)`, which **detaches** it mid-pass. Any sibling view (a document-store cache, an OCR composer's `originalBytes`, a PAdES re-check) immediately becomes length 0, with no warning. The downstream consumer fails with `No PDF header found` or — worse, the v0.7.15 signature — a silent zero-length `tesseract.recognize()` read.

**The rule (one line):**

> If you can read the bytes again from anywhere after `getDocument` resolves, you did it wrong. The bytes pdf.js receives must be a freshly-owned copy: `new Uint8Array(input).slice()` (the `.slice()` guarantees an owned ArrayBuffer, not a view into a shared one).

**Why locked:** v0.7.15 (2026-06-04) RCA. The OCR rasterize path in `src/main/pdf-ops/ocr-bootstrap.ts` (`rasterizePageProd`) passed the raw `Buffer` returned by `fs.readFile` directly to `getDocument({ data })`. pdf.js detached it; the subsequent `tesseract.recognize()` call received a detached / zero-length view and silently returned empty OCR output. The export bootstrap at `src/main/export/pdfjs-source.ts` already copied — that is the pattern. Canonical record: `.learnings/learnings.jsonl` line 128 (2026-06-04). Cross-project lesson note: `D:\Vault\Agents\Learnings\2026-06-04-pdfjs-buffer-detach-on-getDocument.md`.

**Reference implementation:** A single helper buries the copy:

```ts
// owned by the call site; pdf.js can transfer it freely
function toPdfJsBuffer(input: Buffer | Uint8Array | ArrayBuffer): Uint8Array {
  return new Uint8Array(input).slice();
}
```

Every `getDocument({ data })` call site must thread its bytes through `toPdfJsBuffer` (or an equivalent locally-named helper that performs the same `.slice()`).

**Enforcement:** Diego adds a CI grep ratchet that fails the build if `getDocument({` appears with a `data:` field whose value is not the output of an explicit copy helper. Regression test: `src/main/pdf-ops/ocr-bootstrap.prod-render.test.ts` exercises the rasterize → tesseract round-trip and asserts non-empty OCR output (the v0.7.15 failure signature was zero-length OCR; the test reproduces it under the pre-fix code path and passes under the helper).

**Affected files:**

- `src/main/pdf-ops/ocr-bootstrap.ts` — `rasterizePageProd` call site (David — fix landed v0.7.15)
- `src/main/export/pdfjs-source.ts` — already-copying reference implementation (David)
- Any future `getDocument({ data })` call site (David / Riley if a renderer-side path ever lands)
- `scripts/ratchet-getDocument-copy.mjs` (Diego — to be created; new grep ratchet)
- `src/main/pdf-ops/ocr-bootstrap.prod-render.test.ts` (Diego — regression test)

**To unlock:** A pdf.js release whose `getDocument({data})` documented contract is non-transferring (i.e. it copies internally and the caller's buffer survives), demonstrated by a green run of the prod-render regression test with the helper removed. The unlock entry must cite the pdf.js release notes and the green test run.

---

## L-005 (2026-06-05, Dmitri) — pdf.js polyfills MUST be installed BEFORE the dynamic import resolves

**Constraint:** Any code path that loads pdf.js via dynamic import (`await import('pdfjs-dist/legacy/build/pdf.mjs')` or the production-renderer equivalent) MUST install the canvas / DOM polyfills (`globalThis.Path2D`, `globalThis.ImageData`, `globalThis.DOMMatrix`, `globalThis.OffscreenCanvas`, etc.) BEFORE the `await import` resolves. The dynamic import is what triggers pdf.js's module-top-level checks; if `globalThis` is polyfill-free at that instant, pdf.js captures `undefined` references at module load and no after-the-fact `globalThis.Path2D = ...` assignment will heal it. Direct dynamic-import calls outside the sanctioned helper are a violation.

**The rule (one line):**

> Polyfills go on `globalThis` BEFORE the `await import` returns. The right WHAT at the wrong WHEN is still wrong.

**Why locked:** v0.7.14 (2026-06-04) RCA — "right WHAT, wrong WHEN." The polyfill install was present but ran AFTER the dynamic import had already resolved against a polyfill-free `globalThis`. Burned four sequential releases v0.7.10 → v0.7.13 (each one "fixed" something that wasn't the actual ordering bug) before v0.7.14 sequenced the install in front of the import. Canonical record: `.learnings/learnings.jsonl` line 127 (2026-06-04). Cross-project lesson note: `D:\Vault\Agents\Learnings\2026-06-04-pdfjs-globalthis-capture-at-module-load.md`.

**Reference implementation:** Wrap both steps inside a single helper that buries the ordering. No other call site does the import directly:

```ts
// the ONLY sanctioned pdf.js loader — ordering lives here, nowhere else
export async function loadPdfJs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  installPdfJsPolyfills(); // synchronous; mutates globalThis
  return await import('pdfjs-dist/legacy/build/pdf.mjs');
}
```

Any direct `await import('pdfjs-dist/…')` outside `loadPdfJs`'s file is a violation, regardless of whether polyfills "look" installed at that call site.

**Enforcement:** Diego adds a CI grep ratchet on `await import('pdfjs-dist` (regex covering legacy + modern paths) that allowlists only the `loadPdfJs` helper file. Regression test: a unit test that monkey-patches `globalThis.Path2D = undefined` (and the other tracked globals), calls `loadPdfJs()`, and asserts the polyfill is present BEFORE the returned module's first use. The test must fail if the ordering inverts inside the helper.

**Affected files:**

- The `loadPdfJs` helper file (David — exact path to be confirmed when the helper lands; lives alongside `src/main/pdf-ops/`)
- Every existing pdf.js dynamic-import call site must migrate to `loadPdfJs` (David)
- `scripts/ratchet-pdfjs-dynamic-import.mjs` (Diego — to be created; new grep ratchet)
- `src/main/pdf-ops/pdfjs-loader.test.ts` (Diego — to be created; polyfill-ordering regression test)

**To unlock:** A pdf.js release whose module-top-level no longer captures globals at load time (i.e. it lazily reads `globalThis.Path2D` only when a render is invoked), demonstrated by a green run of the polyfill-ordering regression test with the helper's polyfill-install step removed. The unlock entry must cite the pdf.js release notes and the green test run.
