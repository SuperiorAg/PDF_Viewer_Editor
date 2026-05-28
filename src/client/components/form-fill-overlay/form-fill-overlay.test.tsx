// FormFillOverlay component tests.
// Per ui-spec §12.5. Verifies the HYBRID transient-value contract — typing
// into a field updates formsSlice.values, NOT dirtyOps.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import formsReducer, { setDesignerMode, setDetected } from '../../state/slices/forms-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import { type FormFieldDefinition, type PDFDocumentModel } from '../../types/ipc-contract';

import { FormFillOverlay } from './index';

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

const TEXT: FormFieldDefinition = {
  name: 'first_name',
  type: 'text',
  pageIndex: 0,
  rect: { x: 100, y: 100, width: 200, height: 24 },
  label: 'First',
  required: false,
  origin: 'detected',
  unsaved: false,
};

const CHECKBOX: FormFieldDefinition = {
  name: 'subscribe',
  type: 'checkbox',
  pageIndex: 0,
  rect: { x: 100, y: 140, width: 16, height: 16 },
  label: 'Subscribe',
  required: false,
  origin: 'detected',
  unsaved: false,
};

const SIGNATURE: FormFieldDefinition = {
  name: 'sig',
  type: 'signature',
  pageIndex: 0,
  rect: { x: 100, y: 200, width: 200, height: 48 },
  label: 'Sign here',
  required: false,
  origin: 'detected',
  unsaved: false,
};

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      forms: formsReducer,
      viewport: viewportReducer,
    },
  });
}

function seed(store: ReturnType<typeof makeStore>, fields: FormFieldDefinition[]) {
  store.dispatch(setDocument(DOC));
  store.dispatch(
    setDetected({
      fields,
      hasAcroForm: true,
      hasXfaForm: false,
      hasJavaScriptActions: false,
      warnings: [],
    }),
  );
}

describe('FormFillOverlay', () => {
  it('renders null when designer mode is active', () => {
    const store = makeStore();
    seed(store, [TEXT]);
    store.dispatch(setDesignerMode(true));
    const { container } = render(
      <Provider store={store}>
        <FormFillOverlay pageIndex={0} pageWidth={612} pageHeight={792} />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a text input for a text field', () => {
    const store = makeStore();
    seed(store, [TEXT]);
    render(
      <Provider store={store}>
        <FormFillOverlay pageIndex={0} pageWidth={612} pageHeight={792} />
      </Provider>,
    );
    expect(screen.getByLabelText('First')).toBeInTheDocument();
  });

  it('renders a checkbox for a checkbox field', () => {
    const store = makeStore();
    seed(store, [CHECKBOX]);
    render(
      <Provider store={store}>
        <FormFillOverlay pageIndex={0} pageWidth={612} pageHeight={792} />
      </Provider>,
    );
    const cb = screen.getByLabelText('Subscribe');
    expect(cb).toBeInstanceOf(HTMLInputElement);
    expect((cb as HTMLInputElement).type).toBe('checkbox');
  });

  it('signature field renders a disabled placeholder button', () => {
    const store = makeStore();
    seed(store, [SIGNATURE]);
    render(
      <Provider store={store}>
        <FormFillOverlay pageIndex={0} pageWidth={612} pageHeight={792} />
      </Provider>,
    );
    const btn = screen.getByText(/Click to sign/);
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('typing into a text field updates formsSlice.values but NOT dirtyOps (HYBRID)', () => {
    const store = makeStore();
    seed(store, [TEXT]);
    render(
      <Provider store={store}>
        <FormFillOverlay pageIndex={0} pageWidth={612} pageHeight={792} />
      </Provider>,
    );
    const input = screen.getByLabelText('First');
    fireEvent.change(input, { target: { value: 'Alice' } });
    const state = store.getState();
    expect(state.forms.values['first_name']).toEqual({ type: 'text', value: 'Alice' });
    // No EditOperation in dirtyOps — only the commit boundary produces one.
    expect(state.document.current?.dirtyOps).toHaveLength(0);
  });
});
