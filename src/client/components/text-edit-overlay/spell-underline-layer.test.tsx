// SpellUnderlineLayer + useSpellCheckTextEdit — Vitest spec.
// Post-v0.8.0 follow-up (Riley, 2026-06-18, Wave 6 deferral close).
//
// Coverage:
//   1. Renders nothing when spell-check is disabled.
//   2. Renders nothing when no misspellings cached for the (pageIndex, objectId).
//   3. Renders one underline span per cached misspelling at the right offset.
//   4. Right-click on an underline dispatches `showSpellSuggestionPopup`
//      with the misspelling + anchor.
//   5. Disabled state suppresses both render AND the debounced dispatch.
//   6. Add-to-dictionary path: when the slice clears the cache (via
//      `addUserDictionaryWord`), the underline disappears on the next render.
//
// We test the layer + the hook through the parent `TextEditOverlay` so the
// integration is exercised end-to-end. The api proxy (`api.spell.checkText`)
// is stubbed via `window.pdfApi.spell.checkText`.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer from '../../state/slices/document-slice';
import spellCheckReducer, {
  cacheSpellCheck,
  setSpellCheckEnabled,
} from '../../state/slices/spell-check-slice';
import uiReducer from '../../state/slices/ui-slice';

import { TextEditOverlay } from './index';

const GLYPH_WIDTHS_HELLO: Record<number, number> = {
  72: 0.6, // H
  101: 0.5, // e
  108: 0.3, // l
  111: 0.5, // o
};

const ACTIVE_SPAN = {
  pageIndex: 0,
  objectId: 'p1/0/3',
  runBoundingRect: { x: 100, y: 200, width: 200, height: 20 },
  originalText: 'Hello',
  font: { family: 'Helvetica', size: 12, glyphWidths: GLYPH_WIDTHS_HELLO, glyphMapSize: 256 },
};

function makeStore(opts: { draftText?: string; enabled?: boolean } = {}) {
  return configureStore({
    reducer: { ui: uiReducer, document: documentReducer, spellCheck: spellCheckReducer },
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
          active: true,
          identifying: false,
          activeSpan: ACTIVE_SPAN,
          draftText: opts.draftText ?? ACTIVE_SPAN.originalText,
        },
        bookmarksEditMode: false,
      },
      document: {
        current: null,
        savePending: false,
        saveError: null,
        saveAsTokenPending: false,
      },
      spellCheck: {
        locale: 'en-US',
        enabled: opts.enabled ?? true,
        availableLocales: [],
        loadingLocales: false,
        lastLocalesError: null,
        userDictionary: {},
        loadingUserDictionary: false,
        lastUserDictionaryError: null,
        recentChecks: {},
        settingsOpen: false,
        popup: {
          pageIndex: null,
          objectId: null,
          word: '',
          suggestions: [],
          anchorX: 0,
          anchorY: 0,
        },
        ignoredOnce: [],
      },
    },
  });
}

