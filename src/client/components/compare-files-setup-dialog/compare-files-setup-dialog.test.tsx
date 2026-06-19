// Setup dialog tests — Phase 7.5 Wave 7 B2 (Riley).

import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import compareReducer, { setupOpened, type CompareState } from '../../state/slices/compare-slice';
import documentReducer, { setDocument } from '../../state/slices/document-slice';
import i18nReducer from '../../state/slices/i18n-slice';
import uiReducer from '../../state/slices/ui-slice';
import type { PDFDocumentModel } from '../../types/ipc-contract';

import { CompareFilesSetupDialog } from './index';

const SEED_DOC: PDFDocumentModel = {
  handle: 7,
  displayName: 'seed.pdf',
  fileHash: 'a'.repeat(64),
  pageCount: 3,
  pages: Array.from({ length: 3 }, (_, i) => ({
    pageIndex: i,
    sourcePageRef: { kind: 'original' as const, originalIndex: i },
    rotation: 0 as const,
    width: 612,
    height: 792,
  })),
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

function makeStore(seedDoc = true): ReturnType<typeof configureStore> {
  const store = configureStore({
    reducer: {
      compare: compareReducer,
      document: documentReducer,
      i18n: i18nReducer,
      ui: uiReducer,
    },
    middleware: (g) => g({ serializableCheck: false }),
  });
  store.dispatch(setupOpened());
  if (seedDoc) store.dispatch(setDocument(SEED_DOC));
  return store;
}

type AnyStore = ReturnType<typeof makeStore>;

function stubPdfApi(stubs: {
  pickPdfFiles?: (req: { multi?: boolean }) => Promise<unknown>;
}): void {
  vi.stubGlobal('pdfApi', {
    dialog: {
      openPdf: vi.fn(),
      saveAs: vi.fn(),
      pickExportOutputPath: vi.fn(),
      pickPdfFiles:
        stubs.pickPdfFiles ??
        vi.fn(() => Promise.resolve({ ok: false, error: 'user_cancelled', message: 'cancelled' })),
      pickFolder: vi.fn(),
    },
  });
}

beforeEach(() => {
  vi.stubGlobal('pdfApi', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderDialog(store: AnyStore): void {
  render(
    <Provider store={store}>
      <CompareFilesSetupDialog />
    </Provider>,
  );
}

describe('CompareFilesSetupDialog — gating', () => {
  test('renders the setup title and both column labels', () => {
    stubPdfApi({});
    renderDialog(makeStore());
    expect(screen.getByRole('dialog', { name: /Compare Files/i })).toBeInTheDocument();
    expect(screen.getByText(/Baseline \(left\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Modified \(right\)/i)).toBeInTheDocument();
  });

  test('Compare button is disabled until both sides are picked', () => {
    stubPdfApi({});
    renderDialog(makeStore());
    const compareButton = screen.getByRole('button', { name: /^Compare$/ });
    expect(compareButton).toBeDisabled();
  });

  test('picking only one side keeps Compare disabled', () => {
    stubPdfApi({});
    const store = makeStore();
    renderDialog(store);
    const leftOpenDoc = screen.getByTestId('compare-pick-open-doc-left');
    act(() => {
      fireEvent.click(leftOpenDoc);
    });
    const compareButton = screen.getByRole('button', { name: /^Compare$/ });
    expect(compareButton).toBeDisabled();
  });

  test('picking both sides enables Compare', () => {
    stubPdfApi({});
    const store = makeStore();
    renderDialog(store);
    act(() => {
      fireEvent.click(screen.getByTestId('compare-pick-open-doc-left'));
      fireEvent.click(screen.getByTestId('compare-pick-open-doc-right'));
    });
    const compareButton = screen.getByRole('button', { name: /^Compare$/ });
    expect(compareButton).toBeEnabled();
  });

  test('no open document shows the muted hint instead of the pick row', () => {
    stubPdfApi({});
    renderDialog(makeStore(false));
    expect(screen.queryByTestId('compare-pick-open-doc-left')).not.toBeInTheDocument();
    // The "no open documents" hint string is in the left + right columns.
    expect(
      screen.getAllByText(/No documents are open\. Use Browse to pick a PDF from disk\./i),
    ).toHaveLength(2);
  });

  test('Cancel button closes the dialog', () => {
    stubPdfApi({});
    const store = makeStore();
    renderDialog(store);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    });
    const state = store.getState() as { compare: CompareState };
    expect(state.compare.setup.open).toBe(false);
  });
});

describe('CompareFilesSetupDialog — browse flow', () => {
  test('Browse on left invokes dialog:pickPdfFiles and shows the picked filename', async () => {
    const pickSpy = vi.fn(() =>
      Promise.resolve({ ok: true, value: { paths: ['C:/baseline.pdf'] } }),
    );
    stubPdfApi({ pickPdfFiles: pickSpy });
    renderDialog(makeStore());
    await act(async () => {
      fireEvent.click(screen.getByTestId('compare-browse-left'));
    });
    expect(pickSpy).toHaveBeenCalledWith({ multi: false });
    expect(screen.getByTestId('compare-pick-disk-left')).toHaveTextContent('baseline.pdf');
  });

  test('user_cancelled from the browse picker is silent', async () => {
    const pickSpy = vi.fn(() =>
      Promise.resolve({ ok: false, error: 'user_cancelled', message: 'cancelled' }),
    );
    stubPdfApi({ pickPdfFiles: pickSpy });
    const store = makeStore();
    renderDialog(store);
    await act(async () => {
      fireEvent.click(screen.getByTestId('compare-browse-left'));
    });
    const uiState = (store.getState() as { ui: { toasts: { message: string }[] } }).ui;
    expect(uiState.toasts).toHaveLength(0);
    expect(screen.queryByTestId('compare-pick-disk-left')).not.toBeInTheDocument();
  });

  test('Clear button removes the active pick', async () => {
    stubPdfApi({});
    const store = makeStore();
    renderDialog(store);
    act(() => {
      fireEvent.click(screen.getByTestId('compare-pick-open-doc-left'));
    });
    expect(screen.getByTestId('compare-clear-left')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId('compare-clear-left'));
    });
    const state = store.getState() as { compare: CompareState };
    expect(state.compare.setup.left).toBeNull();
  });
});
