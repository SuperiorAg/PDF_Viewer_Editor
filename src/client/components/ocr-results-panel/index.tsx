// OcrResultsPanel — sidebar tab showing per-document OCR results.
// Per docs/ui-spec.md §14 amendment.
//
// Three sections:
//   1. Per-document summary (mean confidence, word count, etc.) — null when
//      no OCR has been run for this doc.
//   2. Free-text search over recognized words.
//   3. Word list (filtered by search; clicking a row jumps to the page).
//
// The panel reads ONLY from state.ocr. It does NOT trigger any OCR run —
// that lives in the OcrRunModal. Triggers exposed here are utility actions
// (open OCR run modal, toggle confidence overlay, manage packs).

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  selectFilteredRecognizedWords,
  selectOcrCurrentSummary,
  selectOcrLowConfidenceThreshold,
  selectOcrResultsPanelSearch,
} from '../../state/slices/ocr-selectors';
import {
  openLanguagePackManagerModal,
  openRunModal,
  setResultsPanelSearch,
  toggleOverlay,
} from '../../state/slices/ocr-slice';
import { setCurrentPage } from '../../state/slices/viewport-slice';

import styles from './ocr-results-panel.module.css';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${String(m)}m ${String(rs)}s`;
}

export function OcrResultsPanel(): JSX.Element {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const summary = useAppSelector(selectOcrCurrentSummary);
  const filteredWords = useAppSelector(selectFilteredRecognizedWords);
  const search = useAppSelector(selectOcrResultsPanelSearch);
  const threshold = useAppSelector(selectOcrLowConfidenceThreshold);

  if (!doc) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyState}>Open a PDF to see OCR results for it here.</div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        {summary !== null ? (
          <div className={styles.summary}>
            <div className={styles.summaryRow}>
              <span>Words</span>
              <span>{summary.totalWords}</span>
            </div>
            <div className={styles.summaryRow}>
              <span>Mean confidence</span>
              <span>{summary.meanConfidence.toFixed(1)}</span>
            </div>
            <div className={styles.summaryRow}>
              <span>Languages</span>
              <span>{summary.langs.join('+')}</span>
            </div>
            <div className={styles.summaryRow}>
              <span>Pages</span>
              <span>
                {summary.pageRange.start + 1}–{summary.pageRange.end + 1}
              </span>
            </div>
            <div className={styles.summaryRow}>
              <span>Total time</span>
              <span>{formatDuration(summary.totalDurationMs)}</span>
            </div>
          </div>
        ) : (
          <div className={styles.emptyState}>
            No OCR has been run on this document.
            <br />
            Click &quot;Run OCR&quot; below to start.
          </div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
            onClick={() => dispatch(openRunModal())}
          >
            Run OCR
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => dispatch(toggleOverlay())}
            disabled={summary === null}
          >
            Toggle overlay
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => dispatch(openLanguagePackManagerModal())}
          >
            Manage packs
          </button>
        </div>

        {summary !== null && (
          <>
            <input
              type="text"
              className={styles.search}
              placeholder="Search recognized words…"
              value={search}
              onChange={(e) => dispatch(setResultsPanelSearch(e.target.value))}
              aria-label="Search OCR results"
            />
            <span className={styles.searchHint}>
              {search.trim().length > 0
                ? `${String(filteredWords.length)} match${filteredWords.length === 1 ? '' : 'es'}`
                : `Threshold: ${threshold} (lower = highlighted in viewer)`}
            </span>
          </>
        )}
      </div>

      {summary !== null && filteredWords.length > 0 ? (
        <div className={styles.resultsList}>
          {filteredWords.slice(0, 500).map((w, idx) => (
            <button
              key={`${String(w.pageIndex)}-${String(idx)}-${w.text}`}
              type="button"
              className={styles.wordRow}
              onClick={() => dispatch(setCurrentPage(w.pageIndex))}
              title={`Jump to page ${String(w.pageIndex + 1)}`}
            >
              <span className={styles.wordText}>{w.text}</span>
              <span className={w.confidence < threshold ? styles.confLow : styles.confHigh}>
                {w.confidence.toFixed(0)}
              </span>
              <span className={styles.pageLabel}>p.{String(w.pageIndex + 1)}</span>
            </button>
          ))}
        </div>
      ) : summary !== null && search.trim().length > 0 ? (
        <div className={styles.emptyState}>No words match &quot;{search}&quot;.</div>
      ) : (
        summary !== null &&
        filteredWords.length === 0 && (
          <div className={styles.emptyState}>
            OCR summary loaded but per-page words are not yet hydrated. Re-open the document to load
            word data, or run OCR to refresh.
          </div>
        )
      )}
    </div>
  );
}
