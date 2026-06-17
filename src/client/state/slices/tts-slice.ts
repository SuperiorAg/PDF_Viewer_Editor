// TTS (Read Aloud) slice — Phase 7.5 C1 (Riley Wave 5a).
//
// Drives the Read Aloud floating bar (View menu / Ctrl+Alt+R). Owns:
//  - open/closed visibility
//  - voice list (loaded lazily from David's `tts:listVoices`)
//  - user-picked voice id + rate + pitch (persisted via Ravi's
//    `tts_voice_prefs` repo once Ravi's storage bridge exists — for now
//    we keep them in-slice; a Wave-5a follow-up promotes to settings).
//  - active speak session: jobId, status, sentenceBoundaries, the text
//    currently being spoken + the active sentence index emitted by
//    David's `tts:boundary` event stream.
//  - engine status: 'unknown' before first `listVoices`, 'ready' when
//    voices loaded, 'unavailable' when David's engine reports
//    `engine_unavailable` (Linux without espeak — surfaced honestly per
//    ui-spec §22.2).
//
// Cross-check vs sentinel-default lesson:
// - `jobId` is `null` when no active session (not a sentinel string).
// - `lastErrorMessage` is `null` when no error.
// - `activeSentenceIndex` is `-1` (not `null`) because the boundary
//   payload uses sentenceIndex numbers; -1 is the unambiguous "none" code.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  TTS_DEFAULT_PITCH,
  TTS_DEFAULT_RATE,
  type TtsSentenceBoundary,
  type TtsVoice,
} from '../../types/tts-contract-stub';

export type TtsEngineStatus = 'unknown' | 'ready' | 'unavailable';

export type TtsSpeakStatus = 'idle' | 'starting' | 'speaking' | 'paused' | 'finished' | 'error';

export interface TtsState {
  open: boolean;
  engineStatus: TtsEngineStatus;
  engineName: 'sapi' | 'say' | 'espeak' | null;
  /** Hint surfaced when the engine is unavailable — David's engine
   *  message ('no SAPI', 'install espeak', etc.). */
  engineUnavailableMessage: string | null;
  voicesLoading: boolean;
  voices: TtsVoice[];
  /** null = "OS default for active locale" — David's engine resolves. */
  selectedVoiceId: string | null;
  rate: number;
  pitch: number;
  jobId: string | null;
  status: TtsSpeakStatus;
  /** Echo of the text last sent so the bar can show progress vs source. */
  currentText: string;
  currentBoundaries: TtsSentenceBoundary[];
  activeSentenceIndex: number;
  lastErrorMessage: string | null;
}

const initialState: TtsState = {
  open: false,
  engineStatus: 'unknown',
  engineName: null,
  engineUnavailableMessage: null,
  voicesLoading: false,
  voices: [],
  selectedVoiceId: null,
  rate: TTS_DEFAULT_RATE,
  pitch: TTS_DEFAULT_PITCH,
  jobId: null,
  status: 'idle',
  currentText: '',
  currentBoundaries: [],
  activeSentenceIndex: -1,
  lastErrorMessage: null,
};

function clampRange(value: number): number {
  if (Number.isNaN(value)) return TTS_DEFAULT_RATE;
  return Math.max(0.5, Math.min(2.0, value));
}

export const ttsSlice = createSlice({
  name: 'tts',
  initialState,
  reducers: {
    openReadAloud(state) {
      state.open = true;
      state.lastErrorMessage = null;
    },
    closeReadAloud(state) {
      state.open = false;
      // Any active session is stopped by the thunk before this fires so
      // we just zero the in-slice fields. The `selectedVoiceId` + rate +
      // pitch persist across open/close so the user's settings stick.
      state.jobId = null;
      state.status = 'idle';
      state.currentText = '';
      state.currentBoundaries = [];
      state.activeSentenceIndex = -1;
    },
    setVoicesLoading(state, action: PayloadAction<boolean>) {
      state.voicesLoading = action.payload;
    },
    setVoices(
      state,
      action: PayloadAction<{ voices: TtsVoice[]; engineName: 'sapi' | 'say' | 'espeak' }>,
    ) {
      state.voices = action.payload.voices;
      state.engineName = action.payload.engineName;
      state.engineStatus = 'ready';
      state.engineUnavailableMessage = null;
      // Honor an existing selection if it's still in the list; otherwise
      // null = "OS default for active locale". Never silently rewrite the
      // user's pick.
      if (
        state.selectedVoiceId !== null &&
        !action.payload.voices.some((v) => v.id === state.selectedVoiceId)
      ) {
        state.selectedVoiceId = null;
      }
    },
    setEngineUnavailable(state, action: PayloadAction<{ message: string }>) {
      state.engineStatus = 'unavailable';
      state.engineUnavailableMessage = action.payload.message;
      state.voices = [];
      state.engineName = null;
    },
    setSelectedVoiceId(state, action: PayloadAction<string | null>) {
      state.selectedVoiceId = action.payload;
    },
    setRate(state, action: PayloadAction<number>) {
      state.rate = clampRange(action.payload);
    },
    setPitch(state, action: PayloadAction<number>) {
      state.pitch = clampRange(action.payload);
    },
    setSpeakSession(
      state,
      action: PayloadAction<{
        jobId: string;
        text: string;
        boundaries: TtsSentenceBoundary[];
      }>,
    ) {
      state.jobId = action.payload.jobId;
      state.currentText = action.payload.text;
      state.currentBoundaries = action.payload.boundaries;
      state.status = 'speaking';
      state.activeSentenceIndex = -1;
      state.lastErrorMessage = null;
    },
    setStatus(state, action: PayloadAction<TtsSpeakStatus>) {
      state.status = action.payload;
      if (action.payload === 'finished' || action.payload === 'idle') {
        state.activeSentenceIndex = -1;
        state.jobId = null;
      }
    },
    setActiveSentenceIndex(state, action: PayloadAction<number>) {
      state.activeSentenceIndex = action.payload;
    },
    setLastError(state, action: PayloadAction<string | null>) {
      state.lastErrorMessage = action.payload;
      if (action.payload !== null) {
        state.status = 'error';
      }
    },
    resetTts() {
      return initialState;
    },
  },
});

export const {
  openReadAloud,
  closeReadAloud,
  setVoicesLoading,
  setVoices,
  setEngineUnavailable,
  setSelectedVoiceId,
  setRate,
  setPitch,
  setSpeakSession,
  setStatus: setTtsStatus,
  setActiveSentenceIndex,
  setLastError: setTtsLastError,
  resetTts,
} = ttsSlice.actions;

export default ttsSlice.reducer;
