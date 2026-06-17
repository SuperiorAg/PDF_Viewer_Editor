// Auto-bookmark slice — Phase 7.5 B19 UI (Riley Wave 5).
//
// Drives the Auto-generate Bookmarks modal launched from the Bookmarks panel.
// Two-step flow per docs/ui-spec-phase-7.5.md §19:
//   1. Confirm: pick heuristic + max depth, click Detect.
//   2. Review: render proposed tree, user can edit titles + delete entries,
//      pick Replace vs Append, click Save.
//
// Engine call (`pdf:autoBookmarkFromHeadings`) lives in David's Wave 4
// canonical channel; the IPC contract type is already re-exported via the
// renderer gatekeeper (`./ipc-contract`). The Save step dispatches the
// standard `bookmarks:upsert` channel per accepted row (Phase 2 IPC).

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** A locally-editable copy of the engine's `ProposedBookmark` — adds an `id`
 *  for React key + a `deleted` flag so the user can prune without losing
 *  the original index ordering. */
export interface AutoBookmarkRow {
  id: string;
  title: string;
  pageIndex: number;
  depth: number;
  deleted: boolean;
}

export type AutoBookmarkStep = 'confirm' | 'detecting' | 'review' | 'saving';

export type AutoBookmarkMergeMode = 'replace' | 'append';

export interface AutoBookmarkState {
  open: boolean;
  step: AutoBookmarkStep;
  /** Selected heuristic — currently only one shipped; structured for future
   *  expansion (PDF outline pickup, layout cluster, etc.). */
  heuristic: 'font-size-cluster';
  /** Max depth cap — H1..H6 cap. UI clamps 1..6. */
  maxDepth: number;
  /** Proposed rows after Detect; empty until step transitions to 'review'. */
  proposed: AutoBookmarkRow[];
  mergeMode: AutoBookmarkMergeMode;
  /** Engine warnings to surface honestly in the review step. */
  warnings: string[];
  lastErrorMessage: string | null;
}

const initialState: AutoBookmarkState = {
  open: false,
  step: 'confirm',
  heuristic: 'font-size-cluster',
  maxDepth: 3,
  proposed: [],
  mergeMode: 'replace',
  warnings: [],
  lastErrorMessage: null,
};

export const autoBookmarkSlice = createSlice({
  name: 'autoBookmark',
  initialState,
  reducers: {
    openAutoBookmark(state) {
      state.open = true;
      state.step = 'confirm';
      state.proposed = [];
      state.warnings = [];
      state.lastErrorMessage = null;
    },
    closeAutoBookmark(state) {
      state.open = false;
      state.step = 'confirm';
      state.proposed = [];
      state.warnings = [];
    },
    setStep(state, action: PayloadAction<AutoBookmarkStep>) {
      state.step = action.payload;
    },
    setMaxDepth(state, action: PayloadAction<number>) {
      const n = Math.max(1, Math.min(6, Math.floor(action.payload)));
      state.maxDepth = n;
    },
    setProposed(state, action: PayloadAction<{ rows: AutoBookmarkRow[]; warnings: string[] }>) {
      state.proposed = action.payload.rows;
      state.warnings = action.payload.warnings;
      state.step = 'review';
      state.lastErrorMessage = null;
    },
    setRowTitle(state, action: PayloadAction<{ id: string; title: string }>) {
      const row = state.proposed.find((r) => r.id === action.payload.id);
      if (row !== undefined) row.title = action.payload.title;
    },
    setRowDeleted(state, action: PayloadAction<{ id: string; deleted: boolean }>) {
      const row = state.proposed.find((r) => r.id === action.payload.id);
      if (row !== undefined) row.deleted = action.payload.deleted;
    },
    setMergeMode(state, action: PayloadAction<AutoBookmarkMergeMode>) {
      state.mergeMode = action.payload;
    },
    setLastError(state, action: PayloadAction<string | null>) {
      state.lastErrorMessage = action.payload;
      if (action.payload !== null && state.step === 'detecting') {
        state.step = 'confirm';
      }
      if (action.payload !== null && state.step === 'saving') {
        state.step = 'review';
      }
    },
    resetAutoBookmark() {
      return initialState;
    },
  },
});

export const {
  openAutoBookmark,
  closeAutoBookmark,
  setStep: setAutoBookmarkStep,
  setMaxDepth: setAutoBookmarkMaxDepth,
  setProposed: setAutoBookmarkProposed,
  setRowTitle: setAutoBookmarkRowTitle,
  setRowDeleted: setAutoBookmarkRowDeleted,
  setMergeMode: setAutoBookmarkMergeMode,
  setLastError: setAutoBookmarkLastError,
  resetAutoBookmark,
} = autoBookmarkSlice.actions;

export default autoBookmarkSlice.reducer;
