// OCR slice — Phase 5 OCR workflow state.
// Per docs/architecture-phase-5.md §2.3 and docs/ui-spec.md §14.3-§14.5.
//
// =============================================================================
// What lives in this slice (and what does NOT)
// -----------------------------------------------------------------------------
// LIVES HERE (renderer-side state, conventions §16.2 boundary discipline):
//   - which Phase-5 modal is open (run, language-pack-manager) — separate from
//     ui-slice's `activeModal` so OCR can compose with the existing modal
//     pipeline (the same way Phase-4 signatures-slice owns its own modal flag).
//   - language pack catalog + installed-pack DTOs (NEVER the file paths)
//   - in-flight job state (jobId, current phase, page progress, per-pack
//     download progress) — populated by ocr:progress events
//   - the current document's loaded OcrJobSummary (set by runOcrOnDocumentThunk
//     or by loadOcrResultsThunk on doc open)
//   - confidence-overlay visibility per session
//   - the run-modal draft (langs, page range, preprocess, sign-invalidate
//     confirm acknowledgement)
//
// DOES NOT LIVE HERE (per conventions §16.2):
//   - raster bytes — those stay in main; the renderer reads via pdfjs against
//     the existing fs:readBytesByHandle channel
//   - file paths to language packs — `LanguagePack` (renderer-facing DTO)
//     intentionally OMITS `filePath`; only main holds those
//   - the .traineddata.gz contents — pure main-process concern
//
// Anti-stub-shipped-with-TODO (conventions §16.3): per-page progress and
// summary are nullable + late-init. We NEVER store a sentinel empty array; the
// renderer reads `currentSummary === null` as "no job has completed for this
// doc" and renders a placeholder, NOT a zero-word overlay.
// =============================================================================

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  type LanguagePack,
  type LanguagePackCatalogEntry,
  type OcrJobSummary,
  type OcrLanguagePackDownloadProgressEvent,
  type OcrPageResult,
  type OcrProgressEvent,
  type PreprocessOptions,
} from '../../types/ipc-contract';

// ----------------------------------------------------------------------------
// Modal kind — separate from ui-slice's activeModal so OCR composes with
// other modals (e.g. Settings open AND OCR closed); mirrors Phase 4 signatures.
// ----------------------------------------------------------------------------

export type OcrModalKind = 'none' | 'run' | 'language-pack-manager' | 'scan-placeholder';

export type OcrRunStep = 'configure' | 'confirm-invalidate' | 'running' | 'done';

// ----------------------------------------------------------------------------
// Draft state for the run modal — the user's in-progress configuration.
// pageRange.end === null means "all pages" (computed at submit time from the
// current doc). Nullable + late-init per the sentinel-default lesson.
// ----------------------------------------------------------------------------

export interface OcrRunDraft {
  langs: string[];
  /** null = ALL pages; otherwise inclusive range. */
  pageRange: { start: number; end: number } | null;
  preprocess: PreprocessOptions;
  /** True once the user clicks "Continue and invalidate" on the §6 prompt. */
  invalidateSignaturesAcknowledged: boolean;
}

// ----------------------------------------------------------------------------
// In-flight job state — populated by ocr:progress events. Null when no job
// is running for this session.
// ----------------------------------------------------------------------------

export interface OcrJobProgress {
  jobId: number;
  totalPages: number;
  /** Last reported pageIndex (1-based for UI; -1 until the first event lands). */
  pageIndex: number;
  /** Current pipeline phase from OcrProgressEvent. */
  phase: OcrProgressEvent['phase'];
  /** Mean confidence so far; null until at least one page completes. */
  confidenceSoFar: number | null;
  startedAtMs: number;
}

// ----------------------------------------------------------------------------
// Per-pack download progress — keyed by lang code.
// ----------------------------------------------------------------------------

export interface OcrPackDownloadProgress {
  lang: string;
  phase: OcrLanguagePackDownloadProgressEvent['phase'];
  bytesDownloaded: number;
  totalBytes: number;
  error: string | null;
}

// ----------------------------------------------------------------------------
// Slice state shape
// ----------------------------------------------------------------------------

