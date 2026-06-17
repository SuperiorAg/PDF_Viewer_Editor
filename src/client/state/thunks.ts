// >200 lines: this file is the single funnel where every IPC-bridge call gets
// wrapped into a typed createAsyncThunk. Splitting per slice would scatter the
// thunks across 7+ files and obscure the IPC surface area (which is exactly
// 9 calls right now). Convention §6.4 calls for "one IPC call per thunk" —
// keeping them co-located is the right trade-off.
//
// Thunks: every IPC call that mutates state goes through one of these.
// Per conventions §6.4 — one IPC call per thunk; the thunk dispatches the
// resulting slice action(s).

import { createAsyncThunk } from '@reduxjs/toolkit';

import { api } from '../services/api';
import { loadDocumentByHandle } from '../services/pdf-loader';
import {
  type BookmarkNode,
  type DialogOpenPdfValue,
  type EditOperation,
  type ExportEnginePreference,
  type FormFieldDefinition,
  type FormFieldValue,
  type FormTemplateListItem,
  type FsApplyEditOpsRequest,
  type MailMergeDataSource,
  type MailMergeJob,
  type MailMergeOutputMode,
  type PdfCombineSource,
  type PdfRect,
  type PDFDocumentModel,
  type RecentsListItem,
} from '../types/ipc-contract';

import { triggerFormCommit } from './middleware/form-commit-middleware';
import {
  addBookmarkNode,
  deleteBookmark,
  moveBookmark,
  renameBookmark,
  setBookmarksTree,
} from './slices/bookmarks-slice';
import {
  applyEdit,
  closeDocument,
  markSaved,
  setDocument,
  setPageDimensions,
  setSaveError,
  setSavePending,
} from './slices/document-slice';
import { setLastEngine, setInFlight } from './slices/export-slice';
// Phase 3 — forms thunks dispatch through these slices.
import {
  addAuthoredField,
  removeFieldByName,
  setDetected,
  setDetecting,
  setDetectError,
} from './slices/forms-slice';
import {
  setItems as setTemplateItems,
  addItem as addTemplateItem,
  setLoading as setTemplatesLoading,
  setError as setTemplatesError,
} from './slices/forms-templates-slice';
import {
  progressTick,
  runCompleted,
  runFailed,
  runStarted,
  setDataPreview,
} from './slices/mail-merge-slice';
import { setRecents, clearRecents } from './slices/recents-slice';
import {
  clearImageImportPreload,
  closeModal,
  pushToast,
  setLoading,
  setTextEditActiveSpan,
  setTextEditIdentifying,
} from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';
import { loadOcrResultsThunk } from './thunks-phase5';

function buildInitialDocument(value: DialogOpenPdfValue): PDFDocumentModel {
  const pages = Array.from({ length: value.pageCount }, (_, i) => ({
    pageIndex: i,
    sourcePageRef: { kind: 'original' as const, originalIndex: i },
    rotation: 0 as const,
    // Page dimensions default to US Letter (612×792 pt) so the page list is
    // non-empty before pdf.js measures the real dims. Phase 4.1.1 (Riley):
    // `measurePageDimensionsThunk` fires from PdfViewer after open and
    // dispatches `setPageDimensions` with the natural dims pdf.js reports.
    // Downstream consumers (pdf-coords for annotation transforms, the
    // page-metadata UI, viewportForPage, the thumbnail strip) all read
    // PageModel.width/height — so this single refresh is the load-bearing
    // signal that brings every consumer onto correct dims.
    width: 612,
    height: 792,
  }));
  return {
    handle: value.handle,
    displayName: value.displayName,
    fileHash: value.fileHash,
    pageCount: value.pageCount,
    pages,
    annotations: [],
    dirtyOps: [],
    savedAtHandleVersion: 0,
    pdflibLoadWarnings: value.pdflibLoadWarnings,
  };
}

