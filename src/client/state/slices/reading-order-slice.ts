// Reading-order slice — Phase 7.5 C4 (Riley Wave 5c).
//
// Drives the Reading Order overlay (numbered badges on each content block).
// State owns:
//   - active: whether the overlay is mounted on top of pages
//   - docHash / loaded: which doc the order belongs to + has it been fetched
//   - order: the live (possibly user-edited) reading-order sequence
//   - originalOrder: what came back from the engine — Apply is gated on
//     `order !== originalOrder` (referential — moveOrderEntry returns a
//     fresh array on real changes)
//   - autoDetectRunning / applying / loading flags
//   - lastErrorMessage: honest engine error surface (never null-default)
//   - truncationWarning: surfaces the 10k-node engine warning carried over
//     from Wave 5b (panel-header banner) when present
//
// Pure reducer + small helpers. The async dispatchers live in
// `state/thunks-phase7-5-wave5c.ts`. Selectors at the bottom.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { moveOrderEntry, type ReadingOrderEntry } from '../../types/reading-order-contract-stub';

export interface ReadingOrderState {
  /** Active document hash; null when no doc loaded. */
  docHash: string | null;
  /** Live reading order — user edits mutate this until Apply. */
  order: ReadingOrderEntry[];
  /** What came back from the engine last load — diff source for `dirty`. */
  originalOrder: ReadingOrderEntry[];
  /** Whether the overlay is mounted on top of pages. */
  active: boolean;
  /** Engine fetch / apply / auto-detect state. */
  loading: boolean;
  applying: boolean;
  autoDetectRunning: boolean;
  /** True once getReadingOrder has run for the current doc. */
  loaded: boolean;
  /** Carries over the 10k-node truncation warning from David's
   *  `pdf:getReadingOrder` (and the struct-tree get when applicable). */
  truncationWarning: string | null;
  /** Honest engine error surface. */
  lastErrorMessage: string | null;
}

const initialState: ReadingOrderState = {
  docHash: null,
  order: [],
  originalOrder: [],
  active: false,
  loading: false,
  applying: false,
  autoDetectRunning: false,
  loaded: false,
  truncationWarning: null,
  lastErrorMessage: null,
};

export const readingOrderSlice = createSlice({
  name: 'readingOrder',
  initialState,
  reducers: {
    setActive(state, action: PayloadAction<boolean>) {
      state.active = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
      if (action.payload) state.lastErrorMessage = null;
    },
    setApplying(state, action: PayloadAction<boolean>) {
      state.applying = action.payload;
      if (action.payload) state.lastErrorMessage = null;
    },
    setAutoDetectRunning(state, action: PayloadAction<boolean>) {
      state.autoDetectRunning = action.payload;
      if (action.payload) state.lastErrorMessage = null;
    },
    setLastError(state, action: PayloadAction<string>) {
      state.lastErrorMessage = action.payload;
      state.loading = false;
      state.applying = false;
      state.autoDetectRunning = false;
    },
    /** Engine returned a fresh order — clears dirty + clears the
     *  truncation banner unless the engine emits a fresh one. */
    loadedOrder(
      state,
      action: PayloadAction<{
        docHash: string;
        order: ReadingOrderEntry[];
        truncationWarning: string | null;
      }>,
    ) {
      state.docHash = action.payload.docHash;
      // Defensive copy — Redux Toolkit's Immer makes this safe, but cloning
      // here keeps the originalOrder + order independent references so the
      // dirty check below stays correct after a `moveEntry`.
      state.order = action.payload.order.map((e) => ({ ...e }));
      state.originalOrder = action.payload.order.map((e) => ({ ...e }));
      state.loading = false;
      state.loaded = true;
      state.truncationWarning = action.payload.truncationWarning;
      state.lastErrorMessage = null;
    },
    /** setReadingOrder returned ok — clear dirty (originalOrder := order). */
    appliedOrder(state) {
      state.applying = false;
      state.originalOrder = state.order.map((e) => ({ ...e }));
    },
    /** User drag-reorders or keyboard ↑↓ commits — pluck `fromIndex` from
     *  the current order array, insert at `toIndex`, re-index `order`
     *  field to 0..N-1. Pure helper handles the math. */
    moveEntry(state, action: PayloadAction<{ fromIndex: number; toIndex: number }>) {
      const next = moveOrderEntry(state.order, action.payload.fromIndex, action.payload.toIndex);
      // moveOrderEntry returns a fresh array even on no-op — so use a
      // structural check: identical lengths + same `structNodeId` order.
      let changed = next.length !== state.order.length;
      if (!changed) {
        for (let i = 0; i < next.length; i++) {
          const a = next[i];
          const b = state.order[i];
          if (a !== undefined && b !== undefined && a.structNodeId !== b.structNodeId) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) return;
      state.order = next;
    },
    /** Auto-detect engine returned — promote into the live order. The
     *  user reviews + Applies; the dirty flag flips automatically because
     *  the engine output differs from originalOrder. */
    autoDetectedOrder(state, action: PayloadAction<{ order: ReadingOrderEntry[] }>) {
      state.order = action.payload.order.map((e) => ({ ...e }));
      state.autoDetectRunning = false;
    },
    /** Reset on document close. Caller dispatches on close. */
    resetReadingOrder() {
      return initialState;
    },
  },
});

export const {
  setActive: setReadingOrderActive,
  setLoading: setReadingOrderLoading,
  setApplying: setReadingOrderApplying,
  setAutoDetectRunning,
  setLastError: setReadingOrderLastError,
  loadedOrder,
  appliedOrder,
  moveEntry,
  autoDetectedOrder,
  resetReadingOrder,
} = readingOrderSlice.actions;

export default readingOrderSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectReadingOrderActive(state: { readingOrder: ReadingOrderState }): boolean {
  return state.readingOrder.active;
}

export function selectReadingOrder(state: {
  readingOrder: ReadingOrderState;
}): ReadingOrderEntry[] {
  return state.readingOrder.order;
}

export function selectReadingOrderState(state: {
  readingOrder: ReadingOrderState;
}): ReadingOrderState {
  return state.readingOrder;
}

export function selectReadingOrderDirty(state: { readingOrder: ReadingOrderState }): boolean {
  const a = state.readingOrder.order;
  const b = state.readingOrder.originalOrder;
  if (a === b) return false;
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined || bi === undefined) return true;
    if (ai.structNodeId !== bi.structNodeId) return true;
    if (ai.order !== bi.order) return true;
  }
  return false;
}

export function selectReadingOrderTruncationWarning(state: {
  readingOrder: ReadingOrderState;
}): string | null {
  return state.readingOrder.truncationWarning;
}
