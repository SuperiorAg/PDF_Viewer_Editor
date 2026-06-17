// Phase 7.5 Wave 2 — B5 Crop Pages engine.
//
// Canonical spec: docs/architecture-phase-7.5.md §4 (B5 row in §4.1 table) and
// docs/api-contracts.md §19.2.1 (`pdf:cropPages`).
//
// What this module does:
//   For each target page, shrink its CropBox by the requested per-edge insets
//   (in PDF points). The CropBox defines the visible region; the underlying
//   MediaBox + content streams are left untouched, so the crop is REVERSIBLE
//   if a future caller wants to widen it again. This mirrors how Adobe Acrobat
//   "Crop Pages" works in its default (CropBox-only) mode.
//
// What this module does NOT do:
//   - Walk the content stream to delete clipped objects (the CropBox does the
//     clipping at render time; physical removal is a different operation —
//     "destructive crop" — that we explicitly DEFER to a later wave).
//   - Mutate MediaBox / BleedBox / TrimBox / ArtBox. CropBox-only crop is the
//     v1 contract per the api-contracts §19.2.1 shape (single `cropBox` insets
//     dictionary, no `targetBox` discriminator).
//   - Encrypt / sign — those are separate engines.
//
// Rotation handling (`respectRotation`):
//   When the page has a /Rotate value (90 / 180 / 270), the renderer's "left /
//   right / top / bottom" of the displayed page does NOT correspond to the
//   pre-rotation PDF coordinate axes. With `respectRotation: true` (the
//   contract default), we map the user-facing insets through the rotation so
//   the visible result matches the user's intent. With `respectRotation:
//   false`, insets apply to raw PDF coordinates verbatim — useful for programs
//   that already pre-rotated the inset dictionary.
//
// Corrupt / missing /MediaBox fallback:
//   pdf-lib's `getMediaBox()` reads the inheritable /MediaBox via the page-
//   tree walker; if the source is corrupt enough that lookup fails we emit a
//   warning and skip cropping that page (leave its CropBox unchanged). The
//   engine does NOT fail the whole document for one bad page — partial crop
//   is strictly better than total failure in a multi-page job.
//
// Pure-function discipline (mirrors combine.ts / redact-engine.ts):
//   - no fs access
//   - no IPC
//   - no console.log (warnings flow via `warnings[]`)
//   - input bytes are NOT mutated (pdf-lib loads + serializes a fresh copy)
//
// Locked-instruction compliance:
//   - L-001 (no BrowserWindow): n/a — engine never touches Electron.
//   - L-005 (loadPdfJs polyfills-before-import): n/a — engine uses pdf-lib
//     only, not pdf.js.
//   - L-006 (process.env.NODE_ENV dot syntax): n/a — no test channel.
//   - Locked instruction L-005 (no input mutation): the engine loads a fresh
//     pdf-lib doc from the bytes; pdf-lib does NOT mutate the caller's buffer.

import { PDFDocument } from 'pdf-lib';

import { fail, ok, type Result } from '../../shared/result.js';

// ============================================================================
// Public types
// ============================================================================

