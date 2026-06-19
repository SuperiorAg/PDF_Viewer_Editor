// Font swap modal tests — Phase 7.5 Wave 6 (Riley).
// Confirms scope radio + swap fires the engine; warnings render verbatim.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ok } from '../../../shared/result';
import documentReducer, { setDocument } from '../../state/slices/document-slice';
import fontSwapReducer, {
  openFontSwap,
  setEmbeddedFonts,
  setSwapResult,
} from '../../state/slices/font-swap-slice';
import uiReducer from '../../state/slices/ui-slice';
import { type PDFDocumentModel } from '../../types/ipc-contract';

import { FontSwapModal } from './index';

const DOC: PDFDocumentModel = {
  handle: 99,
  displayName: 'doc.pdf',
  fileHash: 'hash',
  pageCount: 1,
  pages: [],
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

function makeStore() {
  return configureStore({
    reducer: {
      fontSwap: fontSwapReducer,
      document: documentReducer,
      ui: uiReducer,
    },
  });
}

function stubPdfApi(swapResult?: { fontsRewritten: number; warnings: string[] }) {
  const swap = vi
    .fn()
    .mockResolvedValue(
      ok(swapResult ?? { fontsRewritten: 3, warnings: ['glyph not in subset; substituted'] }),
    );
  vi.stubGlobal('pdfApi', {
    pdf: {
      listEmbeddedFonts: () =>
        Promise.resolve(
          ok({
            fonts: [
              { name: 'Arial', isEmbedded: true, isSubset: false, pageRefs: [0] },
              { name: 'XPDFLZ+Helvetica-Bold', isEmbedded: true, isSubset: true, pageRefs: [0] },
            ],
          }),
        ),
      swapEmbeddedFont: swap,
    },
  });
  return { swap };
}

describe('FontSwapModal', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('returns null when closed', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    const { container } = render(
      <Provider store={store}>
        <FontSwapModal />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders empty-fonts banner when list is empty', async () => {
    // Stub specific to this test: engine returns zero embedded fonts.
    vi.stubGlobal('pdfApi', {
      pdf: {
        listEmbeddedFonts: () => Promise.resolve(ok({ fonts: [] })),
        swapEmbeddedFont: vi.fn(),
      },
    });
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(openFontSwap(undefined));
    render(
      <Provider store={store}>
        <FontSwapModal />
      </Provider>,
    );
    expect(await screen.findByText(/No embedded fonts detected/i)).toBeTruthy();
  });

  test('renders embedded fonts in the From picker', async () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(openFontSwap(undefined));
    const { container } = render(
      <Provider store={store}>
        <FontSwapModal />
      </Provider>,
    );
    // The mount-time effect fetches embedded fonts via the stubbed API.
    // Wait for the picker to settle (loadingFonts -> false) then assert on
    // the option list.
    const select = await screen.findByRole('combobox', { name: /From/i });
    const options = Array.from(
      (select as HTMLSelectElement).querySelectorAll<HTMLOptionElement>('option'),
    );
    const labels = options.map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes('Arial'))).toBe(true);
    expect(labels.some((l) => l.includes('XPDFLZ+Helvetica-Bold'))).toBe(true);
    expect(labels.some((l) => l.includes('(subset)'))).toBe(true);
    // Eliminate unused-warning for the container destructure.
    void container;
  });

  test('scope radio change updates slice', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(openFontSwap(undefined));
    store.dispatch(
      setEmbeddedFonts([{ name: 'Arial', isEmbedded: true, isSubset: false, pageRefs: [0] }]),
    );
    render(
      <Provider store={store}>
        <FontSwapModal />
      </Provider>,
    );
    const thisPage = screen.getByRole('radio', { name: /This page/i });
    fireEvent.click(thisPage);
    expect(store.getState().fontSwap.scope).toBe('this-page');
  });

  test('Replace fires the engine with the chosen from/to names', async () => {
    const { swap } = stubPdfApi();
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(openFontSwap({ fromFontName: 'Arial' }));
    render(
      <Provider store={store}>
        <FontSwapModal />
      </Provider>,
    );
    // Wait for the mount-time fetch to settle (listEmbeddedFontsThunk
    // dispatched setLoadingFonts(true) which disables the Replace button
    // temporarily).
    const replace = await screen.findByRole('button', { name: 'Replace' });
    fireEvent.click(replace);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(swap).toHaveBeenCalledWith({
      handle: 99,
      fromFontName: 'Arial',
      toFontName: 'Helvetica',
    });
  });

  test('renders engine warnings verbatim in the honesty banner', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(openFontSwap({ fromFontName: 'Arial' }));
    store.dispatch(
      setEmbeddedFonts([{ name: 'Arial', isEmbedded: true, isSubset: false, pageRefs: [0] }]),
    );
    store.dispatch(
      setSwapResult({ fontsRewritten: 3, warnings: ['glyph not in subset; substituted'] }),
    );
    render(
      <Provider store={store}>
        <FontSwapModal />
      </Provider>,
    );
    expect(screen.getByText(/glyph not in subset; substituted/i)).toBeTruthy();
  });
});
