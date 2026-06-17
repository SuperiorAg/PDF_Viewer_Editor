// Preflight slice — Phase 7.5 C2 (Riley Wave 5a).
//
// Drives the Preflight sidebar panel. State:
//  - selectedProfiles: which PDF/X / PDF/A profiles to run
//  - running: in-flight indicator while David's engine works
//  - lastResults: PreflightRuleResult[] from the last successful run +
//    ranAt + shippedRuleCount for the honest disclosure header.
//  - lastErrorMessage: surfaced honestly when the engine reports failure
//  - Section expand/collapse state (errors/warnings/infos) lives in the
//    panel component because it's pure presentation; the slice owns
//    everything that survives unmount.
//
// HONESTY CLAUSE: the slice does NOT eager-run on open per the brief.
// `running` flips true only when the user clicks the Run button (or its
// shortcut). Default `lastResults: null` means the panel renders the
// "Click Run to start" empty state until the user explicitly invokes it.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  DEFAULT_PROFILES,
  type PdfRunPreflightValue,
  type PreflightProfile,
} from '../../types/preflight-contract-stub';

export interface PreflightState {
  selectedProfiles: PreflightProfile[];
  running: boolean;
  lastResults: PdfRunPreflightValue | null;
  lastErrorMessage: string | null;
}

const initialState: PreflightState = {
  selectedProfiles: [...DEFAULT_PROFILES],
  running: false,
  lastResults: null,
  lastErrorMessage: null,
};

export const preflightSlice = createSlice({
  name: 'preflight',
  initialState,
  reducers: {
    toggleProfile(state, action: PayloadAction<PreflightProfile>) {
      const profile = action.payload;
      const idx = state.selectedProfiles.indexOf(profile);
      if (idx === -1) {
        state.selectedProfiles.push(profile);
      } else {
        // Keep at least one profile selected — Run button gates on
        // length > 0 in the panel as well so this is belt-and-braces.
        if (state.selectedProfiles.length > 1) {
          state.selectedProfiles.splice(idx, 1);
        }
      }
    },
    setSelectedProfiles(state, action: PayloadAction<PreflightProfile[]>) {
      state.selectedProfiles = action.payload.length === 0 ? [...DEFAULT_PROFILES] : action.payload;
    },
    setRunning(state, action: PayloadAction<boolean>) {
      state.running = action.payload;
      if (action.payload) {
        state.lastErrorMessage = null;
      }
    },
    setResults(state, action: PayloadAction<PdfRunPreflightValue>) {
      state.lastResults = action.payload;
      state.lastErrorMessage = null;
      state.running = false;
    },
    setLastError(state, action: PayloadAction<string>) {
      state.lastErrorMessage = action.payload;
      state.running = false;
    },
    resetPreflight() {
      return initialState;
    },
  },
});

export const {
  toggleProfile,
  setSelectedProfiles,
  setRunning: setPreflightRunning,
  setResults: setPreflightResults,
  setLastError: setPreflightLastError,
  resetPreflight,
} = preflightSlice.actions;

export default preflightSlice.reducer;
