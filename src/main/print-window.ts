// Hidden offscreen BrowserWindow factory for Chromium-based PDF export and
// OS-print dispatch. Diego, Wave 8 (D-8.2, D-8.3).
//
// Why this file exists separately from window-manager.ts:
//   - window-manager.ts owns the visible main window (Riley's UX surface).
//     L-001 locks `enableDragDropFiles !== false` there because the renderer
//     drag-drop path depends on Electron's non-standard `File.path`.
//   - This file owns hidden short-lived windows used to drive
//     `webContents.printToPDF()` (Chromium-engine export) and to host a
//     loaded PDF buffer for `webContents.print()` (OS print dispatch).
//   - Both new windows inherit the same security floor as the main window
//     plus an explicit no-drag-drop posture (these windows never accept user
//     input). The L-001 lock is REAFFIRMED here: we omit `enableDragDropFiles`
//     so Electron's default applies. NEVER set it to `false` in this module —
//     even hidden windows must respect the lock for audit-trail uniformity.
//
// Security floor (architecture-phase-2.md §5):
//   contextIsolation: true, nodeIntegration: false, sandbox: true,
//   webSecurity: true, allowRunningInsecureContent: false,
//   nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
//   disableBlinkFeatures: 'Auxclick', show: false.
//
// Lifecycle: every factory below pairs `new BrowserWindow(...)` with a
// `try { ... } finally { destroy() }` at every call site that uses it.
// Tests assert the security floor without booting real Electron (vi.mock).

import { randomUUID } from 'node:crypto';
import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BrowserWindow,
  type BrowserWindow as BrowserWindowType,
  type BrowserWindowConstructorOptions,
} from 'electron';

const here = dirname(fileURLToPath(import.meta.url));

export interface PrintWindowOptions {
  /** Override the preload script. Default: dist/preload/index.js sibling. */
  preloadPath?: string;
  /** Width hint (irrelevant for printToPDF; useful only for diagnostics). */
  width?: number;
  /** Height hint. */
  height?: number;
}

/**
 * Build the BrowserWindowConstructorOptions for an offscreen print window.
 * Exported separately from `createPrintWindow` so tests can assert the
 * security floor without invoking the Electron constructor.
 *
 * L-001 enforcement note: this function MUST NOT set
 * `webPreferences.enableDragDropFiles`. The Electron default (`true`) is
 * preserved by omission. The L-001 unit test asserts the property is not
 * explicitly `false`.
 */
export function buildPrintWindowOptions(
  opts: PrintWindowOptions = {},
): BrowserWindowConstructorOptions {
  const preloadPath = opts.preloadPath ?? join(here, '..', 'preload', 'index.js');
  return {
    width: opts.width ?? 800,
    height: opts.height ?? 1000,
    show: false,
    // Avoid the OS task-switcher seeing the hidden window.
    skipTaskbar: true,
    // No frame/title bar; the window never renders to a real surface.
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Blink hardening — keep Auxclick off so any embedded handler can't
      // initiate navigation through middle-click side effects.
      disableBlinkFeatures: 'Auxclick',
      // L-001: enableDragDropFiles deliberately OMITTED — Electron default
      // is `true`, which is the load-bearing invariant the lock asserts.
      // Even though this window never accepts drops, we keep the default to
      // make the L-001 test's "must not be explicitly false" assertion a
      // uniform rule across every BrowserWindow factory in the codebase.
      preload: preloadPath,
    },
  };
}

/**
 * Create a hidden BrowserWindow suitable for Chromium printToPDF or OS print
 * dispatch. The caller is responsible for `destroy()` in a `finally` block.
 */
export function createPrintWindow(opts: PrintWindowOptions = {}): BrowserWindow {
  return new BrowserWindow(buildPrintWindowOptions(opts));
}

/**
 * Render a Uint8Array as a `data:application/pdf;base64,...` URL. Suitable
 * for buffers up to ~5 MB; larger buffers should use the temp-file load path
 * in `loadBytesViaTempFile` to avoid data-URL bloat.
 */
