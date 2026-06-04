// Phase 5 thunks — OCR engine integration.
// Per `docs/architecture-phase-5.md §2.3` + `docs/api-contracts.md §16`.
//
// Naming + structure mirrors `thunks-phase4.ts`. Each thunk:
//   1. Calls the matching `apiOcr.*` (or `apiScan.*`) method.
//   2. Pattern-matches the Result<T, E> discriminant.
//   3. Dispatches success / failure actions into ocrSlice (or scanSlice).
//
// Per conventions §16:
//   - The renderer never touches tesseract.js directly (§16.6).
//   - Raster bytes never cross into the renderer (§16.2); the OcrPageResult
//     payload carries only structured data.
//   - Late-init `pageResults: null` is propagated as-is — no sentinel default.

import { createAsyncThunk } from '@reduxjs/toolkit';

import { apiOcr } from '../services/api';
import {
  type DocumentHandle,
  type OcrLanguagePackDownloadProgressEvent,
  type OcrProgressEvent,
  type OcrRunOnDocumentValue,
  type OcrRunOnPageValue,
  type PreprocessOptions,
} from '../types/ipc-contract';

import { applyEdit } from './slices/document-slice';
import {
  applyDownloadProgressEvent,
  applyProgressEvent,
  clearJobProgress,
  setDefaultLang,
  setDownloadablePacks,
  setInstalledPacks,
  setOcrError,
  setCurrentSummary,
  setRunStep,
  startJobProgress,
} from './slices/ocr-slice';
import { pushToast } from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';

// ============================================================================
// detectLanguagesThunk — populate the run modal language picker on open.
// ============================================================================

export const detectLanguagesThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('ocr/detectLanguages', async (_arg, { dispatch }) => {
  try {
    const res = await apiOcr.detectLanguages({});
    if (!res.ok) {
      dispatch(setOcrError(res.message));
      return;
    }
    dispatch(setInstalledPacks(res.value.installed));
    dispatch(setDownloadablePacks(res.value.downloadable));
    dispatch(setDefaultLang(res.value.defaultLang));
  } catch (e) {
    dispatch(setOcrError(e instanceof Error ? e.message : 'Failed to detect languages.'));
  }
});

// ============================================================================
// runOcrOnPageThunk — short-running per-page OCR (re-OCR affordance).
// ============================================================================

export interface RunOcrOnPageThunkArg {
  handle: DocumentHandle;
  pageIndex: number;
  langs: string[];
  preprocess: PreprocessOptions;
  /** True if the doc has prior PAdES signatures AND the user confirmed. */
  invalidatesSignaturesConfirmed?: boolean;
}

export const runOcrOnPageThunk = createAsyncThunk<
  OcrRunOnPageValue | null,
  RunOcrOnPageThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('ocr/runOnPage', async (arg, { dispatch }) => {
  try {
    // Spread the optional flag only when set — exactOptionalPropertyTypes
    // rejects passing `undefined` explicitly to an optional field. See
    // conventions §5 (zod-handler shape mirrors this discipline).
    const req = {
      handle: arg.handle,
      pageIndex: arg.pageIndex,
      langs: arg.langs,
      preprocess: arg.preprocess,
      ...(arg.invalidatesSignaturesConfirmed !== undefined
        ? { invalidatesSignaturesConfirmed: arg.invalidatesSignaturesConfirmed }
        : {}),
    };
    const res = await apiOcr.runOnPage(req);
    if (!res.ok) {
      dispatch(setOcrError(res.message));
      return null;
    }
    return res.value;
  } catch (e) {
    dispatch(setOcrError(e instanceof Error ? e.message : 'OCR run failed.'));
    return null;
  }
});

// ============================================================================
// runOcrOnDocumentThunk — long-running per-doc OCR with progress events.
//
// The progress-event subscription lives at the App level (see app.tsx). The
// thunk just kicks off the run; events stream in via the bridge and dispatch
// applyProgressEvent. On terminal events (completed/cancelled/failed) the
// thunk's `await` resolves and we dispatch the run-step transition.
// ============================================================================

export interface RunOcrOnDocumentThunkArg {
  handle: DocumentHandle;
  /** null = ALL pages; resolved in this thunk against the current doc. */
  pageRange: { start: number; end: number } | null;
  langs: string[];
  preprocess: PreprocessOptions;
  invalidatesSignaturesConfirmed?: boolean;
}

