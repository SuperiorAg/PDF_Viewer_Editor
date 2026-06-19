// Spell-check slice — Phase 7.5 B14 UI (Riley Wave 6).
//
// Drives three surfaces (docs/ui-spec-phase-7.5.md §14):
//   1. Underline rendering inside text-edit overlay (red wavy underlines at
//      each misspelling offset).
//   2. Suggestion popup at click / right-click on a misspelling — top 5
//      suggestions + Ignore once + Add to dictionary.
//   3. Settings dialog — Tools → Spell Check Settings. Locale picker reads
//      from David's `spell:listLocales` (es-ES rendered DISABLED with the
//      verbatim `reason` string per P7.5-L-10). User-dictionary management.
//
// HONESTY (P7.5-L-10):
//   - The `availableLocales` list is what David's engine returns. The
//     settings dialog renders each unavailable locale with its `reason`
//     string verbatim — never a paraphrase.
//   - `enabled = false` (user-toggled off in settings) disables the entire
//     subsystem: the recent-check cache is cleared and the text-edit
//     overlay reads zero misspellings.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type SpellLocaleDescriptor, type SpellMisspelling } from '../../types/ipc-contract';

/** A cached spell-check result keyed by `(pageIndex, objectId)`. */
export interface SpellCheckCacheEntry {
  /** The exact text snapshot that was checked. */
  text: string;
  misspellings: SpellMisspelling[];
  /** Wall-clock ts of the check — used for stale-cache decisions. */
  ts: number;
}

/** UI state for the suggestion popup. */
export interface SuggestionPopupState {
  /** Page + objectId of the underline that was clicked. Null when hidden. */
  pageIndex: number | null;
  objectId: string | null;
  /** The misspelled word that triggered the popup. */
  word: string;
  /** Suggestions retrieved at check time (top 5). */
  suggestions: string[];
  /** Screen-space anchor (relative to the page viewport). */
  anchorX: number;
  anchorY: number;
}

export interface SpellCheckState {
  /** Active locale. en-US is the only available locale in v0.8.0. */
  locale: string;
  /** Master toggle. When false the subsystem is inert across all surfaces. */
  enabled: boolean;
  /** Locale descriptors fetched from David's spell:listLocales. */
  availableLocales: SpellLocaleDescriptor[];
  /** Locale-listing fetch in flight. */
  loadingLocales: boolean;
  /** Last list error (engine-facing). */
  lastLocalesError: string | null;
  /** Per-locale user dictionary words (from David's listUserDictionary). */
  userDictionary: Record<string, string[]>;
  /** User-dictionary fetch in flight. */
  loadingUserDictionary: boolean;
  /** Last user-dictionary error. */
  lastUserDictionaryError: string | null;
  /** Cached check results keyed by `${pageIndex}:${objectId}`. */
  recentChecks: Record<string, SpellCheckCacheEntry>;
  /** Settings dialog open. */
  settingsOpen: boolean;
  /** Suggestion popup state — hidden when pageIndex is null. */
  popup: SuggestionPopupState;
  /** Words the user has Ignored Once for the current session.
   *  Keyed by `${pageIndex}:${objectId}:${word}` so an Ignore on one run
   *  does not silence the same word elsewhere. */
  ignoredOnce: string[];
}

const initialPopup: SuggestionPopupState = {
  pageIndex: null,
  objectId: null,
  word: '',
  suggestions: [],
  anchorX: 0,
  anchorY: 0,
};

const initialState: SpellCheckState = {
  locale: 'en-US',
  enabled: true,
  availableLocales: [],
  loadingLocales: false,
  lastLocalesError: null,
  userDictionary: {},
  loadingUserDictionary: false,
  lastUserDictionaryError: null,
  recentChecks: {},
  settingsOpen: false,
  popup: initialPopup,
  ignoredOnce: [],
};

function cacheKey(pageIndex: number, objectId: string): string {
  return `${pageIndex}:${objectId}`;
}

function ignoreKey(pageIndex: number, objectId: string, word: string): string {
  return `${pageIndex}:${objectId}:${word.toLowerCase()}`;
}

