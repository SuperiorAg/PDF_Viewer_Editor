// electron-vite orchestrates main / preload / renderer with one CLI:
//   - `electron-vite dev`   — multi-process dev with hot reload (renderer) + restart (main)
//   - `electron-vite build` — typecheck delegated to tsc via npm run typecheck; this only bundles
//
// Diego owns. Renderer config folds in Riley's src/client/vite.config.ts patterns
// (base './', resolve aliases, jsdom for vitest). Riley's renderer-side
// vite.config.ts is left in place but is not the canonical build entry now;
// electron-vite picks up THIS file.

import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const r = (...p: string[]): string => resolve(__dirname, ...p);

// ---------------------------------------------------------------------------
// Wave 25 plugin REMOVED in Phase 6.1 v0.6.1 repack (Diego, 2026-05-27).
//
// The `emitExportBootstrapCjs()` closeBundle plugin used to esbuild
// export-bootstrap.ts into a standalone CJS sibling of dist/main/index.js,
// because David's `src/main/index.ts` lazy-loaded it via a runtime
// `require('./export/export-bootstrap.js')` that Vite tree-shook out of the
// ESM main bundle. In Phase 6.1, David converted that call site to a
// top-level static import (`import { bootstrapExportEngine,
// createProdSourceLoader } from './export/export-bootstrap.js'`), so Vite now
// bundles the bootstrap INLINE into dist/main/index.js. The standalone CJS
// emit + its sibling `dist/main/export/package.json` are dead weight (nothing
// requires them) and have been removed.
//
// Verification (run every repack): after `npm run build`, confirm
//   - dist/main/index.js contains the inlined bootstrap (refs to
//     `createProdPdfJsSource` / `bootstrapExportEngine`)
//   - dist/main/index.js has ZERO dangling
//     `require('./export/export-bootstrap.js')`
//   - dist/main/export/ is NOT emitted as a standalone CJS sibling
// scripts/wave-26-1-verify-no-dead-bootstrap.mjs automates this check.
//
// Historical reference: .learnings/failures/2026-05-27-runtime-require-vite-
// tree-shake-packaging-gap.md (the RCA) + Wave 25 / Phase 6.1 David build-
// report rows. The lesson "prefer static imports for all main-process module
// loading; runtime require is a packaging anti-pattern" is the standing rule.
// ---------------------------------------------------------------------------

// Phase 7.2 (Diego, 2026-06-10) — Item 7.2.3 prod NODE_ENV define-fold.
//
// In production builds, replace `process.env.NODE_ENV` at the AST level with
// the literal string `"production"`. Rollup's constant-folder then collapses
// `if (process.env.NODE_ENV !== 'test') return;` to `if (true) return;` and
// dead-code-eliminates the trailing `ipcMain.handle(...)` registration AND
// the channel-name string (`__test:whichBridge`, `__test:seedOcrJob`) from
// `dist/main/index.js`. Same fold applied to `dist/preload/index.js`.
//
// WHY MODE-CONDITIONAL: `electron-vite build` (no mode flag) defaults to
// `mode === 'production'` — that's the packaged-binary path. The e2e harness
// at `tests/e2e/ocr-integration.spec.ts:150` launches Electron with
// `env.NODE_ENV='test'`, but it runs against whatever `dist/main/index.js`
// was just built. If we fold unconditionally, the e2e bundle loses the test
// channels and Phase B/E aborts immediately. The e2e CI step therefore
// invokes the project via the `build:test` script (electron-vite build
// --mode test) so this define-block is bypassed and the runtime gate keeps
// gating. See `.github/workflows/ci.yml` "Build Electron bundle" step.
//
// BRACKET-vs-DOT NORMALIZATION: Vite/Rollup `define` matches the dot form
// (`process.env.NODE_ENV`) at the AST identifier-access level. It does NOT
// match the bracket form (`process.env['NODE_ENV']`) because that's a
// different AST shape (string-keyed property access on a computed member
// expression). The three live gate sites that need to fold under prod
// (`src/ipc/handlers/test-which-bridge.ts`, `src/ipc/handlers/test-seed-
// ocr-job.ts`, `src/preload/index.ts`) were therefore normalized from
// bracket -> dot at the same time as this define landed. `tsconfig.json`
// sets `noUncheckedIndexedAccess: true` so the dot form returns
// `string | undefined` (same as bracket) — no type-safety regression.
//
// Reference: Julian's Phase 7.2 re-review §8 in `docs/code-review.md`.
const prodNodeEnvDefine = (mode: string): Record<string, string> =>
  mode === 'production' ? { 'process.env.NODE_ENV': '"production"' } : {};

