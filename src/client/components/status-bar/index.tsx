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
import { setCurrentPage, setZoom, ZOOM_LEVELS } from '../../state/slices/viewport-slice';

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

  // The <select> reads the COMMITTED zoom (s.viewport.zoom). ctrl+scroll commits
  // arbitrary values (e.g. 1.21), which are not in ZOOM_LEVELS — an HTML <select>
  // whose `value` has no matching <option> renders blank. So when the current
  // zoom is not a preset, prepend a synthetic option for it so the control always
  // shows the true percentage. Tolerance (1e-6) collapses a committed 1.0000000002
  // back onto the 100% preset so there is no duplicate option.
  const isPreset = ZOOM_LEVELS.some((z) => Math.abs(z - zoom) < 1e-6);
  const presetOptions = ZOOM_LEVELS.map((z) => ({ value: z, label: `${Math.round(z * 100)}%` }));
  const zoomOptions = isPreset
    ? presetOptions
    : [{ value: zoom, label: `${Math.round(zoom * 100)}%` }, ...presetOptions];

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
              {zoomOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
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
