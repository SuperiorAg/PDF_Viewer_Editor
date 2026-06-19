// Spell Check Settings dialog tests — Phase 7.5 Wave 6 (Riley).
// Confirms es-ES renders DISABLED with the verbatim reason string per
// P7.5-L-10. Also covers add-word + close interactions.

import { configureStore } from '@reduxjs/toolkit';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ok } from '../../../shared/result';
import spellCheckReducer, {
  setAvailableLocales,
  setSpellCheckSettingsOpen,
  setUserDictionary,
} from '../../state/slices/spell-check-slice';
import uiReducer from '../../state/slices/ui-slice';

import { SpellCheckSettingsDialog } from './settings-dialog';

// The verbatim reason David's locale-loader returns for es-ES (must match
// src/main/spell/locale-loader.ts SPELL_LOCALES[1].reason).
const ES_ES_REASON =
  'Spanish dictionary not available in this build — Hunspell es-ES is GPL-3/LGPL-3/MPL-1.1 (per npm registry vet 2026-06-18), which does not meet the project policy of MIT/Apache/BSD permissive-only.';

function makeStore() {
  const store = configureStore({
    reducer: { spellCheck: spellCheckReducer, ui: uiReducer },
  });
  store.dispatch(setSpellCheckSettingsOpen(true));
  store.dispatch(
    setAvailableLocales([
      { id: 'en-US', available: true },
      { id: 'es-ES', available: false, reason: ES_ES_REASON },
    ]),
  );
  store.dispatch(setUserDictionary({ locale: 'en-US', words: ['foo', 'bar'] }));
  return store;
}

function stubPdfApi(): void {
  vi.stubGlobal('pdfApi', {
    spell: {
      listLocales: () =>
        Promise.resolve(
          ok({
            locales: [
              { id: 'en-US', available: true },
              { id: 'es-ES', available: false, reason: ES_ES_REASON },
            ],
          }),
        ),
      listUserDictionary: () => Promise.resolve(ok({ words: ['foo'] })),
      checkText: vi.fn(),
      addWordToDictionary: vi.fn(),
      removeWordFromDictionary: vi.fn(),
    },
  });
}

describe('SpellCheckSettingsDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('renders es-ES disabled with the verbatim license reason', () => {
    stubPdfApi();
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <SpellCheckSettingsDialog />
      </Provider>,
    );
    const esInput = container.querySelector(
      'input[type="radio"][value="es-ES"]',
    ) as HTMLInputElement | null;
    expect(esInput).not.toBeNull();
    expect(esInput!.disabled).toBe(true);
    // Verbatim license reason must appear on-screen.
    expect(screen.getByText(ES_ES_REASON)).toBeTruthy();
  });

  test('en-US is the active selected locale', () => {
    stubPdfApi();
    const store = makeStore();
    const { container } = render(
      <Provider store={store}>
        <SpellCheckSettingsDialog />
      </Provider>,
    );
    const enInput = container.querySelector(
      'input[type="radio"][value="en-US"]',
    ) as HTMLInputElement | null;
    expect(enInput).not.toBeNull();
    expect(enInput!.checked).toBe(true);
  });

  test('user dictionary chips render', () => {
    stubPdfApi();
    const store = makeStore();
    render(
      <Provider store={store}>
        <SpellCheckSettingsDialog />
      </Provider>,
    );
    expect(screen.getByText('foo')).toBeTruthy();
    expect(screen.getByText('bar')).toBeTruthy();
  });

  test('add-word button disabled when input is empty', () => {
    stubPdfApi();
    const store = makeStore();
    render(
      <Provider store={store}>
        <SpellCheckSettingsDialog />
      </Provider>,
    );
    const button = screen.getByRole('button', { name: 'Add' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  test('toggling Enable updates the slice', () => {
    stubPdfApi();
    const store = makeStore();
    render(
      <Provider store={store}>
        <SpellCheckSettingsDialog />
      </Provider>,
    );
    const checkbox = screen.getByRole('checkbox', { name: /Enable spell check/i });
    fireEvent.click(checkbox);
    expect(store.getState().spellCheck.enabled).toBe(false);
  });

  test('Close button closes the dialog', () => {
    stubPdfApi();
    const store = makeStore();
    render(
      <Provider store={store}>
        <SpellCheckSettingsDialog />
      </Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(store.getState().spellCheck.settingsOpen).toBe(false);
  });
});
