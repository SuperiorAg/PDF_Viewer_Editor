import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type RecentsListItem } from '../../types/ipc-contract';

interface RecentsState {
  items: RecentsListItem[];
  loaded: boolean;
}

const initialState: RecentsState = { items: [], loaded: false };

export const recentsSlice = createSlice({
  name: 'recents',
  initialState,
  reducers: {
    setRecents(state, action: PayloadAction<RecentsListItem[]>) {
      state.items = action.payload;
      state.loaded = true;
    },
    clearRecents(state) {
      state.items = [];
      state.loaded = true;
    },
  },
});

export const { setRecents, clearRecents } = recentsSlice.actions;
export default recentsSlice.reducer;
