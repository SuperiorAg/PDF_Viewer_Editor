// file-open-from-shell.ts — renderer subscription for the file-association
// shell-entry channel (v0.7.13, parallel-coordinated with David's main work).
//
// =============================================================================
// CONTRACT (as agreed in the v0.7.13 brief — exact wire shape pending David's
// parallel run landing in src/ipc/contracts.ts + src/preload/index.ts):
//
//   PdfApi['app']['onFileOpenFromShell']?: (
//     handler: (event: { absolutePath: string }) => void,
//   ) => () => void;
//
// Emission cases (main process):
//   - Windows: file-association double-click, Shell "open with" verb, or drag
//     onto the taskbar/desktop icon. Electron's `app.on('open-file', ...)` is
//     macOS-only; on Windows the path arrives in `process.argv` at boot AND
//     via the second-instance handler when the app is single-instanced.
//   - macOS: `app.on('open-file', ...)` (future cross-platform support).
//
// =============================================================================
// GAP CLOSED (2026-06-04, mid-wave): David committed both halves while this
// hook was being written —
//   - src/ipc/contracts.ts adds `onFileOpenFromShell: (cb: ...) => () => void`
//     to `PdfApi['app']` (commit 8a1ad64).
//   - src/preload/index.ts exposes the live bridge implementation (same commit).
//   - src/client/services/api.ts has the no-op fallback in
//     `makeBridgeUnavailableFallback` (David edited Riley-owned api.ts because
//     the contract field is now part of the canonical PdfApi shape, so the
//     fallback factory MUST satisfy it for typecheck).
// The runtime feature detection below is intentionally kept defensive — it
// covers test runs that stub a partial pdfApi (no `app.onFileOpenFromShell`
// override) AND any future refactor that strips the fallback.
// =============================================================================

import { type AppDispatch } from './store';
import { openDroppedPathThunk } from './thunks';

interface FileOpenFromShellEvent {
  absolutePath: string;
}

type Unsubscribe = () => void;
type OnFileOpenFromShell = (handler: (event: FileOpenFromShellEvent) => void) => Unsubscribe;

/**
 * Subscribe to the file:openFromShell event stream. Routes received absolute
 * paths through `openDroppedPathThunk` — the same thunk window-drag-drop uses
 * (see app.tsx:onDrop). That thunk accepts a string `droppedPath`, hands it
 * to `api.fs.readPdf({ droppedPath })`, and the main process validates +
 * loads. So shell-opened files take the EXACT same security + load pathway
 * as drag-drop, no special-case branch needed.
 *
 * Returns a no-op unsubscribe if `window.pdfApi.app.onFileOpenFromShell` is
 * not yet exposed (parallel-coordination race window).
 */
export function subscribeFileOpenFromShell(dispatch: AppDispatch): Unsubscribe {
  if (typeof window === 'undefined') return () => undefined;
  const pdfApi = (window as Window & { pdfApi?: unknown }).pdfApi;
  if (pdfApi === undefined || pdfApi === null) return () => undefined;

  // Defensive narrowing: pdfApi.app.onFileOpenFromShell may or may not exist
  // depending on whether David's preload landed yet. typeof-function check
  // guards both "property absent" and "value is not callable".
  const app = (pdfApi as { app?: { onFileOpenFromShell?: OnFileOpenFromShell } }).app;
  if (app === undefined || typeof app.onFileOpenFromShell !== 'function') {
    return () => undefined;
  }

  return app.onFileOpenFromShell((event: FileOpenFromShellEvent) => {
    // openDroppedPathThunk is the right level of indirection here: it owns the
    // "open a path off disk" flow (loading toast, readPdf IPC, error mapping
    // for invalid_pdf / too_large / path_rejected, recents refresh, form
    // detection, page-dim measurement). Reusing it means file-association
    // opens behave identically to drag-drop opens — same error toasts, same
    // post-open follow-ups, single code path to maintain.
    void dispatch(openDroppedPathThunk(event.absolutePath));
  });
}
