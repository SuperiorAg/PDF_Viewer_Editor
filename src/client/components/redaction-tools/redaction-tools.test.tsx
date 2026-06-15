// RedactionToolbar + ApplyRedactionsModal tests — Phase 7.4 B1 (Wave 2, Riley).
// Per docs/phase-7.4-b1-redaction-design.md §7.3.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import redactionsReducer, {
  addMark,
  setPendingInvalidatedSignatureFields,
} from '../../state/slices/redactions-slice';
import uiReducer, {
  setRedactionApplyModalOpen,
  setRedactionPanelOpen,
} from '../../state/slices/ui-slice';
import { type PDFDocumentModel } from '../../types/ipc-contract';

import { ApplyRedactionsModal } from './apply-redactions-modal';
import { RedactionToolbar } from './redaction-toolbar';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 2,
  pages: [
    {
      pageIndex: 0,
      sourcePageRef: { kind: 'original', originalIndex: 0 },
      rotation: 0,
      width: 612,
      height: 792,
    },
    {
      pageIndex: 1,
      sourcePageRef: { kind: 'original', originalIndex: 1 },
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

const RECT = { x: 10, y: 20, width: 100, height: 40 };

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      redactions: redactionsReducer,
      ui: uiReducer,
    },
  });
}

describe('RedactionToolbar', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing when the redaction panel is closed (default)', () => {
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <RedactionToolbar />
      </Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders all five buttons (Mark Rect / Mark Text / Show Markups / Clear / Apply) when open', () => {
    const store = makeStore();
    store.dispatch(setRedactionPanelOpen(true));
    render(
      <Provider store={store}>
        <RedactionToolbar />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /Mark rectangle/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark text/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show redaction markup/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Clear all pending redaction/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply redactions/i })).toBeInTheDocument();
  });

  it('Mark Text button is honestly disabled (deferred to v2)', () => {
    const store = makeStore();
    store.dispatch(setRedactionPanelOpen(true));
    render(
      <Provider store={store}>
        <RedactionToolbar />
      </Provider>,
    );
    const markText = screen.getByRole('button', { name: /Mark text/i });
    expect((markText as HTMLButtonElement).disabled).toBe(true);
    expect(markText).toHaveAttribute('aria-disabled', 'true');
    expect((markText as HTMLButtonElement).title).toMatch(/v2|coming/i);
  });

  it('Mark Rectangle toggles aria-pressed and updates activeTool', () => {
    const store = makeStore();
    store.dispatch(setRedactionPanelOpen(true));
    render(
      <Provider store={store}>
        <RedactionToolbar />
      </Provider>,
    );
    const markRect = screen.getByRole('button', { name: /Mark rectangle/i });
    expect(markRect).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(markRect);
    expect(markRect).toHaveAttribute('aria-pressed', 'true');
    expect(store.getState().redactions.activeTool).toBe('rect');
    fireEvent.click(markRect);
    expect(store.getState().redactions.activeTool).toBeNull();
  });

  it('Apply button is disabled when totalMarks === 0', () => {
    const store = makeStore();
    store.dispatch(setRedactionPanelOpen(true));
    render(
      <Provider store={store}>
        <RedactionToolbar />
      </Provider>,
    );
    const apply = screen.getByRole('button', { name: /Apply redactions/i });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
  });

  it('Apply button is enabled when at least one mark exists and opens the modal on click', () => {
    const store = makeStore();
    store.dispatch(setRedactionPanelOpen(true));
    store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
    render(
      <Provider store={store}>
        <RedactionToolbar />
      </Provider>,
    );
    const apply = screen.getByRole('button', { name: /Apply redactions/i });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);
    expect(store.getState().ui.redactionApplyModalOpen).toBe(true);
  });

  it('Clear Marks is disabled with no marks', () => {
    const store = makeStore();
    store.dispatch(setRedactionPanelOpen(true));
    render(
      <Provider store={store}>
        <RedactionToolbar />
      </Provider>,
    );
    const clear = screen.getByRole('button', { name: /Clear all pending redaction/i });
    expect((clear as HTMLButtonElement).disabled).toBe(true);
  });

  it('Esc inside the sub-toolbar closes the panel without clearing marks', () => {
    const store = makeStore();
    store.dispatch(setRedactionPanelOpen(true));
    store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
    render(
      <Provider store={store}>
        <RedactionToolbar />
      </Provider>,
    );
    const toolbar = screen.getByRole('toolbar', { name: /Redaction tools/i });
    fireEvent.keyDown(toolbar, { key: 'Escape' });
    expect(store.getState().ui.redactionPanelOpen).toBe(false);
    // Marks survive — re-opening shows them again (Acrobat-style).
    expect(store.getState().redactions.totalMarks).toBe(1);
  });
});

describe('ApplyRedactionsModal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing when the apply-modal flag is false', () => {
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <ApplyRedactionsModal />
      </Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders title + body + Cancel + Apply buttons when open', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
    store.dispatch(setRedactionApplyModalOpen(true));
    render(
      <Provider store={store}>
        <ApplyRedactionsModal />
      </Provider>,
    );
    // The title "Apply redactions — this cannot be undone" should appear.
    expect(screen.getByText(/this cannot be undone/i)).toBeInTheDocument();
    // The bullet about rasterization should appear (trust-floor obligation).
    expect(screen.getByText(/rasterized images/i)).toBeInTheDocument();
    // Cancel + Apply buttons.
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Apply redactions$/i })).toBeInTheDocument();
  });

  it('uses role=alertdialog (destructive-confirm pattern)', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
    store.dispatch(setRedactionApplyModalOpen(true));
    render(
      <Provider store={store}>
        <ApplyRedactionsModal />
      </Provider>,
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('renders the signature warning panel when pendingInvalidatedSignatureFields is populated', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
    store.dispatch(setRedactionApplyModalOpen(true));
    store.dispatch(setPendingInvalidatedSignatureFields(['SigField1', 'SigField2']));
    render(
      <Provider store={store}>
        <ApplyRedactionsModal />
      </Provider>,
    );
    // The signature warning paragraph should appear (red panel).
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/digital signature/i)).toBeInTheDocument();
    expect(within(dialog).getByText('SigField1')).toBeInTheDocument();
    expect(within(dialog).getByText('SigField2')).toBeInTheDocument();
  });

  it('Cancel button closes the modal', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(addMark({ pageIndex: 0, rect: RECT }));
    store.dispatch(setRedactionApplyModalOpen(true));
    render(
      <Provider store={store}>
        <ApplyRedactionsModal />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(store.getState().ui.redactionApplyModalOpen).toBe(false);
  });
});
