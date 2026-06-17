// Sanitize (Remove Hidden Information) modal — Phase 7.5 B20 (Riley Wave 5).
// Per docs/ui-spec-phase-7.5.md §20.
//
// `role="alertdialog"` because this is a destructive operation. Cancel
// button is the default focus per the redaction-modal pattern from Phase
// 7.4 B1. If the engine returns `signed_pdf_requires_confirm`, the modal
// surfaces the field-name list + a re-arm button that re-dispatches with
// `invalidatesSignaturesConfirmed: true` (same shape as the redaction
// Apply flow, mirroring `thunks-phase7-4.ts`).

import { useEffect, useRef } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  closeSanitize,
  selectedCategories,
  setAllSupportedChecked,
  setCategoryChecked,
  setSanitizeLastError,
} from '../../state/slices/sanitize-slice';
import { applySanitizeThunk } from '../../state/thunks-phase7-5-wave5';
import {
  type SanitizeCategory,
  V080_SUPPORTED_CATEGORIES,
} from '../../types/sanitize-contract-stub';
import { ModalShell } from '../modals/modal-shell';

import styles from './sanitize-modal.module.css';

export function SanitizeModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const state = useAppSelector((s) => s.sanitize);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  // Cancel-button default focus mirrors the redaction-modal pattern (a11y
  // hardening: destructive default is hard to fat-finger).
  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const onClose = (): void => {
    dispatch(closeSanitize());
  };

  const onToggle = (category: SanitizeCategory) => () => {
    dispatch(
      setCategoryChecked({
        category,
        checked: !state.checked[category],
      }),
    );
    if (state.lastErrorMessage !== null) dispatch(setSanitizeLastError(null));
  };

  const onSanitize = (): void => {
    const cats = selectedCategories(state.checked);
    if (cats.length === 0) {
      dispatch(setSanitizeLastError(t('modals:sanitize.categorySelectionRequired')));
      return;
    }
    const padesConfirmed = state.pendingInvalidatedSignatureFields !== null;
    void dispatch(applySanitizeThunk({ invalidatesSignaturesConfirmed: padesConfirmed }));
  };

  const padesPending = state.pendingInvalidatedSignatureFields;

  return (
    <ModalShell title={t('modals:sanitize.title')} onClose={onClose} role="alertdialog" size="md">
      <p className={styles.intro}>{t('modals:sanitize.intro')}</p>

      <div className={styles.bulkRow}>
        <button
          type="button"
          className={styles.bulkButton}
          onClick={() => dispatch(setAllSupportedChecked(true))}
          disabled={state.applying}
        >
          {t('modals:sanitize.selectAll')}
        </button>
        <button
          type="button"
          className={styles.bulkButton}
          onClick={() => dispatch(setAllSupportedChecked(false))}
          disabled={state.applying}
        >
          {t('modals:sanitize.selectNone')}
        </button>
      </div>

      <div className={styles.categoryList}>
        {V080_SUPPORTED_CATEGORIES.map((cat) => (
          <label key={cat} className={styles.categoryRow}>
            <input
              type="checkbox"
              checked={state.checked[cat]}
              onChange={onToggle(cat)}
              disabled={state.applying}
            />
            {t(`modals:sanitize.categories.${cat}`)}
          </label>
        ))}
      </div>

      <div className={styles.warning}>{t('modals:sanitize.rebuildWarning')}</div>

      {padesPending !== null && (
        <div className={styles.padesPanel}>
          <div>{t('modals:sanitize.padesIntro')}</div>
          <ul className={styles.padesList}>
            {padesPending.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div>
            <em>{t('modals:sanitize.padesConfirm')}</em>
          </div>
        </div>
      )}

      {state.lastErrorMessage !== null && (
        <div className={styles.error}>{state.lastErrorMessage}</div>
      )}

      <div className={styles.rowEnd}>
        <button
          type="button"
          className={styles.cancelButton}
          ref={cancelButtonRef}
          onClick={onClose}
          disabled={state.applying}
        >
          {t('modals:sanitize.cancel')}
        </button>
        <button
          type="button"
          className={styles.sanitizeButton}
          onClick={onSanitize}
          disabled={state.applying}
        >
          {state.applying ? t('modals:sanitize.applying') : t('modals:sanitize.sanitize')}
        </button>
      </div>
    </ModalShell>
  );
}
