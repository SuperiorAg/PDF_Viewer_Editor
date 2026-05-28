import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

interface SelectionState {
  selectedPageIndices: number[];
  lastClickedIndex: number | null;
}

const initialState: SelectionState = {
  selectedPageIndices: [],
  lastClickedIndex: null,
};

export const selectionSlice = createSlice({
  name: 'selection',
  initialState,
  reducers: {
    selectOnly(state, action: PayloadAction<number>) {
      state.selectedPageIndices = [action.payload];
      state.lastClickedIndex = action.payload;
    },
    toggleSelection(state, action: PayloadAction<number>) {
      const idx = action.payload;
      const found = state.selectedPageIndices.indexOf(idx);
      if (found === -1) state.selectedPageIndices.push(idx);
      else state.selectedPageIndices.splice(found, 1);
      state.lastClickedIndex = idx;
    },
    extendSelection(state, action: PayloadAction<{ to: number; total: number }>) {
      const from = state.lastClickedIndex ?? 0;
      const to = action.payload.to;
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const range: number[] = [];
      for (let i = lo; i <= hi && i < action.payload.total; i++) range.push(i);
      state.selectedPageIndices = range;
      state.lastClickedIndex = to;
    },
    selectAll(state, action: PayloadAction<number>) {
      state.selectedPageIndices = Array.from({ length: action.payload }, (_, i) => i);
      state.lastClickedIndex = action.payload - 1;
    },
    clearSelection(state) {
      state.selectedPageIndices = [];
      state.lastClickedIndex = null;
    },
  },
});

export const { selectOnly, toggleSelection, extendSelection, selectAll, clearSelection } =
  selectionSlice.actions;

export default selectionSlice.reducer;
