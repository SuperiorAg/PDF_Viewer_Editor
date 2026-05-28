// Forms slice reducer tests.
// Per conventions §13.6 / project test convention; covers the HYBRID
// commit-boundary contract (form-fill values are transient until commit).

import { describe, expect, it } from 'vitest';

import { type FormFieldDefinition, type FormFieldValue } from '../../types/ipc-contract';

import {
  deepEqualValue,
  selectFormFields,
  selectFormsState,
  selectHasUncommittedValues,
  selectUncommittedFieldNames,
} from './forms-selectors';
import formsReducer, {
  addAuthoredField,
  discardUncommitted,
  markCommitted,
  patchField,
  removeFieldByName,
  resetForms,
  setDesignerFieldType,
  setDesignerMode,
  setDetected,
  setDetecting,
  setDetectError,
  setFieldValue,
  setSelectedField,
  toggleDesignerMode,
} from './forms-slice';

const FIELD_TEXT: FormFieldDefinition = {
  name: 'first_name',
  type: 'text',
  pageIndex: 0,
  rect: { x: 100, y: 100, width: 200, height: 24 },
  label: 'First Name',
  required: false,
  origin: 'detected',
  unsaved: false,
};

const FIELD_REQ: FormFieldDefinition = {
  name: 'last_name',
  type: 'text',
  pageIndex: 0,
  rect: { x: 100, y: 140, width: 200, height: 24 },
  label: 'Last Name',
  required: true,
  origin: 'detected',
  unsaved: false,
};

const initialRoot = { forms: formsReducer(undefined, { type: '@@INIT' }) };

function root(state: ReturnType<typeof formsReducer>) {
  // Cast to RootState shape for selectors; only the .forms slice is used.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { forms: state } as any;
}

