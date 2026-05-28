// OcrRunningStep — step 3 of the OCR run modal. Renders progress + cancel.
// Per docs/ui-spec.md §14.3 step 3.
//
// All numbers shown to the user come from the live OcrJobProgress (set by the
// applyProgressEvent reducer). Per conventions §16.4.1, confidenceSoFar is
// surfaced raw — we don't binarize it against the threshold.

import { useT, type TFunction } from '../../../i18n/use-t';
import { type OcrJobProgress } from '../../../state/slices/ocr-slice';

import styles from './ocr-run-modal.module.css';

interface OcrRunningStepProps {
  jobProgress: OcrJobProgress | null;
  onCancel: () => void;
}

const PHASE_LABEL_KEYS: Record<OcrJobProgress['phase'], string> = {
  starting: 'modals:ocrRun.phaseStarting',
  rasterizing: 'modals:ocrRun.phaseRasterizing',
  preprocessing: 'modals:ocrRun.phasePreprocessing',
  recognizing: 'modals:ocrRun.phaseRecognizing',
  'composing-text-behind-image': 'modals:ocrRun.phaseComposing',
  'writing-output': 'modals:ocrRun.phaseWriting',
  completed: 'modals:ocrRun.phaseCompleted',
  cancelled: 'modals:ocrRun.phaseCancelled',
  failed: 'modals:ocrRun.phaseFailed',
};

function phaseLabel(phase: OcrJobProgress['phase'], t: TFunction): string {
  return t(PHASE_LABEL_KEYS[phase]);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${String(m)}m ${String(s)}s` : `${String(s)}s`;
}

export function OcrRunningStep(props: OcrRunningStepProps): JSX.Element {
  const { t } = useT();
  const jp = props.jobProgress;

  if (jp === null) {
    return (
      <div className={styles.runningContainer}>
        <p>{t('modals:ocrRun.startingOcr')}</p>
      </div>
    );
  }

  // pageIndex is 0-based and -1 until the first event lands.
  const pageDisplay = jp.pageIndex < 0 ? 1 : jp.pageIndex + 1;
  // Percent: completed pages / total. The current page is "in flight"
  // (incrementing within phases) so we report (pageIndex / total) as the
  // floor; the user sees the bar advance once a page transitions out.
  const completed = Math.max(0, jp.pageIndex);
  const percent = jp.totalPages > 0 ? Math.round((completed / jp.totalPages) * 100) : 0;
  const elapsed = Date.now() - jp.startedAtMs;

  return (
    <div className={styles.runningContainer}>
      <h3 className={styles.stepTitle}>
        {t('modals:ocrRun.phaseLabelOf', {
          phase: phaseLabel(jp.phase, t),
          page: pageDisplay,
          total: jp.totalPages,
        })}
      </h3>

      <div
        className={styles.progressBar}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={styles.progressFill} style={{ width: `${String(percent)}%` }} />
      </div>

      <div className={styles.runningStat}>
        <span>{t('modals:ocrRun.progress')}</span>
        <span>{percent}%</span>
      </div>
      <div className={styles.runningStat}>
        <span>{t('modals:ocrRun.meanConfidenceSoFar')}</span>
        <span>{jp.confidenceSoFar !== null ? `${jp.confidenceSoFar.toFixed(1)}` : '—'}</span>
      </div>
      <div className={styles.runningStat}>
        <span>{t('modals:ocrRun.elapsed')}</span>
        <span>{formatDuration(elapsed)}</span>
      </div>
      <div className={styles.phaseLabel}>{t('modals:ocrRun.phasePrefix', { phase: jp.phase })}</div>

      <div className={styles.footer}>
        <button type="button" className={styles.danger} onClick={props.onCancel}>
          {t('modals:ocrRun.cancelOcr')}
        </button>
      </div>
    </div>
  );
}
