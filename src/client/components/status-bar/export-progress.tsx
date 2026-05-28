// ExportStatusBarWidget — small in-progress indicator for Phase 6 exports.
// Per docs/ui-spec.md §15.5.
//
// Visible only while a Phase 6 export is queued / running. Clicking jumps
// to the Exports sidebar tab so the user can monitor + cancel; a dedicated
// Cancel button is also surfaced inline.

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectExportCurrentJob,
  selectExportJobRunning,
  selectExportJobTerminal,
  selectExportLastCompletedAtMs,
} from '../../state/slices/export-selectors';
import { setSidebarTab } from '../../state/slices/ui-slice';
import { cancelExportThunk, dismissCompletedJobThunk } from '../../state/thunks-phase6';

import styles from './status-bar.module.css';

export function ExportStatusBarWidget(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const job = useAppSelector(selectExportCurrentJob);
  const running = useAppSelector(selectExportJobRunning);
  const terminal = useAppSelector(selectExportJobTerminal);
  const lastCompletedAt = useAppSelector(selectExportLastCompletedAtMs);

  if (job === null) return null;

  const openSidebar = (): void => {
    dispatch(setSidebarTab('exports'));
  };

  if (running) {
    const pageText =
      job.pageIndex !== null
        ? `page ${job.pageIndex + 1} of ${job.totalPages}`
        : `${job.totalPages} pages`;
    return (
      <span
        className={styles.exportWidget}
        aria-live="polite"
        data-testid="export-status-widget-running"
      >
        <button
          type="button"
          className={styles.exportWidgetLink}
          onClick={openSidebar}
          aria-label="Open Exports sidebar"
        >
          EXPORT: {job.format.toUpperCase()} — {pageText}
        </button>{' '}
        <button
          type="button"
          className={styles.exportWidgetCancel}
          onClick={() => void dispatch(cancelExportThunk({ jobId: job.jobId }))}
          data-testid="export-status-widget-cancel"
        >
          Cancel
        </button>
      </span>
    );
  }

  if (terminal && job.phase === 'completed') {
    // Auto-hide is handled by the parent — when lastCompletedAt is more than
    // ~5 sec old, the consumer dismisses the job. For now we keep the toast-
    // style notice visible until the user clicks dismiss.
    const ageMs = lastCompletedAt !== null ? Date.now() - lastCompletedAt : 0;
    if (ageMs > 30_000) {
      // After 30 sec, hide automatically by clearing currentJob.
      void dispatch(dismissCompletedJobThunk());
      return null;
    }
    return (
      <span
        className={`${styles.exportWidget} ${styles.exportWidgetSuccess}`}
        data-testid="export-status-widget-completed"
      >
        Export complete: {job.format.toUpperCase()}{' '}
        <button type="button" className={styles.exportWidgetLink} onClick={openSidebar}>
          View
        </button>{' '}
        <button
          type="button"
          className={styles.exportWidgetCancel}
          onClick={() => void dispatch(dismissCompletedJobThunk())}
        >
          Dismiss
        </button>
      </span>
    );
  }

  if (terminal && job.phase === 'failed') {
    return (
      <span
        className={`${styles.exportWidget} ${styles.exportWidgetFailed}`}
        role="alert"
        data-testid="export-status-widget-failed"
      >
        Export failed
        {job.errorMessage ? `: ${job.errorMessage}` : ''}{' '}
        <button type="button" className={styles.exportWidgetLink} onClick={openSidebar}>
          View
        </button>{' '}
        <button
          type="button"
          className={styles.exportWidgetCancel}
          onClick={() => void dispatch(dismissCompletedJobThunk())}
        >
          Dismiss
        </button>
      </span>
    );
  }

  if (terminal && job.phase === 'cancelled') {
    return (
      <span className={styles.exportWidget} data-testid="export-status-widget-cancelled">
        Export cancelled{' '}
        <button
          type="button"
          className={styles.exportWidgetCancel}
          onClick={() => void dispatch(dismissCompletedJobThunk())}
        >
          Dismiss
        </button>
      </span>
    );
  }

  return null;
}
