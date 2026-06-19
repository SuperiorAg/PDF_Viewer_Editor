// Spell-check slice tests — Phase 7.5 Wave 6 (Riley).

import { describe, expect, test } from 'vitest';

import { type SpellMisspelling } from '../../types/ipc-contract';

import spellCheckReducer, {
  addUserDictionaryWord,
  cacheSpellCheck,
  clearIgnoredOnce,
  clearSpellCheckCache,
  hideSpellSuggestionPopup,
  ignoreSpellWordOnce,
  removeUserDictionaryWord,
  resetSpellCheck,
  selectAvailableLocales,
  selectMisspellingsFor,
  selectSpellCheckEnabled,
  selectSpellLocale,
  selectSpellPopup,
  selectSpellSettingsOpen,
  selectUserDictionaryForLocale,
  setAvailableLocales,
  setLocalesError,
  setLoadingLocales,
  setSpellCheckEnabled,
  setSpellCheckLocale,
  setSpellCheckSettingsOpen,
  setUserDictionary,
  setUserDictionaryError,
  showSpellSuggestionPopup,
  type SpellCheckState,
} from './spell-check-slice';

function initial(): SpellCheckState {
  return spellCheckReducer(undefined, { type: '__init' });
}

const ms: SpellMisspelling = {
  offset: 0,
  length: 5,
  word: 'helo',
  suggestions: ['hello', 'help', 'helot'],
};

