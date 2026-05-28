# 2026-05-27 — Runtime require() of in-tree module + vite tree-shaking + Electron 30 Node 20 ESM rejection = packaged binary crashes on launch

**Author:** Diego (dev-ops-agent), Wave 25 (Phase 6 Export to Office packaging)
**Severity:** HIGH — fatal at first launch of v0.6.0 packaged binary; no window ever appeared. Caught by L-002 visual-verification screenshot mandate. Fixed in Diego domain (electron.vite.config.ts plugin); David follow-up flagged for the proper source-level fix.

## Symptom

`release/win-unpacked/PDF Viewer & Editor.exe --enable-logging` from a clean v0.6.0 package, with all the standard pre-launch hygiene applied (`Remove-Item env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`):

- 3 processes spawn (NOT the L-002-mandated 4 — single-process count is the floor; **3 = main + GPU + utility but NO renderer = renderer never spawned**)
- No main window appears
- `Get-Process | Where-Object MainWindowHandle -ne 0` returns nothing
- `--enable-logging` flag shows the cause in stdout:

```
(node:41104) UnhandledPromiseRejectionWarning: Error: Cannot find module './export/export-bootstrap.js'
Require stack:
- D:\Projects\PDF_Viewer_Editor\release\win-unpacked\resources\app.asar\dist\main\index.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1152:15)
    ...
    at file:///D:/Projects/PDF_Viewer_Editor/release/win-unpacked/resources/app.asar/dist/main/index.js:10372:29
```

The unhandled rejection cascades to `app.whenReady()` never resolving → main window never created → renderer process never spawned.

## Root cause

David's Wave 24 added a runtime require pattern at `src/main/index.ts:273` claiming to "mirror ocr-bootstrap's lazy-load":

```ts
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const exportBootstrap = require('./export/export-bootstrap.js') as {
  bootstrapExportEngine: typeof import('./export/export-bootstrap.js').bootstrapExportEngine;
  createProdSourceLoader: typeof import('./export/export-bootstrap.js').createProdSourceLoader;
};
```

**But the OCR equivalent at line 60 is actually a top-level static import:**

```ts
import { bootstrapOcr } from './pdf-ops/ocr-bootstrap.js';
```

The require pattern is novel — it doesn't mirror anything that exists in the codebase. Combined with vite's bundling rules:

1. **Vite tree-shakes export-bootstrap.ts into dist/main/index.js** because the module IS reachable through `import` chains from `src/ipc/register.ts` (which itself is statically imported by `src/main/index.ts`). Vite sees all the static imports and inlines them into the main bundle. The runtime `require()` call survives in the emitted JS as `require2('./export/export-bootstrap.js')` (where `require2 = createRequire(import.meta.url)`), but the target file is NOT separately emitted next to index.js.

2. **The runtime require resolves relative to the ESM main bundle's `import.meta.url`** = `dist/main/index.js`. So the resolution path is `dist/main/export/export-bootstrap.js`. Vite did not emit this file. `Module._resolveFilename` throws ENOENT.

3. **Even if we emit the bootstrap as an ESM sibling, Electron 30 (Node 20) rejects synchronous require() of ESM with ERR_REQUIRE_ESM.** The flag to enable that interop (`--experimental-require-module`) is Node 22+. So the emit must be CJS-format.

4. **Even with a CJS-format emit, the project root `package.json` declares `"type": "module"`** which makes Node interpret every `.js` file in the tree as ESM unless overridden by a closer `package.json`. A CJS file in an ESM scope is read as ESM and the same ERR_REQUIRE_ESM fires. So the emit must include a sibling `package.json` declaring `{"type":"commonjs"}` to override the root scope for that subdirectory.

## How L-002 caught it

The L-002 lock (revised 2026-05-26 after the Wave 17 false-alarm RCA) requires every packaging-wave entry to capture an operator-level screenshot of the running window with title bar + at least three distinct UI elements. The lock's stated motivation was exactly this scenario:

> "Automated process-metadata checks are insufficient for verifying GUI app launch. A non-zero MainWindowHandle, an IsWindowVisible == true, and a 4-process Electron family tree can ALL be present while the renderer is in a broken state... The only verification that catches the renderer-broken class of defect is an actual screenshot of pixels-on-screen."

The Wave 25 first-package was a degenerate variant: NOT a "renderer broken" state, but a "renderer never spawned because main process crashed" state. Process count was **3** (not 4) — already a red flag the L-002 supplementary process-metadata check would have detected. But the screenshot attempt is what surfaced the error: the `wave21-launch-shot.ps1` script polled `Get-Process | Where-Object MainWindowHandle -ne 0` for 15 seconds, found nothing, and surfaced `No visible main window appeared within the timeout.` That triggered the `--enable-logging` deep-dive that revealed the ENOENT.

