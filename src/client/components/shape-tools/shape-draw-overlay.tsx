// ShapeDrawOverlay — Phase 7.5 Wave 4 (Riley) wires shape tool pointer events.
//
// The shapes-slice already exposes beginShapeDraft / updateShapeDraft /
// addDraftVertex / cancelShapeDraft (Phase 4 + Phase 7.5 B17), and the
// ShapeDraftOverlay renders the live SVG draft. But until this wave the
// pointer-events that feed the slice were not bound anywhere — the shape
// sub-toolbar buttons armed the active tool, but clicking on a page did
// nothing. That gap is the Wave-3 open question #3 the brief calls out.
//
// This component fills the gap by mounting at the app level (sibling of
// RegionClipboardOverlay) and:
//   - capturing pointer events when `shapes.activeTool !== 'cursor'`,
//   - routing them into shapes-slice with PDF-user-space coords,
//   - rendering the in-flight draft via ShapeDraftOverlay positioned over
//     the active page,
//   - completing the shape on the appropriate event (mouseup for drag tools
//     [square/circle/line/arrow/callout/line-measure]; click → add vertex,
//     dbl-click / Enter → close for polygon / polyline-measure / area-measure),
//   - dispatching `addShapeAnnotationThunk` once the model is valid.
//
// Esc cancels an in-flight draft. The component is rendered always so the
// global listeners install / tear down cleanly; it returns nothing when the
// active tool is `cursor`.

import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  addDraftVertex,
  beginShapeDraft,
  cancelShapeDraft,
  updateShapeDraft,
} from '../../state/slices/shapes-slice';
import { addShapeAnnotationThunk } from '../../state/thunks-phase4';

import { buildShapeAnnotationFromDraft } from './build-shape-annotation';
import { ShapeDraftOverlay } from './shape-draft-overlay';

interface PageHit {
  pageEl: HTMLElement;
  pageIndex: number;
  cssRect: DOMRect;
}

function findPageHit(target: EventTarget | null): PageHit | null {
  if (target === null || !(target instanceof Element)) return null;
  const pageEl = target.closest<HTMLElement>('[data-page-index]');
  if (pageEl === null) return null;
  const idx = Number(pageEl.dataset['pageIndex']);
  if (!Number.isFinite(idx)) return null;
  return { pageEl, pageIndex: idx, cssRect: pageEl.getBoundingClientRect() };
}

const VERTEX_TOOLS: ReadonlyArray<string> = ['polygon', 'polyline-measure', 'area-measure'];

