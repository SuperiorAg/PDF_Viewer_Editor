// Phase 6 thunks — Export-to-Office engine integration.
// Per docs/architecture-phase-6.md §2.3 + docs/api-contracts.md §17 + docs/conventions.md §17.
//
// Naming + structure mirrors `thunks-phase5.ts`. Each thunk:
//   1. Calls the matching `apiExport.*` (or `apiDialogPhase6.*`) method.
//   2. Pattern-matches the Result<T, E> discriminant.
//   3. Dispatches success / failure actions into the export slice.
//
// Per conventions §17:
//   - The renderer never touches `docx` / `exceljs` / `pptxgenjs` / `@napi-rs/canvas`
//     directly (§17.2 export-bytes-stay-in-main).
//   - Output bytes never cross into the renderer (§17.2); only basename +
//     dirHint + jobId DTOs.
//   - qualityTier is ALWAYS sent explicitly (§17.6); the resolver helper
//     materializes per-format catalog defaults at dispatch time.
//   - Nullable + late-init job state — no sentinel defaults (§17.4).

import { createAsyncThunk } from '@reduxjs/toolkit';

import { apiDialogPhase6, apiExport } from '../services/api';
import {
  type DocumentHandle,
  type ExportFormat,
  type ExportProgressEvent,
  type ExportQualityTier,
  type ImageExportFormat,
} from '../types/ipc-contract';

import {
  applyExportProgressEvent,
  clearCurrentJob,
  closeExportModal,
  setDraftOutputPath,
  setFormatCatalog,
  setPhase6Error,
  setRecentJobs,
  startJobProgress,
} from './slices/export-slice';
import { pushToast } from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';

// ============================================================================
// listExportFormatsThunk — populate the format catalog on app + modal open.
// ============================================================================

export const listExportFormatsThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('export/listFormats', async (_arg, { dispatch }) => {
  try {
    const res = await apiExport.listFormats({});
    if (!res.ok) {
      // The handler is documented as infallible (error type = 'never'), so
      // reaching here is a bridge-unavailable fallback. Quiet failure.
      return;
    }
    dispatch(setFormatCatalog(res.value.formats));
  } catch {
    // Best-effort hydration; swallow.
  }
});

// ============================================================================
// pickExportOutputPathThunk — open the SAVE-AS dialog; write result to draft.
// ============================================================================

export interface PickExportOutputPathArg {
  defaultBasename: string;
  format: ExportFormat;
}

export const pickExportOutputPathThunk = createAsyncThunk<
  string | null,
  PickExportOutputPathArg,
  { dispatch: AppDispatch; state: RootState }
>('export/pickOutputPath', async (arg, { dispatch }) => {
  try {
    const res = await apiDialogPhase6.pickExportOutputPath({
      defaultBasename: arg.defaultBasename,
      format: arg.format,
    });
    if (!res.ok) {
      dispatch(setPhase6Error(res.message));
      return null;
    }
    dispatch(setDraftOutputPath(res.value.outputPath));
    return res.value.outputPath;
  } catch (e) {
    dispatch(setPhase6Error(e instanceof Error ? e.message : 'Failed to pick output path.'));
    return null;
  }
});

// ============================================================================
// startExportThunk — dispatch the right export channel based on format.
//
// Composes the request from the slice's draft + the resolved quality tier.
// On enqueue success, dispatches startJobProgress so the status-bar widget +
// modal Step 4 (running) view can begin tracking. The IPC promise resolves
// when the job COMPLETES (long-running, per api-contracts §17.1) — the thunk
// returns after that and dispatches the final state.
// ============================================================================

export interface StartExportThunkArg {
  handle: DocumentHandle;
  format: ExportFormat;
  qualityTier: ExportQualityTier | 'n/a';
  pageRange: { start: number; end: number };
  includeAnnotations: boolean;
  pageSize: 'letter' | 'a4' | 'auto';
  outputPath: string;
  /** Image-format-specific options. Required when format is image; ignored otherwise. */
  imageOptions: {
    imageFormat: ImageExportFormat;
    dpi: number;
    jpegQuality: number;
    multiPageTiff: boolean;
  };
}