export function bytesToDataUrl(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:application/pdf;base64,${b64}`;
}

/**
 * Threshold above which the Chromium path should prefer writing the source
 * bytes to a temp file and `loadFile(tempPath)`. Chosen conservatively at
 * 1 MB — large data: URLs ballon V8 memory and slow first-paint.
 */
export const PDF_DATA_URL_MAX_BYTES = 1 * 1024 * 1024;

// ============================================================================
// Chromium export adapter — D-8.2
// ============================================================================
//
// Pattern: open a hidden BrowserWindow with the security floor (above),
// load the source PDF bytes (data URL for small PDFs, temp file otherwise),
// wait for `did-finish-load`, call `webContents.printToPDF(...)`, capture
// the returned buffer, destroy the window in a `finally` block. The pdf-lib
// path is the primary engine; this Chromium path is the fallback when the
// caller forces preference: 'chromium' or the heuristic picks it.
//
// Errors surface as { ok: false, error: 'engine_failed_chromium' | 'cancelled' }
// to match the contract in `src/ipc/handlers/pdf-export-pdf.ts` PdfExportDeps.

export interface ChromiumExportInput {
  bytes: Uint8Array;
  pageRange?: { start: number; end: number };
  deterministic: boolean;
}

export type ChromiumExportResult =
  | { ok: true; value: { bytes: Uint8Array; warnings: string[] } }
  | { ok: false; error: 'engine_failed_chromium' | 'cancelled'; message: string };

/**
 * Render `input.bytes` via a hidden Chromium BrowserWindow and capture the
 * resulting PDF buffer via `webContents.printToPDF(...)`. Used by the
 * pdf:export channel's Chromium fallback (architecture-phase-2.md §6.1).
 *
 * Memory hygiene: window is always destroyed (in a `finally` block). Temp
 * files are unlinked best-effort. The window is detached from the main one
 * (no parent), so destruction does not affect the visible UI.
 */
export async function exportViaChromium(input: ChromiumExportInput): Promise<ChromiumExportResult> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    return {
      ok: false,
      error: 'engine_failed_chromium',
      message: 'empty or invalid bytes buffer',
    };
  }

  let win: BrowserWindowType | null = null;
  let tempPath: string | null = null;

  try {
    win = createPrintWindow();

    // Prefer temp-file load for buffers >1 MB; data: URLs balloon memory.
    if (input.bytes.byteLength > PDF_DATA_URL_MAX_BYTES) {
      tempPath = join(tmpdir(), `pdfviewer-export-${randomUUID()}.pdf`);
      await fsPromises.writeFile(tempPath, input.bytes);
      await win.loadFile(tempPath);
    } else {
      await win.loadURL(bytesToDataUrl(input.bytes));
    }

    const warnings: string[] = [];
    const printToPdfOpts: Electron.PrintToPDFOptions = {
      printBackground: true,
      // Chromium will auto-detect page size from embedded PDF; explicit
      // landscape: false preserves portrait default if the source has no
      // dimensions set.
      landscape: false,
    };
    if (input.pageRange) {
      printToPdfOpts.pageRanges = `${input.pageRange.start + 1}-${input.pageRange.end + 1}`;
    }

    const buf = await win.webContents.printToPDF(printToPdfOpts);
    const bytes = new Uint8Array(buf);

    if (bytes.byteLength === 0) {
      return {
        ok: false,
        error: 'engine_failed_chromium',
        message: 'printToPDF returned an empty buffer',
      };
    }

    return { ok: true, value: { bytes, warnings } };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return {
      ok: false,
      error: 'engine_failed_chromium',
      message: `Chromium export failed: ${msg}`,
    };
  } finally {
    // Destroy window first to release the loaded document.
    if (win && !win.isDestroyed()) {
      try {
        win.destroy();
      } catch {
        // Swallow — we tried.
      }
    }
    if (tempPath) {
      // Best-effort cleanup; the OS will GC tmpdir eventually anyway.
      try {
        await fsPromises.unlink(tempPath);
      } catch {
        // Ignore — temp dir is OS-managed.
      }
    }
  }
}

// ============================================================================
// Electron print dispatch adapter — D-8.3
// ============================================================================
//
// Pattern (architecture-phase-2.md §7): use the EXISTING main window's
// webContents to invoke `print()`. The user expects the active document to
// be sent to the print dialog; creating a separate window would surprise
// them. The handler at `src/ipc/handlers/pdf-print.ts` already replays the
// ops into fresh bytes; this dispatch surface receives the bytes and routes
// them through the main window.
//
// Why not load the bytes into a hidden offscreen window like Chromium
// export? Two reasons: (1) the OS print dialog is modal — it expects an
// owning visible window with input focus; (2) loading the bytes into the
// main window's webContents would clobber the renderer UI. The Phase-2
// shipped pattern: rely on Electron's main window webContents.print()
// callback to surface the OS print dialog. The print job spool is then
// owned by the OS.
//
// If the active main window does not exist (rare edge case during shutdown),
// the dispatch surfaces `print_dispatch_failed`.

export interface PrintDispatchInput {
  bytes: Uint8Array;
  printerName?: string;
  pageRange?: { start: number; end: number };
  options?: {
    silent?: boolean;
    copies?: number;
    color?: boolean;
    duplex?: 'simplex' | 'short-edge' | 'long-edge';
    pageSize?: 'A4' | 'Letter' | 'Legal' | { width: number; height: number };
  };
}

export type PrintDispatchResult =
  | { ok: true }
  | {
      ok: false;
      error: 'user_cancelled' | 'printer_not_found' | 'print_dispatch_failed' | 'no_printers_found';
      message: string;
    };

/**
 * Builder for the `Electron.WebContentsPrintOptions` payload from the
 * channel's PdfPrintRequest.options. Exported so unit tests can verify the
 * mapping without booting Electron.
 */
export function buildPrintOptions(input: PrintDispatchInput): Electron.WebContentsPrintOptions {
  const opts: Electron.WebContentsPrintOptions = {
    silent: input.options?.silent ?? false,
    printBackground: true,
  };
  if (input.printerName !== undefined) {
    opts.deviceName = input.printerName;
  }
  if (input.options?.copies !== undefined) {
    opts.copies = input.options.copies;
  }
  if (input.options?.color !== undefined) {
    opts.color = input.options.color;
  }
  if (input.options?.duplex) {
    opts.duplexMode =
      input.options.duplex === 'simplex'
        ? 'simplex'
        : input.options.duplex === 'short-edge'
          ? 'shortEdge'
          : 'longEdge';
  }
  if (input.pageRange) {
    opts.pageRanges = [
      {
        from: input.pageRange.start,
        to: input.pageRange.end,
      },
    ];
  }
  return opts;
}

/**
 * Dispatch a print job for the supplied replayed PDF bytes via Electron's
 * `webContents.print()`. The bytes are loaded into a hidden BrowserWindow
 * (security floor inherited from `buildPrintWindowOptions`) and immediately
 * routed to the OS print dialog. The window is destroyed once the print
 * callback resolves.
 *
 * Note: Electron's `webContents.print()` callback signature is
 * `(success: boolean, failureReason?: string)`. We map failureReason
 * strings to the channel's PdfPrintError union conservatively.
 */
export async function dispatchPrintViaElectron(
  input: PrintDispatchInput,
): Promise<PrintDispatchResult> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    return {
      ok: false,
      error: 'print_dispatch_failed',
      message: 'empty or invalid bytes buffer',
    };
  }

  let win: BrowserWindowType | null = null;
  let tempPath: string | null = null;

  try {
    win = createPrintWindow();

    if (input.bytes.byteLength > PDF_DATA_URL_MAX_BYTES) {
      tempPath = join(tmpdir(), `pdfviewer-print-${randomUUID()}.pdf`);
      await fsPromises.writeFile(tempPath, input.bytes);
      await win.loadFile(tempPath);
    } else {
      await win.loadURL(bytesToDataUrl(input.bytes));
    }

    const printOpts = buildPrintOptions(input);

    const result = await new Promise<PrintDispatchResult>((resolve) => {
      // webContents.print signature: (options, callback?). The callback's
      // success boolean indicates whether the print job was queued.
      try {
        win!.webContents.print(printOpts, (success, failureReason) => {
          if (success) {
            resolve({ ok: true });
            return;
          }
          // Map Electron's failureReason strings (vendor-specific) to our
          // PdfPrintError union conservatively.
          const reason = String(failureReason ?? 'unknown');
          if (/cancel/i.test(reason)) {
            resolve({
              ok: false,
              error: 'user_cancelled',
              message: reason,
            });
            return;
          }
          if (/no printer|no printers|not found/i.test(reason)) {
            resolve({
              ok: false,
              error: reason.toLowerCase().includes('no printer')
                ? 'no_printers_found'
                : 'printer_not_found',
              message: reason,
            });
            return;
          }
          resolve({
            ok: false,
            error: 'print_dispatch_failed',
            message: reason,
          });
        });
      } catch (e) {
        resolve({
          ok: false,
          error: 'print_dispatch_failed',
          message: `webContents.print threw: ${(e as Error).message}`,
        });
      }
    });

    return result;
  } catch (e) {
    return {
      ok: false,
      error: 'print_dispatch_failed',
      message: `Print dispatch failed: ${(e as Error).message}`,
    };
  } finally {
    if (win && !win.isDestroyed()) {
      try {
        win.destroy();
      } catch {
        // ignore
      }
    }
    if (tempPath) {
      try {
        await fsPromises.unlink(tempPath);
      } catch {
        // ignore
      }
    }
  }
}
