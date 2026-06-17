// Phase 7.5 Wave 4 — B6 Compress / Optimize PDF engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4.4 ("B6 Compress + B8
// Encryption + B20 Sanitize — the rebuild-from-scratch family") and
// docs/api-contracts.md §19.4.1 (`pdf:compressDocument`).
//
// What this module does:
//   Rebuild the source PDF from scratch via `PDFDocument.create() +
//   copyPages()`. The rebuild discards every unreachable indirect object that
//   the source `context.indirectObjects` would otherwise re-emit (Phase 7.4 B1
//   Wave 2 lesson, David, 2026-06-15). Serialize with `useObjectStreams: true`
//   so pdf-lib packs the surviving objects into compressed object streams.
//   This alone typically shrinks oversized PDFs (object stream packing) and
//   removes orphan attachments / metadata that linearization scripts forgot.
//
// What this module does NOT do (v0.8.0, with honest warnings):
//   - JPEG recompression: requires a raster recompressor (e.g. `sharp`,
//     Apache-2.0). NOT vendored in v0.8.0 to keep the install footprint
//     manageable. When `jpegRecompressQuality !== null`, the engine surfaces a
//     warning AND continues — the rebuild still shrinks the file.
//   - Image downsampling: same constraint (needs raster). Surfaced via
//     warning when `imageDownsampleDpi !== null`.
//   - Font subsetting: pdf-lib does not expose an "iterate embedded fonts +
//     subset" API. Custom fonts that the engine RE-embeds via
//     `embedFont(bytes, { subset: true })` could be subset, but that requires
//     extracting font bytes from the source (no public pdf-lib API today).
//     When `fontSubsetting` is true we surface a one-line warning that font
//     subsetting is deferred. `removeUnusedObjects` is what the rebuild
//     already does — no separate code path.
//
// Performance:
//   `copyPages(src, allIndices)` walks the page tree once. For a 1064-page
//   document this is the same hot path as the page-ops engines (extract /
//   split / replace). Engine yields after each page batch is queued so the
//   IPC handler can stay responsive (no explicit await-on-tick — pdf-lib's
//   `copyPages` is `async` so the event loop gets natural yield points).
//
// Locked-instruction compliance:
//   - L-001..L-006 (no BrowserWindow, no pdf.js, no test channel): satisfied.
//   - L-004 / L-005: no pdf.js usage — pure pdf-lib.

import { PDFDocument } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

import { stripDocLevelJavaScript } from './form-engine.js';

// ============================================================================
// Public types
// ============================================================================

export interface CompressDocumentOptions {
  pdfBytes: Uint8Array;
  /** Target DPI for image downsampling. `null` skips the step. Engine v0.8.0
   *  warns when non-null (raster dep not vendored). */
  imageDownsampleDpi: number | null;
  /** JPEG re-encode quality in `[0.5, 0.95]` (Acrobat's UI range) — also
   *  accepted as `null` for "leave originals". */
  jpegRecompressQuality: number | null;
  /** True = subset all custom-embedded fonts after rebuild. v0.8.0 warns. */
  fontSubsetting: boolean;
  /** True = rebuild from scratch (discards unreachable indirectObjects). The
   *  v0.8.0 engine ALWAYS rebuilds regardless; this flag is honored as the
   *  "user can disable rebuild for debug" knob — when false, the engine
   *  still saves via pdf-lib but skips the copyPages roundtrip. */
  removeUnusedObjects: boolean;
}

export type CompressDocumentError = 'pdf_load_failed' | 'invalid_payload' | 'engine_failed';

export interface CompressDocumentValue {
  bytes: Uint8Array;
  originalBytes: number;
  compressedBytes: number;
  /** `(1 - compressed/original) * 100`, clamped to `[0, 100]`. May be 0 when
   *  the input is already well-optimized. */
  reductionPercent: number;
  warnings: string[];
}

export type CompressDocumentResult = Result<CompressDocumentValue, CompressDocumentError>;

// ============================================================================
// Engine
// ============================================================================

