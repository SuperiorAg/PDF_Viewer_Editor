// Saved Actions list — Phase 7.5 B9 UI (Riley Wave 6).
// Spec: docs/ui-spec-phase-7.5.md §9.
//
// Shows the user's saved Action Wizard scripts. Each row offers Run / Edit
// (rename only — v0.8.0 honest deferral) / Export / Delete actions. The
// header has Record New + Import buttons.

import { useEffect } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  closeActionWizardList,
  openRecordDialog,
  openRunner,
  selectActionWizardListOpen,
  selectScriptsState,
  type ActionWizardState,
} from '../../state/slices/action-wizard-slice';
import {
  deleteActionScriptThunk,
  exportActionScriptThunk,
  importActionScriptThunk,
  listActionScriptsThunk,
} from '../../state/thunks-phase7-5-wave6';
import { ModalShell } from '../modals/modal-shell';

import styles from './styles.module.css';

export function SavedActionsList(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { t } = useT();
  const open = useAppSelector(selectActionWizardListOpen);
  const scripts = useAppSelector(selectScriptsState);

  useEffect(() => {
    if (open) {
      void dispatch(listActionScriptsThunk());
    }
  }, [open, dispatch]);

  if (!open) return null;

  return (
    <ModalShell
      title={t('modals:actionWizard.listTitle')}
      onClose={() => dispatch(closeActionWizardList())}
      size="lg"
      footer={
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => dispatch(openRecordDialog())}
          >
            {t('modals:actionWizard.newRecord')}
          </button>
          <button type="button" onClick={() => void dispatch(importActionScriptThunk())}>
            {t('modals:actionWizard.import')}
          </button>
          <button type="button" onClick={() => dispatch(closeActionWizardList())}>
            {t('modals:actionWizard.cancel')}
          </button>
        </div>
      }
    >
      <ListBody state={scripts} />
    </ModalShell>
  );
}

interface ListBodyProps {
  state: ActionWizardState['scripts'];
}

function ListBody({ state }: ListBodyProps): JSX.Element {
  const dispatch = useAppDispatch();
  const { t } = useT();
  if (state.listing && state.list === null) {
    return <div className={styles.empty}>{t('modals:actionWizard.loadingScripts')}</div>;
  }
  if (state.lastListError !== null) {
    return (
      <div className={styles.errorBanner}>
        {t('modals:actionWizard.loadError', { message: state.lastListError })}
      </div>
    );
  }
  if (!state.list || state.list.length === 0) {
    return <div className={styles.empty}>{t('modals:actionWizard.noScripts')}</div>;
  }
  return (
    <div className={styles.list}>
      {state.list.map((row) => (
        <div key={row.id} className={styles.row}>
          <div className={styles.rowMeta}>
            <div className={styles.rowName}>{row.name}</div>
            <div className={styles.rowDetails}>
              {t('modals:actionWizard.row.usage', { count: row.usageCount })} •{' '}
              {t('modals:actionWizard.row.ops', { count: row.opCount })} •{' '}
              {t('modals:actionWizard.row.savedAt', {
                date: new Date(row.savedAt).toLocaleString(),
              })}
            </div>
          </div>
          <div className={styles.rowActions}>
            <button type="button" onClick={() => dispatch(openRunner(row.id))}>
              {t('modals:actionWizard.openRunner')}
            </button>
            <button type="button" onClick={() => void dispatch(exportActionScriptThunk(row.id))}>
              {t('modals:actionWizard.export')}
            </button>
            <button
              type="button"
              onClick={() => {
                // Honest deferral: full delete-confirm modal lands in v0.9.0
                // (an `alert-dialog`-role ModalShell + dedicated slice flag).
                // v0.8.0 uses the native confirm() so the destructive action
                // is still gated by a user click of the "OK" button.
                // eslint-disable-next-line no-alert -- v0.8.0 fallback per slice header
                if (window.confirm(t('modals:actionWizard.deleteConfirm', { name: row.name }))) {
                  void dispatch(deleteActionScriptThunk(row.id));
                }
              }}
            >
              {t('modals:actionWizard.delete')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
