import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type FitMode = 'fit-width' | 'fit-page' | 'custom';

interface ViewportState {
  zoom: number; // 0.5..4.0
  fitMode: FitMode;
  currentPage: number; // 0-based
  scrollTop: number;
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 4.0] as const;

const initialState: ViewportState = {
  zoom: 1.0,
  fitMode: 'fit-width',
  currentPage: 0,
  scrollTop: 0,
};

export const viewportSlice = createSlice({
  name: 'viewport',
  initialState,
  reducers: {
    setZoom(state, action: PayloadAction<number>) {
      state.zoom = clamp(action.payload, 0.1, 8.0);
      state.fitMode = 'custom';
    },
    zoomIn(state) {
      const next = ZOOM_LEVELS.find((l) => l > state.zoom);
      if (next !== undefined) {
        state.zoom = next;
        state.fitMode = 'custom';
      }
    },
    zoomOut(state) {
      const reversed = [...ZOOM_LEVELS].reverse();
      const prev = reversed.find((l) => l < state.zoom);
      if (prev !== undefined) {
        state.zoom = prev;
        state.fitMode = 'custom';
      }
    },
    resetZoom(state) {
      state.zoom = 1.0;
      state.fitMode = 'custom';
    },
    setFitMode(state, action: PayloadAction<FitMode>) {
      state.fitMode = action.payload;
    },
    setCurrentPage(state, action: PayloadAction<number>) {
      state.currentPage = Math.max(0, action.payload);
    },
    setScrollTop(state, action: PayloadAction<number>) {
      state.scrollTop = action.payload;
    },
  },
});

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export const { setZoom, zoomIn, zoomOut, resetZoom, setFitMode, setCurrentPage, setScrollTop } =
  viewportSlice.actions;

export default viewportSlice.reducer;
