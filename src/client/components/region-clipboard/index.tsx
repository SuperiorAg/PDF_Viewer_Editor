// RegionClipboardOverlay — Phase 7.5 B12 (Riley Wave 3).
// Per docs/ui-spec-phase-7.5.md §12.
//
// Honest disclosure (architecture §6 AR9 + Wave 3 brief):
//   v0.8.0 ships RASTER region only. The selection is copied as a PNG image
//   captured from the on-screen canvas; paste embeds the image via the
//   existing Phase 2 image-embed pathway. True vector content-stream
//   extraction is deferred to a later wave (the brief flags it as a
//   v0.9.x open question).
//
// Activation:
//   Open via the Edit menu (Region Select) — the overlay arms via the
//   `regionClipboard.marqueeActive` flag (set by the menu / tool registry).
//   While armed the overlay catches pointer-down inside the PdfViewer and
//   draws a marquee in CSS px relative to the page under the pointer. On
//   pointer-up the marquee is stored as `RegionSelection` (in PDF user-
//   space) and the marquee turns into a marching-ants outline.
//
// The brief notes the existing SelectionOverlay component is a stub — this
// implementation does not modify that file (which David's domain may touch
// later) and instead mounts as a sibling at the app level.

import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { applyEdit } from '../../state/slices/document-slice';
import {
  clearClipboard,
  setClipboardEntry,
  setMarqueeActive,
  setPasteGhostActive,
  setSelection,
  type RegionClipboardEntry,
} from '../../state/slices/region-clipboard-slice';
import { pushToast } from '../../state/slices/ui-slice';
import type { ImageEmbedPayload } from '../../types/ipc-contract';

import styles from './region-clipboard.module.css';

interface PageHit {
  pageEl: HTMLElement;
  pageIndex: number;
  pageWidthPt: number;
  pageHeightPt: number;
}

function findPageHit(target: EventTarget | null): PageHit | null {
  if (target === null || !(target instanceof Element)) return null;
  const pageEl = target.closest<HTMLElement>('[data-page-index]');
  if (pageEl === null) return null;
  const idx = Number(pageEl.dataset['pageIndex']);
  if (!Number.isFinite(idx)) return null;
  // Page width/height in pt comes from PageModel. The overlay reads it from
  // the DOM by inspecting any embedded canvas's intrinsic dimensions — the
  // pdf.js canvas mounts a `width` attribute equal to the rasterized pixel
  // dimensions at the current zoom. For coordinate conversion we just need
  // the bbox / pt ratio, which is calculable from the page's CSS bbox.
  return {
    pageEl,
    pageIndex: idx,
    pageWidthPt: 0, // resolved against the doc store at use time
    pageHeightPt: 0,
  };
}

function rasterizeRegionFromCanvas(
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number },
): { dataUrl: string; width: number; height: number } | null {
  const cssRect = canvas.getBoundingClientRect();
  if (cssRect.width <= 0 || cssRect.height <= 0) return null;
  // Map CSS-px rect into canvas-pixel space.
  const sx = (rect.x / cssRect.width) * canvas.width;
  const sy = (rect.y / cssRect.height) * canvas.height;
  const sw = (rect.width / cssRect.width) * canvas.width;
  const sh = (rect.height / cssRect.height) * canvas.height;
  if (sw < 1 || sh < 1) return null;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  const ctx = out.getContext('2d');
  if (ctx === null) return null;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return { dataUrl: out.toDataURL('image/png'), width: out.width, height: out.height };
}