export default defineConfig(({ mode }) => ({
  // ---- main process ------------------------------------------------------
  main: {
    define: prodNodeEnvDefine(mode),
    plugins: [
      externalizeDepsPlugin(),
      // Phase 5 (Diego, 2026-05-27, Wave 21) — David's
      // src/main/pdf-ops/ocr-bootstrap.ts:loadCatalogSync uses
      // `require('./language-pack-catalog.json')` which Vite preserves as
      // a runtime require in the ESM main bundle but does NOT emit the
      // JSON file alongside the bundle. Without this copy step, the
      // packaged binary throws "Cannot find module './language-pack-
      // catalog.json'" at app.whenReady() and surfaces a startup error
      // dialog (then OCR is non-functional). Copy the JSON next to the
      // emitted index.js so the require resolves from dist/main/ in dev
      // AND from resources/app.asar/dist/main/ in the packaged app.
      viteStaticCopy({
        // vite-plugin-static-copy v4 preserves the source's directory tree
        // by default — including when the src is an absolute path, the
        // entire absolute path tree is mirrored under `dest`. The reliable
        // flatten is `rename: { stripBase: true }`, which the plugin docs
        // explicitly show flattens any matched file to just its basename.
        // Result: dist/main/language-pack-catalog.json (next to index.js).
        //
        // Without this, `require('./language-pack-catalog.json')` in
        // src/main/pdf-ops/ocr-bootstrap.ts:loadCatalogSync() fails at
        // runtime in the packaged binary with "Cannot find module
        // './language-pack-catalog.json'" — bootstrap shows a startup
        // error dialog and OCR is non-functional.
        targets: [
          {
            src: r('src/main/pdf-ops/language-pack-catalog.json').replace(/\\/g, '/'),
            dest: '.',
            rename: { stripBase: true },
            overwrite: true,
          },
        ],
      }),
    ],
    build: {
      outDir: 'dist/main',
      lib: {
        entry: r('src/main/index.ts'),
        formats: ['es'],
      },
      rollupOptions: {
        // Native modules must stay external (better-sqlite3, electron)
        external: ['electron', 'better-sqlite3'],
        output: {
          entryFileNames: '[name].js',
        },
      },
      sourcemap: true,
      minify: false,
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@main': r('src/main'),
        '@ipc': r('src/ipc'),
        '@shared': r('src/shared'),
      },
    },
  },

  // ---- preload -----------------------------------------------------------
  // Wave 17 (Diego, 2026-05-26): emit the preload as `index.js` rather than
  // `index.cjs`. The David-owned window factories at
  // `src/main/window-manager.ts:27` and `src/main/print-window.ts:64` build the
  // preload path with `join(here, '..', 'preload', 'index.js')`. Phase 3
  // shipped with the bundler emitting `index.cjs`, so Electron failed to load
  // the preload at runtime ("Unable to load preload script: ...index.js — not
  // found in app.asar"). The window still opened, but `window.pdfApi` was
  // undefined and every IPC-driven feature was a silent no-op. We fix this in
  // packaging (Diego's domain) by emitting `index.js` — Electron loads preload
  // scripts via its sandbox-bundle path (sandbox: true is set in the
  // BrowserWindow factory), which bypasses Node's `type: module` resolution
  // entirely, so the file extension does not need to be `.cjs` for CommonJS
  // semantics. Rollup still bundles in CJS format below (`formats: ['cjs']` +
  // `output.format` fallback), so the file contents are unchanged.
  preload: {
    // Phase 7.2 (Diego) — see prodNodeEnvDefine comment above the main config.
    define: prodNodeEnvDefine(mode),
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: r('src/preload/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        external: ['electron'],
        output: {
          entryFileNames: '[name].js',
          format: 'cjs',
        },
      },
      sourcemap: true,
      minify: false,
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@preload': r('src/preload'),
        '@ipc': r('src/ipc'),
        '@shared': r('src/shared'),
      },
    },
  },

  // ---- renderer ----------------------------------------------------------
  renderer: {
    root: r('src/client'),
    base: './',
    plugins: [
      react(),
      // Phase 4.1.1 (Riley) — copy pdf.js standard fonts + cmaps from
      // node_modules/pdfjs-dist into the renderer's `pdfjs/` dir at build
      // time. pdf.js loads these at runtime via `standardFontDataUrl` and
      // `cMapUrl` (see `src/client/services/pdf-render.ts:189-198`); without
      // them, text widths / glyph mapping go wrong even though pages render.
      //
      // Why a build-time copy instead of committing the 185 binary asset
      // files to the repo: every pdfjs-dist version bump shipped assets in
      // sync with the worker; coupling the copied tree to node_modules
      // guarantees the runtime assets always match the worker we're loading.
      // The pdfjs-dist 4.x layout (standard_fonts/, cmaps/) has been stable
      // across point releases; if it ever changes the build error will be
      // loud (rollup's plugin-static-copy fails when the src globs don't
      // match any files).
      viteStaticCopy({
        // fast-glob (the engine vite-plugin-static-copy uses) needs forward
        // slashes even on Windows; `path.resolve` returns backslashes here.
        // We pass absolute paths so glob resolution does not depend on the
        // (electron-vite-mutated) renderer cwd. `rename: { stripBase: true }`
        // flattens the matched files into the dest dir using just the
        // basename — without it, vite-plugin-static-copy preserves the full
        // source-path tree (`dest/node_modules/pdfjs-dist/standard_fonts/
        // Helvetica.pfb`), which pdf.js cannot find at runtime.
        targets: [
          {
            src: r('node_modules/pdfjs-dist/standard_fonts/*').replace(/\\/g, '/'),
            dest: 'pdfjs/standard_fonts',
            rename: { stripBase: true },
          },
          {
            src: r('node_modules/pdfjs-dist/cmaps/*').replace(/\\/g, '/'),
            dest: 'pdfjs/cmaps',
            rename: { stripBase: true },
          },
        ],
      }),
    ],
    build: {
      outDir: r('dist/renderer'),
      emptyOutDir: true,
      // Match Electron 30's Chromium.
      target: 'chrome120',
      sourcemap: false,
      rollupOptions: {
        input: r('src/client/index.html'),
      },
    },
    resolve: {
      alias: {
        '@client': r('src/client'),
        '@ipc': r('src/ipc'),
        '@shared': r('src/shared'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    // pdf.js worker setup — Vite serves the worker via ?url at runtime
    // (see src/client/services/pdf-render.ts for the documented pattern).
    optimizeDeps: {
      exclude: ['pdfjs-dist/build/pdf.worker.min.mjs'],
    },
  },
}));
