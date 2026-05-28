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
  const screenX = rect.x * sx;
  // y-flip: PDF y is measured from the bottom. Add rect.height so we anchor
  // the top-left corner of the screen rect on the top edge of the PDF rect.
  const screenY = viewport.height - (rect.y + rect.height) * sy;
  return {
    x: screenX,
    y: screenY,
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
  const pdfX = rect.x * sx;
  const pdfWidth = rect.width * sx;
  const pdfHeight = rect.height * sy;
  // y-flip in reverse.
  const pdfY = page.height - (rect.y + rect.height) * sy;
  return { x: pdfX, y: pdfY, width: pdfWidth, height: pdfHeight };
}

export interface Point2D {
  x: number;
  y: number;
}

export function pdfPointToScreen(pt: Point2D, page: PageModel, viewport: PageViewport): Point2D {
  const sx = viewport.width / page.width;
  const sy = viewport.height / page.height;
  return { x: pt.x * sx, y: viewport.height - pt.y * sy };
}

export function screenPointToPdf(pt: Point2D, page: PageModel, viewport: PageViewport): Point2D {
  const sx = page.width / viewport.width;
  const sy = page.height / viewport.height;
  return { x: pt.x * sx, y: (viewport.height - pt.y) * sy };
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
