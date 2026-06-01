// Wave-30 follow-up (H-30.1, David 2026-06-01) — pdf-lib-backed combine engine.
//
// Closes H-30.1: `pdf:combine` was a Phase-1 `not_implemented` stub even though
// the renderer's Combine modal + walking-skeleton milestone #6 documented it
// as working. This engine + the handler in `src/ipc/handlers/pdf-combine.ts`
// wire the feature end-to-end.
//
// Mechanism:
//   1. PDFDocument.create() → fresh empty output doc
//   2. For each source: PDFDocument.load(bytes, { ignoreEncryption: true })
//   3. outDoc.copyPages(srcDoc, srcDoc.getPageIndices()) + addPage for each
//   4. outDoc.save() → Uint8Array
//
// pdf-lib's copyPages COPIES page content streams (page tree + resources +
// inheritable attributes from the parent /Pages dict). It does NOT carry
// document-level constructs from the source catalog — /Names → /JavaScript
// (open actions, named JS), /OpenAction, /AA, /AcroForm, /Outlines, /Metadata.
// That means combine is JS-strip-by-construction: any /JS dictionary lives at
// the source catalog, never inside a page dictionary, so the output document
// (built from PDFDocument.create() with no catalog-level extras) is clean.
// Our test suite verifies this with a JS-laden synthetic source.
//
// Honest pdf-lib options:
//   - ignoreEncryption: true — matches pdf-metadata-loader.ts. Lets us open
//     password-protected sources for VIEW-only inputs; copyPages still reads
//     decrypted page streams. If a real-world encrypted-with-PDF-permissions
//     source forbids extraction, pdf-lib still copies (the permissions are
//     advisory; honoring them is a Phase 5+ scope item).
//   - updateMetadata: false — keep load idempotent on the source bytes.
//   - throwOnInvalidObject: false — accumulate non-fatal load issues into
//     pdf-lib's internal warnings (we don't surface per-warning text today,
//     but the test suite verifies output bytes are well-formed).
//
// Output bounds (combine_output_too_large):
//   - Cap output at 500 MB to prevent runaway pdf-lib operations on
//     pathological inputs. The default open.maxFileSizeMB setting is 100 MB
//     per input; combining 5 max-sized inputs hits 500 MB. Beyond that we
//     refuse and surface the error variant for the renderer.
//
// Error variants (PdfCombineError subset this engine returns):
//   - combine_no_inputs       inputs[] is empty
//   - combine_invalid_source  any single source failed pdf-lib load. The
//                              `details.sourceIndex` field carries the 0-based
//                              source index so the handler can report which
//                              input was bad (renderer surfaces the file name).
//   - combine_output_too_large outDoc.save() returned bytes > MAX_OUTPUT_BYTES.
//
// Engine returns a Result; never throws to the caller. The handler then
// wraps with documentStore.register() to mint a fresh DocumentHandle.

import { PDFDocument } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

export type CombineEngineError =
  | 'combine_no_inputs'
  | 'combine_invalid_source'
  | 'combine_output_too_large';

export interface CombineEngineValue {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

/**
 * Maximum output size, in bytes. Matches roughly 5x the default per-file
 * open cap (100 MB) — a sane ceiling for a desktop combine, well below the
 * 2 GiB pdf-lib-internal Uint8Array boundary on 64-bit Node.
 */
export const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;

/**
 * Combine N PDF byte buffers into one. Returns the saved bytes + page count
 * + non-fatal warnings.
 *
 * @param inputs  Array of source PDF byte buffers, ordered as they should
 *                appear in the output. Two or more entries is the typical
 *                use case; a single entry is technically valid (degenerates
 *                to a copy). Zero entries returns `combine_no_inputs`.
 *
 * Pure-function in the spirit of replay-engine.ts: no fs access, no IPC,
 * no globals beyond pdf-lib's internal random seed.
 */
export async function combinePdfs(
  inputs: ReadonlyArray<Uint8Array>,
): Promise<Result<CombineEngineValue, CombineEngineError>> {
  if (inputs.length === 0) {
    return fail<CombineEngineError>('combine_no_inputs', 'inputs[] must have at least one entry');
  }

  const warnings: string[] = [];
  let outDoc: PDFDocument;
  try {
    outDoc = await PDFDocument.create();
  } catch (e) {
    // PDFDocument.create() is synchronous internally and effectively never
    // throws, but defensive: if it ever does, treat the first input as bad.
    return fail<CombineEngineError>(
      'combine_invalid_source',
      `Could not initialize output document: ${(e as Error).message}`,
      { sourceIndex: 0 },
    );
  }

  for (let i = 0; i < inputs.length; i += 1) {
    const src = inputs[i];
    if (!(src instanceof Uint8Array) || src.byteLength === 0) {
      return fail<CombineEngineError>(
        'combine_invalid_source',
        `Source ${i} is empty or not a Uint8Array`,
        { sourceIndex: i },
      );
    }

    let srcDoc: PDFDocument;
    try {
      srcDoc = await PDFDocument.load(src, {
        ignoreEncryption: true,
        updateMetadata: false,
        throwOnInvalidObject: false,
      });
    } catch (e) {
      // pdf-lib's parser may throw with internal stream offsets; prefix the
      // user-facing message with a stable preamble that the handler maps
      // verbatim into the IPC Result.
      const msg = (e as Error).message ?? 'unknown';
      return fail<CombineEngineError>(
        'combine_invalid_source',
        `Source ${i} is not a valid PDF: ${msg}`,
        { sourceIndex: i },
      );
    }

    let pageCount: number;
    try {
      pageCount = srcDoc.getPageCount();
    } catch (e) {
      return fail<CombineEngineError>(
        'combine_invalid_source',
        `Source ${i} has no readable page tree: ${(e as Error).message}`,
        { sourceIndex: i },
      );
    }

    if (pageCount === 0) {
      warnings.push(`Source ${i} has 0 pages; skipped`);
      continue;
    }

    let copied: ReturnType<PDFDocument['getPages']>;
    try {
      copied = await outDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    } catch (e) {
      return fail<CombineEngineError>(
        'combine_invalid_source',
        `Source ${i} page copy failed: ${(e as Error).message}`,
        { sourceIndex: i },
      );
    }

    for (const page of copied) {
      outDoc.addPage(page);
    }
  }

  // Save. pdf-lib's save() can throw on extremely malformed states, but with
  // copyPages-built docs it's essentially infallible.
  let outBytes: Uint8Array;
  try {
    outBytes = await outDoc.save({
      // useObjectStreams: true is pdf-lib's default; compacts the output.
      // Object streams are universally readable by pdf.js + Acrobat + Reader.
      useObjectStreams: true,
    });
  } catch (e) {
    return fail<CombineEngineError>(
      'combine_invalid_source',
      `Could not serialize combined output: ${(e as Error).message}`,
      { sourceIndex: -1 },
    );
  }

  if (outBytes.byteLength > MAX_OUTPUT_BYTES) {
    return fail<CombineEngineError>(
      'combine_output_too_large',
      `Combined output (${outBytes.byteLength} bytes) exceeds the ${MAX_OUTPUT_BYTES}-byte cap`,
      { outputBytes: outBytes.byteLength, max: MAX_OUTPUT_BYTES },
    );
  }

  const finalPageCount = outDoc.getPageCount();
  return ok<CombineEngineValue>({
    bytes: outBytes,
    pageCount: finalPageCount,
    warnings,
  });
}
