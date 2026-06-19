// One row in the main panes — renders for the active view mode. On mount,
// lazy-dispatches the appropriate ensure*Loaded thunk for its pair index.
// The thunks dedupe re-requests; the slice caches results.

import { useEffect } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  COMPARE_ORPHAN_LEFT_LABEL,
  COMPARE_ORPHAN_RIGHT_LABEL,
  COMPARE_VISUAL_RENDER_WIDTH_TEMPLATE,
  selectComparePairEntry,
  selectComparePairTextStatus,
  selectComparePairVisualStatus,
  selectCompareSession,
  type CompareViewMode,
} from '../../state/slices/compare-slice';
import {
  ensureCompareTextLoadedThunk,
  ensureCompareVisualLoadedThunk,
} from '../../state/thunks-phase7-5-wave7';

import styles from './compare-files-workspace.module.css';
import { SideBySidePane } from './side-by-side-pane';
import { TextDiffPane } from './text-diff-pane';
import { VisualDiffPane } from './visual-diff-pane';

interface PairRowProps {
  pairIndex: number;
  viewMode: CompareViewMode;
}

export function PairRow({ pairIndex, viewMode }: PairRowProps): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const session = useAppSelector(selectCompareSession);
  const entry = useAppSelector((s) => selectComparePairEntry(s, pairIndex));
  const textStatus = useAppSelector((s) => selectComparePairTextStatus(s, pairIndex));
  const visualStatus = useAppSelector((s) => selectComparePairVisualStatus(s, pairIndex));

  useEffect(() => {
    if (viewMode === 'text' || viewMode === 'side-by-side') {
      void dispatch(ensureCompareTextLoadedThunk({ pairIndex }));
    }
    if (viewMode === 'visual' || viewMode === 'side-by-side') {
      void dispatch(ensureCompareVisualLoadedThunk({ pairIndex }));
    }
  }, [dispatch, pairIndex, viewMode]);

  if (!session) return null;
  const pair = session.pagePairs[pairIndex];
  if (!pair) return null;
  const pageLabel = (pair.leftPageIndex ?? pair.rightPageIndex ?? -1) + 1;
  const orphanLabel =
    pair.leftPageIndex === null
      ? COMPARE_ORPHAN_RIGHT_LABEL
      : pair.rightPageIndex === null
        ? COMPARE_ORPHAN_LEFT_LABEL
        : null;

  // Loading + error shells.
  const status = viewMode === 'visual' ? visualStatus : textStatus;
  const errorMessage =
    viewMode === 'visual' ? entry?.visual.errorMessage : entry?.text.errorMessage;

  // Visual renderWidth (from the loaded result if present).
  const visualWidth = entry?.visual.visualValue?.width;

  return (
    <div
      className={styles.pairRow}
      data-testid={`compare-pair-row-${pairIndex}`}
      data-page-label={pageLabel}
    >
      <div className={styles.pairHeader}>
        <span className={styles.pairPage}>Page {pageLabel}</span>
        {orphanLabel !== null && (
          <span
            className={styles.orphan}
            data-testid={`compare-orphan-${pairIndex}`}
            data-orphan={orphanLabel === COMPARE_ORPHAN_LEFT_LABEL ? 'left' : 'right'}
          >
            {orphanLabel}
          </span>
        )}
        {viewMode === 'visual' && visualWidth !== undefined && (
          <span className={styles.renderWidthNote}>
            {COMPARE_VISUAL_RENDER_WIDTH_TEMPLATE.replace('{{width}}', String(visualWidth))}
          </span>
        )}
      </div>
      <div className={styles.pairBody}>
        {status === 'loading' && (
          <div className={styles.loading}>
            {t('modals:compare.loadingPair', { page: pageLabel })}
          </div>
        )}
        {status === 'error' && (
          <div className={styles.error} role="alert">
            {t('modals:compare.errorPair', { page: pageLabel, message: errorMessage ?? '' })}
          </div>
        )}
        {status === 'ready' && viewMode === 'text' && entry && (
          <TextDiffPane entry={entry.text} pageLabel={pageLabel} />
        )}
        {viewMode === 'visual' && entry && entry.visual.status === 'ready' && (
          <VisualDiffPane entry={entry.visual} />
        )}
        {viewMode === 'side-by-side' && entry && (
          <SideBySidePane entry={entry} pageLabel={pageLabel} />
        )}
      </div>
    </div>
  );
}
