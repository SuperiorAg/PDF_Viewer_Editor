// Action Wizard record dialog — Phase 7.5 B9 UI (Riley Wave 6).
// Spec: docs/ui-spec-phase-7.5.md §9.
//
// Modal that captures dispatched edit ops while the user drives the document.
// Live name input + ops-recorded counter + pause/resume/stop. The recorder
// middleware (state/middleware/action-recorder-middleware.ts) does the actual
// op capture; this UI controls the lifecycle + surfaces honesty about banned
// ops via a toast triggered in an effect.

import { useEffect } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  clearLastBanned,
  closeRecordDialog,
  pauseRecording,
  resumeRecording,
  selectRecording,
  setRecordName,
  startRecording,
  stopRecording,
} from '../../state/slices/action-wizard-slice';
import { pushToast } from '../../state/slices/ui-slice';
import { saveActionScriptThunk } from '../../state/thunks-phase7-5-wave6';
import { ModalShell } from '../modals/modal-shell';

import styles from './styles.module.css';

export function ActionWizardRecordDialog(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const { t } = useT();
  const recording = useAppSelector(selectRecording);

  // When the middleware logs a banned op, surface a toast (verbatim per
  // P7.5-L-10) then clear the field so the same kind can re-toast later.
  useEffect(() => {
    if (recording.lastBannedKind !== null) {
      dispatch(
        pushToast({
          kind: 'warning',
          message: t('modals:actionWizard.bannedOpToast', { kind: recording.lastBannedKind }),
        }),
      );
      dispatch(clearLastBanned());
    }
  }, [recording.lastBannedKind, dispatch, t]);

  if (!recording.open) return null;

  const status = (() => {
    if (!recording.active) return 'idle';
    if (recording.paused) return 'paused';
    return 'active';
  })();

  const statusKey =
    status === 'active'
      ? 'modals:actionWizard.recordingActive'
      : status === 'paused'
        ? 'modals:actionWizard.recordingPaused'
        : 'modals:actionWizard.recordingIdle';

  const statusClass = `${styles.statusLine} ${
    status === 'active' ? styles.active : status === 'paused' ? styles.paused : ''
  }`;

  return (
    <ModalShell
      title={t('modals:actionWizard.recordTitle')}
      onClose={() => dispatch(closeRecordDialog())}
      size="md"
      footer={
        <div className={styles.controls}>
          {!recording.active && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => dispatch(startRecording())}
            >
              {t('modals:actionWizard.start')}
            </button>
          )}
          {recording.active && !recording.paused && (
            <button type="button" onClick={() => dispatch(pauseRecording())}>
              {t('modals:actionWizard.pause')}
            </button>
          )}
          {recording.active && recording.paused && (
            <button
              type="button"
              className={styles.primary}
              onClick={() => dispatch(resumeRecording())}
            >
              {t('modals:actionWizard.resume')}
            </button>
          )}
          {recording.active && (
            <button
              type="button"
              className={styles.danger}
              onClick={() => dispatch(stopRecording())}
            >
              {t('modals:actionWizard.stop')}
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={
              recording.saving ||
              recording.active ||
              recording.capturedOps.length === 0 ||
              recording.name.trim().length === 0
            }
            onClick={() => void dispatch(saveActionScriptThunk())}
          >
            {recording.saving ? t('modals:actionWizard.saving') : t('modals:actionWizard.save')}
          </button>
          <button type="button" onClick={() => dispatch(closeRecordDialog())}>
            {t('modals:actionWizard.cancel')}
          </button>
        </div>
      }
    >
      <div className={styles.body}>
        <div className={styles.field}>
          <label htmlFor="action-wizard-name">{t('modals:actionWizard.nameLabel')}</label>
          <input
            id="action-wizard-name"
            type="text"
            placeholder={t('modals:actionWizard.namePlaceholder')}
            value={recording.name}
            onChange={(e) => dispatch(setRecordName(e.target.value))}
          />
        </div>
        <div className={statusClass} role="status">
          {t(statusKey)}
        </div>
        <div className={styles.counter}>
          <span>
            {t('modals:actionWizard.opsRecorded', { count: recording.capturedOps.length })}
          </span>
          {recording.bannedCount > 0 && (
            <span>{t('modals:actionWizard.bannedCount', { count: recording.bannedCount })}</span>
          )}
        </div>
        {recording.lastSaveError !== null && (
          <div className={styles.errorBanner}>{recording.lastSaveError}</div>
        )}
      </div>
    </ModalShell>
  );
}
