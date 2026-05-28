// i18n slice — the renderer's reactive mirror of the active locale
// (i18n-strategy.md §7). The AUTHORITATIVE locale lives in the settings store
// (key 'i18n.locale', default 'en-US'); i18next holds the live applied locale.
// This slice mirrors the selection so components that are not direct
// `useTranslation` consumers (e.g. the language picker's own subtext, Intl date
// formatters) can react to a locale switch through the store.
//
// Default 'en-US'. No OS auto-detection in Phase 7 (§7.5) — the user opts into
// es-ES explicitly.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { AppLocale } from '../../types/ipc-contract';

export interface I18nState {
  locale: AppLocale;
}

const initialState: I18nState = {
  locale: 'en-US',
};

export const i18nSlice = createSlice({
  name: 'i18n',
  initialState,
  reducers: {
    setLocaleMirror(state, action: PayloadAction<AppLocale>) {
      state.locale = action.payload;
    },
  },
});

export const { setLocaleMirror } = i18nSlice.actions;

export default i18nSlice.reducer;