export const openDocumentThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('document/open', async (_arg, { dispatch }) => {
  dispatch(setLoading({ loading: true, message: 'Opening file...' }));
  try {
    const res = await api.dialog.openPdf();
    if (!res.ok) {
      if (res.error === 'user_cancelled') {
        // Silent — user pressed Cancel.
        return;
      }
      dispatch(pushToast({ kind: 'error', message: `Couldn't open document: ${res.message}` }));
      return;
    }
    dispatch(setDocument(buildInitialDocument(res.value)));
    // Refresh recents list after a successful open.
    void dispatch(refreshRecentsThunk());
    // Phase 3: kick off form detection in the background — but ONLY for small
    // docs. detectForms runs PDFDocument.load(bytes) on the SINGLE main thread;
    // for a 1000+-page PDF that blocks main for many tens of seconds and the
    // renderer's fs.readBytesByHandle for the visible-page render path waits
    // behind it (main is single-threaded IPC). For large docs we defer
    // detection to FormsPanel mount (auto-trigger when status is idle), so
    // opening the document does not stall on a feature the user may not use.
    if (res.value.pageCount <= EAGER_DETECT_FORMS_PAGE_LIMIT) {
      void dispatch(detectFormsThunk());
    }
    // Phase 4.1.1: refresh PageModel dims with pdf.js-measured natural dims so
    // pdf-coords + page-metadata + AnnotationLayer agree with the rendered
    // bitmap aspect ratio (was Letter-defaulted at thunks.ts:82-92).
    void dispatch(measurePageDimensionsThunk());
    // Phase 5 persistence (v0.7.17): hydrate the OCR summary from SQLite if
    // this doc was OCR'd before. Per-page words still load lazily (Phase 5.2
    // candidate per ocr-engine.md §10.3); for now we surface the "OCR was
    // previously run" indicator so the user knows the searchable layer exists
    // on disk without having to re-run.
    void dispatch(loadOcrResultsThunk());
  } finally {
    dispatch(setLoading({ loading: false }));
  }
});

// Above this page count the eager detectForms call on open is skipped — see
// the FormsPanel auto-trigger and the comment in openDocumentThunk above.
const EAGER_DETECT_FORMS_PAGE_LIMIT = 100;

export const openDroppedPathThunk = createAsyncThunk<
  void,
  string,
  { dispatch: AppDispatch; state: RootState }
>('document/openDropped', async (droppedPath, { dispatch }) => {
  dispatch(setLoading({ loading: true, message: 'Opening dropped file...' }));
  try {
    const res = await api.fs.readPdf({ droppedPath });
    if (!res.ok) {
      const msg =
        res.error === 'invalid_pdf'
          ? 'That file is not a valid PDF.'
          : res.error === 'too_large'
            ? 'File exceeds the configured size limit.'
            : res.error === 'path_rejected'
              ? 'Path was rejected by the security check.'
              : res.message;
      dispatch(pushToast({ kind: 'error', message: msg }));
      return;
    }
    dispatch(setDocument(buildInitialDocument(res.value)));
    void dispatch(refreshRecentsThunk());
    // See openDocumentThunk for the page-count gating rationale (detectForms
    // blocks the main thread for tens of seconds on 1000+ pages).
    if (res.value.pageCount <= EAGER_DETECT_FORMS_PAGE_LIMIT) {
      void dispatch(detectFormsThunk());
    }
    void dispatch(measurePageDimensionsThunk());
    // v0.7.17: same OCR-summary hydration as openDocumentThunk above.
    void dispatch(loadOcrResultsThunk());
  } finally {
    dispatch(setLoading({ loading: false }));
  }
});

export const saveDocumentThunk = createAsyncThunk<
  void,
  { saveAs: boolean },
  { dispatch: AppDispatch; state: RootState }
>('document/save', async ({ saveAs }, { dispatch, getState }) => {
  // Phase 3 (conventions §14.2 trigger path #1): auto-commit any pending
  // form-fill values before save. The form-commit-middleware diffs values vs
  // committedValues; if nothing changed, this is a no-op.
  dispatch(triggerFormCommit());

  const state = getState();
  const doc = state.document.current;
  if (!doc) return;
  dispatch(setSavePending(true));
  try {
    // 1) get a destination token via dialog:saveAs (always, for now — Phase 2
    //    will reuse the previous token when not saveAs)
    const saveAsRes = await api.dialog.saveAs({ suggestedName: doc.displayName });
    if (!saveAsRes.ok) {
      if (saveAsRes.error === 'user_cancelled') return;
      dispatch(setSaveError(saveAsRes.message));
      dispatch(pushToast({ kind: 'error', message: `Couldn't save: ${saveAsRes.message}` }));
      return;
    }

    // 2) Build the applyEditOps request.
    //
    // PHASE 2 (architecture-phase-2.md §2.5, edit-replay-engine.md §10).
    // Replaces the Wave-3.5 H-3 PHASE-1 INLINE placeholder. The renderer
    // now sends dirtyOps + annotations to main; main's replay engine reads
    // the original bytes from documentStore (held per handle lifetime per
    // P2-L-2), applies the ops, atomically temp-writes + renames, and
    // returns the annotation-ref assignment map.
    //
    // The renderer no longer synthesizes its own bytes — bytes never leave
    // main (conventions §10 + §13.3 strengthened). Walking-skeleton goal #8
    // is now truly functional: real ops -> real saved file.
    const applyReq: FsApplyEditOpsRequest = {
      handle: doc.handle,
      ops: doc.dirtyOps,
      annotations: doc.annotations,
      destinationToken: saveAsRes.value.destinationToken,
      engine: 'auto',
    };
    const applyRes = await api.fs.applyEditOps(applyReq);
    if (!applyRes.ok) {
      dispatch(setSaveError(applyRes.message));
      dispatch(pushToast({ kind: 'error', message: `Save failed: ${applyRes.message}` }));
      return;
    }
    dispatch(markSaved());
    // Phase-2 warnings: surface as info toasts so the user sees clipping /
    // best-effort observations without being alarmed.
    for (const w of applyRes.value.warnings) {
      dispatch(pushToast({ kind: 'warning', message: w }));
    }
    dispatch(
      pushToast({
        kind: 'success',
        message: `Saved ${saveAsRes.value.displayName} (${applyRes.value.bytesWritten} bytes)`,
      }),
    );
  } finally {
    dispatch(setSavePending(false));
  }
  // saveAs is reserved for Phase 2's "skip dialog if we have a destination token";
  // Phase 1 always prompts.
  void saveAs;
});

