// Telemetry slice — the renderer's reactive mirror of the opt-in flag + buffer
// summary (architecture-phase-7.md §4.4). The AUTHORITATIVE opt-in lives in the
// settings store (key 'telemetry.optIn', default false) and the authoritative
// ring buffer lives in the main process; this slice mirrors them so the
// `useTelemetry` hook can hard-gate synchronously and Settings/debug-panel can
// render reactively without re-fetching on every keystroke.
//
// Opt-in DEFAULT is FALSE (conventions §18.5.1). The slice is seeded from
// settings at bootstrap; toggling dispatches `telemetry:setOptIn` (David) and
// updates this mirror. Turning OFF clears the buffer mirror (the main process
// clears its authoritative buffer; api-contracts.md §18.5).

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface TelemetryState {
  /** DEFAULT false — the privacy floor. Mirrors settings 'telemetry.optIn'. */
  optedIn: boolean;
  /** Mirror of the main-process ring-buffer size (for the Settings summary). */
  bufferedCount: number;
  /** Nullable + late-init (NO sentinel 0). */
  lastEventAt: number | null;
}

const initialState: TelemetryState = {
  optedIn: false,
  bufferedCount: 0,
  lastEventAt: null,
};

export const telemetrySlice = createSlice({
  name: 'telemetry',
  initialState,
  reducers: {
    setTelemetryOptedIn(state, action: PayloadAction<boolean>) {
      state.optedIn = action.payload;
      if (!action.payload) {
        // Opt-out clears the buffer mirror (the authoritative buffer is cleared
        // main-side per api-contracts.md §18.5).
        state.bufferedCount = 0;
        state.lastEventAt = null;
      }
    },
    setTelemetryBufferSummary(
      state,
      action: PayloadAction<{ bufferedCount: number; lastEventAt: number | null }>,
    ) {
      state.bufferedCount = action.payload.bufferedCount;
      state.lastEventAt = action.payload.lastEventAt;
    },
  },
});

export const { setTelemetryOptedIn, setTelemetryBufferSummary } = telemetrySlice.actions;

export default telemetrySlice.reducer;
