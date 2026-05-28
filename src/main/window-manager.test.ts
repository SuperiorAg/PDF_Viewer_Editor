// @vitest-environment node
//
// L-001 enforcement test (Diego, Wave 3, see .learnings/locked-instructions.md
// L-001 and docs/wave-3-brief.md §1.4 item 8).
//
// Why this test exists:
//   Riley's drag-drop flow in src/client/app.tsx reads File.path (an Electron-
//   only non-standard property) when a PDF is dropped on the window. If
//   `webPreferences.enableDragDropFiles` is set to false in window-manager.ts,
//   Electron suppresses drag-drop and the cast silently returns undefined,
//   breaking open-by-drag with no visible error.
//
// What this test asserts:
//   createMainWindow() constructs a BrowserWindow with webPreferences such
//   that enableDragDropFiles is NOT explicitly set to false. (The default is
//   true; either undefined or true is acceptable; only `false` fails the lock.)
//
// How:
//   vi.mock('electron') replaces the BrowserWindow constructor with a spy that
//   captures its arguments. The factory in window-manager.ts then calls our
//   spy, we read off the captured options, and assert on webPreferences.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture BrowserWindow constructor invocations. The mock factory below
// returns this array reference so the test can inspect the call history.
const browserWindowCalls: Array<Record<string, unknown>> = [];

vi.mock('electron', () => {
  class MockBrowserWindow {
    private listeners = new Map<string, Array<() => void>>();
    constructor(opts: Record<string, unknown>) {
      browserWindowCalls.push(opts);
    }
    on(_event: string, _handler: () => void): this {
      return this;
    }
    once(_event: string, _handler: () => void): this {
      return this;
    }
    show(): void {}
    isMinimized(): boolean {
      return false;
    }
    restore(): void {}
    focus(): void {}
    loadURL(_url: string): Promise<void> {
      return Promise.resolve();
    }
    loadFile(_file: string): Promise<void> {
      return Promise.resolve();
    }
  }
  return {
    BrowserWindow: MockBrowserWindow,
    app: { quit: () => undefined, whenReady: () => Promise.resolve() },
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
});

describe('L-001 enforcement — webPreferences.enableDragDropFiles', () => {
  beforeEach(() => {
    browserWindowCalls.length = 0;
  });

  it('createMainWindow MUST NOT set enableDragDropFiles to false', async () => {
    // Dynamic import so the vi.mock above takes effect before electron is
    // resolved by the window-manager module.
    const { createMainWindow } = await import('./window-manager.js');
    createMainWindow({ preloadPath: '/fake/preload.js' });

    expect(browserWindowCalls.length).toBeGreaterThanOrEqual(1);
    const opts = browserWindowCalls[0]!;
    const webPreferences = opts['webPreferences'] as Record<string, unknown> | undefined;
    expect(webPreferences).toBeDefined();

    // The lock: enableDragDropFiles must not be explicitly false.
    // It may be true OR omitted (defaults to true).
    expect(webPreferences!['enableDragDropFiles']).not.toBe(false);
  });

  it('createMainWindow MUST keep the rest of the security floor intact', async () => {
    const { createMainWindow } = await import('./window-manager.js');
    createMainWindow({ preloadPath: '/fake/preload.js' });

    const opts = browserWindowCalls[browserWindowCalls.length - 1]!;
    const webPreferences = opts['webPreferences'] as Record<string, unknown>;

    // ARCHITECTURE §2.1 invariants — these are the same security floor
    // Julian audits in Wave 3. Re-asserting them here ensures L-001's test
    // doesn't accidentally pass against a degraded webPreferences object.
    expect(webPreferences['contextIsolation']).toBe(true);
    expect(webPreferences['nodeIntegration']).toBe(false);
    expect(webPreferences['sandbox']).toBe(true);
    expect(webPreferences['webSecurity']).toBe(true);
    expect(webPreferences['allowRunningInsecureContent']).toBe(false);
  });
});