export const closeDocumentThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('document/close', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.fs.closePdf({ handle: doc.handle });
  if (!res.ok) {
    dispatch(pushToast({ kind: 'warning', message: `Close warning: ${res.message}` }));
  }
  dispatch(closeDocument());
});

/**
 * Phase 4.1.1 (Riley) — refresh PageModel.width/height with the real natural
 * page dimensions reported by pdf.js. Fires once per document open from
 * PdfViewer; bridges the gap between `buildInitialDocument`'s US-Letter
 * default and the per-page dims that downstream consumers (pdf-coords,
 * page-metadata, viewportForPage, AnnotationLayer, ThumbnailItem) all need.
 *
 * Implementation contract:
 *   1. Load the document via the renderer's pdf-loader cache (same path
 *      PdfCanvas + ThumbnailItem use — so this is a cache HIT in the steady
 *      state, never an extra IPC round-trip).
 *   2. Iterate pages 0..pageCount-1, await `getPage`, read width/height.
 *      `.cleanup()` each pageProxy immediately — we only need the dims, not
 *      a held reference (memory hygiene per ARCHITECTURE §4.4).
 *   3. Dispatch one `setPageDimensions` with ALL pages at end so the slice
 *      sees a single state update (batch over N=pageCount minimizes
 *      re-render storms on large docs).
 *
 * Failure modes are silent — if pdf.js can't parse, PdfCanvas will surface
 * the loader error inline; this thunk just leaves the Letter defaults. The
 * goal is a soft enrichment, not a hard prerequisite. Cancellation is on
 * a "best-effort": if the document closes while we're still measuring, the
 * post-loop dispatch is dropped via a doc-handle equality check.
 *
 * Concurrency: a second call before the first completes is a no-op early
 * out — the existing in-flight measure satisfies the new request. The doc
 * close cleanup ensures the cache miss on re-open re-fires the measure.
 */
const measureInflight = new Set<number>();

// Bulk measurement is fast for small docs but for large ones (1000+ pages) the
// sequential getPage round-trips monopolize the pdf.js worker for many seconds
// — visible-page renders queue behind 1000+ metadata reads and the viewer
// looks blank. Above this threshold we skip the bulk pass entirely and rely
// on PdfCanvas's per-page lazy dispatch (it already calls getPage when
// rendering, so the dims come free). The Letter default stays for unscrolled
// pages; scrollbar drifts very slightly as pages are scrolled into view, which
// is the price of unblocking the visible render path.
const BULK_MEASURE_PAGE_LIMIT = 50;

export const measurePageDimensionsThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('document/measurePageDimensions', async (_arg, { dispatch, getState }) => {
  const docAtStart = getState().document.current;
  if (!docAtStart) return;
  if (docAtStart.pageCount > BULK_MEASURE_PAGE_LIMIT) return;
  const handle = docAtStart.handle;
  if (measureInflight.has(handle)) return;
  measureInflight.add(handle);
  try {
    const res = await loadDocumentByHandle(handle);
    if (!res.ok) return;
    const updates: Array<{ pageIndex: number; width: number; height: number }> = [];
    for (let i = 0; i < docAtStart.pageCount; i++) {
      // Bail mid-loop if the document closed under us.
      const cur = getState().document.current;
      if (!cur || cur.handle !== handle) return;
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential to bound pdf.js memory
        const page = await res.doc.getPage(i);
        updates.push({ pageIndex: i, width: page.width, height: page.height });
        page.cleanup();
      } catch {
        // Skip this page; pdf.js can throw on a corrupt /MediaBox. Leaving
        // the Letter default is the safest fallback.
        continue;
      }
    }
    const final = getState().document.current;
    if (!final || final.handle !== handle) return;
    if (updates.length > 0) {
      dispatch(setPageDimensions(updates));
    }
  } finally {
    measureInflight.delete(handle);
  }
});

/** Test-only hook to clear inflight markers between specs. */
export function _resetMeasureInflightForTests(): void {
  measureInflight.clear();
}

export const combinePdfsThunk = createAsyncThunk<
  void,
  PdfCombineSource[],
  { dispatch: AppDispatch; state: RootState }