Without L-002, the packaging step would have completed with no errors visible (electron-builder reported success — it doesn't launch the binary, only assembles it). A `git push` and a `gh release create` later, end users would have downloaded a v0.6.0 .exe that does nothing visible when double-clicked.

## Fix applied (Diego domain — electron.vite.config.ts only, no src/** edits)

Added a closeBundle plugin `emitExportBootstrapCjs()` to the main-process vite config. The plugin runs after the main vite bundle is emitted and uses esbuild (already in the toolchain — vite uses it for transforms) to compile `src/main/export/export-bootstrap.ts` directly to CJS at `dist/main/export/export-bootstrap.js`, externalizing the same packages vite externalizes (electron, better-sqlite3) plus the Phase-6 runtime peer libraries that should stay dynamic-import (@napi-rs/canvas, utif, pdfjs-dist, pdf-lib, docx, exceljs, pptxgenjs). It also writes a sibling `dist/main/export/package.json` containing `{"type":"commonjs"}` to override the root ESM scope.

End-to-end verification:
- Repackaged v0.6.0 launches successfully — 4-process Electron family tree, MainWindowHandle non-zero, title bar "PDF_Viewer_Editor", full UI chrome rendered (toolbar, menus, empty state).
- L-002 screenshot saved at `release/wave-25-v060-launch-shot.png`.
- Packaged-binary xlsx export proven via app.asar extraction + `require()` of the extracted bootstrap + `engine.runJob()` → real 7097-byte .xlsx file with ZIP signature 504b0304, 2 sheets readable via exceljs.

## Permanent fix (David Wave 25.1)

The proper source-level fix is to change `src/main/index.ts:273` from a runtime `require()` to a top-level static import (matching the actual ocr-bootstrap precedent at line 60):

```ts
// At top of file:
import { bootstrapExportEngine, createProdSourceLoader } from './export/export-bootstrap.js';
// Then at line 273 use them directly without the require + assertion shape.
```

That removes the `emitExportBootstrapCjs()` plugin entirely. Until David lands the change, Diego's plugin is the safety net.

## Process lesson

This is the **second instance** of the "vite tree-shakes a David-owned runtime require, Diego's domain to emit it" pattern in this codebase. Phase 5 Wave 21 was the first — David's `src/main/pdf-ops/ocr-bootstrap.ts:loadCatalogSync` used `require('./language-pack-catalog.json')`; vite preserved the require call but didn't emit the JSON; Diego fixed it with `vite-plugin-static-copy` (see `electron.vite.config.ts` lines 22-66).

The fix mechanism differs (copy a JSON file vs compile + emit a CJS bundle + emit a sibling package.json) but the ROOT pattern is identical: **runtime require of an in-tree path that vite either doesn't preserve OR preserves with the wrong shape**.

**Promotion candidate for ratcheting:**

1. **If a third instance appears in Phase 7**, the lesson should land in `~/.claude/agents/backend-engineer.md` Hard-Won Playbook: "Prefer static top-level imports for all main-process module loading. Runtime `require()` of in-tree paths is a packaging anti-pattern under Vite/Rollup — the bundler decides whether to preserve, inline, tree-shake, or omit your target, and the right choice depends on whether the target is JSON / source / asset / native binary. Static imports give Vite a stable contract: 'this is part of the module graph; emit it OR inline it, but never silently delete the path.'"

2. **CI ratchet candidate** for `.learnings/locked-instructions.md` as `L-003`: a pre-commit (or CI) check that greps `src/main/**/*.ts` for `\brequire\s*\(\s*['"]\./` patterns and fails the build, forcing every author through a code review for the runtime-require pattern.

3. **Anti-pattern for any agent writing Electron main-process code**: when you need lazy-loading (delay module evaluation until first use), use `await import('./path.js')` (dynamic import) at the call site instead of synchronous `require()`. Dynamic import is supported in Electron 30's Node 20 against both CJS AND ESM targets, and Vite preserves dynamic imports as separate chunks emitted next to the bundle (the chunking warning printed at every build references this exact behavior).

For now, the lesson is logged twice — once to `.learnings/learnings.jsonl` (project) and once to `~/.claude/learnings/global.jsonl` (cross-project for any future Electron project). The third-instance ratchet trigger is documented but deferred until empirically warranted.

## References

- L-002 lock: `.learnings/locked-instructions.md` (the screenshot requirement that caught this)
- Phase 5 first-instance fix: `electron.vite.config.ts` lines 22-66 (viteStaticCopy for language-pack-catalog.json)
- Phase 6 second-instance fix: `electron.vite.config.ts` `emitExportBootstrapCjs` function (this wave)
- David's runtime require: `src/main/index.ts:270-288`
- David's claimed precedent (actually a static import): `src/main/index.ts:60` + `src/main/pdf-ops/ocr-bootstrap.ts`
- L-002 screenshot evidence: `release/wave-25-v060-launch-shot.png`
- End-to-end xlsx evidence: `release/wave-25-v060-xlsx-output.xlsx` + `scripts/wave25-xlsx-bytes-evidence.mjs`
