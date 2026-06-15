// ApplyRedactionsModal — Phase 7.4 B1 confirmation modal.
// Per docs/phase-7.4-b1-redaction-design.md §2.4.
//
// `role="alertdialog"` (modal-shell.tsx exposes this via prop):
//   - Narrator reads the full body before announcing buttons.
//   - Esc closes (cancel); the only confirm path is an explicit click on the
//     red Apply button (NO Enter-on-button shortcut — destructive-action
//     discipline from conventions §16.5).
//
// Body composition (per design §2.4):
//   - Intro: "You are about to redact N areas across M pages."
//   - Bullet list of after-Apply consequences (4 bullets).
//   - Footer text (cancel-is-safe + Save-As hint amber callout).
//   - If signatures detected (after first dispatch returns
//     'signed_pdf_requires_confirm'), a red panel listing the field names.
//   - Buttons: Cancel (focus default) + Apply (red danger).

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectRedactionApplying,
  selectRedactionLastApplyError,
  selectRedactionPagesWithMarks,
  selectRedactionPendingInvalidatedSignatureFields,
  selectRedactionTotalMarks,
} from '../../state/slices/redactions-slice';
import { selectRedactionApplyModalOpen } from '../../state/slices/ui-selectors';
import { setRedactionApplyModalOpen } from '../../state/slices/ui-slice';
import { applyRedactionsThunk } from '../../state/thunks-phase7-4';
import { ModalShell } from '../modals/modal-shell';

import styles from './redaction-tools.module.css';

export function ApplyRedactionsModal(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectRedactionApplyModalOpen);
  const totalMarks = useAppSelector(selectRedactionTotalMarks);
  const pagesWithMarks = useAppSelector(selectRedactionPagesWithMarks);
  const applying = useAppSelector(selectRedactionApplying);
  const lastError = useAppSelector(selectRedactionLastApplyError);
  const invalidatedFields = useAppSelector(selectRedactionPendingInvalidatedSignatureFields);
  // Cancel-is-default-focus per design §2.4 — focus the Cancel button on mount
  // via an effect rather than the autoFocus prop (jsx-a11y/no-autofocus).
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (cancelButtonRef.current) {
      cancelButtonRef.current.focus();
    }
  }, []);

  const onCancel = useCallback(() => {
    dispatch(setRedactionApplyModalOpen(false));
  }, [dispatch]);

  const onApply = useCallback(() => {
    // Two-pass flow: first call WITHOUT the confirm flag. If signatures are
    // present, the engine returns `signed_pdf_requires_confirm`; the slice
    // populates `pendingInvalidatedSignatureFields`; the modal re-renders with
    // the signature paragraph; the next click re-dispatches with confirmed=true.
    const alreadyConfirmed = invalidatedFields.length > 0;
    void dispatch(applyRedactionsThunk({ invalidatesSignaturesConfirmed: alreadyConfirmed }));
  }, [dispatch, invalidatedFields.length]);

  // Map last-error code to localized inline message.
  const inlineError = useMemo((): string | null => {
    if (lastError === null) return null;
    switch (lastError) {
      case 'invalid_payload':
        return t('modals:redaction.errorInvalidPayload');
      case 'handle_not_found':
        return t('modals:redaction.errorHandleNotFound');
      case 'no_redactions':
        return null; // gated by UI; never user-visible
      case 'page_out_of_range':
        return t('modals:redaction.errorPageOutOfRange');
      case 'rect_invalid':
        return t('modals:redaction.errorRectInvalid');
      case 'signed_pdf_requires_confirm':
        // The signature panel below explains; we do not duplicate it here.
        return null;
      case 'pdf_load_failed':
        return t('modals:redaction.errorPdfLoadFailed');
      case 'rasterize_failed':
        return t('modals:redaction.errorRasterizeFailed');
      case 'engine_failed':
        return t('modals:redaction.errorEngineFailed', { message: '' });
      case 'output_too_large':
        return t('modals:redaction.errorOutputTooLarge');
      case 'bridge_unavailable':
        return t('modals:redaction.errorEngineFailed', { message: '' });
      case 'cancelled':
        return null;
    }
    return null;
  }, [lastError, t]);

  if (!open) return null;

  const showSignatureBlock = invalidatedFields.length > 0;

  return (
    <ModalShell
      title={t('modals:redaction.applyTitle')}
      onClose={onCancel}
      role="alertdialog"
      size="lg"
    >
      <div className={styles.modalBody}>
        {inlineError !== null && (
          <div className={styles.modalError} role="alert">
            {inlineError}
          </div>
        )}
        <p className={styles.modalIntro}>
          {t('modals:redaction.applyIntro', {
            count: totalMarks,
            rects: totalMarks,
            pages: pagesWithMarks,
          })}
        </p>
        <p>{t('modals:redaction.applyBullets')}</p>
        <ul className={styles.modalBullets}>
          <li>{t('modals:redaction.applyBulletRemoved')}</li>
          <li>{t('modals:redaction.applyBulletRaster')}</li>
          <li>{t('modals:redaction.applyBulletSanitize')}</li>
          <li>{t('modals:redaction.applyBulletIrreversible')}</li>
        </ul>
        <p className={styles.modalFooterText}>{t('modals:redaction.applyFooter')}</p>
        <div className={styles.modalSaveAsHint}>{t('modals:redaction.applySaveAsHint')}</div>
        {showSignatureBlock && (
          <div className={styles.modalSignatures} role="alert">
            <p className={styles.modalSignaturesHeading}>
              {t('modals:redaction.applySignatureHeading')}
            </p>
            <ul className={styles.modalSignatureList}>
              {invalidatedFields.map((field) => (
                <li key={field}>{field || t('modals:redaction.applyFieldFreeform')}</li>
              ))}
            </ul>
            <p>{t('modals:redaction.applySignatureBody')}</p>
          </div>
        )}
        <div className={styles.modalActions}>
          <button
            ref={cancelButtonRef}
            type="button"
            className={styles.secondaryButton}
            onClick={onCancel}
            disabled={applying}
          >
            {t('modals:redaction.applyCancel')}
          </button>
          <button
            type="button"
            className={styles.dangerButton}
            onClick={onApply}
            disabled={applying || totalMarks === 0}
          >
            {applying ? t('modals:redaction.applyInFlight') : t('modals:redaction.applyConfirm')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
