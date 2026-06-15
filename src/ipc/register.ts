// Central IPC registration. Maps every Channels.* string to a handler
// + dependency injection wiring.
//
// Imports `electron` and `node:fs` etc. — main-process-only. Renderer never
// imports this file (CSP and contextIsolation guarantee, but the no-restricted
// -imports ESLint rule also flags it).

import { promises as fsPromises, existsSync } from 'node:fs';
import { join as joinPath } from 'node:path';

import { app, dialog, shell, type BrowserWindow, type IpcMain } from 'electron';

import type { AutoUpdateController } from '../main/auto-update.js';
import { getDbBridge, getDbBridgeKinds } from '../main/db-bridge.js';
import { type ExportEngine } from '../main/export/export-engine.js';
import { createExportQueue } from '../main/export/export-queue.js';
import { releaseAll as releaseAllCerts } from '../main/pdf-ops/cert-store.js';
// Wave-30 follow-up (H-30.1, David 2026-06-01): real combine engine.
import { combinePdfs } from '../main/pdf-ops/combine.js';
import { documentStore } from '../main/pdf-ops/document-store.js';
import { computeBufferHash, computeFileHash } from '../main/pdf-ops/file-hash.js';
import type { LanguagePackManager } from '../main/pdf-ops/language-pack-manager.js';
import { diagnoseOcr as diagnoseOcrProd } from '../main/pdf-ops/ocr-bootstrap.js';
import type {
  OcrEngineError,
  OcrWorkerPool,
  RasterPageOptions,
} from '../main/pdf-ops/ocr-engine.js';
// Phase 5.1 (Wave 5.1, David): WIA scanner wiring.
import { replay } from '../main/pdf-ops/replay-engine.js';
import type { ReplayInput } from '../main/pdf-ops/replay-engine.js';
import type { ScanPage, ScanToPdfError } from '../main/pdf-ops/scan-to-pdf.js';
import type { WiaAddon } from '../main/pdf-ops/wia-scanner.js';
// Wave 8 (Diego, D-8.2 + D-8.3): real Chromium export + Electron print
// dispatch adapters, replacing the Phase-2 conservative stubs below.
import { dispatchPrintViaElectron, exportViaChromium } from '../main/print-window.js';
import { sanitizeDirectoryPath, sanitizePath } from '../main/security/path-sanitizer.js';
import type { TelemetryService } from '../main/telemetry.js';
import type { Result } from '../shared/result.js';

import { Channels } from './contracts.js';
import type {
  MailMergeProgressEvent,
  ExportProgressEvent,
  AppLocale,
  OcrPageResult,
  OcrProgressEvent,
  OcrLanguagePackDownloadProgressEvent,
} from './contracts.js';
import { handleAnnotationsAddShape } from './handlers/annotations-add-shape.js';
import {
  handleAnnotationsGetMeasureCalibration,
  handleAnnotationsSetMeasureCalibration,
} from './handlers/annotations-measure-calibration.js';
import {
  handleAppDiagnoseOcr,
  handleAppGetDefaultPdfHandlerStatus,
  handleAppGetVersion,
  handleAppOpenExternal,
  handleAppQuit,
  handleAppSetDefaultPdfHandler,
} from './handlers/app.js';
import {
  handleBookmarksListTree,
  handleBookmarksMove,
  handleBookmarksRename,
} from './handlers/bookmarks-phase2.js';
import {
  handleBookmarksDelete,
  handleBookmarksList,
  handleBookmarksUpsert,
} from './handlers/bookmarks.js';
import { handleDialogOpenPdf } from './handlers/dialog-open-pdf.js';
import { handleDialogPickExportOutputPath } from './handlers/dialog-pick-export-output-path.js';
import { handleDialogPickPdfFiles } from './handlers/dialog-pick-pdf-files.js';
import { handleDialogSaveAs } from './handlers/dialog-save-as.js';
import { handleExportCancelJob } from './handlers/export-cancel-job.js';
import { handleExportListFormats } from './handlers/export-list-formats.js';
import { handleExportListJobs } from './handlers/export-list-jobs.js';
import type { ExportHandlerCommonDeps } from './handlers/export-shared.js';
import { handleExportToDocx } from './handlers/export-to-docx.js';
import { handleExportToImages } from './handlers/export-to-images.js';
import { handleExportToPptx } from './handlers/export-to-pptx.js';
import { handleExportToXlsx } from './handlers/export-to-xlsx.js';
import { handleFormsDesignAdd } from './handlers/forms-design-add.js';
import { handleFormsDesignRemove } from './handlers/forms-design-remove.js';
import { handleFormsDetect } from './handlers/forms-detect.js';
import { handleFormsFill } from './handlers/forms-fill.js';
import { handleFormsFlatten } from './handlers/forms-flatten.js';
import { handleFormsListTemplates } from './handlers/forms-list-templates.js';
import { handleFormsLoadTemplate } from './handlers/forms-load-template.js';
import { handleFormsParseDataSource } from './handlers/forms-parse-data-source.js';
import {
  handleFormsCancelMailMerge,
  handleFormsRunMailMerge,
} from './handlers/forms-run-mail-merge.js';
import { handleFormsSaveTemplate } from './handlers/forms-save-template.js';
import { handleFsClosePdf } from './handlers/fs-close-pdf.js';
import { handleFsReadBytesByHandle } from './handlers/fs-read-bytes-by-handle.js';
import { handleFsReadPdf } from './handlers/fs-read-pdf.js';
import { handleFsWritePdf } from './handlers/fs-write-pdf.js';
import { handleI18nGetAvailableLocales } from './handlers/i18n-get-available-locales.js';
import { handleI18nSetLocale } from './handlers/i18n-set-locale.js';
import { handleOcrCancelJob } from './handlers/ocr-cancel-job.js';
import { handleOcrDetectLanguages } from './handlers/ocr-detect-languages.js';
import { handleOcrLanguagePackDownload } from './handlers/ocr-download-language-pack.js';
import { handleOcrLanguagePackRemove } from './handlers/ocr-language-pack-remove.js';
import { handleOcrListJobs } from './handlers/ocr-list-jobs.js';
import { handleOcrListResultsByJob } from './handlers/ocr-list-results-by-job.js';
import { handleOcrRunOnDocument } from './handlers/ocr-run-on-document.js';
import { handleOcrRunOnPage } from './handlers/ocr-run-on-page.js';
import { handleFsApplyEditOps } from './handlers/pdf-apply-edit-ops.js';
import type { FsApplyEditOpsDeps } from './handlers/pdf-apply-edit-ops.js';
import { handlePdfApplyRedactions } from './handlers/pdf-apply-redactions.js';
import { handlePdfCombine } from './handlers/pdf-combine.js';
import { handlePdfEmbedImage } from './handlers/pdf-embed-image.js';
import { defaultPickEngine, handlePdfExport } from './handlers/pdf-export-pdf.js';
import { handlePdfIdentifyTextSpan } from './handlers/pdf-identify-text-span.js';
import { handlePdfGetOutline } from './handlers/pdf-ops.js';
// Wave-30 follow-up (H-30.1, David 2026-06-01): real combine handler +
// path-only file picker. Replaces the Phase-1 `not_implemented` stub.
import { handlePdfPrint } from './handlers/pdf-print.js';
import { handlePdfReplaceText } from './handlers/pdf-replace-text.js';
import { handleRecentsAdd } from './handlers/recents-add.js';
import { handleRecentsClear } from './handlers/recents-clear.js';
import { handleRecentsList } from './handlers/recents-list.js';
import { handleScanAcquire } from './handlers/scan-acquire.js';
import { handleScanListDevices } from './handlers/scan-list-devices.js';
import { handleSettingsGet, handleSettingsGetAll, handleSettingsSet } from './handlers/settings.js';
// Phase 3 (Wave 12, David) — forms:* channels
// Phase 4 (Wave 16, David) — signatures:* + annotations:* handlers.
import { handleSignaturesApplyPades } from './handlers/signatures-apply-pades.js';
import { handleSignaturesApplyVisual } from './handlers/signatures-apply-visual.js';
import { handleSignaturesCertLoad } from './handlers/signatures-cert-load.js';
import { handleSignaturesCertRelease } from './handlers/signatures-cert-release.js';
import { handleSignaturesListAudit } from './handlers/signatures-list-audit.js';
import { handleSignaturesRequestTimestamp } from './handlers/signatures-request-timestamp.js';
import { handleSignaturesVerify } from './handlers/signatures-verify.js';
// Phase 5 (Wave 20, David) — OCR + scan handlers + worker pool wiring.
// Phase 6 (Wave 24, David) — export-to-Office channels.
// Phase 7 (Wave 28a, David) — auto-update + telemetry + i18n handlers.
import { handleTelemetryGetStatus } from './handlers/telemetry-get-status.js';
import { handleTelemetryRecordEvent } from './handlers/telemetry-record-event.js';
import { handleTelemetrySetOptIn } from './handlers/telemetry-set-opt-in.js';
// Phase 7.1 (David, 2026-06-05) — test-only seed channel. registerTestSeedOcrJob
// early-returns when NODE_ENV !== 'test'; the IPC handle never lands on the prod
// surface. See `src/ipc/handlers/test-seed-ocr-job.ts` for the structural gate.
import { registerTestListSignatureAudit } from './handlers/test-list-signature-audit.js';
import { registerTestSeedOcrJob } from './handlers/test-seed-ocr-job.js';
// Phase 7.2 (David, 2026-06-10) — test-only bridge-introspection channel.
// Same structural gate as `__test:seedOcrJob` (early-returns when NODE_ENV is
// not 'test'); the e2e spec uses this to assert Item A-1's static-import lift
// actually loaded the SQLite repos under `_electron.launch()`. See
// `src/ipc/handlers/test-which-bridge.ts` and
// `docs/phase-7.2-test-design.md §2.6`.
import { registerTestSeedSignatureAudit } from './handlers/test-seed-signature-audit.js';
import { registerTestWhichBridge } from './handlers/test-which-bridge.js';
// Phase 7.2 7.2.4 (Diego, 2026-06-10) — test-only signature_audit_log seed +
// readback channels for the signed-PDF + OCR invalidation e2e. Same structural
// gate (early-return when NODE_ENV !== 'test'). See
// `src/ipc/handlers/test-seed-signature-audit.ts` and
// `src/ipc/handlers/test-list-signature-audit.ts`.
import { handleUpdateCheck } from './handlers/update-check.js';
import { handleUpdateDownload } from './handlers/update-download.js';
import { handleUpdateInstall } from './handlers/update-install.js';
import {
  handleWindowClose,
  handleWindowGetState,
  handleWindowMaximize,
  handleWindowMinimize,
  type WindowLike,
} from './handlers/window.js';

