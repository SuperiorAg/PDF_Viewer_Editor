// Phase 7.5 Wave 2 — B10 Split Document engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4 (B10 row, page-ops-engine
// family) and docs/api-contracts.md §19.2.3 (`pdf:splitDocument`).
//
// What this module does:
//   Partition a source PDF into N output documents per the chosen strategy:
//     - `by-page-count`  : every K pages becomes its own output.
//     - `by-file-count`  : split into M evenly-sized outputs (last one absorbs
//                           the remainder).
//     - `by-bookmarks`   : split at every top-level outline entry.
//
//   For each part, build the output via `PDFDocument.create() + copyPages` so
//   document-level catalog dicts do NOT cross (consistent with extract-pages
//   and combine.ts).
//
// What this module does NOT do:
//   - Write to disk. The IPC handler owns fs.
//   - Carry document-level outlines into parts. Outlines that span parts
//     would need rewriting; we emit a `bookmarks_not_preserved` warning when
//     the source has outlines.
//
// Pure function — no fs / no IPC / no console.log; input bytes untouched.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

import { hasOutlines } from './extract-pages.js';

// ============================================================================
// Public types
// ============================================================================

export type SplitStrategy =
  | { kind: 'by-page-count'; pagesPerFile: number }
  | { kind: 'by-file-count'; targetFileCount: number }
  | { kind: 'by-bookmarks'; topLevelOnly: boolean };

export interface SplitDocumentOptions {
  pdfBytes: Uint8Array;
  strategy: SplitStrategy;
}

export type SplitDocumentError =
  | 'pdf_load_failed'
  | 'invalid_strategy'
  | 'no_bookmarks_for_split'
  | 'engine_failed';

export interface SplitDocumentPart {
  pageRange: { start: number; end: number };
  newBytes: Uint8Array;
}

export interface SplitDocumentValue {
  parts: SplitDocumentPart[];
  warnings: string[];
}

export type SplitDocumentResult = Result<SplitDocumentValue, SplitDocumentError>;

// ============================================================================
// Engine
// ============================================================================

export async function splitDocument(opts: SplitDocumentOptions): Promise<SplitDocumentResult> {
  // 1. Load.
  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<SplitDocumentError>('pdf_load_failed', (e as Error).message ?? 'unknown');
  }

  const pageCount = srcDoc.getPageCount();
  if (pageCount === 0) {
    return ok<SplitDocumentValue>({ parts: [], warnings: ['source has 0 pages'] });
  }

  // 2. Plan the per-part page ranges.
  const planRes = planParts(opts.strategy, pageCount, srcDoc);
  if (!planRes.ok) return planRes;
  const ranges = planRes.value;

  const warnings: string[] = [];
  if (hasOutlines(srcDoc)) warnings.push('bookmarks_not_preserved');

  // 3. Build one output PDF per part.
  const parts: SplitDocumentPart[] = [];
  for (let p = 0; p < ranges.length; p += 1) {
    const { start, end } = ranges[p]!;
    const indices: number[] = [];
    for (let i = start; i <= end; i += 1) indices.push(i);

    let outDoc: PDFDocument;
    try {
      outDoc = await PDFDocument.create();
    } catch (e) {
      return fail<SplitDocumentError>(
        'engine_failed',
        `PDFDocument.create threw: ${(e as Error).message ?? 'unknown'}`,
        { partIndex: p },
      );
    }

    let copied;
    try {
      copied = await outDoc.copyPages(srcDoc, indices);
    } catch (e) {
      return fail<SplitDocumentError>(
        'engine_failed',
        `copyPages threw on part ${p}: ${(e as Error).message ?? 'unknown'}`,
        { partIndex: p },
      );
    }
    for (const pg of copied) outDoc.addPage(pg);

    let outBytes: Uint8Array;
    try {
      outBytes = await outDoc.save({ useObjectStreams: true });
    } catch (e) {
      return fail<SplitDocumentError>(
        'engine_failed',
        `save threw on part ${p}: ${(e as Error).message ?? 'unknown'}`,
        { partIndex: p },
      );
    }

    parts.push({ pageRange: { start, end }, newBytes: outBytes });
  }

  return ok<SplitDocumentValue>({ parts, warnings });
}

// ============================================================================
// Plan helpers
// ============================================================================

