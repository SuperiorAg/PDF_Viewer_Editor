// FormDesigner — Phase 3 designer-mode field-type selector toolbar +
// click-to-place cursor overlay + properties pane host.
// Per docs/ui-spec.md §12.4.
//
// Active only when formsSlice.designerMode === true. The renderer keeps
// drag/draw rects in screen-space; conversion to PDF user-space happens at
// the IPC boundary in designAddFieldThunk via screenRectToPdf (ui-spec §12.9).

import { useCallback, useState } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import {
  selectDesignerFieldType,
  selectDesignerMode,
  selectFormFields,
} from '../../state/slices/forms-selectors';
import {
  setDesignerFieldType,
  setDesignerMode,
  setSelectedField,
} from '../../state/slices/forms-slice';
import { selectZoom } from '../../state/slices/viewport-selectors';
import { designAddFieldThunk } from '../../state/thunks';
import { type FormFieldDefinition, type FormFieldType } from '../../types/ipc-contract';

import { FieldPropertiesPane } from './field-properties-pane';
import styles from './form-designer.module.css';

const FIELD_TYPES: ReadonlyArray<{ id: FormFieldType; label: string }> = [
  { id: 'text', label: 'Text' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'radio', label: 'Radio' },
  { id: 'dropdown', label: 'Dropdown' },
  { id: 'signature', label: 'Signature' },
  { id: 'date', label: 'Date' },
];

export function FormDesignerToolbar(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const designerMode = useAppSelector(selectDesignerMode);
  const fieldType = useAppSelector(selectDesignerFieldType);

  if (!designerMode) return null;

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Form designer">
      <span className={styles.label}>Form Designer:</span>
      {FIELD_TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`${styles.typeButton} ${fieldType === t.id ? styles.typeButtonActive : ''}`}
          onClick={() => dispatch(setDesignerFieldType(t.id))}
        >
          {t.label}
        </button>
      ))}
      <span className={styles.divider} />
      <button
        type="button"
        className={`${styles.typeButton} ${fieldType === 'select' ? styles.typeButtonActive : ''}`}
        onClick={() => dispatch(setDesignerFieldType('select'))}
      >
        Select
      </button>
      <span className={styles.divider} />
      <button
        type="button"
        className={styles.exitButton}
        onClick={() => dispatch(setDesignerMode(false))}
      >
        Exit (Esc)
      </button>
    </div>
  );
}

interface FormDesignerCanvasProps {
  /** Page number being drawn on (zero-based). */
  pageIndex: number;
  /** Page width in PDF user-space (points). */
  pageWidth: number;
  /** Page height in PDF user-space (points). */
  pageHeight: number;
}

/**
 * Click-to-place + drag-to-size overlay above a page canvas in designer mode.
 * Renders the placement rect while the user drags; on release dispatches
 * designAddFieldThunk with the converted PDF user-space rect.
 */
export function FormDesignerCanvas(props: FormDesignerCanvasProps): JSX.Element | null {
  const dispatch = useAppDispatch();
  const designerMode = useAppSelector(selectDesignerMode);
  const fieldType = useAppSelector(selectDesignerFieldType);
  const zoom = useAppSelector(selectZoom);
  const fields = useAppSelector(selectFormFields);

  const [drag, setDrag] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (fieldType === 'select') return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDrag({ start: { x, y }, current: { x, y } });
    },
    [fieldType],
  );

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setDrag((prev) => {
      if (!prev) return prev;
      const rect = e.currentTarget.getBoundingClientRect();
      return {
        start: prev.start,
        current: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      };
    });
  }, []);

  const onMouseUp = useCallback(() => {
    if (!drag) return;
    const screenLeft = Math.min(drag.start.x, drag.current.x);
    const screenTop = Math.min(drag.start.y, drag.current.y);
    const screenWidth = Math.abs(drag.current.x - drag.start.x);
    const screenHeight = Math.abs(drag.current.y - drag.start.y);

    setDrag(null);

    if (screenWidth < 4 || screenHeight < 4) {
      // Treat as a click — Phase 3.1 may seed a default-sized rect.
      return;
    }

    // Convert screen rect to PDF user-space (origin bottom-left).
    const pdfX = screenLeft / zoom;
    const pdfWidth = screenWidth / zoom;
    const pdfHeight = screenHeight / zoom;
    // y flip: screen origin top, PDF origin bottom.
    const pdfY = props.pageHeight - screenTop / zoom - pdfHeight;

    const baseName = nextUnusedName(
      fields.map((f) => f.name),
      fieldType === 'select' ? 'text' : fieldType,
    );

    const resolvedType: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'date' =
      fieldType === 'select' ? 'text' : fieldType;
    const fd: FormFieldDefinition =
      resolvedType === 'radio' || resolvedType === 'dropdown'
        ? {
            name: baseName,
            type: resolvedType,
            pageIndex: props.pageIndex,
            rect: { x: pdfX, y: pdfY, width: pdfWidth, height: pdfHeight },
            label: baseName,
            required: false,
            origin: 'authored',
            unsaved: true,
            options: [{ value: 'option1', label: 'Option 1' }],
          }
        : {
            name: baseName,
            type: resolvedType,
            pageIndex: props.pageIndex,
            rect: { x: pdfX, y: pdfY, width: pdfWidth, height: pdfHeight },
            label: baseName,
            required: false,
            origin: 'authored',
            unsaved: true,
          };

    void dispatch(designAddFieldThunk({ fieldDefinition: fd }));
    dispatch(setSelectedField(baseName));
  }, [dispatch, drag, fieldType, fields, props.pageHeight, props.pageIndex, zoom]);

  if (!designerMode) return null;

  // Render existing fields with handles so user can click to select.
  const pageFields = fields.filter((f) => f.pageIndex === props.pageIndex);

  return (
    <div
      className={styles.canvasOverlay}
      style={{
        width: props.pageWidth * zoom,
        height: props.pageHeight * zoom,
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => setDrag(null)}
      role="presentation"
    >
      {pageFields.map((f) => (
        <button
          type="button"
          key={f.name}
          className={styles.fieldOutline}
          style={{
            left: f.rect.x * zoom,
            top: (props.pageHeight - f.rect.y - f.rect.height) * zoom,
            width: f.rect.width * zoom,
            height: f.rect.height * zoom,
          }}
          onClick={(e) => {
            e.stopPropagation();
            dispatch(setSelectedField(f.name));
          }}
          aria-label={`Edit field ${f.label || f.name}`}
        >
          <span className={styles.fieldLabel}>
            {f.label || f.name} [{f.type}]
          </span>
        </button>
      ))}

      {drag && (
        <div
          className={styles.dragRect}
          style={{
            left: Math.min(drag.start.x, drag.current.x),
            top: Math.min(drag.start.y, drag.current.y),
            width: Math.abs(drag.current.x - drag.start.x),
            height: Math.abs(drag.current.y - drag.start.y),
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * Find the next un-collided name in the form `<type>_<n>` (text_1, text_2, ...).
 * Exported for tests.
 */
export function nextUnusedName(existing: string[], type: FormFieldType): string {
  const prefix = `${type}_`;
  let n = 1;
  while (existing.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/**
 * Inspector pane host — shown in the right Inspector panel when designerMode
 * is active. Pure re-export here so Inspector imports from a single module.
 */
export { FieldPropertiesPane };