>('document/combine', async (sources, { dispatch }) => {
  dispatch(setLoading({ loading: true, message: 'Combining PDFs...' }));
  try {
    const res = await api.pdf.combine({ sources });
    if (!res.ok) {
      // Wave-30 follow-up (H-30.1): map error variants to honest, user-facing
      // strings. The raw res.message is the safeMessage()-protected detail
      // (production -> fallback); the variant is the load-bearing signal.
      const msg =
        res.error === 'invalid_source'
          ? 'At least two valid PDF sources are required to combine.'
          : res.error === 'invalid_page_range'
            ? 'One of the page ranges is invalid.'
            : res.error === 'handle_not_found'
              ? 'One of the source documents is no longer open.'
              : res.error === 'fs_read_failed'
                ? 'A source file could not be read.'
                : res.error === 'pdf_load_failed'
                  ? 'A source file is not a valid PDF.'
                  : `Combine failed: ${res.message}`;
      dispatch(pushToast({ kind: 'error', message: msg }));
      return;
    }
    dispatch(
      setDocument(
        buildInitialDocument({
          handle: res.value.handle,
          displayName: res.value.displayName,
          fileHash: '',
          pageCount: res.value.pageCount,
          pdflibLoadWarnings: [],
        }),
      ),
    );
    dispatch(
      pushToast({
        kind: 'success',
        message: `Combined into ${res.value.displayName} (${res.value.pageCount} pages)`,
      }),
    );
    // Phase 4.1.1: refresh PageModel dims for the combined doc — the source
    // PDFs may have different per-page dimensions, so the Letter default is
    // wrong for at least some pages.
    void dispatch(measurePageDimensionsThunk());
  } finally {
    dispatch(setLoading({ loading: false }));
  }
});

export const refreshRecentsThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('recents/refresh', async (_arg, { dispatch }) => {
  const res = await api.recents.list({ limit: 20 });
  if (!res.ok) {
    // Silently fail — recents are nice-to-have.
    return;
  }
  dispatch(setRecents(res.value.items));
});

export const clearRecentsThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('recents/clear', async (_arg, { dispatch }) => {
  const res = await api.recents.clear();
  if (!res.ok) {
    dispatch(pushToast({ kind: 'error', message: 'Could not clear recents.' }));
    return;
  }
  dispatch(clearRecents());
});

export const exportPdfThunk = createAsyncThunk<
  void,
  ExportEnginePreference,
  { dispatch: AppDispatch; state: RootState }
>('export/run', async (preference, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const jobId = `job-${Date.now()}`;
  dispatch(setInFlight(jobId));
  try {
    const res = await api.pdf.export({ handle: doc.handle, preference });
    if (!res.ok) {
      dispatch(pushToast({ kind: 'error', message: `Export failed: ${res.message}` }));
      return;
    }
    dispatch(
      setLastEngine({
        engine: res.value.engine,
        reason: res.value.reason,
        warnings: res.value.warnings,
      }),
    );
    dispatch(
      pushToast({
        kind: 'success',
        message: `Exported via ${res.value.engine}${
          res.value.warnings.length > 0 ? ` — ${res.value.warnings[0] ?? ''}` : ''
        }`,
      }),
    );
  } finally {
    dispatch(setInFlight(null));
  }
});

/** Phase 2 alias for clarity at call sites — the dialog wires both names. */
export const exportToPdfThunk = exportPdfThunk;

// =============================================================================
// Phase 2 — Image embed
// =============================================================================

export interface EmbedImageThunkArg {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/tiff';
  intrinsicWidth: number;
  intrinsicHeight: number;
  placement:
    | { kind: 'new-page'; atIndex: number; orientation?: 'portrait' | 'landscape' }
    | { kind: 'overlay'; pageIndex: number; rect: PdfRect; overlayId?: string };
}

export const embedImageThunk = createAsyncThunk<
  void,
  EmbedImageThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('document/embedImage', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  dispatch(setLoading({ loading: true, message: 'Embedding image…' }));
  try {
    const res = await api.pdf.embedImage({
      handle: doc.handle,
      image: {
        bytes: arg.bytes,
        mimeType: arg.mimeType,
        width: arg.intrinsicWidth,
        height: arg.intrinsicHeight,
      },
      placement: arg.placement,
    });
    if (!res.ok) {
      const msg =
        res.error === 'image_decode_failed'
          ? 'Image format could not be decoded.'
          : res.error === 'tiff_decode_failed'
            ? 'TIFF subtype unsupported.'
            : res.error === 'out_of_range'
              ? 'Insert position is out of range.'
              : res.message;
      dispatch(pushToast({ kind: 'error', message: `Insert image failed: ${msg}` }));
      return;
    }
    // Surface warnings (e.g. multi-page TIFF first-page-used note).
    for (const w of res.value.warnings) {
      dispatch(pushToast({ kind: 'warning', message: w }));
    }
    // Dispatch the returned EditOperation through the standard funnel. The
    // history middleware compacts image bytes before pushing to history.
    dispatch(applyEdit(res.value.op as EditOperation));
    dispatch(
      pushToast({
        kind: 'success',
        message:
          arg.placement.kind === 'new-page'
            ? 'Image inserted as a new page.'
            : 'Image placed as overlay.',
      }),
    );
  } finally {
    dispatch(setLoading({ loading: false }));
    dispatch(clearImageImportPreload());
    dispatch(closeModal());
  }
});

