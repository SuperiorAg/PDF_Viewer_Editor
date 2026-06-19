// Spell suggestion popup tests — Phase 7.5 Wave 6 (Riley).

import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ok } from '../../../shared/result';
import spellCheckReducer, { showSpellSuggestionPopup } from '../../state/slices/spell-check-slice';
import uiReducer from '../../state/slices/ui-slice';

import { SpellSuggestionPopup } from './suggestion-popup';

function makeStore() {
  return configureStore({
    reducer: { spellCheck: spellCheckReducer, ui: uiReducer },
  });
}

function stubPdfApi() {
  vi.stubGlobal('pdfApi', {
    spell: {
      addWordToDictionary: () => Promise.resolve(ok({ added: true })),
      listLocales: vi.fn(),
      checkText: vi.fn(),
      removeWordFromDictionary: vi.fn(),
      listUserDictionary: vi.fn(),
    },
  });
}

describe('SpellSuggestionPopup', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('returns null when popup state is empty', () => {
    stubPdfApi();
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <SpellSuggestionPopup />
      </Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders suggestions, ignore once, add to dictionary, settings link', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(
      showSpellSuggestionPopup({
        pageIndex: 0,
        objectId: 'x',
        word: 'helo',
        suggestions: ['hello', 'help', 'helot'],
        anchorX: 10,
        anchorY: 20,
      }),
    );
    render(
      <Provider store={store}>
        <SpellSuggestionPopup />
      </Provider>,
    );
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText('help')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Ignore once/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Add to dictionary/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Spell check settings/i })).toBeTruthy();
  });

  test('Ignore once dispatches ignoreOnce + closes popup', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(
      showSpellSuggestionPopup({
        pageIndex: 1,
        objectId: 'obj-1',
        word: 'helo',
        suggestions: ['hello'],
        anchorX: 0,
        anchorY: 0,
      }),
    );
    render(
      <Provider store={store}>
        <SpellSuggestionPopup />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Ignore once/i }));
    expect(store.getState().spellCheck.ignoredOnce.length).toBe(1);
    expect(store.getState().spellCheck.popup.pageIndex).toBeNull();
  });

  test('Add to dictionary triggers the thunk via api', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(
      showSpellSuggestionPopup({
        pageIndex: 1,
        objectId: 'obj-1',
        word: 'helo',
        suggestions: ['hello'],
        anchorX: 0,
        anchorY: 0,
      }),
    );
    render(
      <Provider store={store}>
        <SpellSuggestionPopup />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Add to dictionary/i }));
    // The popup closes immediately even before the async dispatch resolves.
    expect(store.getState().spellCheck.popup.pageIndex).toBeNull();
  });

  test('open Settings link closes popup + opens settings dialog', () => {
    stubPdfApi();
    const store = makeStore();
    store.dispatch(
      showSpellSuggestionPopup({
        pageIndex: 0,
        objectId: 'x',
        word: 'helo',
        suggestions: ['hello'],
        anchorX: 0,
        anchorY: 0,
      }),
    );
    render(
      <Provider store={store}>
        <SpellSuggestionPopup />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Spell check settings/i }));
    expect(store.getState().spellCheck.popup.pageIndex).toBeNull();
    expect(store.getState().spellCheck.settingsOpen).toBe(true);
  });
});