describe('formsSlice — detection', () => {
  it('setDetecting transitions status to detecting', () => {
    const next = formsReducer(initialRoot.forms, setDetecting());
    expect(next.detectionStatus).toBe('detecting');
  });

  it('setDetected with non-empty fields → present + populates committedValues from defaultValue', () => {
    const fieldWithDefault: FormFieldDefinition = {
      ...FIELD_TEXT,
      defaultValue: { type: 'text', value: 'Default' },
    };
    const next = formsReducer(
      initialRoot.forms,
      setDetected({
        fields: [fieldWithDefault],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    expect(next.detectionStatus).toBe('present');
    expect(next.fields).toHaveLength(1);
    expect(next.committedValues['first_name']).toEqual({ type: 'text', value: 'Default' });
    expect(next.values['first_name']).toEqual({ type: 'text', value: 'Default' });
  });

  it('setDetected with empty fields + no AcroForm → none', () => {
    const next = formsReducer(
      initialRoot.forms,
      setDetected({
        fields: [],
        hasAcroForm: false,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    expect(next.detectionStatus).toBe('none');
  });

  it('setDetectError sets error status + lastError', () => {
    const next = formsReducer(initialRoot.forms, setDetectError('boom'));
    expect(next.detectionStatus).toBe('error');
    expect(next.lastError).toBe('boom');
  });
});

describe('formsSlice — transient values vs committed values', () => {
  const seeded = formsReducer(
    initialRoot.forms,
    setDetected({
      fields: [FIELD_TEXT, FIELD_REQ],
      hasAcroForm: true,
      hasXfaForm: false,
      hasJavaScriptActions: false,
      warnings: [],
    }),
  );

  it('setFieldValue updates values but NOT committedValues', () => {
    const next = formsReducer(
      seeded,
      setFieldValue({ name: 'first_name', value: { type: 'text', value: 'Alice' } }),
    );
    expect(next.values['first_name']).toEqual({ type: 'text', value: 'Alice' });
    // Committed unchanged (initial empty + no default).
    expect(next.committedValues['first_name']).toBeUndefined();
  });

  it('selectUncommittedFieldNames reports the diff', () => {
    const dirty = formsReducer(
      seeded,
      setFieldValue({ name: 'first_name', value: { type: 'text', value: 'Bob' } }),
    );
    const names = selectUncommittedFieldNames(root(dirty));
    expect(names).toEqual(['first_name']);
    expect(selectHasUncommittedValues(root(dirty))).toBe(true);
  });

  it('markCommitted moves the diff into committedValues', () => {
    const dirty = formsReducer(
      seeded,
      setFieldValue({ name: 'first_name', value: { type: 'text', value: 'Bob' } }),
    );
    const committed = formsReducer(
      dirty,
      markCommitted({ first_name: { type: 'text', value: 'Bob' } }),
    );
    expect(committed.committedValues['first_name']).toEqual({
      type: 'text',
      value: 'Bob',
    });
    expect(selectHasUncommittedValues(root(committed))).toBe(false);
  });

  it('discardUncommitted restores values to committedValues', () => {
    const dirty = formsReducer(
      seeded,
      setFieldValue({ name: 'first_name', value: { type: 'text', value: 'Bob' } }),
    );
    const discarded = formsReducer(dirty, discardUncommitted());
    expect(discarded.values['first_name']).toBeUndefined();
    expect(selectHasUncommittedValues(root(discarded))).toBe(false);
  });
});

describe('formsSlice — design ops mirror', () => {
  it('addAuthoredField appends an authored field', () => {
    const next = formsReducer(
      initialRoot.forms,
      addAuthoredField({ ...FIELD_TEXT, origin: 'authored', unsaved: true }),
    );
    expect(selectFormFields(root(next))).toHaveLength(1);
  });

  it('addAuthoredField with existing name replaces in place', () => {
    const a = formsReducer(initialRoot.forms, addAuthoredField(FIELD_TEXT));
    const updated: FormFieldDefinition = { ...FIELD_TEXT, label: 'Updated Label' };
    const b = formsReducer(a, addAuthoredField(updated));
    expect(b.fields).toHaveLength(1);
    expect(b.fields[0]?.label).toBe('Updated Label');
  });

  it('removeFieldByName deletes the field and its values', () => {
    const seeded = formsReducer(
      initialRoot.forms,
      setDetected({
        fields: [FIELD_TEXT, FIELD_REQ],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    const withVal = formsReducer(
      seeded,
      setFieldValue({ name: 'first_name', value: { type: 'text', value: 'X' } }),
    );
    const removed = formsReducer(withVal, removeFieldByName('first_name'));
    expect(removed.fields.some((f) => f.name === 'first_name')).toBe(false);
    expect(removed.values['first_name']).toBeUndefined();
  });

  it('patchField updates fields in place', () => {
    const seeded = formsReducer(initialRoot.forms, addAuthoredField(FIELD_TEXT));
    const next = formsReducer(
      seeded,
      patchField({ name: 'first_name', patch: { label: 'Patched', required: true } }),
    );
    expect(next.fields[0]?.label).toBe('Patched');
    expect(next.fields[0]?.required).toBe(true);
  });
});

describe('formsSlice — designer mode', () => {
  it('setDesignerMode(true) enters mode; (false) clears selection', () => {
    const a = formsReducer(initialRoot.forms, setDesignerMode(true));
    const b = formsReducer(a, setSelectedField('first_name'));
    expect(b.selectedFieldName).toBe('first_name');
    const c = formsReducer(b, setDesignerMode(false));
    expect(c.designerMode).toBe(false);
    expect(c.selectedFieldName).toBeNull();
  });

  it('toggleDesignerMode flips the flag', () => {
    const a = formsReducer(initialRoot.forms, toggleDesignerMode());
    expect(a.designerMode).toBe(true);
    const b = formsReducer(a, toggleDesignerMode());
    expect(b.designerMode).toBe(false);
  });

  it('setDesignerFieldType changes the active pill', () => {
    const a = formsReducer(initialRoot.forms, setDesignerFieldType('checkbox'));
    expect(a.designerFieldType).toBe('checkbox');
  });
});

describe('formsSlice — reset', () => {
  it('resetForms returns to initial state', () => {
    const a = formsReducer(initialRoot.forms, setDesignerMode(true));
    const b = formsReducer(a, setSelectedField('x'));
    const c = formsReducer(b, resetForms());
    expect(c.designerMode).toBe(false);
    expect(c.selectedFieldName).toBeNull();
    expect(selectFormsState(root(c)).fields).toHaveLength(0);
  });
});

describe('deepEqualValue', () => {
  it('treats matching text values as equal', () => {
    const a: FormFieldValue = { type: 'text', value: 'x' };
    const b: FormFieldValue = { type: 'text', value: 'x' };
    expect(deepEqualValue(a, b)).toBe(true);
  });

  it('treats different types as unequal', () => {
    const a: FormFieldValue = { type: 'text', value: '' };
    const b: FormFieldValue = { type: 'checkbox', value: false };
    expect(deepEqualValue(a, b)).toBe(false);
  });

  it('treats both undefined as equal', () => {
    expect(deepEqualValue(undefined, undefined)).toBe(true);
  });

  it('treats one undefined as unequal', () => {
    expect(deepEqualValue(undefined, { type: 'text', value: '' })).toBe(false);
  });
});
