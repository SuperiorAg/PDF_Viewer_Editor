// Links overlay — Phase 7.5 B13 (Riley Wave 4).
//
// Three responsibilities:
//   1. Render every persisted link annotation for VISIBLE pages as a hover-
//      able badge that shows its target on hover and routes the click to the
//      right dispatcher (URL → openUrlBestEffort, page → setCurrentPage,
//      bookmark → resolve to page index).
//   2. When `links.tool === 'add-link'`, capture a marquee drag on a page and
//      open the Add Link modal with the captured rect.
//   3. Right-click on an existing link opens an Edit / Remove context menu.
//
// Virtualization: badges only mount under pages that have `[data-page-index]`
// present in the DOM (i.e. pages within the viewer's IntersectionObserver
// rootMargin window). This preserves the perf gate from L-P7.5 §7.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { editLinks, openUrlBestEffort } from '../../services/links-api';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { findNodeById, flattenTree } from '../../state/slices/bookmarks-slice';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  beginLinkDraft,
  cancelLinkDraft,
  openAddLinkModal,
  openEditLinkModal,
  removeLink,
  setLinkContextMenu,
  setLinkTool,
} from '../../state/slices/links-slice';
import { pushToast } from '../../state/slices/ui-slice';
import { setCurrentPage } from '../../state/slices/viewport-slice';
import type { PdfLinkAnnotation } from '../../types/links-contract-stub';

import styles from './links-overlay.module.css';

interface PageHit {
  pageEl: HTMLElement;
  pageIndex: number;
}

function findPageHit(target: EventTarget | null): PageHit | null {
  if (target === null || !(target instanceof Element)) return null;
  const pageEl = target.closest<HTMLElement>('[data-page-index]');
  if (pageEl === null) return null;
  const idx = Number(pageEl.dataset['pageIndex']);
  if (!Number.isFinite(idx)) return null;
  return { pageEl, pageIndex: idx };
}

