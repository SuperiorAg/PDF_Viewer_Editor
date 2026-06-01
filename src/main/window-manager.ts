// Window manager — creates and tracks the main BrowserWindow with the
// non-negotiable security configuration from ARCHITECTURE §2.1.
//
// Phase 1: single main window. Designed for multi-window in Phase 2 by
// keeping the singleton accessor below; future code swaps it for a map keyed
// by document handle.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';

// Per Playbook entry #7, derive __dirname from import.meta.url instead of using
// `new URL('.', import.meta.url)` which webpack mishandles.
const here = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

export interface CreateMainWindowOptions {
  preloadPath?: string;
  rendererUrl?: string;
  rendererFile?: string;
}

export function createMainWindow(opts: CreateMainWindowOptions = {}): BrowserWindow {
  const preloadPath = opts.preloadPath ?? join(here, '..', 'preload', 'index.js');

  const options: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'PDF Viewer / Editor',
    backgroundColor: '#1e1e1e',
    // Suppress Electron's default native application menu (File / Edit / View /
    // Window / Help). Riley's custom React MenuBar in src/client/components/
    // menu-bar/ is the sole user-visible menu surface. Without this flag, the
    // native menu renders ABOVE the custom MenuBar (v0.7.7 bug: two stacked
    // menu bars). Belt for the suspenders `Menu.setApplicationMenu(null)` call
    // in src/main/index.ts — autoHideMenuBar also prevents Alt-key from
    // revealing a hidden default menu on Windows.
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: preloadPath,
    },
  };

  const win = new BrowserWindow(options);
  mainWindow = win;

  if (opts.rendererUrl) {
    void win.loadURL(opts.rendererUrl);
  } else if (opts.rendererFile) {
    void win.loadFile(opts.rendererFile);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** Test seam — direct injection for tests that don't boot Electron. */
export function _setMainWindowForTests(w: BrowserWindow | null): void {
  mainWindow = w;
}
