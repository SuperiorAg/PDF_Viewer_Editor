// HelpModal — Vitest spec. Wave 30+ comprehensive expansion.
//
// Asserts:
//   1. Modal renders the title via ModalShell.
//   2. The tablist exposes every help section (13 tabs).
//   3. The default tab (Getting started) renders its intro + first subsections.
//   4. Clicking the Shortcuts tab renders the shortcut table with >= 30 rows
//      (the full shipped surface).
//   5. Arrow-right + arrow-left navigate the tablist (WAI-ARIA roving).
//   6. Close (footer + × button) dispatches closeHelpModal.
//   7. selectHelpModalOpen toggles via openHelpModal / closeHelpModal.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import { selectHelpModalOpen } from '../../../state/slices/ui-selectors';
import uiReducer, { closeHelpModal, openHelpModal } from '../../../state/slices/ui-slice';

import { HELP_TABS, findSection } from './help-content';

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

describe('HelpModal — Wave 30+ comprehensive expansion', () => {
  it('renders the title via the modal shell', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: /PDF Viewer & Editor — Help/i })).toBeInTheDocument();
  });

  it('exposes every help section as a tab in the tablist', () => {
    renderModal();
    const tablist = screen.getByRole('tablist', { name: /Help sections/i });
    const tabs = within(tablist).getAllByRole('tab');
    // 13 sections: gettingStarted, editing, annotations, forms, mailMerge,
    // signing, ocr, scan, export, shortcuts, trustFloor, troubleshooting,
    // about.
    expect(tabs).toHaveLength(HELP_TABS.length);
    expect(tabs).toHaveLength(13);
  });

  it('shows the Getting started section by default with its sub-headings', () => {
    renderModal();
    // The section heading text matches the tab label (titleKey === tabs.X).
    const tabpanel = screen.getByRole('tabpanel');
    // Several headings share text by design (e.g. "Open a PDF" appears as a
    // bullets-section heading AND a prose-limits heading). Use getAllByText
    // and assert at least one match per concept.
    expect(within(tabpanel).getAllByText(/Open a PDF/i).length).toBeGreaterThan(0);
    expect(within(tabpanel).getAllByText(/Navigate/i).length).toBeGreaterThan(0);
    expect(within(tabpanel).getAllByText(/Zoom and pan/i).length).toBeGreaterThan(0);
  });

  it('switches to the Shortcuts tab and renders the full shortcut table', () => {
    renderModal();
    const tab = screen.getByRole('tab', { name: /Keyboard shortcuts/i });
    fireEvent.click(tab);

    const table = screen.getByRole('table');
    const bodyRows = within(table).getAllByRole('row').slice(1); // drop thead
    expect(bodyRows.length).toBeGreaterThanOrEqual(30);

    // Spot-check critical rows including the new Ctrl+wheel cursor-zoom row.
    expect(within(table).getByText('Ctrl+O')).toBeInTheDocument();
    expect(within(table).getByText('Ctrl+S')).toBeInTheDocument();
    expect(within(table).getByText('F1')).toBeInTheDocument();
    expect(within(table).getByText('Ctrl+wheel')).toBeInTheDocument();
  });

  it('switches to the Honesty banner tab and renders the six trust-floor entries', () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: /Honesty banner/i }));
    // All six honesty headings should be present.
    expect(screen.getByText(/Telemetry is OFF by default/i)).toBeInTheDocument();
    expect(screen.getByText(/publish target is a placeholder/i)).toBeInTheDocument();
    expect(screen.getByText(/OCR can be wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/Signing trust floor/i)).toBeInTheDocument();
    expect(screen.getByText(/Export is best-effort/i)).toBeInTheDocument();
    expect(screen.getByText(/Spanish.*translation sample/i)).toBeInTheDocument();
  });

  it('renders the Mail merge tab as a numbered steps list', () => {
    renderModal();
    fireEvent.click(screen.getByRole('tab', { name: /Mail merge/i }));
    const list = screen.getByRole('list', { hidden: false }); // an <ol>
    // Steps live in the FIRST list inside the panel — confirm 5 list items.
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
  });

  it('switches tabs via ArrowRight / ArrowLeft (WAI-ARIA roving tabindex)', () => {
    renderModal();
    const first = screen.getByRole('tab', { name: /Getting started/i });
    first.focus();
    expect(first).toHaveAttribute('aria-selected', 'true');

    // Arrow-right advances to "Editing pages".
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const editing = screen.getByRole('tab', { name: /Editing pages/i });
    expect(editing).toHaveAttribute('aria-selected', 'true');

    // Arrow-left returns to "Getting started".
    fireEvent.keyDown(editing, { key: 'ArrowLeft' });
    expect(first).toHaveAttribute('aria-selected', 'true');
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

  it('help-content findSection() returns the matching descriptor', () => {
    expect(findSection('gettingStarted')?.id).toBe('gettingStarted');
    expect(findSection('shortcuts')?.id).toBe('shortcuts');
    expect(findSection('about')?.id).toBe('about');
  });
});
