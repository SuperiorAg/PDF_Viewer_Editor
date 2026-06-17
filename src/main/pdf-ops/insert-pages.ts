// Phase 7.5 Wave 2 — B11 Insert Pages From File engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4 (B11 row, page-ops-engine
// family) and docs/api-contracts.md §19.2.5 (`pdf:insertPagesFromFile`).
//
// What this module does:
//   Load target + source documents, copy the requested source-page range into
//   the target via pdf-lib's `copyPages`, splice them in at `insertAfterPageIndex`,
//   then save. The TARGET document is the one whose bytes return; the source
//   contributes pages only.
//
// What this module does NOT do:
//   - Touch document-level catalog dicts from EITHER document. Target's
//     existing catalog (AcroForm, Outlines, Metadata, ...) survives because we
//     mutate the existing target doc in place (no rebuild-from-scratch — the
//     target's authored bookmarks etc. should be preserved by design). Source's
//     catalog-level extras NEVER cross — `copyPages` only takes page content +
//     resources.
//   - Mutate input bytes. pdf-lib loads + serializes fresh.
//
// Insertion semantics (mirrors api-contracts §19.2.5):
//   `insertAfterPageIndex: -1` means "insert at the very start" (before page 0).
//   `insertAfterPageIndex: N` means "insert after page N" (so source becomes
//   page N+1 in the resulting target).
//
// Pure function: no fs / no IPC / no console.log.

import { PDFDocument } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

export type InsertSourcePageScope =
  | { kind: 'all' }
  | { kind: 'range'; start: number; end: number } // inclusive
  | { kind: 'list'; indices: ReadonlyArray<number> };

export interface InsertPagesFromFileOptions {
  /** Target document bytes (the one we add INTO). NEVER mutated. */
  targetBytes: Uint8Array;
  /** Source document bytes (the one we copy FROM). NEVER mutated. */
  sourceBytes: Uint8Array;
  /** Source-page selection. */
  sourcePages: InsertSourcePageScope;
  /** Insert after this 0-based target-page index. `-1` => insert before page 0. */
  insertAfterPageIndex: number;
}

export type InsertPagesFromFileError =
  | 'target_load_failed'
  | 'source_load_failed'
  | 'invalid_insertion_index'
  | 'invalid_page_range'
  | 'source_page_out_of_range'
  | 'no_source_pages_in_scope'
  | 'engine_failed';

export interface InsertPagesFromFileValue {
  bytes: Uint8Array;
  pagesInserted: number;
  newPageCount: number;
  warnings: string[];
}

export type InsertPagesFromFileResult = Result<InsertPagesFromFileValue, InsertPagesFromFileError>;

// ============================================================================
// Engine
// ============================================================================

