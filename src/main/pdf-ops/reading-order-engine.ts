// Phase 7.5 Wave 5c — C4 Reading-order engine.
//
// Canonical spec:
//   - docs/architecture-phase-7.5.md §4.8.
//   - docs/api-contracts.md §19.7.4.
//   - docs/accessibility-authoring-spec.md (reading-order section).
//
// What this module does:
//   - `getReadingOrder(bytes, opts?)` walks the existing /StructTreeRoot
//     in-order and emits a flat list of `ReadingOrderBlock`s — one per
//     leaf-or-section structure element. Each block carries a stable id
//     (`struct:<objectNumber>`), pageIndex, an order index, optional bbox,
//     and a short text snippet. The walker is per-page-filterable so the
//     renderer can fetch only the visible page on a 1064-page PDF without
//     eager-walking the whole tree.
//   - `setReadingOrder(bytes, newOrder)` reorders the top-level /K array of
//     /StructTreeRoot to match the requested order. The structure elements
//     themselves are left intact (their object numbers and contents
//     unchanged) — only the parent /K array order changes.
//   - `autoDetectReadingOrderFromLayout(blocks)` — pure spatial sort
//     (top-to-bottom, left-to-right) on the supplied blocks. Used by the
//     "Auto-detect from layout" button in the C4 overlay. Engine stays
//     pure: bboxes come from the caller (the production extractor
//     reads them via pdf.js + struct-tree mcid → bbox mapping).
//
// What this module does NOT do (honest deferrals):
//   - Walk nested structure children. Reading-order acts on the doc's
//     TOP-LEVEL block sequence (the children directly under
//     /StructTreeRoot's /K). Nested children (e.g. the <p>s inside a
//     <Sect>) are NOT exposed as independent reading-order entries; they
//     ride along with their parent block. This matches Acrobat's reading-
//     order tool behavior and avoids tree-mutation hazards.
//   - Re-author content streams. We change only the structure-element
//     order in /K; the underlying page content (text positions, mcid
//     markers) is unchanged. PDF readers compute reading order from the
//     struct tree's /K order (PDF 1.7 §14.7), so a /K reorder IS the
//     reading-order change.
//   - Extract bboxes from page content. The engine takes bboxes from the
//     caller; production wires them via a pdf.js text-content walker.
//
// Locked-instruction compliance:
//   - L-001..L-006 (no BrowserWindow, pure pdf-lib module, no test channel,
//     no direct pdf.js import).
//   - P7.5-L-12 (rebuild-from-scratch): the write path rebuilds /K from
//     scratch using the existing structure-element refs in the requested
//     order — no orphan refs survive.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  PDFHexString,
  type PDFObject,
} from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

export type ReadingOrderEngineError =
  | 'invalid_payload'
  | 'pdf_load_failed'
  | 'no_struct_tree'
  | 'order_inconsistent'
  | 'engine_failed';

/** A flat reading-order block surfaced from the in-PDF struct tree. */
export interface ReadingOrderBlock {
  /** Stable id `struct:<objectNumber>`. Survives round-trips because the
   *  source object number is invariant for pdf-lib-loaded indirect dicts. */
  structNodeId: string;
  /** Current 0-based order within the doc. */
  order: number;
  /** Page index taken from /Pg on the structure element, or -1 when no
   *  page hint is recoverable (rare but valid). The contract guarantees
   *  non-negative; the handler clamps -1 to 0. */
  pageIndex: number;
  /** [llx, lly, urx, ury] in user-space points. Engine returns
   *  `[0,0,0,0]` when no bbox hint is recoverable; the production
   *  extractor refines via pdf.js mcid → bbox mapping. */
  bbox: [number, number, number, number];
  /** First 80 chars of /ActualText or the structure type label — used by
   *  the overlay tooltip. */
  snippet: string;
  /** Structure-element type ("H1" / "P" / "Figure" / ...). */
  type: string;
}

export interface GetReadingOrderValue {
  blocks: ReadingOrderBlock[];
  warnings: string[];
}

