// pdf-lib wrapper for in-memory edits (reorder / insert / delete / rotate).
//
// Phase 1 design intent: keep edits as `EditOperation[]` in the Redux store and
// replay through pdf-lib at save time (David's `src/main/pdf-ops/replay.ts`
// owns the replay path per ARCHITECTURE.md §4.2). The renderer only needs to
// produce the ops; it does NOT call pdf-lib on the hot path.
//
// This service exists for:
//   - generating thumbnails locally (Phase 2) without round-tripping to main
//   - applying a small set of preview transforms when David's bridge is offline
//
// Phase 1 ships a stub. Wave 3 will fill in once `pdf-lib` is in package.json.

import { type EditOperation, type PdfRect } from '../types/ipc-contract';

export interface PdfEditService {
  /**
   * Apply a list of EditOperations to original bytes and return the modified
   * bytes. Pure function over inputs.
   * Phase 2: renderer-side fast path; the main process owns the canonical save.
   */
  replay(originalBytes: Uint8Array, ops: EditOperation[]): Promise<Uint8Array>;

  /**
   * Compute the bounding rect (in PDF user-space) of the union of a set of
   * rects — useful for annotation grouping in Phase 4.
   */
  unionRects(rects: PdfRect[]): PdfRect | null;
}

export function createPdfEditService(): PdfEditService {
  return {
    async replay(originalBytes: Uint8Array, _ops: EditOperation[]): Promise<Uint8Array> {
      // Phase 1: return the original bytes unchanged. Phase 2 wires pdf-lib.
      return originalBytes;
    },
    unionRects(rects: PdfRect[]): PdfRect | null {
      if (rects.length === 0) return null;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const r of rects) {
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x + r.width > maxX) maxX = r.x + r.width;
        if (r.y + r.height > maxY) maxY = r.y + r.height;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    },
  };
}