// =============================================================================
// Phase 2 — Text replace
// =============================================================================

export interface IdentifyTextSpanThunkArg {
  pageIndex: number;
  x: number;
  y: number;
}

export const identifyTextSpanThunk = createAsyncThunk<
  void,
  IdentifyTextSpanThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('document/identifyTextSpan', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  dispatch(setTextEditIdentifying(true));
  try {
    const res = await api.pdf.identifyTextSpan({
      handle: doc.handle,
      pageIndex: arg.pageIndex,
      x: arg.x,
      y: arg.y,
    });
    if (!res.ok) {
      if (res.error === 'no_text_at_point') {
        dispatch(pushToast({ kind: 'info', message: 'No text at this location.' }));
      } else {
        dispatch(pushToast({ kind: 'error', message: `Identify text failed: ${res.message}` }));
      }
      dispatch(setTextEditIdentifying(false));
      return;
    }
    dispatch(
      setTextEditActiveSpan({
        pageIndex: arg.pageIndex,
        objectId: res.value.objectId,
        runBoundingRect: res.value.runBoundingRect,
        originalText: res.value.currentText,
        font: res.value.font,
      }),
    );
  } catch (e) {
    dispatch(setTextEditIdentifying(false));
    dispatch(pushToast({ kind: 'error', message: (e as Error).message }));
  }
});

export interface ReplaceTextThunkArg {
  pageIndex: number;
  objectId: string;
  newText: string;
}

export const replaceTextThunk = createAsyncThunk<
  void,
  ReplaceTextThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('document/replaceText', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.pdf.replaceText({
    handle: doc.handle,
    pageIndex: arg.pageIndex,
    objectId: arg.objectId,
    newText: arg.newText,
  });
  if (!res.ok) {
    const msg =
      res.error === 'missing_glyph'
        ? 'Original font does not contain one of the characters you entered. Use a FreeText annotation to add new text in a different font.'
        : res.error === 'text_span_not_found'
          ? 'The text span could not be located. Try clicking it again.'
          : res.message;
    dispatch(pushToast({ kind: 'error', message: msg }));
    return;
  }
  if (res.value.willClip) {
    dispatch(
      pushToast({
        kind: 'warning',
        message: `Text will be clipped (${(res.value.overflowPt ?? 0).toFixed(1)}pt overflow). Phase 4 will support reflow.`,
      }),
    );
  }
  dispatch(applyEdit(res.value.op as EditOperation));
});

// =============================================================================
// Phase 2 — Print
// =============================================================================

export const printThunk = createAsyncThunk<void, void, { dispatch: AppDispatch; state: RootState }>(
  'document/print',
  async (_arg, { dispatch, getState }) => {
    const doc = getState().document.current;
    if (!doc) return;
    dispatch(setLoading({ loading: true, message: 'Preparing print job…' }));
    try {
      const res = await api.pdf.print({
        handle: doc.handle,
        ops: doc.dirtyOps,
        annotations: doc.annotations,
      });
      if (!res.ok) {
        if (res.error === 'user_cancelled') return;
        dispatch(pushToast({ kind: 'error', message: `Print failed: ${res.message}` }));
        return;
      }
      dispatch(
        pushToast({
          kind: 'success',
          message: `Print dispatched (engine: ${res.value.engineUsed})`,
        }),
      );
    } finally {
      dispatch(setLoading({ loading: false }));
    }
  },
);

// =============================================================================
// Phase 2 — Bookmarks CRUD (tree-aware)
// =============================================================================

export const refreshBookmarksThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('bookmarks/refresh', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.bookmarks.listTree({ fileHash: doc.fileHash });
  if (!res.ok) {
    // bridge_unavailable / not_implemented / db_unavailable — fall back to
    // legacy flat list silently. The slice tolerates either input.
    return;
  }
  dispatch(setBookmarksTree(res.value.tree));
});

export interface AddBookmarkThunkArg {
  pageIndex: number;
  title: string;
  parentId: number | null;
  sortOrder?: number;
}

