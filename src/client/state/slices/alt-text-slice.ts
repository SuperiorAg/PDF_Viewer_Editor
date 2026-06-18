// Alt-text slice — Phase 7.5 C5 (Riley Wave 5c).
//
// Drives the Alt Text inspector (modal). State owns:
//   - open: modal open state (registry / sidebar dispatch sets true)
//   - docHash / loaded: which doc the list belongs to + has it been fetched
//   - figures: figures without alt text (engine output, frozen snapshot)
//   - drafts: per-structNodeId alt-text edits the user has typed but not
//     yet Applied. Each Apply writes one draft through David's
//     `pdf:setAltText` and removes the figure from `figures` on success
//   - bulkModal: { groupHash, draft } when the bulk-set sub-modal is open
//   - loading / applying / lastErrorMessage: engine-state surface
//
// HONESTY CLAUSE: empty string is the canonical "remove alt" sentinel
// (matches David's contract). The renderer never silently strips alt;
// every Apply path is user-driven.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { FigureWithoutAlt } from '../../types/alt-text-contract-stub';

export interface AltTextState {
  /** Modal open state. */
  open: boolean;
  /** Active document hash; null when no doc loaded. */
  docHash: string | null;
  /** Engine snapshot — figures without alt text. */
  figures: FigureWithoutAlt[];
  /** Per-structNodeId user-typed draft (uncommitted). */
  drafts: Record<string, string>;
  /** Bulk-set sub-modal — { groupHash, draft } when open. */
  bulkModal: { groupHash: string; draft: string } | null;
  /** Set of structNodeIds whose Apply is currently in-flight. */
  applyingIds: Record<string, true>;
  /** Engine fetch state. */
  loading: boolean;
  /** True once the engine list has been fetched for the current doc. */
  loaded: boolean;
  /** Honest engine error surface. */
  lastErrorMessage: string | null;
}

const initialState: AltTextState = {
  open: false,
  docHash: null,
  figures: [],
  drafts: {},
  bulkModal: null,
  applyingIds: {},
  loading: false,
  loaded: false,
  lastErrorMessage: null,
};

export const altTextSlice = createSlice({
  name: 'altText',
  initialState,
  reducers: {
    setOpen(state, action: PayloadAction<boolean>) {
      state.open = action.payload;
      if (!action.payload) {
        // Closing the modal clears the bulk sub-modal too.
        state.bulkModal = null;
      }
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
      if (action.payload) state.lastErrorMessage = null;
    },
    setLastError(state, action: PayloadAction<string>) {
      state.lastErrorMessage = action.payload;
      state.loading = false;
    },
    /** Engine returned a fresh list. Drafts are preserved when the same
     *  structNodeId is still present (user may have typed on Wave 5d
     *  re-check before applying). */
    loadedFigures(
      state,
      action: PayloadAction<{
        docHash: string;
        figures: FigureWithoutAlt[];
      }>,
    ) {
      state.docHash = action.payload.docHash;
      state.figures = action.payload.figures.slice();
      state.loading = false;
      state.loaded = true;
      state.lastErrorMessage = null;
      // Prune drafts that no longer correspond to a missing-alt figure.
      const present = new Set(action.payload.figures.map((f) => f.structNodeId));
      for (const id of Object.keys(state.drafts)) {
        if (!present.has(id)) delete state.drafts[id];
      }
    },
    /** User typed in a per-figure input. */
    setDraft(state, action: PayloadAction<{ structNodeId: string; value: string }>) {
      state.drafts[action.payload.structNodeId] = action.payload.value;
    },
    /** Bulk-set sub-modal open. */
    openBulkModal(state, action: PayloadAction<{ groupHash: string }>) {
      state.bulkModal = { groupHash: action.payload.groupHash, draft: '' };
    },
    /** Bulk-set sub-modal draft typing. */
    setBulkDraft(state, action: PayloadAction<string>) {
      if (state.bulkModal === null) return;
      state.bulkModal = { ...state.bulkModal, draft: action.payload };
    },
    closeBulkModal(state) {
      state.bulkModal = null;
    },
    /** A single Apply has started — flag the in-flight row. */
    applyingStart(state, action: PayloadAction<{ structNodeId: string }>) {
      state.applyingIds[action.payload.structNodeId] = true;
      state.lastErrorMessage = null;
    },
    /** A single Apply finished — drop the figure from the list + clear
     *  its draft. Mirrors the "missing-alt list shrinks as you save" UX. */
    appliedAltText(state, action: PayloadAction<{ structNodeId: string }>) {
      const id = action.payload.structNodeId;
      state.figures = state.figures.filter((f) => f.structNodeId !== id);
      delete state.drafts[id];
      delete state.applyingIds[id];
    },
    /** Apply failed — clear the applying flag so the user can retry. */
    applyFailed(state, action: PayloadAction<{ structNodeId: string; message: string }>) {
      delete state.applyingIds[action.payload.structNodeId];
      state.lastErrorMessage = action.payload.message;
    },
    /** Reset on document close. */
    resetAltText() {
      return initialState;
    },
  },
});

export const {
  setOpen: setAltTextOpen,
  setLoading: setAltTextLoading,
  setLastError: setAltTextLastError,
  loadedFigures,
  setDraft: setAltTextDraft,
  openBulkModal: openAltTextBulkModal,
  setBulkDraft: setAltTextBulkDraft,
  closeBulkModal: closeAltTextBulkModal,
  applyingStart: altTextApplyingStart,
  appliedAltText,
  applyFailed: altTextApplyFailed,
  resetAltText,
} = altTextSlice.actions;

export default altTextSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectAltTextOpen(state: { altText: AltTextState }): boolean {
  return state.altText.open;
}

export function selectAltTextFigures(state: { altText: AltTextState }): FigureWithoutAlt[] {
  return state.altText.figures;
}

export function selectAltTextDrafts(state: { altText: AltTextState }): Record<string, string> {
  return state.altText.drafts;
}

export function selectAltTextBulkModal(state: {
  altText: AltTextState;
}): AltTextState['bulkModal'] {
  return state.altText.bulkModal;
}

export function selectAltTextState(state: { altText: AltTextState }): AltTextState {
  return state.altText;
}
