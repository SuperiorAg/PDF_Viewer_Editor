import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectCurrentDocument,
  selectIsDirty,
  selectPageCount,
} from '../../state/slices/document-selectors';
import { selectExportInFlight, selectLastEngine } from '../../state/slices/export-selectors';
import { openModal } from '../../state/slices/ui-slice';
import { selectCurrentPage, selectZoom } from '../../state/slices/viewport-selectors';
import { setCurrentPage, setZoom } from '../../state/slices/viewport-slice';

// Phase 6 — small in-progress widget visible when an Office export is running.
import { ExportStatusBarWidget } from './export-progress';
import styles from './status-bar.module.css';

export function StatusBar(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const pageCount = useAppSelector(selectPageCount);
  const currentPage = useAppSelector(selectCurrentPage);
  const zoom = useAppSelector(selectZoom);
  const isDirty = useAppSelector(selectIsDirty);
  const exportInFlight = useAppSelector(selectExportInFlight);
  const lastEngine = useAppSelector(selectLastEngine);

  return (
    <footer className={styles.statusBar} role="status" aria-live="polite">
      <div className={styles.left}>
        {doc ? (
          <>
            <label className={styles.pageInput}>
              {t('common:page')}{' '}
              <input
                type="number"
                min={1}
                max={pageCount}
                value={currentPage + 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    dispatch(setCurrentPage(Math.max(0, Math.min(pageCount - 1, n - 1))));
                  }
                }}
                aria-label={t('common:jumpToPage')}
              />{' '}
              {t('common:of')} {pageCount}
            </label>
          </>
        ) : (
          <span className={styles.idle}>{t('common:ready')}</span>
        )}
      </div>
      <div className={styles.center}>
        {doc && (
          <label className={styles.zoomInput}>
            {t('common:zoom')}{' '}
            <select
              value={zoom}
              onChange={(e) => dispatch(setZoom(Number(e.target.value)))}
              aria-label={t('common:zoomLevel')}
            >
              {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 4.0].map((z) => (
                <option key={z} value={z}>
                  {Math.round(z * 100)}%
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={styles.right}>
        {isDirty && <span className={styles.modified}>{t('common:modified')}</span>}
        {exportInFlight && <span className={styles.exporting}>{t('common:exporting')}</span>}
        {/* Phase 6 — Export-to-Office job progress widget. */}
        <ExportStatusBarWidget />
        {lastEngine && (
          <button
            type="button"
            className={styles.engineButton}
            onClick={() => dispatch(openModal('export-engine'))}
            aria-label={t('common:lastEngineLabel', { engine: lastEngine })}
          >
            {t('common:engineButton', { engine: lastEngine })}
          </button>
        )}
      </div>
    </footer>
  );
}