function planParts(
  strategy: SplitStrategy,
  pageCount: number,
  srcDoc: PDFDocument,
): Result<Array<{ start: number; end: number }>, SplitDocumentError> {
  if (strategy.kind === 'by-page-count') {
    if (!Number.isInteger(strategy.pagesPerFile) || strategy.pagesPerFile <= 0) {
      return fail<SplitDocumentError>(
        'invalid_strategy',
        'pagesPerFile must be a positive integer',
      );
    }
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < pageCount; start += strategy.pagesPerFile) {
      const end = Math.min(start + strategy.pagesPerFile - 1, pageCount - 1);
      ranges.push({ start, end });
    }
    return ok(ranges);
  }
  if (strategy.kind === 'by-file-count') {
    if (!Number.isInteger(strategy.targetFileCount) || strategy.targetFileCount <= 0) {
      return fail<SplitDocumentError>(
        'invalid_strategy',
        'targetFileCount must be a positive integer',
      );
    }
    const fileCount = Math.min(strategy.targetFileCount, pageCount);
    const perFile = Math.floor(pageCount / fileCount);
    const remainder = pageCount % fileCount;
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (let i = 0; i < fileCount; i += 1) {
      // Distribute the remainder one extra page per file across the first
      // `remainder` files. Net effect: at most a 1-page imbalance.
      const size = perFile + (i < remainder ? 1 : 0);
      const start = cursor;
      const end = start + size - 1;
      ranges.push({ start, end });
      cursor += size;
    }
    return ok(ranges);
  }
  // kind: 'by-bookmarks'
  const bookmarkPages = collectBookmarkPageIndices(srcDoc, strategy.topLevelOnly);
  if (bookmarkPages.length === 0) {
    return fail<SplitDocumentError>(
      'no_bookmarks_for_split',
      'source has no usable outline entries for split-by-bookmarks',
    );
  }
  // Cut points = sorted unique bookmark page indices. Each part runs from
  // its cut to the next cut - 1 (last part ends at pageCount - 1).
  const sorted = Array.from(new Set(bookmarkPages))
    .filter((ix) => Number.isInteger(ix) && ix >= 0 && ix < pageCount)
    .sort((a, b) => a - b);
  if (sorted.length === 0 || sorted[0] !== 0) {
    // Ensure the very first part starts at page 0 even if the first bookmark
    // is on a later page (the leading "no-bookmark" range becomes part 1).
    sorted.unshift(0);
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const start = sorted[i]!;
    const end = i + 1 < sorted.length ? sorted[i + 1]! - 1 : pageCount - 1;
    if (start <= end) ranges.push({ start, end });
  }
  return ok(ranges);
}

// ============================================================================
// Outline reader — low-level pdf-lib dict walk
// ============================================================================
//
// pdf-lib does not expose a high-level outline reader. We walk /Outlines via
// PDFDict.lookupMaybe. For each outline entry we resolve `/Dest` (direct dest
// array) or `/A` -> /D (action -> destination) to a page reference, then map
// that page reference back to a 0-based page index via `getPageIndices()`.
//
// Defensive: any failure inside the walker is swallowed (returns whatever
// indices we managed to collect). Worst case, the caller gets
// `no_bookmarks_for_split` and falls back to choosing a different strategy.

export function collectBookmarkPageIndices(doc: PDFDocument, topLevelOnly: boolean): number[] {
  try {
    const catalog = doc.catalog;
    const outlines = catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
    if (!outlines) return [];

    // Build a Ref -> 0-based-index lookup for all pages.
    const refToIndex = buildRefToIndexMap(doc);
    if (refToIndex.size === 0) return [];

    const pages: number[] = [];
    const root = outlines;
    const firstChild = root.lookupMaybe(PDFName.of('First'), PDFDict);
    if (!firstChild) return [];
    walkOutlineLevel(doc, firstChild, refToIndex, pages, topLevelOnly);
    return pages;
  } catch {
    return [];
  }
}

function buildRefToIndexMap(doc: PDFDocument): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i += 1) {
      const ref = pages[i]!.ref;
      // Stable key from PDFRef — toString() returns "<obj> <gen> R".
      map.set(ref.toString(), i);
    }
  } catch {
    return map;
  }
  return map;
}

function walkOutlineLevel(
  doc: PDFDocument,
  startEntry: PDFDict,
  refToIndex: Map<string, number>,
  acc: number[],
  topLevelOnly: boolean,
): void {
  let current: PDFDict | undefined = startEntry;
  let safety = 0;
  while (current && safety < 10_000) {
    safety += 1;
    // Try to resolve destination -> page ref -> index.
    const pageIndex = resolveOutlineDestination(doc, current, refToIndex);
    if (pageIndex !== null) acc.push(pageIndex);

    if (!topLevelOnly) {
      const child = current.lookupMaybe(PDFName.of('First'), PDFDict);
      if (child) walkOutlineLevel(doc, child, refToIndex, acc, false);
    }

    const next: PDFDict | undefined = current.lookupMaybe(PDFName.of('Next'), PDFDict);
    current = next;
  }
}

function resolveOutlineDestination(
  doc: PDFDocument,
  entry: PDFDict,
  refToIndex: Map<string, number>,
): number | null {
  // Direct /Dest array: [pageRef /XYZ left top zoom] (or other dest types).
  const directDest = entry.lookupMaybe(PDFName.of('Dest'), PDFArray);
  if (directDest && directDest.size() > 0) {
    const ix = pageRefFromDestArray(directDest, refToIndex);
    if (ix !== null) return ix;
  }
  // Indirect /A action -> /D (which may itself be an array or a name pointing
  // into the /Names tree). We support the common direct-array shape only;
  // named destinations resolve via /Names -> /Dests which is out of scope for
  // this walker (split-by-bookmarks for those docs falls through to "no
  // bookmarks"; the user picks a different strategy).
  const action = entry.lookupMaybe(PDFName.of('A'), PDFDict);
  if (action) {
    const arr = action.lookupMaybe(PDFName.of('D'), PDFArray);
    if (arr && arr.size() > 0) {
      const ix = pageRefFromDestArray(arr, refToIndex);
      if (ix !== null) return ix;
    }
  }
  return null;
}

function pageRefFromDestArray(arr: PDFArray, refToIndex: Map<string, number>): number | null {
  // First entry is the destination page — either a PDFRef (typical) or a
  // PDFNumber (page index, less common but legal for remote-go-to actions).
  const head = arr.get(0);
  if (head instanceof PDFRef) {
    return refToIndex.get(head.toString()) ?? null;
  }
  if (head instanceof PDFNumber) {
    // Numeric page index in a /D array is only legal for remote dests; treat
    // defensively but accept if it lands in our page-index range.
    const ix = head.asNumber();
    if (Number.isInteger(ix) && ix >= 0) return ix;
  }
  return null;
}