export const runOcrOnDocumentThunk = createAsyncThunk<
  OcrRunOnDocumentValue | null,
  RunOcrOnDocumentThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('ocr/runOnDocument', async (arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setOcrError('No document open.'));
    return null;
  }
  // Resolve "all pages" to a concrete inclusive range against the current doc.
  const pageRange: { start: number; end: number } = arg.pageRange ?? {
    start: 0,
    end: doc.pageCount - 1,
  };

  // We don't have a jobId yet (main creates it). The startJobProgress action
  // is fired from the FIRST 'starting' progress event in app.tsx's subscriber.
  // Optimistic UI transition: bump to running step now.
  dispatch(setRunStep('running'));

  try {
    const req = {
      handle: arg.handle,
      pageRange,
      langs: arg.langs,
      preprocess: arg.preprocess,
      ...(arg.invalidatesSignaturesConfirmed !== undefined
        ? { invalidatesSignaturesConfirmed: arg.invalidatesSignaturesConfirmed }
        : {}),
    };
    const res = await apiOcr.runOnDocument(req);
    if (!res.ok) {
      // 'cancelled' is the user's explicit choice; render it as a soft toast
      // rather than an error banner. Every other variant is a real failure.
      if (res.error === 'cancelled') {
        dispatch(pushToast({ kind: 'info', message: 'OCR was cancelled.' }));
      } else if (res.error === 'signed_pdf_requires_confirm') {
        // The modal handles the confirm flow; this is unexpected here unless
        // the user bypassed the prompt. Surface as a hard error.
        dispatch(setOcrError(res.message));
      } else {
        dispatch(setOcrError(res.message));
      }
      dispatch(setRunStep('done'));
      return null;
    }
    // Note: the 'completed' progress event already populated the summary;
    // the IPC response is the same summary returned synchronously. We set it
    // again here to cover the case where the event arrived in a different
    // tick order than the await resolution.
    dispatch(setCurrentSummary(res.value.summary));
    // Persistence fix (v0.7.17): push the `ocr-text-behind-applied` op into
    // the document's dirtyOps list so Save -> replay produces the searchable
    // PDF on disk. Without this dispatch the op was returned by main and
    // dropped here -- OCR ran, the modal showed stats, but the file was
    // never modified. document-slice-apply.ts already handles this op kind
    // (no PageModel mutation; just pushes to dirtyOps) and replay-engine.ts
    // case 'ocr-text-behind-applied' regenerates the text layer at save.
    dispatch(applyEdit(res.value.op));
    dispatch(setRunStep('done'));
    return res.value;
  } catch (e) {
    dispatch(setOcrError(e instanceof Error ? e.message : 'OCR run failed.'));
    dispatch(setRunStep('done'));
    return null;
  }
});

// ============================================================================
// cancelOcrJobThunk — graceful cancel; the main-process engine completes the
// in-flight page then exits. The worker is NOT terminated (P5-L-3).
// ============================================================================

export interface CancelOcrJobThunkArg {
  jobId: number;
}

export const cancelOcrJobThunk = createAsyncThunk<
  void,
  CancelOcrJobThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('ocr/cancelJob', async (arg, { dispatch }) => {
  try {
    const res = await apiOcr.cancelJob({ jobId: arg.jobId });
    if (!res.ok) {
      // Idempotent — a 'job_already_terminal' is not an error condition.
      if (res.error !== 'job_already_terminal') {
        dispatch(setOcrError(res.message));
      }
      return;
    }
  } catch (e) {
    dispatch(setOcrError(e instanceof Error ? e.message : 'Cancel failed.'));
  }
});

// ============================================================================
// loadOcrResultsThunk — fetch the latest completed job for the open doc.
//
// Called on doc-open to hydrate the confidence overlay + results panel. If no
// job exists for this doc-hash, `currentSummary` stays null (the placeholder
// branch). NO sentinel-default — per conventions §16.3.2.
// ============================================================================

