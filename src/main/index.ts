// ============================================================================
// Electron main-process entry point — PDF_Viewer_Editor
// ============================================================================
//
// LIFECYCLE
// ---------
// 1. Acquire single-instance lock (`app.requestSingleInstanceLock`). If we
//    don't get it, a previous instance is running — fire `app.quit()` so the
//    second invocation hands off without leaving an orphan process behind.
// 2. Wait for `app.whenReady()` — Electron's "main process is up, sessions
//    available, you may now create windows" event. We must NOT touch `session`
//    or BrowserWindow before this fires.
// 3. Install the CSP header rule on `session.defaultSession` (ARCHITECTURE §2.2).
//    Done BEFORE creating any window so the first navigation already gets it.
// 4. Register all IPC handlers (`registerIpcHandlers`) — this is what gives
//    the preload bridge something to call. Must run before the renderer loads.
// 5. Create the main BrowserWindow with the non-negotiable security
//    configuration (contextIsolation, nodeIntegration:false, sandbox:true).
//    See ARCHITECTURE §2.1.
// 6. Wire app-level events: 'window-all-closed' (quit on non-macOS),
//    'second-instance' (focus existing window), 'activate' (re-create window
//    on macOS dock click).
//
// IMPLEMENTATION NOTES (current, post-Phase-7)
// --------------------------------------------
// - The DB bridge wires Ravi's real SQLite repos at Step 3.5 below
//    (`setDbBridge({ recents, bookmarks, settings, formTemplates, signatureAudit,
//    ocrJobs, ocrResults, languagePacks, exportJobs })`). Phase-N repos that
//    haven't yet landed in a given wave fall back to the memory-backed
//    bridge — see `db-bridge.ts` for the per-slot DI shape.
// - Renderer entry resolution honors `VITE_DEV_SERVER_URL` for dev; packaged
//    builds load `../renderer/index.html` relative to the compiled main output
//    (Diego's electron-vite layout).
// - File-association registration: handled by NSIS at install-time, with a
//    runtime toggle via `app:setDefaultPdfHandler` (see `register.ts`).
// - Auto-updater: wired in Phase 7 below (`createAutoUpdateController`). The
//    publish target reads from the bundled `app-update.yml`; absence routes
//    every check to the honest `update_not_configured`.
//
// PLAYBOOK NOTES
// --------------
// - Entry-point detection (Playbook #1): not applicable — Electron's binary
//    chooses the main entry from package.json `main`, never via
//    `import.meta.url === \`file://...\``.
// - Env file loading (Playbook #4): `.env` is dev-only here. Diego's
//    package.json scripts handle `--env-file-if-exists` for `tsx`.

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, Menu } from 'electron';

import { initDatabase } from '../db/connection.js';
import { createBookmarksRepo } from '../db/repositories/bookmarks-repo.js';
// Phase 7.2 (David, 2026-06-10) — STATIC import lift (Item A-1) of the six
// Phase-3..6 repo factories. Replaces six dynamic `require('../db/repositories/
// *-repo.js')` blocks in `bootstrap()` below (formerly lines 254–336 of this
// file). The dynamic-require pattern was the v0.7.18 reopen-restore catch
// surface gap (Julian finding 7.1.5) — Vite/Rollup silently tree-shook the
// modules out of `dist/main/` under `_electron.launch()`, so the six repo
// slots fell back to the memory bridge and the seeded OCR job did not survive
// close+relaunch. The lift unconditionally wires the SQLite factories into the
// main-process import graph; memory fallback is preserved for the legitimate
// constructor-throw case (e.g. SQLite open fails because the prepared statement
// won't compile against a schema-version skew) via an inline try/catch around
// the FACTORY CALL — the imports themselves cannot fail at runtime, only the
// invocations can. See `docs/phase-7.2-test-design.md §2.2-§2.4` and the
// 2026-05-27 Nathan global learning ("THIRD instance ratchet — A-1 preempts").
import { createExportJobsRepo } from '../db/repositories/export-jobs-repo.js';
import { createFormTemplatesRepo } from '../db/repositories/form-templates-repo.js';
import { createLanguagePacksRepo } from '../db/repositories/language-packs-repo.js';
import { createOcrJobsRepo } from '../db/repositories/ocr-jobs-repo.js';
import { createOcrResultsRepo } from '../db/repositories/ocr-results-repo.js';
import { createRecentFilesRepo } from '../db/repositories/recent-files-repo.js';
import { createSettingsRepo } from '../db/repositories/settings-repo.js';
import { createSignatureAuditRepo } from '../db/repositories/signature-audit-repo.js';
// Phase 7.5 Wave 3 (David, 2026-06-17): stamps_library production repo.
import { createStampsLibraryRepo } from '../db/repositories/stamps-library-repo.js';
import { Channels } from '../ipc/contracts.js';
import { registerIpcHandlers } from '../ipc/register.js';

