// @vitest-environment node
//
// L-001 enforcement + security-floor test for the offscreen print/export
// BrowserWindow factory. Diego, Wave 8 (D-8.2 / D-8.3).
//
// Why this test exists:
//   D-8.2 wires Chromium PDF export via `webContents.printToPDF()` on a
//   hidden BrowserWindow. D-8.3 wires OS print dispatch via
//   `webContents.print()` on a hidden BrowserWindow. Both must inherit the
//   security floor from the main window (architecture-phase-2.md §5) AND
//   must NOT regress L-001 (enableDragDropFiles must not be explicitly
//   false anywhere in the codebase). This test exercises buildPrintWindowOptions
//   without booting Electron so it runs in the Vitest unit-test sweep.
//
// What this test asserts:
//   1. enableDragDropFiles is NOT explicitly false (L-001 invariant).
//   2. The five core security-floor flags match the main window:
//      contextIsolation, nodeIntegration, sandbox, webSecurity,
//      allowRunningInsecureContent.
//   3. createPrintWindow() constructs exactly one BrowserWindow per call.
//   4. The window is hidden by default (show: false).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const browserWindowCalls: Array<Record<string, unknown>> = [];

vi.mock('electron', () => {
  class MockBrowserWindow {
    constructor(opts: Record<string, unknown>) {
      browserWindowCalls.push(opts);
    }
    on(): this {
      return this;
    }
    once(): this {
      return this;
    }
    show(): void {}
    destroy(): void {}
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    loadFile(): Promise<void> {
      return Promise.resolve();
    }
    isDestroyed(): boolean {
      return false;
    }
  }
  return {
    BrowserWindow: MockBrowserWindow,
    app: { quit: () => undefined, whenReady: () => Promise.resolve() },
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
});

describe('print-window — buildPrintWindowOptions (L-001 + security floor)', () => {
  beforeEach(() => {
    browserWindowCalls.length = 0;
  });

  it('MUST NOT set enableDragDropFiles to false (L-001)', async () => {
    const { buildPrintWindowOptions } = await import('./print-window.js');
    const opts = buildPrintWindowOptions({ preloadPath: '/fake/preload.js' });
    const webPreferences = opts.webPreferences as Record<string, unknown> | undefined;
    expect(webPreferences).toBeDefined();
    // The lock: enableDragDropFiles must not be explicitly false; either
    // omitted (default) or true is acceptable.
    expect(webPreferences!['enableDragDropFiles']).not.toBe(false);
  });

  it('inherits the main-window security floor', async () => {
    const { buildPrintWindowOptions } = await import('./print-window.js');
    const opts = buildPrintWindowOptions({ preloadPath: '/fake/preload.js' });
    const webPreferences = opts.webPreferences as Record<string, unknown>;

    expect(webPreferences['contextIsolation']).toBe(true);
    expect(webPreferences['nodeIntegration']).toBe(false);
    expect(webPreferences['nodeIntegrationInWorker']).toBe(false);
    expect(webPreferences['nodeIntegrationInSubFrames']).toBe(false);
    expect(webPreferences['sandbox']).toBe(true);
    expect(webPreferences['webSecurity']).toBe(true);
    expect(webPreferences['allowRunningInsecureContent']).toBe(false);
    expect(webPreferences['disableBlinkFeatures']).toBe('Auxclick');
  });

  it('is hidden by default (show: false, skipTaskbar, frameless)', async () => {
    const { buildPrintWindowOptions } = await import('./print-window.js');
    const opts = buildPrintWindowOptions();
    expect(opts.show).toBe(false);
    expect(opts.skipTaskbar).toBe(true);
    expect(opts.frame).toBe(false);
  });
});

describe('print-window — createPrintWindow constructs one BrowserWindow', () => {
  beforeEach(() => {
    browserWindowCalls.length = 0;
  });

  it('constructs exactly one BrowserWindow with the security floor', async () => {
    const { createPrintWindow } = await import('./print-window.js');
    createPrintWindow({ preloadPath: '/fake/preload.js' });

    expect(browserWindowCalls.length).toBe(1);
    const opts = browserWindowCalls[0]!;
    const webPreferences = opts['webPreferences'] as Record<string, unknown>;
    // Reassert L-001 at the construction call site (defense in depth).
    expect(webPreferences['enableDragDropFiles']).not.toBe(false);
    expect(webPreferences['contextIsolation']).toBe(true);
    expect(webPreferences['sandbox']).toBe(true);
    expect(opts['show']).toBe(false);
  });
});

describe('print-window — bytesToDataUrl', () => {
  it('encodes Uint8Array bytes to a base64 data: URL', async () => {
    const { bytesToDataUrl } = await import('./print-window.js');
    const url = bytesToDataUrl(new Uint8Array([0x25, 0x50, 0x44, 0x46])); // %PDF
    expect(url.startsWith('data:application/pdf;base64,')).toBe(true);
    // Validate the base64 decodes back.
    const b64 = url.slice('data:application/pdf;base64,'.length);
    const decoded = Buffer.from(b64, 'base64');
    expect(decoded[0]).toBe(0x25);
    expect(decoded[1]).toBe(0x50);
  });
});

describe('print-window — buildPrintOptions (D-8.3 mapping)', () => {
  it('maps default request to silent: false + printBackground: true', async () => {
    const { buildPrintOptions } = await import('./print-window.js');
    const opts = buildPrintOptions({ bytes: new Uint8Array([1]) });
    expect(opts.silent).toBe(false);
    expect(opts.printBackground).toBe(true);
  });

  it('maps printerName -> deviceName', async () => {
    const { buildPrintOptions } = await import('./print-window.js');
    const opts = buildPrintOptions({
      bytes: new Uint8Array([1]),
      printerName: 'Brother HL-L2350DW',
    });
    expect(opts.deviceName).toBe('Brother HL-L2350DW');
  });

  it('maps duplex short-edge -> shortEdge, long-edge -> longEdge', async () => {
    const { buildPrintOptions } = await import('./print-window.js');
    const short = buildPrintOptions({
      bytes: new Uint8Array([1]),
      options: { duplex: 'short-edge' },
    });
    expect(short.duplexMode).toBe('shortEdge');
    const long = buildPrintOptions({
      bytes: new Uint8Array([1]),
      options: { duplex: 'long-edge' },
    });
    expect(long.duplexMode).toBe('longEdge');
  });

  it('maps pageRange to a single PageRange array', async () => {
    const { buildPrintOptions } = await import('./print-window.js');
    const opts = buildPrintOptions({
      bytes: new Uint8Array([1]),
      pageRange: { start: 0, end: 2 },
    });
    expect(opts.pageRanges).toEqual([{ from: 0, to: 2 }]);
  });
});

describe('print-window — exportViaChromium (D-8.2 happy path)', () => {
  beforeEach(() => {
    browserWindowCalls.length = 0;
  });

  it('returns engine_failed_chromium on empty input', async () => {
    const { exportViaChromium } = await import('./print-window.js');
    const r = await exportViaChromium({ bytes: new Uint8Array(0), deterministic: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('engine_failed_chromium');
    }
  });

  it('round-trips a small synthetic PDF via the mocked webContents.printToPDF', async () => {
    // Patch the mock electron with a webContents.printToPDF stub so the test
    // exercises the load + capture + destroy path without booting Electron.
    vi.resetModules();
    const captured: Array<{ url?: string; file?: string }> = [];
    const destroyed: boolean[] = [];

    vi.doMock('electron', () => {
      class MockBrowserWindow {
        webContents = {
          printToPDF: async (_opts: unknown) => {
            return Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
          },
          print: () => undefined,
        };
        constructor(opts: Record<string, unknown>) {
          browserWindowCalls.push(opts);
        }
        loadURL(url: string): Promise<void> {
          captured.push({ url });
          return Promise.resolve();
        }
        loadFile(file: string): Promise<void> {
          captured.push({ file });
          return Promise.resolve();
        }
        destroy(): void {
          destroyed.push(true);
        }
        isDestroyed(): boolean {
          return destroyed.length > 0;
        }
        on(): this {
          return this;
        }
        once(): this {
          return this;
        }
      }
      return {
        BrowserWindow: MockBrowserWindow,
        app: { quit: () => undefined, whenReady: () => Promise.resolve() },
        ipcMain: { handle: () => undefined, on: () => undefined },
      };
    });

    const { exportViaChromium } = await import('./print-window.js');
    const r = await exportViaChromium({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
      deterministic: false,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.bytes.byteLength).toBe(8);
      expect(r.value.bytes[0]).toBe(0x25);
      expect(r.value.bytes[1]).toBe(0x50);
    }
    // Confirm we loaded via a data URL (small bytes) and destroyed the window.
    expect(captured[0]?.url?.startsWith('data:application/pdf')).toBe(true);
    expect(destroyed.length).toBeGreaterThanOrEqual(1);

    vi.doUnmock('electron');
    vi.resetModules();
  });

  it('destroys the BrowserWindow on printToPDF failure (memory hygiene)', async () => {
    vi.resetModules();
    const destroyed: boolean[] = [];

    vi.doMock('electron', () => {
      class MockBrowserWindow {
        webContents = {
          printToPDF: async () => {
            throw new Error('renderer crash');
          },
          print: () => undefined,
        };
        constructor(opts: Record<string, unknown>) {
          browserWindowCalls.push(opts);
        }
        loadURL(): Promise<void> {
          return Promise.resolve();
        }
        loadFile(): Promise<void> {
          return Promise.resolve();
        }
        destroy(): void {
          destroyed.push(true);
        }
        isDestroyed(): boolean {
          return destroyed.length > 0;
        }
        on(): this {
          return this;
        }
        once(): this {
          return this;
        }
      }
      return {
        BrowserWindow: MockBrowserWindow,
        app: { quit: () => undefined, whenReady: () => Promise.resolve() },
        ipcMain: { handle: () => undefined, on: () => undefined },
      };
    });

    const { exportViaChromium } = await import('./print-window.js');
    const r = await exportViaChromium({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      deterministic: false,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('engine_failed_chromium');
      expect(r.message).toMatch(/renderer crash/);
    }
    // Critical: window is destroyed even on error.
    expect(destroyed.length).toBeGreaterThanOrEqual(1);

    vi.doUnmock('electron');
    vi.resetModules();
  });
});

describe('print-window — dispatchPrintViaElectron (D-8.3 happy path)', () => {
  beforeEach(() => {
    browserWindowCalls.length = 0;
    // Restore the top-level electron mock at the start of every test in
    // this describe (the previous `exportViaChromium` describe called
    // vi.doUnmock at its tail).
    vi.resetModules();
    vi.doMock('electron', () => {
      class MockBrowserWindow {
        webContents = {
          printToPDF: async () => Buffer.from([0]),
          print: (_opts: unknown, cb?: (success: boolean, failureReason?: string) => void) => {
            if (cb) cb(true);
          },
        };
        constructor(opts: Record<string, unknown>) {
          browserWindowCalls.push(opts);
        }
        loadURL(): Promise<void> {
          return Promise.resolve();
        }
        loadFile(): Promise<void> {
          return Promise.resolve();
        }
        destroy(): void {}
        isDestroyed(): boolean {
          return false;
        }
        on(): this {
          return this;
        }
        once(): this {
          return this;
        }
      }
      return {
        BrowserWindow: MockBrowserWindow,
        app: { quit: () => undefined, whenReady: () => Promise.resolve() },
        ipcMain: { handle: () => undefined, on: () => undefined },
      };
    });
  });

  it('returns print_dispatch_failed on empty bytes (validates before BrowserWindow ctor)', async () => {
    const { dispatchPrintViaElectron } = await import('./print-window.js');
    const r = await dispatchPrintViaElectron({ bytes: new Uint8Array(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('print_dispatch_failed');
    }
  });

  it('returns ok when webContents.print callback fires success=true', async () => {
    vi.resetModules();
    const destroyed: boolean[] = [];

    vi.doMock('electron', () => {
      class MockBrowserWindow {
        webContents = {
          printToPDF: async () => Buffer.from([0]),
          print: (_opts: unknown, cb?: (success: boolean, failureReason?: string) => void) => {
            if (cb) cb(true);
          },
        };
        constructor(opts: Record<string, unknown>) {
          browserWindowCalls.push(opts);
        }
        loadURL(): Promise<void> {
          return Promise.resolve();
        }
        loadFile(): Promise<void> {
          return Promise.resolve();
        }
        destroy(): void {
          destroyed.push(true);
        }
        isDestroyed(): boolean {
          return destroyed.length > 0;
        }
        on(): this {
          return this;
        }
        once(): this {
          return this;
        }
      }
      return {
        BrowserWindow: MockBrowserWindow,
        app: { quit: () => undefined, whenReady: () => Promise.resolve() },
        ipcMain: { handle: () => undefined, on: () => undefined },
      };
    });

    const { dispatchPrintViaElectron } = await import('./print-window.js');
    const r = await dispatchPrintViaElectron({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });

    expect(r.ok).toBe(true);
    expect(destroyed.length).toBeGreaterThanOrEqual(1);

    vi.doUnmock('electron');
    vi.resetModules();
  });

  it('maps "User cancelled" failure to user_cancelled error', async () => {
    vi.resetModules();
    vi.doMock('electron', () => {
      class MockBrowserWindow {
        webContents = {
          printToPDF: async () => Buffer.from([0]),
          print: (_opts: unknown, cb?: (success: boolean, failureReason?: string) => void) => {
            if (cb) cb(false, 'User cancelled the print');
          },
        };
        constructor(opts: Record<string, unknown>) {
          browserWindowCalls.push(opts);
        }
        loadURL(): Promise<void> {
          return Promise.resolve();
        }
        loadFile(): Promise<void> {
          return Promise.resolve();
        }
        destroy(): void {}
        isDestroyed(): boolean {
          return false;
        }
        on(): this {
          return this;
        }
        once(): this {
          return this;
        }
      }
      return {
        BrowserWindow: MockBrowserWindow,
        app: { quit: () => undefined, whenReady: () => Promise.resolve() },
        ipcMain: { handle: () => undefined, on: () => undefined },
      };
    });

    const { dispatchPrintViaElectron } = await import('./print-window.js');
    const r = await dispatchPrintViaElectron({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('user_cancelled');
    }

    vi.doUnmock('electron');
    vi.resetModules();
  });
});
