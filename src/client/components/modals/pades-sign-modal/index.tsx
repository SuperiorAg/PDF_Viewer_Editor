// PadesSignModal — Phase 4 cryptographic signature modal (3 steps).
// Per docs/ui-spec.md §13.5 + docs/architecture-phase-4.md §2.3.
//
// ============================================================================
// CRITICAL — Cert release on every close path (conventions §15.1 rule 5).
// ----------------------------------------------------------------------------
// The cleanup effect at the modal level fires releaseCertThunk if a cert
// handle exists. This is the renderer half of the "modal cleanup" rule. The
// handle is ALSO auto-released by applyPades on success (autoRelease=true).
// Both belt and braces — Wave 17 Julian verifies both paths.
//
// On every dismiss path (X, Esc, route change, app quit), the modal unmount
// fires the cleanup; the cert is released; no PEM lingers under our control.
// ============================================================================

import { useEffect } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { closeSignatureModal, setPadesStep } from '../../../state/slices/signatures-slice';
import { releaseCertThunk } from '../../../state/thunks-phase4';
import { ModalShell } from '../modal-shell';

import { CertLoaderStep } from './cert-loader-step';
import { ConfirmAndSignStep } from './confirm-and-sign-step';
import styles from './pades-sign-modal.module.css';
import { SignOptionsStep } from './sign-options-step';

export function PadesSignModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const step = useAppSelector((s) => s.signatures.padesStep);
  const certHandle = useAppSelector((s) => s.signatures.cert?.handle ?? null);

  const stepLabels: Record<string, string> = {
    cert: t('modals:padesSign.certStep'),
    options: t('modals:padesSign.optionsStep'),
    sign: t('modals:padesSign.confirmStep'),
  };

  const onClose = (): void => {
    dispatch(closeSignatureModal());
  };

  // Cleanup: release cert handle on unmount. Per conventions §15.1 rule 5.
  // The thunk does best-effort release; idempotent even if cert already
  // gone (applyPades autoRelease may have fired first).
  useEffect(() => {
    return () => {
      if (certHandle) {
        void dispatch(releaseCertThunk({ handle: certHandle }));
      }
    };
    // NB: deliberately do NOT depend on certHandle — we want the cleanup to
    // capture the handle that's live at the moment of unmount, not chase
    // every change. This is correct because the cleanup runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stepIndicator = (
    <ol className={styles.stepIndicator} aria-label={t('modals:padesSign.stepsLabel')}>
      {(['cert', 'options', 'sign'] as const).map((s) => (
        <li
          key={s}
          className={`${styles.step} ${s === step ? styles.stepActive : ''} ${
            (s === 'cert' && step !== 'cert') || (s === 'options' && step === 'sign')
              ? styles.stepDone
              : ''
          }`}
        >
          {stepLabels[s]}
        </li>
      ))}
    </ol>
  );

  return (
    <ModalShell title={t('modals:padesSign.title')} onClose={onClose} size="md">
      {stepIndicator}
      {step === 'cert' && <CertLoaderStep />}
      {step === 'options' && <SignOptionsStep />}
      {step === 'sign' && <ConfirmAndSignStep />}

      {step !== 'cert' && step !== 'sign' && (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.button}
            onClick={() => dispatch(setPadesStep('cert'))}
          >
            {t('modals:padesSign.back')}
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={() => dispatch(setPadesStep('sign'))}
          >
            {t('modals:padesSign.next')}
          </button>
        </div>
      )}
      {step === 'sign' && (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.button}
            onClick={() => dispatch(setPadesStep('options'))}
          >
            {t('modals:padesSign.back')}
          </button>
        </div>
      )}
    </ModalShell>
  );
}
