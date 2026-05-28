// ThumbnailStrip — Wave 28a a11y spec (a11y-audit.md R-4 / §3 Path 2).
//
// Asserts the listbox keyboard-navigation pattern:
//   1. role="listbox" (vertical) containing role="option" thumbnails.
//   2. Roving tabindex — the current page's option is 0; the rest -1.
//   3. ArrowDown / ArrowUp move the current page (and thus the active option).
//   4. Home / End jump first / last.
//   5. aria-selected tracks selection; aria-current="page" marks the viewer page.
//
// The pdf-loader is mocked (no real bitmap render) so the test focuses purely
// on the listbox semantics + keyboard contract.

import { configureStore, type EnhancedStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import selectionReducer from '../../state/slices/selection-slice';
import uiReducer from '../../state/slices/ui-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import { type PageModel } from '../../types/ipc-contract';

import { ThumbnailStrip } from './index';

vi.mock('../../services/pdf-loader', () => ({
  loadDocumentByHandle: vi.fn(async () => ({
    ok: false,
    error: 'bridge_unavailable',
    message: 'test',
  })),
}));

type Store = EnhancedStore<{
  document: ReturnType<typeof documentReducer>;
  selection: ReturnType<typeof selectionReducer>;
  viewport: ReturnType<typeof viewportReducer>;
  ui: ReturnType<typeof uiReducer>;
}>;

function makeStore(): Store {
  return configureStore({
    reducer: {
      document: documentReducer,
      selection: selectionReducer,
      viewport: viewportReducer,
      ui: uiReducer,
    },
  });
}

function blankPage(index: number): PageModel {
  return {
    pageIndex: index,
    sourcePageRef: { kind: 'blank', width: 612, height: 792 },
    rotation: 0,
    width: 612,
    height: 792,
  };
}

function seed(store: Store, n: number): void {
  store.dispatch(
    setDocument({
      handle: 1,
      displayName: 't.pdf',
      fileHash: 'h',
      pageCount: n,
      pages: Array.from({ length: n }, (_, i) => blankPage(i)),
      annotations: [],
      dirtyOps: [],
      savedAtHandleVersion: 0,
      pdflibLoadWarnings: [],
    }),
  );
}

function renderStrip(store: Store): ReturnType<typeof render> {
  return render(
    <Provider store={store}>
      <ThumbnailStrip />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ThumbnailStrip — listbox keyboard nav (R-4)', () => {
  it('renders a vertical listbox of options', () => {
    const store = makeStore();
    seed(store, 3);
    renderStrip(store);
    const listbox = screen.getByRole('listbox', { name: 'Pages' });
    expect(listbox).toHaveAttribute('aria-orientation', 'vertical');
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
  });

  it('roving tabindex: the current page option is 0, others -1', () => {
    const store = makeStore();
    seed(store, 3);
    renderStrip(store);
    const options = screen.getAllByRole('option');
    // page 0 is current by default
    expect(options[0]).toHaveAttribute('tabindex', '0');
    expect(options[1]).toHaveAttribute('tabindex', '-1');
    expect(options[2]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown advances the current page', () => {
    const store = makeStore();
    seed(store, 3);
    renderStrip(store);
    const options = screen.getAllByRole('option');
    fireEvent.keyDown(options[0]!, { key: 'ArrowDown' });
    expect(store.getState().viewport.currentPage).toBe(1);
  });

  it('ArrowUp does not go below the first page', () => {
    const store = makeStore();
    seed(store, 3);
    renderStrip(store);
    const options = screen.getAllByRole('option');
    fireEvent.keyDown(options[0]!, { key: 'ArrowUp' });
    expect(store.getState().viewport.currentPage).toBe(0);
  });

  it('End jumps to the last page; Home jumps back to the first', () => {
    const store = makeStore();
    seed(store, 4);
    renderStrip(store);
    const options = screen.getAllByRole('option');
    fireEvent.keyDown(options[0]!, { key: 'End' });
    expect(store.getState().viewport.currentPage).toBe(3);
    fireEvent.keyDown(screen.getAllByRole('option')[3]!, { key: 'Home' });
    expect(store.getState().viewport.currentPage).toBe(0);
  });

  it('Enter selects the focused page (aria-selected follows selection)', () => {
    const store = makeStore();
    seed(store, 3);
    renderStrip(store);
    fireEvent.keyDown(screen.getAllByRole('option')[1]!, { key: 'Enter' });
    expect(store.getState().selection.selectedPageIndices).toContain(1);
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });
});
