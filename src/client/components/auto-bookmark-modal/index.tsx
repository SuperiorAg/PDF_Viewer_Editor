// Auto-generate Bookmarks modal — Phase 7.5 B19 UI (Riley Wave 5).
// Per docs/ui-spec-phase-7.5.md §19.
//
// Two-step flow:
//   1. Confirm: heuristic + max depth + Detect button.
//   2. Review: render proposed rows (editable titles, delete toggle),
//      merge mode picker, Save button.

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  closeAutoBookmark,
  setAutoBookmarkMaxDepth,
  setAutoBookmarkMergeMode,
  setAutoBookmarkRowDeleted,
  setAutoBookmarkRowTitle,
  setAutoBookmarkStep,
} from '../../state/slices/auto-bookmark-slice';
import { detectAutoBookmarksThunk, saveAutoBookmarksThunk } from '../../state/thunks-auto-bookmark';
import { ModalShell } from '../modals/modal-shell';

import styles from './auto-bookmark-modal.module.css';

const INDENT_PX_PER_DEPTH = 16;
const BASE_INDENT_PX = 4;

function rowIndentStyle(depth: number): React.CSSProperties {
  return { paddingLeft: `${depth * INDENT_PX_PER_DEPTH + BASE_INDENT_PX}px` };
}

export function AutoBookmarkModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.autoBookmark);

  const onClose = (): void => {
    dispatch(closeAutoBookmark());
  };

  const onDetect = (): void => {
    void dispatch(detectAutoBookmarksThunk());
  };

  const onSave = (): void => {
    void dispatch(saveAutoBookmarksThunk());
  };

  const isDetecting = state.step === 'detecting';
  const isSaving = state.step === 'saving';
  const inReview = state.step === 'review' || state.step === 'saving';
  const acceptedCount = state.proposed.filter((r) => !r.deleted && r.title.trim() !== '').length;

  const title = inReview ? t('modals:autoBookmark.reviewTitle') : t('modals:autoBookmark.title');

  return (
    <ModalShell title={title} onClose={onClose} size="lg">
      {!inReview && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>{t('modals:autoBookmark.heuristic.label')}</span>
            <span>{t('modals:autoBookmark.heuristic.fontSizeCluster')}</span>
          </div>

          <div className={styles.row}>
            <label className={styles.label} htmlFor="ab-max-depth">
              {t('modals:autoBookmark.maxDepth')}
            </label>
            <input
              id="ab-max-depth"
              type="number"
              min={1}
              max={6}
              step={1}
              className={styles.numberInput}
              value={state.maxDepth}
              onChange={(e) => dispatch(setAutoBookmarkMaxDepth(Number(e.target.value)))}
              disabled={isDetecting}
            />
          </div>

          {state.lastErrorMessage !== null && (
            <div className={styles.error}>{state.lastErrorMessage}</div>
          )}

          <div className={styles.rowEnd}>
            <button type="button" className={styles.input} onClick={onClose} disabled={isDetecting}>
              {t('modals:autoBookmark.cancel')}
            </button>
            <button
              type="button"
              className={styles.input}
              onClick={onDetect}
              disabled={isDetecting}
            >
              {isDetecting ? t('modals:autoBookmark.detecting') : t('modals:autoBookmark.detect')}
            </button>
          </div>
        </>
      )}

      {inReview && (
        <>
          <div className={styles.heuristicCallout}>
            {t('modals:autoBookmark.review.heuristicNote')}
          </div>

          {state.warnings.length > 0 && (
            <ul className={styles.warningsList}>
              {state.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <div className={styles.reviewTree} role="list">
            {state.proposed.map((row) => (
              <div
                key={row.id}
                role="listitem"
                className={`${styles.reviewRow} ${row.deleted ? styles.reviewRowDeleted : ''}`}
                style={rowIndentStyle(row.depth)}
              >
                <input
                  type="text"
                  className={styles.reviewTitle}
                  value={row.title}
                  onChange={(e) =>
                    dispatch(setAutoBookmarkRowTitle({ id: row.id, title: e.target.value }))
                  }
                  disabled={row.deleted || isSaving}
                  aria-label={`Row title for page ${row.pageIndex + 1}`}
                />
                <span className={styles.reviewPage}>
                  {t('modals:autoBookmark.review.page', { page: row.pageIndex + 1 })}
                </span>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() =>
                    dispatch(setAutoBookmarkRowDeleted({ id: row.id, deleted: !row.deleted }))
                  }
                  disabled={isSaving}
                  aria-label={
                    row.deleted
                      ? t('modals:autoBookmark.review.undoDelete')
                      : t('modals:autoBookmark.review.delete')
                  }
                >
                  {row.deleted ? '↺' : '×'}
                </button>
              </div>
            ))}
          </div>

          {acceptedCount === 0 && (
            <div className={styles.error}>{t('modals:autoBookmark.review.empty')}</div>
          )}

          <div className={styles.mergeRow}>
            <span className={styles.label}>{t('modals:autoBookmark.review.merge')}</span>
            <label className={styles.checkboxRow}>
              <input
                type="radio"
                name="ab-merge"
                checked={state.mergeMode === 'replace'}
                onChange={() => dispatch(setAutoBookmarkMergeMode('replace'))}
                disabled={isSaving}
              />
              {t('modals:autoBookmark.review.replace')}
            </label>
            <label className={styles.checkboxRow}>
              <input
                type="radio"
                name="ab-merge"
                checked={state.mergeMode === 'append'}
                onChange={() => dispatch(setAutoBookmarkMergeMode('append'))}
                disabled={isSaving}
              />
              {t('modals:autoBookmark.review.append')}
            </label>
          </div>

          {state.lastErrorMessage !== null && (
            <div className={styles.error}>{state.lastErrorMessage}</div>
          )}

          <div className={styles.rowEnd}>
            <button
              type="button"
              className={styles.input}
              onClick={() => dispatch(setAutoBookmarkStep('confirm'))}
              disabled={isSaving}
            >
              {t('modals:autoBookmark.review.back')}
            </button>
            <button
              type="button"
              className={styles.input}
              onClick={onSave}
              disabled={isSaving || acceptedCount === 0}
            >
              {isSaving
                ? t('modals:autoBookmark.review.saving')
                : t('modals:autoBookmark.review.save')}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
