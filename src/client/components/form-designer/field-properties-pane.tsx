// FieldPropertiesPane — Phase 3 properties editor inside Inspector.
// Per ui-spec.md §12.4 (Inspector — Form-field properties pane).
//
// Edits to label / required / options / defaultValue fire `forms:designAdd`
// with the patched field (the engine treats designAdd as upsert by name) —
// but Phase 3 ships an OPTIONAL designEdit path via patchField slice action
// for in-memory updates without round-trip. Renderer-side patch is wired
// here; the actual EditOperation (`form-design-edit`) is dispatched through
// applyEdit so undo/history is preserved.

import { useEffect, useState } from 'react';

import { useAppDispatch, useAppSelector } from '../../state/hooks';
import { applyEdit } from '../../state/slices/document-slice';
import { selectSelectedField } from '../../state/slices/forms-selectors';
import { patchField } from '../../state/slices/forms-slice';
import { designRemoveFieldThunk } from '../../state/thunks';
import {
  type EditOperation,
  type FormFieldDefinition,
  type FormFieldOption,
} from '../../types/ipc-contract';

import styles from './form-designer.module.css';

export function FieldPropertiesPane(): JSX.Element | null {
  const dispatch = useAppDispatch();
  const field = useAppSelector(selectSelectedField);
  const [draft, setDraft] = useState<FormFieldDefinition | null>(field);

  useEffect(() => {
    setDraft(field);
  }, [field]);

  if (!field || !draft) return null;

  const commitPatch = (patch: Partial<FormFieldDefinition>): void => {
    const op: EditOperation = {
      kind: 'form-design-edit',
      meta: {
        ts: Date.now(),
        undoable: true,
        operationId: `form-design-edit-${Date.now()}`,
      },
      fieldName: field.name,
      before: pickChangedKeys(field, patch),
      after: patch,
    };
    dispatch(applyEdit(op));
    dispatch(patchField({ name: field.name, patch }));
  };

  return (
    <div className={styles.propsPane} aria-label="Field properties">
      <h3 className={styles.propsTitle}>
        {field.label || field.name} <span className={styles.propsType}>({field.type})</span>
      </h3>
      <div className={styles.propsRow}>
        <label htmlFor="field-name">Name</label>
        <input id="field-name" type="text" value={field.name} disabled aria-readonly="true" />
      </div>
      <div className={styles.propsRow}>
        <label htmlFor="field-label">Label</label>
        <input
          id="field-label"
          type="text"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.currentTarget.value })}
          onBlur={() => {
            if (draft.label !== field.label) commitPatch({ label: draft.label });
          }}
        />
      </div>
      <div className={styles.propsRow}>
        <label htmlFor="field-required">
          <input
            id="field-required"
            type="checkbox"
            checked={draft.required}
            onChange={(e) => {
              const next = { ...draft, required: e.currentTarget.checked };
              setDraft(next);
              commitPatch({ required: next.required });
            }}
          />
          Required
        </label>
      </div>
      <div className={styles.propsRow}>
        <span>Page</span>
        <span>{field.pageIndex + 1} (read-only)</span>
      </div>
      <div className={styles.propsRow}>
        <span>Rect</span>
        <span>
          x={Math.round(field.rect.x)} y={Math.round(field.rect.y)} w={Math.round(field.rect.width)}{' '}
          h={Math.round(field.rect.height)}
        </span>
      </div>

      {(field.type === 'radio' || field.type === 'dropdown') && (
        <OptionsEditor
          options={draft.options ?? []}
          onChange={(options) => {
            setDraft({ ...draft, options });
            commitPatch({ options });
          }}
        />
      )}

      {field.type === 'signature' && (
        <p className={styles.propsHint}>Signing arrives in Phase 4. This field is a placeholder.</p>
      )}

      <button
        type="button"
        className={styles.removeButton}
        onClick={() => void dispatch(designRemoveFieldThunk({ fieldName: field.name }))}
      >
        Remove field
      </button>
    </div>
  );
}

function pickChangedKeys(
  field: FormFieldDefinition,
  patch: Partial<FormFieldDefinition>,
): Partial<FormFieldDefinition> {
  const out: Partial<FormFieldDefinition> = {};
  for (const k of Object.keys(patch) as Array<keyof FormFieldDefinition>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any)[k] = (field as any)[k];
  }
  return out;
}

interface OptionsEditorProps {
  options: FormFieldOption[];
  onChange: (options: FormFieldOption[]) => void;
}

function OptionsEditor(props: OptionsEditorProps): JSX.Element {
  return (
    <div className={styles.optionsEditor}>
      <h4>Options</h4>
      {props.options.map((opt, i) => (
        <div key={i} className={styles.optionRow}>
          <input
            type="text"
            value={opt.value}
            onChange={(e) => {
              const next = [...props.options];
              next[i] = { ...opt, value: e.currentTarget.value };
              props.onChange(next);
            }}
            placeholder="Value"
            aria-label={`Option ${i + 1} value`}
          />
          <input
            type="text"
            value={opt.label}
            onChange={(e) => {
              const next = [...props.options];
              next[i] = { ...opt, label: e.currentTarget.value };
              props.onChange(next);
            }}
            placeholder="Label"
            aria-label={`Option ${i + 1} label`}
          />
          <button
            type="button"
            onClick={() => props.onChange(props.options.filter((_, j) => j !== i))}
            aria-label={`Remove option ${i + 1}`}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.addOptionButton}
        onClick={() =>
          props.onChange([
            ...props.options,
            {
              value: `option${props.options.length + 1}`,
              label: `Option ${props.options.length + 1}`,
            },
          ])
        }
      >
        + Add option
      </button>
    </div>
  );
}
