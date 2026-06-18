// Renderer-side blob-download helper.
// Phase 7.5 C6 §27.3 (Riley Wave 5e).
//
// Wraps the Chromium "anchor with download=… + Blob URL" trick that
// triggers the OS save dialog from a sandboxed renderer. Same pattern
// the Wave 5a Preflight panel uses to export its JSON report (see
// `preflight-panel/index.tsx:onExportJson`) — that precedent is the
// reason this v0.8.0 build uses Option B from the brief's plumbing
// decision rather than introducing a new `fs:writeReport` IPC channel.
//
// FOLLOW-UP (tracked):
//   For full save-dialog control (suggested directory, sanctioned
//   filename, error reporting), this helper should migrate to a typed
//   IPC channel that bundles `dialog:saveAs` + `fs:writeReport`. The
//   existing `fs:writePdf` channel only accepts PDF bytes via a
//   DocumentHandle, so a parallel text-write channel would be a David
//   ask. Logged as a Wave 5e open question.
//
// L-005 (pdf.js polyfill ordering) does NOT apply here — no pdf.js
// involvement. L-004 (`getDocument({data})` buffer copy) does NOT apply
// — no pdf.js involvement.

export interface DownloadOptions {
  /** UTF-8 string content. */
  content: string;
  /** Filename the OS save dialog defaults to. */
  filename: string;
  /** MIME type — `application/json` or `text/html` for this feature. */
  mimeType: string;
}

/** Trigger a browser download. The save dialog the user sees is the
 *  Chromium download UI surfaced by Electron's renderer (sandboxed). */
export function downloadBlob(opts: DownloadOptions): void {
  const blob = new Blob([opts.content], { type: opts.mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = opts.filename;
    // Anchor must be in the DOM for Firefox; Chromium accepts a
    // detached anchor but appending is the cross-browser-safe path.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Release the object URL on the next microtask so the click handler
    // has finished propagating before the URL is revoked. Defensive
    // typeof-check because jsdom does not implement revokeObjectURL —
    // it would throw an unhandled rejection in the renderer test suite
    // even though production browsers ALWAYS define it.
    queueMicrotask(() => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    });
  }
}
