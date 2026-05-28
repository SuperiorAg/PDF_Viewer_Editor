// Phase 7 — auto-update controller (electron-updater integration).
//
// ARCHITECTURE: architecture-phase-7.md §3 (P7-L-2) + api-contracts.md §18.1-§18.3.
//
// BOOTSTRAP PATH (read first — Playbook discipline):
//   This module is the REQUIRED auto-updater the IPC registrar injects (no
//   optional fallback). `src/main/index.ts` STATICALLY imports
//   `createAutoUpdateController` and passes the instance to
//   `registerIpcHandlers({ ..., autoUpdate })`. The heavy/optional native dep
//   `electron-updater` is loaded via a runtime `require` INSIDE `ensureUpdater()`
//   — NOT a top-level import — so:
//     1. The main bundle resolves and builds BEFORE Diego installs the dep in
//        Wave 29 (the require throws at first call, not at import time).
//     2. The factory module itself is statically imported, so Vite does NOT
//        tree-shake it out of the main bundle (the Phase 6.1 runtime-require
//        RCA: `.learnings/failures/2026-05-27-runtime-require-vite-tree-shake-
//        packaging-gap.md`). This mirrors `ocr-bootstrap.ts` /
//        `export-bootstrap.ts` exactly.
//
// HONESTY (P7-L-2 trust-floor obligation #2): the GitHub releases publish
// target is a documented PLACEHOLDER (`owner/repo: PLACEHOLDER` in
// electron-builder.yml — Diego Wave 29). The controller detects the placeholder
// (or a missing electron-updater package, or a missing feed config) and routes
// EVERY update call to an explicit `update_not_configured` Result — NEVER a
// fake "up-to-date". This is the anti-stub discipline applied to config.
//
// CRASH-SAFETY: no method throws across the IPC boundary. Every failure mode
// (missing package, unreachable feed, parse error, signature failure) is a
// typed discriminated Result the renderer surfaces honestly.

import type {
  UpdateCheckError,
  UpdateCheckRequest,
  UpdateCheckResponse,
  UpdateCheckValue,
  UpdateDownloadError,
  UpdateDownloadRequest,
  UpdateDownloadResponse,
  UpdateInstallError,
  UpdateInstallRequest,
  UpdateInstallResponse,
  UpdateProgressEvent,
} from '../ipc/contracts.js';
import { fail, ok } from '../shared/result.js';

// ----------------------------------------------------------------------------
// The minimal electron-updater surface we use. Typed structurally so we never
// take a compile-time dependency on the `electron-updater` package (Diego
// installs it Wave 29). At runtime, `loadElectronUpdater()` casts the required
// module to this shape.
// ----------------------------------------------------------------------------

export interface ElectronUpdaterInfo {
  version: string;
}

export interface ElectronUpdaterProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface ElectronUpdaterCheckResult {
  /** electron-updater returns `updateInfo` even when no update is available. */
  updateInfo: ElectronUpdaterInfo;
  /**
   * Present (non-null) when an update IS available + will download.
   * electron-updater sets this to the download promise when autoDownload is on;
   * we keep autoDownload OFF (downloads are user-initiated) so we rely on the
   * version comparison below instead.
   */
  isUpdateAvailable?: boolean;
}

export interface ElectronAutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  currentVersion?: { version: string };
  checkForUpdates(): Promise<ElectronUpdaterCheckResult | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'download-progress', listener: (p: ElectronUpdaterProgress) => void): void;
  on(event: 'update-available', listener: (i: ElectronUpdaterInfo) => void): void;
  on(event: 'update-downloaded', listener: (i: ElectronUpdaterInfo) => void): void;
  on(event: 'error', listener: (e: Error) => void): void;
  removeAllListeners(event?: string): void;
}

export interface ElectronUpdaterModule {
  autoUpdater: ElectronAutoUpdater;
}

/**
 * The union of listener signatures `autoUpdater.on(...)` accepts. Exported so
 * tests can build a single synthetic `on` implementation without re-deriving
 * the overload set.
 */
