// Export slice — Phase 1 (PDF → PDF engine selection) + Phase 6 (PDF → Office,
// Image export jobs + queue + modal state).
//
// Phase 1 (pre-Wave 24) state shape carried PDF-to-PDF "Print to PDF" engine
// preference only. Phase 6 extends this slice to also carry:
//   - the multi-step Export modal's draft (format / quality / page range /
//     per-format extras / output path)
//   - the in-flight + recent export jobs (jobs[]; per-job progress events
//     write back here)
//   - the per-format limitations panel's resolved format
//   - last-chosen format for the toolbar quick-action default
//
// Phase 6 discipline (conventions §17):
//   §17.1 read-only-on-source — nothing in this slice mutates the source doc.
//   §17.2 export-bytes-stay-in-main — this slice NEVER holds Uint8Array of
//         export output. Only DTOs (basename + dirHint).
//   §17.4 nullable + late-init — `currentJob`, `recentJobs`, `formatCatalog`,
//         draft's `outputPath` are all nullable; NO sentinel defaults.
//   §17.6 quality-tier defaults are per-format and explicit (never sparse).
//
// Phase 1 fields (preference / inFlightJobId / lastEngineUsed / lastReason /
// progress / warnings) remain on the slice — they're consumed by:
//   - thunks.ts (the PDF-to-PDF save flow)
//   - status-bar/index.tsx (the legacy "Engine: chromium" indicator)
//   - modals/export-engine-dialog/index.tsx
// These fields are NOT Phase 6 surface; the §17 boundary discipline applies
// to the Phase-6 additions below.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  type ExportEnginePreference,
  type ExportFormat,
  type ExportFormatDescriptor,
  type ExportJobRowDto,
  type ExportProgressEvent,
  type ExportQualityTier,
  type ImageExportFormat,
  type PdfExportProgressEvent,
} from '../../types/ipc-contract';

// ---------------------------------------------------------------------------
// Phase 6 — Modal step + draft shape
// ---------------------------------------------------------------------------

/**
 * Multi-step Export modal step (ui-spec.md §15.3).
 *
 * - `format`         — Step 1, format picker
 * - `options`        — Step 2, quality + page-range + per-format extras +
 *                      limitations panel
 * - `confirm`        — Step 3, one-screen summary + START
 * - `running`        — Step 4, surfaces in-flight progress when the modal is
 *                      reopened during a job. The job continues even after the
 *                      modal closes (queue-based; §4.5 of architecture-phase-6).
 */
export type ExportModalStep = 'format' | 'options' | 'confirm' | 'running';

/** Phase 6 per-format extras (modal draft). */
export interface ExportImageOptionsDraft {
  /** When the image sub-picker is active, this is the selected variant. */
  imageFormat: ImageExportFormat;
  dpi: number;
  jpegQuality: number;
  multiPageTiff: boolean;
}

export interface ExportModalDraft {
  /**
   * Format picked at Step 1. Null = nothing chosen yet (Step 1 in progress).
   * Image-family selection is encoded by setting `format` to one of the three
   * image variants directly.
   */
  format: ExportFormat | null;
  /**
   * Quality tier the user has chosen. Null = no override; the per-format
   * default from the catalog is used at submit time. Sparse partial is never
   * sent to main — the thunk reads the explicit tier (or the catalog default)
   * before dispatch (conventions §17.6).
   */
  qualityTier: ExportQualityTier | null;
  /**
   * Inclusive page range. `null` = "all pages" (resolved to {0, pageCount-1}
   * at submit time). NEVER a sentinel zero-range — null is the only "all"
   * signal.
   */
  pageRange: { start: number; end: number } | null;
  /** Default per-format; user can override. */
  includeAnnotations: boolean;
  /** Phase 6 docx-only setting. */
  pageSize: 'letter' | 'a4' | 'auto';
  /** Phase 6 image-format extras (only consulted when `format` is image). */
  imageOptions: ExportImageOptionsDraft;
  /**
   * Absolute output path picked via the dialog:pickExportOutputPath channel.
   * Null until the user clicks Browse… Always provided BEFORE the request
   * crosses to main (no sparse partial; conventions §17.6).
   */
  outputPath: string | null;
}

// ---------------------------------------------------------------------------
// Phase 6 — In-flight job progress (renderer-side mirror)
// ---------------------------------------------------------------------------

/**
 * Live job state populated by `export:progress` events.
 *
 * Per the sentinel-default lesson, `pageIndex` is `null` until the first
 * `extracting-text` / `detecting-tables` / `extracting-images` / `rasterizing`
 * event lands (we do NOT start at 0 — phase 'starting' carries totalPages but
 * has no pageIndex). `phase` mirrors the ExportProgressEvent discriminant
 * verbatim so the UI can branch.
 */
