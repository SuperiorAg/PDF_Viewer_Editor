// Reading Order overlay — Phase 7.5 C4 (Riley Wave 5c).
// Per docs/ui-spec-phase-7.5.md §25 + docs/accessibility-authoring-spec.md.
//
// Always mounted, returns null when `readingOrder.active === false` so the
// overlay can be cheaply armed/disarmed via the Tools-menu / sidebar
// entry. Three responsibilities:
//
//   1. Render numbered badges for every entry whose page bbox falls within
//      a currently-mounted `[data-page-index]` element. Virtualization:
//      only badges for visible pages mount. Mirrors the LinksOverlay
//      Wave 4 pattern.
//   2. Surface a control bar in the top-right with Auto-detect + Apply
//      and the dirty / error / truncation banners.
//   3. Handle drag-reorder (HTML5 DnD) + keyboard ArrowUp/Down move from
//      a focused badge.
//
// Honesty surfaces:
//   - 10k-node truncation banner from David's `pdf:getReadingOrder`
//     warnings (carry-over from Wave 5b).
//   - "Engine pending" inline message when the bridge is unavailable.

import { useEffect, useState } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  moveEntry,
  selectReadingOrder,
  selectReadingOrderActive,
  selectReadingOrderDirty,
  selectReadingOrderRecomputeNoExtractor,
  selectReadingOrderState,
  selectReadingOrderTruncationWarning,
  setReadingOrderActive,
} from '../../state/slices/reading-order-slice';
import {
  applyReadingOrderThunk,
  autoDetectReadingOrderThunk,
  loadReadingOrderThunk,
} from '../../state/thunks-phase7-5-wave5c';

import { OrderBadge } from './order-badge';
import styles from './reading-order-overlay.module.css';

interface BadgePosition {
  fromIndex: number;
  step: number;
  total: number;
  left: number;
  top: number;
}