export type UpdateProgressEventListener =
  | ((p: ElectronUpdaterProgress) => void)
  | ((i: ElectronUpdaterInfo) => void)
  | ((e: Error) => void);

// ----------------------------------------------------------------------------
// Controller dependencies (injected — testable + no Electron import here).
// ----------------------------------------------------------------------------

export interface AutoUpdateDeps {
  /**
   * Loads the real `electron-updater` module. Production passes
   * `loadElectronUpdaterModule` (runtime require). Tests inject a synthetic.
   * Returns null when the package is not installed (pre-Wave-29) — the
   * controller treats that identically to a placeholder publish target.
   */
  loadUpdater: () => ElectronUpdaterModule | null;
  /**
   * Returns true when the publish target is a real configured feed, false when
   * it is the documented PLACEHOLDER (owner/repo === 'PLACEHOLDER'). Production
   * derives this from electron-builder's bundled `app-update.yml`; tests inject.
   * When the package is missing OR this returns false, every call is
   * `update_not_configured`.
   */
  isPublishConfigured: () => boolean;
  /** app.getVersion(). Injected to avoid an Electron import in this module. */
  getCurrentVersion: () => string;
  /** Now, ms epoch. Injected for deterministic tests. */
  now: () => number;
  /** Persist the last-check timestamp to settings (`update.lastCheckedAt`). */
  persistLastCheckedAt: (ts: number) => void;
  /** Emit an update:onProgress event to the renderer. */
  emitProgress: (evt: UpdateProgressEvent) => void;
  /** Schedule quitAndInstall on the next tick (so ok() returns first). */
  scheduleInstall: (fn: () => void) => void;
  /**
   * Unsaved-work probe for the install gate (Phase 7.1 — Julian H-29.1).
   * Returns true when the active document has unsaved edits/annotations/
   * signatures (the renderer's dirty state). Production wires this to a
   * main-side mirror of the renderer dirty flag (or a synchronous query of the
   * focused window); tests inject. When this returns true and the install
   * request did NOT set `confirmedDiscardUnsaved`, quitAndInstall refuses with
   * `unsaved_work_blocks_install` rather than discarding work.
   *
   * Optional so existing callers that genuinely cannot lose work (or that gate
   * on the renderer side before calling) stay valid; when omitted, the gate is
   * a no-op (treated as "no unsaved work"). Production MUST inject it.
   */
  hasUnsavedWork?: () => boolean;
}

export interface AutoUpdateController {
  checkForUpdates(req: UpdateCheckRequest): Promise<UpdateCheckResponse>;
  downloadUpdate(req: UpdateDownloadRequest): Promise<UpdateDownloadResponse>;
  quitAndInstall(req: UpdateInstallRequest): Promise<UpdateInstallResponse>;
}

// ----------------------------------------------------------------------------
// Controller implementation.
// ----------------------------------------------------------------------------