export function LinksOverlay(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const tool = useAppSelector((s) => s.links.tool);
  // `pendingDraft` is collected by the slice for any downstream test consumer
  // (slice unit tests inspect it). The overlay itself derives the visible
  // marquee from local `marqueeCss` state — the slice draft is intentionally
  // not read here.
  const byHandle = useAppSelector((s) => s.links.byHandle);
  const ctxMenu = useAppSelector((s) => s.links.contextMenu);
  const bookmarks = useAppSelector((s) => s.bookmarks.tree);

  const links = useMemo<PdfLinkAnnotation[]>(
    () => (doc !== null ? (byHandle[doc.handle] ?? []) : []),
    [byHandle, doc],
  );

  // Track marquee in viewport CSS pixels (no PDF conversion until drop).
  const [marqueeCss, setMarqueeCss] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    pageEl: HTMLElement;
    pageIndex: number;
    cssRect: DOMRect;
    startX: number;
    startY: number;
  } | null>(null);

  const onMouseDown = useCallback(
    (e: MouseEvent): void => {
      if (tool !== 'add-link' || e.button !== 0) return;
      const hit = findPageHit(e.target);
      if (hit === null) return;
      e.preventDefault();
      const cssRect = hit.pageEl.getBoundingClientRect();
      setMarqueeCss({
        left: e.clientX,
        top: e.clientY,
        width: 0,
        height: 0,
        pageEl: hit.pageEl,
        pageIndex: hit.pageIndex,
        cssRect,
        startX: e.clientX,
        startY: e.clientY,
      });
      const localX = e.clientX - cssRect.left;
      const localY = e.clientY - cssRect.top;
      dispatch(beginLinkDraft({ pageIndex: hit.pageIndex, x: localX, y: localY }));
    },
    [tool, dispatch],
  );

  const onMouseMove = useCallback((e: MouseEvent): void => {
    setMarqueeCss((m) => {
      if (m === null) return m;
      const left = Math.min(m.startX, e.clientX);
      const top = Math.min(m.startY, e.clientY);
      const width = Math.abs(e.clientX - m.startX);
      const height = Math.abs(e.clientY - m.startY);
      return { ...m, left, top, width, height };
    });
  }, []);

  const onMouseUp = useCallback(
    (_e: MouseEvent): void => {
      setMarqueeCss((m) => {
        if (m === null) return null;
        if (m.width < 4 || m.height < 4 || doc === null) {
          dispatch(cancelLinkDraft());
          return null;
        }
        const page = doc.pages[m.pageIndex];
        if (page === undefined) {
          dispatch(cancelLinkDraft());
          return null;
        }
        const isRotated90 = page.rotation === 90 || page.rotation === 270;
        const baseW = isRotated90 ? page.height : page.width;
        const baseH = isRotated90 ? page.width : page.height;
        const localX = m.left - m.cssRect.left;
        const localY = m.top - m.cssRect.top;
        const pdfX = (localX / m.cssRect.width) * baseW;
        const pdfYTop = baseH - (localY / m.cssRect.height) * baseH;
        const pdfW = (m.width / m.cssRect.width) * baseW;
        const pdfH = (m.height / m.cssRect.height) * baseH;
        const rect = {
          x: Math.max(0, pdfX),
          y: Math.max(0, pdfYTop - pdfH),
          width: pdfW,
          height: pdfH,
        };
        dispatch(openAddLinkModal({ pageIndex: m.pageIndex, rect }));
        return null;
      });
    },
    [dispatch, doc],
  );

  useEffect(() => {
    if (tool !== 'add-link') {
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
  }, [tool, onMouseDown, onMouseMove, onMouseUp]);

  // Esc cancels the tool.
  useEffect(() => {
    if (tool !== 'add-link') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      dispatch(setLinkTool('cursor'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, dispatch]);

  const navigateTarget = useCallback(
    async (link: PdfLinkAnnotation): Promise<void> => {
      if (link.target.kind === 'uri') {
        const uri = link.target.uri;
        const res = await openUrlBestEffort(uri);
        if (res === 'copied') {
          dispatch(
            pushToast({
              kind: 'info',
              message: `${uri}\n(copied to clipboard — your browser blocked the open)`,
            }),
          );
        } else if (res === 'failed') {
          dispatch(
            pushToast({
              kind: 'warning',
              message: `Could not open ${uri}.`,
            }),
          );
        }
        return;
      }
      if (link.target.kind === 'goto-page') {
        dispatch(setCurrentPage(link.target.pageIndex));
        return;
      }
      // goto-bookmark — flatten + lookup the page index.
      const bookmarkId = link.target.bookmarkId;
      const node = findNodeById(bookmarks, bookmarkId);
      if (node !== null) {
        dispatch(setCurrentPage(node.node.pageIndex));
        return;
      }
      // Fall back to a flat search across the materialized rows.
      const rows = flattenTree(bookmarks);
      const row = rows.find((r) => r.id === bookmarkId);
      if (row !== undefined) dispatch(setCurrentPage(row.pageIndex));
    },
    [bookmarks, dispatch],
  );

  // Render per-link badges by querying `[data-page-index]` elements in the DOM.
  // We don't memoize-render across the document; we render only for links whose
  // page DOM node currently exists (virtualization-safe).
  const badges: JSX.Element[] = [];
  const tooltipFor: Record<string, string> = {};
  if (doc !== null) {
    for (const link of links) {
      const page = doc.pages[link.pageIndex];
      if (page === undefined) continue;
      const pageEl = document.querySelector<HTMLElement>(`[data-page-index="${link.pageIndex}"]`);
      if (pageEl === null) continue;
      const cssRect = pageEl.getBoundingClientRect();
      if (cssRect.width <= 0 || cssRect.height <= 0) continue;
      const isRotated90 = page.rotation === 90 || page.rotation === 270;
      const baseW = isRotated90 ? page.height : page.width;
      const baseH = isRotated90 ? page.width : page.height;
      const cssX = cssRect.left + (link.rect.x / baseW) * cssRect.width;
      const cssY =
        cssRect.top + ((baseH - link.rect.y - link.rect.height) / baseH) * cssRect.height;
      const cssW = (link.rect.width / baseW) * cssRect.width;
      const cssH = (link.rect.height / baseH) * cssRect.height;
      const tooltip =
        link.target.kind === 'uri'
          ? `${t('toolbar:linkOverlayUrlPrefix')} ${link.target.uri}`
          : link.target.kind === 'goto-page'
            ? t('toolbar:linkContextMenu.jumpToPage', { page: link.target.pageIndex + 1 })
            : t('toolbar:linkContextMenu.jumpToBookmark');
      tooltipFor[link.id] = tooltip;
      badges.push(
        <button
          key={link.id}
          type="button"
          className={styles.linkBadge}
          // eslint-disable-next-line react/forbid-dom-props
          style={{ left: cssX, top: cssY, width: cssW, height: cssH, position: 'fixed' }}
          title={tooltip}
          aria-label={tooltip}
          onClick={(e) => {
            e.stopPropagation();
            void navigateTarget(link);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            dispatch(setLinkContextMenu({ linkId: link.id, x: e.clientX, y: e.clientY }));
          }}
        />,
      );
    }
  }

  const tooltipText = ctxMenu !== null ? tooltipFor[ctxMenu.linkId] : undefined;

  return (
    <>
      {badges}
      {marqueeCss !== null && (
        <div
          className={styles.marquee}
          // eslint-disable-next-line react/forbid-dom-props
          style={{
            left: marqueeCss.left,
            top: marqueeCss.top,
            width: marqueeCss.width,
            height: marqueeCss.height,
          }}
        />
      )}
      {ctxMenu !== null && (
        <div
          role="menu"
          className={styles.contextMenu}
          // eslint-disable-next-line react/forbid-dom-props
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {tooltipText !== undefined && (
            <div className={styles.tooltip} style={{ position: 'static' }}>
              {tooltipText}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.contextItem}
            onClick={() => dispatch(openEditLinkModal(ctxMenu.linkId))}
          >
            {t('toolbar:linkContextMenu.edit')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.contextItem}
            onClick={() => {
              if (doc === null) return;
              dispatch(removeLink({ handle: doc.handle, linkId: ctxMenu.linkId }));
              dispatch(setLinkContextMenu(null));
              void editLinks({
                handle: doc.handle,
                actions: [{ kind: 'remove', linkId: ctxMenu.linkId }],
              });
            }}
          >
            {t('toolbar:linkContextMenu.remove')}
          </button>
        </div>
      )}
    </>
  );
}
