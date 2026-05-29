// Confirm-and-sign step — Phase 4 PAdES sign step 3.
// Per docs/ui-spec.md §13.5 (Step 3).

import { useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { applyPadesSignatureThunk } from '../../../state/thunks-phase4';
import { type SignaturePlacement } from '../../../types/ipc-contract';

import styles from './pades-sign-modal.module.css';

export function ConfirmAndSignStep(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const cert = useAppSelector((s) => s.signatures.cert);
  const options = useAppSelector((s) => s.signatures.padesOptions);
  const signing = useAppSelector((s) => s.signatures.signing);
  const error = useAppSelector((s) => s.signatures.lastError);

  const [placementMode, setPlacementMode] = useState<'placeholder' | 'freeform'>('freeform');

  const onSign = (): void => {
    if (!cert) return;
    const placement: SignaturePlacement = { mode: placementMode };
    const arg: Parameters<typeof applyPadesSignatureThunk>[0] = {
      placement,
      certHandle: cert.handle,
      useTsa: options.useTsa,
    };
    if (options.reason.length > 0) arg.reason = options.reason;
    if (options.location.length > 0) arg.location = options.location;
    void dispatch(applyPadesSignatureThunk(arg));
  };

  return (
    <div className={styles.body}>
      <div className={styles.field}>
        <span className={styles.label}>{t('modals:padesSign.placeSignature')}</span>
        <label className={styles.optionRow}>
          <input
            type="radio"
            name="placement"
            checked={placementMode === 'placeholder'}
            onChange={() => setPlacementMode('placeholder')}
          />
          {t('modals:padesSign.placeOntoField')}
        </label>
        <label className={styles.optionRow}>
          <input
            type="radio"
            name="placement"
            checked={placementMode === 'freeform'}
            onChange={() => setPlacementMode('freeform')}
          />
          {t('modals:padesSign.placeFreeform')}
        </label>
      </div>
      <p>{t('modals:padesSign.clickSignInfo')}</p>
      {signing && (
        <div className={styles.spinner}>
          <span aria-live="polite">
            {options.useTsa ? t('modals:padesSign.signingTsa') : t('modals:padesSign.signing')}
          </span>
        </div>
      )}
      {error && <div className={styles.errorText}>{error}</div>}
      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.button} ${styles.buttonPrimary} ${
            signing || !cert ? styles.buttonDisabled : ''
          }`}
          onClick={onSign}
          disabled={signing || !cert}
        >
          {signing ? t('modals:padesSign.signing') : t('modals:padesSign.signButton')}
        </button>
      </div>
    </div>
  );
}