export const spellCheckSlice = createSlice({
  name: 'spellCheck',
  initialState,
  reducers: {
    setEnabled(state, action: PayloadAction<boolean>) {
      state.enabled = action.payload;
      if (!action.payload) {
        // Clearing the cache prevents stale underlines from rendering when
        // the user re-enables; cheaper than computing diffs.
        state.recentChecks = {};
        state.popup = initialPopup;
      }
    },
    setLocale(state, action: PayloadAction<string>) {
      state.locale = action.payload;
      // Locale change invalidates the cache (different dictionary).
      state.recentChecks = {};
      state.popup = initialPopup;
    },
    setLoadingLocales(state, action: PayloadAction<boolean>) {
      state.loadingLocales = action.payload;
      if (action.payload) state.lastLocalesError = null;
    },
    setAvailableLocales(state, action: PayloadAction<SpellLocaleDescriptor[]>) {
      state.availableLocales = action.payload;
      state.loadingLocales = false;
    },
    setLocalesError(state, action: PayloadAction<string>) {
      state.lastLocalesError = action.payload;
      state.loadingLocales = false;
    },
    setLoadingUserDictionary(state, action: PayloadAction<boolean>) {
      state.loadingUserDictionary = action.payload;
      if (action.payload) state.lastUserDictionaryError = null;
    },
    setUserDictionary(state, action: PayloadAction<{ locale: string; words: string[] }>) {
      state.userDictionary[action.payload.locale] = action.payload.words;
      state.loadingUserDictionary = false;
    },
    setUserDictionaryError(state, action: PayloadAction<string>) {
      state.lastUserDictionaryError = action.payload;
      state.loadingUserDictionary = false;
    },
    addUserDictionaryWord(state, action: PayloadAction<{ locale: string; word: string }>) {
      const list = state.userDictionary[action.payload.locale] ?? [];
      if (!list.includes(action.payload.word)) {
        state.userDictionary[action.payload.locale] = [...list, action.payload.word];
      }
      // Adding a word invalidates the cache — same word may have been the
      // sole misspelling at multiple locations.
      state.recentChecks = {};
    },
    removeUserDictionaryWord(state, action: PayloadAction<{ locale: string; word: string }>) {
      const list = state.userDictionary[action.payload.locale] ?? [];
      state.userDictionary[action.payload.locale] = list.filter((w) => w !== action.payload.word);
      state.recentChecks = {};
    },
    cacheCheck(
      state,
      action: PayloadAction<{
        pageIndex: number;
        objectId: string;
        text: string;
        misspellings: SpellMisspelling[];
      }>,
    ) {
      const { pageIndex, objectId, text, misspellings } = action.payload;
      state.recentChecks[cacheKey(pageIndex, objectId)] = {
        text,
        misspellings,
        ts: Date.now(),
      };
    },
    clearCheckCache(state) {
      state.recentChecks = {};
    },
    showPopup(state, action: PayloadAction<SuggestionPopupState>) {
      state.popup = action.payload;
    },
    hidePopup(state) {
      state.popup = initialPopup;
    },
    setSettingsOpen(state, action: PayloadAction<boolean>) {
      state.settingsOpen = action.payload;
    },
    ignoreOnce(
      state,
      action: PayloadAction<{ pageIndex: number; objectId: string; word: string }>,
    ) {
      const key = ignoreKey(action.payload.pageIndex, action.payload.objectId, action.payload.word);
      if (!state.ignoredOnce.includes(key)) {
        state.ignoredOnce.push(key);
      }
    },
    clearIgnoredOnce(state) {
      state.ignoredOnce = [];
    },
    resetSpellCheck() {
      return initialState;
    },
  },
});

export const {
  setEnabled: setSpellCheckEnabled,
  setLocale: setSpellCheckLocale,
  setLoadingLocales,
  setAvailableLocales,
  setLocalesError,
  setLoadingUserDictionary,
  setUserDictionary,
  setUserDictionaryError,
  addUserDictionaryWord,
  removeUserDictionaryWord,
  cacheCheck: cacheSpellCheck,
  clearCheckCache: clearSpellCheckCache,
  showPopup: showSpellSuggestionPopup,
  hidePopup: hideSpellSuggestionPopup,
  setSettingsOpen: setSpellCheckSettingsOpen,
  ignoreOnce: ignoreSpellWordOnce,
  clearIgnoredOnce,
  resetSpellCheck,
} = spellCheckSlice.actions;

export default spellCheckSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectSpellCheckEnabled = (state: { spellCheck: SpellCheckState }): boolean =>
  state.spellCheck.enabled;

export const selectSpellLocale = (state: { spellCheck: SpellCheckState }): string =>
  state.spellCheck.locale;

export const selectAvailableLocales = (state: {
  spellCheck: SpellCheckState;
}): SpellLocaleDescriptor[] => state.spellCheck.availableLocales;

export const selectUserDictionaryForLocale = (
  state: { spellCheck: SpellCheckState },
  locale: string,
): string[] => state.spellCheck.userDictionary[locale] ?? [];

export const selectSpellSettingsOpen = (state: { spellCheck: SpellCheckState }): boolean =>
  state.spellCheck.settingsOpen;

export const selectSpellPopup = (state: { spellCheck: SpellCheckState }): SuggestionPopupState =>
  state.spellCheck.popup;

export const selectMisspellingsFor = (
  state: { spellCheck: SpellCheckState },
  pageIndex: number,
  objectId: string,
): SpellMisspelling[] => {
  if (!state.spellCheck.enabled) return [];
  const entry = state.spellCheck.recentChecks[`${pageIndex}:${objectId}`];
  if (!entry) return [];
  // Filter out ignored-once words.
  return entry.misspellings.filter(
    (m) =>
      !state.spellCheck.ignoredOnce.includes(`${pageIndex}:${objectId}:${m.word.toLowerCase()}`),
  );
};
