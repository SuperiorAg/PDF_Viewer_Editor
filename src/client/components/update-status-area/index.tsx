// UpdateStatusArea — the load-bearing trust-floor UI for update obligations #2
// + #6 (ui-spec.md §16.2). Renders the live update status honestly:
//   - 'not-configured' → the explicit "release channel not configured
//     (placeholder)" notice, NEVER a fake "up to date" (P7-L-2).
//   - 'available'       → a user-initiated "Download update" button.
//   - 'downloaded'      → a user-initiated "Restart and install" button.
// Downloads + installs are ALWAYS user-initiated — never automatic.
//
// Shared by the standalone About modal + the Settings → About tab so the two
// surfaces present identical honesty copy.

import { useState } from 'react';
import { useStore } from 'react-redux';

import { useUpdateActions } from '../../hooks/use-update-actions';
import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectIsDirty } from '../../state/slices/document-selectors';
import { selectUpdateState } from '../../state/slices/phase7-selectors';
import type { RootState } from '../../state/store';
import { saveDocumentThunk } from '../../state/thunks';

import styles from './update-status-area.module.css';

export function UpdateStatusArea(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const { checkNow, download, install } = useUpdateActions();
  const update = useAppSelector(selectUpdateState);
  // Renderer-owned dirty state — the AUTHORITATIVE unsaved-work signal (the
  // main-side `hasUnsavedWork` probe is defensively `false`; dirty state lives
  // in the renderer store, same design as `app:quit`/ConfirmCloseUnsaved). We
  // gate on THIS so the confirm dialog actually fires in production — relying on
  // the main gate's `blocked-unsaved` alone would never trigger (Julian
  // H-FIX.1: the main gate is defense-in-depth, not the live trigger).
  const isDirty = useAppSelector(selectIsDirty);

  // Phase-7.1 unsaved-work install gate (David H-29.1 main-side gate +
  // renderer-driven confirm). Before the irreversible install (which restarts
  // the app and would lose unsaved edits/annotations/signatures), if the
  // document is dirty we surface a Save / Discard-and-install / Cancel confirm
  // dialog inline (it lives here because the install button does, and this area
  // is shared by the About modal + Settings → About tab). Mirrors the
  // ConfirmCloseUnsaved discipline (safe default = Save).
  const [confirmInstall, setConfirmInstall] = useState(false);

  const onInstall = async (version: string): Promise<void> => {
    // Renderer-driven gate: a dirty document prompts BEFORE the install fires.
    if (isDirty) {
      setConfirmInstall(true);
      return;
    }
    const outcome = await install(version);
    // Defense-in-depth: if a future main-side dirty mirror is wired, honor its
    // refusal too (the dialog is identical).
    if (outcome.kind === 'blocked-unsaved') setConfirmInstall(true);
    // 'quitting' → process is exiting; 'error' → surfaced via the status line.
  };

  const onSaveThenInstall = async (version: string): Promise<void> => {
    setConfirmInstall(false);
    // Commit the document first; once clean, the install proceeds. The save
    // thunk returns void and swallows a cancelled Save-As dialog, so we re-read
    // FRESH dirty state from the store (the `isDirty` selector value captured in
    // this closure is stale). If the save was cancelled or failed, the document
    // is still dirty — re-open the confirm rather than installing and losing
    // work (fail-safe: never install over an unsaved doc).
    await dispatch(saveDocumentThunk({ saveAs: false }));
    if (selectIsDirty(store.getState())) {
      setConfirmInstall(true);
      return;
    }
    await install(version);
  };

  const onDiscardThenInstall = async (version: string): Promise<void> => {
    setConfirmInstall(false);
    await install(version, true);
  };

  let statusLine: string;
  switch (update.status) {
    case 'checking':
      statusLine = t('modals:about.statusChecking');
      break;
    case 'up-to-date':
      statusLine = t('modals:about.statusUpToDate');
      break;
    case 'available':
      statusLine = t('modals:about.statusAvailable', {
        version: update.availableVersion ?? '',
      });
      break;
    case 'downloading':
      statusLine = t('modals:about.statusDownloading', {
        percent: update.downloadProgressPercent ?? 0,
      });
      break;
    case 'downloaded':
      statusLine = t('modals:about.statusDownloaded');
      break;
    case 'error':
      statusLine = t('modals:about.statusError', {
        message: update.errorCode ? t(`errors:${update.errorCode}`) : '',
      });
      break;
    case 'not-configured':
      // The HONEST placeholder notice — obligations #2 + #6.
      statusLine = t('modals:about.statusNotConfigured');
      break;
    default:
      statusLine = '';
  }

  return (
    <div className={styles.updateArea}>
      <p
        className={update.status === 'not-configured' ? styles.notConfigured : styles.status}
        // assertive when the channel is not configured so Narrator reads the
        // honesty notice; polite for routine status changes.
        aria-live={update.status === 'not-configured' ? 'assertive' : 'polite'}
        data-status={update.status}
      >
        {statusLine}
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => void checkNow()}
          disabled={update.status === 'checking' || update.status === 'downloading'}
        >
          {t('modals:about.checkNow')}
        </button>

        {update.status === 'available' && update.availableVersion !== null && (
          <button
            type="button"
            className={styles.primary}
            onClick={() => void download(update.availableVersion!)}
          >
            {t('modals:about.downloadUpdate')}
          </button>
        )}

        {update.status === 'downloaded' && update.availableVersion !== null && (
          <button
            type="button"
            className={styles.primary}
            onClick={() => void onInstall(update.availableVersion!)}
          >
            {t('modals:about.restartInstall')}
          </button>
        )}
      </div>

      {confirmInstall && update.availableVersion !== null && (
        <div className={styles.installConfirm} role="alertdialog" aria-label={t('modals:about.installConfirmTitle')}>
          <p className={styles.installConfirmBody}>{t('modals:about.installConfirmBody')}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setConfirmInstall(false)}
            >
              {t('modals:about.installCancel')}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void onDiscardThenInstall(update.availableVersion!)}
            >
              {t('modals:about.installDiscardThenInstall')}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void onSaveThenInstall(update.availableVersion!)}
            >
              {t('modals:about.installSaveThenInstall')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
