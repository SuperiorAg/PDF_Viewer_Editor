// Reading-order contract stub — Phase 7.5 C4 (Riley Wave 5c).
//
// David's parallel Wave 5c commit landed `pdf:getReadingOrder` and
// `pdf:setReadingOrder` in `src/ipc/contracts.ts`. This stub carries a
// renderer-local widening that adds `'bridge_unavailable'` to the error
// union so the service wrappers can return a structurally-correct Result
// when `window.pdfApi.pdf.getReadingOrder` isn't exposed yet (Vitest +
// pre-bridge dev builds). The renderer types match
// `docs/api-contracts.md §19.7.4` plus that single widening.
//
// Wave 5d (Riley, 2026-06-18): the request now carries the canonical
// optional `recompute?: boolean` flag (David's contract field, contracts.ts
// line 2262). Setting `recompute: true` asks the engine to re-walk the
// layout-text extractor instead of returning the existing /K order — drives
// the Reading Order overlay's "Auto-detect from layout" button. When the
// production extractor isn't wired the engine emits the warning
// `'reading-order.recompute.no-extractor-wired'` which the overlay surfaces
// honestly via the recompute banner (no fake-success).
//
// HONESTY CLAUSE: the renderer applies a Reading-Order edit ONLY via
// `pdf:setReadingOrder` which writes through David's
// `accessibility_edit_session` side-table — the in-PDF /StructTreeRoot is
// NOT touched until Save (mirrors the Tag PDF behavior + the
// save-as-copy-by-default obligation, P7.5-L-5).
//
// No `as any` here — the runtime feature-detect lives in
// `state/thunks-phase7-5-wave5c.ts` and uses `window.pdfApi` narrowing,
// mirroring the Wave 5a/5b pattern.

import type { DocumentHandle } from './ipc-contract';

/** A single reading-order entry — one content block in the doc's flow.
 *  Matches `docs/api-contracts.md §19.7.4` verbatim.
 *  `bbox` is in PDF user-space (origin bottom-left, points). */
export interface ReadingOrderEntry {
  /** FK into `StructTreeNode.id`. Stable across the load. */
  structNodeId: string;
  /** 0-based page index. */
  pageIndex: number;
  /** 0-based ordering within the document — globally unique. */
  order: number;
  /** [x, y, width, height] in PDF user-space points. */
  bbox: [number, number, number, number];
}

// ---------------------------------------------------------------------------
// pdf:getReadingOrder
// ---------------------------------------------------------------------------

export interface PdfGetReadingOrderRequest {
  handle: DocumentHandle;
  /** Optional per-page filter (Wave 5d carry-over from David's canonical
   *  shape — load-bearing for large-PDF perf gate). */
  pageIndex?: number;
  /** When `true`, force the production bbox/text walker to re-run rather
   *  than returning whatever order the engine derived from the existing
   *  /K array. Drives Riley's "Auto-detect from layout" button so the
   *  overlay can fall through to a spatial sort without a contract
   *  churn. Mirrors David's canonical field name (contracts.ts §19.7.4). */
  recompute?: boolean;
}

export type PdfGetReadingOrderError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'no_struct_tree'
  | 'engine_failed';

export interface PdfGetReadingOrderValue {
  /** Sorted by `order` ascending. */
  order: ReadingOrderEntry[];
  /** Engine warnings (e.g. "10k-node truncation — only first 10000 returned",
   *  "reading-order.recompute.no-extractor-wired"). */
  warnings?: string[];
}

export type PdfGetReadingOrderResponse =
  | { ok: true; value: PdfGetReadingOrderValue }
  | {
      ok: false;
      error: PdfGetReadingOrderError | 'bridge_unavailable';
      message: string;
    };

// ---------------------------------------------------------------------------
// pdf:setReadingOrder — full ordering replacement.
//   Engine rejects partial submissions (`order_inconsistent`) to prevent
//   ambiguous flow on Save.
// ---------------------------------------------------------------------------

export interface PdfSetReadingOrderRequest {
  handle: DocumentHandle;
  /** Full ordering — every block in the doc, contiguous `order` 0..N-1. */
  order: ReadingOrderEntry[];
}

export type PdfSetReadingOrderError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'no_struct_tree'
  | 'order_inconsistent'
  | 'engine_failed';

export interface PdfSetReadingOrderValue {
  applied: true;
}

export type PdfSetReadingOrderResponse =
  | { ok: true; value: PdfSetReadingOrderValue }
  | {
      ok: false;
      error: PdfSetReadingOrderError | 'bridge_unavailable';
      message: string;
    };

// ---------------------------------------------------------------------------
// Renderer-only helpers — pure UI; no IPC parallel.
// ---------------------------------------------------------------------------

/** Resequence the entries after a drag-reorder: pluck `fromIndex`, insert at
 *  `toIndex` (post-removal), and rewrite the `order` field on every entry
 *  so the result is contiguous 0..N-1. Returns a fresh array; input is
 *  not mutated. Returns the same reference when fromIndex === toIndex
 *  (no-op short-circuit). */
export function moveOrderEntry(
  order: readonly ReadingOrderEntry[],
  fromIndex: number,
  toIndex: number,
): ReadingOrderEntry[] {
  if (fromIndex === toIndex) return [...order];
  if (fromIndex < 0 || fromIndex >= order.length) return [...order];
  const clampedTo = Math.max(0, Math.min(toIndex, order.length - 1));
  const arr = [...order];
  const [picked] = arr.splice(fromIndex, 1);
  if (picked === undefined) return [...order];
  arr.splice(clampedTo, 0, picked);
  // Re-index `order` so it's contiguous 0..N-1.
  return arr.map((entry, idx) => (entry.order === idx ? entry : { ...entry, order: idx }));
}

/** Returns the entries that belong to the given page index, preserving
 *  their `order` field. Stable-sort by `order`. */
export function entriesForPage(
  order: readonly ReadingOrderEntry[],
  pageIndex: number,
): ReadingOrderEntry[] {
  return order
    .filter((e) => e.pageIndex === pageIndex)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** Validate that an ordering is `order_inconsistent`-free: orders form a
 *  contiguous 0..N-1 set. Used by the apply guard so we never round-trip a
 *  bad payload to David. */
export function isOrderContiguous(order: readonly ReadingOrderEntry[]): boolean {
  const seen = new Set<number>();
  for (const e of order) {
    if (e.order < 0 || e.order >= order.length) return false;
    if (seen.has(e.order)) return false;
    seen.add(e.order);
  }
  return seen.size === order.length;
}
