// Compare-files slice — Phase 7.5 Wave 7 B2 (Riley).
//
// Drives the Compare Files workspace per docs/ui-spec-phase-7.5.md §2.
// State:
//   - setupDialogOpen — gates the picker modal
//   - session — null until the user clicks Compare and David's
//     pdf:openComparePair returns ok. Carries page-pair list + page counts
//     + display names so the workspace header can render.
//   - viewMode — 'text' | 'visual' | 'side-by-side'
//   - pageResults — per-pair cache keyed by pairIndex. Each entry tracks
//     status ('idle' | 'loading' | 'ready' | 'error') plus the loaded text
//     diff and the visual diff (blob URL + the raw value for the inspector
//     panel's percent / count readout).
//   - inflight — set of pairIndexes whose IPC request is currently pending,
//     so ensurePageLoaded thunks dedupe re-requests (Wave 7 hard rule —
//     "never re-request").
//
// HONESTY CLAUSE (P7.5-L-10):
//   - The sequential-pairing banner string lives here as a named export
//     so the test pins the exact wording. Verbatim per the brief.
//   - The multi-column-footnote string lives here too (David's open
//     question to Riley). Verbatim per the brief.
//   - The visual-render-width disclosure string is a template (uses {{width}})
//     so the workspace component substitutes the actual clamped value.
//   - Orphan labels ("Only on left" / "Only on right") are named exports.
//
// Blob-URL hygiene:
//   - The reducer NEVER calls URL.revokeObjectURL — slices are pure. The
//     thunks-phase7-5-wave7 thunks revoke when the pair is evicted from the
//     cache OR when the session is closed. The selector exposes the list
//     of pair indexes that hold a blob URL so the thunks can iterate cleanly.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type {
  ComparePagePair,
  CompareTextDiffSegment,
  CompareTextDiffSummary,
  PdfCompareTextOnPageValue,
  PdfCompareVisualOnPageValue,
} from '../../types/ipc-contract';

// Slice-local mirror of David's contract types using MUTABLE arrays so the
// Immer drafts the reducer manipulates type-check cleanly. The thunks
// convert the readonly contract shape into this shape at the IPC boundary.
export interface ComparePageTextValue {
  pageNumber: number;
  leftPageIndex: number | null;
  rightPageIndex: number | null;
  diffs: CompareTextDiffSegment[];
  summary: CompareTextDiffSummary;
}

/** Helper used by the thunks to copy David's readonly response into the
 *  mutable slice shape. Exported so the unit tests build fixtures the
 *  same way the runtime path does. */
export function fromContractTextValue(value: PdfCompareTextOnPageValue): ComparePageTextValue {
  return {
    pageNumber: value.pageNumber,
    leftPageIndex: value.leftPageIndex,
    rightPageIndex: value.rightPageIndex,
    diffs: value.diffs.slice(),
    summary: { ...value.summary },
  };
}

/** Slice-local mirror of David's visual response. The PNG fields are
 *  consumed by the thunks (converted to blob URLs) and dropped here. */
export interface ComparePageVisualValue {
  pageNumber: number;
  leftPageIndex: number | null;
  rightPageIndex: number | null;
  width: number;
  height: number;
  diffPixelCount: number;
  totalPixelCount: number;
  diffPercent: number;
}

export function fromContractVisualValue(
  value: PdfCompareVisualOnPageValue,
): ComparePageVisualValue {
  return {
    pageNumber: value.pageNumber,
    leftPageIndex: value.leftPageIndex,
    rightPageIndex: value.rightPageIndex,
    width: value.width,
    height: value.height,
    diffPixelCount: value.diffPixelCount,
    totalPixelCount: value.totalPixelCount,
    diffPercent: value.diffPercent,
  };
}

// ---------------------------------------------------------------------------
// Verbatim honesty strings — P7.5-L-10. Tests assert these exact characters.
// ---------------------------------------------------------------------------

