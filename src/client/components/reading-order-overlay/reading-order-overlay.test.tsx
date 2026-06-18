// Reading Order overlay tests — Phase 7.5 C4 (Riley Wave 5c) + Wave 5d
// auto-detect-recompute honesty surface.
//
// Wave 5d focus: when David's reading-order engine returns the warning
// `'reading-order.recompute.no-extractor-wired'`, the overlay must surface
// a permanent honesty banner instead of silently pretending the recompute
// happened. This test stubs the bridge with a Result that carries the
// warning and asserts the banner renders.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import readingOrderReducer, {
  autoDetectedOrder,
  setReadingOrderActive,
} from '../../state/slices/reading-order-slice';
import uiReducer from '../../state/slices/ui-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import type { PDFDocumentModel } from '../../types/ipc-contract';

import { ReadingOrderOverlay } from './index';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 2,
  pages: [],
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      readingOrder: readingOrderReducer,
      ui: uiReducer,
      viewport: viewportReducer,
    },
  });
}

afterEach(() => {
  // Component listens on window scroll/resize — let React clean those up.
});

describe('ReadingOrderOverlay — auto-detect honesty banner (Wave 5d)', () => {
  it('renders the no-extractor banner when the slice carries the warning', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(setReadingOrderActive(true));
    store.dispatch(
      autoDetectedOrder({
        order: [],
        noExtractorWarning: 'reading-order.recompute.no-extractor-wired',
      }),
    );
    render(
      <Provider store={store}>
        <ReadingOrderOverlay />
      </Provider>,
    );
    const banner = screen.getByTestId('reading-order-recompute-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/auto-detect/i);
  });

  it('does NOT render the no-extractor banner when no warning carried', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(setReadingOrderActive(true));
    store.dispatch(autoDetectedOrder({ order: [], noExtractorWarning: null }));
    render(
      <Provider store={store}>
        <ReadingOrderOverlay />
      </Provider>,
    );
    expect(screen.queryByTestId('reading-order-recompute-banner')).toBeNull();
  });

  it('renders the Auto-detect button in the overlay toolbar', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(setReadingOrderActive(true));
    render(
      <Provider store={store}>
        <ReadingOrderOverlay />
      </Provider>,
    );
    // The button's accessible name comes from its aria-label
    // "Recompute reading order from page layout"; the visible label is
    // "Auto-detect from layout" — match the aria-label phrasing.
    const button = screen.getByRole('button', { name: /recompute/i });
    expect(button).toBeTruthy();
    expect(button.textContent).toMatch(/auto-detect/i);
  });
});
