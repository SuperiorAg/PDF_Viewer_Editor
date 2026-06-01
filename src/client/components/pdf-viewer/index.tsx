import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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

// Per-gesture cursor anchor: the viewport-coordinate point under the wheel
// cursor at the most-recent wheel tick, plus the scroller's content coords at
// that same instant and the committed zoom we'd be ratioing FROM at commit. The
// scroll-compensation step on commit reads this to keep the cursor's content-
// point under the cursor through the post-commit layout grow/shrink.
interface CursorAnchor {
  /** Cursor clientX/Y in viewport coords (window-space). */
  clientX: number;
  clientY: number;
  /** Scroller bounding rect at the wheel tick. */
  scrollerLeft: number;
  scrollerTop: number;
  /** Content-space point under the cursor at the most-recent wheel tick. */
  contentX: number;
  contentY: number;
  /** Committed zoom we were ratioing FROM when this anchor was last captured. */
  baseZoom: number;
  /** Page index of the page the cursor was over (-1 = empty gutter / outside any page). */
  pageIndex: number;
  /** Cursor in the cursor-page's local coords (CSS px from the page's top-left). */
  pageLocalX: number;
  pageLocalY: number;
}

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

  // Cursor-anchored zoom (Acrobat-style): on each wheel tick the cursor's
  // viewport-position + the page it's over + the page-local CSS-px point are
  // captured into `cursorAnchorRef`. Two consumers read it:
  //   1. The transform-origin lookup for each .page during the gesture
  //      (cursor-page uses the page-local point; other pages stay at '50% 0').
  //   2. The post-commit useLayoutEffect that adjusts scrollLeft/scrollTop so
  //      the same content-point lands at the same viewport coordinate after
  //      pdf.js re-rasters at the new committed zoom. `pendingScrollCompRef`
  //      flags an anchor as "freshly committed, please scroll-compensate".
  const cursorAnchorRef = useRef<CursorAnchor | null>(null);
  const pendingScrollCompRef = useRef<CursorAnchor | null>(null);
  // Per-page transformOrigin override during a gesture. Keyed by `data-page-
  // index` to survive page-list re-renders. Cleared after each commit.
  const [pageOrigins, setPageOrigins] = useState<Record<number, string>>({});
  const pageOriginsRef = useRef<Record<number, string>>({});
  pageOriginsRef.current = pageOrigins;

  // External zoom changes (buttons / dropdown / fit modes / keyboard shortcuts)
  // commit a new Redux zoom. Snap displayZoom back to match so the live transform
  // ratio (displayZoom / zoom) returns to 1 and there is no leftover scale.
  useEffect(() => {
    setDisplayZoom(zoom);
    displayZoomRef.current = zoom;
  }, [zoom]);

  // Scroll compensation after a cursor-anchored zoom commits. Runs synchronously
  // after the layout box has grown/shrunk by the new committed zoom (the
  // PdfCanvas children resize because `screenWidth = baseWidth * props.zoom`).
  // The math: contentX_new = contentX_old * (newZoom / oldZoom). We want the
  // same cursor.clientX to point at contentX_new post-commit, so
  //   scrollLeft_new = contentX_new - (cursor.clientX - scrollerLeft).
  // The ratio approach is approximate (content-position scales linearly, but
  // inter-page gaps and padding don't), but visually-natural per the brief —
  // and exact at the cursor's CURRENT page when the cursor is well inside it.
  useLayoutEffect(() => {
    const pending = pendingScrollCompRef.current;
    pendingScrollCompRef.current = null;
    if (pending === null) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (pending.baseZoom === 0) return;
    const ratio = zoom / pending.baseZoom;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const contentXNew = pending.contentX * ratio;
    const contentYNew = pending.contentY * ratio;
    const viewportOffsetX = pending.clientX - pending.scrollerLeft;
    const viewportOffsetY = pending.clientY - pending.scrollerTop;
    scroller.scrollLeft = contentXNew - viewportOffsetX;
    scroller.scrollTop = contentYNew - viewportOffsetY;
    // Drop the transient transform-origin overrides — the layout is now correct
    // at the new committed zoom; the displayScale ratio has returned to 1.
    if (Object.keys(pageOriginsRef.current).length > 0) {
      setPageOrigins({});
    }
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
      // Refresh the cursor anchor on EVERY wheel tick — the cursor may move
      // mid-gesture (mousewheel + drift, touchpad pinch with movement), so we
      // always track the latest position. `baseZoom` is the committed zoom we
      // started THIS gesture from (preserved across ticks until commit).
      const scrollerRect = scroller.getBoundingClientRect();
      const cursorContentX = scroller.scrollLeft + (e.clientX - scrollerRect.left);
      const cursorContentY = scroller.scrollTop + (e.clientY - scrollerRect.top);
      // Find the .page under the cursor (if any). The display location of the
      // cursor in page-local coords is computed via the page's getBoundingClient
      // Rect, NOT the model dims, so it works mid-transform.
      let hitPageIndex = -1;
      let pageLocalX = 0;
      let pageLocalY = 0;
      const pageNodes = scroller.querySelectorAll<HTMLElement>('[data-page-index]');
      for (const node of pageNodes) {
        const rect = node.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          hitPageIndex = Number(node.getAttribute('data-page-index'));
          pageLocalX = e.clientX - rect.left;
          pageLocalY = e.clientY - rect.top;
          break;
        }
      }
      const existingBase = cursorAnchorRef.current?.baseZoom;
      const baseZoom = existingBase ?? zoom;
      cursorAnchorRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        scrollerLeft: scrollerRect.left,
        scrollerTop: scrollerRect.top,
        contentX: cursorContentX,
        contentY: cursorContentY,
        baseZoom,
        pageIndex: hitPageIndex,
        pageLocalX,
        pageLocalY,
      };

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

          // Update per-page transformOrigin: the cursor-page anchors at the
          // cursor's page-local point; all other pages keep '50% 0' (the
          // existing centered-top behavior). The transform-origin is in CSS px
          // relative to the UN-scaled box (the page's `width`/`height` styles)
          // because that's the box the `transform: scale(...)` is applied to.
          // The page-local point we captured was in the SCALED page's pixels;
          // divide by the active displayScale to get pre-scale px.
          const anchor = cursorAnchorRef.current;
          if (anchor !== null && anchor.pageIndex >= 0 && zoom > 0) {
            const activeDisplayScale = next / zoom;
            const originX = activeDisplayScale > 0 ? anchor.pageLocalX / activeDisplayScale : 0;
            const originY = activeDisplayScale > 0 ? anchor.pageLocalY / activeDisplayScale : 0;
            const originStr = `${originX}px ${originY}px`;
            const prev = pageOriginsRef.current;
            if (prev[anchor.pageIndex] !== originStr) {
              setPageOrigins({ ...prev, [anchor.pageIndex]: originStr });
            }
          }

          // Debounce the expensive pdf.js re-raster: collapse the whole gesture
          // into a single committed setZoom (which also flips fitMode='custom',
          // exactly as a manual zoom should). On commit, hand off the captured
          // cursor anchor to the post-commit useLayoutEffect for scroll-comp.
          if (debounceRef.current !== null) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            pendingScrollCompRef.current = cursorAnchorRef.current;
            cursorAnchorRef.current = null;
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
  }, [dispatch, zoom]);

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
      {doc.pages.map((page, i) => {
        // Cursor-anchored zoom: the page under the wheel cursor scales from
        // the cursor's page-local point; all other pages keep the default
        // '50% 0' (horizontal-center, top) anchor. Spread the override prop
        // conditionally — TS `exactOptionalPropertyTypes` (renderer tsconfig)
        // rejects an explicit `undefined` value on an optional prop.
        const originOverride = pageOrigins[i];
        return (
          <PdfCanvas
            key={`p-${i}-${page.pageIndex}`}
            page={page}
            index={i}
            zoom={zoom}
            displayScale={zoom === 0 ? 1 : displayZoom / zoom}
            {...(originOverride !== undefined ? { transformOriginOverride: originOverride } : {})}
            fitMode={fitMode}
          />
        );
      })}
    </div>
  );
}
