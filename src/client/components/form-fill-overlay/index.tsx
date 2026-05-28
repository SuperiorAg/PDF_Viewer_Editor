// FormFillOverlay — Phase 3 fillable widget overlay on top of pages.
// Per docs/ui-spec.md §12.5.
//
// Rendered above PdfCanvas when formsSlice.detectionStatus === 'present' AND
// designerMode === false. The overlay positions one editable widget per field
// using the rect from FormFieldDefinition. Coords are PDF user-space; this
// component converts to screen-space via the existing pdf-coords.ts helpers.
//
// Mutations dispatch setFieldValue (transient — formsSlice.values). They are
// NOT EditOperations. The commit-middleware batches them into ONE form-commit
// at Save / Commit-button / close prompt.

import { useMemo } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { selectCurrentDocument } from '../../state/slices/document-selectors';
import {
  selectDesignerMode,
  selectFormDetectionStatus,
  selectFormFields,
  selectFormValues,
} from '../../state/slices/forms-selectors';
import { setFieldValue, setSelectedField } from '../../state/slices/forms-slice';
import { selectZoom } from '../../state/slices/viewport-selectors';
import { type FormFieldDefinition, type FormFieldValue } from '../../types/ipc-contract';

import styles from './form-fill-overlay.module.css';

interface FormFillOverlayProps {
  pageIndex: number;
  /** Page width in PDF user-space (points). */
  pageWidth: number;
  /** Page height in PDF user-space (points). */
  pageHeight: number;
  /** Optional: rotation applied to the page for display. */
  rotation?: 0 | 90 | 180 | 270;
}

export function FormFillOverlay(props: FormFillOverlayProps): JSX.Element | null {
  const dispatch = useAppDispatch();
  const doc = useAppSelector(selectCurrentDocument);
  const fields = useAppSelector(selectFormFields);
  const values = useAppSelector(selectFormValues);
  const detectionStatus = useAppSelector(selectFormDetectionStatus);
  const designerMode = useAppSelector(selectDesignerMode);
  const zoom = useAppSelector(selectZoom);

  const visible: boolean = Boolean(doc) && detectionStatus === 'present' && !designerMode;

  const pageFields = useMemo(
    () => fields.filter((f) => f.pageIndex === props.pageIndex),
    [fields, props.pageIndex],
  );

  if (!visible || pageFields.length === 0) return null;

  const scale = zoom;

  return (
    <div
      className={styles.overlay}
      style={{
        width: props.pageWidth * scale,
        height: props.pageHeight * scale,
      }}
      role="group"
      aria-label={`Form fields on page ${props.pageIndex + 1}`}
    >
      {pageFields.map((field) => (
        <FieldWidget
          key={field.name}
          field={field}
          value={values[field.name]}
          pageHeight={props.pageHeight}
          scale={scale}
          onChange={(v) => {
            dispatch(setFieldValue({ name: field.name, value: v }));
          }}
          onFocus={() => dispatch(setSelectedField(field.name))}
        />
      ))}
    </div>
  );
}

interface FieldWidgetProps {
  field: FormFieldDefinition;
  value: FormFieldValue | undefined;
  pageHeight: number;
  scale: number;
  onChange: (v: FormFieldValue) => void;
  onFocus: () => void;
}

function FieldWidget(props: FieldWidgetProps): JSX.Element {
  // PDF user-space → screen-space: y is flipped (origin bottom-left → top-left).
  const left = props.field.rect.x * props.scale;
  const top = (props.pageHeight - props.field.rect.y - props.field.rect.height) * props.scale;
  const width = props.field.rect.width * props.scale;
  const height = props.field.rect.height * props.scale;

  const style = {
    position: 'absolute' as const,
    left,
    top,
    width,
    height,
  };

  const ariaRequired: boolean = props.field.required;

  switch (props.field.type) {
    case 'text': {
      const v = props.value?.type === 'text' ? props.value.value : '';
      return (
        <input
          type="text"
          className={styles.textInput}
          style={style}
          aria-label={props.field.label || props.field.name}
          aria-required={ariaRequired}
          value={v}
          onChange={(e) => props.onChange({ type: 'text', value: e.currentTarget.value })}
          onFocus={props.onFocus}
        />
      );
    }
    case 'checkbox': {
      const v = props.value?.type === 'checkbox' ? props.value.value : false;
      return (
        <input
          type="checkbox"
          className={styles.checkbox}
          style={style}
          aria-label={props.field.label || props.field.name}
          aria-required={ariaRequired}
          checked={v}
          onChange={(e) => props.onChange({ type: 'checkbox', value: e.currentTarget.checked })}
          onFocus={props.onFocus}
        />
      );
    }
    case 'radio': {
      const v = props.value?.type === 'radio' ? props.value.value : '';
      const options = props.field.options ?? [];
      // Stack the options vertically inside the field rect — Phase 3 minimum
      // viable rendering. Phase 3.1 may unpack to per-option rects from /Kids.
      return (
        <div
          className={styles.radioGroup}
          style={style}
          role="radiogroup"
          aria-label={props.field.label || props.field.name}
        >
          {options.map((opt) => (
            <label key={opt.value} className={styles.radioOption}>
              <input
                type="radio"
                name={`radio-${props.field.name}`}
                checked={v === opt.value}
                onChange={() => props.onChange({ type: 'radio', value: opt.value })}
                onFocus={props.onFocus}
              />
              {opt.label || opt.value}
            </label>
          ))}
        </div>
      );
    }
    case 'dropdown': {
      const v = props.value?.type === 'dropdown' ? props.value.value : '';
      const options = props.field.options ?? [];
      return (
        <select
          className={styles.dropdown}
          style={style}
          aria-label={props.field.label || props.field.name}
          aria-required={ariaRequired}
          value={v}
          onChange={(e) => props.onChange({ type: 'dropdown', value: e.currentTarget.value })}
          onFocus={props.onFocus}
        >
          <option value="" />
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label || opt.value}
            </option>
          ))}
        </select>
      );
    }
    case 'date': {
      const v = props.value?.type === 'date' ? props.value.value : '';
      return (
        <input
          type="date"
          className={styles.textInput}
          style={style}
          aria-label={props.field.label || props.field.name}
          aria-required={ariaRequired}
          value={v}
          onChange={(e) => props.onChange({ type: 'date', value: e.currentTarget.value })}
          onFocus={props.onFocus}
        />
      );
    }
    case 'signature': {
      return (
        <button
          type="button"
          className={styles.signaturePlaceholder}
          style={style}
          disabled
          title="Signing arrives in Phase 4."
          onFocus={props.onFocus}
        >
          Click to sign (Phase 4)
        </button>
      );
    }
    default: {
      const _exhaustive: never = props.field.type;
      void _exhaustive;
      return <span style={style} />;
    }
  }
}