const DEFAULT_MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB default

/**
 * Phase 5 (Wave 20, David) — OCR options.
 *
 * EVERY FIELD IS REQUIRED. Per conventions §16.3.1 (anti-stub-shipped-with-
 * TODO discipline) the structural enforcement of "ship now, wire later" is
 * the typecheck — there is NO `?` on any field, NO default fallback. If
 * Wave 20 ships without wiring the pool, TypeScript fails the build.
 *
 * Production wiring (Diego Wave 21):
 *   - `pool` is created via `createOcrWorkerPool({ workerFactory, ... })`
 *     where `workerFactory.create(lang, langDir)` calls tesseract.js's
 *     `createWorker(lang, 1, { langPath: langDir, gzip: true })`.
 *   - `languagePackManager` is `createLanguagePackManager(...)` with the
 *     shipped catalog + production HTTP streamer.
 *   - `rasterizePage` uses pdfjs in main to render a page at the chosen DPI.
 *   - `pageDimensions` reads from documentStore + loadPdfMetadata.
 *   - `composeSearchablePdf` is `ocr-text-layer.composeSearchablePdf`.
 */
export interface RegisterOcrOptions {
  pool: OcrWorkerPool;
  languagePackManager: LanguagePackManager;
  rasterizePage: (opts: RasterPageOptions) => Promise<Uint8Array>;
  pageDimensions: (
    handle: number,
    pageIndex: number,
  ) => Promise<{ widthPts: number; heightPts: number }>;
  composeSearchablePdf: (
    originalBytes: Uint8Array,
    pageResults: OcrPageResult[],
  ) => Promise<Uint8Array>;
  watchdogMs: number;
  rasterDpi: number;
}

/**
 * Phase 5.1 (Wave 5.1, David) — scanner options.
 *
 * The `addon` FIELD is REQUIRED (library-injection seam), but its VALUE may be
 * null — that's the explicit graceful-degrade path (non-Windows / addon not
 * built), surfaced to the renderer as a typed `scanner_unavailable` Result.
 * Production wiring is `bootstrapScan()` in `scan-bootstrap.ts`; tests inject a
 * synthetic addon + composer + register.
 */
export interface RegisterScanOptions {
  addon: WiaAddon | null;
  composeScanToPdf: (
    pages: ScanPage[],
  ) => Promise<
    Result<{ bytes: Uint8Array; pageCount: number; warnings: string[] }, ScanToPdfError>
  >;
  registerScannedPdf: (
    bytes: Uint8Array,
    displayName: string,
    pageCount: number,
  ) => { handle: number; displayName: string };
}

