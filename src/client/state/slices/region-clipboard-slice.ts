// Region clipboard slice — Phase 7.5 B12 (Riley Wave 3).
// Per docs/ui-spec-phase-7.5.md §12.
//
// Scope (architecture §6 AR9 + brief): RASTER region only. The selection
// marquee is a per-page rectangle (PDF user-space coords). On Copy/Cut we
// rasterize the marquee's page area via the existing pdf.js canvas render
// pipeline into an image data URL, and stash it in this slice + the system
// clipboard (Async Clipboard API). On Paste we place the stashed image at
// the click point as a new image-embed annotation via the existing Phase 2
// image-embed EditOperation — no new IPC channel and no new EditOperation
// variant for v0.8.0. True vector-content-stream extraction is deferred
// (open question for Marcus).
//
// The pasted image is the cross-app fallback shape from §12.3 — for an
// internal paste of the same selection we still drop a PNG raster because
// extracting and re-embedding vector content streams from pdf.js is a
// follow-up.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { AppDispatch, RootState } from '../store';

import { pushToast } from './ui-slice';

export interface RegionSelection {
  pageIndex: number;
  /** PDF user-space rectangle. */
  pdfRect: { x: number; y: number; width: number; height: number };
}

export interface RegionClipboardEntry {
  /** Source page rect (for the "paste at same size" affordance). */
  sourcePdfRect: { width: number; height: number };
  /** Data URL of the rasterized region (PNG). */
  imageDataUrl: string;
  /** Pixel dimensions of the raster. */
  imageWidth: number;
  imageHeight: number;
  /** ms epoch when copied (debugging + future undo). */
  capturedAt: number;
}

export interface RegionClipboardState {
  /** True when the marquee tool is armed (Edit → Region Select). */
  marqueeActive: boolean;
  /** Live selection — null between draw and a confirmed copy. */
  selection: RegionSelection | null;
  /** Last clipboard entry. null until first Copy / Cut. */
  clipboard: RegionClipboardEntry | null;
  /** True while a paste ghost is following the cursor. */
  pasteGhostActive: boolean;
}

const initialState: RegionClipboardState = {
  marqueeActive: false,
  selection: null,
  clipboard: null,
  pasteGhostActive: false,
};

export const regionClipboardSlice = createSlice({
  name: 'regionClipboard',
  initialState,
  reducers: {
    setMarqueeActive(state, action: PayloadAction<boolean>) {
      state.marqueeActive = action.payload;
      if (!action.payload) state.selection = null;
    },
    setSelection(state, action: PayloadAction<RegionSelection | null>) {
      state.selection = action.payload;
    },
    setClipboardEntry(state, action: PayloadAction<RegionClipboardEntry>) {
      state.clipboard = action.payload;
    },
    clearClipboard(state) {
      state.clipboard = null;
    },
    setPasteGhostActive(state, action: PayloadAction<boolean>) {
      state.pasteGhostActive = action.payload;
    },
  },
});

export const {
  setMarqueeActive,
  setSelection,
  setClipboardEntry,
  clearClipboard,
  setPasteGhostActive,
} = regionClipboardSlice.actions;

export default regionClipboardSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectRegionClipboardHasSelection = (s: RootState): boolean =>
  s.regionClipboard.selection !== null;

export const selectRegionClipboardCanPaste = (s: RootState): boolean =>
  s.regionClipboard.clipboard !== null;

// ---------------------------------------------------------------------------
// Thunks — these are exposed as plain dispatch helpers so the registry +
// menu mirrors can fire them without dragging the whole `region-clipboard-
// overlay` component into the registry's imports. The actual rasterize +
// applyEdit work lives in the overlay (which owns the canvas ref); these
// helpers simply broadcast intent via slice flags the overlay listens for.
// ---------------------------------------------------------------------------

/** Dispatched by the menu / palette to copy the active region. The overlay
 * picks up the flag and runs the rasterize+clipboard write. */
export const regionClipboardCopy =
  () =>
  (dispatch: AppDispatch, getState: () => RootState): void => {
    const s = getState();
    if (s.regionClipboard.selection === null) {
      dispatch(
        pushToast({
          kind: 'info',
          message: 'Draw a region first — Edit → Region Select.',
        }),
      );
      return;
    }
    // The overlay listens for the marker action below.
    dispatch({ type: 'regionClipboard/requestCopy' });
  };

/** Same as Copy but the overlay removes the source region after rasterize. */
export const regionClipboardCut =
  () =>
  (dispatch: AppDispatch, getState: () => RootState): void => {
    const s = getState();
    if (s.regionClipboard.selection === null) {
      dispatch(
        pushToast({
          kind: 'info',
          message: 'Draw a region first — Edit → Region Select.',
        }),
      );
      return;
    }
    dispatch({ type: 'regionClipboard/requestCut' });
  };

/** Enters paste-ghost mode; the next page-click commits an image-embed. */
export const regionClipboardPaste =
  () =>
  (dispatch: AppDispatch, getState: () => RootState): void => {
    const s = getState();
    if (s.regionClipboard.clipboard === null) {
      dispatch(
        pushToast({
          kind: 'info',
          message: 'Nothing on the region clipboard yet — copy a region first.',
        }),
      );
      return;
    }
    dispatch(setPasteGhostActive(true));
  };
