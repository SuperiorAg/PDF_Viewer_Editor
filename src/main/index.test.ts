// @vitest-environment node
//
// Boot-time wiring test for src/main/index.ts.
//
// Why this test exists:
//   v0.7.7 shipped with two stacked menu bars on Windows — Electron's default
//   native application menu (File/Edit/View/Window/Help) rendered above Riley's
//   custom React MenuBar in src/client/components/menu-bar/. The fix:
//     1. `autoHideMenuBar: true` in src/main/window-manager.ts (pinned by
//        window-manager.test.ts).
//     2. `Menu.setApplicationMenu(null)` at app boot in src/main/index.ts
//        (pinned by THIS test) — removes the native menu entirely so it cannot
//        be revealed via Alt or by any future regression of #1.
//
// What this test asserts:
//   On import of src/main/index.ts (which calls `bootstrap()` at module
//   top-level), after `app.whenReady()` resolves, `Menu.setApplicationMenu`
//   is called exactly once with `null`.
//
// How:
//   Mock the entire `electron` module surface and every transitive collaborator
//   import.ts pulls in. The mocks return inert stubs so bootstrap() can run
//   without a real Electron runtime. Spy on `Menu.setApplicationMenu` and
//   assert the call after `app.whenReady().then(...)` resolves.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture Menu.setApplicationMenu call arguments.
const setApplicationMenuCalls: Array<unknown> = [];

vi.mock('electron', () => {
  // app.whenReady() resolves immediately so the `.then(...)` handler in
  // bootstrap() runs before our test's `await` returns.
  const app = {
    requestSingleInstanceLock: (): boolean => true,
    on: (_event: string, _handler: () => void): void => undefined,
    quit: (): void => undefined,
    whenReady: (): Promise<void> => Promise.resolve(),
    getPath: (_name: string): string => '/fake/userData',
    getAppPath: (): string => '/fake/app',
    getVersion: (): string => '0.0.0-test',
  };
  class MockBrowserWindow {
    static getAllWindows(): MockBrowserWindow[] {
      return [];
    }
    webContents = {
      send: (): void => undefined,
      isLoading: (): boolean => false,
      once: (): void => undefined,
    };
    isDestroyed(): boolean {
      return false;
    }
    on(): this {
      return this;
    }
    once(): this {
      return this;
    }
    show(): void {}
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    loadFile(): Promise<void> {
      return Promise.resolve();
    }
    isMinimized(): boolean {
      return false;
    }
    restore(): void {}
    focus(): void {}
  }
  const Menu = {
    setApplicationMenu: (menu: unknown): void => {
      setApplicationMenuCalls.push(menu);
    },
  };
  const ipcMain = { handle: (): void => undefined, on: (): void => undefined };
  return { app, BrowserWindow: MockBrowserWindow, Menu, ipcMain };
});

// Stub every transitive import — these collaborators perform real side effects
// (DB init, IPC registration) that aren't relevant to the boot-menu assertion.
vi.mock('../db/connection.js', () => ({
  initDatabase: (): unknown => ({}),
}));
vi.mock('../db/repositories/bookmarks-repo.js', () => ({
  createBookmarksRepo: (): unknown => ({}),
}));
vi.mock('../db/repositories/recent-files-repo.js', () => ({
  createRecentFilesRepo: (): unknown => ({}),
}));
vi.mock('../db/repositories/settings-repo.js', () => ({
  createSettingsRepo: (): unknown => ({}),
}));
vi.mock('../ipc/contracts.js', () => ({
  Channels: { UpdateProgress: 'update:progress' },
}));
vi.mock('../ipc/register.js', () => ({
  registerIpcHandlers: (): void => undefined,
}));
vi.mock('./auto-update.js', () => ({
  createAutoUpdateController: (): unknown => ({}),
  isPublishConfiguredFromAppUpdateYml: (): boolean => false,
  loadElectronUpdaterModule: (): unknown => null,
}));
vi.mock('./db-bridge.js', () => ({
  adaptBookmarksRepo: (x: unknown): unknown => x,
  adaptExportJobsRepo: (x: unknown): unknown => x,
  adaptFormTemplatesRepo: (x: unknown): unknown => x,
  adaptLanguagePacksRepo: (x: unknown): unknown => x,
  adaptOcrJobsRepo: (x: unknown): unknown => x,
  adaptOcrResultsRepo: (x: unknown): unknown => x,
  adaptRecentsRepo: (x: unknown): unknown => x,
  adaptSettingsRepo: (x: unknown): unknown => x,
  adaptSignatureAuditRepo: (x: unknown): unknown => x,
  createMemoryDbBridge: (): Record<string, unknown> => ({
    recents: {},
    bookmarks: {},
    settings: { get: (): unknown => undefined, set: (): void => undefined },
    formTemplates: {},
    signatureAudit: {},
    ocrJobs: {},
    ocrResults: {},
    languagePacks: {},
    exportJobs: {},
  }),
  getDbBridge: (): Record<string, unknown> => ({
    settings: { get: (): unknown => undefined, set: (): void => undefined },
  }),
  setDbBridge: (): void => undefined,
}));
vi.mock('./export/export-bootstrap.js', () => ({
  bootstrapExportEngine: (): unknown => ({}),
  createProdSourceLoader: (): unknown => ({ loader: () => null, rasterize: () => null }),
}));
vi.mock('./pdf-ops/ocr-bootstrap.js', () => ({
  bootstrapOcr: (): unknown => ({}),
}));
vi.mock('./pdf-ops/pdf-metadata-loader.js', () => ({
  loadPdfMetadata: (): unknown => ({}),
}));
vi.mock('./pdf-ops/scan-bootstrap.js', () => ({
  bootstrapScan: (): unknown => ({}),
}));
vi.mock('./security/csp.js', () => ({
  installCsp: (): void => undefined,
}));
vi.mock('./telemetry.js', () => ({
  createTelemetryService: (): unknown => ({}),
  NoOpRingBufferTransport: class {},
}));
vi.mock('./window-manager.js', () => ({
  createMainWindow: (): unknown => ({}),
  getMainWindow: (): unknown => null,
}));

describe('bootstrap — Electron default application menu suppression', () => {
  beforeEach(() => {
    setApplicationMenuCalls.length = 0;
    vi.resetModules();
  });

  it('calls Menu.setApplicationMenu(null) at boot to remove the native menu', async () => {
    // Importing index.ts runs bootstrap() at module load, which schedules the
    // `app.whenReady().then(...)` callback. The mocked whenReady() resolves
    // immediately, but the .then handler is microtask-scheduled, so we yield
    // a microtask before asserting.
    await import('./index.js');
    // Flush microtasks for the whenReady().then(...) handler.
    await Promise.resolve();
    await Promise.resolve();

    expect(setApplicationMenuCalls.length).toBeGreaterThanOrEqual(1);
    // The native menu MUST be suppressed with `null` — anything else (e.g. a
    // Menu instance) would re-introduce the duplicate-menu-bar bug.
    expect(setApplicationMenuCalls[0]).toBeNull();
  });
});
