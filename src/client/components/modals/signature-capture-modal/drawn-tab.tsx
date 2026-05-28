// Drawn tab — canvas with pointer-event capture + smoothing via the
// useSignatureCanvas hook. Per docs/ui-spec.md §13.3 (Drawn tab).

import { useState } from 'react';

import { useSignatureCanvas } from '../../../hooks/use-signature-canvas';
import { useT } from '../../../i18n/use-t';

import styles from './signature-capture-modal.module.css';

interface DrawnTabProps {
  onChange: (
    payload: {
      pngBytes: Uint8Array;
      widthPx: number;
      heightPx: number;
    } | null,
  ) => void;
}

export function DrawnTab(props: DrawnTabProps): JSX.Element {
  const { t } = useT();
  const [smoothing, setSmoothing] = useState<'low' | 'medium' | 'high'>('medium');
  const { canvasRef, hasContent, clear, exportPng } = useSignatureCanvas({
    smoothing,
  });

  const onMouseUp = async (): Promise<void> => {
    if (!hasContent) {
      props.onChange(null);
      return;
    }
    const result = await exportPng();
    if (result) props.onChange(result);
  };

  const onClear = (): void => {
    clear();
    props.onChange(null);
  };

  return (
    <div className={styles.body}>
      <span className={styles.label}>{t('modals:signatureCapture.drawPrompt')}</span>
      <div className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          width={500}
          height={180}
          className={styles.canvas}
          // Capture pointer-up at the canvas level so we know to export.
          onPointerUp={() => void onMouseUp()}
          aria-label={t('modals:signatureCapture.drawnCanvasLabel')}
        />
      </div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.button} onClick={onClear} disabled={!hasContent}>
          {t('modals:signatureCapture.clear')}
        </button>
        <label className={styles.optionRow}>
          <span className={styles.label}>{t('modals:signatureCapture.smoothing')}</span>
          <select
            className={styles.select}
            value={smoothing}
            onChange={(e) => setSmoothing(e.target.value as 'low' | 'medium' | 'high')}
          >
            <option value="low">{t('modals:signatureCapture.smoothingLow')}</option>
            <option value="medium">{t('modals:signatureCapture.smoothingMedium')}</option>
            <option value="high">{t('modals:signatureCapture.smoothingHigh')}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
