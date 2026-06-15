// RedactionToolbar — Phase 7.4 B1 sub-toolbar.
// Per docs/phase-7.4-b1-redaction-design.md §2.2.
//
// Mirror of ShapeToolbar (src/client/components/shape-tools/shape-toolbar.tsx):
//   - Returns null when `ui.redactionPanelOpen === false`.
//   - Esc with focus inside the sub-toolbar closes it; marks are NOT cleared
//     (re-opening re-shows pending marks, matching Acrobat).
//   - First button gets focus on open.
//   - All visible labels + ARIA strings come from i18n (`toolbar:redactionTools.*`).
//
// Buttons (left to right):
//   1. Mark Rectangle — toggle `redactions.activeTool === 'rect'`.
//   2. Mark Text       — honestly DISABLED (deferred to v2, per design §2.2 row 2).
//   3. Show Markups    — toggles `redactions.showMarks` overlay flag.
//   4. Clear Marks     — disabled when totalMarks === 0; confirms via window.confirm
//                         when ≥ 5 marks (per design §2.2 row 4).
//   5. Apply           — opens the ApplyRedactionsModal (`role="alertdialog"`).

import { useCallback, useEffect, useRef } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  clearMarks,
  selectRedactionActiveTool,
  selectRedactionPagesWithMarks,
  selectRedactionShowMarks,
  selectRedactionTotalMarks,
  setActiveRedactionTool,
  setShowMarks,
} from '../../state/slices/redactions-slice';
import { selectRedactionPanelOpen } from '../../state/slices/ui-selectors';
import { setRedactionApplyModalOpen, setRedactionPanelOpen } from '../../state/slices/ui-slice';

import styles from './redaction-tools.module.css';

const CLEAR_CONFIRM_THRESHOLD = 5;

export function RedactionToolbar(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectRedactionPanelOpen);
  const activeTool = useAppSelector(selectRedactionActiveTool);
  const showMarks = useAppSelector(selectRedactionShowMarks);
  const totalMarks = useAppSelector(selectRedactionTotalMarks);
  const pagesWithMarks = useAppSelector(selectRedactionPagesWithMarks);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus the Mark Rectangle button when the panel opens so keyboard users
  // land inside it and Esc lands on a focused descendant. Mirrors ShapeToolbar.
  useEffect(() => {
    if (open && firstButtonRef.current) {
      firstButtonRef.current.focus();
    }
  }, [open]);

  // Esc closes the panel but does NOT clear marks (per design §2.2).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dispatch(setRedactionPanelOpen(false));
      }
    },
    [dispatch],
  );

  const onClickMarkRect = useCallback(() => {
    dispatch(setActiveRedactionTool(activeTool === 'rect' ? null : 'rect'));
  }, [dispatch, activeTool]);

  const onClickShowMarks = useCallback(() => {
    dispatch(setShowMarks(!showMarks));
  }, [dispatch, showMarks]);

  const onClickClearMarks = useCallback(() => {
    if (totalMarks >= CLEAR_CONFIRM_THRESHOLD) {
      // eslint-disable-next-line no-alert -- Phase 7.4 B1 design §2.2 row 4
      const confirmed = window.confirm(t('modals:redaction.clearConfirm', { count: totalMarks }));
      if (!confirmed) return;
    }
    dispatch(clearMarks());
  }, [dispatch, t, totalMarks]);

  const onClickApply = useCallback(() => {
    dispatch(setRedactionApplyModalOpen(true));
  }, [dispatch]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label={t('toolbar:redactionTools.label')}
      className={styles.toolbar}
      onKeyDown={onKeyDown}
    >
      <button
        ref={firstButtonRef}
        type="button"
        className={`${styles.toolButton} ${activeTool === 'rect' ? styles.toolButtonActive : ''}`}
        aria-label={t('toolbar:redactionTools.markRectAria')}
        aria-pressed={activeTool === 'rect' ? 'true' : 'false'}
        title={t('toolbar:redactionTools.markRectTooltip')}
        onClick={onClickMarkRect}
      >
        {t('toolbar:redactionTools.markRect')}
      </button>
      <button
        type="button"
        className={styles.toolButton}
        aria-label={t('toolbar:redactionTools.markTextAria')}
        aria-pressed="false"
        aria-disabled="true"
        disabled
        title={t('toolbar:redactionTools.markTextTooltip')}
      >
        {t('toolbar:redactionTools.markText')}
      </button>
      <div className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.toolButton} ${showMarks ? styles.toolButtonActive : ''}`}
        aria-label={t('toolbar:redactionTools.showMarksAria')}
        aria-pressed={showMarks ? 'true' : 'false'}
        title={t('toolbar:redactionTools.showMarksTooltip')}
        onClick={onClickShowMarks}
      >
        {t('toolbar:redactionTools.showMarks')}
      </button>
      <button
        type="button"
        className={styles.toolButton}
        aria-label={t('toolbar:redactionTools.clearMarksAria')}
        title={t('toolbar:redactionTools.clearMarksTooltip')}
        disabled={totalMarks === 0}
        onClick={onClickClearMarks}
      >
        {t('toolbar:redactionTools.clearMarks')}
      </button>
      <div className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.toolButton} ${styles.toolButtonApply}`}
        aria-label={t('toolbar:redactionTools.applyAria')}
        title={t('toolbar:redactionTools.applyTooltip')}
        disabled={totalMarks === 0}
        onClick={onClickApply}
      >
        {t('toolbar:redactionTools.apply')}
      </button>
      {totalMarks > 0 && (
        <span className={styles.statusText} role="status">
          {t('toolbar:redactionTools.statusBarPending', {
            count: totalMarks,
            rects: totalMarks,
            pages: pagesWithMarks,
          })}
        </span>
      )}
    </div>
  );
}
