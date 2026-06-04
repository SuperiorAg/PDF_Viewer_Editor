// OcrConfidenceOverlay — renders orange-stroked boxes over low-confidence
// words on a rendered PDF page. Per docs/ui-spec.md §14.4.
//
// Boundary discipline (conventions §16.2): the overlay reads OcrWord.pdfRect
// (PDF user-space coordinates) and the page's pdf user-space dimensions; it
// transforms to renderer-pixel space using the page's display scale. No raster
// bytes; no main-process file paths.
//
// Render order (ui-spec.md §14.4):
//   - PdfCanvas paints the bitmap (z-index 0)
//   - OcrConfidenceOverlay sits at z-index 3 (above bitmap, below annotations)
//   - AnnotationLayer at z-index 5 keeps its click priority
//
// Pointer events: only the individual boxes are pointer-active (cursor: help)
// for the tooltip hover; the container itself is pointer-events: none.

import { useMemo } from 'react';

import { useAppSelector } from '../../state/hooks';
import {
  makeSelectLowConfidenceWords,
  selectOcrLowConfidenceThreshold,
  selectOcrOverlayVisible,
} from '../../state/slices/ocr-selectors';
import { type OcrWord } from '../../types/ipc-contract';

import styles from './ocr-confidence-overlay.module.css';

/**
 * Phase 5.2 (Riley, 2026-06-04 — Item C): page rotation in 90-degree
 * increments. PdfCanvas's outer `.page` box and the rendered canvas bitmap are
 * BOTH rotation-swapped (the canvas dims come from `page.getViewport({scale})`
 * which auto-applies pdf.js's `/Rotate`). The overlay container is `inset: 0`
 * on top of that canvas, so its CSS box is also rotation-swapped. We re-map
 * pdf-space (bottom-left origin) rects into the rotated CSS-pixel space here
 * rather than rotating the container itself — that avoids hover-tooltip-
 * positioning surprises that a CSS `transform: rotate(...)` would introduce.
 */
export type OverlayRotation = 0 | 90 | 180 | 270;

interface OcrConfidenceOverlayProps {
  /** 0-based page index in the open document. */
  pageIndex: number;
  /** Page width in PDF user-space points (UNROTATED — natural page width). */
  pageWidthPts: number;
  /** Page height in PDF user-space points (UNROTATED — natural page height). */
  pageHeightPts: number;
  /** Current zoom scale (1.0 = 100% / 1pt = 1 CSS px). */
  scale: number;
  /**
   * Phase 5.2 (Item C): page rotation (0 | 90 | 180 | 270 degrees, clockwise).
   * Defaults to `0` so the dozens of existing call sites + tests stay
   * source-compatible until updated.
   */
  rotation?: OverlayRotation;
}

interface ConfidenceBoxProps {
  word: OcrWord;
  pageWidthPts: number;
  pageHeightPts: number;
  scale: number;
  rotation: OverlayRotation;
}

/**
 * Map a pdf-user-space rect (bottom-left origin) into top-left CSS-pixel
 * coords on the rotated canvas. Verified by hand for all four rotations:
 *
 *   0   — CSS box is Q × P (UNROTATED). top = (P - y - h) * s; left = x * s.
 *   90  — CSS box is P × Q (rotation-swapped). top = x * s; left = y * s;
 *         w' = h * s; h' = w * s.
 *   180 — CSS box is Q × P. top = y * s; left = (Q - x - w) * s.
 *   270 — CSS box is P × Q. top = (Q - x - w) * s; left = (P - y - h) * s;
 *         w' = h * s; h' = w * s.
 *
 * Where Q = pageWidthPts (natural), P = pageHeightPts (natural).
 *
 * The rotated-w/h swap for 90 + 270 keeps the box's geometric width parallel
 * to the rotated x-axis (i.e. visually horizontal/vertical relative to the
 * upright rendering).
 */
function projectRectToCss(
  rect: { x: number; y: number; width: number; height: number },
  pageWidthPts: number,
  pageHeightPts: number,
  scale: number,
  rotation: OverlayRotation,
): { top: number; left: number; width: number; height: number } {
  const { x, y, width, height } = rect;
  const Q = pageWidthPts;
  const P = pageHeightPts;
  switch (rotation) {
    case 90:
      return {
        top: x * scale,
        left: y * scale,
        width: height * scale,
        height: width * scale,
      };
    case 180:
      return {
        top: y * scale,
        left: (Q - x - width) * scale,
        width: width * scale,
        height: height * scale,
      };
    case 270:
      return {
        top: (Q - x - width) * scale,
        left: (P - y - height) * scale,
        width: height * scale,
        height: width * scale,
      };
    case 0:
    default:
      return {
        top: (P - y - height) * scale,
        left: x * scale,
        width: width * scale,
        height: height * scale,
      };
  }
}

function ConfidenceBox(props: ConfidenceBoxProps): JSX.Element | null {
  const { word, scale, rotation } = props;
  // Sentinel-default defense: if pdfRect is null (per the late-init contract),
  // skip rendering this word — we don't have valid coordinates to paint it.
  // The conventions §16.3.3 lesson is explicit about NOT treating a null
  // pdfRect as { x:0,y:0,w:0,h:0 }.
  if (word.pdfRect === null) return null;

  const { top, left, width, height } = projectRectToCss(
    word.pdfRect,
    props.pageWidthPts,
    props.pageHeightPts,
    scale,
    rotation,
  );

  return (
    <div
      className={styles.box}
      style={{
        top: `${String(top)}px`,
        left: `${String(left)}px`,
        width: `${String(width)}px`,
        height: `${String(height)}px`,
      }}
      title={`"${word.text}" — confidence ${word.confidence.toFixed(1)}`}
      role="note"
      aria-label={`Low-confidence word: ${word.text} (confidence ${word.confidence.toFixed(0)})`}
    />
  );
}

export function OcrConfidenceOverlay(props: OcrConfidenceOverlayProps): JSX.Element | null {
  const visible = useAppSelector(selectOcrOverlayVisible);
  const threshold = useAppSelector(selectOcrLowConfidenceThreshold);
  const rotation: OverlayRotation = props.rotation ?? 0;

  // Create a stable selector for this page. createSelector is memoized inside
  // makeSelectLowConfidenceWords; useMemo here ensures we don't recreate the
  // selector instance on every render of the consumer.
  const pageSelector = useMemo(
    () => makeSelectLowConfidenceWords(props.pageIndex),
    [props.pageIndex],
  );
  const lowConfWords = useAppSelector(pageSelector);

  if (!visible) return null;
  if (lowConfWords.length === 0) return null;

  return (
    <div
      className={styles.container}
      aria-label={`OCR confidence overlay for page ${String(props.pageIndex + 1)}`}
    >
      <div className={styles.banner}>
        <span className={styles.bannerStrong}>{lowConfWords.length}</span> low-confidence word
        {lowConfWords.length === 1 ? '' : 's'} (&lt; {threshold}). Review before saving.
      </div>
      {lowConfWords.map((w, idx) => (
        <ConfidenceBox
          // Words within a page do not have stable IDs from Tesseract; use
          // the index as the key. The order is deterministic (reading order).
          key={`${String(props.pageIndex)}-${String(idx)}-${w.text}`}
          word={w}
          pageWidthPts={props.pageWidthPts}
          pageHeightPts={props.pageHeightPts}
          scale={props.scale}
          rotation={rotation}
        />
      ))}
    </div>
  );
}

// Phase 5.2 (Riley, 2026-06-04): expose the pdf-to-CSS rect projector so the
// new rotation test can verify the math without rendering through React.
export { projectRectToCss };
