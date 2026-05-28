// ExportsPanel — the Exports sidebar tab (5th tab).
// Per docs/ui-spec.md §15.4.
//
// Lists in-flight + recent + completed export jobs for the currently-open doc
// (filtered by doc_hash). Surfaces the per-format trust-floor reminder banner
// at the top (the second trust-floor placement in the renderer — see
// conventions §17.3 four-location ratchet placement #5).
//
// Empty / loading / error states per ui-spec §15.8.

import { useEffect } from 'react';

import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectCurrentDocument } from '../../../state/slices/document-selectors';
import {
  selectExportCurrentJob,
  selectExportPhase6LastError,
  selectRecentExportJobs,
} from '../../../state/slices/export-selectors';
import { openExportModal } from '../../../state/slices/export-slice';
import { refreshExportJobsThunk } from '../../../state/thunks-phase6';

import styles from './exports-panel.module.css';
import { JobRow } from './job-row';

export function ExportsPanel(): JSX.Element {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const jobs = useAppSelector(selectRecentExportJobs);
  const currentJob = useAppSelector(selectExportCurrentJob);
  const lastError = useAppSelector(selectExportPhase6LastError);

  // Refresh on mount + when the doc changes. The currentJob's terminal
  // transition triggers a refresh via the event-bridge.
  useEffect(() => {
    void dispatch(
      refreshExportJobsThunk(
        doc?.fileHash !== undefined ? { docHash: doc.fileHash, limit: 50 } : { limit: 50 },
      ),
    );
  }, [dispatch, doc?.fileHash]);

  // Partition jobs by status — running / queued at top, rest below.
  const running = jobs?.filter((j) => j.status === 'running' || j.status === 'queued') ?? [];
  const completed = jobs?.filter((j) => j.status === 'completed') ?? [];
  const other = jobs?.filter((j) => j.status === 'cancelled' || j.status === 'failed') ?? [];

  return (
    <section className={styles.panel} aria-label="Exports panel">
      {/* Trust-floor honesty banner — placement #2 of the four-location
          ratchet (modal panel is placement #1; this sidebar banner is #2). */}
      <div className={styles.honestyBanner} data-testid="exports-honesty-banner">
        <div className={styles.honestyBannerTitle}>About PDF → Office export</div>
        Conversion is best-effort: complex layouts, borderless tables, and XFA form values may not
        export faithfully. Signed PDFs are not modified by export. Run OCR first if the source is
        image-only.
      </div>

      {lastError !== null && (
        <div className={styles.honestyBanner} role="alert">
          {lastError}
        </div>
      )}

      <button
        type="button"
        className={styles.actionButton}
        onClick={() => dispatch(openExportModal(undefined))}
        disabled={!doc}
        data-testid="open-export-modal-from-panel"
      >
        + New export
      </button>

      {currentJob !== null && (
        <>
          <div className={styles.sectionHeader}>Running</div>
          <div className={styles.jobRow + ' ' + styles.jobRowRunning}>
            <div className={styles.jobTopLine}>
              <span className={styles.jobFormatBadge}>{currentJob.format}</span>
              <span className={styles.jobBasename}>
                {currentJob.totalPages
                  ? `${(currentJob.pageIndex ?? 0) + 1} / ${currentJob.totalPages}`
                  : 'Starting…'}
              </span>
            </div>
            <div className={styles.jobMeta}>
              Phase: {currentJob.phase}
              {currentJob.errorMessage !== null ? ` — ${currentJob.errorMessage}` : ''}
            </div>
          </div>
        </>
      )}

      {jobs === null && doc !== null && <div className={styles.emptyState}>Loading exports…</div>}

      {jobs !== null && jobs.length === 0 && (
        <div className={styles.emptyState}>No exports yet. Use File → Export… to start.</div>
      )}

      {running.length > 0 && (
        <>
          <div className={styles.sectionHeader}>In progress</div>
          {running.map((j) => (
            <JobRow key={j.id} job={j} currentDocHash={doc?.fileHash ?? null} />
          ))}
        </>
      )}

      {completed.length > 0 && (
        <>
          <div className={styles.sectionHeader}>Recent</div>
          {completed.map((j) => (
            <JobRow key={j.id} job={j} currentDocHash={doc?.fileHash ?? null} />
          ))}
        </>
      )}

      {other.length > 0 && (
        <>
          <div className={styles.sectionHeader}>Other</div>
          {other.map((j) => (
            <JobRow key={j.id} job={j} currentDocHash={doc?.fileHash ?? null} />
          ))}
        </>
      )}
    </section>
  );
}