/** Per-edge crop insets, in PDF points. All values MUST be >= 0. */
export interface CropBoxInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Page scope. Matches the api-contracts §19.2.1 `pages` union shape.
 *   - 'all'                — every page in the document
 *   - 'current'            — the caller's currently-displayed page; the IPC
 *                            handler MUST resolve this to an index before
 *                            calling the engine (engine does not know the
 *                            renderer's state).
 *   - { start, end }       — inclusive page-index range (both 0-based)
 *   - number[]             — explicit 0-based page indices
 */
export type CropPageScope =
  | { kind: 'all' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'list'; indices: ReadonlyArray<number> };

export interface CropPagesOptions {
  /** Source PDF bytes. NEVER mutated. */
  pdfBytes: Uint8Array;
  /** Per-edge insets in PDF points. */
  cropBox: CropBoxInsets;
  /** Target page scope. */
  pages: CropPageScope;
  /** Map insets through /Rotate when true. Default: true. */
  respectRotation?: boolean;
}

export type CropPagesError =
  | 'pdf_load_failed'
  | 'invalid_inset'
  | 'invalid_scope'
  | 'page_out_of_range'
  | 'no_pages_in_scope'
  | 'engine_failed';

export interface CropPagesValue {
  /** Output bytes (fresh buffer; safe to register in document-store). */
  bytes: Uint8Array;
  /** Count of pages whose CropBox actually changed. */
  pagesAffected: number;
  /** Honest disclosure / soft-failure warnings. */
  warnings: string[];
}

export type CropPagesResult = Result<CropPagesValue, CropPagesError>;

// ============================================================================
// Engine
// ============================================================================

/**
 * Apply per-edge CropBox insets to a target page set. Pure function: returns
 * a `Result`, never throws.
 */
export async function cropPages(opts: CropPagesOptions): Promise<CropPagesResult> {
  const respectRotation = opts.respectRotation ?? true;

  // 1. Validate insets — must be finite, non-negative numbers.
  const insetErr = validateInsets(opts.cropBox);
  if (insetErr) return fail<CropPagesError>('invalid_inset', insetErr);

  // 2. Load the source document.
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(opts.pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    return fail<CropPagesError>('pdf_load_failed', (e as Error).message ?? 'unknown');
  }

  const pageCount = doc.getPageCount();

  // 3. Resolve target page-index set.
  const scopeRes = resolveScope(opts.pages, pageCount);
  if (!scopeRes.ok) return scopeRes;
  const targets = scopeRes.value;

  if (targets.length === 0) {
    return fail<CropPagesError>('no_pages_in_scope', 'page scope resolved to zero pages');
  }

  // 4. Apply CropBox insets per-page.
  const warnings: string[] = [];
  let pagesAffected = 0;
  for (const pageIndex of targets) {
    let pageBoxRes;
    try {
      pageBoxRes = readPageBox(doc, pageIndex);
    } catch (e) {
      warnings.push(
        `page ${pageIndex}: getMediaBox/getCropBox threw (${(e as Error).message ?? 'unknown'}); skipped`,
      );
      continue;
    }
    if (!pageBoxRes) {
      warnings.push(`page ${pageIndex}: missing /MediaBox + /CropBox; skipped`);
      continue;
    }
    const { x, y, width, height, rotation } = pageBoxRes;

    const rotatedInsets = respectRotation ? rotateInsets(opts.cropBox, rotation) : opts.cropBox;

    const newWidth = width - rotatedInsets.left - rotatedInsets.right;
    const newHeight = height - rotatedInsets.bottom - rotatedInsets.top;

    // Refuse to invert / collapse a page: a crop must leave at least a 1pt
    // viewable region. We treat this as a per-page warning (not an engine
    // failure) so a multi-page job survives one over-cropped page.
    if (newWidth <= 0 || newHeight <= 0) {
      warnings.push(`page ${pageIndex}: insets exceed page size (${width}x${height}); skipped`);
      continue;
    }

    const newX = x + rotatedInsets.left;
    const newY = y + rotatedInsets.bottom;

    try {
      doc.getPage(pageIndex).setCropBox(newX, newY, newWidth, newHeight);
      pagesAffected += 1;
    } catch (e) {
      warnings.push(
        `page ${pageIndex}: setCropBox threw (${(e as Error).message ?? 'unknown'}); skipped`,
      );
    }
  }

  // 5. Serialize.
  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save({ useObjectStreams: true });
  } catch (e) {
    return fail<CropPagesError>(
      'engine_failed',
      `save threw: ${(e as Error).message ?? 'unknown'}`,
    );
  }

  return ok<CropPagesValue>({ bytes: outBytes, pagesAffected, warnings });
}

// ============================================================================
// Helpers
// ============================================================================

function validateInsets(c: CropBoxInsets): string | null {
  for (const k of ['top', 'right', 'bottom', 'left'] as const) {
    const v = c[k];
    if (!Number.isFinite(v)) return `cropBox.${k} must be a finite number`;
    if (v < 0) return `cropBox.${k} must be >= 0`;
  }
  return null;
}

