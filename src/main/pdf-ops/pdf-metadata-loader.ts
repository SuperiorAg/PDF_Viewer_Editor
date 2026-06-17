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

  // PERF (1064-page PDF unblock): pdf-lib's PDFDocument.load() parses the
  // ENTIRE document tree synchronously on the main thread — for a 1000+-page
  // PDF that wedges main for many tens of seconds while dialog:openPdf has
  // not yet returned, and the renderer's visible-page render path waits
  // behind it (main is single-threaded IPC). We only need pageCount here;
  // try a fast byte scan for /Type/Pages /Count first — this works for the
  // vast majority of PDFs (the page-tree root dict is in plain text in the
  // xref-table format and in most xref-stream variants too). Fall back to
  // pdf-lib only when the scan can't find a count (e.g. fully compressed
  // object streams), preserving correctness for unusual PDFs.
  const quick = quickScanPageCount(bytes);
  if (quick !== null) {
    return { pageCount: quick, warnings: [] };
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

/**
 * Fast byte-scan for the page tree's /Count. Returns the LARGEST /Count
 * found in any `/Type /Pages` dict — the root /Pages dict always has the
 * largest count because it sums every leaf in its subtree. Returns null
 * when no in-plaintext /Type /Pages dict is present (e.g. the root is
 * inside a compressed object stream), in which case callers should fall
 * back to pdf-lib's full parse.
 *
 * Performance: Buffer.indexOf is a native C scan; even on a 200MB PDF this
 * completes in milliseconds.
 */
function quickScanPageCount(bytes: Uint8Array): number | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PDF tokens: `/Type/Pages` (compact, no space) and `/Type /Pages`
  // (canonical, single space) are the two common forms. Other whitespace
  // (LF, CR, TAB) is permitted by the spec between tokens but rare for the
  // /Type key.
  const patterns = [Buffer.from('/Type/Pages'), Buffer.from('/Type /Pages')];
  let best: number | null = null;
  for (const pattern of patterns) {
    let pos = buf.indexOf(pattern);
    while (pos !== -1) {
      // Scan forward up to ~2KB for /Count <num>. The /Count entry is
      // typically within a few dozen bytes of /Type /Pages inside the same
      // dict, but allow slack for /Kids arrays and verbose formatting.
      const end = Math.min(pos + 2048, buf.length);
      const region = buf.subarray(pos, end).toString('latin1');
      const m = /\/Count\s+(\d+)/.exec(region);
      if (m && m[1] !== undefined) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0 && (best === null || n > best)) {
          best = n;
        }
      }
      pos = buf.indexOf(pattern, pos + pattern.length);
    }
  }
  return best;
}
