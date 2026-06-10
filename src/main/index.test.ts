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
// Phase 7.2 (David, 2026-06-10) — Item A-1 static-import lift mocks. Six
// factories are now imported unconditionally at the top of src/main/index.ts.
// The factory_throw* counters below let the SQLite-vs-memory tests drive each
// slot's success/failure path independently. Tests reach into these maps via
// the exported `_phase72FactoryControl` shape on the mock module.
const phase72FactoryThrow: Record<string, boolean> = {
  formTemplates: false,
  signatureAudit: false,
  ocrJobs: false,
  ocrResults: false,
  languagePacks: false,
  exportJobs: false,
};
const makeRepoFactory = (slot: string) => (): unknown => {
  if (phase72FactoryThrow[slot] === true) {
    throw new Error(`[test] ${slot} repo factory forced to throw`);
  }
  return { __slot: slot };
};
vi.mock('../db/repositories/form-templates-repo.js', () => ({
  createFormTemplatesRepo: makeRepoFactory('formTemplates'),
}));
vi.mock('../db/repositories/signature-audit-repo.js', () => ({
  createSignatureAuditRepo: makeRepoFactory('signatureAudit'),
}));
vi.mock('../db/repositories/ocr-jobs-repo.js', () => ({
  createOcrJobsRepo: makeRepoFactory('ocrJobs'),
}));
vi.mock('../db/repositories/ocr-results-repo.js', () => ({
  createOcrResultsRepo: makeRepoFactory('ocrResults'),
}));
vi.mock('../db/repositories/language-packs-repo.js', () => ({
  createLanguagePacksRepo: makeRepoFactory('languagePacks'),
}));
vi.mock('../db/repositories/export-jobs-repo.js', () => ({
  createExportJobsRepo: makeRepoFactory('exportJobs'),
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
// Phase 7.2 (David, 2026-06-10) — capture the kinds argument passed to
// setDbBridge so the static-import-lift tests can assert which slots landed
// on SQLite vs memory.
const setDbBridgeCalls: Array<{ bridge: Record<string, unknown>; kinds: unknown }> = [];
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
    recents: { __memory: true, __slot: 'recents' },
    bookmarks: { __memory: true, __slot: 'bookmarks' },
    settings: { get: (): unknown => undefined, set: (): void => undefined },
    formTemplates: { __memory: true, __slot: 'formTemplates' },
    signatureAudit: { __memory: true, __slot: 'signatureAudit' },
    ocrJobs: { __memory: true, __slot: 'ocrJobs' },
    ocrResults: { __memory: true, __slot: 'ocrResults' },
    languagePacks: { __memory: true, __slot: 'languagePacks' },
    exportJobs: { __memory: true, __slot: 'exportJobs' },
  }),
  getDbBridge: (): Record<string, unknown> => ({
    settings: { get: (): unknown => undefined, set: (): void => undefined },
  }),
  setDbBridge: (bridge: Record<string, unknown>, kinds?: unknown): void => {
    setDbBridgeCalls.push({ bridge, kinds });
  },
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

// ============================================================================
// Phase 7.2 (David, 2026-06-10) — Item A-1 static-import lift coverage.
//
// Previously the six Phase-3..6 repo factories were dynamic
// `require('../db/repositories/*-repo.js')` blocks. Vite tree-shook them out
// of `dist/main/` under `_electron.launch()`, silently dropping every slot
// onto the memory bridge (Julian 7.1.5; the v0.7.18 reopen-restore catch
// surface gap).
//
// The lift unconditionally imports the six factories at the top of
// src/main/index.ts. The memory-fallback path is now reachable only when a
// factory THROWS at construction time — those tests below force that path
// per slot via the `phase72FactoryThrow` flag map and verify the resulting
// `kinds` tag map sent to `setDbBridge`.
//
// These tests are the unit-tier defense for the v0.7.18 catch surface; the
// e2e tier (`tests/e2e/ocr-integration.spec.ts` Phase A + D) layers the
// `__test:whichBridge` probe on top via the live `_electron.launch()` run.
// ============================================================================

describe('bootstrap — Phase 7.2 static-import lift (Item A-1)', () => {
  beforeEach(() => {
    setApplicationMenuCalls.length = 0;
    setDbBridgeCalls.length = 0;
    // Reset the per-slot throw flags so a previous test cannot leak.
    for (const slot of Object.keys(phase72FactoryThrow)) {
      phase72FactoryThrow[slot] = false;
    }
    vi.resetModules();
  });

  it('happy path: all six factories succeed → kinds reports all sqlite', async () => {
    await import('./index.js');
    await Promise.resolve();
    await Promise.resolve();

    expect(
      setDbBridgeCalls.length,
      'setDbBridge must be called once during bootstrap',
    ).toBeGreaterThanOrEqual(1);
    const call = setDbBridgeCalls[0]!;
    expect(call.kinds, 'kinds map must be present on setDbBridge call').toBeDefined();
    expect(call.kinds).toEqual({
      formTemplates: 'sqlite',
      signatureAudit: 'sqlite',
      ocrJobs: 'sqlite',
      ocrResults: 'sqlite',
      languagePacks: 'sqlite',
      exportJobs: 'sqlite',
    });
    // The bridge slots must carry the live SQLite-adapted repos (the mock's
    // `__slot` marker), not the memory-bridge fallback.
    const bridge = call.bridge as Record<string, { __slot?: string; __memory?: boolean }>;
    for (const slot of [
      'formTemplates',
      'signatureAudit',
      'ocrJobs',
      'ocrResults',
      'languagePacks',
      'exportJobs',
    ]) {
      expect(bridge[slot]?.__slot, `${slot} must be SQLite-backed, not memory`).toBe(slot);
      expect(bridge[slot]?.__memory).toBeUndefined();
    }
  });

  it('memory fallback: ocrJobs factory throws → kinds reports ocrJobs=memory, others=sqlite', async () => {
    // Drive the single-slot fallback path. This is the canonical legitimate
    // memory-fallback case: the static import succeeded (bundler-visible),
    // but the factory invocation threw at construction time (e.g. SQLite
    // open fails, prepared-statement skew). The other five slots stay on
    // SQLite.
    phase72FactoryThrow.ocrJobs = true;

    await import('./index.js');
    await Promise.resolve();
    await Promise.resolve();

    expect(setDbBridgeCalls.length).toBeGreaterThanOrEqual(1);
    const call = setDbBridgeCalls[0]!;
    expect(call.kinds).toEqual({
      formTemplates: 'sqlite',
      signatureAudit: 'sqlite',
      ocrJobs: 'memory',
      ocrResults: 'sqlite',
      languagePacks: 'sqlite',
      exportJobs: 'sqlite',
    });
    const bridge = call.bridge as Record<string, { __slot?: string; __memory?: boolean }>;
    expect(bridge.ocrJobs?.__memory, 'ocrJobs slot must carry the memory-bridge fallback').toBe(
      true,
    );
    expect(bridge.ocrJobs?.__slot).toBe('ocrJobs');
    // The other five must remain SQLite-backed.
    for (const slot of [
      'formTemplates',
      'signatureAudit',
      'ocrResults',
      'languagePacks',
      'exportJobs',
    ]) {
      expect(bridge[slot]?.__memory, `${slot} should NOT be on memory fallback`).toBeUndefined();
      expect(bridge[slot]?.__slot).toBe(slot);
    }
  });

  it('memory fallback: every factory throws → kinds reports all memory', async () => {
    // Worst-case fallback path — every SQLite factory throws. The boot must
    // not crash; every slot must degrade cleanly. This is the structural
    // equivalent of the pre-lift dynamic-require failure mode where Vite
    // tree-shook all six modules out of the bundle.
    for (const slot of Object.keys(phase72FactoryThrow)) {
      phase72FactoryThrow[slot] = true;
    }

    await import('./index.js');
    await Promise.resolve();
    await Promise.resolve();

    expect(setDbBridgeCalls.length).toBeGreaterThanOrEqual(1);
    const call = setDbBridgeCalls[0]!;
    expect(call.kinds).toEqual({
      formTemplates: 'memory',
      signatureAudit: 'memory',
      ocrJobs: 'memory',
      ocrResults: 'memory',
      languagePacks: 'memory',
      exportJobs: 'memory',
    });
  });
});

// ============================================================================
// Phase 7.2 (David, 2026-06-10) — __test:whichBridge handler coverage.
//
// The P-2 probe handler in src/ipc/handlers/test-which-bridge.ts is the IPC
// surface the e2e spec uses to read the kinds map. These tests exercise the
// pure-handler shape directly (no Electron, no IpcMain) for both the
// initialized + uninitialized bridge cases.
// ============================================================================

describe('__test:whichBridge handler', () => {
  it('returns the kinds map in ok shape when setDbBridge initialized it', async () => {
    const { handleTestWhichBridge } = await import('../ipc/handlers/test-which-bridge.js');
    const kinds = {
      formTemplates: 'sqlite' as const,
      signatureAudit: 'memory' as const,
      ocrJobs: 'sqlite' as const,
      ocrResults: 'sqlite' as const,
      languagePacks: 'memory' as const,
      exportJobs: 'sqlite' as const,
    };
    const res = await handleTestWhichBridge({}, { getKinds: () => kinds });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual(kinds);
    }
  });

  it('returns bridge_not_initialized when setDbBridge was never called with kinds', async () => {
    const { handleTestWhichBridge } = await import('../ipc/handlers/test-which-bridge.js');
    const res = await handleTestWhichBridge({}, { getKinds: () => null });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('bridge_not_initialized');
    }
  });

  it('returns a shallow copy of the kinds map (caller cannot mutate handler state)', async () => {
    const { handleTestWhichBridge } = await import('../ipc/handlers/test-which-bridge.js');
    const kinds = {
      formTemplates: 'sqlite' as const,
      signatureAudit: 'sqlite' as const,
      ocrJobs: 'sqlite' as const,
      ocrResults: 'sqlite' as const,
      languagePacks: 'sqlite' as const,
      exportJobs: 'sqlite' as const,
    };
    const res = await handleTestWhichBridge({}, { getKinds: () => kinds });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Mutating the returned value must NOT touch the source map.
      (res.value as Record<string, string>).formTemplates = 'memory';
      expect(kinds.formTemplates).toBe('sqlite');
    }
  });
});