export interface GetReadingOrderOptions {
  /** When provided, return only blocks whose pageIndex matches. Engine
   *  still walks every top-level child (the walk is O(n) anyway), but
   *  emits a filtered list. Use this on the 1064-page PDF to keep
   *  the renderer payload small. */
  pageIndex?: number;
  /** Phase 7.5 Wave 5d carry-over (David, 2026-06-17).
   *
   *  When `true`, recompute order from a spatial bbox / text walker
   *  rather than returning the /K-derived order. v0.8.0 ships WITHOUT a
   *  production bbox extractor wired in this code path, so the honest
   *  behaviour is: still return /K order, but emit the warning
   *  `reading-order.recompute.no-extractor-wired` so Riley's "Auto-
   *  detect from layout" button can show the gap to the user rather
   *  than silently pretending the layout walker ran.
   *
   *  When the future extractor lands, this is the seam — wire a layout
   *  walker via the handler's deps and the engine emits the recomputed
   *  order without contract churn. */
  recompute?: boolean;
}

export interface SetReadingOrderValue {
  bytes: Uint8Array;
  warnings: string[];
}

// Eager-walk cap. Matches struct-tree-engine.MAX_NODES_EAGER for
// consistency. The reading-order walk is one level deep so the cap is
// only relevant for pathological docs.
const MAX_TOP_LEVEL_BLOCKS = 50_000;

// =====================================================================
// Read direction
// =====================================================================

export async function getReadingOrder(
  pdfBytes: Uint8Array,
  options: GetReadingOrderOptions = {},
): Promise<Result<GetReadingOrderValue, ReadingOrderEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<ReadingOrderEngineError>(
      'invalid_payload',
      'pdfBytes must be a non-empty Uint8Array',
    );
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<ReadingOrderEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const structRoot = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
  if (!structRoot) {
    return fail<ReadingOrderEngineError>(
      'no_struct_tree',
      'document has no /StructTreeRoot — tag the PDF first',
    );
  }

  const warnings: string[] = [];
  const pageRefToIndex = buildPageRefIndex(doc);

  const kEntry = structRoot.get(PDFName.of('K'));
  if (kEntry === undefined) {
    return ok<GetReadingOrderValue>({ blocks: [], warnings });
  }

  if (options.recompute === true) {
    // v0.8.0 has no production bbox/text walker wired into the engine
    // itself. Surface the gap honestly per the contract JSDoc rather
    // than silently returning the same /K order without disclosure.
    // A future wave that wires the layout walker can replace this
    // warning with the recomputed blocks.
    warnings.push('reading-order.recompute.no-extractor-wired');
  }

  const blocks: ReadingOrderBlock[] = [];
  let order = 0;
  const walk = (obj: PDFObject): void => {
    if (blocks.length >= MAX_TOP_LEVEL_BLOCKS) {
      if (!warnings.includes('truncated')) {
        warnings.push(`Reading-order list truncated at ${MAX_TOP_LEVEL_BLOCKS} entries.`);
      }
      return;
    }
    const resolved = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
    if (resolved === undefined) return;
    if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i += 1) {
        const e = resolved.get(i);
        if (e !== undefined) walk(e);
      }
      return;
    }
    if (!(resolved instanceof PDFDict)) {
      // Naked mcid at the root level — not a top-level reading-order entry.
      return;
    }
    const sName = resolved.lookupMaybe(PDFName.of('S'), PDFName);
    if (!sName) {
      // Marked-content dict at the root level — not a reading-order block.
      return;
    }
    // We need the source object number to build a stable id. If the entry
    // came as a PDFRef we have it; otherwise we synthesise a transient id
    // (negative). Transient ids cannot be used by setReadingOrder.
    const objectNumber = obj instanceof PDFRef ? obj.objectNumber : -1;
    if (objectNumber < 0) {
      warnings.push('skipped inline structure element — has no stable id');
      return;
    }
    const structType = stripLeadingSlash(sName.asString());
    const pageIndex = readPgIndex(resolved, pageRefToIndex);
    const actualText = readStringy(resolved, 'ActualText');
    const altText = readStringy(resolved, 'Alt');
    const snippet = trimSnippet(actualText ?? altText ?? structType);
    const block: ReadingOrderBlock = {
      structNodeId: `struct:${objectNumber}`,
      order: order++,
      pageIndex: pageIndex ?? 0,
      bbox: [0, 0, 0, 0],
      snippet,
      type: structType,
    };
    if (options.pageIndex === undefined || block.pageIndex === options.pageIndex) {
      blocks.push(block);
    }
  };
  walk(kEntry);

  return ok<GetReadingOrderValue>({ blocks, warnings });
}

