import { useEffect, useMemo, useRef, useState } from 'react';

import { loadDocumentByHandle, type PdfLoaderError } from '../../services/pdf-loader';
import { type PdfPageProxy, type RenderJob } from '../../services/pdf-render';
import { useAppSelector } from '../../state/hooks';
import { selectAnnotationsForPage } from '../../state/slices/document-parameterized-selectors';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { type FitMode } from '../../state/slices/viewport-slice';
import { type PageModel } from '../../types/ipc-contract';
import { AnnotationLayer } from '../annotation-layer';
import { OcrConfidenceOverlay } from '../ocr-confidence-overlay';

import styles from './pdf-canvas.module.css';

interface PdfCanvasProps {
  page: PageModel;
  index: number;
  zoom: number;
  // Transient live-zoom ratio (displayZoom / committed zoom) applied as a cheap
  // GPU CSS transform during a ctrl+scroll gesture. 1 when not actively zooming.
  // The expensive pdf.js re-raster is keyed off `zoom` only — see the render
  // effect dep array below — so this ratio never triggers a re-raster.
  displayScale?: number;
  // Per-page transform-origin override. Set by PdfViewer to a `${x}px ${y}px`
  // value when the wheel cursor is over THIS page during a ctrl+wheel zoom —
  // gives Acrobat-style cursor anchoring (the content point under the cursor
  // stays under the cursor). Undefined / absent = use the default '50% 0'
  // (horizontal-center, top) origin, which is the right default for pages NOT
  // under the cursor + for committed (non-gesture) state.
  transformOriginOverride?: string;
  fitMode: FitMode;
}

