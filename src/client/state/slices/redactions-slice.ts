// Redactions slice — Phase 7.4 B1 (Wave 2, Riley).
// Per docs/phase-7.4-b1-redaction-design.md §2.6 + §6.
//
// Renderer-only, per-edit-session state for pending redaction marks. The slice
// is the renderer-side draft store: marks are accumulated as the user draws
// rectangles with the Mark Rectangle tool, surfaced via the SVG overlay, and
// flushed across IPC via applyRedactionsThunk (in thunks-phase7-4.ts).
//
// Key shape decisions (per design):
//   - Per-page sparse map (Record<pageIndex, RedactionRect[]>) so the overlay
//     keys cheaply and an empty page allocates nothing.
//   - `totalMarks` is cached so the toolbar's enable/disable + Apply gate is
//     a single field read; we keep it consistent with byPage in every reducer.
//   - The slice DOES NOT persist to SQLite. Closing the document or quitting
//     the app discards pending marks. This matches Acrobat's session-scope
//     marks model and avoids a Phase 7.4 SQLite schema bump for in-flight UI.
//   - `lastApplyError` is the error-code union the Apply thunk maps from the
//     IPC response; the renderer reads it for inline error display + toast.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/** Active drawing tool inside the redaction sub-toolbar. */
export type RedactionTool = 'rect' | null;

/** PDF user-space rect (data-models §3.5; same shape as PdfRect elsewhere). */
export interface RedactionMarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RedactionMark {
  /** Stable id (uuid-ish) so the overlay can key + Remove individual marks. */
  id: string;
  /** Page index (0-based). */
  pageIndex: number;
  /** PDF user-space rect. */
  rect: RedactionMarkRect;
  /** ms epoch when added — for "last added" UI. */
  createdAt: number;
}

/** Error codes mirroring the IPC channel's PdfApplyRedactionsError union. */
export type RedactionApplyError =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'no_redactions'
  | 'page_out_of_range'
  | 'rect_invalid'
  | 'signed_pdf_requires_confirm'
  | 'pdf_load_failed'
  | 'rasterize_failed'
  | 'engine_failed'
  | 'output_too_large'
  | 'bridge_unavailable'
  | 'cancelled';

export interface RedactionsState {
  /** Active tool inside the sub-toolbar. Null when no tool is armed. */
  activeTool: RedactionTool;
  /** Per-page marks; sparse map, page index → mark list. */
  byPage: Record<number, RedactionMark[]>;
  /** Sum of marks across pages — cached mirror of byPage cardinality. */
  totalMarks: number;
  /** Whether the overlay should render the mark preview (default on). */
  showMarks: boolean;
  /** When Apply is in flight, blocks the UI + button. */
  applying: boolean;
  /** Last Apply outcome surface for inline error display. */
  lastApplyError: RedactionApplyError | null;
  /**
   * When the engine returns `signed_pdf_requires_confirm`, the modal needs the
   * field-name list to show "the following signatures will be invalidated".
   * Populated by the thunk; cleared on Apply success / Cancel.
   */
  pendingInvalidatedSignatureFields: string[];
}

const initialState: RedactionsState = {
  activeTool: null,
  byPage: {},
  totalMarks: 0,
  showMarks: true,
  applying: false,
  lastApplyError: null,
  pendingInvalidatedSignatureFields: [],
};

/** Recompute the totalMarks cached count from byPage. */
function countMarks(byPage: RedactionsState['byPage']): number {
  let n = 0;
  for (const k of Object.keys(byPage)) {
    n += byPage[Number(k)]?.length ?? 0;
  }
  return n;
}