export function createAutoUpdateController(deps: AutoUpdateDeps): AutoUpdateController {
  // Internal state — nullable + late-init per the anti-sentinel discipline.
  // `availableVersion` is null until a check reports an available update;
  // `downloadedVersion` is null until a download completes. These guard
  // stale-UI version mismatches on download/install.
  let availableVersion: string | null = null;
  let downloadedVersion: string | null = null;
  let listenersWired = false;

  /**
   * Resolve the configured updater, or null when updates are NOT configured.
   * "Not configured" covers BOTH the missing-package case (pre-Wave-29) and
   * the placeholder publish target. Returns null in either case so callers
   * uniformly route to `update_not_configured`.
   */
  function ensureUpdater(): ElectronAutoUpdater | null {
    if (!deps.isPublishConfigured()) return null;
    const mod = deps.loadUpdater();
    if (mod === null) return null;
    const updater = mod.autoUpdater;
    // Downloads are NEVER automatic (P7-L-2 §3.4 / Q-C). Every download is
    // user-initiated via update:download.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    if (!listenersWired) {
      updater.on('download-progress', (p) => {
        deps.emitProgress({
          version: availableVersion ?? deps.getCurrentVersion(),
          percent: p.percent,
          bytesPerSecond: p.bytesPerSecond,
          transferred: p.transferred,
          total: p.total,
        });
      });
      updater.on('update-available', (i) => {
        availableVersion = i.version;
      });
      updater.on('update-downloaded', (i) => {
        downloadedVersion = i.version;
      });
      updater.on('error', () => {
        /* errors are surfaced via the awaited promise rejection; no-op here */
      });
      listenersWired = true;
    }
    return updater;
  }

  async function checkForUpdates(req: UpdateCheckRequest): Promise<UpdateCheckResponse> {
    // `trigger` is validated by the handler's zod schema; we accept it here.
    void req;
    const updater = ensureUpdater();
    const currentVersion = deps.getCurrentVersion();
    if (updater === null) {
      // HONEST not-configured (P7-L-2 obligation #2): an explicit error, NOT a
      // fake up-to-date. The renderer maps `update_not_configured` to UI status
      // 'not-configured' + the About-modal placeholder notice. We do NOT stamp
      // lastCheckedAt — no check actually ran.
      void currentVersion;
      return fail<UpdateCheckError>(
        'update_not_configured',
        'No update channel configured. The publish target is a placeholder until the project is published (a real release channel is required for updates to function).',
      );
    }
    const ts = deps.now();
    try {
      const result = await updater.checkForUpdates();
      // A check ran: stamp + persist the timestamp regardless of outcome.
      deps.persistLastCheckedAt(ts);
      const updateAvailable = isUpdateNewer(result, currentVersion);
      if (updateAvailable && result) {
        availableVersion = result.updateInfo.version;
        return ok<UpdateCheckValue>({
          status: 'available',
          availableVersion: result.updateInfo.version,
          currentVersion,
          lastCheckedAt: ts,
        });
      }
      availableVersion = null;
      return ok<UpdateCheckValue>({
        status: 'up-to-date',
        availableVersion: null,
        currentVersion,
        lastCheckedAt: ts,
      });
    } catch (e) {
      // Persist the timestamp (a check attempt happened) but report the error.
      deps.persistLastCheckedAt(ts);
      const err = e as Error;
      const variant: UpdateCheckError = /parse|yaml|ENOENT|invalid/i.test(err.message)
        ? 'feed_parse_failed'
        : 'network_failed';
      return fail<UpdateCheckError>(variant, err.message);
    }
  }

  async function downloadUpdate(req: UpdateDownloadRequest): Promise<UpdateDownloadResponse> {
    const updater = ensureUpdater();
    if (updater === null) {
      return fail<UpdateDownloadError>(
        'update_not_configured',
        'No update channel configured (publish target is a placeholder).',
      );
    }
    // Guard stale UI: the requested version must match the last available check.
    if (availableVersion === null || req.version !== availableVersion) {
      return fail<UpdateDownloadError>(
        'no_update_available',
        `No available update matching version ${req.version} (last available: ${
          availableVersion ?? 'none'
        }).`,
      );
    }
    try {
      await updater.downloadUpdate();
      downloadedVersion = req.version;
      return ok<UpdateDownloadValueShape>({ status: 'downloaded', version: req.version });
    } catch (e) {
      const err = e as Error;
      // electron-updater throws a signature-verification error when the bundle
      // is not signed by a trusted cert (cert dependency; P7-L-2 §3.5).
      const variant: UpdateDownloadError = /signature|sha512|checksum|not signed/i.test(err.message)
        ? 'signature_verification_failed'
        : 'download_failed';
      return fail<UpdateDownloadError>(variant, err.message);
    }
  }

  async function quitAndInstall(req: UpdateInstallRequest): Promise<UpdateInstallResponse> {
    const updater = ensureUpdater();
    if (updater === null) {
      return fail<UpdateInstallError>(
        'no_downloaded_update',
        'No update channel configured; nothing to install.',
      );
    }
    if (downloadedVersion === null || req.version !== downloadedVersion) {
      return fail<UpdateInstallError>(
        'no_downloaded_update',
        `No downloaded update matching version ${req.version} (downloaded: ${
          downloadedVersion ?? 'none'
        }).`,
      );
    }
    // UNSAVED-WORK GATE (Phase 7.1 — Julian H-29.1, data-loss prevention).
    //
    // quitAndInstall restarts the app to apply the update — any unsaved edits,
    // annotations, or signatures in the active document are lost when the
    // process exits. Mirror the OCR-invalidates-PAdES confirm discipline: if
    // there is unsaved work AND the user has NOT explicitly confirmed
    // discarding it, REFUSE with a typed `unsaved_work_blocks_install` so the
    // renderer can present a Save / Discard-and-install / Cancel dialog and
    // retry with `confirmedDiscardUnsaved: true`. We check this AFTER the
    // configured + version-match guards (those are more fundamental failures)
    // but BEFORE scheduling the irreversible quit.
    if (req.confirmedDiscardUnsaved !== true && (deps.hasUnsavedWork?.() ?? false)) {
      return fail<UpdateInstallError>(
        'unsaved_work_blocks_install',
        'There are unsaved changes. Save or explicitly discard them before installing the update (the install restarts the app and would lose unsaved work).',
      );
    }
    try {
      // Schedule the actual quit on the next tick so the ok() Result reaches
      // the renderer before the process exits (api-contracts.md §18.3).
      deps.scheduleInstall(() => updater.quitAndInstall());
      return ok<UpdateInstallValueShape>({ quitting: true });
    } catch (e) {
      return fail<UpdateInstallError>('install_failed', (e as Error).message);
    }
  }

  return { checkForUpdates, downloadUpdate, quitAndInstall };
}