export interface ExportJobProgress {
  jobId: number;
  format: ExportFormat;
  totalPages: number;
  /** 0-based; null until the first per-page event lands. */
  pageIndex: number | null;
  phase: ExportProgressEvent['phase'];
  bytesWritten: number | null;
  pagesCompleted: number | null;
  startedAtMs: number;
  /** Set on phase='failed'; null otherwise. */
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Slice state — Phase 1 + Phase 6
// ---------------------------------------------------------------------------

export interface ExportState {
  // ==== Phase 1 (PDF → PDF Print engine selection) — unchanged ===========
  preference: ExportEnginePreference;
  /** Phase 1 PDF→PDF in-flight job id (string-keyed; legacy). */
  inFlightJobId: string | null;
  lastEngineUsed: 'pdf-lib' | 'chromium' | null;
  lastReason: string | null;
  /** Phase 1 progress event. NULL when no PDF→PDF job is running. */
  progress: PdfExportProgressEvent | null;
  warnings: string[];

  // ==== Phase 6 — Export-to-Office modal + jobs ==========================
  /** Open / step for the multi-step modal. `step === null` means closed. */
  modalStep: ExportModalStep | null;
  /** The user's last-chosen format. Used to pre-select Step 1 on next open. */
  lastChosenFormat: ExportFormat | null;
  /** Modal draft. Reset on close. */
  draft: ExportModalDraft;
  /**
   * The format catalog from `export:listFormats`. Null = not yet loaded;
   * the modal triggers the fetch on mount.
   */
  formatCatalog: ExportFormatDescriptor[] | null;
  /**
   * Currently-running Phase 6 job. Null when no job is running. Drives the
   * status-bar widget + the modal's Step 4 (running) view.
   */
  currentJob: ExportJobProgress | null;
  /**
   * Recent + completed jobs for the current doc, fetched from
   * `export:listJobs`. Null = not yet loaded.
   */
  recentJobs: ExportJobRowDto[] | null;
  /** Latest error from any Phase 6 IPC call; null clears. */
  phase6LastError: string | null;
  /**
   * Time-of-last-completion-toast — used to auto-hide the status-bar
   * widget's "completed" affordance after a few seconds (§15.8 spec).
   */
  lastCompletedAtMs: number | null;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialImageOptions: ExportImageOptionsDraft = {
  imageFormat: 'png',
  dpi: 150,
  jpegQuality: 0.9,
  multiPageTiff: false,
};

const initialDraft: ExportModalDraft = {
  format: null,
  qualityTier: null,
  pageRange: null,
  includeAnnotations: true,
  pageSize: 'auto',
  imageOptions: initialImageOptions,
  outputPath: null,
};

const initialState: ExportState = {
  // Phase 1
  preference: 'auto',
  inFlightJobId: null,
  lastEngineUsed: null,
  lastReason: null,
  progress: null,
  warnings: [],
  // Phase 6
  modalStep: null,
  lastChosenFormat: null,
  draft: initialDraft,
  formatCatalog: null,
  currentJob: null,
  recentJobs: null,
  phase6LastError: null,
  lastCompletedAtMs: null,
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export const exportSlice = createSlice({
  name: 'export',
  initialState,
  reducers: {
    // ==== Phase 1 (unchanged surface) ===================================
    setPreference(state, action: PayloadAction<ExportEnginePreference>) {
      state.preference = action.payload;
    },
    setInFlight(state, action: PayloadAction<string | null>) {
      state.inFlightJobId = action.payload;
      if (action.payload === null) state.progress = null;
    },
    setLastEngine(
      state,
      action: PayloadAction<{
        engine: 'pdf-lib' | 'chromium';
        reason: string;
        warnings: string[];
      }>,
    ) {
      state.lastEngineUsed = action.payload.engine;
      state.lastReason = action.payload.reason;
      state.warnings = action.payload.warnings;
    },
    setProgress(state, action: PayloadAction<PdfExportProgressEvent>) {
      state.progress = action.payload;
    },

    // ==== Phase 6 — Modal lifecycle =====================================
    /**
     * Open the modal at Step 1 (format picker). If a job is currently
     * running (currentJob !== null), open straight at Step 4 (running) so
     * the user sees the in-flight progress (§15.3.4).
     */
    openExportModal(state, action: PayloadAction<{ presetFormat?: ExportFormat } | undefined>) {
      // Reset draft EVERY open (Phase 5 ocr-slice precedent) — except for
      // lastChosenFormat which we restore as the pre-select.
      const preset = action.payload?.presetFormat ?? state.lastChosenFormat;
      state.draft = {
        ...initialDraft,
        // Preserve image-options defaults across opens; users tweak these
        // rarely (DPI etc.) and resetting frustrates power-users.
        imageOptions: state.draft.imageOptions,
        format: preset,
      };
      if (state.currentJob !== null) {
        state.modalStep = 'running';
      } else {
        // If preset is provided we still START at Step 1 (format) so the
        // user can confirm — only the format radio is pre-selected.
        state.modalStep = 'format';
      }
      state.phase6LastError = null;
    },
    closeExportModal(state) {
      state.modalStep = null;
      state.phase6LastError = null;
      // Do NOT clear currentJob — the job continues in the background.
    },
    setModalStep(state, action: PayloadAction<ExportModalStep>) {
      state.modalStep = action.payload;
    },

    // ==== Phase 6 — Format catalog ======================================
    setFormatCatalog(state, action: PayloadAction<ExportFormatDescriptor[]>) {
      state.formatCatalog = action.payload;
    },

    // ==== Phase 6 — Draft edits =========================================
    setDraftFormat(state, action: PayloadAction<ExportFormat>) {
      state.draft.format = action.payload;
      // Per-format default include-annotations from catalog (if loaded).
      // Excel default = false; rest = true. Conventions §17.6 — never
      // sparse: the modal sets explicit value on every format change.
      if (action.payload === 'xlsx') {
        state.draft.includeAnnotations = false;
      } else {
        state.draft.includeAnnotations = true;
      }
      // Reset quality tier override on format change so the catalog
      // default applies next time the modal submits.
      state.draft.qualityTier = null;
      // Image-format selection updates the imageOptions.imageFormat too.
      if (action.payload === 'png' || action.payload === 'jpeg' || action.payload === 'tiff') {
        state.draft.imageOptions.imageFormat = action.payload;
      }
      state.lastChosenFormat = action.payload;
    },
    setDraftQualityTier(state, action: PayloadAction<ExportQualityTier>) {
      state.draft.qualityTier = action.payload;
    },
    setDraftPageRange(state, action: PayloadAction<{ start: number; end: number } | null>) {
      state.draft.pageRange = action.payload;
    },
    setDraftIncludeAnnotations(state, action: PayloadAction<boolean>) {
      state.draft.includeAnnotations = action.payload;
    },
    setDraftPageSize(state, action: PayloadAction<'letter' | 'a4' | 'auto'>) {
      state.draft.pageSize = action.payload;
    },
    setDraftImageOptions(state, action: PayloadAction<Partial<ExportImageOptionsDraft>>) {
      state.draft.imageOptions = {
        ...state.draft.imageOptions,
        ...action.payload,
      };
    },
    setDraftOutputPath(state, action: PayloadAction<string | null>) {
      state.draft.outputPath = action.payload;
    },

    // ==== Phase 6 — Job lifecycle =======================================
    /**
     * Begin tracking a new job. Fired by the thunk after a successful
     * enqueue (the IPC call resolved with `ok: true` and a jobId).
     */
    startJobProgress(
      state,
      action: PayloadAction<{
        jobId: number;
        format: ExportFormat;
        totalPages: number;
      }>,
    ) {
      state.currentJob = {
        jobId: action.payload.jobId,
        format: action.payload.format,
        totalPages: action.payload.totalPages,
        pageIndex: null,
        phase: 'starting',
        bytesWritten: null,
        pagesCompleted: null,
        startedAtMs: Date.now(),
        errorMessage: null,
      };
    },
    /** Apply an `export:progress` event. Out-of-order or stale-job events
     * are dropped silently — they aren't an error condition. */
    applyExportProgressEvent(state, action: PayloadAction<ExportProgressEvent>) {
      const evt = action.payload;
      if (state.currentJob === null || state.currentJob.jobId !== evt.jobId) {
        return;
      }
      state.currentJob.phase = evt.phase;
      switch (evt.phase) {
        case 'starting':
          state.currentJob.totalPages = evt.totalPages;
          break;
        case 'extracting-text':
        case 'detecting-tables':
        case 'extracting-images':
        case 'rasterizing':
          state.currentJob.pageIndex = evt.pageIndex;
          break;
        case 'writing-output':
          state.currentJob.bytesWritten = evt.bytesWritten;
          break;
        case 'completed':
          state.lastCompletedAtMs = Date.now();
          break;
        case 'cancelled':
          state.currentJob.pagesCompleted = evt.pagesCompleted;
          break;
        case 'failed':
          state.currentJob.pagesCompleted = evt.pagesCompleted;
          state.currentJob.errorMessage = evt.error;
          break;
      }
    },
    /** Clear the current-job tracking (call on user dismiss of the
     * post-completion status-bar widget, or on doc-close). */
    clearCurrentJob(state) {
      state.currentJob = null;
    },

    // ==== Phase 6 — Recent jobs list ====================================
    setRecentJobs(state, action: PayloadAction<ExportJobRowDto[]>) {
      state.recentJobs = action.payload;
    },

    // ==== Phase 6 — Errors ==============================================
    setPhase6Error(state, action: PayloadAction<string | null>) {
      state.phase6LastError = action.payload;
    },
  },
});

export const {
  // Phase 1
  setPreference,
  setInFlight,
  setLastEngine,
  setProgress,
  // Phase 6 — modal lifecycle
  openExportModal,
  closeExportModal,
  setModalStep,
  setFormatCatalog,
  // Phase 6 — draft edits
  setDraftFormat,
  setDraftQualityTier,
  setDraftPageRange,
  setDraftIncludeAnnotations,
  setDraftPageSize,
  setDraftImageOptions,
  setDraftOutputPath,
  // Phase 6 — job lifecycle
  startJobProgress,
  applyExportProgressEvent,
  clearCurrentJob,
  setRecentJobs,
  setPhase6Error,
} = exportSlice.actions;

export default exportSlice.reducer;