export async function compressDocument(
  opts: CompressDocumentOptions,
): Promise<CompressDocumentResult> {
  // 1. Validate.
  const payloadErr = validatePayload(opts);
  if (payloadErr) return fail<CompressDocumentError>('invalid_payload', payloadErr);

  // 2. Load source.
  const originalBytes = opts.pdfBytes.byteLength;
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<CompressDocumentError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const warnings: string[] = [];

  // 3. Collect honest warnings for options the engine cannot apply in v0.8.0.
  if (opts.imageDownsampleDpi !== null) {
    warnings.push(
      `image downsampling to ${opts.imageDownsampleDpi} DPI was requested but is not implemented in v0.8.0 (needs raster recompressor; sharp not vendored); rebuild proceeds without it`,
    );
  }
  if (opts.jpegRecompressQuality !== null) {
    warnings.push(
      `JPEG recompression at quality ${opts.jpegRecompressQuality} was requested but is not implemented in v0.8.0 (needs raster recompressor; sharp not vendored); rebuild proceeds without it`,
    );
  }
  if (opts.fontSubsetting) {
    warnings.push(
      'font subsetting was requested but pdf-lib does not expose iterate-embedded-fonts in v0.8.0; rebuild still drops orphan font objects via removeUnusedObjects',
    );
  }

  // 4. Rebuild-from-scratch when removeUnusedObjects is true (default).
  //    Pattern locked by P7.5-L-12 (architecture §4.4): pdf-lib emits every
  //    object in `context.indirectObjects` regardless of reachability, so the
  //    only reliable way to drop unreachable objects is to copy the pages
  //    into a fresh PDFDocument and discard the original context entirely.
  let outBytes: Uint8Array;
  try {
    if (opts.removeUnusedObjects) {
      const dst = await PDFDocument.create({ updateMetadata: false });
      const indices = src.getPageIndices();
      const pages = await dst.copyPages(src, indices);
      for (const page of pages) dst.addPage(page);
      // Belt-and-braces — strip any catalog-level JS that survived rebuild
      // (defense in depth; copyPages does not carry catalog actions, but a
      // hostile or malformed PDF might still smuggle).
      stripDocLevelJavaScript(dst);
      outBytes = await dst.save({ useObjectStreams: true });
    } else {
      // Non-rebuild path: just re-serialize with object streams. Useful when
      // the caller wants the fastest possible "make the file smaller via
      // packing alone" without paying the copy cost.
      outBytes = await src.save({ useObjectStreams: true });
    }
  } catch (e) {
    return fail<CompressDocumentError>(
      'engine_failed',
      e instanceof Error && e.message ? `save threw: ${e.message}` : 'save threw',
    );
  }

  const compressedBytes = outBytes.byteLength;
  const ratio = originalBytes > 0 ? 1 - compressedBytes / originalBytes : 0;
  const reductionPercent = clamp01(ratio) * 100;

  return ok<CompressDocumentValue>({
    bytes: outBytes,
    originalBytes,
    compressedBytes,
    reductionPercent,
    warnings,
  });
}

// ============================================================================
// Validation
// ============================================================================

function validatePayload(opts: CompressDocumentOptions): string | null {
  if (!(opts.pdfBytes instanceof Uint8Array) || opts.pdfBytes.byteLength === 0) {
    return 'pdfBytes must be a non-empty Uint8Array';
  }
  if (opts.imageDownsampleDpi !== null) {
    if (!Number.isFinite(opts.imageDownsampleDpi) || opts.imageDownsampleDpi <= 0) {
      return 'imageDownsampleDpi must be a positive number or null';
    }
  }
  if (opts.jpegRecompressQuality !== null) {
    if (
      !Number.isFinite(opts.jpegRecompressQuality) ||
      opts.jpegRecompressQuality < 0 ||
      opts.jpegRecompressQuality > 1
    ) {
      return 'jpegRecompressQuality must be in [0, 1] or null';
    }
  }
  if (typeof opts.fontSubsetting !== 'boolean') {
    return 'fontSubsetting must be a boolean';
  }
  if (typeof opts.removeUnusedObjects !== 'boolean') {
    return 'removeUnusedObjects must be a boolean';
  }
  return null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
