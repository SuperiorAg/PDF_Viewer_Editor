// Phase 7.5 Wave 5b thunks — C3 Tag PDF (structure-tree authoring).
//
// Same parallel-wave coordination pattern Wave 5a established
// (`thunks-phase7-5-wave5a.ts`): feature-detect David's bridge methods on
// `window.pdfApi.pdf.{getStructTree,setStructTree,autoTagPages}` via the
// `services/struct-tree-api.ts` wrappers (NO `as any`). When David's
// preload bridge lands, the wrappers transparently route through to the
// real IPC channels; until then they return `bridge_unavailable` and the
// renderer surfaces an honest "engine pending" message instead of crashing.
//
// HONESTY CLAUSE: Apply gates on `selectStructTreeDirty` so the user can
// never accidentally write an empty/unchanged tree to David's side-table.
// Auto-tag only fires after the user clicks Run in the confirm modal —
// never on panel open. The 1064-page perf gate is respected because we
// pass `'all'` only when the user explicitly chooses it; the default is
// the current viewport's surrounding range (UI may restrict in v2).

import { createAsyncThunk } from '@reduxjs/toolkit';

import {
  callAutoTagPages,
  callGetStructTree,
  callSetStructTree,
} from '../services/struct-tree-api';
import type { AutoTagPageRange, StructTreeNode } from '../types/struct-tree-contract-stub';

import {
  acceptAutoTagPreview,
  appliedTree,
  autoTagPreviewReady,
  loadedTree,
  setAutoTagConfirmOpen,
  setAutoTagRunning,
  setStructTreeApplying,
  setStructTreeLastError,
  setStructTreeLoading,
} from './slices/struct-tree-slice';
import { pushToast } from './slices/ui-slice';
import type { AppDispatch, RootState } from './store';

// ============================================================================
// loadStructTreeThunk — dispatched when the user opens the Accessibility tab
//   OR when the active document changes. Pulls the merged tree (in-PDF +
//   side-table) so resume-after-crash works without renderer-side merge.
// ============================================================================

export const loadStructTreeThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('structTree/load', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) {
    dispatch(setStructTreeLastError('Open a document before opening the Tag PDF panel.'));
    return;
  }
  dispatch(setStructTreeLoading(true));
  const res = await callGetStructTree({
    handle: doc.handle,
    mergeWithEditSession: true,
  });
  if (!res.ok) {
    // bridge_unavailable is the honest "David hasn't landed yet" path — keep
    // the panel in its loading-failed state with a clear message rather than
    // toasting (the panel surfaces it inline). Other errors get a toast.
    dispatch(setStructTreeLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  dispatch(
    loadedTree({
      // `doc.fileHash` is the SHA hash the side-table keys on; `doc.handle`
      // is the numeric main-process handle.
      docHash: doc.fileHash,
      root: res.value.root,
      hasExistingTags: res.value.hasExistingTags,
    }),
  );
});

// ============================================================================
// applyStructTreeThunk — Apply button on the panel. Persists the live tree
//   to David's side-table via pdf:setStructTree. The materializer writes
//   /StructTreeRoot on Save (handled by the existing Save flow + the
//   save-as-copy disclosure in the panel header).
// ============================================================================

export const applyStructTreeThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('structTree/apply', async (_arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setStructTreeLastError('Open a document before applying tag edits.'));
    return;
  }
  const root: StructTreeNode | null = state.structTree.currentRoot;
  if (root === null) {
    dispatch(setStructTreeLastError('No tag tree to apply yet.'));
    return;
  }
  if (!state.structTree.dirty) {
    // Nothing to do — Apply button is disabled in this state, but
    // belt-and-braces guard against a keyboard shortcut firing while clean.
    return;
  }
  dispatch(setStructTreeApplying(true));
  const res = await callSetStructTree({ handle: doc.handle, root });
  if (!res.ok) {
    dispatch(setStructTreeLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  dispatch(appliedTree());
  dispatch(
    pushToast({
      kind: 'success',
      message: 'Tag edits saved to session — Save the document to write tags into the PDF.',
    }),
  );
});

// ============================================================================
// runAutoTagThunk — heuristic preview. Honors P7.5-L-10 obligation #3:
//   only fires after the user explicitly confirms in the confirm modal.
//   The confirm modal copy lives in the Tag-PDF panel (i18n key
//   `modals:accessibility.tagPdf.autoTagConfirm`).
// ============================================================================

export interface RunAutoTagArg {
  pages: AutoTagPageRange;
}

export const runAutoTagThunk = createAsyncThunk<
  void,
  RunAutoTagArg,
  { dispatch: AppDispatch; state: RootState }
>('structTree/autoTag', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) {
    dispatch(setStructTreeLastError('Open a document before running auto-tag.'));
    return;
  }
  dispatch(setAutoTagRunning(true));
  const res = await callAutoTagPages({
    handle: doc.handle,
    pages: arg.pages,
    heuristic: 'font-size-cluster',
  });
  if (!res.ok) {
    dispatch(setStructTreeLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    dispatch(setAutoTagConfirmOpen(false));
    return;
  }
  dispatch(
    autoTagPreviewReady({
      proposedRoot: res.value.proposedRoot,
      warnings: res.value.warnings,
    }),
  );
});

/** Convenience composed thunk — accept the current preview and immediately
 *  apply it. Useful when the user clicks "Accept & Apply" rather than
 *  "Accept then review". */
export const acceptAndApplyAutoTagThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('structTree/acceptAndApplyAutoTag', async (_arg, { dispatch, getState }) => {
  if (getState().structTree.autoTagPreview === null) return;
  dispatch(acceptAutoTagPreview());
  await dispatch(applyStructTreeThunk()).unwrap();
});
