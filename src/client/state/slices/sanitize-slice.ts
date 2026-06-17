// Sanitize (Remove Hidden Information) slice — Phase 7.5 B20 (Riley Wave 5).
//
// Drives the Sanitize modal (File / Tools → Remove Hidden Information…).
// Owns the checkbox state for each `SanitizeCategory` + the PAdES gate's
// pending field list when David's engine returns
// `'signed_pdf_requires_confirm'` (mirrors the redaction Apply flow).
//
// Cross-check vs sentinel-default lesson:
// - `pendingInvalidatedSignatureFields` is `null` when no PAdES gate
//   pending (not a sentinel).
// - `lastErrorMessage` is `null` when no error (not a sentinel).

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  type SanitizeCategory,
  DEFAULT_CATEGORY_CHECKED,
  V080_SUPPORTED_CATEGORIES,
} from '../../types/sanitize-contract-stub';

export interface SanitizeState {
  open: boolean;
  /** Per-category checkbox state. Only `V080_SUPPORTED_CATEGORIES` are
   *  surfaced in the UI; the rest sit at `false` for forward compatibility. */
  checked: Record<SanitizeCategory, boolean>;
  /** Set on PAdES gate response so the modal can render the signature
   *  paragraph + the re-arm button. Null when no gate pending. */
  pendingInvalidatedSignatureFields: string[] | null;
  applying: boolean;
  lastErrorMessage: string | null;
}

const initialState: SanitizeState = {
  open: false,
  checked: { ...DEFAULT_CATEGORY_CHECKED },
  pendingInvalidatedSignatureFields: null,
  applying: false,
  lastErrorMessage: null,
};

export const sanitizeSlice = createSlice({
  name: 'sanitize',
  initialState,
  reducers: {
    openSanitize(state) {
      state.open = true;
      // Reset checkboxes to defaults on open so a previous session's clicks
      // don't carry over surprisingly.
      state.checked = { ...DEFAULT_CATEGORY_CHECKED };
      state.pendingInvalidatedSignatureFields = null;
      state.lastErrorMessage = null;
    },
    closeSanitize(state) {
      state.open = false;
      state.applying = false;
      state.pendingInvalidatedSignatureFields = null;
    },
    setCategoryChecked(
      state,
      action: PayloadAction<{ category: SanitizeCategory; checked: boolean }>,
    ) {
      state.checked[action.payload.category] = action.payload.checked;
    },
    setAllSupportedChecked(state, action: PayloadAction<boolean>) {
      for (const c of V080_SUPPORTED_CATEGORIES) {
        state.checked[c] = action.payload;
      }
    },
    setApplying(state, action: PayloadAction<boolean>) {
      state.applying = action.payload;
    },
    setLastError(state, action: PayloadAction<string | null>) {
      state.lastErrorMessage = action.payload;
    },
    setPendingInvalidatedSignatureFields(state, action: PayloadAction<string[] | null>) {
      state.pendingInvalidatedSignatureFields = action.payload;
    },
    resetSanitize() {
      return initialState;
    },
  },
});

export const {
  openSanitize,
  closeSanitize,
  setCategoryChecked,
  setAllSupportedChecked,
  setApplying: setSanitizeApplying,
  setLastError: setSanitizeLastError,
  setPendingInvalidatedSignatureFields,
  resetSanitize,
} = sanitizeSlice.actions;

export default sanitizeSlice.reducer;

/** Selector convenience — flat list of `SanitizeCategory[]` to dispatch. */
export function selectedCategories(checked: SanitizeState['checked']): SanitizeCategory[] {
  return V080_SUPPORTED_CATEGORIES.filter((c) => checked[c] === true);
}
