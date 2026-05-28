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
// PHASE 1 NOTES
// -------------
// - The DB bridge is the in-memory fallback today; once Ravi's repos land
//    (`src/db/repositories/*` in Wave 2), this file's startup will switch to
//    `setDbBridge(createSqliteBridge(...))`. Marked with a TODO.
// - Renderer entry resolution (Vite vs file://) is Diego's call in Wave 3.
//    For now we honor `VITE_DEV_SERVER_URL` env var if set, else load
//    `../client/index.html` relative to the compiled main output.
// - File-association registration: stub channel returns `not_implemented`
//    until the Wave 3 packaging brief reveals whether NSIS owns the install-
//    time path or this file owns the runtime path. Both will be wired.
// - Auto-updater: explicitly NOT wired in Phase 1. Phase 7 work.
//
// PLAYBOOK NOTES
// --------------
// - Entry-point detection (Playbook #1): not applicable — Electron's binary
//    chooses the main entry from package.json `main`, never via
//    `import.meta.url === \`file://...\``.
// - Env file loading (Playbook #4): `.env` is dev-only here. Diego adds the
//    `--env-file-if-exists` flag in package.json scripts when wiring `tsx`.

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain } from 'electron';

import { initDatabase } from '../db/connection.js';
import { createBookmarksRepo } from '../db/repositories/bookmarks-repo.js';
import { createRecentFilesRepo } from '../db/repositories/recent-files-repo.js';
import { createSettingsRepo } from '../db/repositories/settings-repo.js';
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
  createMemoryDbBridge,
  getDbBridge,
  setDbBridge,
  type RaviExportJobsRepo,
  type RaviFormTemplatesRepo,
  type RaviLanguagePacksRepo,
  type RaviOcrJobsRepo,
  type RaviOcrResultsRepo,
  type RaviSignatureAuditRepo,
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
  // Step 1 — single-instance lock
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Step 2 — wait for app ready
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  app.whenReady().then(() => {
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
      // Phase 3 (Wave 12, David): wire Ravi's form_templates SQLite repo
      // through adaptFormTemplatesRepo when present. The createFormTemplatesRepo
      // factory may not exist yet (Wave 12 parallel-wave skew with Ravi); in
      // that case we keep the memory-backed default already populated by
      // createMemoryDbBridge(). The conditional import here is a runtime
      // probe — if the module resolves, we wrap; if not, we fall back.
      const memoryBridge = createMemoryDbBridge();
      let formTemplatesRepo = memoryBridge.formTemplates;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const ftMod: unknown = require('../db/repositories/form-templates-repo.js');
        const factory = (ftMod as { createFormTemplatesRepo?: unknown }).createFormTemplatesRepo;
        if (typeof factory === 'function') {
          formTemplatesRepo = adaptFormTemplatesRepo(
            (factory as (db: unknown) => RaviFormTemplatesRepo)(db),
          );
        }
      } catch {
        // Memory fallback is fine until Ravi's repo lands.
      }
      // Phase 4 (Wave 16): wrap Ravi's signature_audit_log repo when
      // available. Memory-backed fallback otherwise — IPC handlers tolerate
      // both via the SignatureAuditRepoBridge interface.
      let signatureAuditRepo = memoryBridge.signatureAudit;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const saMod: unknown = require('../db/repositories/signature-audit-repo.js');
        const factory = (saMod as { createSignatureAuditRepo?: unknown }).createSignatureAuditRepo;
        if (typeof factory === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          signatureAuditRepo = adaptSignatureAuditRepo(
            (factory as (db: unknown) => RaviSignatureAuditRepo)(db),
          );
        }
      } catch {
        // Memory fallback is fine until Ravi's Wave 16 repo lands.
      }
      // Phase 5 (Wave 20): wrap Ravi's three new OCR repos when available.
      // Memory-backed fallback otherwise — IPC handlers tolerate either
      // via the OcrJobsRepoBridge / OcrResultsRepoBridge / LanguagePacksRepoBridge
      // interfaces.
      let ocrJobsRepo = memoryBridge.ocrJobs;
      let ocrResultsRepo = memoryBridge.ocrResults;
      let languagePacksRepo = memoryBridge.languagePacks;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const ojMod: unknown = require('../db/repositories/ocr-jobs-repo.js');
        const factory = (ojMod as { createOcrJobsRepo?: unknown }).createOcrJobsRepo;
        if (typeof factory === 'function') {
          ocrJobsRepo = adaptOcrJobsRepo(
            (factory as (db: unknown) => RaviOcrJobsRepo)(db),
          );
        }
      } catch {
        // Memory fallback is fine until Ravi's Wave 20 repo lands.
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const orMod: unknown = require('../db/repositories/ocr-results-repo.js');
        const factory = (orMod as { createOcrResultsRepo?: unknown }).createOcrResultsRepo;
        if (typeof factory === 'function') {
          ocrResultsRepo = adaptOcrResultsRepo(
            (factory as (db: unknown) => RaviOcrResultsRepo)(db),
          );
        }
      } catch {
        // Memory fallback.
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const lpMod: unknown = require('../db/repositories/language-packs-repo.js');
        const factory = (lpMod as { createLanguagePacksRepo?: unknown }).createLanguagePacksRepo;
        if (typeof factory === 'function') {
          languagePacksRepo = adaptLanguagePacksRepo(
            (factory as (db: unknown) => RaviLanguagePacksRepo)(db),
          );
        }
      } catch {
        // Memory fallback.
      }
      // Phase 6 (Wave 24): wrap Ravi's export_jobs repo when available.
      // Memory-backed fallback otherwise (same Phase 5 parallel-wave pattern).
      let exportJobsRepo = memoryBridge.exportJobs;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const ejMod: unknown = require('../db/repositories/export-jobs-repo.js');
        const factory = (ejMod as { createExportJobsRepo?: unknown }).createExportJobsRepo;
        if (typeof factory === 'function') {
          exportJobsRepo = adaptExportJobsRepo(
            (factory as (db: unknown) => RaviExportJobsRepo)(db),
          );
        }
      } catch {
        // Memory fallback is fine until Ravi's Wave 24 repo lands.
      }
      setDbBridge({
        recents: adaptRecentsRepo(createRecentFilesRepo(db)),
        bookmarks: adaptBookmarksRepo(createBookmarksRepo(db)),
        // Phase 2 (Wave 7): wrap Ravi's settings repo through
        // adaptSettingsRepo so Phase-2 keys (export.deterministic,
        // editing.commitTextOnBlur, etc.) gracefully degrade to defaults
        // until Ravi widens the SettingKey union.
        settings: adaptSettingsRepo(createSettingsRepo(db)),
        // Phase 3 (Wave 12)
        formTemplates: formTemplatesRepo,
        // Phase 4 (Wave 16)
        signatureAudit: signatureAuditRepo,
        // Phase 5 (Wave 20)
        ocrJobs: ocrJobsRepo,
        ocrResults: ocrResultsRepo,
        languagePacks: languagePacksRepo,
        // Phase 6 (Wave 24)
        exportJobs: exportJobsRepo,
      });
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
