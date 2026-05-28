// Typed tab — renders a name in a chosen script font, captures it as a PNG.
// Per docs/ui-spec.md §13.3 (Typed tab).

import { useEffect, useRef, useState } from 'react';

import { useT } from '../../../i18n/use-t';

import styles from './signature-capture-modal.module.css';

const FONT_FAMILIES = [
  'Caveat, cursive',
  'Pacifico, cursive',
  'Dancing Script, cursive',
  'Helvetica, sans-serif',
];

const FONT_SIZES = [18, 24, 32, 40, 48];

interface TypedTabProps {
  onChange: (
    payload: {
      name: string;
      fontFamily: string;
      fontSize: number;
      pngBytes: Uint8Array;
      widthPx: number;
      heightPx: number;
    } | null,
  ) => void;
}

export function TypedTab(props: TypedTabProps): JSX.Element {
  const { t } = useT();
  const [name, setName] = useState('');
  const [fontFamily, setFontFamily] = useState(FONT_FAMILIES[0] ?? 'Helvetica');
  const [fontSize, setFontSize] = useState(32);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onChangeRef = useRef(props.onChange);

  // Keep ref current so the rasterizer effect doesn't depend on the function
  // identity (which churns on every parent render).
  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  // Re-rasterize whenever inputs change.
  useEffect(() => {
    if (name.trim().length === 0) {
      onChangeRef.current(null);
      return;
    }
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = Math.max(200, name.length * (fontSize * 0.6));
    const h = fontSize * 2;
    c.width = w;
    c.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#111111';
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 8, h / 2);

    const toBlob = c.toBlob?.bind(c);
    if (toBlob) {
      toBlob((blob) => {
        if (!blob) {
          onChangeRef.current(null);
          return;
        }
        void blob.arrayBuffer().then((ab) => {
          onChangeRef.current({
            name,
            fontFamily,
            fontSize,
            pngBytes: new Uint8Array(ab),
            widthPx: w,
            heightPx: h,
          });
        });
      }, 'image/png');
    } else {
      // Fallback for environments without toBlob.
      const dataUrl = c.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1] ?? '';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      onChangeRef.current({
        name,
        fontFamily,
        fontSize,
        pngBytes: bytes,
        widthPx: w,
        heightPx: h,
      });
    }
  }, [fontFamily, fontSize, name]);

  return (
    <div className={styles.body}>
      <label className={styles.field}>
        <span className={styles.label}>{t('modals:signatureCapture.yourName')}</span>
        <input
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('modals:signatureCapture.namePlaceholder')}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('modals:signatureCapture.font')}</span>
        <select
          className={styles.select}
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f.split(',')[0]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('modals:signatureCapture.size')}</span>
        <select
          className={styles.select}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {t('modals:signatureCapture.sizeUnit', { size: s })}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.field}>
        <span className={styles.label}>{t('modals:signatureCapture.preview')}</span>
        <div className={styles.preview}>
          {name.trim() ? (
            // eslint-disable-next-line react/forbid-dom-props
            <span className={styles.previewName} style={{ fontFamily }}>
              {name}
            </span>
          ) : (
            <span className={styles.previewPlaceholder}>
              {t('modals:signatureCapture.previewPlaceholder')}
            </span>
          )}
        </div>
      </div>
      {/* Off-screen rasterization canvas (kept hidden via inline style: a CSS
          module class can't be conditional on this render-once node and would
          otherwise add CSS without offsetting it from the user-visible canvas
          in the Drawn tab). */}
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