export interface OcrState {
  /** Which OCR modal is open. Separate from ui-slice.activeModal. */
  openModal: OcrModalKind;
  /** Step within the run modal. */
  runStep: OcrRunStep;
  /** Draft config the user is assembling. */
  draft: OcrRunDraft;
  /** Live job state during a run (and on the 'done' step after completion). */
  jobProgress: OcrJobProgress | null;
  /**
   * Last-completed summary for the CURRENT document. Set by
   * runOcrOnDocumentThunk on success and by loadOcrResultsThunk on doc open.
   * Nullable late-init — NEVER an empty array. Conventions §16.3.2.
   */
  currentSummary: OcrJobSummary | null;
  /**
   * Per-page results for the current doc, keyed by page index. Populated
   * lazily; entries are added as pages are loaded for the confidence overlay
   * or the OCR results panel.
   */
  pageResultsByPage: Record<number, OcrPageResult>;
  /** Catalog data for the run modal language picker + language-pack manager. */
  installedPacks: LanguagePack[];
  downloadablePacks: LanguagePackCatalogEntry[];
  /** Per-pack download progress, keyed by lang code. */
  downloadProgress: Record<string, OcrPackDownloadProgress>;
  /** Current value of `ocr.defaultLang` — populated by detectLanguages. */
  defaultLang: string;
  /** Confidence overlay visibility for the current session. */
  overlayVisible: boolean;
  /** Threshold for low-confidence highlighting; default 60 per P5-L-6. */
  lowConfidenceThreshold: number;
  /** Latest error from any OCR IPC call; null clears. */
  lastError: string | null;
  /** Free-text search filter for the OCR results panel. */
  resultsPanelSearch: string;
}

// ----------------------------------------------------------------------------
// Initial state — explicit nulls, NO sentinel defaults.
// ----------------------------------------------------------------------------

const initialDraft: OcrRunDraft = {
  langs: ['eng'],
  pageRange: null,
  preprocess: { deskew: true, denoise: false, contrastBoost: false },
  invalidateSignaturesAcknowledged: false,
};

const initialState: OcrState = {
  openModal: 'none',
  runStep: 'configure',
  draft: initialDraft,
  jobProgress: null,
  currentSummary: null,
  pageResultsByPage: {},
  installedPacks: [],
  downloadablePacks: [],
  downloadProgress: {},
  defaultLang: 'eng',
  overlayVisible: false,
  lowConfidenceThreshold: 60,
  lastError: null,
  resultsPanelSearch: '',
};

// ----------------------------------------------------------------------------
// Slice
// ----------------------------------------------------------------------------