/** Sequential-pairing disclosure shown verbatim above the page list. */
export const COMPARE_SEQUENTIAL_PAIRING_BANNER =
  'Pages are paired sequentially. Smarter content-matching is a future enhancement.';

/** Multi-column footnote (David's open question to Riley — surface honestly). */
export const COMPARE_MULTI_COLUMN_FOOTNOTE =
  'Multi-column documents may show out-of-reading-order text segments. Use the Reading Order overlay to inspect tagged docs.';

/** Visual-mode rendering-width disclosure template. {{width}} substituted at render time. */
export const COMPARE_VISUAL_RENDER_WIDTH_TEMPLATE =
  'Visual comparison renders at {{width}}px for performance.';

/** Orphan-page labels. */
export const COMPARE_ORPHAN_LEFT_LABEL = 'Only on left';
export const COMPARE_ORPHAN_RIGHT_LABEL = 'Only on right';

/** Visual-mode default render width. Kept in sync with David's engine
 *  default (800px). The slice does NOT clamp — the engine does — but
 *  the renderer asks for this default and respects the post-clamp
 *  `width` David echoes back. */
export const COMPARE_DEFAULT_RENDER_WIDTH = 800;

/**
 * Per-page LRU window for compare-files cache eviction.
 *
 * Post-v0.8.0 follow-up (Riley, 2026-06-18, Julian 11.5 + Wave 7 deferral
 * close): a long full-scroll compare session on a 1000+-page document
 * could otherwise accumulate ~3000 live `URL.createObjectURL` blob URLs
 * (diff-mask + left + right per pair). Capping the live window at this
 * many pages bounds the heap. 30 is slightly more than a typical
 * virtualised viewport + overscan, so scroll-back inside the window stays
 * cache-hot.
 *
 * Tradeoff (documented honestly per the brief): this is a heuristic LRU,
 * not a viewport-aware cache. A user who scrolls past the window and then
 * scrolls back will pay a re-load round-trip on the evicted page. The
 * v0.8.0 design accepts that as a memory-ceiling protection — v0.9.0+
 * could promote to a more sophisticated viewport-aware cache if user
 * feedback warrants. The window size was picked to keep the common case
 * (linear scroll, occasional 1–2 page scroll-back) free.
 */
export const COMPARE_LRU_WINDOW_SIZE = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompareViewMode = 'text' | 'visual' | 'side-by-side';

export type ComparePairStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Source for picking a file in the setup dialog. `handle` carries the
 *  numeric DocumentHandle for open-doc picks. */
export type CompareFileSource =
  | { kind: 'open-doc'; handle: number; displayName: string }
  | { kind: 'path'; path: string; displayName: string };

/** Loaded text-mode result. */
export interface ComparePageTextEntry {
  status: ComparePairStatus;
  textValue: ComparePageTextValue | null;
  errorMessage: string | null;
}

/** Loaded visual-mode result. The slice stores a blob URL (created by the
 *  thunk from the base64 PNG) AND the metadata (so the workspace can
 *  show the diff percent / pixel count without a JSON parse). */
export interface ComparePageVisualEntry {
  status: ComparePairStatus;
  /** Object URL for the diff-mask PNG. Revoked on eviction. */
  diffMaskUrl: string | null;
  /** Object URL for the left/baseline render. Null on right-only orphans. */
  leftUrl: string | null;
  /** Object URL for the right/modified render. Null on left-only orphans. */
  rightUrl: string | null;
  visualValue: ComparePageVisualValue | null;
  errorMessage: string | null;
}

export interface ComparePairResults {
  text: ComparePageTextEntry;
  visual: ComparePageVisualEntry;
}

export interface CompareSession {
  /** Opaque session id from David's openComparePair. */
  sessionId: string;
  leftDisplayName: string;
  rightDisplayName: string;
  pageCountLeft: number;
  pageCountRight: number;
  /** Sequential page-pair list returned by openComparePair. The slice
   *  stores a mutable copy (Immer's draft type requires it); consumers
   *  treat it as read-only via TypeScript discipline. */
  pagePairs: ComparePagePair[];
}

