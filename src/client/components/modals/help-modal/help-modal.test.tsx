// HelpModal — Vitest spec. Phase 1.1 R-1.1.
//
// Asserts:
//   1. Modal renders title + shortcuts table + Phase 1 limitations + roadmap.
//   2. Shortcut table has the full row set.
//   3. Close button dispatches closeHelpModal (state.ui.activeModal -> null).
//   4. selectHelpModalOpen flips true when openHelpModal dispatched.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import { selectHelpModalOpen } from '../../../state/slices/ui-selectors';
import uiReducer, { closeHelpModal, openHelpModal } from '../../../state/slices/ui-slice';

import { HelpModal } from './index';

function makeStore(): ReturnType<typeof configureStore> {
  return configureStore({
    reducer: { ui: uiReducer },
    preloadedState: {
      ui: {
        sidebarTab: 'thumbnails' as const,
        sidebarCollapsed: false,
        inspectorCollapsed: true,
        activeModal: 'help' as const,
        toasts: [],
        isLoading: false,
        loadingMessage: '',
      },
    },
  });
}

function renderModal(store = makeStore()): {
  store: ReturnType<typeof configureStore>;
  rendered: ReturnType<typeof render>;
} {
  const rendered = render(
    <Provider store={store}>
      <HelpModal />
    </Provider>,
  );
  return { store, rendered };
}

describe('HelpModal', () => {
  it('renders the title via the modal shell', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: /PDF Viewer & Editor — Help/i })).toBeInTheDocument();
  });

  it('renders the keyboard shortcuts table with multiple rows', () => {
    renderModal();
    const heading = screen.getByRole('heading', { name: /Keyboard shortcuts/i });
    expect(heading).toBeInTheDocument();

    const table = screen.getByRole('table');
    const bodyRows = within(table).getAllByRole('row').slice(1); // drop thead row
    expect(bodyRows.length).toBeGreaterThanOrEqual(30);

    // Spot-check critical rows: Ctrl+O (Open), Ctrl+S (Save), F1 (Help).
    expect(within(table).getByText('Ctrl+O')).toBeInTheDocument();
    expect(within(table).getByText('Ctrl+S')).toBeInTheDocument();
    expect(within(table).getByText('F1')).toBeInTheDocument();
  });

  it('renders the Phase 1 limitations section with the Save fidelity caveat first', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: /Phase 1 limitations/i })).toBeInTheDocument();
    // The Save fidelity bullet must mention "valid PDF" + "Phase 2".
    expect(screen.getByText(/Save fidelity:/i)).toBeInTheDocument();
    expect(screen.getByText(/Phase 2 ships the edit-replay engine/i)).toBeInTheDocument();
  });

  it('renders the "Coming in later phases" roadmap', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: /Coming in later phases/i })).toBeInTheDocument();
    expect(screen.getByText(/Phase 3:/)).toBeInTheDocument();
    expect(screen.getByText(/Phase 7:/)).toBeInTheDocument();
  });

  it('closes (dispatches closeHelpModal) when the footer Close button is clicked', () => {
    const { store } = renderModal();
    expect(selectHelpModalOpen(store.getState() as never)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));

    expect(selectHelpModalOpen(store.getState() as never)).toBe(false);
  });

  it('closes when the modal-shell × button is clicked', () => {
    const { store } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Close dialog/i }));
    expect(selectHelpModalOpen(store.getState() as never)).toBe(false);
  });

  it('openHelpModal / closeHelpModal action creators toggle selectHelpModalOpen', () => {
    const store = configureStore({ reducer: { ui: uiReducer } });
    expect(selectHelpModalOpen(store.getState() as never)).toBe(false);
    store.dispatch(openHelpModal());
    expect(selectHelpModalOpen(store.getState() as never)).toBe(true);
    store.dispatch(closeHelpModal());
    expect(selectHelpModalOpen(store.getState() as never)).toBe(false);
  });
});
