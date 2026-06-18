// Phase 7.5 Wave 5c thunks — C4 Reading Order + C5 Alt Text inspector.
//
// Same parallel-wave coordination pattern Wave 5a/5b established:
// feature-detect David's bridge methods on
// `window.pdfApi.pdf.{getReadingOrder,setReadingOrder,setAltText,listFiguresWithoutAltText}`
// via the `services/{reading-order,alt-text}-api.ts` wrappers (NO `as any`).
// When David's preload bridge lands, the wrappers transparently route through
// to the real IPC channels; until then they return `bridge_unavailable` and
// the UI surfaces an honest "engine pending" message instead of crashing.
//
// HONESTY CLAUSE:
//   - Reading-order Apply gates on `selectReadingOrderDirty` so the user
//     can never accidentally write an unchanged order.
//   - Apply also gates on `isOrderContiguous` — the engine rejects
//     `order_inconsistent` anyway, but we'd rather catch it client-side
//     than round-trip a guaranteed-rejected payload.
//   - Alt-text Apply: empty string IS the documented sentinel for "remove
//     alt" (David §19.7.5). We do NOT confirm on empty — the user typed it.
//   - Auto-detect: reuses the auto-tag spatial walker via a heuristic flag
//     (David exposes a single `pdf:getReadingOrder` with a `recompute`
//     boolean in his canonical surface, per the Wave-plan parallel-task
//     note). Wave 5c renderer-side just re-fetches with the flag; David's
//     parallel commit wires the heuristic.

import { createAsyncThunk } from '@reduxjs/toolkit';

import { callListFiguresWithoutAltText, callSetAltText } from '../services/alt-text-api';
import { callGetReadingOrder, callSetReadingOrder } from '../services/reading-order-api';
import { isOrderContiguous } from '../types/reading-order-contract-stub';

import {
  altTextApplyFailed,
  altTextApplyingStart,
  appliedAltText,
  closeAltTextBulkModal,
  loadedFigures,
  setAltTextLastError,
  setAltTextLoading,
} from './slices/alt-text-slice';
import {
  appliedOrder,
  autoDetectedOrder,
  loadedOrder,
  setAutoDetectRunning,
  setReadingOrderApplying,
  setReadingOrderLastError,
  setReadingOrderLoading,
} from './slices/reading-order-slice';
import { pushToast } from './slices/ui-slice';
import type { AppDispatch, RootState } from './store';

// ============================================================================
// Reading Order — C4
// ============================================================================

export const loadReadingOrderThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('readingOrder/load', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) {
    dispatch(setReadingOrderLastError('Open a document before opening the Reading Order overlay.'));
    return;
  }
  dispatch(setReadingOrderLoading(true));
  const res = await callGetReadingOrder({ handle: doc.handle });
  if (!res.ok) {
    dispatch(setReadingOrderLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  // Pick out the 10k-node truncation banner (Wave 5b carry-over). The
  // engine emits it as a free-form string in `warnings`; we look for the
  // 'truncat' substring to pick up "truncated at 10000 nodes" variants.
  let truncationWarning: string | null = null;
  const warnings = res.value.warnings ?? [];
  for (const w of warnings) {
    if (w.toLowerCase().includes('truncat')) {
      truncationWarning = w;
      break;
    }
  }
  dispatch(
    loadedOrder({
      docHash: doc.fileHash,
      order: res.value.order,
      truncationWarning,
    }),
  );
});

export const applyReadingOrderThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('readingOrder/apply', async (_arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setReadingOrderLastError('Open a document before applying reading-order edits.'));
    return;
  }
  const order = state.readingOrder.order;
  if (order.length === 0) {
    dispatch(setReadingOrderLastError('No reading order to apply.'));
    return;
  }
  if (!isOrderContiguous(order)) {
    // Belt-and-braces: the move helper always re-indexes 0..N-1, so this
    // should never fire. If it does, surface a clear engine-style error.
    dispatch(setReadingOrderLastError('Reading order is not contiguous (0..N-1).'));
    return;
  }
  dispatch(setReadingOrderApplying(true));
  const res = await callSetReadingOrder({ handle: doc.handle, order });
  if (!res.ok) {
    dispatch(setReadingOrderLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  dispatch(appliedOrder());
  dispatch(
    pushToast({
      kind: 'success',
      message:
        'Reading order saved to session — Save the document to write the order into the PDF.',
    }),
  );
});

