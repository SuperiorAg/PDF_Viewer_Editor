import { useState } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectPages } from '../../state/slices/document-selectors';
import { applyEdit } from '../../state/slices/document-slice';
import {
  selectAll,
  selectOnly,
  toggleSelection,
  extendSelection,
} from '../../state/slices/selection-slice';
import { pushToast } from '../../state/slices/ui-slice';
import { selectCurrentPage } from '../../state/slices/viewport-selectors';
import { setCurrentPage } from '../../state/slices/viewport-slice';

import { ThumbnailItem } from './thumbnail-item';
import styles from './thumbnail-strip.module.css';

export function ThumbnailStrip(): JSX.Element {
  const dispatch = useAppDispatch();
  const pages = useAppSelector(selectPages);
  const currentPage = useAppSelector(selectCurrentPage);
  const selected = useAppSelector((s) => s.selection.selectedPageIndices);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  if (pages.length === 0) {
    return <div className={styles.empty}>No pages</div>;
  }

  const onClickPage = (i: number, e: React.MouseEvent): void => {
    dispatch(setCurrentPage(i));
    if (e.shiftKey) {
      dispatch(extendSelection({ to: i, total: pages.length }));
    } else if (e.ctrlKey || e.metaKey) {
      dispatch(toggleSelection(i));
    } else {
      dispatch(selectOnly(i));
    }
  };

  const onDragStart =
    (i: number) =>
    (e: React.DragEvent): void => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-pdf-page', String(i));
      setDragFromIndex(i);
    };

  const onDragOver =
    (i: number) =>
    (e: React.DragEvent): void => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverIndex(i);
    };

  const onDrop =
    (i: number) =>
    (e: React.DragEvent): void => {
      e.preventDefault();
      setDragOverIndex(null);
      const from = dragFromIndex;
      setDragFromIndex(null);
      if (from === null || from === i) return;
      dispatch(
        applyEdit({
          kind: 'reorder',
          meta: { ts: Date.now(), undoable: true, operationId: `o-${Date.now()}` },
          fromIndex: from,
          toIndex: i,
        }),
      );
    };

  const deleteSelectedPages = (): void => {
    if (selected.length === 0) return;
    if (selected.length >= pages.length) {
      dispatch(pushToast({ kind: 'warning', message: 'Cannot delete all pages.' }));
      return;
    }
    // Delete from highest index down so indices stay valid.
    const sorted = [...selected].sort((a, b) => b - a);
    for (const idx of sorted) {
      const page = pages[idx];
      if (!page) continue;
      dispatch(
        applyEdit({
          kind: 'delete',
          meta: { ts: Date.now(), undoable: true, operationId: `d-${Date.now()}-${idx}` },
          pageIndex: idx,
          preservedSource: page.sourcePageRef,
        }),
      );
    }
  };

  // Wave 28a (a11y-audit.md R-4 / §3 Path 2): keyboard navigation for the
  // listbox. Arrow keys move the active option (current page) with roving
  // tabindex; Home/End jump first/last; Enter/Space select; Delete removes the
  // selected page(s); Ctrl/Cmd+A selects all. Per-item handler so focus follows
  // the active thumbnail.
  const focusThumb = (index: number): void => {
    requestAnimationFrame(() => {
      document.getElementById(`thumb-option-${index}`)?.focus();
    });
  };

  const onItemKeyDown =
    (i: number) =>
    (e: React.KeyboardEvent): void => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = Math.min(pages.length - 1, i + 1);
        dispatch(setCurrentPage(next));
        dispatch(selectOnly(next));
        focusThumb(next);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = Math.max(0, i - 1);
        dispatch(setCurrentPage(prev));
        dispatch(selectOnly(prev));
        focusThumb(prev);
      } else if (e.key === 'Home') {
        e.preventDefault();
        dispatch(setCurrentPage(0));
        dispatch(selectOnly(0));
        focusThumb(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = pages.length - 1;
        dispatch(setCurrentPage(last));
        dispatch(selectOnly(last));
        focusThumb(last);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dispatch(setCurrentPage(i));
        if (e.shiftKey) {
          dispatch(extendSelection({ to: i, total: pages.length }));
        } else if (e.ctrlKey || e.metaKey) {
          dispatch(toggleSelection(i));
        } else {
          dispatch(selectOnly(i));
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedPages();
      } else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch(selectAll(pages.length));
      }
    };

  return (
    <ul className={styles.strip} role="listbox" aria-label="Pages" aria-orientation="vertical">
      {pages.map((p, i) => (
        <ThumbnailItem
          key={`${p.pageIndex}-${i}`}
          page={p}
          index={i}
          isCurrent={i === currentPage}
          isSelected={selected.includes(i)}
          isDragOver={dragOverIndex === i}
          // Roving tabindex: only the current page's option is in the Tab
          // order; arrow keys move focus + selection between options.
          tabIndex={i === currentPage ? 0 : -1}
          onClick={(e) => onClickPage(i, e)}
          onKeyDown={onItemKeyDown(i)}
          onDragStart={onDragStart(i)}
          onDragOver={onDragOver(i)}
          onDrop={onDrop(i)}
        />
      ))}
    </ul>
  );
}