export const startExportThunk = createAsyncThunk<
  { ok: boolean; jobId: number | null },
  StartExportThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('export/start', async (arg, { dispatch }) => {
  try {
    // Branch by format and call the appropriate channel.
    if (arg.format === 'docx') {
      // qualityTier must be a real tier (not 'n/a') for office formats.
      const tier: ExportQualityTier =
        arg.qualityTier === 'n/a' ? 'layout-preserving' : arg.qualityTier;
      const res = await apiExport.toDocx({
        handle: arg.handle,
        pageRange: arg.pageRange,
        qualityTier: tier,
        includeAnnotations: arg.includeAnnotations,
        pageSize: arg.pageSize,
        outputPath: arg.outputPath,
      });
      if (!res.ok) {
        dispatch(setPhase6Error(res.message));
        dispatch(
          pushToast({
            kind: 'error',
            message: `Export to Word failed: ${res.message}`,
          }),
        );
        return { ok: false, jobId: null };
      }
      // Completion already streamed via export:progress, but make sure the
      // toast lands on success.
      dispatch(
        pushToast({
          kind: 'success',
          message: `Word export complete: ${res.value.summary.outputBasename}`,
        }),
      );
      return { ok: true, jobId: res.value.jobId };
    }
    if (arg.format === 'xlsx') {
      const tier: ExportQualityTier = arg.qualityTier === 'n/a' ? 'text-only' : arg.qualityTier;
      const res = await apiExport.toXlsx({
        handle: arg.handle,
        pageRange: arg.pageRange,
        qualityTier: tier,
        includeAnnotations: arg.includeAnnotations,
        outputPath: arg.outputPath,
      });
      if (!res.ok) {
        dispatch(setPhase6Error(res.message));
        dispatch(
          pushToast({
            kind: 'error',
            message: `Export to Excel failed: ${res.message}`,
          }),
        );
        return { ok: false, jobId: null };
      }
      dispatch(
        pushToast({
          kind: 'success',
          message: `Excel export complete: ${res.value.summary.outputBasename}`,
        }),
      );
      return { ok: true, jobId: res.value.jobId };
    }
    if (arg.format === 'pptx') {
      const tier: ExportQualityTier =
        arg.qualityTier === 'n/a' ? 'layout-preserving' : arg.qualityTier;
      const res = await apiExport.toPptx({
        handle: arg.handle,
        pageRange: arg.pageRange,
        qualityTier: tier,
        includeAnnotations: arg.includeAnnotations,
        outputPath: arg.outputPath,
      });
      if (!res.ok) {
        dispatch(setPhase6Error(res.message));
        dispatch(
          pushToast({
            kind: 'error',
            message: `Export to PowerPoint failed: ${res.message}`,
          }),
        );
        return { ok: false, jobId: null };
      }
      dispatch(
        pushToast({
          kind: 'success',
          message: `PowerPoint export complete: ${res.value.summary.outputBasename}`,
        }),
      );
      return { ok: true, jobId: res.value.jobId };
    }
    // Image branch — png/jpeg/tiff
    const baseReq = {
      handle: arg.handle,
      pageRange: arg.pageRange,
      format: arg.imageOptions.imageFormat,
      dpi: arg.imageOptions.dpi,
      includeAnnotations: arg.includeAnnotations,
      outputPath: arg.outputPath,
    };
    // Spread JPEG quality / multi-page TIFF only when applicable (the spec
    // documents these as optional + format-conditional). exactOptional
    // propertyTypes blocks `undefined` on optional fields, so we use
    // conditional spread per the Wave 20 lesson.
    const imageReq = {
      ...baseReq,
      ...(arg.imageOptions.imageFormat === 'jpeg'
        ? { jpegQuality: arg.imageOptions.jpegQuality }
        : {}),
      ...(arg.imageOptions.imageFormat === 'tiff'
        ? { multiPageTiff: arg.imageOptions.multiPageTiff }
        : {}),
    };
    const res = await apiExport.toImages(imageReq);
    if (!res.ok) {
      dispatch(setPhase6Error(res.message));
      dispatch(
        pushToast({
          kind: 'error',
          message: `Image export failed: ${res.message}`,
        }),
      );
      return { ok: false, jobId: null };
    }
    dispatch(
      pushToast({
        kind: 'success',
        message: `Image export complete: ${res.value.outputPaths.length} file(s)`,
      }),
    );
    return { ok: true, jobId: res.value.jobId };
  } catch (e) {
    dispatch(setPhase6Error(e instanceof Error ? e.message : 'Export start failed.'));
    return { ok: false, jobId: null };
  }
});