export const addBookmarkThunk = createAsyncThunk<
  void,
  AddBookmarkThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('bookmarks/add', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.bookmarks.upsert({
    fileHash: doc.fileHash,
    pageIndex: arg.pageIndex,
    title: arg.title,
  });
  if (!res.ok) {
    dispatch(pushToast({ kind: 'error', message: `Add bookmark failed: ${res.message}` }));
    return;
  }
  const node: BookmarkNode = {
    id: res.value.id,
    fileHash: doc.fileHash,
    pageIndex: arg.pageIndex,
    title: arg.title,
    createdAt: Date.now(),
    parentId: arg.parentId,
    sortOrder: arg.sortOrder ?? 0,
    children: [],
  };
  dispatch(addBookmarkNode(node));
});

export interface MoveBookmarkThunkArg {
  id: number;
  newParentId: number | null;
  newSortOrder: number;
}

export const moveBookmarkThunk = createAsyncThunk<
  void,
  MoveBookmarkThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('bookmarks/move', async (arg, { dispatch }) => {
  // Optimistic update first; rollback if the server rejects with
  // `cycle_detected` or `invalid_parent` (Wave 10 R-10.3 — David's D-10.1
  // promotes `invalid_parent` to a first-class wire variant; before that
  // amendment the same condition was masked as `invalid_payload`).
  dispatch(moveBookmark(arg));
  const res = await api.bookmarks.move({
    id: arg.id,
    newParentId: arg.newParentId,
    newSortOrder: arg.newSortOrder,
  });
  if (!res.ok) {
    // Compare via a string-widened view so this thunk stays correct on BOTH
    // sides of David's D-10.1 contract amendment:
    //   - Pre-D-10.1: BookmarksMoveError = 'db_unavailable' | 'not_found'
    //                                    | 'invalid_payload' | 'cycle_detected'
    //                 — the 'invalid_parent' branch is unreachable; thunk
    //                   falls through to the generic toast (which is what
    //                   the masked 'invalid_payload' would have produced
    //                   anyway).
    //   - Post-D-10.1: BookmarksMoveError additionally includes 'invalid_parent'
    //                  — the dedicated user-facing toast fires for that
    //                    distinct failure mode (parent missing / wrong file)
    //                    instead of conflating with `cycle_detected`.
    // The string-widened comparison avoids a hard typecheck dependency on
    // the order David's amendment lands relative to this thunk update.
    const wireError: string = res.error;
    if (wireError === 'cycle_detected') {
      dispatch(
        pushToast({
          kind: 'warning',
          message: 'Cannot move a bookmark under one of its own descendants.',
        }),
      );
    } else if (wireError === 'invalid_parent') {
      dispatch(
        pushToast({
          kind: 'warning',
          message: 'Cannot move bookmark to that location.',
        }),
      );
    } else {
      dispatch(pushToast({ kind: 'error', message: `Move failed: ${res.message}` }));
    }
    // Refresh to recover authoritative tree.
    void dispatch(refreshBookmarksThunk());
  }
});

export interface RenameBookmarkThunkArg {
  id: number;
  title: string;
}

export const renameBookmarkThunk = createAsyncThunk<
  void,
  RenameBookmarkThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('bookmarks/rename', async (arg, { dispatch }) => {
  dispatch(renameBookmark(arg));
  const res = await api.bookmarks.rename({ id: arg.id, title: arg.title });
  if (!res.ok) {
    dispatch(pushToast({ kind: 'error', message: `Rename failed: ${res.message}` }));
    void dispatch(refreshBookmarksThunk());
  }
});

export interface DeleteBookmarkThunkArg {
  id: number;
}

export const deleteBookmarkThunk = createAsyncThunk<
  void,
  DeleteBookmarkThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('bookmarks/delete', async (arg, { dispatch }) => {
  dispatch(deleteBookmark(arg.id));
  const res = await api.bookmarks.delete({ id: arg.id });
  if (!res.ok) {
    dispatch(pushToast({ kind: 'error', message: `Delete failed: ${res.message}` }));
    void dispatch(refreshBookmarksThunk());
  }
});

export type { RecentsListItem };

// =============================================================================
// Phase 3 — Forms detection, fill commit, design, templates, mail merge
// =============================================================================

/**
 * Detect AcroForm fields in the open document. Fires after open + after
 * dialog-driven document changes that might have altered the field set
 * (combine, future scan).
 */
export const detectFormsThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('forms/detect', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  dispatch(setDetecting());
  const res = await api.forms.detect({ handle: doc.handle });
  if (!res.ok) {
    dispatch(setDetectError(res.message));
    // Silent — Forms sidebar handles the 'error' state. No toast.
    return;
  }
  dispatch(
    setDetected({
      fields: res.value.fields,
      hasAcroForm: res.value.hasAcroForm,
      hasXfaForm: res.value.hasXfaForm,
      hasJavaScriptActions: res.value.hasJavaScriptActions,
      warnings: res.value.warnings,
    }),
  );
});

/**
 * Commit pending form-fill values. Pure dispatcher — the form-commit-middleware
 * does the actual diff + applyEdit. Exported as a thunk so call-sites can
 * `await` and chain with save flows if needed.
 */
