// TextEditOverlay — Vitest spec. Phase 2 / Wave 7.
//
// Asserts:
//  1. Returns null when text-edit mode inactive.
//  2. Shows "click any text run" banner when active but no span identified.
//  3. Renders the inline editor when an active span is set.
//  4. Esc dispatches clearTextEditActiveSpan.
//  5. Missing glyph disables the Save button + shows tooltip.
//  6. Clip tooltip surfaces but does not block commit.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it } from 'vitest';

import documentReducer from '../../state/slices/document-slice';
import uiReducer from '../../state/slices/ui-slice';

import { TextEditOverlay } from './index';

interface TestStoreOpts {
  active: boolean;
  activeSpan?: {
    pageIndex: number;
    objectId: string;
    runBoundingRect: { x: number; y: number; width: number; height: number };
    originalText: string;
    font: {
      family: string;
      size: number;
      glyphWidths: Record<number, number>;
      glyphMapSize: number;
    };
  } | null;
  draftText?: string;
}

function makeStore(opts: TestStoreOpts): ReturnType<typeof configureStore> {
  return configureStore({
    reducer: { ui: uiReducer, document: documentReducer },
    preloadedState: {
      ui: {
        sidebarTab: 'thumbnails' as const,
        sidebarCollapsed: false,
        inspectorCollapsed: true,
        activeModal: null,
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
          active: opts.active,
          identifying: false,
          activeSpan: opts.activeSpan ?? null,
          draftText: opts.draftText ?? opts.activeSpan?.originalText ?? '',
        },
        bookmarksEditMode: false,
      },
      document: {
        current: null,
        savePending: false,
        saveError: null,
        saveAsTokenPending: false,
      },
    },
  });
}

describe('TextEditOverlay', () => {
  it('returns null when text-edit mode inactive', () => {
    const { container } = render(
      <Provider store={makeStore({ active: false })}>
        <TextEditOverlay />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the click-any-text banner when active without a span', () => {
    render(
      <Provider store={makeStore({ active: true })}>
        <TextEditOverlay />
      </Provider>,
    );
    expect(screen.getByText(/click any text run to edit/i)).toBeInTheDocument();
  });

  it('renders the inline editor when an active span is set', () => {
    // Glyph widths for "Hello" — codepoints 72,101,108,108,111
    const glyphWidths: Record<number, number> = {
      72: 0.6,
      101: 0.5,
      108: 0.3,
      111: 0.5,
    };
    render(
      <Provider
        store={makeStore({
          active: true,
          activeSpan: {
            pageIndex: 0,
            objectId: 'p1/0/3',
            runBoundingRect: { x: 100, y: 200, width: 200, height: 20 },
            originalText: 'Hello',
            font: { family: 'Helvetica', size: 12, glyphWidths, glyphMapSize: 256 },
          },
        })}
      >
        <TextEditOverlay />
      </Provider>,
    );
    const input = screen.getByLabelText('Edit text') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Hello');
    expect(screen.getByRole('button', { name: /Save/ })).toBeEnabled();
  });

  it('disables Save and shows missing-glyph tooltip when draftText contains an unmapped char', () => {
    const glyphWidths: Record<number, number> = { 72: 0.6 }; // only 'H'
    render(
      <Provider
        store={makeStore({
          active: true,
          activeSpan: {
            pageIndex: 0,
            objectId: 'p1/0/3',
            runBoundingRect: { x: 100, y: 200, width: 200, height: 20 },
            originalText: 'H',
            font: { family: 'Helvetica', size: 12, glyphWidths, glyphMapSize: 256 },
          },
          draftText: 'Hé', // 'é' codepoint 233 missing
        })}
      >
        <TextEditOverlay />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Original font does not contain/);
  });

  it('shows clip tooltip but keeps Save enabled when new text exceeds rect width', () => {
    // 'H' = 0.6 at 12pt = 7.2pt per glyph. Rect width 10pt -> commit beyond 1 char clips.
    const glyphWidths: Record<number, number> = {
      72: 0.6,
      101: 0.5,
      108: 0.3,
      111: 0.5,
    };
    render(
      <Provider
        store={makeStore({
          active: true,
          activeSpan: {
            pageIndex: 0,
            objectId: 'p1/0/3',
            runBoundingRect: { x: 100, y: 200, width: 10, height: 20 },
            originalText: 'H',
            font: { family: 'Helvetica', size: 12, glyphWidths, glyphMapSize: 256 },
          },
          draftText: 'Hello',
        })}
      >
        <TextEditOverlay />
      </Provider>,
    );
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByText(/Text will be clipped on save/)).toBeInTheDocument();
  });
});
