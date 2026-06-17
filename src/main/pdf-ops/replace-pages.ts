// Phase 7.5 Wave 2 — B10 Replace Pages engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4 (B10 row, page-ops-engine
// family) and docs/api-contracts.md §19.2.4 (`pdf:replacePages`).
//
// What this module does:
//   Replace a contiguous target-page range with a contiguous source-page range.
//   Mechanics:
//     1. Copy source pages into the target via `copyPages`.
//     2. Insert the copies at the start of the target range.
//     3. Remove the original target-range pages (now shifted by `copied.length`).
//   Net effect: pages [targetStart..targetEnd] in the target are replaced by
//   the source range; everything before / after is preserved verbatim
//   including annotations, structure tree, etc. (we mutate the target doc in
//   place — no rebuild-from-scratch — so authored bookmarks etc. survive).
//
// Pure function: no fs / no IPC / no console.log; input bytes untouched.

import { PDFDocument } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

export interface ReplacePagesOptions {
  /** Target document bytes (the one we replace pages IN). NEVER mutated. */
  targetBytes: Uint8Array;
  /** Source document bytes (the one we pull replacement pages FROM). */
  sourceBytes: Uint8Array;
  /** Inclusive 0-based target-page range to remove. */
  targetRange: { start: number; end: number };
  /** Inclusive 0-based source-page range to insert in place of the target range. */
  sourceRange: { start: number; end: number };
}

export type ReplacePagesError =
  | 'target_load_failed'
  | 'source_load_failed'
  | 'invalid_target_range'
  | 'invalid_source_range'
  | 'target_page_out_of_range'
  | 'source_page_out_of_range'
  | 'engine_failed';

export interface ReplacePagesValue {
  bytes: Uint8Array;
  pagesReplaced: number;
  newPageCount: number;
  warnings: string[];
}

export type ReplacePagesResult = Result<ReplacePagesValue, ReplacePagesError>;

// ============================================================================
// Engine
// ============================================================================

export async function replacePages(opts: ReplacePagesOptions): Promise<ReplacePagesResult> {
  // 1. Load both docs.
  let targetDoc: PDFDocument;
  try {
    targetDoc = await PDFDocument.load(opts.targetBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<ReplacePagesError>('target_load_failed', (e as Error).message ?? 'unknown');
  }

  let sourceDoc: PDFDocument;
  try {
    sourceDoc = await PDFDocument.load(opts.sourceBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<ReplacePagesError>('source_load_failed', (e as Error).message ?? 'unknown');
  }

  const targetPageCount = targetDoc.getPageCount();
  const sourcePageCount = sourceDoc.getPageCount();

  // 2. Validate ranges.
  const tRangeErr = validateRange(opts.targetRange, targetPageCount, 'target');
  if (tRangeErr) {
    return fail<ReplacePagesError>(
      tRangeErr.kind === 'invalid' ? 'invalid_target_range' : 'target_page_out_of_range',
      tRangeErr.message,
      tRangeErr.details,
    );
  }
  const sRangeErr = validateRange(opts.sourceRange, sourcePageCount, 'source');
  if (sRangeErr) {
    return fail<ReplacePagesError>(
      sRangeErr.kind === 'invalid' ? 'invalid_source_range' : 'source_page_out_of_range',
      sRangeErr.message,
      sRangeErr.details,
    );
  }

  // 3. Copy source pages.
  const sourceIndices: number[] = [];
  for (let i = opts.sourceRange.start; i <= opts.sourceRange.end; i += 1) {
    sourceIndices.push(i);
  }

  let copied;
  try {
    copied = await targetDoc.copyPages(sourceDoc, sourceIndices);
  } catch (e) {
    return fail<ReplacePagesError>(
      'engine_failed',
      `copyPages threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  // 4. Insert at the start of the target range; then remove the now-shifted
  //    original target pages. Order matters: insert FIRST so the removal index
  //    arithmetic is straightforward (we know the original target pages are
  //    now at [targetRange.start + copied.length .. targetRange.end + copied.length]).
  try {
    for (let i = 0; i < copied.length; i += 1) {
      targetDoc.insertPage(opts.targetRange.start + i, copied[i]!);
    }
  } catch (e) {
    return fail<ReplacePagesError>(
      'engine_failed',
      `insertPage threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  // Remove the original target-range pages. They are at indices
  // [targetRange.start + copied.length .. targetRange.end + copied.length].
  // We remove from the END to keep earlier indices stable.
  const targetCount = opts.targetRange.end - opts.targetRange.start + 1;
  try {
    for (let i = targetCount - 1; i >= 0; i -= 1) {
      targetDoc.removePage(opts.targetRange.start + copied.length + i);
    }
  } catch (e) {
    return fail<ReplacePagesError>(
      'engine_failed',
      `removePage threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  // 5. Serialize.
  let outBytes: Uint8Array;
  try {
    outBytes = await targetDoc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<ReplacePagesError>(
      'engine_failed',
      `save threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  return ok<ReplacePagesValue>({
    bytes: outBytes,
    pagesReplaced: targetCount,
    newPageCount: targetDoc.getPageCount(),
    warnings: [],
  });
}

// ============================================================================
// Helpers
// ============================================================================

interface RangeError {
  kind: 'invalid' | 'out_of_range';
  message: string;
  details?: Record<string, unknown>;
}

function validateRange(
  range: { start: number; end: number },
  pageCount: number,
  label: string,
): RangeError | null {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    return { kind: 'invalid', message: `${label} range start/end must be integers` };
  }
  if (range.start < 0) {
    return { kind: 'invalid', message: `${label} range start must be >= 0` };
  }
  if (range.end < range.start) {
    return { kind: 'invalid', message: `${label} range end must be >= start` };
  }
  if (range.end >= pageCount) {
    return {
      kind: 'out_of_range',
      message: `${label} range end ${range.end} >= pageCount ${pageCount}`,
      details: { end: range.end, pageCount },
    };
  }
  return null;
}
