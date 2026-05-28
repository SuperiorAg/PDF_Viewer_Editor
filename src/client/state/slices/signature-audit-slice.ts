// Signature audit slice — Phase 4 audit panel + annotation summary panel state.
// Per docs/architecture-phase-4.md §2.3 (audit panel) + §5 (summary panel).
//
// This slice carries the DISPLAY state only; the audit-log rows arrive via
// IPC (`signatures:listAudit`) and are stored here for the panel to render.
// The PER-DOCUMENT calibration is in the measure-calibration thunk path but
// keeps a tiny mirror here for fast read.
//
// Annotation summary panel filter/sort live here too — it's a small bag of
// UI state that the panel reads on each render.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { type MeasureCalibration, type SignatureAuditItem } from '../../types/ipc-contract';

export type AuditFilterScope = 'all' | 'current-document';

export type AnnotationSummaryFilter = {
  highlight: boolean;
  sticky: boolean;
  text: boolean;
  shape: boolean;
  signature: boolean;
};

export type AnnotationSummarySort = 'page' | 'created' | 'author';

export interface SignatureAuditState {
  /** Audit panel modal visibility. */
  panelOpen: boolean;
  /** Whether to filter by current document. */
  scope: AuditFilterScope;
  /** Loaded audit items (most recent first by signedAt). */
  items: SignatureAuditItem[];
  /** Total matching count (from listAudit's response — for pagination later). */
  total: number;
  /** Loading state. */
  loading: boolean;
  /** Inline error message. */
  error: string | null;
  /** Selected row id for the details panel. */
  selectedId: number | null;
  /** Verify results keyed by audit row id. */
  verify: Record<
    number,
    {
      valid: boolean;
      tamperedSinceSign: boolean;
    }
  >;
  /** Annotation summary panel filter (checkboxes). */
  summaryFilter: AnnotationSummaryFilter;
  /** Annotation summary panel sort order. */
  summarySort: AnnotationSummarySort;
  /** Current measure calibration for the open document (null = uncalibrated). */
  calibration: MeasureCalibration | null;
}

const initialState: SignatureAuditState = {
  panelOpen: false,
  scope: 'all',
  items: [],
  total: 0,
  loading: false,
  error: null,
  selectedId: null,
  verify: {},
  summaryFilter: {
    highlight: true,
    sticky: true,
    text: true,
    shape: true,
    signature: true,
  },
  summarySort: 'page',
  calibration: null,
};

export const signatureAuditSlice = createSlice({
  name: 'signatureAudit',
  initialState,
  reducers: {
    openAuditPanel(state) {
      state.panelOpen = true;
      state.error = null;
    },
    closeAuditPanel(state) {
      state.panelOpen = false;
    },
    setAuditScope(state, action: PayloadAction<AuditFilterScope>) {
      state.scope = action.payload;
    },
    setAuditLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
      if (action.payload) state.error = null;
    },
    setAuditItems(state, action: PayloadAction<{ items: SignatureAuditItem[]; total: number }>) {
      state.items = action.payload.items;
      state.total = action.payload.total;
      state.loading = false;
      state.error = null;
    },
    setAuditError(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
    selectAuditRow(state, action: PayloadAction<number | null>) {
      state.selectedId = action.payload;
    },
    setVerifyResult(
      state,
      action: PayloadAction<{
        id: number;
        valid: boolean;
        tamperedSinceSign: boolean;
      }>,
    ) {
      state.verify[action.payload.id] = {
        valid: action.payload.valid,
        tamperedSinceSign: action.payload.tamperedSinceSign,
      };
    },
    removeAuditRow(state, action: PayloadAction<number>) {
      state.items = state.items.filter((it) => it.id !== action.payload);
      state.total = Math.max(0, state.total - 1);
      delete state.verify[action.payload];
      if (state.selectedId === action.payload) state.selectedId = null;
    },
    setSummaryFilter(state, action: PayloadAction<Partial<AnnotationSummaryFilter>>) {
      state.summaryFilter = { ...state.summaryFilter, ...action.payload };
    },
    setSummarySort(state, action: PayloadAction<AnnotationSummarySort>) {
      state.summarySort = action.payload;
    },
    setMeasureCalibration(state, action: PayloadAction<MeasureCalibration | null>) {
      state.calibration = action.payload;
    },
    resetSignatureAudit() {
      return initialState;
    },
  },
});

export const {
  openAuditPanel,
  closeAuditPanel,
  setAuditScope,
  setAuditLoading,
  setAuditItems,
  setAuditError,
  selectAuditRow,
  setVerifyResult,
  removeAuditRow,
  setSummaryFilter,
  setSummarySort,
  setMeasureCalibration,
  resetSignatureAudit,
} = signatureAuditSlice.actions;

export default signatureAuditSlice.reducer;
