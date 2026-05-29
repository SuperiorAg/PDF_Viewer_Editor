import { useEffect, useMemo, useRef, useState } from 'react';

import { loadDocumentByHandle, type PdfLoaderError } from '../../services/pdf-loader';
import { type PdfPageProxy, type RenderJob } from '../../services/pdf-render';
import { useAppSelector } from '../../state/hooks';
import { selectAnnotationsForPage } from '../../state/slices/document-parameterized-selectors';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { type FitMode } from '../../state/slices/viewport-slice';
import { type PageModel } from '../../types/ipc-contract';
import { AnnotationLayer } from '../annotation-layer';

import styles from './pdf-canvas.module.css';

interface PdfCanvasProps {
  page: PageModel;
  index: number;
  zoom: number;
  // Transient live-zoom ratio (displayZoom / committed zoom) applied as a cheap
  // GPU CSS transform during a ctrl+scroll gesture. 1 when not actively zooming.
  // The expensive pdf.js re-raster is keyed off `zoom` only — see the render
  // effect dep array below — so this ratio never triggers a re-raster.
  displayScale: number;
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
  const pageProxyRef = useRef<PdfPageProxy | null>(null);
  const [loadError, setLoadError] = useState<{ error: PdfLoaderError; message: string } | null>(
    null,
  );

  const isRotated90 = props.page.rotation === 90 || props.page.rotation === 270;
  const baseWidth = isRotated90 ? props.page.height : props.page.width;
  const baseHeight = isRotated90 ? props.page.width : props.page.height;

  const screenWidth = Math.round(baseWidth * props.zoom);
  const screenHeight = Math.round(baseHeight * props.zoom);

  // H-2 fix (2026-05-21): selectAnnotationsForPage is a parameterized memoized
  // selector; call it as `(state, pageIndex)` rather than the old factory shape.
  // See docs/conventions.md §6.3 for the rationale.
  const annotations = useAppSelector((s) => selectAnnotationsForPage(s, props.index));
  const viewport = useMemo(
    () => ({ width: screenWidth, height: screenHeight, scale: props.zoom }),
    [screenWidth, screenHeight, props.zoom],
  );

  // Lifecycle: fetch + render. We split the effect into two so that re-renders
  // caused by zoom changes don't re-fetch the page proxy.
  useEffect(() => {
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
      // scroll-out for the simple case (component unmount), and pre-empts the
      // proxy for the re-render case where the effect runs again.
      pageProxyRef.current?.cleanup();
      pageProxyRef.current = null;
    };
  }, [handle, props.index, props.zoom]);

  return (
    <div
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
        transform: `scale(${props.displayScale})`,
        transformOrigin: '0 0',
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
    </div>
  );
}