// Local value-shape aliases (avoid importing the response types twice).
type UpdateDownloadValueShape = { status: 'downloaded'; version: string };
type UpdateInstallValueShape = { quitting: true };

/**
 * Compare the check result's version against the running version. electron-
 * updater's `isUpdateAvailable` is the authoritative signal when present;
 * otherwise we fall back to a string-inequality heuristic (the feed only
 * advertises a newer version, so `!==` is a safe "there is something to get").
 */
function isUpdateNewer(result: ElectronUpdaterCheckResult | null, currentVersion: string): boolean {
  if (!result) return false;
  if (typeof result.isUpdateAvailable === 'boolean') return result.isUpdateAvailable;
  return result.updateInfo.version !== currentVersion;
}

// ----------------------------------------------------------------------------
// Production loaders — STATIC export, runtime require inside (Diego Wave 29).
// ----------------------------------------------------------------------------

/**
 * Load the real `electron-updater` module. Returns null when the package is
 * not installed (pre-Wave-29). The module name is built indirectly so a future
 * webpack/Vite bundle on the main process does not try to statically resolve
 * it at bundle time (mirrors `ocr-bootstrap.ts:loadPdfJs`).
 */
export function loadElectronUpdaterModule(): ElectronUpdaterModule | null {
  try {
    const moduleName = 'electron' + '-updater';
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const mod = require(moduleName) as ElectronUpdaterModule;
    return mod;
  } catch {
    // Not installed yet — treated identically to a placeholder publish target.
    return null;
  }
}

/**
 * Detect whether the bundled `app-update.yml` (emitted by electron-builder from
 * the `publish` block) points at a real feed or the documented placeholder.
 * Production reads the YAML; here we conservatively look for the literal
 * 'PLACEHOLDER' owner/repo that architecture-phase-7.md §3.2 mandates.
 *
 * Returns false (NOT configured) when the file is missing OR contains the
 * placeholder — both route to the honest `update_not_configured` path.
 */
export function isPublishConfiguredFromAppUpdateYml(
  readAppUpdateYml: () => string | null,
): boolean {
  const raw = readAppUpdateYml();
  if (raw === null) return false;
  // The placeholder block is `owner: PLACEHOLDER` / `repo: PLACEHOLDER`.
  if (/PLACEHOLDER/i.test(raw)) return false;
  // A real GitHub provider block names a concrete owner + repo.
  return /provider:\s*github/i.test(raw) && /owner:\s*\S+/i.test(raw);
}
