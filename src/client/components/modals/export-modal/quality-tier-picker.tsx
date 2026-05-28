// Step 2 — quality tier sub-component. Per ui-spec §15.3.2.
//
// Per Q-D the default tier is layout-preserving for Word + PowerPoint,
// text-only for Excel, and image formats have no tier picker (the component
// returns null in that case).

import { useT } from '../../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../../state/hooks';
import {
  selectExportDraft,
  selectExportFormatCatalog,
  selectResolvedQualityTier,
} from '../../../state/slices/export-selectors';
import { setDraftQualityTier } from '../../../state/slices/export-slice';
import { type ExportQualityTier } from '../../../types/ipc-contract';

import styles from './export-modal.module.css';

export function QualityTierPicker(): JSX.Element | null {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const draft = useAppSelector(selectExportDraft);
  const catalog = useAppSelector(selectExportFormatCatalog);
  const resolved = useAppSelector(selectResolvedQualityTier);

  if (draft.format === null) return null;
  // Image formats: no tier (rasterization is a single path).
  if (draft.format === 'png' || draft.format === 'jpeg' || draft.format === 'tiff') {
    return null;
  }

  // Compute the per-format default (for the [recommended] badge). Prefer
  // catalog when loaded; fall back to Q-D defaults.
  const catalogEntry = catalog?.find((f) => f.format === draft.format);
  const defaultTier: ExportQualityTier =
    catalogEntry?.defaultQualityTier === 'text-only' ||
    catalogEntry?.defaultQualityTier === 'layout-preserving'
      ? catalogEntry.defaultQualityTier
      : draft.format === 'xlsx'
        ? 'text-only'
        : 'layout-preserving';

  const onPick = (tier: ExportQualityTier): void => {
    dispatch(setDraftQualityTier(tier));
  };

  return (
    <fieldset
      className={styles.tierPicker}
      aria-label={t('modals:export.qualityTierLabel')}
      data-testid="quality-tier-picker"
    >
      <legend style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
        {t('modals:export.qualityLabel')}
      </legend>
      <label className={styles.tierRadioRow}>
        <input
          type="radio"
          name="quality-tier"
          value="layout-preserving"
          checked={resolved === 'layout-preserving'}
          onChange={() => onPick('layout-preserving')}
          data-testid="quality-tier-layout-preserving"
        />
        <span>{t('modals:export.tierLayoutPreserving')}</span>
        {defaultTier === 'layout-preserving' && (
          <span className={styles.tierRecommendedBadge}>{t('modals:export.tierRecommended')}</span>
        )}
      </label>
      <label className={styles.tierRadioRow}>
        <input
          type="radio"
          name="quality-tier"
          value="text-only"
          checked={resolved === 'text-only'}
          onChange={() => onPick('text-only')}
          data-testid="quality-tier-text-only"
        />
        <span>{t('modals:export.tierTextOnly')}</span>
        {defaultTier === 'text-only' && (
          <span className={styles.tierRecommendedBadge}>{t('modals:export.tierRecommended')}</span>
        )}
      </label>
    </fieldset>
  );
}
