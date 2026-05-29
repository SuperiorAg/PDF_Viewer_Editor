// useUpdateActions — shared auto-update action dispatchers consumed by both the
// Settings → General Updates group and the standalone About modal's update area
// (architecture-phase-7.md §3.4). Keeps the placeholder-honest flow in ONE
// place so the two surfaces cannot drift.
//
// HONESTY (P7-L-2 / trust-floor obligation #2): a check that returns
// `update_not_configured` routes to status 'not-configured' — the UI shows the
// explicit "release channel not configured (placeholder)" notice, NEVER a fake
// "up to date".

import { useCallback } from 'react';

import { api } from '../services/api';
import { useAppDispatch } from '../state/hooks';
import {
  updateCheckFailed,
  updateCheckStarted,
  updateCheckSucceeded,
  updateDownloaded,
  updateNotConfigured,
} from '../state/slices/update-slice';
import { useTelemetry } from '../telemetry/use-telemetry';

/**
 * Result of an install attempt, surfaced to the caller so the UI can react to
 * the unsaved-work gate (Phase 7.1 — David's H-29.1 main-side gate). On a
 * successful install the process quits and the renderer never observes a return;
 * the meaningful return values are the failure paths.
 */
export type InstallOutcome =
  | { kind: 'quitting' }
  | { kind: 'blocked-unsaved' }
  | { kind: 'error'; error: string };

export interface UpdateActions {
  checkNow: () => Promise<void>;
  download: (version: string) => Promise<void>;
  /**
   * Trigger the update install. Pass `confirmedDiscardUnsaved: true` after the
   * user has chosen "Discard and install" in the unsaved-work confirm dialog.
   * When unsaved work exists and the flag is falsy, the main-side gate returns
   * `unsaved_work_blocks_install` and this resolves to `{ kind: 'blocked-unsaved' }`.
   */
  install: (version: string, confirmedDiscardUnsaved?: boolean) => Promise<InstallOutcome>;
}

export function useUpdateActions(): UpdateActions {
  const dispatch = useAppDispatch();
  const record = useTelemetry();

  const checkNow = useCallback(async () => {
    dispatch(updateCheckStarted());
    record('feature.update.checked');
    const res = await api.update.check({ trigger: 'explicit' });
    if (res.ok) {
      dispatch(updateCheckSucceeded(res.value));
    } else if (res.error === 'update_not_configured') {
      dispatch(updateNotConfigured());
    } else {
      dispatch(updateCheckFailed(res.error));
    }
  }, [dispatch, record]);

  const download = useCallback(
    async (version: string) => {
      const res = await api.update.download({ version });
      if (res.ok) dispatch(updateDownloaded());
      else dispatch(updateCheckFailed(res.error));
    },
    [dispatch],
  );

  const install = useCallback(
    async (version: string, confirmedDiscardUnsaved?: boolean): Promise<InstallOutcome> => {
      // On success the process quits; the renderer never observes ok(). The
      // meaningful return paths are the failures — most importantly the Phase-7.1
      // unsaved-work gate (David H-29.1), which the UpdateStatusArea translates
      // into a Save / Discard-and-install / Cancel confirm dialog.
      const res = await api.update.install(
        confirmedDiscardUnsaved === undefined ? { version } : { version, confirmedDiscardUnsaved },
      );
      if (res.ok) return { kind: 'quitting' };
      if (res.error === 'unsaved_work_blocks_install') return { kind: 'blocked-unsaved' };
      return { kind: 'error', error: res.error };
    },
    [],
  );

  return { checkNow, download, install };
}
