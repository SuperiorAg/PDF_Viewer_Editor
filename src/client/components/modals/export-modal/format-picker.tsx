// Step 1 — Format picker. Per ui-spec §15.3 (Step 1 layout).

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import {
  selectExportDraft,
  selectExportFormatCatalog,
} from '../../../state/slices/export-selectors';
import { setDraftFormat } from '../../../state/slices/export-slice';
import { type ExportFormat } from '../../../types/ipc-contract';

import styles from './export-modal.module.css';

interface FormatOption {
  format: ExportFormat;
  titleKey: string;
  ext: string;
  descriptionKey: string;
}

const OFFICE_OPTIONS: FormatOption[] = [
  {
    format: 'docx',
    titleKey: 'modals:export.fmtWordTitle',
    ext: '.docx',
    descriptionKey: 'modals:export.fmtWordDesc',
  },
  {
    format: 'xlsx',
    titleKey: 'modals:export.fmtExcelTitle',
    ext: '.xlsx',
    descriptionKey: 'modals:export.fmtExcelDesc',
  },
  {
    format: 'pptx',
    titleKey: 'modals:export.fmtPptxTitle',
    ext: '.pptx',
    descriptionKey: 'modals:export.fmtPptxDesc',
  },
];

const IMAGE_VARIANTS: FormatOption[] = [
  {
    format: 'png',
    titleKey: 'modals:export.fmtPngTitle',
    ext: '.png',
    descriptionKey: 'modals:export.fmtPngDesc',
  },
  {
    format: 'jpeg',
    titleKey: 'modals:export.fmtJpegTitle',
    ext: '.jpeg',
    descriptionKey: 'modals:export.fmtJpegDesc',
  },
  {
    format: 'tiff',
    titleKey: 'modals:export.fmtTiffTitle',
    ext: '.tiff',
    descriptionKey: 'modals:export.fmtTiffDesc',
  },
];

export function FormatPicker(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const draft = useAppSelector(selectExportDraft);
  const catalog = useAppSelector(selectExportFormatCatalog);

  const selected = draft.format;
  const isImageFormat = selected === 'png' || selected === 'jpeg' || selected === 'tiff';

  return (
    <div>
      <div className={styles.formatGrid}>
        {OFFICE_OPTIONS.map((opt) => (
          <button
            key={opt.format}
            type="button"
            className={`${styles.formatCard} ${
              selected === opt.format ? styles.formatCardActive : ''
            }`}
            onClick={() => dispatch(setDraftFormat(opt.format))}
            aria-pressed={selected === opt.format}
            data-format={opt.format}
          >
            <span className={styles.formatCardTitle}>{t(opt.titleKey)}</span>
            <span className={styles.formatCardExt}>{opt.ext}</span>
            <span className={styles.formatCardDescription}>{t(opt.descriptionKey)}</span>
          </button>
        ))}
        {/* Image group is a single card; user picks the variant below it. */}
        <button
          type="button"
          className={`${styles.formatCard} ${isImageFormat ? styles.formatCardActive : ''}`}
          onClick={() => dispatch(setDraftFormat('png'))}
          aria-pressed={isImageFormat}
          data-format="image"
        >
          <span className={styles.formatCardTitle}>{t('modals:export.fmtImageTitle')}</span>
          <span className={styles.formatCardExt}>{t('modals:export.fmtImageExts')}</span>
          <span className={styles.formatCardDescription}>{t('modals:export.fmtImageDesc')}</span>
        </button>
      </div>

      {isImageFormat && (
        <div className={styles.imageSubPicker}>
          <strong style={{ fontSize: 'var(--font-size-sm)' }}>
            {t('modals:export.imageVariant')}
          </strong>
          <div className={styles.imageSubVariants}>
            {IMAGE_VARIANTS.map((v) => (
              <label key={v.format} className={styles.imageSubLabel}>
                <input
                  type="radio"
                  name="image-variant"
                  value={v.format}
                  checked={selected === v.format}
                  onChange={() => dispatch(setDraftFormat(v.format))}
                  data-testid={`image-variant-${v.format}`}
                />
                {t(v.titleKey)} ({v.ext})
              </label>
            ))}
          </div>
          <p
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-muted)',
              margin: 0,
            }}
          >
            {t('modals:export.catalogStatus')}{' '}
            {catalog === null
              ? t('modals:export.catalogLoading')
              : t('modals:export.catalogAvailable', { count: catalog.length })}
          </p>
        </div>
      )}
    </div>
  );
}