export const loadOcrResultsThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('ocr/loadResults', async (_arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) return;
  try {
    const res = await apiOcr.listJobs({
      filters: { docHash: doc.fileHash, status: 'completed' },
      limit: 1,
    });
    if (!res.ok) {
      // listJobs failure is not surfaced as a user-visible error — the panel
      // just stays empty. The user can re-trigger via "Run OCR".
      return;
    }
    if (res.value.jobs.length === 0) {
      dispatch(setCurrentSummary(null));
      return;
    }
    // The DTO doesn't carry the full per-page OcrPageResult[] (those live in
    // ocr_results); we set a minimal summary so the results panel can show a
    // "OCR was run on this document" indicator. Loading the per-page rows
    // would be a separate channel (ocr:listResultsByJob) — out of Phase 5
    // scope; Phase 5.2 candidate per architecture §10.3.
    const job = res.value.jobs[0];
    if (!job) {
      // res.value.jobs.length > 0 was just verified, but TS's noUncheckedIndexedAccess
      // still narrows [0] to T | undefined. Belt-and-suspenders bail-out.
      dispatch(setCurrentSummary(null));
      return;
    }
    dispatch(
      setCurrentSummary({
        jobId: job.id,
        pageRange: job.pageRange,
        langs: job.langs,
        status:
          job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed'
            ? job.status
            : 'completed',
        totalWords: job.totalWords ?? 0,
        meanConfidence: job.meanConfidence ?? 0,
        totalDurationMs: job.completedAt !== null ? job.completedAt - job.startedAt : 0,
        // Nullable late-init — no sentinel-empty-array. Conventions §16.3.2.
        pageResults: null,
      }),
    );
  } catch {
    // Best-effort hydration; swallow.
  }
});

// ============================================================================
// downloadLanguagePackThunk — fires the download + lets progress events drive
// the UI. Returns when the IPC promise resolves (terminal event).
// ============================================================================

export interface DownloadLanguagePackThunkArg {
  lang: string;
}

export const downloadLanguagePackThunk = createAsyncThunk<
  void,
  DownloadLanguagePackThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('ocr/downloadLanguagePack', async (arg, { dispatch }) => {
  try {
    const res = await apiOcr.languagePackDownload({ lang: arg.lang });
    if (!res.ok) {
      dispatch(setOcrError(res.message));
      dispatch(
        pushToast({
          kind: 'error',
          message: `Language pack ${arg.lang} download failed: ${res.message}`,
        }),
      );
      return;
    }
    // Refresh the catalog so the pack moves from "downloadable" → "installed".
    dispatch(
      pushToast({
        kind: 'success',
        message: `Language pack ${res.value.pack.lang} (${res.value.pack.displayName}) installed.`,
      }),
    );
    await dispatch(detectLanguagesThunk());
  } catch (e) {
    dispatch(setOcrError(e instanceof Error ? e.message : 'Pack download failed.'));
  }
});

// ============================================================================
// removeLanguagePackThunk — remove a downloaded pack. Refuses bundled `eng`.
// ============================================================================

export interface RemoveLanguagePackThunkArg {
  lang: string;
}

export const removeLanguagePackThunk = createAsyncThunk<
  void,
  RemoveLanguagePackThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('ocr/removeLanguagePack', async (arg, { dispatch }) => {
  try {
    const res = await apiOcr.languagePackRemove({ lang: arg.lang });
    if (!res.ok) {
      dispatch(setOcrError(res.message));
      return;
    }
    await dispatch(detectLanguagesThunk());
  } catch (e) {
    dispatch(setOcrError(e instanceof Error ? e.message : 'Pack remove failed.'));
  }
});

// ============================================================================
// Event bridge helpers — called from app.tsx to wire the bridge subscribers
// into the slice's `apply*Event` reducers. The unsubscribe handle is returned
// for the effect cleanup.
// ============================================================================

/** Subscribe to ocr:progress events. Returns the unsubscribe handle. */
export function subscribeOcrProgress(dispatch: AppDispatch): () => void {
  return apiOcr.onProgress((evt: OcrProgressEvent) => {
    // The FIRST 'starting' event also kicks off the slice's jobProgress
    // because we don't know the jobId until main creates it.
    if (evt.phase === 'starting') {
      dispatch(startJobProgress({ jobId: evt.jobId, totalPages: evt.totalPages }));
    }
    dispatch(applyProgressEvent(evt));
    if (evt.phase === 'completed' || evt.phase === 'cancelled' || evt.phase === 'failed') {
      // Terminal — leave jobProgress set so the modal's Done step can render
      // the final stats. clearJobProgress is dispatched on closeOcrModal at
      // the component level.
    }
  });
}

/** Subscribe to ocr:languagePackDownload:progress events. */
export function subscribeOcrPackDownloadProgress(dispatch: AppDispatch): () => void {
  return apiOcr.onLanguagePackDownloadProgress((evt: OcrLanguagePackDownloadProgressEvent) => {
    dispatch(applyDownloadProgressEvent(evt));
  });
}

// Helper for tests + the modal's reset-on-close path.
export function clearJobProgressAction() {
  return clearJobProgress();
}