export interface CompareSetupState {
  open: boolean;
  left: CompareFileSource | null;
  right: CompareFileSource | null;
  /** True while openComparePair is in flight; gates the Compare button. */
  opening: boolean;
  /** Last open error (renderer-facing string). */
  lastOpenError: string | null;
}

export interface CompareState {
  setup: CompareSetupState;
  session: CompareSession | null;
  viewMode: CompareViewMode;
  /** pairIndex -> loaded text / visual result.  */
  pageResults: Record<number, ComparePairResults>;
  /** Set of pairIndexes whose text-mode IPC is in flight. */
  inflightText: Record<number, true>;
  /** Set of pairIndexes whose visual-mode IPC is in flight. */
  inflightVisual: Record<number, true>;
  /**
   * LRU queue of pairIndexes — index 0 is the most-recently-accessed.
   * Updated whenever a page-result lands. Capped at
   * `COMPARE_LRU_WINDOW_SIZE`; overflow pairs are pushed into
   * `pendingLruEviction` for the thunk layer to revoke + drop.
   */
  pageAccessOrder: number[];
  /**
   * Pair indexes that fell out of the LRU window on the most recent
   * `text|visualRequestSucceeded`. The thunk reads this, revokes any blob
   * URLs the entries held, then dispatches `lruEvictionCompleted` (which
   * clears the queue AND removes the entries from `pageResults`).
   * Always-empty between thunks; a buffer, not durable state.
   */
  pendingLruEviction: number[];
}

const initialSetup: CompareSetupState = {
  open: false,
  left: null,
  right: null,
  opening: false,
  lastOpenError: null,
};

const initialState: CompareState = {
  setup: initialSetup,
  session: null,
  viewMode: 'text',
  pageResults: {},
  inflightText: {},
  inflightVisual: {},
  pageAccessOrder: [],
  pendingLruEviction: [],
};

/**
 * Push `pairIndex` to the front of the LRU queue (or move it there if
 * already present), then drain any pair indexes that fell out of the
 * back of the LRU window into `pendingLruEviction`. Pair indexes that
 * are still in the access window are left untouched.
 *
 * The reducers below call this for both text + visual success — either
 * one "uses" the pair from a memory-pressure standpoint, so the access
 * count merges across modes.
 */
function bumpAccessOrder(state: CompareState, pairIndex: number): void {
  const existing = state.pageAccessOrder.indexOf(pairIndex);
  if (existing !== -1) {
    state.pageAccessOrder.splice(existing, 1);
  }
  state.pageAccessOrder.unshift(pairIndex);
  while (state.pageAccessOrder.length > COMPARE_LRU_WINDOW_SIZE) {
    const evicted = state.pageAccessOrder.pop();
    if (evicted !== undefined && !state.pendingLruEviction.includes(evicted)) {
      state.pendingLruEviction.push(evicted);
    }
  }
}

