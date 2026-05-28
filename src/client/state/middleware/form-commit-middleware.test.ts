// Form-commit middleware tests.
// Per conventions §14.2 — verify the HYBRID commit boundary contract.

import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';

import { type FormFieldDefinition, type PDFDocumentModel } from '../../types/ipc-contract';
import documentReducer, { setDocument } from '../slices/document-slice';
import formsReducer, { setDetected, setFieldValue } from '../slices/forms-slice';
import historyReducer from '../slices/history-slice';

import { formCommitMiddleware, triggerFormCommit } from './form-commit-middleware';
import { historyMiddleware } from './history-middleware';

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      forms: formsReducer,
      history: historyReducer,
    },
    middleware: (gdm) =>
      gdm({
        serializableCheck: { ignoredActionPaths: ['payload.bytes'] },
      }).concat(historyMiddleware, formCommitMiddleware),
  });
}

const FIELD: FormFieldDefinition = {
  name: 'email',
  type: 'text',
  pageIndex: 0,
  rect: { x: 0, y: 0, width: 100, height: 24 },
  label: 'Email',
  required: false,
  origin: 'detected',
  unsaved: false,
};

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 1,
  pages: [
    {
      pageIndex: 0,
      sourcePageRef: { kind: 'original', originalIndex: 0 },
      rotation: 0,
      width: 612,
      height: 792,
    },
  ],
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

describe('formCommitMiddleware', () => {
  it('no-op when no transient values exist', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(triggerFormCommit());
    const state = store.getState();
    expect(state.document.current?.dirtyOps).toHaveLength(0);
    expect(state.history.past).toHaveLength(0);
  });

  it('no-op when values match committedValues (no diff)', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [{ ...FIELD, defaultValue: { type: 'text', value: 'pre' } }],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    // values and committedValues both === defaultValue → no diff.
    store.dispatch(triggerFormCommit());
    expect(store.getState().document.current?.dirtyOps).toHaveLength(0);
  });

  it('produces exactly ONE form-commit op when any value differs', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [FIELD],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    // Simulate 3 keystrokes.
    store.dispatch(setFieldValue({ name: 'email', value: { type: 'text', value: 'a' } }));
    store.dispatch(setFieldValue({ name: 'email', value: { type: 'text', value: 'ab' } }));
    store.dispatch(setFieldValue({ name: 'email', value: { type: 'text', value: 'abc' } }));
    store.dispatch(triggerFormCommit());
    const ops = store.getState().document.current?.dirtyOps ?? [];
    // Exactly one — the HYBRID batching guarantee.
    expect(ops).toHaveLength(1);
    expect(ops[0]?.kind).toBe('form-commit');
    if (ops[0]?.kind === 'form-commit') {
      expect(ops[0].fieldValues['email']).toEqual({ type: 'text', value: 'abc' });
    }
  });

  it('marks the diff as committed so a subsequent commit is a no-op', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [FIELD],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    store.dispatch(setFieldValue({ name: 'email', value: { type: 'text', value: 'x' } }));
    store.dispatch(triggerFormCommit());
    expect(store.getState().document.current?.dirtyOps).toHaveLength(1);

    // Second commit with no further keystrokes → no new op.
    store.dispatch(triggerFormCommit());
    expect(store.getState().document.current?.dirtyOps).toHaveLength(1);
    // committedValues should now equal the typed value.
    expect(store.getState().forms.committedValues['email']).toEqual({
      type: 'text',
      value: 'x',
    });
  });

  it('history middleware captures the form-commit op with an inverse', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [{ ...FIELD, defaultValue: { type: 'text', value: 'initial' } }],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    store.dispatch(setFieldValue({ name: 'email', value: { type: 'text', value: 'changed' } }));
    store.dispatch(triggerFormCommit());
    const past = store.getState().history.past;
    expect(past).toHaveLength(1);
    expect(past[0]?.fwd.kind).toBe('form-commit');
    expect(past[0]?.inv.kind).toBe('form-commit');
    if (past[0]?.inv.kind === 'form-commit') {
      // Inverse fieldValues should be the prior committedValues.
      expect(past[0].inv.fieldValues['email']).toEqual({
        type: 'text',
        value: 'initial',
      });
    }
  });
});