export function ShapeDrawOverlay(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const activeTool = useAppSelector((s) => s.shapes.activeTool);
  const draft = useAppSelector((s) => s.shapes.draft);
  const defaults = useAppSelector((s) => s.shapes.defaults);
  const [draftPageRect, setDraftPageRect] = useState<DOMRect | null>(null);

  // Convert a viewport-px event to per-page CSS-px coords. We render the SVG
  // overlay in per-page CSS pixels (the existing ShapeDraftOverlay convention
  // is to position absolutely over the page); the slice carries the same.
  const pageCoords = useCallback((e: MouseEvent, hit: PageHit): { x: number; y: number } => {
    return { x: e.clientX - hit.cssRect.left, y: e.clientY - hit.cssRect.top };
  }, []);

  // Pointer-down: drag-tools begin the draft; vertex-tools add the next vertex.
  const onMouseDown = useCallback(
    (e: MouseEvent): void => {
      if (activeTool === 'cursor' || doc === null) return;
      if (e.button !== 0) return;
      const hit = findPageHit(e.target);
      if (hit === null) return;
      // Honor existing UI surfaces — if the pointer landed on an interactive
      // chrome element (button, input, etc.), let it handle the click. We
      // detect this by walking the path looking for an explicit role.
      const closest = (e.target instanceof Element ? e.target : null)?.closest(
        'button,input,select,textarea,[role="button"],[role="menuitem"]',
      );
      if (closest !== null && closest !== undefined) return;
      const { x, y } = pageCoords(e, hit);
      const isVertexTool = VERTEX_TOOLS.includes(activeTool);
      if (isVertexTool && draft !== null && draft.pageIndex === hit.pageIndex) {
        // Continuing an existing vertex draft — append next vertex.
        e.preventDefault();
        dispatch(addDraftVertex({ x, y }));
        return;
      }
      e.preventDefault();
      dispatch(beginShapeDraft({ pageIndex: hit.pageIndex, x, y }));
      setDraftPageRect(hit.cssRect);
    },
    [activeTool, doc, draft, dispatch, pageCoords],
  );

  // Pointer-move: update the rubber-band rect / current-pointer vertex.
  const onMouseMove = useCallback(
    (e: MouseEvent): void => {
      if (draft === null) return;
      // Use the draft's page rect rather than re-doing findPageHit (the cursor
      // can leave the page during drag — we still want the draft to track).
      const pageEl = document.querySelector<HTMLElement>(`[data-page-index="${draft.pageIndex}"]`);
      if (pageEl === null) return;
      const rect = pageEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      dispatch(updateShapeDraft({ x, y }));
    },
    [draft, dispatch],
  );

  // Drag-tools finish on mouseup. Vertex-tools wait for dbl-click / Enter.
  const finishDraft = useCallback((): void => {
    if (draft === null || doc === null) return;
    const page = doc.pages[draft.pageIndex];
    if (page === undefined) {
      dispatch(cancelShapeDraft());
      setDraftPageRect(null);
      return;
    }
    // Build the model directly from PDF user-space coords. Because the slice
    // carries draft coords in CSS-px-on-page (per pattern), we map to PDF
    // here.
    const pageEl = document.querySelector<HTMLElement>(`[data-page-index="${draft.pageIndex}"]`);
    if (pageEl === null) {
      dispatch(cancelShapeDraft());
      return;
    }
    const cssRect = pageEl.getBoundingClientRect();
    const isRotated90 = page.rotation === 90 || page.rotation === 270;
    const baseW = isRotated90 ? page.height : page.width;
    const baseH = isRotated90 ? page.width : page.height;
    const cssToPdf = (cx: number, cy: number): { x: number; y: number } => ({
      x: (cx / cssRect.width) * baseW,
      y: baseH - (cy / cssRect.height) * baseH,
    });
    const startPdf = cssToPdf(draft.startX, draft.startY);
    const endPdf = cssToPdf(draft.currentX, draft.currentY);
    const verticesPdf: number[] | undefined =
      draft.vertices !== undefined
        ? (() => {
            const arr: number[] = [];
            for (let i = 0; i + 1 < draft.vertices.length; i += 2) {
              const cx = draft.vertices[i] ?? 0;
              const cy = draft.vertices[i + 1] ?? 0;
              const p = cssToPdf(cx, cy);
              arr.push(p.x, p.y);
            }
            return arr;
          })()
        : undefined;
    const draftPdfSpace = {
      pageIndex: draft.pageIndex,
      tool: draft.tool,
      startX: startPdf.x,
      startY: startPdf.y,
      currentX: endPdf.x,
      currentY: endPdf.y,
      ...(verticesPdf !== undefined ? { vertices: verticesPdf } : {}),
    };
    const annotation = buildShapeAnnotationFromDraft(draftPdfSpace, defaults, {
      pageWidth: page.width,
      pageHeight: page.height,
    });
    if (annotation !== null) {
      void dispatch(addShapeAnnotationThunk({ annotation }));
    }
    dispatch(cancelShapeDraft());
    setDraftPageRect(null);
  }, [draft, doc, defaults, dispatch]);

  const onMouseUp = useCallback((): void => {
    if (draft === null) return;
    if (VERTEX_TOOLS.includes(draft.tool)) return; // vertex tools wait for dbl-click / Enter
    finishDraft();
  }, [draft, finishDraft]);

  const onDblClick = useCallback(
    (_e: MouseEvent): void => {
      if (draft === null) return;
      if (!VERTEX_TOOLS.includes(draft.tool)) return;
      finishDraft();
    },
    [draft, finishDraft],
  );

  const onKey = useCallback(
    (e: KeyboardEvent): void => {
      if (draft === null) return;
      if (e.key === 'Escape') {
        dispatch(cancelShapeDraft());
        setDraftPageRect(null);
        return;
      }
      if (e.key === 'Enter' && VERTEX_TOOLS.includes(draft.tool)) {
        finishDraft();
      }
    },
    [draft, dispatch, finishDraft],
  );

  useEffect(() => {
    if (activeTool === 'cursor') return;
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('dblclick', onDblClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('dblclick', onDblClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [activeTool, onMouseDown, onMouseMove, onMouseUp, onDblClick, onKey]);

  if (activeTool === 'cursor' || draft === null || draftPageRect === null) return null;

  // Mount the live SVG draft overlay positioned over the active page (fixed,
  // viewport-coord; ShapeDraftOverlay uses absolute positioning within its
  // own SVG so we wrap it in a sized fixed container).
  return (
    <div
      // eslint-disable-next-line react/forbid-dom-props
      style={{
        position: 'fixed',
        left: draftPageRect.left,
        top: draftPageRect.top,
        width: draftPageRect.width,
        height: draftPageRect.height,
        pointerEvents: 'none',
        zIndex: 5,
      }}
      aria-hidden="true"
    >
      <ShapeDraftOverlay />
    </div>
  );
}