export function ReadingOrderOverlay(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const active = useAppSelector(selectReadingOrderActive);
  const order = useAppSelector(selectReadingOrder);
  const state = useAppSelector(selectReadingOrderState);
  const dirty = useAppSelector(selectReadingOrderDirty);
  const truncationWarning = useAppSelector(selectReadingOrderTruncationWarning);
  // Wave 5d (Riley) — David's `'reading-order.recompute.no-extractor-wired'`
  // warning lives here when the user clicked Auto-detect and the engine
  // couldn't actually recompute. Drives the permanent honesty banner.
  const recomputeNoExtractor = useAppSelector(selectReadingOrderRecomputeNoExtractor);

  // Local drag state — kept in component state because the actual reorder
  // only commits on drop (the slice dispatch). Sliding `dragOverIndex`
  // controls the visual outline.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Auto-load on mount when active, and re-load when the doc changes.
  useEffect(() => {
    if (!active || doc === null) return;
    if (state.docHash !== doc.fileHash || !state.loaded) {
      void dispatch(loadReadingOrderThunk());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, doc?.fileHash]);

  // Tick to re-render the badges whenever the document scrolls/zooms.
  // The scroll happens on the viewer's outer scroller — listen on window
  // for simplicity (the badges are position:fixed, so a re-render is
  // enough; we don't need precise coordinates beyond the next frame).
  const [, forceRerender] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = (): void => forceRerender((n) => (n + 1) % 1_000_000);
    window.addEventListener('scroll', tick, true);
    window.addEventListener('resize', tick);
    return () => {
      window.removeEventListener('scroll', tick, true);
      window.removeEventListener('resize', tick);
    };
  }, [active]);

  if (!active) return null;

  // Build the visible-badge list — virtualization happens here. We only
  // mount badges whose source page is currently a `[data-page-index]`
  // element in the DOM.
  const positions: BadgePosition[] = [];
  if (doc !== null) {
    for (let i = 0; i < order.length; i++) {
      const entry = order[i];
      if (entry === undefined) continue;
      const page = doc.pages[entry.pageIndex];
      if (page === undefined) continue;
      const pageEl = document.querySelector<HTMLElement>(`[data-page-index="${entry.pageIndex}"]`);
      if (pageEl === null) continue;
      const cssRect = pageEl.getBoundingClientRect();
      if (cssRect.width <= 0 || cssRect.height <= 0) continue;
      const isRotated90 = page.rotation === 90 || page.rotation === 270;
      const baseW = isRotated90 ? page.height : page.width;
      const baseH = isRotated90 ? page.width : page.height;
      const [bx, by, , bh] = entry.bbox;
      // PDF user-space (origin bottom-left) → CSS pixels (origin top-left).
      const cssX = cssRect.left + (bx / baseW) * cssRect.width;
      const cssY = cssRect.top + ((baseH - by - bh) / baseH) * cssRect.height;
      positions.push({
        fromIndex: i,
        step: entry.order + 1,
        total: order.length,
        left: cssX,
        top: cssY,
      });
    }
  }

  const onApply = (): void => {
    void dispatch(applyReadingOrderThunk());
  };
  const onAutoDetect = (): void => {
    void dispatch(autoDetectReadingOrderThunk());
  };
  const onClose = (): void => {
    dispatch(setReadingOrderActive(false));
  };

  const engineUnavailable =
    state.lastErrorMessage !== null && state.lastErrorMessage.includes('not exposed');

  return (
    <>
      {positions.map((p) => (
        <OrderBadge
          key={`${p.fromIndex}-${p.step}`}
          fromIndex={p.fromIndex}
          step={p.step}
          total={p.total}
          left={p.left}
          top={p.top}
          dragging={draggingIndex === p.fromIndex}
          dragOver={dragOverIndex === p.fromIndex}
          onDragStart={(idx) => setDraggingIndex(idx)}
          onDragEnd={() => {
            setDraggingIndex(null);
            setDragOverIndex(null);
          }}
          onDragEnter={(over) => setDragOverIndex(over)}
          onDrop={(over) => {
            const from = draggingIndex;
            setDraggingIndex(null);
            setDragOverIndex(null);
            if (from === null) return;
            if (from === over) return;
            dispatch(moveEntry({ fromIndex: from, toIndex: over }));
          }}
          onKeyMove={(from, direction) => {
            const to = direction === 'up' ? from - 1 : from + 1;
            if (to < 0 || to >= order.length) return;
            dispatch(moveEntry({ fromIndex: from, toIndex: to }));
          }}
        />
      ))}
      <aside
        className={styles.controlBar}
        role="region"
        aria-label={t('modals:accessibility.readingOrder.title')}
      >
        <h2 className={styles.controlBarTitle}>{t('modals:accessibility.readingOrder.title')}</h2>
        <p className={styles.controlBarHint}>
          {t('modals:accessibility.readingOrder.dragInstruction')}
        </p>
        {truncationWarning !== null && (
          <div className={styles.truncationBanner} role="status">
            {t('modals:accessibility.readingOrder.truncationBanner', {
              message: truncationWarning,
            })}
          </div>
        )}
        {recomputeNoExtractor !== null && (
          <div
            className={styles.truncationBanner}
            role="status"
            data-testid="reading-order-recompute-banner"
          >
            {t('modals:accessibility.readingOrder.recomputeNoExtractor')}
          </div>
        )}
        {doc === null && (
          <p className={styles.controlBarHint}>
            {t('modals:accessibility.readingOrder.noDocument')}
          </p>
        )}
        {doc !== null && state.loading && (
          <p className={styles.controlBarHint}>{t('modals:accessibility.readingOrder.loading')}</p>
        )}
        {doc !== null && !state.loading && order.length === 0 && state.loaded && (
          <p className={styles.controlBarHint}>{t('modals:accessibility.readingOrder.noOrder')}</p>
        )}
        {state.lastErrorMessage !== null && (
          <div className={styles.error} role="alert">
            {engineUnavailable
              ? t('modals:accessibility.readingOrder.engineUnavailable')
              : state.lastErrorMessage}
          </div>
        )}
        {dirty && (
          <p className={styles.dirtyHint}>{t('modals:accessibility.readingOrder.dirty')}</p>
        )}
        <div className={styles.controlBarButtons}>
          <button
            type="button"
            className={styles.button}
            onClick={onAutoDetect}
            disabled={doc === null || state.autoDetectRunning || state.applying}
            aria-label={t('modals:accessibility.readingOrder.autoDetectAria')}
          >
            {state.autoDetectRunning
              ? t('modals:accessibility.readingOrder.autoDetectRunning')
              : t('modals:accessibility.readingOrder.autoDetect')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.applyButton}`}
            onClick={onApply}
            disabled={!dirty || state.applying || doc === null}
            aria-label={t('modals:accessibility.readingOrder.applyAria')}
          >
            {state.applying
              ? t('modals:accessibility.readingOrder.applying')
              : t('modals:accessibility.readingOrder.apply')}
          </button>
        </div>
        <button type="button" className={styles.button} onClick={onClose}>
          {t('common:close')}
        </button>
      </aside>
    </>
  );
}
