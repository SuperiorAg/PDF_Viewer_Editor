// Font-swap slice — Phase 7.5 B18 UI (Riley Wave 6).
//
// Drives the Font-swap modal launched from the Inspector → Font tab when a
// text run is selected (docs/ui-spec-phase-7.5.md §18). The modal lets the
// user pick a replacement font from the embedded-fonts list +
// standard-PDF-font fallbacks (Helvetica / Times / Courier families).
//
// Engine call: `pdf:swapEmbeddedFont` (Wave 5 channel — already on
// `window.pdfApi.pdf`). v0.8.0 ships standard-PDF-font targets only;
// custom-font embed deferred to v0.9.0 per the contract comment.
//
// HONESTY (P7.5-L-10): the modal renders engine `warnings[]` verbatim in an
// honesty banner below the result row so the user sees the same text the
// engine returned (e.g. "subset font cannot be mapped to non-Latin scripts").

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type EmbeddedFontInfo, type StandardPdfFontName } from '../../types/ipc-contract';

/** Scope for the swap operation — UI-only construct that maps to specific
 *  fromFontName values when the dispatch fires. The engine itself swaps by
 *  font name (no notion of scope); we use the scope to pick the right
 *  fromFontName + display the right confirmation text. */
export type FontSwapScope = 'this-run' | 'this-page' | 'whole-document';

/** Standard-PDF-font picker options. Ordered the way Acrobat groups them.
 *  Mirrors the StandardPdfFontName union in David's contract. */
export const STANDARD_FONT_OPTIONS: ReadonlyArray<StandardPdfFontName> = [
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
];

export interface FontSwapState {
  /** Modal open. */
  open: boolean;
  /** Currently selected source font name (the "from" side). When opened from
   *  the Inspector, this is the font of the selected text run; the user
   *  can also pick from the embedded-fonts dropdown. */
  fromFontName: string | null;
  /** Replacement target. Must be a StandardPdfFontName per the v0.8.0 contract. */
  toFontName: StandardPdfFontName;
  /** Embedded fonts in the current document (fetched on open). */
  embeddedFonts: EmbeddedFontInfo[];
  /** Embedded-fonts fetch in flight. */
  loadingFonts: boolean;
  /** Last embedded-fonts list error. */
  lastListError: string | null;
  /** Swap scope — UI only (engine swaps by font name globally). */
  scope: FontSwapScope;
  /** Swap in flight. */
  swapping: boolean;
  /** Last engine warnings (verbatim, P7.5-L-10). */
  lastWarnings: string[];
  /** Last engine error message. */
  lastErrorMessage: string | null;
  /** Last successful swap count — surfaced in the toast / success banner. */
  lastFontsRewritten: number | null;
}

const initialState: FontSwapState = {
  open: false,
  fromFontName: null,
  toFontName: 'Helvetica',
  embeddedFonts: [],
  loadingFonts: false,
  lastListError: null,
  scope: 'whole-document',
  swapping: false,
  lastWarnings: [],
  lastErrorMessage: null,
  lastFontsRewritten: null,
};

export const fontSwapSlice = createSlice({
  name: 'fontSwap',
  initialState,
  reducers: {
    openFontSwap(state, action: PayloadAction<{ fromFontName?: string } | undefined>) {
      state.open = true;
      state.fromFontName = action.payload?.fromFontName ?? null;
      state.lastWarnings = [];
      state.lastErrorMessage = null;
      state.lastFontsRewritten = null;
    },
    closeFontSwap() {
      return initialState;
    },
    setLoadingFonts(state, action: PayloadAction<boolean>) {
      state.loadingFonts = action.payload;
      if (action.payload) state.lastListError = null;
    },
    setEmbeddedFonts(state, action: PayloadAction<EmbeddedFontInfo[]>) {
      state.embeddedFonts = action.payload;
      state.loadingFonts = false;
    },
    setListError(state, action: PayloadAction<string>) {
      state.lastListError = action.payload;
      state.loadingFonts = false;
    },
    setFromFontName(state, action: PayloadAction<string | null>) {
      state.fromFontName = action.payload;
    },
    setToFontName(state, action: PayloadAction<StandardPdfFontName>) {
      state.toFontName = action.payload;
    },
    setScope(state, action: PayloadAction<FontSwapScope>) {
      state.scope = action.payload;
    },
    setSwapping(state, action: PayloadAction<boolean>) {
      state.swapping = action.payload;
      if (action.payload) {
        state.lastWarnings = [];
        state.lastErrorMessage = null;
      }
    },
    setSwapResult(state, action: PayloadAction<{ fontsRewritten: number; warnings: string[] }>) {
      state.swapping = false;
      state.lastFontsRewritten = action.payload.fontsRewritten;
      state.lastWarnings = action.payload.warnings;
      state.lastErrorMessage = null;
    },
    setSwapError(state, action: PayloadAction<string>) {
      state.swapping = false;
      state.lastErrorMessage = action.payload;
    },
    resetFontSwap() {
      return initialState;
    },
  },
});

export const {
  openFontSwap,
  closeFontSwap,
  setLoadingFonts,
  setEmbeddedFonts,
  setListError: setFontListError,
  setFromFontName,
  setToFontName,
  setScope: setFontSwapScope,
  setSwapping,
  setSwapResult,
  setSwapError,
  resetFontSwap,
} = fontSwapSlice.actions;

export default fontSwapSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectFontSwapOpen = (state: { fontSwap: FontSwapState }): boolean =>
  state.fontSwap.open;

export const selectFontSwap = (state: { fontSwap: FontSwapState }): FontSwapState => state.fontSwap;
