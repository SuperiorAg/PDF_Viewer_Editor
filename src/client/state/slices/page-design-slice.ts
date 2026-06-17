// Page design slice — Phase 7.5 B4 (Riley Wave 4).
//
// Drives the three-tab Page Design modal (Watermark / Header & Footer /
// Background). Each tab holds its own form-state nested under the slice;
// the modal's active tab discriminator lives at the top level. Apply
// dispatches through the page-design-modal's onApply handler which posts
// to the relevant `pdf:applyWatermark` / `pdf:applyHeaderFooter` /
// `pdf:applyBackground` channel (David Wave 3, already shipped).
//
// Per architecture-phase-7.5 §4.3 the engine is shared across the three
// kinds via a discriminated union on the wire; the slice mirrors that
// discrimination so the modal's tabs share form state without one tab's
// edit polluting another's.
//
// Cross-check vs sentinel-default lesson:
// - `imageBytes` is `null` when no image picked (not a sentinel)
// - `lastAppliedAt` is `null` until first apply succeeds (not a sentinel)
// - `range.pages` is the literal `''` empty string for "no pages typed yet"
//   (the validation flags this; not a sentinel)

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { PdfWatermarkPosition, PdfPageDesignTarget } from '../../types/ipc-contract';

export type PageDesignTab = 'watermark' | 'header-footer' | 'background';

export type PageDesignTargetKind = 'all' | 'range' | 'current';

export interface PageDesignRange {
  kind: PageDesignTargetKind;
  /** When kind === 'range' this is the textual page-range entry
   *  ("1-5,8,10-12"). Empty string until typed. */
  pages: string;
}

export interface WatermarkForm {
  source: 'text' | 'image';
  text: string;
  fontSize: number;
  /** #RRGGBB. */
  fontColor: string;
  rotationDegrees: number;
  /** 0..1. */
  opacity: number;
  position: PdfWatermarkPosition;
  layer: 'overlay' | 'underlay';
  /** Bytes for image source; null for text. */
  imageBytes: Uint8Array | null;
  /** File name display label. */
  imageFileName: string | null;
}

export interface HeaderFooterForm {
  /** Header strip values. */
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  headerFontSize: number;
  /** Footer strip values. */
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  footerFontSize: number;
  marginTop: number;
  marginBottom: number;
  startPageNumber: number;
  includeTotalPages: boolean;
}

export interface BackgroundForm {
  source: 'color' | 'image';
  /** #RRGGBB for the color source. */
  color: string;
  imageBytes: Uint8Array | null;
  imageFileName: string | null;
  /** 0..1 — only used for image. */
  opacity: number;
}

export interface PageDesignState {
  open: boolean;
  activeTab: PageDesignTab;
  range: PageDesignRange;
  watermark: WatermarkForm;
  headerFooter: HeaderFooterForm;
  background: BackgroundForm;
  applying: boolean;
  lastAppliedAt: number | null;
  lastError: string | null;
}

const DEFAULT_WATERMARK: WatermarkForm = {
  source: 'text',
  text: 'DRAFT',
  fontSize: 96,
  fontColor: '#FF0000',
  rotationDegrees: 45,
  opacity: 0.3,
  position: 'center',
  layer: 'overlay',
  imageBytes: null,
  imageFileName: null,
};

const DEFAULT_HEADER_FOOTER: HeaderFooterForm = {
  headerLeft: '',
  headerCenter: '',
  headerRight: '',
  headerFontSize: 10,
  footerLeft: '',
  footerCenter: '{page} / {totalPages}',
  footerRight: '',
  footerFontSize: 10,
  marginTop: 24,
  marginBottom: 24,
  startPageNumber: 1,
  includeTotalPages: true,
};

const DEFAULT_BACKGROUND: BackgroundForm = {
  source: 'color',
  color: '#FFFFFF',
  imageBytes: null,
  imageFileName: null,
  opacity: 1,
};

const initialState: PageDesignState = {
  open: false,
  activeTab: 'watermark',
  range: { kind: 'all', pages: '' },
  watermark: DEFAULT_WATERMARK,
  headerFooter: DEFAULT_HEADER_FOOTER,
  background: DEFAULT_BACKGROUND,
  applying: false,
  lastAppliedAt: null,
  lastError: null,
};

export const pageDesignSlice = createSlice({
  name: 'pageDesign',
  initialState,
  reducers: {
    openPageDesign(state, action: PayloadAction<PageDesignTab>) {
      state.open = true;
      state.activeTab = action.payload;
      state.lastError = null;
    },
    closePageDesign(state) {
      state.open = false;
      state.applying = false;
    },
    setActiveTab(state, action: PayloadAction<PageDesignTab>) {
      state.activeTab = action.payload;
    },
    setRange(state, action: PayloadAction<PageDesignRange>) {
      state.range = action.payload;
    },
    updateWatermark(state, action: PayloadAction<Partial<WatermarkForm>>) {
      state.watermark = { ...state.watermark, ...action.payload };
    },
    updateHeaderFooter(state, action: PayloadAction<Partial<HeaderFooterForm>>) {
      state.headerFooter = { ...state.headerFooter, ...action.payload };
    },
    updateBackground(state, action: PayloadAction<Partial<BackgroundForm>>) {
      state.background = { ...state.background, ...action.payload };
    },
    setApplying(state, action: PayloadAction<boolean>) {
      state.applying = action.payload;
    },
    setLastError(state, action: PayloadAction<string | null>) {
      state.lastError = action.payload;
    },
    markApplied(state) {
      state.lastAppliedAt = Date.now();
      state.applying = false;
      state.lastError = null;
    },
    resetPageDesign() {
      return initialState;
    },
  },
});

export const {
  openPageDesign,
  closePageDesign,
  setActiveTab,
  setRange,
  updateWatermark,
  updateHeaderFooter,
  updateBackground,
  setApplying,
  setLastError,
  markApplied,
  resetPageDesign,
} = pageDesignSlice.actions;

export default pageDesignSlice.reducer;

// ============================================================================
// Pure helpers — used by the modal + the apply dispatcher.
// ============================================================================

/**
 * Parse a textual page range ("1-5,8,10-12") into a sorted unique 0-based
 * array. Returns null on syntax error. Validates against `pageCount` and
 * silently drops out-of-range entries (the modal renders a warning).
 */
export function parsePageRange(text: string, pageCount: number): number[] | null {
  const tokens = text
    .split(/[,\s]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const set = new Set<number>();
  for (const tok of tokens) {
    const dash = tok.indexOf('-');
    if (dash === -1) {
      const n = Number(tok);
      if (!Number.isInteger(n) || n < 1) return null;
      if (n <= pageCount) set.add(n - 1);
      continue;
    }
    const start = Number(tok.slice(0, dash));
    const end = Number(tok.slice(dash + 1));
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 1 || end < start) return null;
    for (let i = start; i <= end; i++) {
      if (i <= pageCount) set.add(i - 1);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Materialize the slice's range into the on-wire `PdfPageDesignTarget` shape.
 * Returns `null` if the range is invalid.
 */
export function rangeToTarget(
  range: PageDesignRange,
  currentPage: number,
  pageCount: number,
): PdfPageDesignTarget | null {
  if (range.kind === 'all') return 'all';
  if (range.kind === 'current') return [currentPage];
  const arr = parsePageRange(range.pages, pageCount);
  if (arr === null || arr.length === 0) return null;
  return arr;
}
