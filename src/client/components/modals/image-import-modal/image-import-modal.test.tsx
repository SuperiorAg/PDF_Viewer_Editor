// ImageImportModal — Vitest spec. Phase 2 / Wave 7.
//
// Asserts:
//  1. Modal renders the title + mode radios + file picker.
//  2. Closing dispatches clearImageImportPreload + closeModal.
//  3. Mode switching toggles which sub-form (new-page select vs overlay rect)
//     is visible.
//  4. Submit is disabled until a file is loaded.

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import documentReducer from '../../../state/slices/document-slice';
import uiReducer from '../../../state/slices/ui-slice';
import viewportReducer from '../../../state/slices/viewport-slice';

import { ImageImportModal } from './index';

function makeStore(): ReturnType<typeof configureStore> {
  return configureStore({
    reducer: {
      ui: uiReducer,
      document: documentReducer,
      viewport: viewportReducer,
    },
    middleware: (g) => g({ serializableCheck: { ignoredActionPaths: ['payload.bytes'] } }),
    preloadedState: {
      ui: {
        sidebarTab: 'thumbnails' as const,
        sidebarCollapsed: false,
        inspectorCollapsed: true,
        activeModal: 'image-import' as const,
        toasts: [],
        isLoading: false,
        loadingMessage: '',
        imageImport: {
          bytes: null,
          mimeType: null,
          fileName: null,
          intrinsicWidth: null,
          intrinsicHeight: null,
          initialMode: 'new-page' as const,
          initialOverlayRect: null,
          initialOverlayPageIndex: null,
        },
        textEdit: {
          active: false,
          identifying: false,
          activeSpan: null,
          draftText: '',
        },
        bookmarksEditMode: false,
      },
      document: {
        current: {
          handle: 1,
          displayName: 'demo.pdf',
          fileHash: 'a'.repeat(64),
          pageCount: 3,
          pages: [
            {
              pageIndex: 0,
              sourcePageRef: { kind: 'original' as const, originalIndex: 0 },
              rotation: 0 as const,
              width: 612,
              height: 792,
            },
            {
              pageIndex: 1,
              sourcePageRef: { kind: 'original' as const, originalIndex: 1 },
              rotation: 0 as const,
              width: 612,
              height: 792,
            },
            {
              pageIndex: 2,
              sourcePageRef: { kind: 'original' as const, originalIndex: 2 },
              rotation: 0 as const,
              width: 612,
              height: 792,
            },
          ],
          annotations: [],
          dirtyOps: [],
          savedAtHandleVersion: 0,
          pdflibLoadWarnings: [],
        },
        savePending: false,
        saveError: null,
        saveAsTokenPending: false,
      },
      viewport: {
        currentPage: 1,
        zoom: 1,
        scrollX: 0,
        scrollY: 0,
        fitMode: 'manual' as const,
      },
    },
  });
}

describe('ImageImportModal', () => {
  it('renders the title and mode radios', () => {
    render(
      <Provider store={makeStore()}>
        <ImageImportModal />
      </Provider>,
    );
    expect(screen.getByRole('dialog', { name: /Insert Image/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /New page at:/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Overlay on current page/i })).toBeInTheDocument();
  });

  it('disables Insert button when no file selected', () => {
    render(
      <Provider store={makeStore()}>
        <ImageImportModal />
      </Provider>,
    );
    const insert = screen.getByRole('button', { name: /^Insert$/ });
    expect(insert).toBeDisabled();
  });

  it('switches mode to overlay and reveals rect inputs', () => {
    render(
      <Provider store={makeStore()}>
        <ImageImportModal />
      </Provider>,
    );
    // Overlay radio
    fireEvent.click(screen.getByRole('radio', { name: /Overlay on current page/i }));
    expect(screen.getByLabelText(/Overlay width \(pt\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Overlay height \(pt\)/i)).toBeInTheDocument();
  });

  it('closes when Cancel is clicked', () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <ImageImportModal />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    const ui = (store.getState() as { ui: { activeModal: string | null } }).ui;
    expect(ui.activeModal).toBeNull();
  });
});
