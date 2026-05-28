// Image tab — file picker / drag-drop import for a pre-existing signature image.
// Per docs/ui-spec.md §13.3 (Image tab) + §13.12 (Phase 4 drag-drop matrix).

import { useState, type DragEvent } from 'react';

import { useT } from '../../../i18n/use-t';

import styles from './signature-capture-modal.module.css';

interface ImageTabProps {
  onChange: (
    payload: {
      bytes: Uint8Array;
      mimeType: 'image/png' | 'image/jpeg';
      widthPx: number;
      heightPx: number;
      name: string;
    } | null,
  ) => void;
}

const ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg';

function mimeFromName(name: string): 'image/png' | 'image/jpeg' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

async function probeDimensions(
  bytes: Uint8Array,
  mime: 'image/png' | 'image/jpeg',
): Promise<{ width: number; height: number }> {
  const blob = new Blob([bytes.slice(0)], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image_decode_failed'));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageTab(props: ImageTabProps): JSX.Element {
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; widthPx: number; heightPx: number } | null>(
    null,
  );

  const processFile = async (f: File): Promise<void> => {
    const mime = mimeFromName(f.name);
    if (!mime) {
      setError(t('modals:signatureCapture.errUnsupportedImage'));
      props.onChange(null);
      return;
    }
    const ab = await f.arrayBuffer();
    const bytes = new Uint8Array(ab);
    try {
      const dims = await probeDimensions(bytes, mime);
      setError(null);
      setFile({ name: f.name, widthPx: dims.width, heightPx: dims.height });
      props.onChange({
        bytes,
        mimeType: mime,
        widthPx: dims.width,
        heightPx: dims.height,
        name: f.name,
      });
    } catch {
      setError(t('modals:signatureCapture.errImageDecode'));
      props.onChange(null);
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0];
    if (f) await processFile(f);
  };

  const onClear = (): void => {
    setFile(null);
    setError(null);
    props.onChange(null);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) await processFile(f);
  };

  return (
    <div className={styles.imagePicker}>
      <label className={styles.field}>
        <span className={styles.label}>{t('modals:signatureCapture.chooseImageLabel')}</span>
        <input type="file" accept={ACCEPT} onChange={(e) => void onPick(e)} />
      </label>
      {file && (
        <div className={styles.optionRow}>
          <span>
            {file.name} ({file.widthPx}×{file.heightPx})
          </span>
          <button type="button" className={styles.button} onClick={onClear}>
            {t('modals:signatureCapture.remove')}
          </button>
        </div>
      )}
      {error && <div className={styles.errorText}>{error}</div>}
      <div className={styles.dropArea} onDragOver={onDragOver} onDrop={(e) => void onDrop(e)}>
        {t('modals:signatureCapture.dragDropImage')}
      </div>
    </div>
  );
}
