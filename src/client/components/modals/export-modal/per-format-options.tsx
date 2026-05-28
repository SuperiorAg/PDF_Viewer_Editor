// Step 2 — per-format extras (DPI for images, JPEG quality slider, multi-page
// TIFF toggle, docx page size, page range, include-annotations).
// Per ui-spec §15.3.3.

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import { selectPageCount } from '../../../state/slices/document-selectors';
import { selectExportDraft } from '../../../state/slices/export-selectors';
import {
  setDraftImageOptions,
  setDraftIncludeAnnotations,
  setDraftPageRange,
  setDraftPageSize,
} from '../../../state/slices/export-slice';

import styles from './export-modal.module.css';

const DPI_PRESETS = [72, 96, 150, 200, 300, 600];

export function PerFormatOptions(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const draft = useAppSelector(selectExportDraft);
  const pageCount = useAppSelector(selectPageCount);

  if (draft.format === null) return null;

  const isImage = draft.format === 'png' || draft.format === 'jpeg' || draft.format === 'tiff';

  const rangeAll = draft.pageRange === null;

  return (
    <div className={styles.optionsBlock} data-testid="per-format-options">
      {/* Pages */}
      <div className={styles.optionRow}>
        <span className={styles.optionLabel}>{t('modals:export.optPages')}</span>
        <label className={styles.optionInput}>
          <input
            type="radio"
            name="page-range-mode"
            checked={rangeAll}
            onChange={() => dispatch(setDraftPageRange(null))}
            data-testid="page-range-all"
          />{' '}
          {t('modals:export.optAllPages', { count: pageCount })}
        </label>
      </div>
      <div className={styles.optionRow}>
        <span className={styles.optionLabel}></span>
        <label className={styles.optionInput} style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            type="radio"
            name="page-range-mode"
            checked={!rangeAll}
            onChange={() =>
              dispatch(setDraftPageRange({ start: 0, end: Math.max(0, pageCount - 1) }))
            }
            data-testid="page-range-custom"
          />{' '}
          {t('modals:export.optFrom')}{' '}
          <input
            type="number"
            min={1}
            max={pageCount}
            value={(draft.pageRange?.start ?? 0) + 1}
            disabled={rangeAll}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              const startIdx = Math.max(0, Math.min(pageCount - 1, v - 1));
              const endIdx = Math.max(startIdx, draft.pageRange?.end ?? pageCount - 1);
              dispatch(setDraftPageRange({ start: startIdx, end: endIdx }));
            }}
            style={{ width: '4rem' }}
            data-testid="page-range-start"
          />{' '}
          {t('modals:export.optTo')}{' '}
          <input
            type="number"
            min={1}
            max={pageCount}
            value={(draft.pageRange?.end ?? pageCount - 1) + 1}
            disabled={rangeAll}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v)) return;
              const endIdx = Math.max(0, Math.min(pageCount - 1, v - 1));
              const startIdx = Math.min(endIdx, draft.pageRange?.start ?? 0);
              dispatch(setDraftPageRange({ start: startIdx, end: endIdx }));
            }}
            style={{ width: '4rem' }}
            data-testid="page-range-end"
          />
        </label>
      </div>

      {/* Include annotations */}
      <div className={styles.optionRow}>
        <span className={styles.optionLabel}>{t('modals:export.optAnnotations')}</span>
        <label className={styles.optionInput}>
          <input
            type="checkbox"
            checked={draft.includeAnnotations}
            onChange={(e) => dispatch(setDraftIncludeAnnotations(e.target.checked))}
            data-testid="include-annotations"
          />{' '}
          {t('modals:export.optIncludeAnnotations')}
        </label>
      </div>

      {/* docx — Page size */}
      {draft.format === 'docx' && (
        <div className={styles.optionRow}>
          <span className={styles.optionLabel}>{t('modals:export.optPageSize')}</span>
          <select
            className={styles.optionInput}
            value={draft.pageSize}
            onChange={(e) => dispatch(setDraftPageSize(e.target.value as 'letter' | 'a4' | 'auto'))}
            data-testid="docx-page-size"
          >
            <option value="auto">{t('modals:export.pageSizeAuto')}</option>
            <option value="letter">{t('modals:export.pageSizeLetter')}</option>
            <option value="a4">{t('modals:export.pageSizeA4')}</option>
          </select>
        </div>
      )}

      {/* Image extras */}
      {isImage && (
        <>
          <div className={styles.optionRow}>
            <span className={styles.optionLabel}>{t('modals:export.optDpi')}</span>
            <select
              className={styles.optionInput}
              value={draft.imageOptions.dpi}
              onChange={(e) => dispatch(setDraftImageOptions({ dpi: Number(e.target.value) }))}
              data-testid="image-dpi"
            >
              {DPI_PRESETS.map((dpi) => (
                <option key={dpi} value={dpi}>
                  {dpi}
                </option>
              ))}
            </select>
          </div>
          {draft.format === 'jpeg' && (
            <div className={styles.optionRow}>
              <span className={styles.optionLabel}>{t('modals:export.optJpegQuality')}</span>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={draft.imageOptions.jpegQuality}
                onChange={(e) =>
                  dispatch(
                    setDraftImageOptions({
                      jpegQuality: Number(e.target.value),
                    }),
                  )
                }
                className={styles.optionInput}
                data-testid="image-jpeg-quality"
              />
              <span
                style={{
                  fontSize: 'var(--font-size-xs)',
                  width: '3rem',
                  textAlign: 'right',
                }}
              >
                {draft.imageOptions.jpegQuality.toFixed(2)}
              </span>
            </div>
          )}
          {draft.format === 'tiff' && (
            <div className={styles.optionRow}>
              <span className={styles.optionLabel}>{t('modals:export.optTiffBundle')}</span>
              <label className={styles.optionInput}>
                <input
                  type="checkbox"
                  checked={draft.imageOptions.multiPageTiff}
                  onChange={(e) =>
                    dispatch(
                      setDraftImageOptions({
                        multiPageTiff: e.target.checked,
                      }),
                    )
                  }
                  data-testid="image-multi-page-tiff"
                />{' '}
                {t('modals:export.optBundleMultiPage')}
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}
