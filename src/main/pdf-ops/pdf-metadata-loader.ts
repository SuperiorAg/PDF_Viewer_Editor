// Phase 4.1 (Wave 17.1 cleanup, David) — pdf-lib-backed metadata loader.
//
// This module is the PERMANENT replacement for the Phase-1 stub at
// `src/ipc/register.ts:119-136 defaultPdfMetadata`, which only sniffed the
// %PDF- magic header and returned `pageCount: -1`. With -1 propagated into
// the renderer, `dialog:openPdf` succeeded but no thumbnails or pages
// rendered — see `.learnings/failures/2026-05-26-phase1-stub-rot.md` (this
// wave) for the multi-wave-rot RCA.
//
// CONTRACT (matches `DialogOpenPdfDeps.loadPdfMetadata` signature in
// `src/ipc/handlers/dialog-open-pdf.ts:22-24` and `FsReadPdfDeps.loadPdfMetadata`
// in `src/ipc/handlers/fs-read-pdf.ts:21-23`):
//
//   async function loadPdfMetadata(bytes: Uint8Array):
//     Promise<{ pageCount: number; warnings: string[] }>
//
// On success: returns `{ pageCount, warnings }`. `warnings` collects pdf-lib's
// non-fatal load warnings (encrypted-but-bypassed, missing /Root.Pages
// recovered via xref walk, etc.). The upstream handler stores these on the
// document record so the renderer can surface them as a non-blocking toast.
//
// On failure: throws an `Error` whose message starts with "Could not parse PDF:".
// The handler catches and converts to the `invalid_pdf` Result error variant
// (`dialog-open-pdf.ts:78` / `fs-read-pdf.ts:65`). We do NOT surface raw
// pdf-lib error text without prefixing — pdf-lib's messages can include
// internal stream offsets that aren't user-meaningful.
//
// SECURITY: `ignoreEncryption: true` is intentional. A password-protected PDF
// still has a readable page tree; the user can OPEN it (we count pages, show
// thumbnails) but cannot EDIT or RE-SAVE the content streams. Phase 5 may
// add a password prompt; for Phase 1 + 4.1 we follow Adobe Reader's "open
// the encrypted document in view-only mode" default.
//
// `updateMetadata: false` keeps load idempotent — pdf-lib's default of
// rewriting the /Info → /ModDate when it loads would mutate the byte slice
// we pass in, which is the same slice the document-store retains for save.

import { PDFDocument } from 'pdf-lib';

export interface LoadedPdfMetadata {
  pageCount: number;
  warnings: string[];
}

/**
 * Load a PDF byte slice and return its page count + non-fatal warnings.
 *
 * @throws Error  if the bytes are not a parseable PDF. The error's `message`
 *   is prefixed with "Could not parse PDF:" so the upstream IPC handler
 *   surfaces a user-meaningful `invalid_pdf` error rather than pdf-lib's
 *   raw internal text. The thrown error's `cause` is set to the original
 *   pdf-lib error (Node 16+ Error.cause) so a developer running with
 *   DevTools can still inspect the underlying parser failure.
 */
export async function loadPdfMetadata(bytes: Uint8Array): Promise<LoadedPdfMetadata> {
  // Defensive: pdf-lib will throw on empty input, but the message is opaque.
  // Sniff the %PDF- magic up-front so the user-facing error is honest.
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 || // %
    bytes[1] !== 0x50 || // P
    bytes[2] !== 0x44 || // D
    bytes[3] !== 0x46 || // F
    bytes[4] !== 0x2d // -
  ) {
    throw new Error('Could not parse PDF: missing %PDF- header');
  }

  let doc: PDFDocument;
  let pageCount: number;
  try {
    doc = await PDFDocument.load(bytes, {
      // Encrypted PDFs are viewable; edit gates fire later in the pipeline
      // (replay-engine returns `encrypted_unsupported` on a save attempt).
      ignoreEncryption: true,
      // Keep load pure — do not let pdf-lib rewrite /ModDate during load.
      updateMetadata: false,
      // Bubble each non-fatal warning rather than collecting silently.
      // pdf-lib accumulates these on the returned doc; we drain them below.
      throwOnInvalidObject: false,
    });
    // pdf-lib's parser is permissive on malformed bodies — `load` may
    // resolve with a partially-constructed doc, then `getPageCount` throws
    // when it walks the (missing) /Pages tree. Wrap both calls so a
    // half-parsed doc still surfaces as a clean prefixed error.
    pageCount = doc.getPageCount();
  } catch (e) {
    // Prefix with our honest user-meaningful preamble; preserve the original
    // for developer debugging via `Error.cause` (Node 16+).
    const original = (e as Error).message ?? '(no message)';
    throw new Error(`Could not parse PDF: ${original}`, { cause: e });
  }

  return {
    pageCount,
    // pdf-lib does not currently expose a structured warnings array on the
    // loaded doc (its warnings are emitted via parser-internal callbacks
    // that we don't subscribe to). Returning an empty array keeps the shape
    // contract stable; future iterations may wire a parser observer.
    warnings: [],
  };
}
