// OcrConfirmInvalidateStep — non-skippable prior-PAdES-signature warning.
// Per docs/ui-spec.md §14.3 step 2 and docs/architecture-phase-5.md §6.
//
// This step is reached when the configure-step's "Start OCR" returns
// 'signed_pdf_requires_confirm'. The user must click "Continue and invalidate"
// to proceed; the modal then re-fires the run with
// invalidatesSignaturesConfirmed: true.

import { useState } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch } from '../../../state/hooks';
import { acknowledgeInvalidateSignatures, setRunStep } from '../../../state/slices/ocr-slice';

import styles from './ocr-run-modal.module.css';

interface OcrConfirmInvalidateStepProps {
  onCancel: () => void;
}

export function OcrConfirmInvalidateStep(props: OcrConfirmInvalidateStepProps): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const [dontAskAgain, setDontAskAgain] = useState<boolean>(false);

  const onProceed = (): void => {
    // Per conventions §16.5.4: "Don't ask me again" is per-SESSION only —
    // the slice does not persist this preference. Phase 5.1 may surface a
    // permanent setting; v1 deliberately doesn't.
    if (dontAskAgain) {
      // The setting value is sent to main via settings.set in a future wave.
      // For now, the acknowledgement is recorded in the draft.
    }
    dispatch(acknowledgeInvalidateSignatures(true));
    dispatch(setRunStep('configure'));
    // The configure step's Start button reruns with the ack flag set.
  };

  return (
    <div className={styles.step}>
      <h3 className={styles.stepTitle}>{t('modals:ocrRun.invalidateStepTitle')}</h3>

      <div className={styles.confirmInvalidate}>
        <p className={styles.confirmInvalidateTitle}>{t('modals:ocrRun.invalidateHeading')}</p>
        <p>{t('modals:ocrRun.invalidateBody1')}</p>
        <p>{t('modals:ocrRun.invalidateBody2')}</p>
        <label>
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
          />{' '}
          {t('modals:ocrRun.dontAskAgain')}
        </label>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.secondary} onClick={props.onCancel}>
          {t('modals:ocrRun.cancel')}
        </button>
        <button type="button" className={styles.danger} onClick={onProceed}>
          {t('modals:ocrRun.continueInvalidate')}
        </button>
      </div>
    </div>
  );
}
