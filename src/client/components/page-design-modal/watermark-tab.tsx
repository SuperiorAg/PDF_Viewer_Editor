// Watermark tab — Phase 7.5 B4 (Riley Wave 4).
// Per docs/ui-spec-phase-7.5.md §4.1.

import { type ChangeEvent } from 'react';

import { useT } from '../../i18n/use-t';
import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { updateWatermark } from '../../state/slices/page-design-slice';
import type { PdfWatermarkPosition } from '../../types/ipc-contract';

import styles from './page-design-modal.module.css';

const POSITIONS: readonly PdfWatermarkPosition[] = [
  'top-left',
  'top-right',
  'center',
  'bottom-left',
  'bottom-right',
];

export function WatermarkTab(): JSX.Element {
  const { t } = useT();
  const dispatch = useAppDispatch();
  const wm = useAppSelector((s) => s.pageDesign.watermark);

  const onImagePick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      const buf = await file.arrayBuffer();
      dispatch(
        updateWatermark({
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
            name="watermark-source"
            checked={wm.source === 'text'}
            onChange={() => dispatch(updateWatermark({ source: 'text' }))}
          />
          {t('modals:pageDesign.source.text')}
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="radio"
            name="watermark-source"
            checked={wm.source === 'image'}
            onChange={() => dispatch(updateWatermark({ source: 'image' }))}
          />
          {t('modals:pageDesign.source.image')}
        </label>
      </div>

      {wm.source === 'text' ? (
        <>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="wm-text">
              {t('modals:pageDesign.watermark.text')}
            </label>
            <input
              id="wm-text"
              className={styles.input}
              type="text"
              value={wm.text}
              onChange={(e) => dispatch(updateWatermark({ text: e.target.value }))}
            />
          </div>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="wm-fontsize">
              {t('modals:pageDesign.watermark.fontSize')}
            </label>
            <input
              id="wm-fontsize"
              className={styles.numberInput}
              type="number"
              min={6}
              max={400}
              value={wm.fontSize}
              onChange={(e) =>
                dispatch(updateWatermark({ fontSize: Number(e.target.value) || 96 }))
              }
            />
            <label className={styles.label} htmlFor="wm-color">
              {t('modals:pageDesign.watermark.color')}
            </label>
            <input
              id="wm-color"
              className={styles.colorInput}
              type="color"
              value={wm.fontColor}
              onChange={(e) => dispatch(updateWatermark({ fontColor: e.target.value }))}
            />
          </div>
        </>
      ) : (
        <div className={styles.row}>
          <span className={styles.label}>{t('modals:pageDesign.watermark.imagePick')}</span>
          <input type="file" accept="image/png,image/jpeg,image/tiff" onChange={onImagePick} />
          <span className={styles.hint}>
            {wm.imageFileName ?? t('modals:pageDesign.watermark.imageHint')}
          </span>
        </div>
      )}

      <div className={styles.row}>
        <label className={styles.label} htmlFor="wm-rotation">
          {t('modals:pageDesign.watermark.rotation')}
        </label>
        <input
          id="wm-rotation"
          className={styles.numberInput}
          type="number"
          min={-180}
          max={180}
          value={wm.rotationDegrees}
          onChange={(e) =>
            dispatch(updateWatermark({ rotationDegrees: Number(e.target.value) || 0 }))
          }
        />
        <label className={styles.label} htmlFor="wm-opacity">
          {t('modals:pageDesign.watermark.opacity')}
        </label>
        <input
          id="wm-opacity"
          type="range"
          min={0}
          max={100}
          value={Math.round(wm.opacity * 100)}
          onChange={(e) => dispatch(updateWatermark({ opacity: Number(e.target.value) / 100 }))}
        />
        <span className={styles.hint}>{Math.round(wm.opacity * 100)}%</span>
      </div>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="wm-position">
          {t('modals:pageDesign.watermark.position')}
        </label>
        <select
          id="wm-position"
          className={styles.select}
          value={wm.position}
          onChange={(e) =>
            dispatch(updateWatermark({ position: e.target.value as PdfWatermarkPosition }))
          }
        >
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {t(`modals:pageDesign.position.${camel(p)}`)}
            </option>
          ))}
        </select>
        <label className={styles.label} htmlFor="wm-layer">
          {t('modals:pageDesign.watermark.layer')}
        </label>
        <select
          id="wm-layer"
          className={styles.select}
          value={wm.layer}
          onChange={(e) =>
            dispatch(updateWatermark({ layer: e.target.value as 'overlay' | 'underlay' }))
          }
        >
          <option value="overlay">{t('modals:pageDesign.watermark.layerOverlay')}</option>
          <option value="underlay">{t('modals:pageDesign.watermark.layerUnderlay')}</option>
        </select>
      </div>
    </div>
  );
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}
