// Action Wizard runner panel — Phase 7.5 B9 UI (Riley Wave 6).
// Spec: docs/ui-spec-phase-7.5.md §9.
//
// Modal that lets the user pick target PDF files + a filename pattern, then
// runs the selected action against each file in batch. The thunk opens each
// chosen path via fs:readPdf to obtain a handle, then dispatches
// actions:runScript. Per-file results render below the progress bar.

import { useT } from '../../i18n/use-t';
import { api } from '../../services/api';
import { basename } from '../../services/basename';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  addRunnerTargets,
  closeRunner,
  removeRunnerTarget,
  selectRunState,
  selectScriptById,
  setRunnerFilenamePattern,
  type RunnerTarget,
} from '../../state/slices/action-wizard-slice';
import { DEFAULT_FILENAME_PATTERN } from '../../state/slices/action-wizard-slice';
import { pushToast } from '../../state/slices/ui-slice';
import { runActionScriptThunk } from '../../state/thunks-phase7-5-wave6';
import { ModalShell } from '../modals/modal-shell';

import styles from './styles.module.css';

export function ActionWizardRunnerPanel(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { t } = useT();
  const run = useAppSelector(selectRunState);
  const script = useAppSelector((s) =>
    run.selectedScriptId === null ? null : selectScriptById(s, run.selectedScriptId),
  );

  if (!run.open || run.selectedScriptId === null) return null;

  const onPickFiles = async (): Promise<void> => {
    const res = await api.dialog.pickPdfFiles({ multi: true });
    if (!res.ok) {
      if (res.error !== 'user_cancelled') {
        dispatch(
          pushToast({ kind: 'error', message: res.message ?? `Picker failed: ${res.error}` }),
        );
      }
      return;
    }
    const targets: RunnerTarget[] = res.value.paths.map((p) => ({
      path: p,
      displayName: basename(p),
    }));
    dispatch(addRunnerTargets(targets));
  };

  const patternIsPdf = run.filenamePattern.trim().toLowerCase().endsWith('.pdf');
  const canRun =
    run.targets.length > 0 && run.filenamePattern.trim().length > 0 && patternIsPdf && !run.running;

  return (
    <ModalShell
      title={t('modals:actionWizard.runTitle', { name: script?.name ?? '' })}
      onClose={() => dispatch(closeRunner())}
      size="lg"
      footer={
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.primary}
            disabled={!canRun}
            onClick={() =>
              void dispatch(
                runActionScriptThunk({
                  scriptId: run.selectedScriptId!,
                  targetPaths: run.targets.map((tgt) => tgt.path),
                  filenamePattern: run.filenamePattern.trim(),
                }),
              )
            }
          >
            {run.running
              ? t('modals:actionWizard.runner.running')
              : t('modals:actionWizard.runner.run')}
          </button>
          <button type="button" onClick={() => dispatch(closeRunner())}>
            {t('modals:actionWizard.runner.close')}
          </button>
        </div>
      }
    >
      <div className={styles.body}>
        <section className={styles.field}>
          <label>{t('modals:actionWizard.runner.targetsHeader')}</label>
          <button type="button" onClick={() => void onPickFiles()}>
            {t('modals:actionWizard.runner.addTargets')}
          </button>
          {run.targets.length === 0 ? (
            <div className={styles.empty}>{t('modals:actionWizard.runner.noTargets')}</div>
          ) : (
            <div className={styles.targetList}>
              {run.targets.map((tgt) => (
                <div key={tgt.path} className={styles.targetRow}>
                  <span title={tgt.path}>{tgt.displayName}</span>
                  <button type="button" onClick={() => dispatch(removeRunnerTarget(tgt.path))}>
                    {t('modals:actionWizard.runner.removeTarget')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.field}>
          <label>{t('modals:actionWizard.runner.destinationHeader')}</label>
          <div className={styles.statusLine}>
            {t('modals:actionWizard.runner.destinationDefault')}
          </div>
          <div className={styles.openQuestion}>
            {t('modals:actionWizard.runner.destinationOpenQuestion')}
          </div>
        </section>

        <section className={styles.field}>
          <label htmlFor="action-runner-pattern">
            {t('modals:actionWizard.runner.patternLabel')}
          </label>
          <input
            id="action-runner-pattern"
            type="text"
            value={run.filenamePattern}
            onChange={(e) => dispatch(setRunnerFilenamePattern(e.target.value))}
          />
          <div className={styles.help}>
            {t('modals:actionWizard.runner.patternHelp', {
              token: '{name}',
              def: DEFAULT_FILENAME_PATTERN,
            })}
          </div>
          {!patternIsPdf && (
            <div className={styles.errorBanner}>
              {t('modals:actionWizard.runner.patternMustBePdf')}
            </div>
          )}
        </section>

        {run.running && (
          <div
            className={`${styles.progress} ${styles.progressIndeterminate}`}
            aria-label="Running"
          />
        )}

        {run.lastRunError !== null && <div className={styles.errorBanner}>{run.lastRunError}</div>}

        {run.results.length > 0 && (
          <section className={styles.field}>
            <label>{t('modals:actionWizard.runner.resultsHeader')}</label>
            <div className={styles.results}>
              {run.results.map((r) => (
                <div
                  key={r.handleIndex}
                  className={`${styles.resultRow} ${r.success ? styles.success : styles.failure}`}
                >
                  {r.success
                    ? t('modals:actionWizard.runner.resultSuccess', {
                        path: r.outputPath ?? '(no path)',
                      })
                    : t('modals:actionWizard.runner.resultFail', {
                        message: r.error ?? 'unknown error',
                      })}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </ModalShell>
  );
}