describe('spell-check slice', () => {
  test('setEnabled(false) clears cache + popup', () => {
    let s = spellCheckReducer(
      initial(),
      cacheSpellCheck({ pageIndex: 0, objectId: 'x', text: 'helo', misspellings: [ms] }),
    );
    s = spellCheckReducer(
      s,
      showSpellSuggestionPopup({
        pageIndex: 0,
        objectId: 'x',
        word: 'helo',
        suggestions: ['hello'],
        anchorX: 10,
        anchorY: 20,
      }),
    );
    s = spellCheckReducer(s, setSpellCheckEnabled(false));
    expect(s.enabled).toBe(false);
    expect(Object.keys(s.recentChecks).length).toBe(0);
    expect(s.popup.pageIndex).toBeNull();
  });

  test('setLocale invalidates cache and popup', () => {
    let s = spellCheckReducer(
      initial(),
      cacheSpellCheck({ pageIndex: 0, objectId: 'x', text: 'helo', misspellings: [ms] }),
    );
    s = spellCheckReducer(s, setSpellCheckLocale('es-ES'));
    expect(Object.keys(s.recentChecks).length).toBe(0);
  });

  test('setLoadingLocales(true) clears prior error', () => {
    let s = spellCheckReducer(initial(), setLocalesError('boom'));
    expect(s.lastLocalesError).toBe('boom');
    s = spellCheckReducer(s, setLoadingLocales(true));
    expect(s.lastLocalesError).toBeNull();
  });

  test('setAvailableLocales clears loadingLocales', () => {
    let s = spellCheckReducer(initial(), setLoadingLocales(true));
    s = spellCheckReducer(
      s,
      setAvailableLocales([
        { id: 'en-US', available: true },
        { id: 'es-ES', available: false, reason: 'licence' },
      ]),
    );
    expect(s.loadingLocales).toBe(false);
    expect(s.availableLocales.length).toBe(2);
  });

  test('user dictionary CRUD invalidates cache', () => {
    let s = spellCheckReducer(initial(), setUserDictionary({ locale: 'en-US', words: ['foo'] }));
    expect(s.userDictionary['en-US']).toEqual(['foo']);
    s = spellCheckReducer(
      s,
      cacheSpellCheck({ pageIndex: 0, objectId: 'x', text: 'helo', misspellings: [ms] }),
    );
    expect(Object.keys(s.recentChecks).length).toBe(1);
    s = spellCheckReducer(s, addUserDictionaryWord({ locale: 'en-US', word: 'helo' }));
    expect(Object.keys(s.recentChecks).length).toBe(0);
    expect(s.userDictionary['en-US']).toEqual(['foo', 'helo']);
    s = spellCheckReducer(s, removeUserDictionaryWord({ locale: 'en-US', word: 'foo' }));
    expect(s.userDictionary['en-US']).toEqual(['helo']);
  });

  test('addUserDictionaryWord is idempotent', () => {
    let s = spellCheckReducer(initial(), addUserDictionaryWord({ locale: 'en-US', word: 'foo' }));
    s = spellCheckReducer(s, addUserDictionaryWord({ locale: 'en-US', word: 'foo' }));
    expect(s.userDictionary['en-US']).toEqual(['foo']);
  });

  test('setUserDictionaryError captures + clears loading', () => {
    let s = spellCheckReducer(initial(), setLoadingLocales(true));
    s = spellCheckReducer(s, setUserDictionaryError('engine down'));
    expect(s.lastUserDictionaryError).toBe('engine down');
  });

  test('cacheCheck + clearCheckCache', () => {
    let s = spellCheckReducer(
      initial(),
      cacheSpellCheck({ pageIndex: 1, objectId: 'a', text: 'helo', misspellings: [ms] }),
    );
    expect(s.recentChecks['1:a']?.text).toBe('helo');
    s = spellCheckReducer(s, clearSpellCheckCache());
    expect(Object.keys(s.recentChecks).length).toBe(0);
  });

  test('popup show / hide', () => {
    let s = spellCheckReducer(
      initial(),
      showSpellSuggestionPopup({
        pageIndex: 2,
        objectId: 'q',
        word: 'helo',
        suggestions: ['hello'],
        anchorX: 5,
        anchorY: 6,
      }),
    );
    expect(s.popup.pageIndex).toBe(2);
    s = spellCheckReducer(s, hideSpellSuggestionPopup());
    expect(s.popup.pageIndex).toBeNull();
  });

  test('settingsOpen flag', () => {
    let s = spellCheckReducer(initial(), setSpellCheckSettingsOpen(true));
    expect(s.settingsOpen).toBe(true);
    s = spellCheckReducer(s, setSpellCheckSettingsOpen(false));
    expect(s.settingsOpen).toBe(false);
  });

  test('ignoreOnce keys per (page, obj, word) lowercased', () => {
    let s = spellCheckReducer(
      initial(),
      ignoreSpellWordOnce({ pageIndex: 0, objectId: 'x', word: 'Helo' }),
    );
    s = spellCheckReducer(s, ignoreSpellWordOnce({ pageIndex: 0, objectId: 'x', word: 'helo' }));
    expect(s.ignoredOnce.length).toBe(1);
    s = spellCheckReducer(s, clearIgnoredOnce());
    expect(s.ignoredOnce.length).toBe(0);
  });

  test('selectMisspellingsFor returns [] when disabled', () => {
    let s = spellCheckReducer(
      initial(),
      cacheSpellCheck({ pageIndex: 0, objectId: 'x', text: 'helo', misspellings: [ms] }),
    );
    s = spellCheckReducer(s, setSpellCheckEnabled(false));
    expect(selectMisspellingsFor({ spellCheck: s }, 0, 'x')).toEqual([]);
  });

  test('selectMisspellingsFor filters out ignoredOnce hits', () => {
    let s = spellCheckReducer(
      initial(),
      cacheSpellCheck({ pageIndex: 0, objectId: 'x', text: 'helo', misspellings: [ms] }),
    );
    s = spellCheckReducer(s, ignoreSpellWordOnce({ pageIndex: 0, objectId: 'x', word: 'helo' }));
    expect(selectMisspellingsFor({ spellCheck: s }, 0, 'x')).toEqual([]);
  });

  test('selectors expose readonly state', () => {
    let s = spellCheckReducer(initial(), setAvailableLocales([{ id: 'en-US', available: true }]));
    s = spellCheckReducer(s, setSpellCheckSettingsOpen(true));
    s = spellCheckReducer(s, setUserDictionary({ locale: 'en-US', words: ['a'] }));
    const state = { spellCheck: s };
    expect(selectSpellCheckEnabled(state)).toBe(true);
    expect(selectSpellLocale(state)).toBe('en-US');
    expect(selectAvailableLocales(state).length).toBe(1);
    expect(selectSpellSettingsOpen(state)).toBe(true);
    expect(selectUserDictionaryForLocale(state, 'en-US')).toEqual(['a']);
    expect(selectSpellPopup(state).pageIndex).toBeNull();
  });

  test('resetSpellCheck returns to initial', () => {
    let s = spellCheckReducer(initial(), setSpellCheckEnabled(false));
    s = spellCheckReducer(s, resetSpellCheck());
    expect(s).toEqual(initial());
  });
});
