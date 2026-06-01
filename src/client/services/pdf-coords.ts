// Single source of truth for PDF <-> screen coordinate conversion.
// Per docs/data-models.md §3.5 and ARCHITECTURE.md §7.3.
//
// PDF coordinate space: origin at bottom-left, y-axis up, units = 1/72 inch.
// Screen / pdf.js render space: origin at top-left, y-axis down, units = device
// pixels at current zoom.
//
// Every annotation read/write MUST funnel through this module. Off-by-one and
// y-flip bugs are the single most common annotation defect — don't reinvent the
// math elsewhere.

import { type PdfRect, type PageModel } from '../types/ipc-contract';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageViewport {
  /** CSS pixel width of the rendered page at the current zoom. */
  width: number;
  /** CSS pixel height of the rendered page at the current zoom. */
  height: number;
  /** Zoom multiplier (1.0 = 100%). */
  scale: number;
}

// ----------------------------------------------------------------------------
// Y-flip algebra — single source (M-30.5 unification, Wave 30 follow-up).
//
// The four conversion functions below share ONE underlying y-flip identity.
// Both directions express the same fact: the top of the rect in screen space
// is the bottom of the rect's y-extent in PDF space.
//
//   Forward (pdf -> screen):
//     screenY = viewport.height - (pdf.y + pdf.height) * sy
//
//   Inverse (screen -> pdf, with sy_inv = page.height / viewport.height):
//     pdfY = page.height - (screen.y + screen.height) * sy_inv      [form A]
//          = (viewport.height - (screen.y + screen.height)) * sy_inv [form B, point variant]
//
// Lemma (algebraic equivalence of form A and form B):
//   sy_inv = page.height / viewport.height
//   page.height - (screen.y + h) * sy_inv
//     = (viewport.height * sy_inv) - (screen.y + h) * sy_inv    [substitute page.height]
//     = (viewport.height - screen.y - h) * sy_inv
//   For a 0-height rect (i.e. a point with h = 0):
//     = (viewport.height - screen.y) * sy_inv      [form B]
//   For a non-zero-height rect:
//     = (viewport.height - (screen.y + h)) * sy_inv [form A in (screen.y + h) shape]
//
// Both rect and point conversions go through these helpers so the algebra
// lives in ONE place. If the rect/point split ever diverges, that is a bug.
// ----------------------------------------------------------------------------

function flipYPdfToScreen(
  pdfY: number,
  pdfHeight: number,
  sy: number,
  viewportHeight: number,
): number {
  // Anchors the screen rect's TOP-LEFT corner on the PDF rect's top edge.
  return viewportHeight - (pdfY + pdfHeight) * sy;
}

function flipYScreenToPdf(
  screenY: number,
  screenHeight: number,
  syInv: number,
  pageHeight: number,
): number {
  // Inverse: anchors the PDF rect's BOTTOM-LEFT corner on the screen rect's
  // bottom edge. Equivalent to (viewportHeight - (screenY + screenHeight)) * syInv
  // — see the lemma above. For points, pass screenHeight = 0.
  return pageHeight - (screenY + screenHeight) * syInv;
}

/**
 * Convert a PDF-space rect (bottom-left origin) to screen-space (top-left).
 * `page` provides the page's intrinsic dimensions in PDF user-space units.
 */
export function pdfRectToScreen(
  rect: PdfRect,
  page: PageModel,
  viewport: PageViewport,
): ScreenRect {
  // Scale factor from PDF user-space units to CSS pixels.
  const sx = viewport.width / page.width;
  const sy = viewport.height / page.height;
  return {
    x: rect.x * sx,
    y: flipYPdfToScreen(rect.y, rect.height, sy, viewport.height),
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

/**
 * Inverse of pdfRectToScreen — screen-space rect from a click/drag back to
 * PDF user-space, for annotation authoring.
 */
export function screenRectToPdf(
  rect: ScreenRect,
  page: PageModel,
  viewport: PageViewport,
): PdfRect {
  const sx = page.width / viewport.width;
  const sy = page.height / viewport.height;
  return {
    x: rect.x * sx,
    y: flipYScreenToPdf(rect.y, rect.height, sy, page.height),
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

export interface Point2D {
  x: number;
  y: number;
}

export function pdfPointToScreen(pt: Point2D, page: PageModel, viewport: PageViewport): Point2D {
  const sx = viewport.width / page.width;
  const sy = viewport.height / page.height;
  // Point = rect of height 0; the helper collapses to viewportHeight - pt.y * sy.
  return { x: pt.x * sx, y: flipYPdfToScreen(pt.y, 0, sy, viewport.height) };
}

export function screenPointToPdf(pt: Point2D, page: PageModel, viewport: PageViewport): Point2D {
  const sx = page.width / viewport.width;
  const sy = page.height / viewport.height;
  // Point = rect of height 0; the helper collapses to (viewportHeight - pt.y) * sy.
  return { x: pt.x * sx, y: flipYScreenToPdf(pt.y, 0, sy, page.height) };
}

/**
 * QuadPoints array for /Highlight, /Underline, /StrikeOut annotations.
 * PDF spec: 8 numbers per quad, ordered (x1,y1, x2,y2, x3,y3, x4,y4) where
 * (x1,y1) is bottom-left, (x2,y2) bottom-right, (x3,y3) top-left, (x4,y4)
 * top-right — note the unusual ordering (PDF spec §12.5.6.10 had a bug; most
 * implementations use top-left-first ordering: x1,y1=top-left, x2,y2=top-right,
 * x3,y3=bottom-left, x4,y4=bottom-right). pdf-lib uses the latter convention.
 *
 * We standardize on the pdf-lib convention. If a third-party PDF was authored
 * with the spec-text ordering, the highlight will render correctly because the
 * four points cover the same quadrilateral — just with swapped pair labels.
 */
export function rectToQuadPoints(rect: PdfRect): number[] {
  const left = rect.x;
  const right = rect.x + rect.width;
  const bottom = rect.y;
  const top = rect.y + rect.height;
  // top-left, top-right, bottom-left, bottom-right (pdf-lib convention)
  return [left, top, right, top, left, bottom, right, bottom];
}