// Phase 4.1: PdfCanvas now owns the per-page render lifecycle on top of the
// shared pdf-loader cache:
//   1. On mount (and whenever the doc handle changes), call loadDocumentByHandle
//      to obtain a cached PdfDocumentProxy.
//   2. On (handle, pageIndex) change, await proxy.getPage(pageIndex) -> page.
//   3. On (page, zoom) change, call page.render(canvas, zoom) and keep the
//      returned RenderJob so we can cancel + cleanup on unmount / re-render.
//
// Memory hygiene (ARCHITECTURE §4.4): every render job is cancellable; every
// page proxy is `.cleanup()`-ed on unmount or when scrolled out of view. The
// PdfViewer container owns `releaseLoadedDocument()` on document close so the
// PdfDocumentProxy itself is `.destroy()`-ed exactly once when the user closes
// the file.
//
// Phase 4.1.1 (Option Y root-cause fix): page dimensions are corrected at the
// Redux layer by `measurePageDimensionsThunk` (state/thunks.ts) which fires
// once on document open. PdfCanvas no longer maintains a component-local
// `measuredDims` — `props.page.width/height` are already real by the time the
// canvas needs to lay out (or fall back to the Letter default for the brief
// pre-measure paint, which is visually fine).
export function PdfCanvas(props: PdfCanvasProps): JSX.Element {
  const doc = useAppSelector(selectCurrentDocument);
  const handle = doc?.handle;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageBoxRef = useRef<HTMLDivElement | null>(null);
  const pageProxyRef = useRef<PdfPageProxy | null>(null);
  const [loadError, setLoadError] = useState<{ error: PdfLoaderError; message: string } | null>(
    null,
  );
  // Visibility-gated render. Until this flips true the render effect below
  // bails on entry. Without this gate, opening a 1000+-page PDF mounts a
  // PdfCanvas per page and queues 1000+ concurrent pdf.js worker jobs — the
  // user sees blank page boxes for tens of seconds while the worker grinds
  // through them in index order. Default false; the IntersectionObserver
  // effect below flips it true for pages near the scroll viewport. Pages
  // scrolled away flip back to false, which triggers the render effect's
  // cleanup (cancel + page-proxy.cleanup) — honoring the ARCHITECTURE §4.4
  // page-cleanup-on-scroll-out contract that the walking-skeleton previously
  // only honored on full component unmount.
  const [isVisible, setIsVisible] = useState(false);

  const isRotated90 = props.page.rotation === 90 || props.page.rotation === 270;
  const baseWidth = isRotated90 ? props.page.height : props.page.width;
  const baseHeight = isRotated90 ? props.page.width : props.page.height;

  const screenWidth = Math.round(baseWidth * props.zoom);
  const screenHeight = Math.round(baseHeight * props.zoom);
  // `displayScale` is optional (Wave 30+ — older PdfCanvas callers + tests
  // don't pass it; only PdfViewer does during the wheel gesture). Default 1
  // = identity (no transform during steady-state / unit-tests).
  const displayScale = props.displayScale ?? 1;
  // Cursor-anchored zoom (Wave 30+, Acrobat-style): when the wheel cursor is
  // over THIS page, PdfViewer passes the cursor's page-local CSS-px point as
  // `transformOriginOverride`; the visual scale anchors at that point so the
  // content under the cursor stays pinned through the gesture. Other pages
  // (and steady state) keep the original '50% 0' (horizontal-center, top).
  const transformOrigin = props.transformOriginOverride ?? '50% 0';

  // H-2 fix (2026-05-21): selectAnnotationsForPage is a parameterized memoized
  // selector; call it as `(state, pageIndex)` rather than the old factory shape.
  // See docs/conventions.md §6.3 for the rationale.
  const annotations = useAppSelector((s) => selectAnnotationsForPage(s, props.index));
  const viewport = useMemo(
    () => ({ width: screenWidth, height: screenHeight, scale: props.zoom }),
    [screenWidth, screenHeight, props.zoom],
  );

  // Visibility observer. Observe the outer page box against the window
  // viewport (`root: null`). PdfViewer's `.viewer` scroller fills the
  // available area within the window, so a page clipped by `.viewer`'s
  // overflow:auto is also outside the window viewport — the observer
  // reports those pages as non-intersecting correctly. `rootMargin` gives
  // ~1 page of overscan above/below the visible window so a fast scroll
  // already has rendered neighbors in memory instead of blank boxes during
  // the gesture. The render effect below reacts to `isVisible` changes.
  useEffect(() => {
    const node = pageBoxRef.current;
    if (node === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      // SSR / very old browsers — no observer available, render eagerly.
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === node) {
            setIsVisible(entry.isIntersecting);
          }
        }
      },
      { root: null, rootMargin: '1000px 0px 1000px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Lifecycle: fetch + render. We split the effect into two so that re-renders
  // caused by zoom changes don't re-fetch the page proxy. Gated on
  // `isVisible` (see the state comment above) so off-screen pages in long
  // documents do not queue concurrent worker jobs on mount.
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let runningJob: RenderJob | null = null;
    if (handle === undefined) {
      // No document open — nothing to render.
      pageProxyRef.current?.cleanup();
      pageProxyRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (canvas === null) return;

    void (async () => {
      const res = await loadDocumentByHandle(handle);
      if (cancelled) return;
      if (!res.ok) {
        setLoadError({ error: res.error, message: res.message });
        return;
      }
      setLoadError(null);
      try {
        const pageProxy = await res.doc.getPage(props.index);
        if (cancelled) {
          pageProxy.cleanup();
          return;
        }
        pageProxyRef.current = pageProxy;
        // Phase 4.1.1: page dims now flow from `measurePageDimensionsThunk`
        // into Redux (props.page.width/height), so PdfCanvas does not need to
        // update component-local measured dims here.
        runningJob = pageProxy.render(canvas, props.zoom);
        try {
          await runningJob.promise;
        } catch (err) {
          // RenderingCancelledException is expected on rapid re-render — swallow.
          // Other errors are logged to console for now; toast wiring is a Phase
          // 5+ ergonomics item.
          const name = err instanceof Error ? err.name : '';
          if (name !== 'RenderingCancelledException') {
            // eslint-disable-next-line no-console
            console.warn(`pdf.js render failed for page ${props.index}:`, err);
          }
        }
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn(`pdf.js getPage failed for page ${props.index}:`, err);
      }
    })();

    return () => {
      cancelled = true;
      runningJob?.cancel();
      // Cleanup the page proxy from the previous render before the next one
      // grabs a fresh proxy. This honors ARCHITECTURE §4.4 page-cleanup-on-
      // scroll-out (visibility flips false → effect cleanup runs) and pre-
      // empts the proxy for the re-render case where the effect runs again.
      pageProxyRef.current?.cleanup();
      pageProxyRef.current = null;
    };
  }, [handle, props.index, props.zoom, isVisible]);

  return (
    <div
      ref={pageBoxRef}
      className={styles.page}
      data-page-index={props.index}
      // Layout box stays at the COMMITTED zoom size (no per-frame reflow). The
      // transform scales the whole page — canvas AND the inset:0 absolute
      // AnnotationLayer — in lockstep during a wheel gesture, giving an instant
      // GPU visual zoom while pdf.js re-rasters once on debounce-commit.
      // transformOrigin '0 0' keeps scroll geometry predictable (top-left
      // anchor). willChange promotes .page to its own compositor layer.
      style={{
        width: screenWidth,
        height: screenHeight,
        transform: `scale(${displayScale})`,
        // Default '50% 0' (horizontal-center, top) keeps the page centered in
        // the window during a wheel gesture for pages NOT under the cursor —
        // the .viewer is a flex column with align-items:center, so committed
        // layout centers each page horizontally; matching with a 50%-x origin
        // removes off-center drift + "snap back" on commit. The cursor-page
        // receives an explicit override (page-local CSS-px point under the
        // cursor) from PdfViewer for Acrobat-style anchoring during gesture.
        transformOrigin,
        willChange: 'transform',
      }}
      aria-label={`Page ${props.index + 1}`}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        // Width/height attributes are set on render by pdf-render.ts to match
        // the requested viewport; CSS sizing keeps the visual footprint stable
        // until the first render lands.
        style={{ width: screenWidth, height: screenHeight }}
        aria-hidden="true"
      />
      {loadError !== null && (
        <div className={styles.errorOverlay} role="alert">
          <span className={styles.errorTitle}>Render failed</span>
          <span className={styles.errorMessage}>{loadError.message}</span>
        </div>
      )}
      {props.page.sourcePageRef.kind === 'blank' && (
        <span className={styles.blankNote}>(blank page)</span>
      )}
      {props.page.rotation !== 0 && (
        <span className={styles.rotatedNote}>rotated {props.page.rotation}°</span>
      )}
      <AnnotationLayer
        pageIndex={props.index}
        page={props.page}
        viewport={viewport}
        annotations={annotations}
      />
      <OcrConfidenceOverlay
        pageIndex={props.index}
        pageWidthPts={props.page.width}
        pageHeightPts={props.page.height}
        scale={props.zoom * displayScale}
        // Phase 5.2 (Riley, 2026-06-04 — Item C): page rotation. PdfCanvas's
        // outer box + canvas bitmap are rotation-swapped; the overlay must
        // re-project pdf-space rects into the rotated CSS box. See
        // OcrConfidenceOverlay.projectRectToCss for the math.
        rotation={props.page.rotation}
      />
    </div>
  );
}