// ============================================================================
// cancelExportThunk — cancel an in-flight job.
// ============================================================================

export interface CancelExportThunkArg {
  jobId: number;
}

export const cancelExportThunk = createAsyncThunk<
  void,
  CancelExportThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('export/cancel', async (arg, { dispatch }) => {
  try {
    const res = await apiExport.cancelJob({ jobId: arg.jobId });
    if (!res.ok) {
      // 'job_already_terminal' is benign — the job finished before our cancel
      // reached main. Don't surface as error toast.
      if (res.error !== 'job_already_terminal') {
        dispatch(setPhase6Error(res.message));
      }
      return;
    }
    if (res.value.cancelled) {
      dispatch(
        pushToast({
          kind: 'info',
          message: `Export cancelled (${res.value.pagesCompleted} pages completed).`,
        }),
      );
    }
  } catch (e) {
    dispatch(setPhase6Error(e instanceof Error ? e.message : 'Cancel request failed.'));
  }
});

// ============================================================================
// refreshExportJobsThunk — populate the sidebar tab + recent list.
// ============================================================================

export interface RefreshExportJobsThunkArg {
  docHash?: string;
  limit?: number;
}

export const refreshExportJobsThunk = createAsyncThunk<
  void,
  RefreshExportJobsThunkArg | undefined,
  { dispatch: AppDispatch; state: RootState }
>('export/refreshJobs', async (arg, { dispatch }) => {
  try {
    // Spread optional fields conditionally per exactOptionalPropertyTypes
    // discipline — undefined on optional fields is rejected by the type
    // system when the IPC contract's request type has `?`.
    const req = {
      ...(arg?.docHash !== undefined ? { filters: { docHash: arg.docHash } } : {}),
      ...(arg?.limit !== undefined ? { limit: arg.limit } : {}),
    };
    const res = await apiExport.listJobs(req);
    if (!res.ok) {
      dispatch(setPhase6Error(res.message));
      return;
    }
    dispatch(setRecentJobs(res.value.jobs));
  } catch (e) {
    dispatch(setPhase6Error(e instanceof Error ? e.message : 'Failed to refresh exports.'));
  }
});

// ============================================================================
// dismissCompletedJobThunk — user closes the post-completion status widget.
// ============================================================================

export const dismissCompletedJobThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('export/dismissCompleted', async (_arg, { dispatch }) => {
  dispatch(clearCurrentJob());
});

// ============================================================================
// closeExportModalAndCleanup — close the modal, leave the job running.
// ============================================================================

export const closeExportModalAndCleanup = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('export/closeModal', async (_arg, { dispatch }) => {
  dispatch(closeExportModal());
});

// ============================================================================
// Event bridge — subscribe to export:progress events at app mount.
// ============================================================================

/** Subscribe to export:progress events. Returns the unsubscribe handle. */
export function subscribeExportProgress(dispatch: AppDispatch): () => void {
  return apiExport.onProgress((evt: ExportProgressEvent) => {
    // The 'starting' event also kicks off the slice's currentJob if it was
    // null (e.g. user reopens app mid-job — not in v1 but defensive).
    if (evt.phase === 'starting') {
      dispatch(
        startJobProgress({
          jobId: evt.jobId,
          format: evt.format,
          totalPages: evt.totalPages,
        }),
      );
    }
    dispatch(applyExportProgressEvent(evt));
    if (evt.phase === 'completed') {
      // Refresh the sidebar list so the row transitions from running to
      // completed without a manual reload.
      void dispatch(refreshExportJobsThunk());
    }
  });
}