/** Auto-detect from layout. David exposes this as a re-fetch with a
 *  `recompute: true` hint on `pdf:getReadingOrder`; until his canonical
 *  surface lands the renderer falls through to the same `getReadingOrder`
 *  call (the engine returns whatever order it has; the user re-runs after
 *  David's commit lands the spatial walker). The intermediate UX is honest:
 *  the button label flips to "Auto-detect (engine pending)" when the
 *  bridge is missing — see the overlay component. */
export const autoDetectReadingOrderThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('readingOrder/autoDetect', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) {
    dispatch(setReadingOrderLastError('Open a document before auto-detecting reading order.'));
    return;
  }
  dispatch(setAutoDetectRunning(true));
  // Same channel; David's parallel commit wires `recompute: true` on a
  // `PdfGetReadingOrderRequest`. Until then the renderer passes the bare
  // request and the engine returns the same order — the user sees a
  // toast that this needs David's parallel commit.
  const res = await callGetReadingOrder({ handle: doc.handle });
  if (!res.ok) {
    dispatch(setReadingOrderLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  dispatch(autoDetectedOrder({ order: res.value.order }));
});

// ============================================================================
// Alt Text — C5
// ============================================================================

export const loadFiguresWithoutAltThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('altText/load', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) {
    dispatch(setAltTextLastError('Open a document before opening the Alt Text inspector.'));
    return;
  }
  dispatch(setAltTextLoading(true));
  const res = await callListFiguresWithoutAltText({ handle: doc.handle });
  if (!res.ok) {
    dispatch(setAltTextLastError(res.message));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  dispatch(loadedFigures({ docHash: doc.fileHash, figures: res.value.figures }));
});

export interface ApplyAltTextArg {
  structNodeId: string;
  altText: string;
}

export const applyAltTextThunk = createAsyncThunk<
  void,
  ApplyAltTextArg,
  { dispatch: AppDispatch; state: RootState }
>('altText/apply', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) {
    dispatch(setAltTextLastError('Open a document before applying alt text.'));
    return;
  }
  dispatch(altTextApplyingStart({ structNodeId: arg.structNodeId }));
  const res = await callSetAltText({
    handle: doc.handle,
    structNodeId: arg.structNodeId,
    altText: arg.altText,
  });
  if (!res.ok) {
    dispatch(altTextApplyFailed({ structNodeId: arg.structNodeId, message: res.message }));
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  dispatch(appliedAltText({ structNodeId: arg.structNodeId }));
});

export interface ApplyBulkAltTextArg {
  structNodeIds: string[];
  altText: string;
}

export const applyBulkAltTextThunk = createAsyncThunk<
  void,
  ApplyBulkAltTextArg,
  { dispatch: AppDispatch; state: RootState }
>('altText/applyBulk', async (arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) {
    dispatch(setAltTextLastError('Open a document before applying alt text.'));
    return;
  }
  let appliedCount = 0;
  let firstError: string | null = null;
  for (const structNodeId of arg.structNodeIds) {
    dispatch(altTextApplyingStart({ structNodeId }));
    // Re-check the doc handle between iterations in case the user closes
    // the document mid-bulk. selectCurrentDocument may be null on a
    // closed doc — bail honestly.
    const stillOpen = getState().document.current;
    if (!stillOpen || stillOpen.handle !== doc.handle) {
      dispatch(altTextApplyFailed({ structNodeId, message: 'Document closed mid-bulk.' }));
      break;
    }
    const res = await callSetAltText({
      handle: doc.handle,
      structNodeId,
      altText: arg.altText,
    });
    if (!res.ok) {
      dispatch(altTextApplyFailed({ structNodeId, message: res.message }));
      if (firstError === null) firstError = res.message;
      continue;
    }
    dispatch(appliedAltText({ structNodeId }));
    appliedCount += 1;
  }
  dispatch(closeAltTextBulkModal());
  if (appliedCount > 0) {
    dispatch(
      pushToast({
        kind: 'success',
        message: `Alt text applied to ${appliedCount} figure${appliedCount === 1 ? '' : 's'}.`,
      }),
    );
  }
  if (firstError !== null && appliedCount === 0) {
    dispatch(pushToast({ kind: 'error', message: firstError }));
  }
});