function resolveScope(scope: CropPageScope, pageCount: number): Result<number[], CropPagesError> {
  if (scope.kind === 'all') {
    const all: number[] = [];
    for (let i = 0; i < pageCount; i += 1) all.push(i);
    return ok(all);
  }
  if (scope.kind === 'range') {
    if (!Number.isInteger(scope.start) || !Number.isInteger(scope.end)) {
      return fail<CropPagesError>('invalid_scope', 'range start/end must be integers');
    }
    if (scope.start < 0 || scope.end < 0) {
      return fail<CropPagesError>('invalid_scope', 'range start/end must be >= 0');
    }
    if (scope.end < scope.start) {
      return fail<CropPagesError>('invalid_scope', 'range.end must be >= range.start');
    }
    if (scope.end >= pageCount) {
      return fail<CropPagesError>(
        'page_out_of_range',
        `range.end ${scope.end} >= pageCount ${pageCount}`,
        { end: scope.end, pageCount },
      );
    }
    const list: number[] = [];
    for (let i = scope.start; i <= scope.end; i += 1) list.push(i);
    return ok(list);
  }
  // kind: 'list'
  const seen = new Set<number>();
  const out: number[] = [];
  for (const ix of scope.indices) {
    if (!Number.isInteger(ix) || ix < 0) {
      return fail<CropPagesError>('invalid_scope', `index ${ix} is not a non-negative integer`);
    }
    if (ix >= pageCount) {
      return fail<CropPagesError>('page_out_of_range', `index ${ix} >= pageCount ${pageCount}`, {
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
 * Read MediaBox / CropBox + rotation for a single page. Returns null when the
 * page lacks both boxes (extremely corrupt source). Re-throws on other pdf-lib
 * errors so the caller can attach a warning.
 */
function readPageBox(
  doc: PDFDocument,
  pageIndex: number,
): { x: number; y: number; width: number; height: number; rotation: number } | null {
  const page = doc.getPage(pageIndex);
  let box: { x: number; y: number; width: number; height: number } | null = null;
  // Prefer CropBox (defaults to MediaBox per PDF spec) — pdf-lib's getCropBox
  // returns MediaBox when /CropBox is absent.
  try {
    box = page.getCropBox();
  } catch {
    box = null;
  }
  if (!box || !isFiniteRect(box)) {
    try {
      box = page.getMediaBox();
    } catch {
      box = null;
    }
  }
  if (!box || !isFiniteRect(box)) return null;
  let rotation = 0;
  try {
    rotation = page.getRotation().angle;
  } catch {
    rotation = 0;
  }
  return { ...box, rotation: normalizeRotation(rotation) };
}

function isFiniteRect(r: { x: number; y: number; width: number; height: number }): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

function normalizeRotation(angle: number): number {
  // PDF /Rotate values are multiples of 90 in [0, 270]. Negative / >360 values
  // get normalized; non-multiples fall through to 0 (treated as no rotation).
  const mod = ((angle % 360) + 360) % 360;
  if (mod === 0 || mod === 90 || mod === 180 || mod === 270) return mod;
  return 0;
}

/**
 * Map user-facing (visual) insets through /Rotate so the cropped result
 * matches the user's intent on a rotated page. The PDF spec defines /Rotate
 * as "the number of degrees by which the page should be rotated CLOCKWISE
 * when displayed or printed" — so a /Rotate of 90 means the user's "top" is
 * the PDF's "right" edge.
 *
 * Rotation map (clockwise display rotation -> pre-rotation axis):
 *   0   : (left, right, top, bottom) -> (left, right, top, bottom)
 *   90  : user-top -> right edge      user-right -> bottom edge
 *         user-bottom -> left edge    user-left -> top edge
 *   180 : (left, right, top, bottom) -> (right, left, bottom, top)
 *   270 : user-top -> left edge       user-right -> top edge
 *         user-bottom -> right edge   user-left -> bottom edge
 */
function rotateInsets(insets: CropBoxInsets, rotation: number): CropBoxInsets {
  switch (rotation) {
    case 90:
      return {
        left: insets.bottom,
        right: insets.top,
        top: insets.left,
        bottom: insets.right,
      };
    case 180:
      return {
        left: insets.right,
        right: insets.left,
        top: insets.bottom,
        bottom: insets.top,
      };
    case 270:
      return {
        left: insets.top,
        right: insets.bottom,
        top: insets.right,
        bottom: insets.left,
      };
    default:
      return insets;
  }
}
