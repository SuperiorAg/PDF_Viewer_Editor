// ExportModal — Phase 6 multi-step Export-to-Office wizard.
// Per docs/ui-spec.md §15.3 + docs/architecture-phase-6.md §4.5.
//
// 4 steps: format -> options -> confirm -> running.
//
// Modal-closes-after-enqueue inversion (Q-E): on START EXPORT, the modal
// enqueues the job, then closes. The job continues in the background; progress
// surfaces in the status-bar widget + the Exports sidebar tab. Re-opening the
// modal while a job is running jumps to Step 4 (running).
//
// Trust-floor honesty obligations (conventions §17.3 — fifth instance):
//   - PerFormatLimitationsPanel mounts in Step 2 (the load-bearing UI surface).
//   - Run banner with cross-cutting duration reminder also surfaces in Step 3.
//
// Conventions §16-ish (Phase 5 OCR modal pattern):
//   - ESC closes (Step 1-3); Step 4 leaves the job running.
//   - Click-outside dismiss handled by ModalShell.

import { useCallback, useEffect } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectCurrentDocument, selectPageCount } from '../../../state/slices/document-selectors';
import {
  selectExportCurrentJob,
  selectExportDraft,
  selectExportModalStep,
  selectExportPhase6LastError,
  selectResolvedQualityTier,
} from '../../../state/slices/export-selectors';
import { setModalStep } from '../../../state/slices/export-slice';
import {
  closeExportModalAndCleanup,
  listExportFormatsThunk,
  pickExportOutputPathThunk,
  startExportThunk,
} from '../../../state/thunks-phase6';
import { ModalShell } from '../modal-shell';

import styles from './export-modal.module.css';
import { FormatPicker } from './format-picker';
import { PerFormatLimitationsPanel } from './per-format-limitations-panel';
import { PerFormatOptions } from './per-format-options';
import { QualityTierPicker } from './quality-tier-picker';
import { RunningStep } from './running-step';

function basenameFromDoc(displayName: string | null | undefined): string {
  if (!displayName) return 'export';
  const segs = displayName.split(/[/\\]/);
  const last = segs[segs.length - 1] ?? 'export';
  return last.replace(/\.pdf$/i, '');
}

