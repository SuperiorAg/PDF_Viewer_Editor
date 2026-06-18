// Alt Text Inspector — Phase 7.5 C5 (Riley Wave 5c).
// Per docs/ui-spec-phase-7.5.md §26 + docs/accessibility-authoring-spec.md.
//
// Modal listing every `/Figure` structure element without alt text. Per
// docs/ui-spec-phase-7.5.md §26, the modal shape is cleaner for the
// bulk-edit workflow than a sidebar tab.
//
// Behavior:
//   - Auto-loads `pdf:listFiguresWithoutAltText` when opened.
//   - Per-figure draft input + Apply button (single-figure
//     `applyAltTextThunk`).
//   - Figures with a matching pHash are grouped; each group surfaces a
//     "Bulk set alt text" button that opens the bulk sub-modal.
//   - Clicking a row title jumps the viewer to the figure's page.
//   - Honest disclosure: bridge_unavailable + 0-figures empty state.

import { useEffect, useMemo } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  altTextApplyingStart,
  closeAltTextBulkModal,
  openAltTextBulkModal,
  selectAltTextBulkModal,
  selectAltTextFigures,
  selectAltTextOpen,
  selectAltTextState,
  setAltTextBulkDraft,
  setAltTextDraft,
  setAltTextOpen,
} from '../../state/slices/alt-text-slice';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import { setCurrentPage } from '../../state/slices/viewport-slice';
import {
  applyAltTextThunk,
  applyBulkAltTextThunk,
  loadFiguresWithoutAltThunk,
} from '../../state/thunks-phase7-5-wave5c';
import { groupFiguresByPHash } from '../../types/alt-text-contract-stub';

import styles from './alt-text-inspector.module.css';
import { BulkModal } from './bulk-modal';
import { FigureRow } from './figure-row';

// `altTextApplyingStart` is imported but only used transitively through
// the thunk. Keep the import for callers that may want to flag a row as
// "applying" outside of the thunk path.
void altTextApplyingStart;

export function AltTextInspector(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectAltTextOpen);
  const doc = useAppSelector(selectCurrentDocument);
  const figures = useAppSelector(selectAltTextFigures);
  const state = useAppSelector(selectAltTextState);
  const bulkModal = useAppSelector(selectAltTextBulkModal);

  // Auto-load when the modal opens and the doc changes.
  useEffect(() => {
    if (!open || doc === null) return;
    if (state.docHash !== doc.fileHash || !state.loaded) {
      void dispatch(loadFiguresWithoutAltThunk());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.fileHash]);

  // Esc closes the modal — except when the bulk sub-modal is open
  // (it has its own dismiss path).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (bulkModal !== null) {
        dispatch(closeAltTextBulkModal());
        return;
      }
      dispatch(setAltTextOpen(false));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, bulkModal, dispatch]);

  const grouped = useMemo(() => groupFiguresByPHash(figures), [figures]);

  if (!open) return null;

  const engineUnavailable =
    state.lastErrorMessage !== null && state.lastErrorMessage.includes('not exposed');

  const onClose = (): void => {
    dispatch(setAltTextOpen(false));
  };

  const onJumpToPage = (pageIndex: number): void => {
    dispatch(setCurrentPage(pageIndex));
  };

  const onApplyOne = (structNodeId: string, value: string): void => {
    void dispatch(applyAltTextThunk({ structNodeId, altText: value }));
  };

  const onOpenBulk = (groupHash: string): void => {
    dispatch(openAltTextBulkModal({ groupHash }));
  };

  const onApplyBulk = (): void => {
    if (bulkModal === null) return;
    const group = grouped.find((g) => g.hash === bulkModal.groupHash);
    if (group === undefined) return;
    const ids = group.members.map((m) => m.structNodeId);
    void dispatch(applyBulkAltTextThunk({ structNodeIds: ids, altText: bulkModal.draft }));
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="alt-text-inspector-title"
    >
      <div className={styles.modal}>
        <header className={styles.header}>
          <h2 id="alt-text-inspector-title" className={styles.title}>
            {t('modals:accessibility.altText.title')}
          </h2>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            {t('modals:accessibility.altText.close')}
          </button>
        </header>
        <p className={styles.subtitle}>
          {t('modals:accessibility.altText.countNoAlt', { count: figures.length })}
        </p>
        {doc === null && (
          <div className={styles.emptyState}>{t('modals:accessibility.altText.noDocument')}</div>
        )}
        {doc !== null && state.loading && (
          <div className={styles.emptyState}>{t('modals:accessibility.altText.loading')}</div>
        )}
        {engineUnavailable && (
          <div className={styles.engineUnavailable} role="alert">
            {t('modals:accessibility.altText.engineUnavailable')}
          </div>
        )}
        {!engineUnavailable && state.lastErrorMessage !== null && (
          <div className={styles.error} role="alert">
            {state.lastErrorMessage}
          </div>
        )}
        {doc !== null && !state.loading && state.loaded && figures.length === 0 && (
          <div className={styles.emptyState}>{t('modals:accessibility.altText.noFigures')}</div>
        )}
        {figures.length > 0 && (
          <div className={styles.body}>
            {grouped.map((group, gi) => {
              const groupKey = group.hash ?? `singleton-${gi}`;
              const isMultiMember = group.members.length > 1;
              return (
                <div key={groupKey} className={styles.group}>
                  {isMultiMember && (
                    <div className={styles.groupHeader}>
                      <span className={styles.groupHeaderLabel}>
                        {t('modals:accessibility.altText.groupLabel', {
                          count: group.members.length,
                        })}
                      </span>
                      <button
                        type="button"
                        className={styles.bulkButton}
                        onClick={() => {
                          if (group.hash !== null) onOpenBulk(group.hash);
                        }}
                        disabled={group.hash === null}
                      >
                        {t('modals:accessibility.altText.bulkSetGroup', {
                          count: group.members.length,
                        })}
                      </button>
                    </div>
                  )}
                  {group.members.map((fig) => {
                    const draft = state.drafts[fig.structNodeId] ?? '';
                    const applying = state.applyingIds[fig.structNodeId] === true;
                    return (
                      <FigureRow
                        key={fig.structNodeId}
                        figure={fig}
                        draft={draft}
                        applying={applying}
                        onJumpToPage={onJumpToPage}
                        onDraftChange={(value) =>
                          dispatch(setAltTextDraft({ structNodeId: fig.structNodeId, value }))
                        }
                        onApply={() => onApplyOne(fig.structNodeId, draft)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {bulkModal !== null &&
        (() => {
          const group = grouped.find((g) => g.hash === bulkModal.groupHash);
          if (group === undefined) return null;
          // Are any of the group's figures currently in-flight?
          const anyApplying = group.members.some((m) => state.applyingIds[m.structNodeId] === true);
          return (
            <BulkModal
              groupHash={bulkModal.groupHash}
              members={group.members}
              draft={bulkModal.draft}
              applying={anyApplying}
              onDraftChange={(v) => dispatch(setAltTextBulkDraft(v))}
              onApply={onApplyBulk}
              onCancel={() => dispatch(closeAltTextBulkModal())}
            />
          );
        })()}
    </div>
  );
}
