// Scan slice — Phase 5.1 placeholder per `docs/architecture-phase-5.md §7`.
//
// **No live functionality in Phase 5.** The native-scanner library survey
// (Wave 19 Q-E) found no MIT/Apache-2.0/BSD WIA Node binding at the maturity
// bar this project requires; the channels exist as placeholders that return
// `Result<never, 'not_implemented_phase_5_1'>` so the renderer can pattern-
// match on the error and render a disabled menu state.
//
// Phase 5.1 design wave will expand this slice with the real device + job
// shapes (devices: ScanDevice[], currentScan: ScanJob, etc.). The slice is
// registered in the store NOW so that Phase 5.1 is additive — no store wiring
// changes between Phase 5 and Phase 5.1.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface ScanState {
  /** True when the user has clicked the placeholder UI — shows the modal. */
  modalOpen: boolean;
  /**
   * Last error from a scan IPC attempt. In Phase 5 the only possible value
   * is 'not_implemented_phase_5_1'; Phase 5.1 will add real failure modes.
   */
  lastError: string | null;
}

const initialState: ScanState = {
  modalOpen: false,
  lastError: null,
};

export const scanSlice = createSlice({
  name: 'scan',
  initialState,
  reducers: {
    openScanModal(state) {
      state.modalOpen = true;
      state.lastError = null;
    },
    closeScanModal(state) {
      state.modalOpen = false;
    },
    setScanError(state, action: PayloadAction<string | null>) {
      state.lastError = action.payload;
    },
    resetScanState() {
      return initialState;
    },
  },
});

export const { openScanModal, closeScanModal, setScanError, resetScanState } = scanSlice.actions;

export default scanSlice.reducer;
