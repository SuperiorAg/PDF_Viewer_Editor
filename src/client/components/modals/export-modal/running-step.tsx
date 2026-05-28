// Step 4 — running view shown when the modal is re-opened during an
// in-flight job. Per ui-spec §15.3 / §15.3.4.

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectExportCurrentJob } from '../../../state/slices/export-selectors';
import { cancelExportThunk } from '../../../state/thunks-phase6';

import styles from './export-modal.module.css';

interface RunningStepProps {
  onClose: () => void;
}

export function RunningStep(props: RunningStepProps): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const job = useAppSelector(selectExportCurrentJob);

  if (job === null) {
    return (
      <div className={styles.runningPanel}>
        <p>{t('modals:export.noJobInFlight')}</p>
        <div className={styles.buttonRow}>
          <span />
          <button type="button" className={styles.primaryButton} onClick={props.onClose}>
            {t('modals:export.close')}
          </button>
        </div>
      </div>
    );
  }

  // Compute progress fraction. For per-page phases, pageIndex / totalPages.
  // For writing-output, bytesWritten / totalBytesEstimate (if known).
  let percent = 0;
  if (
    job.phase === 'extracting-text' ||
    job.phase === 'detecting-tables' ||
    job.phase === 'extracting-images' ||
    job.phase === 'rasterizing'
  ) {
    percent =
      job.pageIndex !== null && job.totalPages > 0
        ? Math.min(100, Math.round(((job.pageIndex + 1) / job.totalPages) * 100))
        : 0;
  } else if (job.phase === 'writing-output') {
    percent = 95; // approximate; writing-output is the tail end
  } else if (job.phase === 'completed') {
    percent = 100;
  }

  const phaseLabel: string =
    job.phase === 'starting'
      ? t('modals:export.phaseStarting')
      : job.phase === 'extracting-text'
        ? t('modals:export.phaseExtractingText')
        : job.phase === 'detecting-tables'
          ? t('modals:export.phaseDetectingTables')
          : job.phase === 'extracting-images'
            ? t('modals:export.phaseExtractingImages')
            : job.phase === 'rasterizing'
              ? t('modals:export.phaseRasterizing')
              : job.phase === 'writing-output'
                ? t('modals:export.phaseWritingOutput')
                : job.phase === 'completed'
                  ? t('modals:export.phaseCompleted')
                  : job.phase === 'cancelled'
                    ? t('modals:export.phaseCancelled')
                    : job.errorMessage
                      ? t('modals:export.phaseFailedWithMessage', { message: job.errorMessage })
                      : t('modals:export.phaseFailed');

  const isTerminal =
    job.phase === 'completed' || job.phase === 'cancelled' || job.phase === 'failed';

  return (
    <div className={styles.runningPanel} data-testid="export-running-step">
      <div className={styles.runningProgress}>
        <strong>{job.format.toUpperCase()}</strong>
        <span>
          {job.pageIndex !== null
            ? t('modals:export.pageOfTotal', { current: job.pageIndex + 1, total: job.totalPages })
            : t('modals:export.totalPagesCount', { total: job.totalPages })}{' '}
          — {phaseLabel}
        </span>
      </div>
      <div className={styles.progressBar} aria-label={t('modals:export.exportProgressLabel')}>
        <div
          className={styles.progressFill}
          style={{ width: `${percent}%` }}
          data-percent={percent}
        />
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={isTerminal}
          onClick={() => dispatch(cancelExportThunk({ jobId: job.jobId }))}
          data-testid="export-cancel-button"
        >
          {t('modals:export.cancel')}
        </button>
        <button type="button" className={styles.primaryButton} onClick={props.onClose}>
          {isTerminal ? t('modals:export.close') : t('modals:export.continueInBackground')}
        </button>
      </div>
    </div>
  );
}