export const ocrSlice = createSlice({
  name: 'ocr',
  initialState,
  reducers: {
    openRunModal(state) {
      state.openModal = 'run';
      state.runStep = 'configure';
      // Reset draft per-session, but keep the user's preferred lang from the
      // catalog if we have it. defaultLang has already been populated by
      // detectLanguages on doc-open if the user opened a document.
      state.draft = {
        ...initialDraft,
        langs: [state.defaultLang || 'eng'],
      };
      state.lastError = null;
    },
    openLanguagePackManagerModal(state) {
      state.openModal = 'language-pack-manager';
      state.lastError = null;
    },
    openScanPlaceholderModal(state) {
      state.openModal = 'scan-placeholder';
    },
    closeModal(state) {
      // Note: if a job is running, the modal close is gated at the component
      // level (the X button confirms cancel first). By the time this action
      // fires, the cancel-job thunk has either been dispatched or the job is
      // already terminal.
      state.openModal = 'none';
      state.runStep = 'configure';
    },
    setRunStep(state, action: PayloadAction<OcrRunStep>) {
      state.runStep = action.payload;
    },

    // Draft edits ---------------------------------------------------------
    setDraftLangs(state, action: PayloadAction<string[]>) {
      state.draft.langs = action.payload;
    },
    toggleDraftLang(state, action: PayloadAction<string>) {
      const i = state.draft.langs.indexOf(action.payload);
      if (i >= 0) {
        // Refuse to remove the LAST lang — at least one must be selected.
        if (state.draft.langs.length > 1) {
          state.draft.langs.splice(i, 1);
        }
      } else {
        state.draft.langs.push(action.payload);
      }
    },
    setDraftPageRange(state, action: PayloadAction<{ start: number; end: number } | null>) {
      state.draft.pageRange = action.payload;
    },
    setDraftPreprocess(state, action: PayloadAction<Partial<PreprocessOptions>>) {
      state.draft.preprocess = {
        ...state.draft.preprocess,
        ...action.payload,
      };
    },
    acknowledgeInvalidateSignatures(state, action: PayloadAction<boolean>) {
      state.draft.invalidateSignaturesAcknowledged = action.payload;
    },

    // Catalog data --------------------------------------------------------
    setInstalledPacks(state, action: PayloadAction<LanguagePack[]>) {
      state.installedPacks = action.payload;
    },
    setDownloadablePacks(state, action: PayloadAction<LanguagePackCatalogEntry[]>) {
      state.downloadablePacks = action.payload;
    },
    setDefaultLang(state, action: PayloadAction<string>) {
      state.defaultLang = action.payload;
    },

    // Job lifecycle -------------------------------------------------------
    startJobProgress(state, action: PayloadAction<{ jobId: number; totalPages: number }>) {
      state.jobProgress = {
        jobId: action.payload.jobId,
        totalPages: action.payload.totalPages,
        pageIndex: -1,
        phase: 'starting',
        confidenceSoFar: null,
        startedAtMs: Date.now(),
      };
      state.runStep = 'running';
    },
    applyProgressEvent(state, action: PayloadAction<OcrProgressEvent>) {
      const evt = action.payload;
      // Only apply events that belong to our active job. Out-of-order or
      // stale-job events are dropped silently — they aren't an error condition.
      if (state.jobProgress === null || state.jobProgress.jobId !== evt.jobId) {
        return;
      }
      state.jobProgress.phase = evt.phase;
      if (
        evt.phase === 'rasterizing' ||
        evt.phase === 'preprocessing' ||
        evt.phase === 'composing-text-behind-image' ||
        evt.phase === 'writing-output'
      ) {
        state.jobProgress.pageIndex = evt.pageIndex;
      } else if (evt.phase === 'recognizing') {
        state.jobProgress.pageIndex = evt.pageIndex;
        state.jobProgress.confidenceSoFar = evt.confidenceSoFar;
      } else if (evt.phase === 'completed') {
        state.currentSummary = evt.summary;
        if (evt.summary.pageResults) {
          // Index page results by pageIndex for fast lookup.
          for (const pr of evt.summary.pageResults) {
            state.pageResultsByPage[pr.pageIndex] = pr;
          }
        }
        state.runStep = 'done';
      } else if (evt.phase === 'cancelled' || evt.phase === 'failed') {
        // Stay on 'running' so the modal can render the error/cancelled state
        // alongside the partial progress — the user clicks Done to exit.
        state.runStep = 'done';
        if (evt.phase === 'failed') {
          state.lastError = evt.error;
        }
      }
    },
    setCurrentSummary(state, action: PayloadAction<OcrJobSummary | null>) {
      state.currentSummary = action.payload;
      if (action.payload?.pageResults) {
        // Replace the cache; this is called on doc-open / explicit reload.
        state.pageResultsByPage = {};
        for (const pr of action.payload.pageResults) {
          state.pageResultsByPage[pr.pageIndex] = pr;
        }
      } else if (action.payload === null) {
        state.pageResultsByPage = {};
      }
    },
    clearJobProgress(state) {
      state.jobProgress = null;
    },

    // Language pack download progress ------------------------------------
    applyDownloadProgressEvent(state, action: PayloadAction<OcrLanguagePackDownloadProgressEvent>) {
      const evt = action.payload;
      const existing = state.downloadProgress[evt.lang];
      const totalBytes =
        evt.phase === 'starting' || evt.phase === 'downloading'
          ? evt.totalBytes
          : (existing?.totalBytes ?? 0);
      const bytesDownloaded =
        evt.phase === 'downloading' ? evt.bytesDownloaded : (existing?.bytesDownloaded ?? 0);
      const error = evt.phase === 'failed' ? evt.error : null;
      state.downloadProgress[evt.lang] = {
        lang: evt.lang,
        phase: evt.phase,
        bytesDownloaded,
        totalBytes,
        error,
      };
    },
    clearDownloadProgress(state, action: PayloadAction<string>) {
      delete state.downloadProgress[action.payload];
    },

    // Overlay + UI --------------------------------------------------------
    setOverlayVisible(state, action: PayloadAction<boolean>) {
      state.overlayVisible = action.payload;
    },
    toggleOverlay(state) {
      state.overlayVisible = !state.overlayVisible;
    },
    setLowConfidenceThreshold(state, action: PayloadAction<number>) {
      // Clamp 0..100 at the slice boundary — UI may pass an unbounded number.
      // We deliberately accept fractional thresholds; consumers compare against
      // Tesseract's 0..100 float scale.
      const v = action.payload;
      state.lowConfidenceThreshold = Math.max(0, Math.min(100, v));
    },
    setError(state, action: PayloadAction<string | null>) {
      state.lastError = action.payload;
    },
    setResultsPanelSearch(state, action: PayloadAction<string>) {
      state.resultsPanelSearch = action.payload;
    },

    resetOcrState() {
      return initialState;
    },
  },
});

export const {
  openRunModal,
  openLanguagePackManagerModal,
  openScanPlaceholderModal,
  closeModal: closeOcrModal,
  setRunStep,
  setDraftLangs,
  toggleDraftLang,
  setDraftPageRange,
  setDraftPreprocess,
  acknowledgeInvalidateSignatures,
  setInstalledPacks,
  setDownloadablePacks,
  setDefaultLang,
  startJobProgress,
  applyProgressEvent,
  setCurrentSummary,
  clearJobProgress,
  applyDownloadProgressEvent,
  clearDownloadProgress,
  setOverlayVisible,
  toggleOverlay,
  setLowConfidenceThreshold,
  setError: setOcrError,
  setResultsPanelSearch,
  resetOcrState,
} = ocrSlice.actions;

export default ocrSlice.reducer;