export const commitFormThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('forms/commit', async (_arg, { dispatch }) => {
  dispatch(triggerFormCommit());
});

export interface DesignAddFieldThunkArg {
  fieldDefinition: FormFieldDefinition;
}

/** Author a new field via IPC; on success dispatches the returned EditOperation + updates forms-slice. */
export const designAddFieldThunk = createAsyncThunk<
  void,
  DesignAddFieldThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('forms/designAdd', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.forms.designAdd({
    handle: doc.handle,
    fieldDefinition: arg.fieldDefinition,
  });
  if (!res.ok) {
    const msg =
      res.error === 'duplicate_field_name'
        ? `A field named "${arg.fieldDefinition.name}" already exists.`
        : res.error === 'invalid_field_definition'
          ? 'The field definition is invalid (check rect / options).'
          : res.error === 'page_out_of_range'
            ? 'The target page is out of range.'
            : res.message;
    dispatch(pushToast({ kind: 'error', message: `Add field failed: ${msg}` }));
    return;
  }
  for (const w of res.value.warnings) {
    dispatch(pushToast({ kind: 'warning', message: w }));
  }
  // Update forms-slice mirror; dispatch the EditOperation through applyEdit
  // so the history middleware captures the inverse.
  dispatch(addAuthoredField(res.value.normalizedFieldDefinition));
  dispatch(applyEdit(res.value.op as EditOperation));
});

export interface DesignRemoveFieldThunkArg {
  fieldName: string;
}

export const designRemoveFieldThunk = createAsyncThunk<
  void,
  DesignRemoveFieldThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('forms/designRemove', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.forms.designRemove({ handle: doc.handle, fieldName: arg.fieldName });
  if (!res.ok) {
    dispatch(pushToast({ kind: 'error', message: `Remove field failed: ${res.message}` }));
    return;
  }
  dispatch(removeFieldByName(arg.fieldName));
  dispatch(applyEdit(res.value.op as EditOperation));
});

/**
 * Flatten all form fields in the open document. Standard EditOperation
 * pattern — `forms:flatten` returns one `form-flatten` op which we dispatch
 * through applyEdit. Save will produce the flattened bytes.
 */
export const flattenFormsThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('forms/flatten', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.forms.flatten({ handle: doc.handle });
  if (!res.ok) {
    const msg =
      res.error === 'form_not_present'
        ? 'This document has no form fields to flatten.'
        : res.message;
    dispatch(pushToast({ kind: 'error', message: `Flatten failed: ${msg}` }));
    return;
  }
  for (const w of res.value.warnings) {
    dispatch(pushToast({ kind: 'warning', message: w }));
  }
  dispatch(applyEdit(res.value.op as EditOperation));
  dispatch(
    pushToast({
      kind: 'success',
      message: `Flattened ${res.value.flattenedFieldCount} form field${
        res.value.flattenedFieldCount === 1 ? '' : 's'
      } (undoable until save).`,
    }),
  );
});

export const listFormTemplatesThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('formsTemplates/list', async (_arg, { dispatch }) => {
  dispatch(setTemplatesLoading(true));
  const res = await api.forms.listTemplates({});
  if (!res.ok) {
    dispatch(setTemplatesError(res.message));
    return;
  }
  dispatch(setTemplateItems(res.value.items));
});

export interface SaveFormTemplateThunkArg {
  name: string;
  fields: FormFieldDefinition[];
  columnMappings?: Record<string, string>;
}

export const saveFormTemplateThunk = createAsyncThunk<
  void,
  SaveFormTemplateThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('formsTemplates/save', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.forms.saveTemplate(
    arg.columnMappings === undefined
      ? { handle: doc.handle, name: arg.name, fields: arg.fields }
      : {
          handle: doc.handle,
          name: arg.name,
          fields: arg.fields,
          columnMappings: arg.columnMappings,
        },
  );
  if (!res.ok) {
    const msg =
      res.error === 'name_in_use' ? `A template named "${arg.name}" already exists.` : res.message;
    dispatch(pushToast({ kind: 'error', message: `Save template failed: ${msg}` }));
    return;
  }
  // Optimistic — full list refresh would be ideal but the cheap path is to
  // synthesize a list item from what we just saved.
  const listItem: FormTemplateListItem = {
    id: res.value.id,
    name: arg.name,
    fieldCount: arg.fields.length,
    sourceDocHash: doc.fileHash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  dispatch(addTemplateItem(listItem));
  for (const w of res.value.warnings) {
    dispatch(pushToast({ kind: 'warning', message: w }));
  }
  dispatch(pushToast({ kind: 'success', message: `Template "${arg.name}" saved.` }));
});

export interface LoadFormTemplateThunkArg {
  templateId: number;
}