describe('SpellUnderlineLayer (via TextEditOverlay)', () => {
  let originalPdfApi: unknown;

  beforeEach(() => {
    originalPdfApi = (globalThis as { pdfApi?: unknown }).pdfApi;
    // Stub checkText so the debounced dispatch never throws.
    const stubResponse = vi.fn(async () => ({
      ok: true as const,
      value: { misspellings: [] },
    }));
    (globalThis as { pdfApi?: unknown }).pdfApi = {
      spell: { checkText: stubResponse },
      pdf: {},
      fs: {},
      dialog: {},
      export: {},
    };
  });

  afterEach(() => {
    (globalThis as { pdfApi?: unknown }).pdfApi = originalPdfApi;
  });

  it('renders nothing when no misspellings are cached', () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <TextEditOverlay />
      </Provider>,
    );
    // No spell-underline buttons should exist.
    expect(screen.queryAllByRole('button', { name: /Misspelling:/i })).toHaveLength(0);
  });

  it('renders one underline per cached misspelling', () => {
    const store = makeStore({ draftText: 'Helo wrld' });
    // Seed the cache with two misspellings (offsets 0 and 5).
    store.dispatch(
      cacheSpellCheck({
        pageIndex: 0,
        objectId: 'p1/0/3',
        text: 'Helo wrld',
        misspellings: [
          { offset: 0, length: 4, word: 'Helo', suggestions: ['Hello', 'Halo'] },
          { offset: 5, length: 4, word: 'wrld', suggestions: ['world'] },
        ],
      }),
    );
    render(
      <Provider store={store}>
        <TextEditOverlay />
      </Provider>,
    );
    const underlines = screen.getAllByRole('button', { name: /Misspelling:/i });
    expect(underlines).toHaveLength(2);
    expect(underlines[0]).toHaveAccessibleName('Misspelling: Helo');
    expect(underlines[1]).toHaveAccessibleName('Misspelling: wrld');
  });

  it('right-click on an underline dispatches showSpellSuggestionPopup', () => {
    const store = makeStore({ draftText: 'Helo wrld' });
    store.dispatch(
      cacheSpellCheck({
        pageIndex: 0,
        objectId: 'p1/0/3',
        text: 'Helo wrld',
        misspellings: [{ offset: 0, length: 4, word: 'Helo', suggestions: ['Hello'] }],
      }),
    );
    render(
      <Provider store={store}>
        <TextEditOverlay />
      </Provider>,
    );
    const underline = screen.getByRole('button', { name: 'Misspelling: Helo' });
    fireEvent.contextMenu(underline);
    const popup = store.getState().spellCheck.popup;
    expect(popup.word).toBe('Helo');
    expect(popup.suggestions).toEqual(['Hello']);
    expect(popup.pageIndex).toBe(0);
    expect(popup.objectId).toBe('p1/0/3');
    // anchor base = runBoundingRect.x = 100 + leading offset (0 for offset 0).
    expect(popup.anchorX).toBe(100);
    // anchorY = runBoundingRect.y (200) + height (20) = 220.
    expect(popup.anchorY).toBe(220);
  });

  it('disabled spell-check suppresses both render and the debounced dispatch', async () => {
    const store = makeStore({ draftText: 'Helo wrld', enabled: false });
    // Seed cache (would render if enabled).
    store.dispatch(
      cacheSpellCheck({
        pageIndex: 0,
        objectId: 'p1/0/3',
        text: 'Helo wrld',
        misspellings: [{ offset: 0, length: 4, word: 'Helo', suggestions: ['Hello'] }],
      }),
    );
    const stub = (globalThis as { pdfApi?: { spell?: { checkText?: ReturnType<typeof vi.fn> } } })
      .pdfApi!.spell!.checkText!;
    render(
      <Provider store={store}>
        <TextEditOverlay />
      </Provider>,
    );
    expect(screen.queryAllByRole('button', { name: /Misspelling:/i })).toHaveLength(0);
    // Drain the debounce timer + microtask queue.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    // checkText should not have been invoked.
    expect(stub).not.toHaveBeenCalled();
  });

  it('add-to-dictionary clears recentChecks; underline disappears on next render', () => {
    const store = makeStore({ draftText: 'Helo wrld' });
    store.dispatch(
      cacheSpellCheck({
        pageIndex: 0,
        objectId: 'p1/0/3',
        text: 'Helo wrld',
        misspellings: [{ offset: 0, length: 4, word: 'Helo', suggestions: ['Hello'] }],
      }),
    );
    const { rerender } = render(
      <Provider store={store}>
        <TextEditOverlay />
      </Provider>,
    );
    expect(screen.getAllByRole('button', { name: /Misspelling:/i })).toHaveLength(1);
    // Slice invalidates the cache when a word is added to the dictionary.
    act(() => {
      store.dispatch({
        type: 'spellCheck/addUserDictionaryWord',
        payload: { locale: 'en-US', word: 'Helo' },
      });
    });
    rerender(
      <Provider store={store}>
        <TextEditOverlay />
      </Provider>,
    );
    expect(screen.queryAllByRole('button', { name: /Misspelling:/i })).toHaveLength(0);
  });

  it('toggling spell-check off clears the popup + cache and hides underlines', () => {
    const store = makeStore({ draftText: 'Helo wrld' });
    store.dispatch(
      cacheSpellCheck({
        pageIndex: 0,
        objectId: 'p1/0/3',
        text: 'Helo wrld',
        misspellings: [{ offset: 0, length: 4, word: 'Helo', suggestions: ['Hello'] }],
      }),
    );
    const { rerender } = render(
      <Provider store={store}>
        <TextEditOverlay />
      </Provider>,
    );
    expect(screen.getAllByRole('button', { name: /Misspelling:/i })).toHaveLength(1);
    act(() => {
      store.dispatch(setSpellCheckEnabled(false));
    });
    rerender(
      <Provider store={store}>
        <TextEditOverlay />
      </Provider>,
    );
    expect(screen.queryAllByRole('button', { name: /Misspelling:/i })).toHaveLength(0);
  });
});