// =====================================================================
// Write direction
// =====================================================================

export async function setReadingOrder(
  pdfBytes: Uint8Array,
  newOrder: ReadonlyArray<{ structNodeId: string; order: number }>,
): Promise<Result<SetReadingOrderValue, ReadingOrderEngineError>> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    return fail<ReadingOrderEngineError>(
      'invalid_payload',
      'pdfBytes must be a non-empty Uint8Array',
    );
  }
  if (!Array.isArray(newOrder)) {
    return fail<ReadingOrderEngineError>('invalid_payload', 'newOrder must be an array');
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<ReadingOrderEngineError>(
      'pdf_load_failed',
      e instanceof Error && e.message ? e.message : 'pdf load failed',
    );
  }

  const structRoot = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict);
  if (!structRoot) {
    return fail<ReadingOrderEngineError>(
      'no_struct_tree',
      'document has no /StructTreeRoot — tag the PDF first',
    );
  }

  // Collect the current top-level refs by walking /K.
  const currentRefs: PDFRef[] = [];
  const refSeen = new Set<number>();
  const kEntry = structRoot.get(PDFName.of('K'));
  const collect = (obj: PDFObject): void => {
    if (obj instanceof PDFRef) {
      const target = doc.context.lookup(obj);
      if (target instanceof PDFDict) {
        const sName = target.lookupMaybe(PDFName.of('S'), PDFName);
        if (sName && !refSeen.has(obj.objectNumber)) {
          refSeen.add(obj.objectNumber);
          currentRefs.push(obj);
        }
      }
      return;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i += 1) {
        const e = obj.get(i);
        if (e !== undefined) collect(e);
      }
    }
    // Inline dicts at the root level cannot be reordered (no stable ref).
  };
  if (kEntry !== undefined) collect(kEntry);

  if (currentRefs.length === 0) {
    return fail<ReadingOrderEngineError>(
      'no_struct_tree',
      '/StructTreeRoot has no addressable top-level structure elements',
    );
  }

  // Build the requested permutation. Every existing top-level ref MUST
  // appear exactly once in the requested order; missing or duplicated
  // entries are rejected as `order_inconsistent`. Unknown ids are also
  // rejected — the engine refuses partial reorderings to keep the file
  // in a sane state (P7.5-L-12: rebuild-from-scratch discipline applied
  // at the order level).
  const idToRef = new Map<string, PDFRef>();
  for (const r of currentRefs) idToRef.set(`struct:${r.objectNumber}`, r);

  const sorted = [...newOrder].sort((a, b) => a.order - b.order);
  const orderedRefs: PDFRef[] = [];
  const ordersSeen = new Set<number>();
  for (const entry of sorted) {
    if (typeof entry.structNodeId !== 'string') {
      return fail<ReadingOrderEngineError>(
        'invalid_payload',
        'every entry needs a string structNodeId',
      );
    }
    if (!Number.isInteger(entry.order) || entry.order < 0) {
      return fail<ReadingOrderEngineError>(
        'invalid_payload',
        'every entry needs an integer order >= 0',
      );
    }
    if (ordersSeen.has(entry.order)) {
      return fail<ReadingOrderEngineError>(
        'order_inconsistent',
        `duplicate order index ${entry.order}`,
      );
    }
    ordersSeen.add(entry.order);
    const ref = idToRef.get(entry.structNodeId);
    if (!ref) {
      return fail<ReadingOrderEngineError>(
        'order_inconsistent',
        `unknown structNodeId ${entry.structNodeId}`,
      );
    }
    orderedRefs.push(ref);
  }
  if (orderedRefs.length !== currentRefs.length) {
    return fail<ReadingOrderEngineError>(
      'order_inconsistent',
      `expected ${currentRefs.length} entries in newOrder, got ${orderedRefs.length}`,
    );
  }

  // Rebuild /K from the reordered refs. We replace the existing /K array
  // wholesale — pdf-lib leaves the original PDFArray in place inside the
  // /StructTreeRoot dict but we can swap it via .set(). The orphaned
  // PDFArray is unreachable; pdf-lib will not emit it on save.
  const ctx = doc.context;
  if (orderedRefs.length === 1) {
    structRoot.set(PDFName.of('K'), orderedRefs[0]!);
  } else {
    const kArr = PDFArray.withContext(ctx);
    for (const r of orderedRefs) kArr.push(r);
    structRoot.set(PDFName.of('K'), kArr);
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: false });
  } catch (e) {
    return fail<ReadingOrderEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `save threw: ${e.message}` : 'save threw',
    );
  }

  return ok<SetReadingOrderValue>({ bytes: outBytes, warnings: [] });
}