/**
 * Load a saved template; dispatches one `form-design-add` op per field so each
 * is undoable. Per architecture-phase-3.md §7.4.
 */
export const loadFormTemplateThunk = createAsyncThunk<
  void,
  LoadFormTemplateThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('formsTemplates/load', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) return;
  const res = await api.forms.loadTemplate({ templateId: arg.templateId });
  if (!res.ok) {
    dispatch(pushToast({ kind: 'error', message: `Load template failed: ${res.message}` }));
    return;
  }
  // Apply each field as a separate design-add op so each is independently
  // undoable. The handler-side designAdd channel validates + normalizes.
  for (const field of res.value.fields) {
    // Re-mark origin as authored since the template author treated them as such.
    const fd: FormFieldDefinition = { ...field, origin: 'authored', unsaved: true };
    // eslint-disable-next-line no-await-in-loop -- intentional sequential dispatch
    await dispatch(designAddFieldThunk({ fieldDefinition: fd }));
  }
  dispatch(
    pushToast({
      kind: 'success',
      message: `Loaded template "${res.value.name}" (${res.value.fields.length} fields).`,
    }),
  );
});

export interface ParseDataSourceThunkArg {
  bytes: Uint8Array;
  fileName: string;
  fileKind: 'csv' | 'xlsx';
}

export const parseDataSourceThunk = createAsyncThunk<
  void,
  ParseDataSourceThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('mailMerge/parseDataSource', async (arg, { dispatch }) => {
  const dataSource: MailMergeDataSource =
    arg.fileKind === 'csv' ? { kind: 'csv', bytes: arg.bytes } : { kind: 'xlsx', bytes: arg.bytes };
  const res = await api.forms.parseDataSource({ dataSource, previewRowCount: 5 });
  if (!res.ok) {
    const msg =
      res.error === 'invalid_data_source'
        ? 'Could not parse the file. Is it a valid CSV or XLSX?'
        : res.message;
    dispatch(pushToast({ kind: 'error', message: `Parse failed: ${msg}` }));
    return;
  }
  dispatch(
    setDataPreview({
      fileName: arg.fileName,
      fileKind: arg.fileKind,
      bytes: arg.bytes,
      headers: res.value.headers,
      previewRows: res.value.previewRows,
      totalRowCount: res.value.totalRowCount,
      warnings: res.value.warnings,
    }),
  );
  for (const w of res.value.warnings) {
    dispatch(pushToast({ kind: 'warning', message: w }));
  }
});

export interface RunMailMergeThunkArg {
  job: MailMergeJob;
}

export const runMailMergeThunk = createAsyncThunk<
  void,
  RunMailMergeThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('mailMerge/run', async (arg, { dispatch }) => {
  dispatch(runStarted({ jobId: arg.job.jobId }));

  // Subscribe to progress events; the renderer's mail-merge-slice consumes via progressTick.
  const unsubscribe = api.events.onMailMergeProgress((evt) => {
    dispatch(progressTick(evt));
  });

  try {
    const res = await api.forms.runMailMerge({ job: arg.job });
    if (!res.ok) {
      const msg =
        res.error === 'cancelled'
          ? 'Mail merge cancelled.'
          : res.error === 'unmapped_required_field'
            ? 'A required field has no column mapping.'
            : res.error === 'data_parse_failed'
              ? 'The data file could not be parsed.'
              : res.error === 'output_path_invalid'
                ? 'The output path was rejected.'
                : res.error === 'fs_write_failed'
                  ? 'Failed to write output file(s).'
                  : res.message;
      dispatch(runFailed(msg));
      dispatch(pushToast({ kind: 'error', message: `Mail merge: ${msg}` }));
      return;
    }
    dispatch(
      runCompleted({
        rowsWritten: res.value.rowsWritten,
        totalRows: res.value.totalRows,
        outputPath: res.value.outputPath,
        wasCancelled: res.value.wasCancelled,
        warnings: res.value.warnings,
      }),
    );
    if (!res.value.wasCancelled) {
      dispatch(
        pushToast({
          kind: 'success',
          message: `Mail merge complete: ${res.value.rowsWritten} of ${res.value.totalRows} rows written.`,
        }),
      );
    }
  } finally {
    unsubscribe();
  }
});

export interface CancelMailMergeThunkArg {
  jobId: string;
}

export const cancelMailMergeThunk = createAsyncThunk<
  void,
  CancelMailMergeThunkArg,
  { dispatch: AppDispatch; state: RootState }
>('mailMerge/cancel', async (arg, { dispatch }) => {
  const res = await api.forms.cancelMailMerge({ jobId: arg.jobId });
  if (!res.ok) {
    dispatch(pushToast({ kind: 'warning', message: 'Mail merge already finished.' }));
  }
});

// Re-export for component imports.
export type { FormFieldDefinition, FormFieldValue, MailMergeJob, MailMergeOutputMode };