// Phase 4.1 (Wave 17.1 cleanup, David): permanent pdf-lib-backed metadata
// loader. Replaces the Phase-1 stub at src/ipc/register.ts:119-136 that
// returned pageCount:-1 and broke open-and-render end-to-end for 4 waves.
// Phase 5 (Wave 20, David) — OCR runtime bootstrap.
// Phase 6.1 (David) — static import of the export bootstrap. Replaces the
// Wave-24 runtime `require('./export/export-bootstrap.js')` that vite
// tree-shook into the main bundle without emitting the sibling file (RCA:
// .learnings/failures/2026-05-27-runtime-require-vite-tree-shake-packaging-gap.md).
// Mirrors the ocr-bootstrap static-import precedent directly above. This makes
// Diego's `emitExportBootstrapCjs()` vite safety-net plugin unnecessary.
// Phase 7 (Wave 28a, David) — auto-update controller + telemetry service.
// STATIC imports (NOT runtime require) so Vite keeps these in the main bundle.
// The heavy `electron-updater` dep is loaded via runtime require INSIDE
// `loadElectronUpdaterModule` (Diego installs it Wave 29) — so the bundle
// builds before the dep lands. Mirrors the ocr/export bootstrap precedent.
import { parseShellPdfPath } from './argv-parser.js';
import {
  createAutoUpdateController,
  isPublishConfiguredFromAppUpdateYml,
  loadElectronUpdaterModule,
} from './auto-update.js';
import {
  adaptBookmarksRepo,
  adaptExportJobsRepo,
  adaptFormTemplatesRepo,
  adaptLanguagePacksRepo,
  adaptOcrJobsRepo,
  adaptOcrResultsRepo,
  adaptRecentsRepo,
  adaptSettingsRepo,
  adaptSignatureAuditRepo,
  // Phase 7.5 Wave 3 (David, 2026-06-17): stamps library adapter.
  adaptStampsLibraryRepo,
  createMemoryDbBridge,
  getDbBridge,
  setDbBridge,
  type DbBridgeKinds,
} from './db-bridge.js';
import { bootstrapExportEngine, createProdSourceLoader } from './export/export-bootstrap.js';
import { bootstrapOcr } from './pdf-ops/ocr-bootstrap.js';
import { loadPdfMetadata } from './pdf-ops/pdf-metadata-loader.js';
import { bootstrapScan } from './pdf-ops/scan-bootstrap.js';
import { installCsp } from './security/csp.js';
import { createTelemetryService, NoOpRingBufferTransport } from './telemetry.js';
import { createMainWindow, getMainWindow } from './window-manager.js';

const here = dirname(fileURLToPath(import.meta.url));

function resolveRendererTarget(): { url?: string; file?: string } {
  const devUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devUrl && devUrl.length > 0) return { url: devUrl };
  // Diego's Vite build emits to `dist/renderer/index.html`. From `dist/main/index.js`
  // the relative path is `../renderer/index.html`. We resolve it here so
  // bundling layout changes are confined to one place.
  return { file: join(here, '..', 'renderer', 'index.html') };
}