export async function insertPagesFromFile(
  opts: InsertPagesFromFileOptions,
): Promise<InsertPagesFromFileResult> {
  // 1. Load both docs.
  let targetDoc: PDFDocument;
  try {
    targetDoc = await PDFDocument.load(opts.targetBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<InsertPagesFromFileError>('target_load_failed', (e as Error).message ?? 'unknown');
  }

  let sourceDoc: PDFDocument;
  try {
    sourceDoc = await PDFDocument.load(opts.sourceBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<InsertPagesFromFileError>('source_load_failed', (e as Error).message ?? 'unknown');
  }

  const targetPageCount = targetDoc.getPageCount();
  const sourcePageCount = sourceDoc.getPageCount();

  // 2. Validate insertion index. Range: [-1, targetPageCount] inclusive
  //    (-1 = before page 0; targetPageCount = after last page).
  if (!Number.isInteger(opts.insertAfterPageIndex)) {
    return fail<InsertPagesFromFileError>(
      'invalid_insertion_index',
      'insertAfterPageIndex must be an integer',
    );
  }
  if (opts.insertAfterPageIndex < -1 || opts.insertAfterPageIndex > targetPageCount - 1) {
    // We accept exactly the contract: -1 (start) through targetPageCount - 1
    // (after last). Anything beyond is rejected so we never silently snap.
    return fail<InsertPagesFromFileError>(
      'invalid_insertion_index',
      `insertAfterPageIndex ${opts.insertAfterPageIndex} out of range [-1, ${targetPageCount - 1}]`,
      { insertAfterPageIndex: opts.insertAfterPageIndex, targetPageCount },
    );
  }

  // 3. Resolve source-page scope.
  const scopeRes = resolveSourceScope(opts.sourcePages, sourcePageCount);
  if (!scopeRes.ok) return scopeRes;
  const sourceIndices = scopeRes.value;
  if (sourceIndices.length === 0) {
    return fail<InsertPagesFromFileError>(
      'no_source_pages_in_scope',
      'source-page scope resolved to zero pages',
    );
  }

  // 4. Copy source pages into target.
  let copied;
  try {
    copied = await targetDoc.copyPages(sourceDoc, sourceIndices as number[]);
  } catch (e) {
    return fail<InsertPagesFromFileError>(
      'engine_failed',
      `copyPages threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  // 5. Splice. pdf-lib's `insertPage(index, page)` inserts AT `index`. We
  //    convert "after page N" -> "at index N+1".
  const startInsertAt = opts.insertAfterPageIndex + 1;
  try {
    for (let i = 0; i < copied.length; i += 1) {
      targetDoc.insertPage(startInsertAt + i, copied[i]!);
    }
  } catch (e) {
    return fail<InsertPagesFromFileError>(
      'engine_failed',
      `insertPage threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  // 6. Serialize.
  let outBytes: Uint8Array;
  try {
    outBytes = await targetDoc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<InsertPagesFromFileError>(
      'engine_failed',
      `save threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  return ok<InsertPagesFromFileValue>({
    bytes: outBytes,
    pagesInserted: copied.length,
    newPageCount: targetDoc.getPageCount(),
    warnings: [],
  });
}

// ============================================================================
// Helpers
// ============================================================================

function resolveSourceScope(
  scope: InsertSourcePageScope,
  pageCount: number,
): Result<number[], InsertPagesFromFileError> {
  if (scope.kind === 'all') {
    const out: number[] = [];
    for (let i = 0; i < pageCount; i += 1) out.push(i);
    return ok(out);
  }
  if (scope.kind === 'range') {
    if (!Number.isInteger(scope.start) || !Number.isInteger(scope.end)) {
      return fail<InsertPagesFromFileError>('invalid_page_range', 'start/end must be integers');
    }
    if (scope.start < 0) {
      return fail<InsertPagesFromFileError>('invalid_page_range', 'start must be >= 0');
    }
    if (scope.end < scope.start) {
      return fail<InsertPagesFromFileError>('invalid_page_range', 'end must be >= start');
    }
    if (scope.end >= pageCount) {
      return fail<InsertPagesFromFileError>(
        'source_page_out_of_range',
        `end ${scope.end} >= sourcePageCount ${pageCount}`,
        { end: scope.end, sourcePageCount: pageCount },
      );
    }
    const out: number[] = [];
    for (let i = scope.start; i <= scope.end; i += 1) out.push(i);
    return ok(out);
  }
  // kind: 'list' — preserve order; dedupe.
  const seen = new Set<number>();
  const out: number[] = [];
  for (const ix of scope.indices) {
    if (!Number.isInteger(ix) || ix < 0) {
      return fail<InsertPagesFromFileError>(
        'invalid_page_range',
        `index ${ix} is not a non-negative integer`,
      );
    }
    if (ix >= pageCount) {
      return fail<InsertPagesFromFileError>(
        'source_page_out_of_range',
        `index ${ix} >= sourcePageCount ${pageCount}`,
        { index: ix, sourcePageCount: pageCount },
      );
    }
    if (!seen.has(ix)) {
      seen.add(ix);
      out.push(ix);
    }
  }
  return ok(out);
}
