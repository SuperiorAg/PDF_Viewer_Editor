// Phase 7.5 Wave 2 — B10 Extract Pages engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4 (B10 row, page-ops-engine
// family) and docs/api-contracts.md §19.2.2 (`pdf:extractPages`).
//
// What this module does:
//   Create a fresh PDF containing the requested page indices, in the order
//   given. Uses pdf-lib's `PDFDocument.create() + copyPages()` — the same
//   strip-by-construction sanitize pattern as combine.ts. Document-level
//   catalog dicts (JS, EmbeddedFiles, AcroForm, Outlines, OpenAction, AA, ...)
//   do NOT cross.
//
// What this module does NOT do:
//   - Write to disk. The handler owns fs.
//   - Carry document-level bookmarks. The api-contracts §19.2.2 includes an
//     `includeBookmarks` flag; this is reserved in the engine signature but
//     stays as a v1 warning ("bookmarks_not_preserved") because the canonical
//     copyPages path strips /Outlines. The handler can opt out by ignoring
//     the warning; full outline-rewrite is a Wave 5+ enhancement once Riley's
//     outline editor lands.
//
// Pure-function discipline (mirrors combine.ts / crop-engine.ts):
//   no fs / no IPC / no console.log / input bytes untouched.

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

/** Page selection — matches api-contracts §19.2.2 `pages` union. */
export type ExtractPageRange =
  | { kind: 'range'; start: number; end: number } // inclusive
  | { kind: 'list'; indices: ReadonlyArray<number> };

export interface ExtractPagesOptions {
  pdfBytes: Uint8Array;
  pages: ExtractPageRange;
  /** When true, the engine emits a `bookmarks_not_preserved` warning if the
   *  source has /Outlines. Default: true (matches contract default). */
  includeBookmarks?: boolean;
}

export type ExtractPagesError =
  | 'pdf_load_failed'
  | 'invalid_page_range'
  | 'page_out_of_range'
  | 'no_pages_in_range'
  | 'engine_failed';

export interface ExtractPagesValue {
  bytes: Uint8Array;
  pagesExtracted: number;
  warnings: string[];
}

export type ExtractPagesResult = Result<ExtractPagesValue, ExtractPagesError>;

export const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;

// ============================================================================
// Engine
// ============================================================================

export async function extractPages(opts: ExtractPagesOptions): Promise<ExtractPagesResult> {
  const includeBookmarks = opts.includeBookmarks ?? true;

  // 1. Load the source.
  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<ExtractPagesError>('pdf_load_failed', (e as Error).message ?? 'unknown');
  }

  const pageCount = srcDoc.getPageCount();

  // 2. Resolve the index list (preserves the user-supplied order; deduped).
  const indicesRes = resolvePageRange(opts.pages, pageCount);
  if (!indicesRes.ok) return indicesRes;
  const indices = indicesRes.value;
  if (indices.length === 0) {
    return fail<ExtractPagesError>('no_pages_in_range', 'page range resolved to zero pages');
  }

  // 3. Build the output via PDFDocument.create() + copyPages.
  const warnings: string[] = [];
  if (includeBookmarks && hasOutlines(srcDoc)) {
    warnings.push('bookmarks_not_preserved');
  }

  let outDoc: PDFDocument;
  try {
    outDoc = await PDFDocument.create();
  } catch (e) {
    return fail<ExtractPagesError>(
      'engine_failed',
      `PDFDocument.create threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  let copied;
  try {
    copied = await outDoc.copyPages(srcDoc, indices as number[]);
  } catch (e) {
    return fail<ExtractPagesError>(
      'engine_failed',
      `copyPages threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  for (const p of copied) outDoc.addPage(p);

  // 4. Serialize.
  let outBytes: Uint8Array;
  try {
    outBytes = await outDoc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<ExtractPagesError>(
      'engine_failed',
      `save threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  if (outBytes.byteLength > MAX_OUTPUT_BYTES) {
    return fail<ExtractPagesError>(
      'engine_failed',
      `extracted output exceeds ${MAX_OUTPUT_BYTES} bytes`,
      { outputBytes: outBytes.byteLength, max: MAX_OUTPUT_BYTES },
    );
  }

  return ok<ExtractPagesValue>({
    bytes: outBytes,
    pagesExtracted: indices.length,
    warnings,
  });
}

// ============================================================================
// Helpers
// ============================================================================

export function resolvePageRange(
  pages: ExtractPageRange,
  pageCount: number,
): Result<number[], ExtractPagesError> {
  if (pages.kind === 'range') {
    if (!Number.isInteger(pages.start) || !Number.isInteger(pages.end)) {
      return fail<ExtractPagesError>('invalid_page_range', 'start/end must be integers');
    }
    if (pages.start < 0) {
      return fail<ExtractPagesError>('invalid_page_range', 'start must be >= 0');
    }
    if (pages.end < pages.start) {
      return fail<ExtractPagesError>('invalid_page_range', 'end must be >= start');
    }
    if (pages.end >= pageCount) {
      return fail<ExtractPagesError>(
        'page_out_of_range',
        `end ${pages.end} >= pageCount ${pageCount}`,
        { end: pages.end, pageCount },
      );
    }
    const out: number[] = [];
    for (let i = pages.start; i <= pages.end; i += 1) out.push(i);
    return ok(out);
  }
  // kind: 'list'
  const seen = new Set<number>();
  const out: number[] = [];
  for (const ix of pages.indices) {
    if (!Number.isInteger(ix) || ix < 0) {
      return fail<ExtractPagesError>('invalid_page_range', `index ${ix} is invalid`);
    }
    if (ix >= pageCount) {
      return fail<ExtractPagesError>('page_out_of_range', `index ${ix} >= pageCount ${pageCount}`, {
        index: ix,
        pageCount,
      });
    }
    if (!seen.has(ix)) {
      seen.add(ix);
      out.push(ix);
    }
  }
  return ok(out);
}

/**
 * Probe the source catalog for a /Outlines entry. Used to emit the
 * `bookmarks_not_preserved` warning (extract drops outlines by construction).
 */
export function hasOutlines(doc: PDFDocument): boolean {
  try {
    const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
    return outlines !== undefined;
  } catch {
    return false;
  }
}
