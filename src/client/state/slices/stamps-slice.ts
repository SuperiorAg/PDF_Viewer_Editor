// Stamps slice — Phase 7.5 B7 (Riley Wave 3).
// Per docs/ui-spec-phase-7.5.md §7 + docs/architecture-phase-7.5.md §4.1.
//
// Persistence model (architecture §5): the v0.8.0 ship is renderer-only for
// custom stamps — the in-memory list of `StampLibraryEntry` rows is held in
// this slice and rehydrated from the SQLite `stamps_library` table on app
// boot via the `stamps:list` IPC channel David exposes (api-contracts §19.10
// names them `stamps:list` / `stamps:add` / `stamps:remove`, following the
// bookmarks:* repo-pattern). The channel surface is NOT yet exposed on
// `window.pdfApi` as of Wave 3 (open question for Marcus) — the renderer
// calls a typed shim in `services/stamps-api.ts` that returns an in-memory
// list seeded with the 10 built-in text stamps. When David lands the
// channel the shim swaps to the live bridge transparently (same shape as
// `services/api.ts` fallback).
//
// Built-in stamps are SHIPPED, not user-edited. They live in
// `services/builtin-stamps.ts` and merge into the listing at read time.
//
// Sentinel-default discipline (architecture-phase-7.5 cross-check):
// `lastUsedAt: number | null` — null until first use; never a sentinel default.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { RgbColor } from '../../types/ipc-contract';

export type StampKind = 'text' | 'image';

export interface StampLibraryEntry {
  id: string; // built-in: 'builtin:approved' / 'builtin:draft' / ... ; custom: user-uuid
  name: string;
  kind: StampKind;
  /** Visible stamp text (text kind). */
  text?: string;
  /** Foreground color (text kind). */
  color?: RgbColor;
  /** Rendered text-box width in points (text kind). */
  widthPt?: number;
  /** Image data URL — Wave 3 ships text-only stamps; this field is
   * reserved for the v0.9.x image-stamp follow-up (deferred per principal). */
  imageDataUrl?: string;
  isBuiltin: boolean;
  lastUsedAt: number | null;
}

export interface StampPlacementState {
  /** Active stamp ID; null = no placement in progress. */
  stampId: string | null;
  /** True from the moment a stamp is picked until the page click lands it. */
  active: boolean;
}

export interface StampsState {
  /** User-supplied stamps; built-in stamps merge in via the panel selector. */
  customStamps: StampLibraryEntry[];
  /** Add-stamp modal open flag. */
  addModalOpen: boolean;
  placement: StampPlacementState;
  /** Map of stampId -> last-used epoch ms. Drives the "Recently used"
   * row in the panel without touching the persistent custom-stamps list. */
  recentlyUsed: Record<string, number>;
}

const initialState: StampsState = {
  customStamps: [],
  addModalOpen: false,
  placement: { stampId: null, active: false },
  recentlyUsed: {},
};

export const stampsSlice = createSlice({
  name: 'stamps',
  initialState,
  reducers: {
    /** Replaces the renderer-side custom stamps list (e.g. after `stamps:list`). */
    setCustomStamps(state, action: PayloadAction<StampLibraryEntry[]>) {
      state.customStamps = action.payload;
    },
    addCustomStamp(state, action: PayloadAction<StampLibraryEntry>) {
      state.customStamps.push(action.payload);
    },
    removeCustomStamp(state, action: PayloadAction<string>) {
      state.customStamps = state.customStamps.filter((s) => s.id !== action.payload);
    },
    markStampUsed(state, action: PayloadAction<string>) {
      const ts = Date.now();
      const custom = state.customStamps.find((s) => s.id === action.payload);
      if (custom) custom.lastUsedAt = ts;
      state.recentlyUsed[action.payload] = ts;
    },
    setAddModalOpen(state, action: PayloadAction<boolean>) {
      state.addModalOpen = action.payload;
    },
    enterPlacement(state, action: PayloadAction<string>) {
      state.placement.stampId = action.payload;
      state.placement.active = true;
    },
    exitPlacement(state) {
      state.placement.stampId = null;
      state.placement.active = false;
    },
  },
});

export const {
  setCustomStamps,
  addCustomStamp,
  removeCustomStamp,
  markStampUsed,
  setAddModalOpen,
  enterPlacement,
  exitPlacement,
} = stampsSlice.actions;

export default stampsSlice.reducer;
