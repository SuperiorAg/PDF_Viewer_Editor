// FormsPanel component tests.
// Per ui-spec.md §12.3 + §12.11 (empty / loading / populated screen states).

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import formsReducer, {
  setDetected,
  setDetecting,
  setFieldValue,
} from '../../state/slices/forms-slice';
import formsTemplatesReducer from '../../state/slices/forms-templates-slice';
import uiReducer from '../../state/slices/ui-slice';
import { type FormFieldDefinition, type PDFDocumentModel } from '../../types/ipc-contract';

import { FormsPanel } from './index';

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

const F1: FormFieldDefinition = {
  name: 'first_name',
  type: 'text',
  pageIndex: 0,
  rect: { x: 0, y: 0, width: 200, height: 24 },
  label: 'First Name',
  required: true,
  origin: 'detected',
  unsaved: false,
};

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      forms: formsReducer,
      formsTemplates: formsTemplatesReducer,
      ui: uiReducer,
    },
  });
}

describe('FormsPanel', () => {
  it('renders a placeholder when no document is open', () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <FormsPanel />
      </Provider>,
    );
    expect(screen.getByText(/Open a document to view forms/i)).toBeInTheDocument();
  });

  it('shows "Detecting forms…" banner during detection', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(setDetecting());
    render(
      <Provider store={store}>
        <FormsPanel />
      </Provider>,
    );
    expect(screen.getByText(/Detecting forms/i)).toBeInTheDocument();
  });

  it('shows "No fillable form fields" content when detection completes with zero fields', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [],
        hasAcroForm: false,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    render(
      <Provider store={store}>
        <FormsPanel />
      </Provider>,
    );
    // Both the banner and the placeholder reference the same phrase — that's
    // by design. Use getAllByText and assert at least one match.
    expect(screen.getAllByText(/No fillable form fields/i).length).toBeGreaterThan(0);
  });

  it('renders detected fields grouped by page with required indicator', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [F1],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    render(
      <Provider store={store}>
        <FormsPanel />
      </Provider>,
    );
    expect(screen.getByText(/AcroForm detected: 1 fields/i)).toBeInTheDocument();
    expect(screen.getByText(/First Name/)).toBeInTheDocument();
    // Required asterisk has aria-label.
    expect(screen.getByLabelText(/required/i)).toBeInTheDocument();
  });

  it('shows the JS-actions warning when hasJavaScriptActions=true', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [F1],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: true,
        warnings: [],
      }),
    );
    render(
      <Provider store={store}>
        <FormsPanel />
      </Provider>,
    );
    expect(screen.getByText(/JavaScript actions stripped/i)).toBeInTheDocument();
  });

  it('shows the XFA read-only banner when hasXfaForm=true', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [F1],
        hasAcroForm: true,
        hasXfaForm: true,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    render(
      <Provider store={store}>
        <FormsPanel />
      </Provider>,
    );
    expect(screen.getByText(/XFA payload/i)).toBeInTheDocument();
  });

  it('shows the "Commit form values" banner when uncommitted values exist', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(
      setDetected({
        fields: [F1],
        hasAcroForm: true,
        hasXfaForm: false,
        hasJavaScriptActions: false,
        warnings: [],
      }),
    );
    store.dispatch(setFieldValue({ name: 'first_name', value: { type: 'text', value: 'Alice' } }));
    render(
      <Provider store={store}>
        <FormsPanel />
      </Provider>,
    );
    expect(screen.getByText(/1 unsaved field value/i)).toBeInTheDocument();
    // Note: 'Uncommitted edit' tooltip on the dirty dot also matches /Commit/i,
    // so anchor with exact name.
    expect(screen.getByRole('button', { name: 'Commit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });
});