export function ExportModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const step = useAppSelector(selectExportModalStep);
  const draft = useAppSelector(selectExportDraft);
  const doc = useAppSelector(selectCurrentDocument);
  const pageCount = useAppSelector(selectPageCount);
  const job = useAppSelector(selectExportCurrentJob);
  const lastError = useAppSelector(selectExportPhase6LastError);
  const resolvedTier = useAppSelector(selectResolvedQualityTier);

  // Load the format catalog on first mount.
  useEffect(() => {
    void dispatch(listExportFormatsThunk());
  }, [dispatch]);

  const onClose = useCallback((): void => {
    void dispatch(closeExportModalAndCleanup());
  }, [dispatch]);

  const onBrowse = async (): Promise<void> => {
    if (!draft.format) return;
    await dispatch(
      pickExportOutputPathThunk({
        defaultBasename: basenameFromDoc(doc?.displayName),
        format: draft.format,
      }),
    );
  };

  const onNext = (): void => {
    if (step === 'format') dispatch(setModalStep('options'));
    else if (step === 'options') dispatch(setModalStep('confirm'));
  };

  const onBack = (): void => {
    if (step === 'options') dispatch(setModalStep('format'));
    else if (step === 'confirm') dispatch(setModalStep('options'));
  };

  const onStart = (): void => {
    if (!doc || !draft.format || !draft.outputPath) return;
    // Resolve page range — null means "all pages".
    const pageRange = draft.pageRange ?? {
      start: 0,
      end: Math.max(0, pageCount - 1),
    };
    void dispatch(
      startExportThunk({
        handle: doc.handle,
        format: draft.format,
        qualityTier: resolvedTier,
        pageRange,
        includeAnnotations: draft.includeAnnotations,
        pageSize: draft.pageSize,
        outputPath: draft.outputPath,
        imageOptions: draft.imageOptions,
      }),
    );
    // Close the modal immediately per Q-E (modal-closes-after-enqueue).
    void dispatch(closeExportModalAndCleanup());
  };

  const canAdvanceFromFormat = draft.format !== null;
  const canAdvanceFromOptions = draft.outputPath !== null;

  // Effective step — if a job is running, force 'running' view regardless of
  // step state (the user can re-open the modal mid-job and see the progress).
  const effectiveStep = job !== null && step === 'running' ? 'running' : step;

  return (
    <ModalShell title={t('modals:export.title')} onClose={onClose} size="lg">
      <div className={styles.body}>
        {lastError !== null && (
          <div className={styles.errorMessage} role="alert">
            {lastError}
          </div>
        )}

        {/* Step bar — visible across format/options/confirm steps */}
        {effectiveStep !== 'running' && (
          <div className={styles.stepBar} aria-label={t('modals:export.wizardStepsLabel')}>
            <span
              className={`${styles.stepBarItem} ${
                effectiveStep === 'format' ? styles.stepBarItemActive : ''
              }`}
            >
              {t('modals:export.stepFormat')}
            </span>
            <span className={styles.stepBarDivider}>›</span>
            <span
              className={`${styles.stepBarItem} ${
                effectiveStep === 'options' ? styles.stepBarItemActive : ''
              }`}
            >
              {t('modals:export.stepOptions')}
            </span>
            <span className={styles.stepBarDivider}>›</span>
            <span
              className={`${styles.stepBarItem} ${
                effectiveStep === 'confirm' ? styles.stepBarItemActive : ''
              }`}
            >
              {t('modals:export.stepConfirm')}
            </span>
          </div>
        )}

        {/* Step 1 — format picker */}
        {effectiveStep === 'format' && (
          <>
            <FormatPicker />
            <div className={styles.buttonRow}>
              <button type="button" className={styles.secondaryButton} onClick={onClose}>
                {t('modals:export.cancel')}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!canAdvanceFromFormat}
                onClick={onNext}
                data-testid="format-next-button"
              >
                {t('modals:export.next')}
              </button>
            </div>
          </>
        )}

        {/* Step 2 — quality + options + limitations panel + output path */}
        {effectiveStep === 'options' && draft.format !== null && (
          <>
            <QualityTierPicker />
            <PerFormatOptions />
            <div className={styles.optionsBlock}>
              <div className={styles.optionRow}>
                <span className={styles.optionLabel}>{t('modals:export.output')}</span>
                <span className={styles.optionInputPath}>
                  {draft.outputPath ?? t('modals:export.outputNotChosen')}
                </span>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void onBrowse()}
                  data-testid="browse-output-button"
                >
                  {t('modals:export.browse')}
                </button>
              </div>
            </div>
            <PerFormatLimitationsPanel format={draft.format} />
            <div className={styles.buttonRow}>
              <button type="button" className={styles.secondaryButton} onClick={onBack}>
                {t('modals:export.back')}
              </button>
              <div className={styles.buttonRowRight}>
                <button type="button" className={styles.secondaryButton} onClick={onClose}>
                  {t('modals:export.cancel')}
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!canAdvanceFromOptions}
                  onClick={onNext}
                  data-testid="options-next-button"
                >
                  {t('modals:export.next')}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 3 — confirm + start */}
        {effectiveStep === 'confirm' && draft.format !== null && (
          <>
            <div className={styles.confirmSummary} data-testid="export-confirm-summary">
              <div className={styles.confirmRow}>
                <span className={styles.confirmLabel}>{t('modals:export.confirmFormat')}</span>
                <span className={styles.confirmValue}>{draft.format}</span>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmLabel}>{t('modals:export.confirmQuality')}</span>
                <span className={styles.confirmValue}>{resolvedTier}</span>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmLabel}>{t('modals:export.confirmPages')}</span>
                <span className={styles.confirmValue}>
                  {draft.pageRange === null
                    ? t('modals:export.confirmPagesAll', { count: pageCount })
                    : `${draft.pageRange.start + 1}–${draft.pageRange.end + 1}`}
                </span>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmLabel}>{t('modals:export.confirmAnnotations')}</span>
                <span className={styles.confirmValue}>
                  {draft.includeAnnotations
                    ? t('modals:export.confirmAnnotationsIncluded')
                    : t('modals:export.confirmAnnotationsExcluded')}
                </span>
              </div>
              <div className={styles.confirmRow}>
                <span className={styles.confirmLabel}>{t('modals:export.confirmOutput')}</span>
                <span className={styles.confirmValue}>
                  {draft.outputPath ?? t('modals:export.confirmOutputNone')}
                </span>
              </div>
            </div>
            {/* Re-surface the limitations panel at confirm step too — fifth
                trust-floor placement bonus for users who skipped reading at
                Step 2. */}
            <PerFormatLimitationsPanel format={draft.format} />
            <div className={styles.buttonRow}>
              <button type="button" className={styles.secondaryButton} onClick={onBack}>
                {t('modals:export.back')}
              </button>
              <div className={styles.buttonRowRight}>
                <button type="button" className={styles.secondaryButton} onClick={onClose}>
                  {t('modals:export.cancel')}
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!canAdvanceFromOptions || !doc}
                  onClick={onStart}
                  data-testid="export-start-button"
                >
                  {t('modals:export.startButton')}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 4 — running view (only relevant when a job is in-flight) */}
        {effectiveStep === 'running' && <RunningStep onClose={onClose} />}
      </div>
    </ModalShell>
  );
}