export interface RegisterIpcOptions {
  ipcMain: IpcMain;
  /** Returns the active BrowserWindow used for native dialogs + window controls. */
  getMainWindow: () => BrowserWindow | null;
  /**
   * pdf-lib-backed metadata loader. REQUIRED in Phase 4.1; the Phase-1 stub
   * (which returned `pageCount: -1`) was removed because it silently broke
   * open-and-render end-to-end for 4 waves. Production passes the impl from
   * `src/main/pdf-ops/pdf-metadata-loader.ts`; tests pass a synthetic that
   * matches the contract (real pageCount, empty warnings).
   */
  loadPdfMetadata: (bytes: Uint8Array) => Promise<{ pageCount: number; warnings: string[] }>;
  /**
   * Phase 5 (Wave 20): OCR engine wiring. REQUIRED — no optional fallback.
   * See `RegisterOcrOptions` docstring above for the structural rationale.
   */
  ocr: RegisterOcrOptions;
  /**
   * Phase 6 (Wave 24): export engine wiring. REQUIRED — no optional fallback.
   * Production wires the engine via `bootstrapExportEngine(...)` in
   * `src/main/export/export-bootstrap.ts`; tests inject a synthetic engine
   * implementing the same shape.
   *
   * Anti-stub-shipped-with-TODO discipline (conventions §17.4.1) —
   * `exportEngine` has NO `?`, NO default. If Wave 24 ships without wiring
   * the engine, TypeScript fails the build.
   */
  exportEngine: ExportEngine;
  /**
   * Phase 7 (Wave 28a): auto-update controller wiring. REQUIRED — no optional
   * fallback (library-injection over direct import; the heavy `electron-updater`
   * dep is loaded via runtime require INSIDE the controller, so the main bundle
   * builds before Diego installs it in Wave 29). Production wires it via
   * `createAutoUpdateController(...)` in `src/main/index.ts`; tests inject a
   * synthetic controller implementing the same shape.
   */
  autoUpdate: AutoUpdateController;
  /**
   * Phase 7 (Wave 28a): telemetry service wiring. REQUIRED — no optional
   * fallback (the transport interface field is required; anti-stub discipline,
   * conventions §18.5 rule 7). Production wires it via
   * `createTelemetryService({ transport: new NoOpRingBufferTransport(), ... })`
   * in `src/main/index.ts`; tests inject a synthetic service.
   */
  telemetry: TelemetryService;
  /**
   * Phase 5.1 (Wave 5.1): WIA scanner wiring. REQUIRED — no optional fallback.
   * The `addon` value may be null (graceful-degrade). Production wires it via
   * `bootstrapScan()` in `scan-bootstrap.ts`; tests inject a synthetic addon.
   */
  scan: RegisterScanOptions;
}

// Reference unused imports to keep them from being tree-shaken in type-only
// usage contexts (verbatimModuleSyntax discipline).
export type _UnusedOcrEngineError = OcrEngineError;