/** Minimal uuid-ish stable id (sufficient for renderer-only keying). */
function mintMarkId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const redactionsSlice = createSlice({
  name: 'redactions',
  initialState,
  reducers: {
    setActiveRedactionTool(state, action: PayloadAction<RedactionTool>) {
      state.activeTool = action.payload;
    },
    addMark(
      state,
      action: PayloadAction<{
        pageIndex: number;
        rect: RedactionMarkRect;
        /** Optional pre-minted id (tests inject deterministic ids). */
        id?: string;
        /** Optional injected timestamp (tests pin to a fixed clock). */
        createdAt?: number;
      }>,
    ) {
      const { pageIndex, rect, id, createdAt } = action.payload;
      const mark: RedactionMark = {
        id: id ?? mintMarkId(),
        pageIndex,
        rect,
        createdAt: createdAt ?? Date.now(),
      };
      const list = state.byPage[pageIndex] ?? [];
      list.push(mark);
      state.byPage[pageIndex] = list;
      state.totalMarks += 1;
    },
    removeMark(
      state,
      action: PayloadAction<{
        pageIndex: number;
        id: string;
      }>,
    ) {
      const { pageIndex, id } = action.payload;
      const list = state.byPage[pageIndex];
      if (!list) return;
      const next = list.filter((m) => m.id !== id);
      if (next.length === 0) {
        delete state.byPage[pageIndex];
      } else {
        state.byPage[pageIndex] = next;
      }
      state.totalMarks = countMarks(state.byPage);
    },
    clearMarks(state) {
      state.byPage = {};
      state.totalMarks = 0;
      state.lastApplyError = null;
      state.pendingInvalidatedSignatureFields = [];
    },
    setShowMarks(state, action: PayloadAction<boolean>) {
      state.showMarks = action.payload;
    },
    setApplying(state, action: PayloadAction<boolean>) {
      state.applying = action.payload;
      if (action.payload) state.lastApplyError = null;
    },
    setApplyError(state, action: PayloadAction<RedactionApplyError | null>) {
      state.lastApplyError = action.payload;
      state.applying = false;
    },
    setPendingInvalidatedSignatureFields(state, action: PayloadAction<string[]>) {
      state.pendingInvalidatedSignatureFields = action.payload;
    },
    /** Successful Apply clears the slice (marks consumed) and the error. */
    applySucceeded(state) {
      state.byPage = {};
      state.totalMarks = 0;
      state.applying = false;
      state.lastApplyError = null;
      state.pendingInvalidatedSignatureFields = [];
      state.activeTool = null;
    },
    resetRedactions() {
      return initialState;
    },
  },
});

export const {
  setActiveRedactionTool,
  addMark,
  removeMark,
  clearMarks,
  setShowMarks,
  setApplying,
  setApplyError,
  setPendingInvalidatedSignatureFields,
  applySucceeded,
  resetRedactions,
} = redactionsSlice.actions;

export default redactionsSlice.reducer;

// -----------------------------------------------------------------------------
// Selectors — local, simple. Per slice convention (and Wave 12 lesson), the
// slice file does NOT import from a separate selectors module; small comparators
// stay inline. Components prefer these named selectors over inline arrow funcs.
// -----------------------------------------------------------------------------

export const selectRedactionActiveTool = (state: { redactions: RedactionsState }): RedactionTool =>
  state.redactions.activeTool;

export const selectRedactionByPage = (state: {
  redactions: RedactionsState;
}): Record<number, RedactionMark[]> => state.redactions.byPage;

export const selectRedactionTotalMarks = (state: { redactions: RedactionsState }): number =>
  state.redactions.totalMarks;

export const selectRedactionShowMarks = (state: { redactions: RedactionsState }): boolean =>
  state.redactions.showMarks;

export const selectRedactionApplying = (state: { redactions: RedactionsState }): boolean =>
  state.redactions.applying;

export const selectRedactionLastApplyError = (state: {
  redactions: RedactionsState;
}): RedactionApplyError | null => state.redactions.lastApplyError;

export const selectRedactionPendingInvalidatedSignatureFields = (state: {
  redactions: RedactionsState;
}): string[] => state.redactions.pendingInvalidatedSignatureFields;

/** Number of pages with at least one pending mark — for the modal copy. */
export const selectRedactionPagesWithMarks = (state: { redactions: RedactionsState }): number =>
  Object.keys(state.redactions.byPage).length;
