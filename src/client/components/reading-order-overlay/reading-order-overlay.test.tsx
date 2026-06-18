// Reading Order overlay tests — Phase 7.5 C4 (Riley Wave 5c) + Wave 5d
// auto-detect-recompute honesty surface + Wave 5d follow-up focus.
//
// Wave 5d focus: when David's reading-order engine returns the warning
// `'reading-order.recompute.no-extractor-wired'`, the overlay must surface
// a permanent honesty banner instead of silently pretending the recompute
// happened. The Wave 5d follow-up (Riley) switched the slice's detection
// from substring match to FULL equality against the
// READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING constant. This test stubs
// the slice with the canonical constant (via the renderer-side mirror)
// and asserts the banner renders.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it } from 'vitest';

import { READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING } from '../../constants/reading-order';
import documentReducer, { setDocument } from '../../state/slices/document-slice';
import readingOrderReducer, {
  autoDetectedOrder,
  focusEntry,
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
  it('renders the no-extractor banner when the slice carries the warning (via the canonical constant)', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(setReadingOrderActive(true));
    // Wave 5d follow-up: stub the slice with the canonical mirror
    // constant. The overlay banner reads from the slice; the
    // substring-vs-equality change lives in the thunk's detection
    // (covered by the constants/reading-order.test.ts drift gate +
    // the slice tests above), not the overlay itself.
    store.dispatch(
      autoDetectedOrder({
        order: [],
        noExtractorWarning: READING_ORDER_RECOMPUTE_NO_EXTRACTOR_WARNING,
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

  // Wave 5d follow-up (Riley) — focus action wiring. The quick-fix
  // dispatcher in AccessibilityCheckPanel calls focusEntry(targetNodeId)
  // alongside setReadingOrderActive(true); the slice records the id and
  // a downstream re-render of any matching badge would paint the
  // focused modifier. The slice contract is asserted in
  // reading-order-slice.test.ts; this overlay test only confirms the
  // overlay renders successfully when focus is active (no badges yet
  // because the test fixture has no order entries, but the slice state
  // doesn't crash the render path).
  it('renders the overlay when a quick-fix focus is active (no order entries)', () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    store.dispatch(setReadingOrderActive(true));
    store.dispatch(focusEntry('struct:42'));
    expect(store.getState().readingOrder.focusedEntryId).toBe('struct:42');
    render(
      <Provider store={store}>
        <ReadingOrderOverlay />
      </Provider>,
    );
    // The control bar still renders; no badges because the order array
    // is empty in this fixture. The slice's focusedEntryId persists.
    expect(screen.getByRole('region', { name: /reading order/i })).toBeTruthy();
  });
});
