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

interface OcrConfidenceOverlayProps {
  /** 0-based page index in the open document. */
  pageIndex: number;
  /** Page width in PDF user-space points. */
  pageWidthPts: number;
  /** Page height in PDF user-space points. */
  pageHeightPts: number;
  /** Current zoom scale (1.0 = 100% / 1pt = 1 CSS px). */
  scale: number;
}

interface ConfidenceBoxProps {
  word: OcrWord;
  pageWidthPts: number;
  pageHeightPts: number;
  scale: number;
}

function ConfidenceBox(props: ConfidenceBoxProps): JSX.Element | null {
  const { word, scale } = props;
  // Sentinel-default defense: if pdfRect is null (per the late-init contract),
  // skip rendering this word — we don't have valid coordinates to paint it.
  // The conventions §16.3.3 lesson is explicit about NOT treating a null
  // pdfRect as { x:0,y:0,w:0,h:0 }.
  if (word.pdfRect === null) return null;

  const { x, y, width, height } = word.pdfRect;
  // PDF user-space is bottom-left origin; the renderer uses top-left.
  // Flip Y at the page-height axis.
  const top = (props.pageHeightPts - y - height) * scale;
  const left = x * scale;
  const w = width * scale;
  const h = height * scale;

  return (
    <div
      className={styles.box}
      style={{
        top: `${String(top)}px`,
        left: `${String(left)}px`,
        width: `${String(w)}px`,
        height: `${String(h)}px`,
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
        />
      ))}
    </div>
  );
}
