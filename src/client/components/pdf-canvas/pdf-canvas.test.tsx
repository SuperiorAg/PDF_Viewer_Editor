// Phase 4.1.1 (Riley) — PdfCanvas tests. Locks in the Option-Y refactor:
// PdfCanvas no longer maintains a component-local `measuredDims` state.
// PageModel.width/height from Redux drives the CSS box; the renderer kicks
// off pdf.js render but does NOT setState dims.
//
// The full pdf.js render path is mocked at the pdf-loader seam so this test
// runs in jsdom without spinning up a Web Worker. Memory hygiene assertions
// (cancel on unmount, cleanup on unmount) live in pdf-render.test.ts; here
// we focus on the Phase 4.1.1 contract: layout reads from props.page.

import { configureStore, type EnhancedStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import annotationsReducer from '../../state/slices/annotations-slice';
import documentReducer, { setDocument, setPageDimensions } from '../../state/slices/document-slice';
import selectionReducer from '../../state/slices/selection-slice';
import shapesReducer from '../../state/slices/shapes-slice';
import signaturesReducer from '../../state/slices/signatures-slice';
import uiReducer from '../../state/slices/ui-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import { type PageModel } from '../../types/ipc-contract';

import { PdfCanvas } from './index';

// Mock pdf-loader at the seam — PdfCanvas calls it; we feed a fake doc proxy.
let nextLoadResult: unknown = { ok: false, error: 'bridge_unavailable', message: 'test' };
vi.mock('../../services/pdf-loader', () => ({
  loadDocumentByHandle: vi.fn(async () => nextLoadResult),
}));

type AnyStore = EnhancedStore<{
  document: ReturnType<typeof documentReducer>;
  viewport: ReturnType<typeof viewportReducer>;
  annotations: ReturnType<typeof annotationsReducer>;
  selection: ReturnType<typeof selectionReducer>;
  ui: ReturnType<typeof uiReducer>;
  shapes: ReturnType<typeof shapesReducer>;
  signatures: ReturnType<typeof signaturesReducer>;
}>;

function makeStore(): AnyStore {
  return configureStore({
    reducer: {
      document: documentReducer,
      viewport: viewportReducer,
      annotations: annotationsReducer,
      selection: selectionReducer,
      ui: uiReducer,
      shapes: shapesReducer,
      signatures: signaturesReducer,
    },
    middleware: (mw) =>
      mw({
        serializableCheck: {
          ignoredActionPaths: ['payload.bytes', 'payload.outputBytes', 'payload.data.bytes'],
        },
      }),
  });
}

function seedDoc(store: AnyStore, pages: PageModel[], opts: { handle?: number } = {}): void {
  store.dispatch(
    setDocument({
      handle: opts.handle ?? 1,
      displayName: 't.pdf',
      fileHash: 'h',
      pageCount: pages.length,
      pages,
      annotations: [],
      dirtyOps: [],
      savedAtHandleVersion: 0,
      pdflibLoadWarnings: [],
    }),
  );
}

function letterPage(index: number): PageModel {
  return {
    pageIndex: index,
    sourcePageRef: { kind: 'original', originalIndex: index },
    rotation: 0,
    width: 612,
    height: 792,
  };
}

function getPageBox(): HTMLElement {
  const box = document.querySelector('[data-page-index]');
  if (!(box instanceof HTMLElement)) {
    throw new Error('page box not found');
  }
  return box;
}

beforeEach(() => {
  nextLoadResult = { ok: false, error: 'bridge_unavailable', message: 'test' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PdfCanvas — Phase 4.1.1 dimension contract', () => {
  it('lays out using PageModel dimensions from Redux (Letter default before measure)', () => {
    const store = makeStore();
    seedDoc(store, [letterPage(0)]);
    render(
      <Provider store={store}>
        <PdfCanvas page={letterPage(0)} index={0} zoom={1} fitMode="custom" />
      </Provider>,
    );
    const box = getPageBox();
    // Letter at zoom=1 → 612 × 792.
    expect(box.style.width).toBe('612px');
    expect(box.style.height).toBe('792px');
  });

  it('re-lays out when Redux dispatches setPageDimensions (no component-local measuredDims)', async () => {
    const store = makeStore();
    seedDoc(store, [letterPage(0)]);
    const { rerender } = render(
      <Provider store={store}>
        <PdfCanvas page={letterPage(0)} index={0} zoom={1} fitMode="custom" />
      </Provider>,
    );
    // Letter pre-measure.
    expect(getPageBox().style.width).toBe('612px');

    // Dispatch the measure result (A4: 595 × 842).
    store.dispatch(setPageDimensions([{ pageIndex: 0, width: 595, height: 842 }]));
    const updated = store.getState().document.current?.pages[0];
    expect(updated?.width).toBe(595);

    // Caller (PdfViewer) re-renders with the new page from the store.
    rerender(
      <Provider store={store}>
        <PdfCanvas page={updated!} index={0} zoom={1} fitMode="custom" />
      </Provider>,
    );
    await waitFor(() => {
      expect(getPageBox().style.width).toBe('595px');
      expect(getPageBox().style.height).toBe('842px');
    });
  });

  it('applies zoom to the Redux dims', () => {
    const store = makeStore();
    const page: PageModel = { ...letterPage(0), width: 595, height: 842 };
    seedDoc(store, [page]);
    render(
      <Provider store={store}>
        <PdfCanvas page={page} index={0} zoom={2} fitMode="custom" />
      </Provider>,
    );
    expect(getPageBox().style.width).toBe('1190px');
    expect(getPageBox().style.height).toBe('1684px');
  });

  it('swaps width/height for 90-degree rotation', () => {
    const store = makeStore();
    const page: PageModel = {
      pageIndex: 0,
      sourcePageRef: { kind: 'original', originalIndex: 0 },
      rotation: 90,
      width: 595,
      height: 842,
    };
    seedDoc(store, [page]);
    render(
      <Provider store={store}>
        <PdfCanvas page={page} index={0} zoom={1} fitMode="custom" />
      </Provider>,
    );
    expect(getPageBox().style.width).toBe('842px');
    expect(getPageBox().style.height).toBe('595px');
  });

  it('aria-label includes the 1-based page number', () => {
    const store = makeStore();
    seedDoc(store, [letterPage(0), letterPage(1)]);
    render(
      <Provider store={store}>
        <PdfCanvas page={letterPage(1)} index={1} zoom={1} fitMode="custom" />
      </Provider>,
    );
    expect(screen.getByLabelText(/Page 2/)).toBeInTheDocument();
  });
});
