// @vitest-environment node
//
// Phase 7 (Wave 28a, David) — auto-update controller tests.
//
// Contract pins (architecture-phase-7.md §3 + api-contracts.md §18.1-§18.3):
//   - PLACEHOLDER publish target => update_not_configured (NOT fake up-to-date)
//   - missing electron-updater package => update_not_configured (no crash)
//   - check: available / up-to-date / network_failed / feed_parse_failed
//   - check stamps + persists lastCheckedAt (when a check actually runs)
//   - download guards the requested version against the last 'available' check
//   - download surfaces signature_verification_failed (cert dependency)
//   - install guards the version against the downloaded version
//   - progress events flow through emitProgress
//   - isPublishConfiguredFromAppUpdateYml: placeholder vs real feed

import { describe, expect, it, vi } from 'vitest';

import type { UpdateProgressEvent } from '../ipc/contracts.js';

import {
  createAutoUpdateController,
  isPublishConfiguredFromAppUpdateYml,
  type AutoUpdateDeps,
  type ElectronAutoUpdater,
  type ElectronUpdaterCheckResult,
  type ElectronUpdaterModule,
  type ElectronUpdaterProgress,
  type UpdateProgressEventListener,
} from './auto-update.js';

// ---- A controllable synthetic electron-updater ----------------------------

interface FakeUpdaterControls {
  updater: ElectronAutoUpdater;
  module: ElectronUpdaterModule;
  emitProgress: (p: ElectronUpdaterProgress) => void;
  installCalled: () => boolean;
}

function makeFakeUpdater(opts: {
  checkResult?: ElectronUpdaterCheckResult | null;
  checkThrows?: Error;
  downloadThrows?: Error;
}): FakeUpdaterControls {
  let progressListener: ((p: ElectronUpdaterProgress) => void) | null = null;
  let availableListener: ((i: { version: string }) => void) | null = null;
  let downloadedListener: ((i: { version: string }) => void) | null = null;
  let installed = false;

  const updater: ElectronAutoUpdater = {
    autoDownload: true, // controller MUST flip this to false
    autoInstallOnAppQuit: true,
    checkForUpdates: async () => {
      if (opts.checkThrows) throw opts.checkThrows;
      const res = opts.checkResult ?? null;
      if (res && (res.isUpdateAvailable ?? false) && availableListener) {
        availableListener({ version: res.updateInfo.version });
      }
      return res;
    },
    downloadUpdate: async () => {
      if (opts.downloadThrows) throw opts.downloadThrows;
      if (downloadedListener && opts.checkResult) {
        downloadedListener({ version: opts.checkResult.updateInfo.version });
      }
      return ['/tmp/update.bin'];
    },
    quitAndInstall: () => {
      installed = true;
    },
    on: ((event: string, listener: UpdateProgressEventListener) => {
      if (event === 'download-progress') {
        progressListener = listener as (p: ElectronUpdaterProgress) => void;
      } else if (event === 'update-available') {
        availableListener = listener as (i: { version: string }) => void;
      } else if (event === 'update-downloaded') {
        downloadedListener = listener as (i: { version: string }) => void;
      }
    }) as ElectronAutoUpdater['on'],
    removeAllListeners: () => {
      /* no-op */
    },
  };
  return {
    updater,
    module: { autoUpdater: updater },
    emitProgress: (p) => progressListener?.(p),
    installCalled: () => installed,
  };
}

function makeDeps(overrides: Partial<AutoUpdateDeps> & { fake?: FakeUpdaterControls }): {
  deps: AutoUpdateDeps;
  persisted: number[];
  progress: UpdateProgressEvent[];
} {
  const persisted: number[] = [];
  const progress: UpdateProgressEvent[] = [];
  const deps: AutoUpdateDeps = {
    loadUpdater: () => overrides.fake?.module ?? null,
    isPublishConfigured: () => true,
    getCurrentVersion: () => '1.0.0',
    now: () => 12_345,
    persistLastCheckedAt: (ts) => persisted.push(ts),
    emitProgress: (e) => progress.push(e),
    scheduleInstall: (fn) => fn(), // run synchronously in tests
    ...overrides,
  };
  return { deps, persisted, progress };
}

