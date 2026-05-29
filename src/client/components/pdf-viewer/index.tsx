import { useEffect, useRef, useState } from 'react';

import { releaseLoadedDocument } from '../../services/pdf-loader';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  selectCurrentPage,
  selectFitMode,
  selectZoom,
} from '../../state/slices/viewport-selectors';
import { setCurrentPage, setZoom, ZOOM_MAX, ZOOM_MIN } from '../../state/slices/viewport-slice';
import { PdfCanvas } from '../pdf-canvas';

import styles from './pdf-viewer.module.css';

export function PdfViewer(): JSX.Element {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const zoom = useAppSelector(selectZoom);
  const fitMode = useAppSelector(selectFitMode);
  const currentPage = useAppSelector(selectCurrentPage);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Two-tier zoom (see ARCHITECTURE / zoom plan): `zoom` (committed Redux value)
  // is what pdf.js rasters at and what the dropdown/buttons/fit modes read;
  // `displayZoom` is a transient React-local value that drives a cheap GPU CSS
  // transform on each .page during a wheel gesture. Wheel deltas are rAF-
  // coalesced (one style update per frame, no re-raster) and a debounce commits
  // a single setZoom on settle so pdf.js re-rasters exactly once per gesture.
  const [displayZoom, setDisplayZoom] = useState(zoom);
  // Latest displayZoom, read synchronously inside the rAF / debounce callbacks
  // (whose closure would otherwise capture a stale value). This is the value the
  // gesture builds on and commits — the committed Redux `zoom` flows back into
  // it via the sync effect below, so a single live ref is sufficient.
  const displayZoomRef = useRef(zoom);
  displayZoomRef.current = displayZoom;
  // Accumulated wheel factor not yet applied to displayZoom (coalesced per frame).
  const pendingScaleRef = useRef(1);
  const rafRef = useRef<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External zoom changes (buttons / dropdown / fit modes / keyboard shortcuts)
  // commit a new Redux zoom. Snap displayZoom back to match so the live transform
  // ratio (displayZoom / zoom) returns to 1 and there is no leftover scale.
  useEffect(() => {
    setDisplayZoom(zoom);
    displayZoomRef.current = zoom;
  }, [zoom]);

  // Ctrl/Cmd + wheel = zoom (multiplicative, for a natural feel); plain wheel
  // scrolls normally. Attached as a NON-passive native listener because React's
  // synthetic onWheel is passive — preventDefault() there is a no-op, so the
  // browser/Electron would apply its own ctrl+wheel page-zoom instead of ours.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Accumulate the multiplicative factor; apply it at most once per frame.
      pendingScaleRef.current *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          const next = Math.min(
            ZOOM_MAX,
            Math.max(ZOOM_MIN, displayZoomRef.current * pendingScaleRef.current),
          );
          pendingScaleRef.current = 1;
          rafRef.current = null;
          displayZoomRef.current = next;
          setDisplayZoom(next);
          // Debounce the expensive pdf.js re-raster: collapse the whole gesture
          // into a single committed setZoom (which also flips fitMode='custom',
          // exactly as a manual zoom should).
          if (debounceRef.current !== null) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            dispatch(setZoom(displayZoomRef.current)); // slice clamps 0.1..8.0
          }, 120);
        });
      }
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [dispatch]);

  // Track the viewport-current page via an IntersectionObserver.
  useEffect(() => {
    if (!doc) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const items = scroller.querySelectorAll<HTMLElement>('[data-page-index]');
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const first = visible[0];
        if (first) {
          const idx = Number(first.target.getAttribute('data-page-index'));
          dispatch(setCurrentPage(idx));
        }
      },
      { root: scroller, threshold: [0.25, 0.5, 0.75] },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [dispatch, doc, doc?.pageCount]);

  // Scroll to current page when navigated by keyboard / thumbnail click.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const el = scroller.querySelector<HTMLElement>(`[data-page-index="${currentPage}"]`);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [currentPage]);

  // Phase 4.1 — release the pdf-loader cache entry for this document handle
  // when it changes (next open) or when the component unmounts (document
  // close / app close). This calls `pdfDoc.destroy()` per ARCHITECTURE §4.4
  // memory-hygiene contract. PdfCanvas only owns per-page cleanup; the
  // document-level destroy lives here on the container.
  const handle = doc?.handle;
  useEffect(() => {
    if (handle === undefined) return;
    return () => {
      void releaseLoadedDocument(handle);
    };
  }, [handle]);

  if (!doc) {
    return <div className={styles.empty} aria-hidden="true" />;
  }

  return (
    <div className={styles.viewer} ref={scrollerRef} role="region" aria-label="Document viewer">
      {doc.pages.map((page, i) => (
        <PdfCanvas
          key={`p-${i}-${page.pageIndex}`}
          page={page}
          index={i}
          zoom={zoom}
          displayScale={zoom === 0 ? 1 : displayZoom / zoom}
          fitMode={fitMode}
        />
      ))}
    </div>
  );
}
