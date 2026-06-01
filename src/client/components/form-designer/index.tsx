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

/**
 * Default field sizes in PDF user-space points, used for the click-to-place
 * path (no drag, or drag < 4×4 px). Phase 3.1 — closes the bug where users
 * who clicked instead of dragged saw "nothing happens". Sizes chosen as
 * sensible single-line / square / signature defaults; the user can resize
 * via handles afterwards (handles land in a later phase).
 */
export const DEFAULT_FIELD_SIZE_PTS: Readonly<
  Record<FormFieldType, { width: number; height: number }>
> = {
  text: { width: 144, height: 18 },
  checkbox: { width: 14, height: 14 },
  radio: { width: 14, height: 14 },
  dropdown: { width: 144, height: 18 },
  signature: { width: 180, height: 36 },
  date: { width: 100, height: 18 },
};

/** Below this drag distance (in screen pixels), treat as a click. */
export const CLICK_THRESHOLD_PX = 4;

export interface ScreenDragRect {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure helper — convert a screen-space drag (or click) into a PDF user-space
 * rect. When the drag distance is below {@link CLICK_THRESHOLD_PX} on either
 * axis, returns a default-sized rect seeded at the drag start (the click
 * point) using {@link DEFAULT_FIELD_SIZE_PTS}. Otherwise returns the drag
 * bounds converted at `zoom` with the standard y-flip.
 *
 * Exported for tests so the click-to-place geometry is pinned without
 * mounting the IPC stack.
 */
export function computePlacementPdfRect(args: {
  drag: ScreenDragRect;
  fieldType: FormFieldType;
  zoom: number;
  pageHeight: number;
}): PdfRect {
  const { drag, fieldType, zoom, pageHeight } = args;
  const dragWidth = Math.abs(drag.current.x - drag.start.x);
  const dragHeight = Math.abs(drag.current.y - drag.start.y);
  if (dragWidth < CLICK_THRESHOLD_PX || dragHeight < CLICK_THRESHOLD_PX) {
    const defaults = DEFAULT_FIELD_SIZE_PTS[fieldType];
    const x = drag.start.x / zoom;
    const width = defaults.width;
    const height = defaults.height;
    const y = pageHeight - drag.start.y / zoom - height;
    return { x, y, width, height };
  }
  const dragLeft = Math.min(drag.start.x, drag.current.x);
  const dragTop = Math.min(drag.start.y, drag.current.y);
  const width = dragWidth / zoom;
  const height = dragHeight / zoom;
  const x = dragLeft / zoom;
  const y = pageHeight - dragTop / zoom - height;
  return { x, y, width, height };
}

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
    // 'select' tool is for picking existing fields, not creating new ones.
    if (fieldType === 'select') {
      setDrag(null);
      return;
    }

    const rect = computePlacementPdfRect({
      drag,
      fieldType,
      zoom,
      pageHeight: props.pageHeight,
    });

    setDrag(null);

    const baseName = nextUnusedName(
      fields.map((f) => f.name),
      fieldType,
    );

    const resolvedType: FormFieldType = fieldType;
    const fd: FormFieldDefinition =
      resolvedType === 'radio' || resolvedType === 'dropdown'
        ? {
            name: baseName,
            type: resolvedType,
            pageIndex: props.pageIndex,
            rect,
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
            rect,
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

  // Crosshair cursor when a placement tool is active; default pointer when in
  // 'select' mode (existing fields below still expose their own pointer
  // cursor for selection). Cursor is a visual feedback channel only — does
  // not affect keyboard accessibility (field outlines are real <button>s).
  const overlayClass =
    fieldType === 'select'
      ? `${styles.canvasOverlay} ${styles.canvasOverlaySelect}`
      : styles.canvasOverlay;

  return (
    <div
      className={overlayClass}
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
