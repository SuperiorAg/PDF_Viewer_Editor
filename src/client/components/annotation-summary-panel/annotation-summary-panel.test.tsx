// AnnotationSummaryPanel tests — Phase 4.
// Per docs/ui-spec.md §13.7.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import signatureAuditReducer from '../../state/slices/signature-audit-slice';
import uiReducer from '../../state/slices/ui-slice';
import { type AnnotationModel, type PDFDocumentModel } from '../../types/ipc-contract';

import { AnnotationSummaryPanel } from './index';

const A1: AnnotationModel = {
  id: 'a1',
  pageIndex: 0,
  subtype: 'Highlight',
  rect: { x: 0, y: 0, width: 100, height: 20 },
  color: { r: 1, g: 0, b: 0 },
  opacity: 0.5,
  contents: 'Important note',
  createdAt: 1,
  modifiedAt: 1,
};
const A2: AnnotationModel = {
  id: 'a2',
  pageIndex: 0,
  subtype: 'FreeText',
  rect: { x: 0, y: 30, width: 100, height: 20 },
  color: { r: 0, g: 0, b: 0 },
  opacity: 1,
  contents: 'Approved',
  createdAt: 2,
  modifiedAt: 2,
};
const A3: AnnotationModel = {
  id: 'a3',
  pageIndex: 3,
  subtype: 'Ink',
  rect: { x: 0, y: 100, width: 200, height: 80 },
  color: { r: 0, g: 0, b: 0 },
  opacity: 1,
  createdAt: 3,
  modifiedAt: 3,
};

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 5,
  pages: [],
  annotations: [A1, A2, A3],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      signatureAudit: signatureAuditReducer,
      ui: uiReducer,
    },
  });
}

describe('AnnotationSummaryPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders empty state when no document', () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <AnnotationSummaryPanel />
      </Provider>,
    );
    expect(screen.getByText(/No document open/i)).toBeInTheDocument();
  });

  it('groups annotations by page; shows contents preview', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    render(
      <Provider store={store}>
        <AnnotationSummaryPanel />
      </Provider>,
    );
    expect(screen.getByText(/Page 1/)).toBeInTheDocument();
    expect(screen.getByText(/Page 4/)).toBeInTheDocument();
    // Highlight (Page 1)
    expect(screen.getByLabelText(/Highlight on page 1/)).toBeInTheDocument();
    expect(screen.getByText(/Important note/)).toBeInTheDocument();
    // FreeText (Page 1)
    expect(screen.getByLabelText(/FreeText on page 1/)).toBeInTheDocument();
    expect(screen.getByText(/Approved/)).toBeInTheDocument();
    // Ink (Page 4)
    expect(screen.getByLabelText(/Ink on page 4/)).toBeInTheDocument();
  });

  it('hides Highlight annotations when filter is off', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    render(
      <Provider store={store}>
        <AnnotationSummaryPanel />
      </Provider>,
    );
    expect(screen.getByLabelText(/Highlight on page 1/)).toBeInTheDocument();
    // Uncheck Highlight filter
    fireEvent.click(screen.getByLabelText(/Highlight/));
    expect(screen.queryByLabelText(/Highlight on page 1/)).toBeNull();
  });
});
