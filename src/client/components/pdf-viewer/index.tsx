import { useEffect, useRef } from 'react';

import { releaseLoadedDocument } from '../../services/pdf-loader';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  selectCurrentPage,
  selectFitMode,
  selectZoom,
} from '../../state/slices/viewport-selectors';
import { setCurrentPage } from '../../state/slices/viewport-slice';
import { PdfCanvas } from '../pdf-canvas';

import styles from './pdf-viewer.module.css';

export function PdfViewer(): JSX.Element {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const zoom = useAppSelector(selectZoom);
  const fitMode = useAppSelector(selectFitMode);
  const currentPage = useAppSelector(selectCurrentPage);
  const scrollerRef = useRef<HTMLDivElement>(null);

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
          fitMode={fitMode}
        />
      ))}
    </div>
  );
}
