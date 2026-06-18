// Alt-text contract stub — Phase 7.5 C5 (Riley Wave 5c).
//
// David's parallel Wave 5c commit lands `pdf:setAltText` and
// `pdf:listFiguresWithoutAltText` in `src/ipc/contracts.ts`. Until those
// types are re-exported through the renderer gatekeeper (`./ipc-contract`),
// the renderer types the surface LOCALLY here against the EXACT shape in
// `docs/api-contracts.md §19.7.5`. When David's commit lands, this file
// becomes a thin re-export wrapper (same promotion path the Wave 5a/5b
// stubs followed).
//
// HONESTY CLAUSE: an empty `altText` string is the canonical "remove alt
// text" sentinel (matches the canonical David surface in §19.7.5). The
// renderer never silently strips alt — every Apply path is user-driven.
// Bulk-set applies the SAME alt to every matched figure; the UI surfaces
// the matched count and the user confirms before dispatching.
//
// No `as any` here — the runtime feature-detect lives in
// `state/thunks-phase7-5-wave5c.ts` and uses `window.pdfApi` narrowing,
// mirroring the Wave 5a/5b pattern.

import type { DocumentHandle } from './ipc-contract';

/** A single figure node missing alt text. `bbox` is in PDF user-space
 *  points (origin bottom-left). `structNodeId` is the FK into
 *  `StructTreeNode.id`. */
export interface FigureWithoutAlt {
  structNodeId: string;
  pageIndex: number;
  bbox: [number, number, number, number];
  /** Optional perceptual-hash bucket for similar-figure grouping. When
   *  present, the inspector groups rows by `pHash` for bulk-set. Engine
   *  may omit when the heuristic skips hashing. */
  pHash?: string;
}

// ---------------------------------------------------------------------------
// pdf:listFiguresWithoutAltText
// ---------------------------------------------------------------------------

export interface PdfListFiguresWithoutAltTextRequest {
  handle: DocumentHandle;
}

export type PdfListFiguresWithoutAltTextError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'engine_failed';

export interface PdfListFiguresWithoutAltTextValue {
  /** All `/Figure` nodes with no /Alt or empty /Alt. Sorted by pageIndex
   *  then by reading order within the page. */
  figures: FigureWithoutAlt[];
  /** Engine warnings (e.g. "doc has no /StructTreeRoot — empty list"). */
  warnings?: string[];
}

export type PdfListFiguresWithoutAltTextResponse =
  | { ok: true; value: PdfListFiguresWithoutAltTextValue }
  | {
      ok: false;
      error: PdfListFiguresWithoutAltTextError | 'bridge_unavailable';
      message: string;
    };

// ---------------------------------------------------------------------------
// pdf:setAltText — empty string === remove alt; the engine does NOT silently
//   drop alt on its own. The renderer surfaces a confirm only when the user
//   explicitly types an empty string into a previously-filled field.
// ---------------------------------------------------------------------------

export interface PdfSetAltTextRequest {
  handle: DocumentHandle;
  structNodeId: string;
  /** Empty string === remove alt. */
  altText: string;
  /** Optional /ActualText override. */
  actualText?: string;
}

export type PdfSetAltTextError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'node_not_found'
  | 'engine_failed';

export interface PdfSetAltTextValue {
  applied: true;
}

export type PdfSetAltTextResponse =
  | { ok: true; value: PdfSetAltTextValue }
  | {
      ok: false;
      error: PdfSetAltTextError | 'bridge_unavailable';
      message: string;
    };

// ---------------------------------------------------------------------------
// Renderer-only helpers — pure; group figures for bulk-set.
// ---------------------------------------------------------------------------

/** Group figures by `pHash` for the "similar figures" affordance. Figures
 *  without a hash become their own singleton group. Returns a deterministic
 *  ordering: groups appear in the input order of their first member. */
export function groupFiguresByPHash(
  figures: readonly FigureWithoutAlt[],
): { hash: string | null; members: FigureWithoutAlt[] }[] {
  const groups = new Map<string, FigureWithoutAlt[]>();
  const singletons: { hash: null; members: FigureWithoutAlt[] }[] = [];
  const orderedHashes: string[] = [];
  for (const fig of figures) {
    if (fig.pHash === undefined || fig.pHash === '') {
      singletons.push({ hash: null, members: [fig] });
      continue;
    }
    const existing = groups.get(fig.pHash);
    if (existing === undefined) {
      groups.set(fig.pHash, [fig]);
      orderedHashes.push(fig.pHash);
    } else {
      existing.push(fig);
    }
  }
  const result: { hash: string | null; members: FigureWithoutAlt[] }[] = [];
  for (const h of orderedHashes) {
    const members = groups.get(h);
    if (members !== undefined && members.length > 0) {
      result.push({ hash: h, members });
    }
  }
  result.push(...singletons);
  return result;
}
