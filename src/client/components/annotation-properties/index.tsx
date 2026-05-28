import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectSelectedAnnotationId } from '../../state/slices/annotations-selectors';
import { selectAnnotation } from '../../state/slices/annotations-slice';
import { selectAnnotations } from '../../state/slices/document-selectors';
import { applyEdit } from '../../state/slices/document-slice';
import { type RgbColor } from '../../types/ipc-contract';

import styles from './annotation-properties.module.css';

const PRESET_COLORS: RgbColor[] = [
  { r: 1.0, g: 0.92, b: 0.23 }, // yellow
  { r: 0.18, g: 0.8, b: 0.44 }, // green
  { r: 0.95, g: 0.27, b: 0.27 }, // red
  { r: 0.2, g: 0.5, b: 0.95 }, // blue
  { r: 0.95, g: 0.5, b: 0.2 }, // orange
  { r: 0.65, g: 0.3, b: 0.95 }, // purple
];

export function AnnotationProperties(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const id = useAppSelector(selectSelectedAnnotationId);
  const annotations = useAppSelector(selectAnnotations);
  const annot = annotations.find((a) => a.id === id) ?? null;

  if (!annot) return null;

  const editAnnotation = (after: Partial<typeof annot>): void => {
    dispatch(
      applyEdit({
        kind: 'annot-edit',
        meta: { ts: Date.now(), undoable: true, operationId: `ae-${Date.now()}` },
        id: annot.id,
        before: pick(annot, after),
        after,
      }),
    );
  };

  const remove = (): void => {
    dispatch(
      applyEdit({
        kind: 'annot-delete',
        meta: { ts: Date.now(), undoable: true, operationId: `ad-${Date.now()}` },
        before: annot,
      }),
    );
    dispatch(selectAnnotation(null));
  };

  const subtypeLabel =
    annot.subtype === 'Highlight'
      ? 'Highlight'
      : annot.subtype === 'Text'
        ? 'Sticky note'
        : annot.subtype === 'FreeText'
          ? 'Text box'
          : annot.subtype;

  return (
    <div className={styles.panel}>
      <h3 className={styles.heading}>{subtypeLabel}</h3>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Color</span>
        <div className={styles.colorRow}>
          {PRESET_COLORS.map((c, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Color ${i + 1}`}
              className={`${styles.colorSwatch} ${
                colorMatches(c, annot.color) ? styles.colorSwatchActive : ''
              }`}
              style={{ background: rgbCss(c) }}
              onClick={() => editAnnotation({ color: c })}
            />
          ))}
        </div>
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Opacity</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(annot.opacity * 100)}
          onChange={(e) => editAnnotation({ opacity: Number(e.target.value) / 100 })}
          aria-label="Opacity"
        />
        <span className={styles.fieldValue}>{Math.round(annot.opacity * 100)}%</span>
      </label>

      {(annot.subtype === 'Text' || annot.subtype === 'FreeText') && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Contents</span>
          <textarea
            className={styles.textarea}
            rows={4}
            value={annot.contents ?? ''}
            onChange={(e) => editAnnotation({ contents: e.target.value })}
            aria-label="Annotation contents"
          />
        </label>
      )}

      {annot.subtype === 'FreeText' && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Font size</span>
          <input
            type="number"
            min={6}
            max={72}
            value={annot.freeText?.fontSize ?? 12}
            onChange={(e) =>
              editAnnotation({
                freeText: {
                  fontSize: Number(e.target.value),
                  fontFamily: annot.freeText?.fontFamily ?? 'Helvetica',
                },
              })
            }
            aria-label="Font size"
          />
        </label>
      )}

      <button type="button" className={styles.deleteButton} onClick={remove}>
        Delete annotation
      </button>
    </div>
  );
}

function rgbCss(c: RgbColor): string {
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

function colorMatches(a: RgbColor, b: RgbColor): boolean {
  return Math.abs(a.r - b.r) < 0.02 && Math.abs(a.g - b.g) < 0.02 && Math.abs(a.b - b.b) < 0.02;
}

function pick<T extends object, K extends keyof T>(source: T, keysFrom: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(keysFrom) as K[]).forEach((k) => {
    out[k] = source[k];
  });
  return out;
}
