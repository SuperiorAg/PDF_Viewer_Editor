// Per-job row inside the Exports sidebar tab.
// Per ui-spec §15.4.

import { useAppDispatch } from '../../../state/hooks';
import { cancelExportThunk, refreshExportJobsThunk } from '../../../state/thunks-phase6';
import { type ExportJobRowDto, type ExportJobStatus } from '../../../types/ipc-contract';

import styles from './exports-panel.module.css';

function formatRelativeTime(ms: number, now: number): string {
  const dt = now - ms;
  if (dt < 60_000) return 'just now';
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)} min ago`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)} hr ago`;
  return `${Math.floor(dt / 86_400_000)} day(s) ago`;
}

function statusBadge(status: ExportJobStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Failed';
  }
}

interface JobRowProps {
  job: ExportJobRowDto;
  currentDocHash: string | null;
}

export function JobRow(props: JobRowProps): JSX.Element {
  const dispatch = useAppDispatch();
  const { job, currentDocHash } = props;
  const now = Date.now();

  const isRunning = job.status === 'running' || job.status === 'queued';
  const isFailed = job.status === 'failed';
  const isOlderVersion = currentDocHash !== null && job.docHash !== currentDocHash;

  const className = `${styles.jobRow} ${
    isRunning ? styles.jobRowRunning : ''
  } ${isFailed ? styles.jobRowFailed : ''}`;

  const stats =
    job.contentStats !== null
      ? `${job.pagesProcessed}p, ${job.contentStats.tablesDetected}t, ${job.contentStats.imagesEmbedded}img`
      : `${job.pagesProcessed} page(s)`;

  return (
    <article
      className={className}
      aria-label={`${job.format} export — ${job.outputBasename} — ${statusBadge(job.status)}`}
      data-testid={`export-job-row-${job.id}`}
    >
      <div className={styles.jobTopLine}>
        <span className={styles.jobFormatBadge}>{job.format}</span>
        <span className={styles.jobBasename} title={job.outputBasename}>
          {job.outputBasename}
        </span>
      </div>
      <div className={styles.jobMeta}>
        {statusBadge(job.status)}{' '}
        {job.completedAt !== null
          ? `· ${formatRelativeTime(job.completedAt, now)} · ${stats}`
          : `· ${formatRelativeTime(job.startedAt, now)} · ${stats}`}
        {isOlderVersion && <span className={styles.olderVersionBadge}>older version</span>}
      </div>
      {isFailed && job.errorMessage !== null && (
        <div className={styles.jobMeta} role="alert">
          Error: {job.errorMessage}
        </div>
      )}
      <div className={styles.jobActions}>
        {isRunning && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void dispatch(cancelExportThunk({ jobId: job.id }))}
            data-testid={`export-cancel-${job.id}`}
          >
            Cancel
          </button>
        )}
        {job.status === 'completed' && (
          <>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() =>
                // Show-in-folder is wired via Phase 1's existing app channels
                // when David's Wave 24 contract lands. For now, the click is
                // a no-op + toast hint (David's main-process side will land
                // the IPC handler in parallel). Mark as TODO for the Wave 25
                // audit.
                void dispatch(refreshExportJobsThunk())
              }
              data-testid={`export-show-folder-${job.id}`}
            >
              Show in folder
            </button>
            <span className={styles.jobMeta} title={`Output folder hint: ${job.outputDirHint}`}>
              in {job.outputDirHint}/
            </span>
          </>
        )}
        {isFailed && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void dispatch(refreshExportJobsThunk())}
            data-testid={`export-retry-${job.id}`}
          >
            Refresh
          </button>
        )}
      </div>
    </article>
  );
}
