// Background tab — Phase 7.5 B4 (Riley Wave 4).
// Per docs/ui-spec-phase-7.5.md §4.1.

import { type ChangeEvent } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { updateBackground } from '../../state/slices/page-design-slice';

import styles from './page-design-modal.module.css';

export function BackgroundTab(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const bg = useAppSelector((s) => s.pageDesign.background);

  const onImagePick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      const buf = await file.arrayBuffer();
      dispatch(
        updateBackground({
          imageBytes: new Uint8Array(buf),
          imageFileName: file.name,
        }),
      );
    })();
  };

  return (
    <div className={styles.tabPanel}>
      <div className={styles.row}>
        <span className={styles.label}>{t('modals:pageDesign.source.label')}</span>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="bg-source"
            checked={bg.source === 'color'}
            onChange={() => dispatch(updateBackground({ source: 'color' }))}
          />
          {t('modals:pageDesign.background.color')}
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="bg-source"
            checked={bg.source === 'image'}
            onChange={() => dispatch(updateBackground({ source: 'image' }))}
          />
          {t('modals:pageDesign.background.image')}
        </label>
      </div>
      {bg.source === 'color' ? (
        <div className={styles.row}>
          <label className={styles.label} htmlFor="bg-color">
            {t('modals:pageDesign.background.color')}
          </label>
          <input
            id="bg-color"
            className={styles.colorInput}
            type="color"
            value={bg.color}
            onChange={(e) => dispatch(updateBackground({ color: e.target.value }))}
          />
        </div>
      ) : (
        <>
          <div className={styles.row}>
            <span className={styles.label}>{t('modals:pageDesign.background.image')}</span>
            <input type="file" accept="image/png,image/jpeg,image/tiff" onChange={onImagePick} />
            <span className={styles.hint}>
              {bg.imageFileName ?? t('modals:pageDesign.watermark.imageHint')}
            </span>
          </div>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="bg-opacity">
              {t('modals:pageDesign.watermark.opacity')}
            </label>
            <input
              id="bg-opacity"
              type="range"
              min={0}
              max={100}
              value={Math.round(bg.opacity * 100)}
              onChange={(e) =>
                dispatch(updateBackground({ opacity: Number(e.target.value) / 100 }))
              }
            />
            <span className={styles.hint}>{Math.round(bg.opacity * 100)}%</span>
          </div>
        </>
      )}
    </div>
  );
}
