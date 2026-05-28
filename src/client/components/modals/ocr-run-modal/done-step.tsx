// OcrDoneStep — step 4 of the OCR run modal. Renders summary + close.
// Per docs/ui-spec.md §14.3 step 4.

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import {
  selectOcrCurrentSummary,
  selectOcrJobProgress,
  selectOcrLastError,
} from '../../../state/slices/ocr-selectors';
import { setOverlayVisible } from '../../../state/slices/ocr-slice';

import styles from './ocr-run-modal.module.css';

interface OcrDoneStepProps {
  onDone: () => void;
}

export function OcrDoneStep(props: OcrDoneStepProps): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const summary = useAppSelector(selectOcrCurrentSummary);
  const jobProgress = useAppSelector(selectOcrJobProgress);
  const lastError = useAppSelector(selectOcrLastError);

  // The job may have ended in a non-success state: cancelled OR failed.
  // We surface different copy + colors per status.
  const isCancelled = jobProgress?.phase === 'cancelled' || summary?.status === 'cancelled';
  const isFailed = jobProgress?.phase === 'failed' || summary?.status === 'failed';

  if (isFailed) {
    return (
      <div className={styles.doneSummary}>
        <h3 className={styles.stepTitle}>{t('modals:ocrRun.failedTitle')}</h3>
        <div className={styles.errorMessage}>
          {lastError ?? summary?.error ?? t('modals:ocrRun.unknownError')}
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.primary} onClick={props.onDone}>
            {t('modals:ocrRun.close')}
          </button>
        </div>
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className={styles.doneSummary}>
        <h3 className={styles.stepTitle}>{t('modals:ocrRun.cancelledTitle')}</h3>
        <p>{t('modals:ocrRun.cancelledBody')}</p>
        <div className={styles.footer}>
          <button type="button" className={styles.primary} onClick={props.onDone}>
            {t('modals:ocrRun.close')}
          </button>
        </div>
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className={styles.doneSummary}>
        <h3 className={styles.stepTitle}>{t('modals:ocrRun.completeTitle')}</h3>
        <p>{t('modals:ocrRun.summaryNotLoaded')}</p>
        <div className={styles.footer}>
          <button type="button" className={styles.primary} onClick={props.onDone}>
            {t('modals:ocrRun.close')}
          </button>
        </div>
      </div>
    );
  }

  const lowConfidence = summary.pageResults?.reduce((acc, p) => acc + p.lowConfidenceWords, 0) ?? 0;
  const lowConfidencePercent =
    summary.totalWords > 0 ? ((lowConfidence / summary.totalWords) * 100).toFixed(1) : '0.0';

  return (
    <div className={styles.doneSummary}>
      <h3 className={styles.stepTitle}>{t('modals:ocrRun.completeTitle')}</h3>

      <div className={styles.summaryStat}>
        <span className={styles.summaryStatLabel}>{t('modals:ocrRun.recognizedWords')}</span>
        <span className={styles.summaryStatValue}>{summary.totalWords}</span>
      </div>
      <div className={styles.summaryStat}>
        <span className={styles.summaryStatLabel}>{t('modals:ocrRun.pages')}</span>
        <span className={styles.summaryStatValue}>
          {summary.pageRange.start + 1}–{summary.pageRange.end + 1}
        </span>
      </div>
      <div className={styles.summaryStat}>
        <span className={styles.summaryStatLabel}>{t('modals:ocrRun.meanConfidence')}</span>
        <span className={styles.summaryStatValue}>{summary.meanConfidence.toFixed(1)}</span>
      </div>
      <div className={styles.summaryStat}>
        <span className={styles.summaryStatLabel}>{t('modals:ocrRun.lowConfidenceWords')}</span>
        <span className={styles.summaryStatValue}>
          {t('modals:ocrRun.lowConfidenceValue', {
            count: lowConfidence,
            percent: lowConfidencePercent,
          })}
        </span>
      </div>
      <div className={styles.summaryStat}>
        <span className={styles.summaryStatLabel}>{t('modals:ocrRun.totalTime')}</span>
        <span className={styles.summaryStatValue}>
          {Math.round(summary.totalDurationMs / 1000)}s
        </span>
      </div>
      <div className={styles.summaryStat}>
        <span className={styles.summaryStatLabel}>{t('modals:ocrRun.languages')}</span>
        <span className={styles.summaryStatValue}>{summary.langs.join('+')}</span>
      </div>

      <div className={styles.honestyReminder}>
        <p className={styles.honestyReminderTitle}>{t('modals:ocrRun.doneReminderTitle')}</p>
        <p>{t('modals:ocrRun.doneReminderBody')}</p>
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            dispatch(setOverlayVisible(true));
            props.onDone();
          }}
        >
          {t('modals:ocrRun.showConfidenceOverlay')}
        </button>
        <button type="button" className={styles.primary} onClick={props.onDone}>
          {t('modals:ocrRun.done')}
        </button>
      </div>
    </div>
  );
}
