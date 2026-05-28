// History slice — Phase 2 undo/redo.
// Per ARCHITECTURE.md §5.3, the slice infrastructure ships in Phase 1 so the
// action shapes match what Phase 2 needs.
//
// Wave 8.6 (N-1 fix): each entry stores TWO representations of both fwd and inv:
//   - `fwd` / `inv`              → COMPACTED form (image bytes zeroed; content-hash only).
//                                  This is the storage-footprint optimization per
//                                  conventions §13.3 — keeps the history stack bounded
//                                  even with large image payloads.
//   - `rawFwd` / `rawInv`        → RAW form (full image bytes intact). Dispatched on
//                                  undo / redo so `dirtyOps` receives the byte-bearing
//                                  op the main-process replay engine consumes.
//
// The two-state model exists because a single representation can't serve both
// the history-storage need (compact) and the on-the-wire dispatch need (bytes).
// See `docs/code-review.md` Wave 8.5 re-audit N-1 finding.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type EditOperation } from '../../types/ipc-contract';

export interface HistoryEntry {
  /** Compacted forward op — image bytes zeroed for storage footprint. */
  fwd: EditOperation;
  /** Compacted inverse op — image bytes zeroed for storage footprint. */
  inv: EditOperation;
  /** Raw forward op (with image bytes intact) — dispatched on redo. */
  rawFwd: EditOperation;
  /** Raw inverse op (with image bytes intact) — dispatched on undo. */
  rawInv: EditOperation;
}

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  maxHistory: number;
}

const initialState: HistoryState = {
  past: [],
  future: [],
  maxHistory: 100,
};

export const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {
    pushEntry(state, action: PayloadAction<HistoryEntry>) {
      state.past.push(action.payload);
      if (state.past.length > state.maxHistory) state.past.shift();
      state.future = [];
    },
    popPastToFuture(state) {
      const entry = state.past.pop();
      if (entry) state.future.push(entry);
    },
    popFutureToPast(state) {
      const entry = state.future.pop();
      if (entry) state.past.push(entry);
    },
    clearHistory(state) {
      state.past = [];
      state.future = [];
    },
    setMaxHistory(state, action: PayloadAction<number>) {
      state.maxHistory = Math.max(10, Math.min(500, action.payload));
    },
  },
});

export const { pushEntry, popPastToFuture, popFutureToPast, clearHistory, setMaxHistory } =
  historySlice.actions;
export default historySlice.reducer;
