// Update slice — renderer-facing auto-update status (architecture-phase-7.md
// §3.3). Mirrors the `update:*` IPC results (api-contracts.md §18.1-§18.3).
//
// NULLABLE + LATE-INIT discipline (cross-check the sentinel-default lesson,
// global JSONL 2026-05-26): availableVersion / downloadProgressPercent /
// lastCheckedAt / errorMessage are all `... | null` — null until a check
// returns a value. NO sentinel '' / 0 / -1.
//
// The status 'not-configured' is the HONEST placeholder state (P7-L-2): the
// publish target is a placeholder, so a check returns `update_not_configured`
// and the UI shows "release channel not configured" — never a fake "up to date".

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { UpdateChannel, UpdateCheckValue, UpdateStatus } from '../../types/ipc-contract';

export interface UpdateState {
  /** Mirrors settings 'update.channel'; DEFAULT 'manual' (explicit-only). */
  channel: UpdateChannel;
  status: UpdateStatus;
  /** null until a check returns an available update (NO sentinel ''). */
  availableVersion: string | null;
  /** The running app version, stamped by the first check. */
  currentVersion: string | null;
  /** null unless status === 'downloading'. */
  downloadProgressPercent: number | null;
  /** null until the first check (NO sentinel 0). */
  lastCheckedAt: number | null;
  /** null unless status === 'error'; the error code for a localized message. */
  errorCode: string | null;
}

const initialState: UpdateState = {
  channel: 'manual',
  status: 'idle',
  availableVersion: null,
  currentVersion: null,
  downloadProgressPercent: null,
  lastCheckedAt: null,
  errorCode: null,
};

export const updateSlice = createSlice({
  name: 'update',
  initialState,
  reducers: {
    setUpdateChannel(state, action: PayloadAction<UpdateChannel>) {
      state.channel = action.payload;
    },
    updateCheckStarted(state) {
      state.status = 'checking';
      state.errorCode = null;
    },
    updateCheckSucceeded(state, action: PayloadAction<UpdateCheckValue>) {
      const v = action.payload;
      state.status = v.status;
      state.availableVersion = v.availableVersion;
      state.currentVersion = v.currentVersion;
      state.lastCheckedAt = v.lastCheckedAt;
      state.errorCode = null;
    },
    updateNotConfigured(state) {
      state.status = 'not-configured';
      state.availableVersion = null;
      state.errorCode = null;
    },
    updateCheckFailed(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.errorCode = action.payload;
    },
    updateDownloadProgress(state, action: PayloadAction<number>) {
      state.status = 'downloading';
      state.downloadProgressPercent = action.payload;
    },
    updateDownloaded(state) {
      state.status = 'downloaded';
      state.downloadProgressPercent = null;
    },
  },
});

export const {
  setUpdateChannel,
  updateCheckStarted,
  updateCheckSucceeded,
  updateNotConfigured,
  updateCheckFailed,
  updateDownloadProgress,
  updateDownloaded,
} = updateSlice.actions;

export default updateSlice.reducer;