export function registerIpcHandlers(opts: RegisterIpcOptions): void {
  const {
    ipcMain,
    getMainWindow,
    loadPdfMetadata,
    ocr,
    exportEngine,
    autoUpdate,
    telemetry,
    scan,
  } = opts;

  // -------- helpers ------------------------------------------------------
  const browserWindowToWindowLike = (w: BrowserWindow | null): WindowLike | null => {
    if (!w) return null;
    return {
      minimize: () => w.minimize(),
      maximize: () => w.maximize(),
      unmaximize: () => w.unmaximize(),
      close: () => w.close(),
      isMaximized: () => w.isMaximized(),
      isMinimized: () => w.isMinimized(),
      isFullScreen: () => w.isFullScreen(),
      isFocused: () => w.isFocused(),
    };
  };

  const getMaxFileSizeBytes = (): number => {
    const v = getDbBridge().settings.get('open.maxFileSizeMB');
    if (typeof v === 'number' && v > 0) return v * 1024 * 1024;
    return DEFAULT_MAX_FILE_SIZE_BYTES;
  };

  // -------- channel registration ----------------------------------------
  ipcMain.handle(Channels.DialogOpenPdf, (_evt, _payload) =>
    handleDialogOpenPdf(_payload ?? {}, {
      showOpenDialog: async () => {
        const win = getMainWindow();
        return win
          ? dialog.showOpenDialog(win, {
              properties: ['openFile'],
              filters: [{ name: 'PDF', extensions: ['pdf'] }],
            })
          : dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [{ name: 'PDF', extensions: ['pdf'] }],
            });
      },
      readFile: async (p) => new Uint8Array(await fsPromises.readFile(p)),
      statFile: async (p) => ({ size: (await fsPromises.stat(p)).size }),
      computeFileHash,
      loadPdfMetadata,
      registerHandle: (rec) => documentStore.register(rec),
      recordRecent: (row) => getDbBridge().recents.upsert(row),
      sanitizePath: (raw) => sanitizePath(raw),
      getMaxFileSizeBytes,
    }),
  );

  ipcMain.handle(Channels.DialogSaveAs, (_evt, payload) =>
    handleDialogSaveAs(payload ?? {}, {
      showSaveDialog: async (suggestedName) => {
        const win = getMainWindow();
        return win
          ? dialog.showSaveDialog(win, {
              defaultPath: suggestedName,
              filters: [{ name: 'PDF', extensions: ['pdf'] }],
            })
          : dialog.showSaveDialog({
              defaultPath: suggestedName,
              filters: [{ name: 'PDF', extensions: ['pdf'] }],
            });
      },
      sanitizePath: (raw) => sanitizePath(raw),
      issueDestinationToken: (path, displayName) =>
        documentStore.issueDestinationToken(path, displayName),
    }),
  );

  ipcMain.handle(Channels.FsReadPdf, (_evt, payload) =>
    handleFsReadPdf(payload, {
      readFile: async (p) => new Uint8Array(await fsPromises.readFile(p)),
      statFile: async (p) => ({ size: (await fsPromises.stat(p)).size }),
      computeFileHash,
      loadPdfMetadata,
      registerHandle: (rec) => documentStore.register(rec),
      recordRecent: (row) => getDbBridge().recents.upsert(row),
      sanitizePath: (raw) => sanitizePath(raw),
      getMaxFileSizeBytes,
    }),
  );

  // Phase 2 (edit-replay-engine.md §10): the kind:'ops' path is now Live.
  // The applyOpsToBytes shim wraps the replay engine and surfaces its
  // structured errors back into the FsWritePdfError union.
  const applyOpsToBytes: NonNullable<
    Parameters<typeof handleFsWritePdf>[1]['applyOpsToBytes']
  > = async (input) => {
    const r = await replay({
      originalBytes: input.originalBytes,
      ops: input.ops as Parameters<typeof replay>[0]['ops'],
      annotations: input.annotations as Parameters<typeof replay>[0]['annotations'],
      jobId: `fs-write-${Date.now()}`,
    });
    if (r.ok) {
      return {
        ok: true,
        value: {
          newBytes: r.value.newBytes,
          annotationRefAssignments: r.value.annotationRefAssignments,
          warnings: r.value.warnings,
        },
      };
    }
    // Map ReplayError -> FsWritePdfError. Both unions overlap intentionally.
    const passThrough: ReadonlySet<string> = new Set([
      'op_apply_failed',
      'annotation_emit_failed',
      'image_decode_failed',
      'text_span_not_found',
      'missing_glyph',
      'serialize_failed',
      'encrypted_unsupported',
    ]);
    const mapped = passThrough.has(r.error)
      ? (r.error as Parameters<typeof handleFsWritePdf>[1] extends {
          applyOpsToBytes?: infer F;
        }
          ? F extends (...args: never) => Promise<{ ok: false; error: infer E; message: string }>
            ? E
            : 'fs_write_failed'
          : 'fs_write_failed')
      : ('fs_write_failed' as const);
    return { ok: false, error: mapped, message: r.message };
  };

  ipcMain.handle(Channels.FsWritePdf, (_evt, payload) =>
    handleFsWritePdf(payload, {
      consumeDestinationToken: (token) => documentStore.consumeDestinationToken(token),
      getDocument: (h) => {
        const rec = documentStore.get(h);
        return rec ? { bytes: rec.bytes, path: rec.path } : null;
      },
      writeFile: async (p, b) => {
        await fsPromises.writeFile(p, b);
      },
      computeBufferHash,
      applyOpsToBytes,
      setBytes: (h, b) => documentStore.setBytes(h, b),
    }),
  );

  // Phase 2 (architecture-phase-2.md §2.5): fs:applyEditOps — convenience
  // entry point for the renderer's saveDocumentThunk. Wraps replay + atomic
  // temp-rename. The renderer prefers this to fs:writePdf kind:'ops' because
  // it accepts an outputPath directly OR consumes a destinationToken.
  const applyEditOpsDeps: FsApplyEditOpsDeps = {
    getBytes: (h) => documentStore.getBytes(h),
    setBytes: (h, b) => documentStore.setBytes(h, b),
    consumeDestinationToken: (token) => {
      const r = documentStore.consumeDestinationToken(token);
      if (!r) return null;
      return { path: r.path, displayName: r.displayName };
    },
    sanitizePath: (raw) => sanitizePath(raw),
    writeFile: async (p, b) => {
      await fsPromises.writeFile(p, b);
    },
    rename: async (from, to) => {
      await fsPromises.rename(from, to);
    },
    unlink: async (p) => {
      await fsPromises.unlink(p);
    },
    computeBufferHash,
    replay: async (input: ReplayInput) => {
      const r = await replay(input);
      if (r.ok) {
        return { ok: true, value: r.value };
      }
      return {
        ok: false,
        error: r.error,
        message: r.message,
        ...(r.details !== undefined ? { details: r.details } : {}),
      };
    },
  };
  ipcMain.handle(Channels.FsApplyEditOps, (_evt, payload) =>
    handleFsApplyEditOps(payload, applyEditOpsDeps),
  );

  ipcMain.handle(Channels.FsClosePdf, (_evt, payload) =>
    handleFsClosePdf(payload, { releaseHandle: (h) => documentStore.release(h) }),
  );

  // Phase 4.1 (api-contracts.md §15): renderer fetches document bytes by
  // handle so pdf.js can render pages + thumbnails. Lookup-only — no path
  // crosses the IPC boundary. Security note: bytes were validated at open
  // time; the handler is a SIMPLE document-store lookup with zod payload
  // validation. See `src/ipc/handlers/fs-read-bytes-by-handle.ts`.
  ipcMain.handle(Channels.FsReadBytesByHandle, (_evt, payload) =>
    handleFsReadBytesByHandle(payload, {
      getBytes: (h) => documentStore.getBytes(h),
    }),
  );

  ipcMain.handle(Channels.RecentsList, (_evt, payload) =>
    handleRecentsList(payload ?? {}, {
      listRows: (limit) => getDbBridge().recents.list(limit),
      fileExists: (p) => existsSync(p),
    }),
  );

  ipcMain.handle(Channels.RecentsAdd, (_evt, payload) =>
    handleRecentsAdd(payload, {
      upsertRow: (row) => getDbBridge().recents.upsert(row),
      sanitizePath: (raw) => sanitizePath(raw),
    }),
  );

  ipcMain.handle(Channels.RecentsClear, (_evt, payload) =>
    handleRecentsClear(payload ?? {}, { clearRows: () => getDbBridge().recents.clear() }),
  );

  ipcMain.handle(Channels.SettingsGet, (_evt, payload) =>
    handleSettingsGet(payload, { repo: getDbBridge().settings }),
  );
  ipcMain.handle(Channels.SettingsSet, (_evt, payload) =>
    handleSettingsSet(payload, { repo: getDbBridge().settings }),
  );
  ipcMain.handle(Channels.SettingsGetAll, (_evt, payload) =>
    handleSettingsGetAll(payload ?? {}, { repo: getDbBridge().settings }),
  );

  ipcMain.handle(Channels.BookmarksList, (_evt, payload) =>
    handleBookmarksList(payload, { repo: getDbBridge().bookmarks }),
  );
  ipcMain.handle(Channels.BookmarksUpsert, (_evt, payload) =>
    handleBookmarksUpsert(payload, { repo: getDbBridge().bookmarks }),
  );
  ipcMain.handle(Channels.BookmarksDelete, (_evt, payload) =>
    handleBookmarksDelete(payload, { repo: getDbBridge().bookmarks }),
  );

  // Wave-30 follow-up (H-30.1, David 2026-06-01): real combine handler.
  // Replaces the Phase-1 `not_implemented` stub. Uses the same per-handler
  // DI shape as dialog-open-pdf so the real sanitizer + documentStore +
  // computeBufferHash are honestly wired (no permissive passthrough).
  ipcMain.handle(Channels.PdfCombine, (_evt, payload) =>
    handlePdfCombine(payload, {
      readFile: async (p) => new Uint8Array(await fsPromises.readFile(p)),
      sanitizePath: (raw) => sanitizePath(raw),
      getBytesByHandle: (h) => documentStore.getBytes(h),
      computeBufferHash,
      combineEngine: combinePdfs,
      registerHandle: (rec) => documentStore.register(rec),
    }),
  );
  // M-30.1 disposition: kept as honest `not_implemented` stub; zero callers
  // outside the api.ts unavailable-fallback. See pdf-ops.ts file header.
  ipcMain.handle(Channels.PdfGetOutline, (_evt, payload) => handlePdfGetOutline(payload));

  // Wave-30 follow-up (H-30.1, David 2026-06-01): path-only PDF picker for
  // the Combine modal. Returns sanitized absolute paths; no read, no handle.
  ipcMain.handle(Channels.DialogPickPdfFiles, (_evt, payload) =>
    handleDialogPickPdfFiles(payload ?? {}, {
      showOpenDialog: async (opts) => {
        const win = getMainWindow();
        return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
      },
      sanitizePath: (raw) => sanitizePath(raw),
    }),
  );

  // Phase 2 (api-contracts.md §12.1-§12.4 + §12.5-§12.7): new pdf:* and bookmarks:* channels.
  ipcMain.handle(Channels.PdfEmbedImage, (_evt, payload) =>
    handlePdfEmbedImage(payload, {
      hasHandle: (h) => documentStore.get(h) !== null,
    }),
  );

  ipcMain.handle(Channels.PdfReplaceText, (_evt, payload) =>
    handlePdfReplaceText(payload, {
      hasHandle: (h) => documentStore.get(h) !== null,
      // Phase-2 conservative: the text-run scanner returns null until 2.5;
      // the handler still returns the EditOperation with oldText=''.
      resolveTextSpan: () => null,
    }),
  );

  ipcMain.handle(Channels.PdfIdentifyTextSpan, (_evt, payload) =>
    handlePdfIdentifyTextSpan(payload, {
      hasHandle: (h) => documentStore.get(h) !== null,
      getBytes: (h) => documentStore.getBytes(h),
    }),
  );

  ipcMain.handle(Channels.PdfPrint, (_evt, payload) =>
    handlePdfPrint(payload, {
      hasHandle: (h) => documentStore.get(h) !== null,
      getBytes: (h) => documentStore.getBytes(h),
      replay: async (input: ReplayInput) => {
        const r = await replay(input);
        return r.ok
          ? { ok: true, value: r.value }
          : { ok: false, error: r.error, message: r.message };
      },
      // Wave 8 (D-8.3): real Electron print dispatch via webContents.print().
      // The hidden BrowserWindow is constructed with the same security floor
      // as the main window (contextIsolation/sandbox/no nodeIntegration) and
      // omits enableDragDropFiles to preserve the Electron default (L-001
      // reaffirmed in src/main/print-window.test.ts).
      dispatchPrint: dispatchPrintViaElectron,
    }),
  );

  ipcMain.handle(Channels.PdfExport, (_evt, payload) =>
    handlePdfExport(payload, {
      hasHandle: (h) => documentStore.get(h) !== null,
      getBytes: (h) => documentStore.getBytes(h),
      replay: async (input: ReplayInput) => {
        const r = await replay(input);
        return r.ok
          ? { ok: true, value: r.value }
          : { ok: false, error: r.error, message: r.message };
      },
      // Wave 8 (D-8.2): real Chromium export adapter via offscreen
      // BrowserWindow + webContents.printToPDF(). L-001 invariant
      // (enableDragDropFiles !== false) reaffirmed by
      // src/main/print-window.test.ts.
      chromiumExport: exportViaChromium,
      pickEngine: (bytes, ops, annotations) => defaultPickEngine(bytes, ops, annotations),
    }),
  );

  // ============================================================================
  // Phase 7.4 B1 (David, 2026-06-15) — pdf:applyRedactions (Riley design §3.1).
  //
  // R1 rasterize-redact + sanitize. Reuses the L-004/L-005-compliant OCR
  // rasterizer for page rasterization, and `@napi-rs/canvas` for the black-
  // rect compositing. Signature-audit invalidation backref forwards to the
  // signatureAudit bridge's new `markInvalidatedByRedaction` method
  // (Ravi's repo + David's bridge adapter, db-bridge.ts).
  // ============================================================================
  ipcMain.handle(Channels.PdfApplyRedactions, (_evt, payload) =>
    handlePdfApplyRedactions(payload, {
      getBytes: (h) => documentStore.getBytes(h),
      setBytes: (h, b) => documentStore.setBytes(h, b),
      getDocHash: (h) => documentStore.get(h)?.fileHash ?? null,
      // Handle-keyed rasterizer — production reuses the OCR rasterize
      // pipeline (same L-004/L-005 contract). Bytes already in documentStore;
      // the rasterizer reads them from there. We synthesize a non-aborting
      // `AbortSignal` because the OCR `RasterPageOptions` requires one (it's
      // load-bearing for OCR's per-page cancel); redaction has no per-page
      // cancellation today (Riley §3.1 `cancelled` reserved for v2). The
      // signal stays unfired for the lifetime of the IPC round-trip.
      rasterizePageByHandle: async (handle, opts) =>
        ocr.rasterizePage({
          handle,
          pageIndex: opts.pageIndex,
          dpi: opts.dpi,
          signal: new AbortController().signal,
        }),
      // Production canvas adapter — paints opaque black rects on the PNG.
      // Dynamic-imported inside the closure so a packaging without
      // `@napi-rs/canvas` (test env) doesn't error at boot — error surfaces
      // at first Apply call instead, mapped to engine_failed.
      drawBlackRectsOnPng: async (png, rectsPx) => {
        const { drawBlackRectsOnPngProd } = await import('../main/pdf-ops/redact-canvas.js');
        return drawBlackRectsOnPngProd(png, rectsPx);
      },
      signatureAuditRedaction: getDbBridge().signatureAudit
        ? {
            markInvalidatedByRedaction: (docHash, fieldNames) => {
              const repo = getDbBridge().signatureAudit;
              if (!repo) return 0;
              if (typeof repo.markInvalidatedByRedaction === 'function') {
                return repo.markInvalidatedByRedaction(docHash, fieldNames);
              }
              // Older memory bridge without the back-ref — best-effort no-op.
              return 0;
            },
          }
        : null,
      defaultRasterDpi: 200, // Riley §1.2 design default; UI can override per-request.
    }),
  );

  ipcMain.handle(Channels.BookmarksListTree, (_evt, payload) =>
    handleBookmarksListTree(payload, { repo: getDbBridge().bookmarks }),
  );
  ipcMain.handle(Channels.BookmarksMove, (_evt, payload) =>
    handleBookmarksMove(payload, { repo: getDbBridge().bookmarks }),
  );
  ipcMain.handle(Channels.BookmarksRename, (_evt, payload) =>
    handleBookmarksRename(payload, { repo: getDbBridge().bookmarks }),
  );

  const appDeps = {
    getVersions: () => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromiumVersion: process.versions.chrome ?? 'unknown',
      nodeVersion: process.versions.node,
    }),
    hasUnsavedChanges: (): boolean => false, // renderer-owned in Phase 1; tracked there
    requestQuit: () => app.quit(),
    showInExplorer: async (handle: number): Promise<boolean> => {
      const rec = documentStore.get(handle);
      if (!rec || !rec.path) return false;
      shell.showItemInFolder(rec.path);
      return true;
    },
    getDocumentPath: (handle: number): string | null => documentStore.get(handle)?.path ?? null,
    // Opens Windows Settings -> Default apps for this app, scoped via the
    // `registeredAppName` query so the user lands on our app's row. Modern
    // Windows 10/11 require the user to confirm in this UI; an app cannot
    // silently flip the default handler. Non-Windows platforms return false
    // so the handler surfaces an honest not_implemented response.
    openDefaultAppsSettings: async (): Promise<boolean> => {
      if (process.platform !== 'win32') return false;
      try {
        await shell.openExternal('ms-settings:defaultapps?registeredAppName=PDF%20Viewer%20Editor');
        return true;
      } catch {
        return false;
      }
    },
    // David 2026-06-01: wire the OCR runtime probe to its production impl.
    diagnoseOcr: () => diagnoseOcrProd(),
  };

  ipcMain.handle(Channels.AppGetVersion, (_evt, payload) =>
    handleAppGetVersion(payload ?? {}, appDeps),
  );
  ipcMain.handle(Channels.AppQuit, (_evt, payload) => handleAppQuit(payload, appDeps));
  ipcMain.handle(Channels.AppOpenExternal, (_evt, payload) =>
    handleAppOpenExternal(payload, appDeps),
  );
  ipcMain.handle(Channels.AppSetDefaultPdfHandler, (_evt, payload) =>
    handleAppSetDefaultPdfHandler(payload, appDeps),
  );
  ipcMain.handle(Channels.AppGetDefaultPdfHandlerStatus, (_evt, payload) =>
    handleAppGetDefaultPdfHandlerStatus(payload ?? {}),
  );
  ipcMain.handle(Channels.AppDiagnoseOcr, (_evt, payload) =>
    handleAppDiagnoseOcr(payload ?? {}, appDeps),
  );

  // ============================================================================
  // Phase 3 (Wave 12) — forms:* channels (api-contracts.md §13)
  // ============================================================================
  const formsBytesDep = {
    getBytes: (h: number) => documentStore.getBytes(h),
  };

  ipcMain.handle(Channels.FormsDetect, (_evt, payload) =>
    handleFormsDetect(payload, formsBytesDep),
  );
  ipcMain.handle(Channels.FormsFill, (_evt, payload) => handleFormsFill(payload, formsBytesDep));
  ipcMain.handle(Channels.FormsFlatten, (_evt, payload) =>
    handleFormsFlatten(payload, formsBytesDep),
  );
  ipcMain.handle(Channels.FormsDesignAdd, (_evt, payload) =>
    handleFormsDesignAdd(payload, formsBytesDep),
  );
  ipcMain.handle(Channels.FormsDesignRemove, (_evt, payload) =>
    handleFormsDesignRemove(payload, formsBytesDep),
  );

  // Template-channel deps come from the db-bridge (Ravi's repo via adapter
  // when present; memory-backed fallback otherwise — see db-bridge.ts).
  ipcMain.handle(Channels.FormsListTemplates, (_evt, payload) =>
    handleFormsListTemplates(payload ?? {}, { repo: getDbBridge().formTemplates }),
  );
  ipcMain.handle(Channels.FormsSaveTemplate, (_evt, payload) =>
    handleFormsSaveTemplate(payload, {
      repo: getDbBridge().formTemplates,
      hasHandle: (h) => documentStore.get(h) !== null,
      getDocumentHash: (h) => documentStore.get(h)?.fileHash ?? null,
    }),
  );
  ipcMain.handle(Channels.FormsLoadTemplate, (_evt, payload) =>
    handleFormsLoadTemplate(payload, { repo: getDbBridge().formTemplates }),
  );

  ipcMain.handle(Channels.FormsParseDataSource, (_evt, payload) =>
    handleFormsParseDataSource(payload, {}),
  );

  ipcMain.handle(Channels.FormsRunMailMerge, (_evt, payload) =>
    handleFormsRunMailMerge(payload, {
      getBytes: (h) => documentStore.getBytes(h),
      formTemplatesRepo: getDbBridge().formTemplates,
      // Phase 3.1 (H-3.3, David): atomic temp+rename write per row + concat.
      // The previous direct `writeFile(p, b)` left a half-written PDF on disk
      // on power-loss / disk-full. Pattern mirrors fs:applyEditOps (above) +
      // documentStore.atomicWrite — write to `<dest>.tmp`, then rename onto
      // `<dest>`. Rename is atomic on the same volume on every supported
      // filesystem (NTFS / APFS / ext4). Cross-volume falls back to a
      // copy-then-delete which is still atomic at the file level.
      writeFile: async (p, b) => {
        const tmp = `${p}.tmp`;
        await fsPromises.writeFile(tmp, b);
        try {
          await fsPromises.rename(tmp, p);
        } catch (renameErr) {
          // Best-effort cleanup of the temp; surface the original rename err.
          try {
            await fsPromises.unlink(tmp);
          } catch {
            /* ignore */
          }
          throw renameErr;
        }
      },
      // Phase 3.1 (B-3.1, David): concat-mode uses the `.pdf`-only sanitizer
      // (the output IS a .pdf file). Folder-mode uses sanitizeDirectoryPath
      // (the output is a directory) — this fixes the production bug where
      // every folder-mode mail-merge invocation returned `output_path_invalid`.
      sanitizePath: (raw) => sanitizePath(raw),
      sanitizeDirectoryPath: (raw) => sanitizeDirectoryPath(raw),
      joinPath: (a, b) => joinPath(a, b),
      emitProgress: (evt: MailMergeProgressEvent) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.send(Channels.MailMergeProgress, evt);
          } catch {
            /* renderer closed mid-run — drop the event */
          }
        }
      },
    }),
  );
  ipcMain.handle(Channels.FormsCancelMailMerge, (_evt, payload) =>
    handleFormsCancelMailMerge(payload),
  );

  // ============================================================================
  // Phase 4 (Wave 16) — signatures:* + annotations:* channels (api-contracts.md §14)
  //
  // Cert + password discipline (conventions §15): the load handler Buffer-
  // wraps the password at the EARLIEST synchronous point, overwrites
  // references, and delegates to cert-store.loadCert which zeroes both
  // buffers in a finally block. The apply-pades handler wraps the engine
  // call so the cert handle is auto-released on every exit path.
  //
  // app.before-quit → releaseAllCerts() guarantees no cert outlives the
  // process (R-W15-B in architecture-phase-4.md §8.1).
  // ============================================================================
  app.on('before-quit', () => {
    try {
      releaseAllCerts();
    } catch {
      /* never throw on shutdown */
    }
  });

  ipcMain.handle(Channels.SignaturesCertLoad, (_evt, payload) => handleSignaturesCertLoad(payload));
  ipcMain.handle(Channels.SignaturesCertRelease, (_evt, payload) =>
    handleSignaturesCertRelease(payload),
  );
  ipcMain.handle(Channels.SignaturesApplyVisual, (_evt, payload) =>
    handleSignaturesApplyVisual(payload, {
      getBytes: (h) => documentStore.getBytes(h),
      setBytes: (h, b) => documentStore.setBytes(h, b),
    }),
  );
  ipcMain.handle(Channels.SignaturesApplyPades, (_evt, payload) =>
    handleSignaturesApplyPades(payload, {
      getBytes: (h) => documentStore.getBytes(h),
      setBytes: (h, b) => documentStore.setBytes(h, b),
      auditLog: getDbBridge().signatureAudit,
    }),
  );
  ipcMain.handle(Channels.SignaturesRequestTimestamp, (_evt, payload) =>
    handleSignaturesRequestTimestamp(payload),
  );
  ipcMain.handle(Channels.SignaturesVerify, (_evt, payload) =>
    handleSignaturesVerify(payload, {
      getBytes: (h) => documentStore.getBytes(h),
      getAuditRow: (id) => getDbBridge().signatureAudit?.get(id) ?? null,
    }),
  );
  ipcMain.handle(Channels.SignaturesListAudit, (_evt, payload) =>
    handleSignaturesListAudit(payload, { repo: getDbBridge().signatureAudit }),
  );

  ipcMain.handle(Channels.AnnotationsAddShape, (_evt, payload) =>
    handleAnnotationsAddShape(payload, {
      getBytes: (h) => documentStore.getBytes(h),
      getPageCount: (h) => {
        const rec = documentStore.get(h);
        if (!rec) return null;
        // Phase 1 records the page count on register; fall back to null if
        // the field isn't set.
        return (rec as { pageCount?: number }).pageCount ?? null;
      },
    }),
  );
  ipcMain.handle(Channels.AnnotationsSetMeasureCalibration, (_evt, payload) =>
    handleAnnotationsSetMeasureCalibration(payload, {
      hasHandle: (h) => documentStore.get(h) !== null,
    }),
  );
  ipcMain.handle(Channels.AnnotationsGetMeasureCalibration, (_evt, payload) =>
    handleAnnotationsGetMeasureCalibration(payload, {
      hasHandle: (h) => documentStore.get(h) !== null,
    }),
  );

  const winDeps = { getWindow: () => browserWindowToWindowLike(getMainWindow()) };
  ipcMain.handle(Channels.WindowMinimize, (_evt, payload) =>
    handleWindowMinimize(payload ?? {}, winDeps),
  );
  ipcMain.handle(Channels.WindowMaximize, (_evt, payload) =>
    handleWindowMaximize(payload ?? {}, winDeps),
  );
  ipcMain.handle(Channels.WindowClose, (_evt, payload) =>
    handleWindowClose(payload ?? {}, winDeps),
  );
  ipcMain.handle(Channels.WindowGetState, (_evt, payload) =>
    handleWindowGetState(payload ?? {}, winDeps),
  );

  // ============================================================================
  // Phase 5 (Wave 20) — OCR + scan-* placeholder channels (api-contracts.md §16).
  //
  // Worker lifecycle non-negotiables (conventions §16.1):
  //   - releaseAll() on app.before-quit (and process.exit as belt-and-braces)
  //   - The pool is INJECTED via opts.ocr (REQUIRED — no fallback)
  //   - The pool is the single funnel into tesseract.js
  // ============================================================================

  // Hook 1: graceful shutdown on Electron's before-quit.
  app.on('before-quit', () => {
    void ocr.pool.releaseAll().catch(() => {
      /* never throw on shutdown */
    });
  });
  // Hook 2: last-line cleanup on raw process exit (covers crash / SIGTERM).
  // Synchronous-only listener; terminate() is async but we fire-and-forget.
  process.on('exit', () => {
    void ocr.pool.releaseAll().catch(() => {
      /* nothing we can do on exit */
    });
  });

  // Settings getter for the OCR detect-languages handler.
  const getSettingForOcr = <
    K extends Parameters<typeof getDbBridge>[never] extends never ? never : never,
  >(
    _k: K,
  ): never => undefined as never;
  void getSettingForOcr; // silence unused; we use the inline getter below

  ipcMain.handle(Channels.OcrDetectLanguages, (_evt, payload) =>
    handleOcrDetectLanguages(payload ?? {}, {
      languagePackManager: ocr.languagePackManager,
      getSetting: (key) => getDbBridge().settings.get(key),
    }),
  );

  // Helper: emit ocr:progress + ocr:languagePackDownload:progress events to
  // the renderer. Mirrors the mail-merge progress pattern (Phase 3).
  const emitOcrProgress = (evt: OcrProgressEvent): void => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(Channels.OcrProgress, evt);
      } catch {
        /* renderer closed mid-run — drop */
      }
    }
  };
  const emitLangPackProgress = (evt: OcrLanguagePackDownloadProgressEvent): void => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(Channels.OcrLanguagePackDownloadProgress, evt);
      } catch {
        /* renderer closed mid-run — drop */
      }
    }
  };

  ipcMain.handle(Channels.OcrRunOnPage, (_evt, payload) =>
    handleOcrRunOnPage(payload, {
      ocrPool: ocr.pool,
      languagePackManager: ocr.languagePackManager,
      rasterizePage: ocr.rasterizePage,
      getBytes: (h) => documentStore.getBytes(h),
      getPageCount: (h) => {
        const rec = documentStore.get(h);
        return rec ? rec.pageCount : null;
      },
      pageDimensions: ocr.pageDimensions,
      watchdogMs: ocr.watchdogMs,
      rasterDpi: ocr.rasterDpi,
    }),
  );

  ipcMain.handle(Channels.OcrRunOnDocument, (_evt, payload) =>
    handleOcrRunOnDocument(payload, {
      ocrPool: ocr.pool,
      languagePackManager: ocr.languagePackManager,
      rasterizePage: ocr.rasterizePage,
      pageDimensions: ocr.pageDimensions,
      composeSearchablePdf: (orig, results) =>
        ocr.composeSearchablePdf(orig, results as unknown as OcrPageResult[]),
      getBytes: (h) => documentStore.getBytes(h),
      getPageCount: (h) => documentStore.get(h)?.pageCount ?? null,
      getDocHash: (h) => documentStore.get(h)?.fileHash ?? null,
      setBytes: (h, b) => documentStore.setBytes(h, b),
      ocrJobsRepo: getDbBridge().ocrJobs,
      ocrResultsRepo: getDbBridge().ocrResults,
      signatureAudit: getDbBridge().signatureAudit
        ? {
            markInvalidatedByOcrJob: (docHash, fieldNames, ocrJobId) => {
              const repo = getDbBridge().signatureAudit;
              if (!repo) return 0;
              if (typeof repo.markInvalidatedByOcrJob === 'function') {
                return repo.markInvalidatedByOcrJob(docHash, fieldNames, ocrJobId);
              }
              // Memory-backed bridge doesn't implement the back-ref; best-effort no-op.
              return 0;
            },
          }
        : null,
      watchdogMs: ocr.watchdogMs,
      rasterDpi: ocr.rasterDpi,
      emitProgress: emitOcrProgress,
    }),
  );

  ipcMain.handle(Channels.OcrCancelJob, (_evt, payload) => handleOcrCancelJob(payload));

  ipcMain.handle(Channels.OcrListJobs, (_evt, payload) =>
    handleOcrListJobs(payload ?? {}, { repo: getDbBridge().ocrJobs }),
  );

  // Phase 5.2 (Marcus, 2026-06-04): per-job word-level result retrieval.
  ipcMain.handle(Channels.OcrListResultsByJob, (_evt, payload) =>
    handleOcrListResultsByJob(payload ?? {}, {
      jobsRepo: getDbBridge().ocrJobs,
      resultsRepo: getDbBridge().ocrResults,
    }),
  );

  ipcMain.handle(Channels.OcrLanguagePackDownload, (_evt, payload) =>
    handleOcrLanguagePackDownload(payload, {
      languagePackManager: ocr.languagePackManager,
      languagePacksRepo: getDbBridge().languagePacks,
      emitProgress: emitLangPackProgress,
    }),
  );

  ipcMain.handle(Channels.OcrLanguagePackRemove, (_evt, payload) =>
    handleOcrLanguagePackRemove(payload, {
      languagePackManager: ocr.languagePackManager,
      languagePacksRepo: getDbBridge().languagePacks,
    }),
  );

  // Phase 5.1 (Wave 5.1, David): scan channels are LIVE on Windows via the
  // native WIA addon. A null addon (non-Windows / addon not built) degrades to
  // a typed scanner_unavailable Result inside the handlers — never a crash.
  ipcMain.handle(Channels.ScanListDevices, (_evt, payload) =>
    handleScanListDevices(payload, { addon: scan.addon }),
  );
  ipcMain.handle(Channels.ScanAcquire, (_evt, payload) =>
    handleScanAcquire(payload, {
      addon: scan.addon,
      composeScanToPdf: scan.composeScanToPdf,
      registerScannedPdf: scan.registerScannedPdf,
    }),
  );

  // ============================================================================
  // Phase 6 (Wave 24) — export-to-Office channels (api-contracts.md §17).
  //
  // Discipline (conventions §17):
  //   - REQUIRED engine dep (no optional stub fallback)
  //   - Read-only on source — engine NEVER mutates source bytes
  //   - Bytes stay in main; renderer receives basename + dirHint only
  //   - LayoutRect nullable everywhere (no sentinel-zero defaults)
  // ============================================================================

  const emitExportProgress = (event: ExportProgressEvent): void => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(Channels.ExportProgress, event);
      } catch {
        /* renderer closed mid-run — drop the event */
      }
    }
  };

  const getMaxQueueSize = (): number => {
    // Phase 6 settings key (data-models.md §11.6); falls back to 50 if Ravi's
    // settings repo hasn't yet widened the SettingKey union to include it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (getDbBridge().settings.get as any)('export.maxQueueSize');
      if (typeof v === 'number' && v > 0 && v < 10_000) return v;
    } catch {
      /* fall through */
    }
    return 50;
  };

  // Phase 6.1 (Julian H-25.1): FIFO single-worker queue. Enforces concurrency=1
  // + same-output-path collision rejection at enqueue time. The engine still
  // runs the job; the queue owns scheduling + collision safety.
  const exportQueue = createExportQueue({
    engine: exportEngine,
    getMaxQueueSize,
  });

  const exportCommonDeps: ExportHandlerCommonDeps = {
    engine: exportEngine,
    queue: exportQueue,
    getBytes: (h) => documentStore.getBytes(h),
    getPageCount: (h) => documentStore.get(h)?.pageCount ?? null,
    getDocHash: (h) => documentStore.get(h)?.fileHash ?? null,
    exportJobsRepo: getDbBridge().exportJobs,
    emitProgress: emitExportProgress,
    getMaxQueueSize,
    // Count BOTH the running job and any queued jobs so the queue-full preflight
    // gate matches the queue's own cap (running + queued).
    getActiveJobCount: () => {
      const s = exportQueue.status();
      return (s.running !== null ? 1 : 0) + s.queued.length;
    },
  };

  ipcMain.handle(Channels.ExportToDocx, (_evt, payload) =>
    handleExportToDocx(payload, exportCommonDeps),
  );
  ipcMain.handle(Channels.ExportToXlsx, (_evt, payload) =>
    handleExportToXlsx(payload, exportCommonDeps),
  );
  ipcMain.handle(Channels.ExportToPptx, (_evt, payload) =>
    handleExportToPptx(payload, exportCommonDeps),
  );
  ipcMain.handle(Channels.ExportToImages, (_evt, payload) =>
    handleExportToImages(payload, exportCommonDeps),
  );
  ipcMain.handle(Channels.ExportCancelJob, (_evt, payload) =>
    handleExportCancelJob(payload, { queue: exportQueue }),
  );
  ipcMain.handle(Channels.ExportListJobs, (_evt, payload) =>
    handleExportListJobs(payload ?? {}, { repo: getDbBridge().exportJobs }),
  );
  ipcMain.handle(Channels.ExportListFormats, (_evt, payload) =>
    handleExportListFormats(payload ?? {}),
  );
  ipcMain.handle(Channels.DialogPickExportOutputPath, (_evt, payload) =>
    handleDialogPickExportOutputPath(payload, {
      showSaveDialog: async (saveOpts) => {
        const win = getMainWindow();
        return win ? dialog.showSaveDialog(win, saveOpts) : dialog.showSaveDialog(saveOpts);
      },
      sanitizePath: (raw) => sanitizePath(raw),
    }),
  );

  // ============================================================================
  // Phase 7 (Wave 28a) — auto-update + telemetry + i18n (api-contracts.md §18).
  //
  // Discipline:
  //   - REQUIRED injected `autoUpdate` controller + `telemetry` service (no
  //     optional stub fallback). The controller's progress emit + the
  //     electron-updater runtime-require live in `src/main/auto-update.ts`.
  //   - Telemetry NEVER logs the event payload (conventions §9 + §18.5); the
  //     handler does not log at all, and the `.strict()` zod schema is the
  //     structural PII guard.
  //   - i18n persistence flows through the EXISTING settings repo (no new
  //     table; data-models.md §12). The renderer owns the i18next runtime.
  // ============================================================================

  ipcMain.handle(Channels.UpdateCheck, (_evt, payload) =>
    handleUpdateCheck(payload, { controller: autoUpdate }),
  );
  ipcMain.handle(Channels.UpdateDownload, (_evt, payload) =>
    handleUpdateDownload(payload, { controller: autoUpdate }),
  );
  ipcMain.handle(Channels.UpdateInstall, (_evt, payload) =>
    handleUpdateInstall(payload, { controller: autoUpdate }),
  );

  ipcMain.handle(Channels.TelemetryRecordEvent, (_evt, payload) =>
    handleTelemetryRecordEvent(payload, { service: telemetry }),
  );
  ipcMain.handle(Channels.TelemetrySetOptIn, (_evt, payload) =>
    handleTelemetrySetOptIn(payload, { service: telemetry }),
  );
  ipcMain.handle(Channels.TelemetryGetStatus, (_evt, payload) =>
    handleTelemetryGetStatus(payload, { service: telemetry }),
  );

  ipcMain.handle(Channels.I18nSetLocale, (_evt, payload) =>
    handleI18nSetLocale(payload, {
      // Persist through the existing settings repo (data-models.md §12.2).
      persistLocale: (locale: AppLocale) => getDbBridge().settings.set('i18n.locale', locale),
    }),
  );
  ipcMain.handle(Channels.I18nGetAvailableLocales, (_evt, payload) =>
    handleI18nGetAvailableLocales(payload ?? {}),
  );

  // Phase 7.1 (David, 2026-06-05) — test-only `__test:seedOcrJob` channel.
  // STRUCTURAL GATE: `registerTestSeedOcrJob` early-returns when NODE_ENV is
  // not 'test'. In production the `ipcMain.handle(...)` is never called and
  // the channel is absent from the IPC surface. See
  // `src/ipc/handlers/test-seed-ocr-job.ts` for the rationale.
  registerTestSeedOcrJob({
    ipcMain,
    deps: {
      ocrJobsRepo: getDbBridge().ocrJobs,
      ocrResultsRepo: getDbBridge().ocrResults,
    },
  });

  // Phase 7.2 (David, 2026-06-10) — test-only `__test:whichBridge` channel.
  // STRUCTURAL GATE: `registerTestWhichBridge` early-returns when NODE_ENV is
  // not 'test'. Same shape as `__test:seedOcrJob` above — the channel is
  // absent from the production IPC surface by construction. The handler
  // reads the bridge-tag map written at `setDbBridge` time in
  // `src/main/index.ts`. See `src/ipc/handlers/test-which-bridge.ts`.
  registerTestWhichBridge({
    ipcMain,
    deps: {
      getKinds: () => getDbBridgeKinds(),
    },
  });

  // Phase 7.2 7.2.4 (Diego, 2026-06-10) — test-only `__test:seedSignatureAudit`
  // and `__test:listSignatureAudit` channels. STRUCTURAL GATE: each
  // `register*` function early-returns when NODE_ENV is not 'test'; the
  // channels are absent from the production IPC surface by construction.
  // Used by `tests/e2e/signed-pdf-ocr-invalidation.spec.ts` to seed the
  // pre-existing audit row that the production OCR run's
  // `markInvalidatedByOcrJob` call site will later mark, then read it back
  // for the post-OCR assertion. See `src/ipc/handlers/test-seed-signature-audit.ts`
  // and `src/ipc/handlers/test-list-signature-audit.ts` for the rationale.
  registerTestSeedSignatureAudit({
    ipcMain,
    deps: {
      signatureAuditRepo: getDbBridge().signatureAudit,
    },
  });
  registerTestListSignatureAudit({
    ipcMain,
    deps: {
      signatureAuditRepo: getDbBridge().signatureAudit,
    },
  });
}