function emptyEntry(): ComparePairResults {
  return {
    text: { status: 'idle', textValue: null, errorMessage: null },
    visual: {
      status: 'idle',
      diffMaskUrl: null,
      leftUrl: null,
      rightUrl: null,
      visualValue: null,
      errorMessage: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export const compareSlice = createSlice({
  name: 'compare',
  initialState,
  reducers: {
    setupOpened(state) {
      state.setup.open = true;
      state.setup.lastOpenError = null;
    },
    setupClosed(state) {
      state.setup = initialSetup;
    },
    setupLeftPicked(state, action: PayloadAction<CompareFileSource | null>) {
      state.setup.left = action.payload;
      state.setup.lastOpenError = null;
    },
    setupRightPicked(state, action: PayloadAction<CompareFileSource | null>) {
      state.setup.right = action.payload;
      state.setup.lastOpenError = null;
    },
    setupOpeningStarted(state) {
      state.setup.opening = true;
      state.setup.lastOpenError = null;
    },
    setupOpeningFailed(state, action: PayloadAction<string>) {
      state.setup.opening = false;
      state.setup.lastOpenError = action.payload;
    },
    sessionOpened(state, action: PayloadAction<CompareSession>) {
      state.session = action.payload;
      state.setup = initialSetup;
      state.pageResults = {};
      state.inflightText = {};
      state.inflightVisual = {};
      state.pageAccessOrder = [];
      state.pendingLruEviction = [];
      state.viewMode = 'text';
    },
    sessionClosed(state) {
      state.session = null;
      state.pageResults = {};
      state.inflightText = {};
      state.inflightVisual = {};
      state.pageAccessOrder = [];
      state.pendingLruEviction = [];
      state.viewMode = 'text';
    },
    viewModeChanged(state, action: PayloadAction<CompareViewMode>) {
      state.viewMode = action.payload;
    },
    textRequestStarted(state, action: PayloadAction<number>) {
      const pairIndex = action.payload;
      state.inflightText[pairIndex] = true;
      const entry = state.pageResults[pairIndex] ?? emptyEntry();
      entry.text.status = 'loading';
      entry.text.errorMessage = null;
      state.pageResults[pairIndex] = entry;
    },
    textRequestSucceeded(
      state,
      action: PayloadAction<{ pairIndex: number; value: ComparePageTextValue }>,
    ) {
      const { pairIndex, value } = action.payload;
      delete state.inflightText[pairIndex];
      const entry = state.pageResults[pairIndex] ?? emptyEntry();
      entry.text.status = 'ready';
      entry.text.textValue = value;
      entry.text.errorMessage = null;
      state.pageResults[pairIndex] = entry;
      bumpAccessOrder(state, pairIndex);
    },
    textRequestFailed(state, action: PayloadAction<{ pairIndex: number; message: string }>) {
      const { pairIndex, message } = action.payload;
      delete state.inflightText[pairIndex];
      const entry = state.pageResults[pairIndex] ?? emptyEntry();
      entry.text.status = 'error';
      entry.text.errorMessage = message;
      state.pageResults[pairIndex] = entry;
    },
    visualRequestStarted(state, action: PayloadAction<number>) {
      const pairIndex = action.payload;
      state.inflightVisual[pairIndex] = true;
      const entry = state.pageResults[pairIndex] ?? emptyEntry();
      entry.visual.status = 'loading';
      entry.visual.errorMessage = null;
      state.pageResults[pairIndex] = entry;
    },
    visualRequestSucceeded(
      state,
      action: PayloadAction<{
        pairIndex: number;
        value: ComparePageVisualValue;
        diffMaskUrl: string;
        leftUrl: string | null;
        rightUrl: string | null;
      }>,
    ) {
      const { pairIndex, value, diffMaskUrl, leftUrl, rightUrl } = action.payload;
      delete state.inflightVisual[pairIndex];
      const entry = state.pageResults[pairIndex] ?? emptyEntry();
      entry.visual.status = 'ready';
      entry.visual.visualValue = value;
      entry.visual.diffMaskUrl = diffMaskUrl;
      entry.visual.leftUrl = leftUrl;
      entry.visual.rightUrl = rightUrl;
      entry.visual.errorMessage = null;
      state.pageResults[pairIndex] = entry;
      bumpAccessOrder(state, pairIndex);
    },
    visualRequestFailed(state, action: PayloadAction<{ pairIndex: number; message: string }>) {
      const { pairIndex, message } = action.payload;
      delete state.inflightVisual[pairIndex];
      const entry = state.pageResults[pairIndex] ?? emptyEntry();
      entry.visual.status = 'error';
      entry.visual.errorMessage = message;
      state.pageResults[pairIndex] = entry;
    },
    /** Clears the cached entry for a pair index. Thunks call this AFTER
     *  revoking any blob URLs the entry held. Also drops the pair from the
     *  LRU queue + pending-eviction buffer (in case it was about to be
     *  evicted anyway). */
    pairEvicted(state, action: PayloadAction<number>) {
      const pairIndex = action.payload;
      delete state.pageResults[pairIndex];
      const accessIdx = state.pageAccessOrder.indexOf(pairIndex);
      if (accessIdx !== -1) state.pageAccessOrder.splice(accessIdx, 1);
      const pendingIdx = state.pendingLruEviction.indexOf(pairIndex);
      if (pendingIdx !== -1) state.pendingLruEviction.splice(pendingIdx, 1);
    },
    /**
     * Mark the LRU-driven eviction as fully processed. The thunk revokes
     * outstanding blob URLs first (per the close-thunk pattern), then
     * dispatches this to drop the actual `pageResults` entries + clear the
     * pending queue in one atomic reducer call.
     *
     * Accepts the exact list the thunk just processed so the slice does
     * not race against newer LRU pushes between the read + the dispatch.
     */
    lruEvictionCompleted(state, action: PayloadAction<number[]>) {
      for (const pairIndex of action.payload) {
        delete state.pageResults[pairIndex];
        // pageAccessOrder doesn't carry these pairs (they fell off the
        // back) but clear defensively in case a same-tick re-load brought
        // them back to the head.
        const idx = state.pageAccessOrder.indexOf(pairIndex);
        if (idx !== -1) state.pageAccessOrder.splice(idx, 1);
      }
      // Drop the matching pending-eviction entries; leave any newer
      // overflow that landed between the thunk read + dispatch in place.
      state.pendingLruEviction = state.pendingLruEviction.filter(
        (idx) => !action.payload.includes(idx),
      );
    },
    /** Resets to initial. The thunks revoke any outstanding blob URLs first. */
    cleared() {
      return initialState;
    },
  },
});

export const {
  setupOpened,
  setupClosed,
  setupLeftPicked,
  setupRightPicked,
  setupOpeningStarted,
  setupOpeningFailed,
  sessionOpened,
  sessionClosed,
  viewModeChanged,
  textRequestStarted,
  textRequestSucceeded,
  textRequestFailed,
  visualRequestStarted,
  visualRequestSucceeded,
  visualRequestFailed,
  pairEvicted,
  lruEvictionCompleted,
  cleared,
} = compareSlice.actions;

export default compareSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

interface RootSlice {
  compare: CompareState;
}

export function selectCompareSetup(state: RootSlice): CompareSetupState {
  return state.compare.setup;
}

export function selectCompareSetupCanCompare(state: RootSlice): boolean {
  const { left, right, opening } = state.compare.setup;
  return left !== null && right !== null && !opening;
}

export function selectCompareSession(state: RootSlice): CompareSession | null {
  return state.compare.session;
}

export function selectCompareIsActive(state: RootSlice): boolean {
  return state.compare.session !== null;
}

export function selectCompareViewMode(state: RootSlice): CompareViewMode {
  return state.compare.viewMode;
}

export function selectComparePageResults(state: RootSlice): Record<number, ComparePairResults> {
  return state.compare.pageResults;
}

export function selectComparePairEntry(
  state: RootSlice,
  pairIndex: number,
): ComparePairResults | undefined {
  return state.compare.pageResults[pairIndex];
}

export function selectComparePairTextStatus(
  state: RootSlice,
  pairIndex: number,
): ComparePairStatus {
  return state.compare.pageResults[pairIndex]?.text.status ?? 'idle';
}

export function selectComparePairVisualStatus(
  state: RootSlice,
  pairIndex: number,
): ComparePairStatus {
  return state.compare.pageResults[pairIndex]?.visual.status ?? 'idle';
}

/** Visited pair indexes that currently hold at least one blob URL — used
 *  by the close / clear thunks to revoke before evicting. */
export function selectCompareEvictableBlobs(
  state: RootSlice,
): ReadonlyArray<{ pairIndex: number; urls: string[] }> {
  const out: { pairIndex: number; urls: string[] }[] = [];
  for (const [k, entry] of Object.entries(state.compare.pageResults)) {
    const idx = Number(k);
    const urls: string[] = [];
    if (entry.visual.diffMaskUrl) urls.push(entry.visual.diffMaskUrl);
    if (entry.visual.leftUrl) urls.push(entry.visual.leftUrl);
    if (entry.visual.rightUrl) urls.push(entry.visual.rightUrl);
    if (urls.length > 0) out.push({ pairIndex: idx, urls });
  }
  return out;
}

/** Pair-level "any change" used for the badge color: green = no change,
 *  yellow = text-only OR visual-only, red = both. Until both modes load
 *  the badge stays gray (idle) — surfaced as null here. */
export type CompareBadgeColor = 'green' | 'yellow' | 'red' | 'gray';

export function selectComparePairBadgeColor(
  state: RootSlice,
  pairIndex: number,
): CompareBadgeColor {
  const entry = state.compare.pageResults[pairIndex];
  if (!entry) return 'gray';
  // Conservative: BOTH modes must be ready before we color the badge.
  // Otherwise the user sees a transient 'green' for the visual-only loaded
  // case (Side-by-side mode loads visual first) and the badge would flip
  // to yellow/red once text catches up. Gray = "still deciding".
  const textReady = entry.text.status === 'ready';
  const visualReady = entry.visual.status === 'ready';
  if (!textReady || !visualReady) return 'gray';
  const textChanged = entry.text.textValue?.summary.changed ?? false;
  const visualChanged = (entry.visual.visualValue?.diffPixelCount ?? 0) > 0;
  if (textChanged && visualChanged) return 'red';
  if (textChanged || visualChanged) return 'yellow';
  return 'green';
}

export function selectCompareTextInflight(state: RootSlice, pairIndex: number): boolean {
  return state.compare.inflightText[pairIndex] === true;
}

export function selectCompareVisualInflight(state: RootSlice, pairIndex: number): boolean {
  return state.compare.inflightVisual[pairIndex] === true;
}

/** Current LRU access order — most-recent first. Exposed for tests; the
 *  thunks don't normally read this. */
export function selectCompareAccessOrder(state: RootSlice): readonly number[] {
  return state.compare.pageAccessOrder;
}

/** Pair indexes the LRU window pushed out — the thunk reads, processes,
 *  then dispatches `lruEvictionCompleted` to clear. Always-empty between
 *  thunks, by design. */
export function selectComparePendingLruEviction(state: RootSlice): readonly number[] {
  return state.compare.pendingLruEviction;
}

/**
 * For each pair index in `pendingLruEviction`, the list of blob URLs the
 * entry currently holds (visual mode only — text mode has none). Used by
 * the eviction thunk to revoke before dispatching `lruEvictionCompleted`.
 */
export function selectComparePendingEvictionBlobs(
  state: RootSlice,
): ReadonlyArray<{ pairIndex: number; urls: string[] }> {
  const out: { pairIndex: number; urls: string[] }[] = [];
  for (const pairIndex of state.compare.pendingLruEviction) {
    const entry = state.compare.pageResults[pairIndex];
    if (!entry) {
      // Already gone — push an empty so the thunk still dispatches the
      // completion for the index (idempotent guard).
      out.push({ pairIndex, urls: [] });
      continue;
    }
    const urls: string[] = [];
    if (entry.visual.diffMaskUrl) urls.push(entry.visual.diffMaskUrl);
    if (entry.visual.leftUrl) urls.push(entry.visual.leftUrl);
    if (entry.visual.rightUrl) urls.push(entry.visual.rightUrl);
    out.push({ pairIndex, urls });
  }
  return out;
}