// =====================================================================
// Auto-detect from layout — pure spatial sort
// =====================================================================

export interface LayoutBlock {
  structNodeId: string;
  pageIndex: number;
  bbox: [number, number, number, number];
}

/** Sort blocks top-to-bottom, left-to-right within each page; preserves
 *  page order across the doc. Two blocks count as "on the same row" when
 *  their vertical centers are within `rowEpsilon` points (default 6pt —
 *  roughly half a single-spaced line). */
export function autoDetectReadingOrderFromLayout(
  blocks: ReadonlyArray<LayoutBlock>,
  rowEpsilon = 6,
): Array<{ structNodeId: string; order: number }> {
  const byPage = new Map<number, LayoutBlock[]>();
  for (const b of blocks) {
    const arr = byPage.get(b.pageIndex);
    if (arr) arr.push(b);
    else byPage.set(b.pageIndex, [b]);
  }
  const pageIndices = [...byPage.keys()].sort((a, b) => a - b);
  const out: Array<{ structNodeId: string; order: number }> = [];
  let order = 0;
  for (const pi of pageIndices) {
    const arr = byPage.get(pi)!;
    // PDF user-space origin is bottom-left, so "higher on the page" =
    // larger y. Sort by top-edge (bbox[3]) descending; ties (same row)
    // resolved by left-edge (bbox[0]) ascending.
    const sorted = [...arr].sort((a, b) => {
      const ay = a.bbox[3];
      const by = b.bbox[3];
      if (Math.abs(ay - by) > rowEpsilon) return by - ay;
      return a.bbox[0] - b.bbox[0];
    });
    for (const b of sorted) {
      out.push({ structNodeId: b.structNodeId, order: order++ });
    }
  }
  return out;
}

// =====================================================================
// Helpers
// =====================================================================

function buildPageRefIndex(doc: PDFDocument): Map<string, number> {
  const m = new Map<string, number>();
  const pageCount = doc.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    const ref = doc.getPage(i).ref;
    m.set(`${ref.objectNumber} ${ref.generationNumber}`, i);
  }
  return m;
}

function readPgIndex(dict: PDFDict, pageRefToIndex: Map<string, number>): number | null {
  const pg = dict.get(PDFName.of('Pg'));
  if (pg instanceof PDFRef) {
    const idx = pageRefToIndex.get(`${pg.objectNumber} ${pg.generationNumber}`);
    if (idx !== undefined) return idx;
  }
  return null;
}

function readStringy(dict: PDFDict, key: string): string | null {
  const v = dict.get(PDFName.of(key));
  if (v instanceof PDFString) return v.asString();
  if (v instanceof PDFHexString) return v.decodeText();
  return null;
}

function stripLeadingSlash(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name;
}

function trimSnippet(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}...`;
}