function bootstrap(): void {
  // ============================================================================
  // Shell-launched PDF handoff (David 2026-06-04, v0.7.12 -> v0.7.13 bugfix)
  // ----------------------------------------------------------------------------
  // Three entry points feed Channels.FileOpenFromShell to the renderer:
  //   1. Cold-start (this process): process.argv carries the path; we parse
  //      it here, stash in `pendingShellPdf`, and dispatch on did-finish-load.
  //   2. Warm-start (second-instance event): Electron forwards the second
  //      invocation's argv to the existing primary; we parse and dispatch
  //      immediately to the already-loaded renderer.
  //   3. macOS open-file: fires BEFORE app.whenReady() can complete on a
  //      cold launch (Finder pre-resolves the file). We stash if no window
  //      yet, dispatch immediately if window is loaded.
  //
  // pendingShellPdf is the cross-source rendezvous slot: cold-start writes it
  // here at bootstrap, did-finish-load reads + clears it, open-file writes it
  // pre-window-ready, second-instance writes it directly to a live window.
  // ============================================================================
  let pendingShellPdf: string | null = null;
  let pendingShellSource: 'argv' | 'open-file' | 'open-url' = 'argv';

  // Step 1 — single-instance lock
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', (_event, argv) => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    // v0.7.12 BUG: the argv parameter was previously discarded. Without
    // parsing it here, the user's "Open with PDF_Viewer_Editor" on a second
    // double-click only focused the existing window and silently dropped the
    // requested file.
    const shellPath = parseShellPdfPath(argv, { isPackaged: app.isPackaged });
    if (shellPath !== null && win && !win.isDestroyed()) {
      try {
        win.webContents.send(Channels.FileOpenFromShell, {
          absolutePath: shellPath,
          source: 'second-instance',
        });
      } catch (e) {
        console.error('[main] second-instance: failed to dispatch shell open', e);
      }
    }
  });

  // macOS-only `open-file` event. On Finder double-click / drag-onto-dock,
  // the path arrives via this event, NOT via process.argv. e.preventDefault()
  // is required per Electron docs — without it the default behaviour skips
  // our handling. If the window isn't ready yet, stash for did-finish-load
  // (cold-start path); if it is, dispatch immediately.
  app.on('open-file', (event, path) => {
    event.preventDefault();
    // Reuse the parser to enforce the same sanitization rules as argv. The
    // parser expects an argv-shaped array; synthesize the minimal shape:
    //   [exePath, path]   so startIndex=1 picks up `path` at index 1.
    const shellPath = parseShellPdfPath(['', path], { isPackaged: app.isPackaged });
    if (shellPath === null) return;
    const win = getMainWindow();
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      try {
        win.webContents.send(Channels.FileOpenFromShell, {
          absolutePath: shellPath,
          source: 'open-file',
        });
        return;
      } catch (e) {
        console.error('[main] open-file: failed to dispatch shell open', e);
      }
    }
    // Window not ready yet — stash for did-finish-load.
    pendingShellPdf = shellPath;
    pendingShellSource = 'open-file';
  });

  // Cold-start argv parse. Runs ONCE, synchronously, before whenReady() so
  // the value is available the moment did-finish-load fires below. Stashed
  // in pendingShellPdf so the cold-start dispatch path (window-ready) and
  // the open-file pre-ready path (above) share a single rendezvous slot.
  {
    const shellPath = parseShellPdfPath(process.argv, { isPackaged: app.isPackaged });
    if (shellPath !== null) {
      pendingShellPdf = shellPath;
      pendingShellSource = 'argv';
    }
  }

  // Step 2 — wait for app ready
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  app.whenReady().then(() => {
    // Suppress Electron's default native application menu (File / Edit / View
    // / Window / Help). Riley's custom React MenuBar in src/client/components/
    // menu-bar/ is the sole user-visible menu surface; the native menu would
    // stack above it (v0.7.7 bug). Done once at boot before any BrowserWindow
    // is created so no window ever inherits the default menu. Pairs with
    // `autoHideMenuBar: true` in window-manager.ts (defense in depth).
    Menu.setApplicationMenu(null);

    // Step 3 — CSP first
    installCsp();

    // Step 3.5 — wire the DB bridge BEFORE IPC handlers register. The
    // registrar resolves repos via `getDbBridge()` per call, so handlers
    // registered after `setDbBridge(...)` see the real SQLite-backed repos.
    // On failure we log + surface a toast at the renderer once the window is
    // ready, and continue with the in-memory fallback (the module-scope
    // default in `db-bridge.ts`). Do NOT `app.quit()` — running in
    // non-persistent mode is the safe degradation path. See code-review.md
    // H-1 and wave-3.5-brief §1.1.
    let dbInitFailed: string | null = null;
    try {
      const db = initDatabase({
        dbPath: join(app.getPath('userData'), 'pdf-viewer-editor.db'),
        // Packaged Electron: `process.cwd()` is unreliable. `getAppPath()`
        // returns the asar root, with `migrations/` shipped via electron-
        // builder `extraResources` / build files (see electron-builder.yml).
        migrationsDir: join(app.getAppPath(), 'migrations'),
      });
      // Phase 7.2 (David, 2026-06-10) — Item A-1 static-import lift.
      // Six repo factories (form-templates, signature-audit, ocr-jobs,
      // ocr-results, language-packs, export-jobs) are now STATIC imports at
      // the top of this file. The previous Wave-12..24 dynamic-require shape
      // was the v0.7.18 reopen-restore catch-surface gap (Julian 7.1.5) —
      // Vite/Rollup silently tree-shook the modules out of `dist/main/` under
      // `_electron.launch()`, leaving the six slots on the memory fallback.
      // Replaced per `docs/phase-7.2-test-design.md §2.4`.
      //
      // Memory-fallback semantics preserved for the legitimate
      // constructor-throw case (e.g. SQLite open fails because the prepared
      // statement won't compile against a schema-version skew, or a test
      // injects a broken repo via `vi.mock` to drive the failure path). The
      // `tryConstruct` helper guards the FACTORY CALL only — the imports
      // themselves are unconditional and resolved at build time.
      //
      // Tagging: each slot records its origin (`'sqlite'` when the factory
      // returned, `'memory'` when it threw) into `kinds`. The map is handed
      // to `setDbBridge(bridge, kinds)` and exposed via the test-only
      // `__test:whichBridge` IPC channel so the e2e spec can assert all six
      // landed on SQLite under `_electron.launch()`.
      const memoryBridge = createMemoryDbBridge();

      // Per-slot factory-call guard. The factory is unconditionally imported
      // (static import at top of file), so the only legitimate failure case is
      // a constructor throw (SQLite open fails, schema-version skew, vi.mock
      // returning an unusable shape, etc.). The cast through `unknown` is
      // load-bearing — Ravi's repo return types (e.g. `OcrJobsRepo`) and
      // David's adapter input types (`RaviOcrJobsRepo`) are structurally
      // compatible at runtime but TypeScript treats discriminated-union return
      // shapes as non-overlapping. The legacy dynamic-require code carried the
      // same `unknown`-indirected cast — the lift preserves the type discipline
      // exactly (no NEW unsafe surface, just removes the runtime-require).
      const tryConstruct = <F, R, S>(
        factory: F,
        adapt: (raw: R) => S,
        fallback: S,
      ): { kind: 'sqlite' | 'memory'; repo: S } => {
        try {
          const raw = (factory as unknown as (db: unknown) => R)(db);
          return { kind: 'sqlite', repo: adapt(raw) };
        } catch (e) {
          console.error('[main] repo factory threw; using memory fallback:', (e as Error).message);
          return { kind: 'memory', repo: fallback };
        }
      };

      // Phase 3 (Wave 12) — form_templates
      const formTemplates = tryConstruct(
        createFormTemplatesRepo,
        adaptFormTemplatesRepo,
        memoryBridge.formTemplates,
      );
      // Phase 4 (Wave 16) — signature_audit_log
      const signatureAudit = tryConstruct(
        createSignatureAuditRepo,
        adaptSignatureAuditRepo,
        memoryBridge.signatureAudit,
      );
      // Phase 5 (Wave 20) — three OCR repos
      const ocrJobs = tryConstruct(createOcrJobsRepo, adaptOcrJobsRepo, memoryBridge.ocrJobs);
      const ocrResults = tryConstruct(
        createOcrResultsRepo,
        adaptOcrResultsRepo,
        memoryBridge.ocrResults,
      );
      const languagePacks = tryConstruct(
        createLanguagePacksRepo,
        adaptLanguagePacksRepo,
        memoryBridge.languagePacks,
      );
      // Phase 6 (Wave 24) — export_jobs
      const exportJobs = tryConstruct(
        createExportJobsRepo,
        adaptExportJobsRepo,
        memoryBridge.exportJobs,
      );

      const kinds: DbBridgeKinds = {
        formTemplates: formTemplates.kind,
        signatureAudit: signatureAudit.kind,
        ocrJobs: ocrJobs.kind,
        ocrResults: ocrResults.kind,
        languagePacks: languagePacks.kind,
        exportJobs: exportJobs.kind,
      };

      setDbBridge(
        {
          recents: adaptRecentsRepo(createRecentFilesRepo(db)),
          bookmarks: adaptBookmarksRepo(createBookmarksRepo(db)),
          // Phase 2 (Wave 7): wrap Ravi's settings repo through
          // adaptSettingsRepo so Phase-2 keys (export.deterministic,
          // editing.commitTextOnBlur, etc.) gracefully degrade to defaults
          // until Ravi widens the SettingKey union.
          settings: adaptSettingsRepo(createSettingsRepo(db)),
          // Phase 3 (Wave 12)
          formTemplates: formTemplates.repo,
          // Phase 4 (Wave 16)
          signatureAudit: signatureAudit.repo,
          // Phase 5 (Wave 20)
          ocrJobs: ocrJobs.repo,
          ocrResults: ocrResults.repo,
          languagePacks: languagePacks.repo,
          // Phase 6 (Wave 24)
          exportJobs: exportJobs.repo,
          // Phase 7.5 Wave 3 (David, 2026-06-17) — stamps_library.
          // tryConstruct used inline here would force a wider kinds-map change;
          // because the memory bridge already seeds the 10 built-ins and the
          // SQLite repo factory is a thin wrapper, we wire directly and fall
          // back to the memory bridge on throw.
          stampsLibrary: (() => {
            try {
              return adaptStampsLibraryRepo(createStampsLibraryRepo(db));
            } catch (e) {
              console.error(
                '[main] stamps_library SQLite repo init failed; falling back to memory:',
                (e as Error).message,
              );
              return memoryBridge.stampsLibrary;
            }
          })(),
        },
        kinds,
      );
    } catch (e) {
      const msg = (e as Error).message;
      console.error('[main] DB init failed; using in-memory fallback:', msg);
      dbInitFailed = msg;
    }

    // Step 4 — IPC handlers next, so the renderer has a complete surface
    // before navigation finishes. The pdf-lib-backed metadata loader lives
    // in src/main/pdf-ops/pdf-metadata-loader.ts (with unit tests); it is
    // the permanent replacement for the Phase-1 stub in register.ts.
    //
    // Phase 5 (Wave 20): the OCR wiring is REQUIRED (no optional fallback
    // per conventions §16.3.1). `bootstrapOcr()` constructs the worker pool,
    // language pack manager, rasterizer, and searchable-PDF builder. If
    // tesseract.js is not yet installed (pre-Wave-21 dev), the pool returns
    // typed `worker_init_failed` Results at run time — never a crash.
    const ocrWiring = bootstrapOcr();
    // Phase 5.1 (Wave 5.1, David): the WIA scanner wiring is REQUIRED (no
    // optional fallback), but `addon` is null on non-Windows / when the
    // native addon isn't built — the handlers degrade to scanner_unavailable.
    const scanWiring = bootstrapScan();
    // Phase 6.1 (David): wire the export engine. REQUIRED (no optional
    // fallback per conventions §17.4.1). The production source bundle is now
    // REAL — pdf.js opens the per-job document (rebound via loader.bind(spec))
    // and the SAME doc feeds text-content, line-segments, image extraction AND
    // rasterization for all four formats (docx / xlsx / pptx / image). See
    // `src/main/export/pdfjs-source.ts`.
    const exportSource = createProdSourceLoader();
    const exportEngine = bootstrapExportEngine(exportSource.loader, exportSource.rasterize);

    // Phase 7 (Wave 28a, David): telemetry service. The transport is the
    // in-memory NoOpRingBufferTransport (nothing leaves the machine; Phase 7).
    // Opt-in persists via the existing settings repo (DEFAULT false). When the
    // settings read throws (cross-wave skew before Ravi's v7 lands), we treat
    // opt-in as OFF — the privacy-safe default.
    const telemetryService = createTelemetryService({
      transport: new NoOpRingBufferTransport(),
      settings: {
        getOptIn: () => {
          try {
            return getDbBridge().settings.get('telemetry.optIn') === true;
          } catch {
            return false; // privacy-safe default
          }
        },
        setOptIn: (value) => {
          getDbBridge().settings.set('telemetry.optIn', value);
        },
      },
      now: () => Date.now(),
    });

    // Phase 7 (Wave 28a, David): auto-update controller. The publish target is
    // a PLACEHOLDER (Diego Wave 29) — so `isPublishConfigured` reads the bundled
    // `app-update.yml` and returns false for the placeholder, routing every
    // call to the honest `update_not_configured`. The real `electron-updater`
    // dep is loaded via runtime require inside `loadElectronUpdaterModule`
    // (returns null until Diego installs it). Progress events go to the active
    // window. lastCheckedAt persists via the settings repo (nullable late-init).
    const readAppUpdateYml = (): string | null => {
      try {
        const ymlPath = join(process.resourcesPath ?? '.', 'app-update.yml');
        if (!existsSync(ymlPath)) return null;
        return readFileSync(ymlPath, 'utf8');
      } catch {
        return null;
      }
    };
    const autoUpdateController = createAutoUpdateController({
      loadUpdater: loadElectronUpdaterModule,
      isPublishConfigured: () => isPublishConfiguredFromAppUpdateYml(readAppUpdateYml),
      getCurrentVersion: () => app.getVersion(),
      now: () => Date.now(),
      persistLastCheckedAt: (ts) => {
        try {
          getDbBridge().settings.set('update.lastCheckedAt', ts);
        } catch {
          /* cross-wave skew before Ravi v7 lands — best-effort persist */
        }
      },
      emitProgress: (evt) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.send(Channels.UpdateProgress, evt);
          } catch {
            /* renderer closed mid-download — drop the event */
          }
        }
      },
      scheduleInstall: (fn) => {
        setImmediate(fn);
      },
      // Unsaved-work install gate (Phase 7.1 — Julian H-29.1). Mirrors the
      // `app:quit` `hasUnsavedChanges` discipline (register.ts): dirty state is
      // renderer-owned, so the main-side probe defensively returns false and the
      // renderer drives the actual "Save before updating?" confirm, retrying
      // update:install with `confirmedDiscardUnsaved: true`. The gate is still
      // enforced in the controller — if a future main-side dirty mirror is wired
      // here, an unconfirmed install with unsaved work is refused with
      // `unsaved_work_blocks_install` instead of silently discarding work.
      // RENDERER FOLLOW-UP (Riley): wire the Save/Discard-and-install/Cancel
      // dialog (reuse ConfirmCloseUnsavedModal) on the install button so a dirty
      // document prompts before update:install.
      hasUnsavedWork: (): boolean => false, // renderer-owned (see app:quit)
    });

    registerIpcHandlers({
      ipcMain,
      getMainWindow,
      loadPdfMetadata,
      ocr: ocrWiring,
      exportEngine,
      autoUpdate: autoUpdateController,
      telemetry: telemetryService,
      scan: scanWiring,
      // Phase 7.5 Wave 6 (David, 2026-06-18) — B9 action scripts +
      // B14 spell user dict persist under this directory.
      userDataDir: app.getPath('userData'),
    });

    // Step 5 — main window
    const { url, file } = resolveRendererTarget();
    // Conditional spread per D-2 fix: `exactOptionalPropertyTypes: true`
    // forbids passing `undefined` into a `string?` field. Use spread to
    // omit the field when the target source is not in play.
    createMainWindow({
      ...(url !== undefined ? { rendererUrl: url } : {}),
      ...(file !== undefined ? { rendererFile: file } : {}),
    });

    // Shell-launched PDF dispatch (David 2026-06-04). pendingShellPdf was
    // populated synchronously at bootstrap from process.argv, OR by the
    // macOS open-file handler pre-window-ready. Wait for did-finish-load
    // (the renderer wires its onFileOpenFromShell subscriber at app mount,
    // and we MUST NOT race that subscription).
    if (pendingShellPdf !== null) {
      const win = getMainWindow();
      if (win) {
        const absolutePath = pendingShellPdf;
        const source = pendingShellSource;
        const postShellOpen = (): void => {
          try {
            win.webContents.send(Channels.FileOpenFromShell, {
              absolutePath,
              source,
            });
          } catch (e) {
            console.error('[main] cold-start: failed to dispatch shell open', e);
          }
        };
        if (win.webContents.isLoading()) {
          win.webContents.once('did-finish-load', postShellOpen);
        } else {
          postShellOpen();
        }
        pendingShellPdf = null;
      }
    }

    // If DB init failed, surface one toast to the renderer once it's ready.
    if (dbInitFailed !== null) {
      const win = getMainWindow();
      if (win) {
        const post = (): void =>
          win.webContents.send('toast:show', {
            kind: 'warning',
            message: `Database init failed; running with non-persistent state. (${dbInitFailed ?? ''})`,
          });
        if (win.webContents.isLoading()) {
          win.webContents.once('did-finish-load', post);
        } else {
          post();
        }
      }
    }
  });

  // Step 6 — lifecycle events
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const { url, file } = resolveRendererTarget();
      // Conditional spread — same TS2379 fix as Step 5 above.
      createMainWindow({
        ...(url !== undefined ? { rendererUrl: url } : {}),
        ...(file !== undefined ? { rendererFile: file } : {}),
      });
    }
  });
}

bootstrap();