describe('createAutoUpdateController — not-configured (placeholder)', () => {
  it('returns update_not_configured for check when publish target is a placeholder', async () => {
    const { deps } = makeDeps({ isPublishConfigured: () => false });
    const c = createAutoUpdateController(deps);
    const r = await c.checkForUpdates({ trigger: 'explicit' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('update_not_configured');
  });

  it('returns update_not_configured (NOT a crash) when electron-updater is missing', async () => {
    // loadUpdater returns null (package not installed) + publish "configured":
    // the controller must still route to update_not_configured gracefully.
    const { deps } = makeDeps({ loadUpdater: () => null });
    const c = createAutoUpdateController(deps);
    const r = await c.checkForUpdates({ trigger: 'launch' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('update_not_configured');
  });

  it('does NOT stamp lastCheckedAt when not configured (no check ran)', async () => {
    const { deps, persisted } = makeDeps({ isPublishConfigured: () => false });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    expect(persisted).toEqual([]);
  });

  it('download returns update_not_configured when placeholder', async () => {
    const { deps } = makeDeps({ isPublishConfigured: () => false });
    const c = createAutoUpdateController(deps);
    const r = await c.downloadUpdate({ version: '2.0.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('update_not_configured');
  });
});

describe('createAutoUpdateController — check outcomes', () => {
  it('reports available + availableVersion when an update exists', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const { deps, persisted } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    const r = await c.checkForUpdates({ trigger: 'explicit' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('available');
      expect(r.value.availableVersion).toBe('2.0.0');
      expect(r.value.currentVersion).toBe('1.0.0');
      expect(r.value.lastCheckedAt).toBe(12_345);
    }
    expect(persisted).toEqual([12_345]); // a check ran => timestamp stamped
  });

  it('reports up-to-date + null availableVersion when no update', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '1.0.0' }, isUpdateAvailable: false },
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    const r = await c.checkForUpdates({ trigger: 'explicit' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('up-to-date');
      expect(r.value.availableVersion).toBeNull(); // NO sentinel ''
    }
  });

  it('maps a network error to network_failed (timestamp still stamped)', async () => {
    const fake = makeFakeUpdater({ checkThrows: new Error('ETIMEDOUT connecting to feed') });
    const { deps, persisted } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    const r = await c.checkForUpdates({ trigger: 'explicit' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('network_failed');
    expect(persisted).toEqual([12_345]);
  });

  it('maps a parse error to feed_parse_failed', async () => {
    const fake = makeFakeUpdater({ checkThrows: new Error('failed to parse latest.yml') });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    const r = await c.checkForUpdates({ trigger: 'explicit' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('feed_parse_failed');
  });

  it('flips autoDownload OFF on the updater (downloads are user-initiated)', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: false },
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    expect(fake.updater.autoDownload).toBe(false);
    expect(fake.updater.autoInstallOnAppQuit).toBe(false);
  });
});

describe('createAutoUpdateController — download', () => {
  it('rejects download when there is no prior available check (no_update_available)', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: false },
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    const r = await c.downloadUpdate({ version: '2.0.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_update_available');
  });

  it('rejects a stale version mismatch (no_update_available)', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' }); // available = 2.0.0
    const r = await c.downloadUpdate({ version: '3.0.0' }); // stale UI
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_update_available');
  });

  it('downloads successfully when the version matches the available check', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    const r = await c.downloadUpdate({ version: '2.0.0' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('downloaded');
      expect(r.value.version).toBe('2.0.0');
    }
  });

  it('surfaces signature_verification_failed (cert dependency P7-L-2 §3.5)', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
      downloadThrows: new Error('sha512 checksum mismatch — bundle not signed'),
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    const r = await c.downloadUpdate({ version: '2.0.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('signature_verification_failed');
  });

  it('maps a generic download error to download_failed', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
      downloadThrows: new Error('connection reset'),
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    const r = await c.downloadUpdate({ version: '2.0.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('download_failed');
  });

  it('emits update:onProgress events during a download', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const { deps, progress } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    fake.emitProgress({ percent: 42, bytesPerSecond: 1000, transferred: 420, total: 1000 });
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ version: '2.0.0', percent: 42, total: 1000 });
  });
});

describe('createAutoUpdateController — install', () => {
  it('rejects install when nothing was downloaded (no_downloaded_update)', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    const r = await c.quitAndInstall({ version: '2.0.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_downloaded_update');
  });

  it('quits and installs after a matching download (ok before quit)', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    await c.downloadUpdate({ version: '2.0.0' });
    const r = await c.quitAndInstall({ version: '2.0.0' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.quitting).toBe(true);
    expect(fake.installCalled()).toBe(true);
  });

  it('rejects an install version mismatch', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const { deps } = makeDeps({ fake });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    await c.downloadUpdate({ version: '2.0.0' });
    const r = await c.quitAndInstall({ version: '9.9.9' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_downloaded_update');
  });

  it('schedules quitAndInstall on the next tick (ok returns before quit)', async () => {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const scheduled: Array<() => void> = [];
    const { deps } = makeDeps({ fake, scheduleInstall: (fn) => scheduled.push(fn) });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    await c.downloadUpdate({ version: '2.0.0' });
    const r = await c.quitAndInstall({ version: '2.0.0' });
    expect(r.ok).toBe(true);
    // ok() returned BUT the quit has not happened yet (still queued).
    expect(fake.installCalled()).toBe(false);
    scheduled.forEach((fn) => fn());
    expect(fake.installCalled()).toBe(true);
  });
});

describe('createAutoUpdateController — unsaved-work install gate (H-29.1)', () => {
  async function downloadedController(extra: Partial<AutoUpdateDeps>) {
    const fake = makeFakeUpdater({
      checkResult: { updateInfo: { version: '2.0.0' }, isUpdateAvailable: true },
    });
    const { deps } = makeDeps({ fake, ...extra });
    const c = createAutoUpdateController(deps);
    await c.checkForUpdates({ trigger: 'explicit' });
    await c.downloadUpdate({ version: '2.0.0' });
    return { c, fake };
  }

  it('refuses install with unsaved work + no confirmation (unsaved_work_blocks_install)', async () => {
    const { c, fake } = await downloadedController({ hasUnsavedWork: () => true });
    const r = await c.quitAndInstall({ version: '2.0.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsaved_work_blocks_install');
    // The quit MUST NOT have been scheduled/executed — no data loss.
    expect(fake.installCalled()).toBe(false);
  });

  it('proceeds when unsaved work is explicitly confirmed for discard', async () => {
    const { c, fake } = await downloadedController({ hasUnsavedWork: () => true });
    const r = await c.quitAndInstall({ version: '2.0.0', confirmedDiscardUnsaved: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.quitting).toBe(true);
    expect(fake.installCalled()).toBe(true);
  });

  it('proceeds directly when there is no unsaved work (no confirmation needed)', async () => {
    const { c, fake } = await downloadedController({ hasUnsavedWork: () => false });
    const r = await c.quitAndInstall({ version: '2.0.0' });
    expect(r.ok).toBe(true);
    expect(fake.installCalled()).toBe(true);
  });

  it('treats an omitted hasUnsavedWork dep as "no unsaved work" (gate no-op)', async () => {
    // makeDeps does not inject hasUnsavedWork → the controller must not crash and
    // must proceed (the optional dep defaults to "no unsaved work").
    const { c, fake } = await downloadedController({});
    const r = await c.quitAndInstall({ version: '2.0.0' });
    expect(r.ok).toBe(true);
    expect(fake.installCalled()).toBe(true);
  });

  it('version-mismatch still wins over the unsaved-work gate (more fundamental)', async () => {
    const { c } = await downloadedController({ hasUnsavedWork: () => true });
    const r = await c.quitAndInstall({ version: '9.9.9' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_downloaded_update');
  });

  it('not-configured still wins over the unsaved-work gate', async () => {
    const { deps } = makeDeps({ isPublishConfigured: () => false, hasUnsavedWork: () => true });
    const c = createAutoUpdateController(deps);
    const r = await c.quitAndInstall({ version: '2.0.0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_downloaded_update');
  });
});

describe('isPublishConfiguredFromAppUpdateYml', () => {
  it('returns false when the yml is missing', () => {
    expect(isPublishConfiguredFromAppUpdateYml(() => null)).toBe(false);
  });

  it('returns false for the documented PLACEHOLDER block', () => {
    const yml = 'provider: github\nowner: PLACEHOLDER\nrepo: PLACEHOLDER\n';
    expect(isPublishConfiguredFromAppUpdateYml(() => yml)).toBe(false);
  });

  it('returns true for a real github provider block', () => {
    const yml = 'provider: github\nowner: acme-corp\nrepo: pdf-viewer-editor\n';
    expect(isPublishConfiguredFromAppUpdateYml(() => yml)).toBe(true);
  });

  it('uses vi without leaking — sanity that the helper is pure', () => {
    const spy = vi.fn(() => null as string | null);
    isPublishConfiguredFromAppUpdateYml(spy);
    expect(spy).toHaveBeenCalledOnce();
  });
});
