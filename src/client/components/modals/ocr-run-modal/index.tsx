// OcrRunModal — Phase 5 OCR run wizard.
// Per docs/ui-spec.md §14.3 and docs/architecture-phase-5.md §4.6.
//
// 4 steps: configure -> (confirm-invalidate if signed) -> running -> done.
//
// Trust-floor honesty obligations (architecture-phase-5.md §8 + Wave 14
// three-location pattern):
//   - Configure step: "OCR text accuracy depends on scan quality" + duplicate-
//     layer warning (obligations #1 + #4).
//   - confirm-invalidate step: prior-PAdES signature warning (Phase 4
//     obligation #1).
//
// Conventions §16 cross-references:
//   - §16.4: confidence values surface raw (not threshold-binarized).
//   - §16.5: prior PAdES signatures gate the run with a non-skippable prompt.

import { useEffect } from 'react';

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectCurrentDocument, selectPageCount } from '../../../state/slices/document-selectors';
import {
  selectOcrDraft,
  selectOcrJobProgress,
  selectOcrLastError,
  selectOcrRunStep,
} from '../../../state/slices/ocr-selectors';
import { closeOcrModal, clearJobProgress, setOcrError } from '../../../state/slices/ocr-slice';
import {
  cancelOcrJobThunk,
  detectLanguagesThunk,
  runOcrOnDocumentThunk,
} from '../../../state/thunks-phase5';
import { ModalShell } from '../modal-shell';

import { OcrConfigureStep } from './configure-step';
import { OcrConfirmInvalidateStep } from './confirm-invalidate-step';
import { OcrDoneStep } from './done-step';
// eslint-disable-next-line import/order -- CSS module import is intentionally
// between the sibling-folder imports and the local sub-step imports: it sits
// alphabetically AFTER 'done-step' but BEFORE 'running-step'. ESLint's
// `import/order` rule treats CSS modules and TS modules in the same group
// (relative), so the order rule wants 'ocr-run-modal.module.css' AFTER
// 'running-step'. Visually, however, we want the styles import grouped with
// the component's own peers, not with imports from other folders. Tiny
// trade-off; the rule is more useful at the absolute/relative boundary.
import styles from './ocr-run-modal.module.css';
import { OcrRunningStep } from './running-step';

export function OcrRunModal(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const step = useAppSelector(selectOcrRunStep);
  const doc = useAppSelector(selectCurrentDocument);
  const pageCount = useAppSelector(selectPageCount);
  const draft = useAppSelector(selectOcrDraft);
  const jobProgress = useAppSelector(selectOcrJobProgress);
  const lastError = useAppSelector(selectOcrLastError);

  // Detect installed + downloadable language packs on mount.
  useEffect(() => {
    void dispatch(detectLanguagesThunk());
  }, [dispatch]);

  // On unmount, scrub any in-flight progress state so a future OCR run starts
  // clean. The job itself in main is already terminal (or was cancelled by the
  // X button) by the time we reach this effect.
  useEffect(() => {
    return () => {
      dispatch(clearJobProgress());
      dispatch(setOcrError(null));
    };
  }, [dispatch]);

  const onClose = (): void => {
    if (step === 'running' && jobProgress !== null) {
      // Confirm cancel before allowing modal close — per ui-spec.md §14.3.
      // eslint-disable-next-line no-alert
      const ok = window.confirm(t('modals:ocrRun.confirmCancel'));
      if (!ok) return;
      void dispatch(cancelOcrJobThunk({ jobId: jobProgress.jobId }));
    }
    dispatch(closeOcrModal());
  };

  // Step 2 (confirm-invalidate) is conditional — the modal jumps directly from
  // 'configure' to 'running' when no PAdES signatures are present, and renders
  // an inline confirm prompt only when they are.

  return (
    <ModalShell title={t('modals:ocrRun.title')} onClose={onClose} size="lg">
      <div className={styles.body}>
        {lastError !== null && (
          <div className={styles.errorMessage} role="alert">
            {lastError}
          </div>
        )}

        {step === 'configure' && (
          <OcrConfigureStep
            pageCount={pageCount}
            onCancel={onClose}
            onStart={(args) => {
              if (!doc) return;
              void dispatch(
                runOcrOnDocumentThunk({
                  handle: doc.handle,
                  pageRange: args.pageRange,
                  langs: args.langs,
                  preprocess: args.preprocess,
                  invalidatesSignaturesConfirmed: draft.invalidateSignaturesAcknowledged,
                }),
              );
            }}
          />
        )}

        {step === 'confirm-invalidate' && <OcrConfirmInvalidateStep onCancel={onClose} />}

        {step === 'running' && (
          <OcrRunningStep
            jobProgress={jobProgress}
            onCancel={() => {
              if (jobProgress !== null) {
                void dispatch(cancelOcrJobThunk({ jobId: jobProgress.jobId }));
              }
            }}
          />
        )}

        {step === 'done' && <OcrDoneStep onDone={onClose} />}
      </div>
    </ModalShell>
  );
}