async function writeDataUrlToSystemClipboard(dataUrl: string): Promise<void> {
  // Best-effort. The Async Clipboard API exposes write() with image/png
  // since Electron 25+; if unavailable we silently skip (the internal
  // clipboard still works).
  try {
    const blob = await (await fetch(dataUrl)).blob();
    // ClipboardItem may not be defined in all contexts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CI = (globalThis as any).ClipboardItem;
    if (typeof CI === 'function' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new CI({ 'image/png': blob })]);
    }
  } catch {
    // ignore — internal paste still works
  }
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(',');
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // crypto.subtle is available in Electron renderer. Copy into a fresh
  // ArrayBuffer to dodge SharedArrayBuffer-typed sources (the DOM typing
  // narrowed BufferSource since TS 5.x — see TS2345).
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const buf = await crypto.subtle.digest('SHA-256', ab as ArrayBuffer);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function RegionClipboardOverlay(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const state = useAppSelector((s) => s.regionClipboard);
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    pageEl: HTMLElement;
    pageIndex: number;
    cssRect: DOMRect;
  } | null>(null);
  const [marqueeCss, setMarqueeCss] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  // ---- Marquee drag handlers (only mounted while marqueeActive) ----
  const onMouseDown = useCallback((e: MouseEvent): void => {
    if (e.button !== 0) return;
    const hit = findPageHit(e.target);
    if (hit === null) return;
    e.preventDefault();
    const r = hit.pageEl.getBoundingClientRect();
    setDrag({
      startX: e.clientX,
      startY: e.clientY,
      pageEl: hit.pageEl,
      pageIndex: hit.pageIndex,
      cssRect: r,
    });
    setMarqueeCss({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
  }, []);

  const onMouseMove = useCallback(
    (e: MouseEvent): void => {
      if (drag === null) return;
      const left = Math.min(drag.startX, e.clientX);
      const top = Math.min(drag.startY, e.clientY);
      const width = Math.abs(e.clientX - drag.startX);
      const height = Math.abs(e.clientY - drag.startY);
      setMarqueeCss({ left, top, width, height });
    },
    [drag],
  );

  const onMouseUp = useCallback(
    (_e: MouseEvent): void => {
      if (drag === null || marqueeCss === null || doc === null) {
        setDrag(null);
        return;
      }
      if (marqueeCss.width < 4 || marqueeCss.height < 4) {
        setDrag(null);
        setMarqueeCss(null);
        return;
      }
      // Convert viewport-px marquee to per-page CSS-px coords, then PDF.
      const cssRect = drag.cssRect;
      const localX = marqueeCss.left - cssRect.left;
      const localY = marqueeCss.top - cssRect.top;
      const page = doc.pages[drag.pageIndex];
      if (page === undefined) {
        setDrag(null);
        setMarqueeCss(null);
        return;
      }
      const isRotated90 = page.rotation === 90 || page.rotation === 270;
      const baseW = isRotated90 ? page.height : page.width;
      const baseH = isRotated90 ? page.width : page.height;
      const pdfX = (localX / cssRect.width) * baseW;
      // PDF y bottom-up; CSS y top-down.
      const pdfYTop = baseH - (localY / cssRect.height) * baseH;
      const pdfW = (marqueeCss.width / cssRect.width) * baseW;
      const pdfH = (marqueeCss.height / cssRect.height) * baseH;
      dispatch(
        setSelection({
          pageIndex: drag.pageIndex,
          pdfRect: {
            x: Math.max(0, pdfX),
            y: Math.max(0, pdfYTop - pdfH),
            width: pdfW,
            height: pdfH,
          },
        }),
      );
      setDrag(null);
    },
    [doc, drag, marqueeCss, dispatch],
  );

  // Install / remove marquee listeners on activation.
  useEffect(() => {
    if (!state.marqueeActive) {
      setDrag(null);
      setMarqueeCss(null);
      return;
    }
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [state.marqueeActive, onMouseDown, onMouseMove, onMouseUp]);

  // ---- requestCopy / requestCut handlers (raised by the slice's thunks) ----
  useEffect(() => {
    if (state.selection === null) return;
    const handler = async (e: Event): Promise<void> => {
      const isCut = e.type === 'regionClipboard/requestCut';
      if (!isCut && e.type !== 'regionClipboard/requestCopy') return;
      const sel = state.selection;
      if (sel === null) return;
      // Find the page canvas under the current selection.
      const pageEl = document.querySelector<HTMLElement>(`[data-page-index="${sel.pageIndex}"]`);
      if (pageEl === null) return;
      const canvas = pageEl.querySelector<HTMLCanvasElement>('canvas');
      if (canvas === null) return;
      // Need the marquee CSS rect to rasterize from the canvas. We don't
      // keep marqueeCss after pointer-up, so derive it from sel.pdfRect.
      const page = doc?.pages[sel.pageIndex];
      if (page === undefined || doc === null) return;
      const cssRect = canvas.getBoundingClientRect();
      const isRotated90 = page.rotation === 90 || page.rotation === 270;
      const baseW = isRotated90 ? page.height : page.width;
      const baseH = isRotated90 ? page.width : page.height;
      const cssX = (sel.pdfRect.x / baseW) * cssRect.width;
      const cssY = ((baseH - sel.pdfRect.y - sel.pdfRect.height) / baseH) * cssRect.height;
      const cssW = (sel.pdfRect.width / baseW) * cssRect.width;
      const cssH = (sel.pdfRect.height / baseH) * cssRect.height;
      const raster = rasterizeRegionFromCanvas(canvas, {
        x: cssX,
        y: cssY,
        width: cssW,
        height: cssH,
      });
      if (raster === null) {
        dispatch(pushToast({ kind: 'error', message: 'Could not rasterize the region.' }));
        return;
      }
      const entry: RegionClipboardEntry = {
        sourcePdfRect: { width: sel.pdfRect.width, height: sel.pdfRect.height },
        imageDataUrl: raster.dataUrl,
        imageWidth: raster.width,
        imageHeight: raster.height,
        capturedAt: Date.now(),
      };
      dispatch(setClipboardEntry(entry));
      await writeDataUrlToSystemClipboard(raster.dataUrl);
      dispatch(
        pushToast({
          kind: 'success',
          message: t('modals:regionClipboard.noteImageOnly'),
        }),
      );
      if (isCut) {
        // True content-stream removal is deferred — for v0.8.0 a "cut"
        // overlays an opaque white rectangle (visual delete) via the same
        // image-embed pipeline. Honest disclosure: the rectangle stays in
        // the saved PDF and Save will persist it.
        const eraser: ImageEmbedPayload = await (async () => {
          // 1x1 white PNG, scaled by pdf-lib at embed time to fill the rect.
          const c = document.createElement('canvas');
          c.width = 1;
          c.height = 1;
          const ctx = c.getContext('2d');
          if (ctx !== null) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 1, 1);
          }
          const u8 = dataUrlToUint8Array(c.toDataURL('image/png'));
          const hash = await sha256Hex(u8);
          return {
            bytes: u8,
            mimeType: 'image/png',
            width: 1,
            height: 1,
            contentHash: hash,
          };
        })();
        dispatch(
          applyEdit({
            kind: 'image-overlay',
            meta: { ts: Date.now(), undoable: true, operationId: `region-cut-${Date.now()}` },
            pageIndex: sel.pageIndex,
            rect: sel.pdfRect,
            image: eraser,
            overlayId: `region-cut-${Date.now()}`,
          }),
        );
      }
    };
    const onCopy = (e: Event): void => void handler(e);
    const onCut = (e: Event): void => void handler(e);
    window.addEventListener('regionClipboard/requestCopy', onCopy);
    window.addEventListener('regionClipboard/requestCut', onCut);
    return () => {
      window.removeEventListener('regionClipboard/requestCopy', onCopy);
      window.removeEventListener('regionClipboard/requestCut', onCut);
    };
  }, [state.selection, doc, dispatch, t]);

  // ---- Paste ghost: next click on a page embeds the image ----
  useEffect(() => {
    if (!state.pasteGhostActive || state.clipboard === null) return;
    const clip = state.clipboard;
    const onClick = async (e: MouseEvent): Promise<void> => {
      const hit = findPageHit(e.target);
      if (hit === null || doc === null) return;
      const page = doc.pages[hit.pageIndex];
      if (page === undefined) return;
      const cssRect = hit.pageEl.getBoundingClientRect();
      const isRotated90 = page.rotation === 90 || page.rotation === 270;
      const baseW = isRotated90 ? page.height : page.width;
      const baseH = isRotated90 ? page.width : page.height;
      const cssX = e.clientX - cssRect.left;
      const cssY = e.clientY - cssRect.top;
      const pdfX = (cssX / cssRect.width) * baseW;
      const pdfYTop = baseH - (cssY / cssRect.height) * baseH;
      const w = clip.sourcePdfRect.width;
      const h = clip.sourcePdfRect.height;
      const bytes = dataUrlToUint8Array(clip.imageDataUrl);
      const contentHash = await sha256Hex(bytes);
      const payload: ImageEmbedPayload = {
        bytes,
        mimeType: 'image/png',
        width: clip.imageWidth,
        height: clip.imageHeight,
        contentHash,
      };
      dispatch(
        applyEdit({
          kind: 'image-overlay',
          meta: { ts: Date.now(), undoable: true, operationId: `region-paste-${Date.now()}` },
          pageIndex: hit.pageIndex,
          rect: {
            x: Math.max(0, pdfX - w / 2),
            y: Math.max(0, pdfYTop - h / 2),
            width: w,
            height: h,
          },
          image: payload,
          overlayId: `region-paste-${Date.now()}`,
        }),
      );
      dispatch(setPasteGhostActive(false));
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dispatch(setPasteGhostActive(false));
      }
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [state.pasteGhostActive, state.clipboard, doc, dispatch]);

  // ---- Context menu (right-click on selection) ----
  useEffect(() => {
    if (state.selection === null) return;
    const handler = (e: MouseEvent): void => {
      const hit = findPageHit(e.target);
      if (hit === null) return;
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('contextmenu', handler);
    return () => window.removeEventListener('contextmenu', handler);
  }, [state.selection]);

  // ---- Esc dismisses marquee and clipboard ghost ----
  useEffect(() => {
    if (!state.marqueeActive && state.selection === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      dispatch(setMarqueeActive(false));
      dispatch(setSelection(null));
      setCtxMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.marqueeActive, state.selection, dispatch]);

  // Render: marquee outline + context menu + paste-ghost banner.
  return (
    <>
      {marqueeCss !== null && (
        <div
          className={styles.marquee}
          // eslint-disable-next-line react/forbid-dom-props
          style={{
            left: marqueeCss.left,
            top: marqueeCss.top,
            width: marqueeCss.width,
            height: marqueeCss.height,
            position: 'fixed',
            zIndex: 5,
          }}
          aria-label={t('modals:regionClipboard.selectionAria')}
        />
      )}
      {ctxMenu !== null && state.selection !== null && (
        <div
          role="menu"
          className={styles.contextMenu}
          // eslint-disable-next-line react/forbid-dom-props
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.contextMenuItem}
            onClick={() => {
              window.dispatchEvent(new Event('regionClipboard/requestCut'));
              setCtxMenu(null);
            }}
          >
            {t('modals:regionClipboard.menuCut')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.contextMenuItem}
            onClick={() => {
              window.dispatchEvent(new Event('regionClipboard/requestCopy'));
              setCtxMenu(null);
            }}
          >
            {t('modals:regionClipboard.menuCopy')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.contextMenuItem}
            disabled={state.clipboard === null}
            onClick={() => {
              dispatch(setPasteGhostActive(true));
              setCtxMenu(null);
            }}
          >
            {t('modals:regionClipboard.menuPaste')}
          </button>
        </div>
      )}
      {state.pasteGhostActive && state.clipboard !== null && (
        <div ref={ghostRef} role="status" className={styles.ghostBanner}>
          <span>{t('modals:regionClipboard.ghostBanner')}</span>
          <button
            type="button"
            className={styles.ghostCancel}
            onClick={() => {
              dispatch(setPasteGhostActive(false));
              dispatch(clearClipboard());
            }}
          >
            {t('modals:regionClipboard.exit')}
          </button>
        </div>
      )}
    </>
  );
}
