// Phase 7.5 Wave 7 thunks — B2 Compare Files workspace.
//
// David's contracts for pdf:openComparePair / pdf:compareTextOnPage /
// pdf:compareVisualOnPage / pdf:closeCompareSession are live; the api proxy
// reaches them through the canonical PdfApi shape (no `as any`, no feature
// detect).
//
// Responsibilities:
//   1. openCompareSessionThunk — given two CompareFileSource picks (open-doc
//      or path), resolve them to DocumentHandles main-side then call David's
//      openComparePair. On success dispatch sessionOpened.
//   2. ensureCompareTextLoadedThunk — dedupe + run pdf:compareTextOnPage for
//      a pair index.
//   3. ensureCompareVisualLoadedThunk — dedupe + run pdf:compareVisualOnPage
//      for a pair index. Decodes the base64 PNGs into Blob URLs that the
//      workspace renders. Revokes prior URLs if the pair re-loads.
//   4. closeCompareSessionThunk — revoke every outstanding blob URL THEN
//      dispatch the close + IPC.
//
// Blob URL hygiene (P7.5 hard rule):
//   - URL.createObjectURL only happens here, in the visual-load thunk.
//   - URL.revokeObjectURL is called in TWO places: (a) when a pair is
//     re-loaded the prior URLs are revoked (rare — virtualized list doesn't
//     normally re-request); (b) on close, every pair's URLs are revoked
//     before sessionClosed runs.
//
// Open-doc resolution:
//   - The setup dialog stores CompareFileSource.handleString for open-doc
//     picks. The thunk hands David an opaque DocumentHandle string — David's
//     openComparePair signature accepts `DocumentHandle` (per the contract).
//     Path picks need a separate dialog:openPdf round-trip to register the
//     handle main-side first (David's contract is handle-only; the
//     openComparePair handler does NOT read paths). The thunk performs that
//     dance transparently.

import { createAsyncThunk } from '@reduxjs/toolkit';

import { api } from '../services/api';
import type { DocumentHandle } from '../types/ipc-contract';

import {
  cleared,
  fromContractTextValue,
  fromContractVisualValue,
  sessionClosed,
  sessionOpened,
  setupOpeningFailed,
  setupOpeningStarted,
  textRequestFailed,
  textRequestStarted,
  textRequestSucceeded,
  visualRequestFailed,
  visualRequestStarted,
  visualRequestSucceeded,
  COMPARE_DEFAULT_RENDER_WIDTH,
  selectComparePairEntry,
  selectCompareEvictableBlobs,
  selectCompareSession,
  selectCompareTextInflight,
  selectCompareVisualInflight,
} from './slices/compare-slice';
import type { CompareFileSource, CompareSession } from './slices/compare-slice';
import { pushToast } from './slices/ui-slice';
import type { AppDispatch, RootState } from './store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a CompareFileSource to a (DocumentHandle, displayName) pair.
 *  Open-doc picks already hold a handle string. Path picks call
 *  `dialog:openPdf` so main can register the handle + we get the doc's
 *  display name + page count. Returns null on cancel/error. */
async function resolveSourceToHandle(
  source: CompareFileSource,
): Promise<{ handle: DocumentHandle; displayName: string } | null> {
  if (source.kind === 'open-doc') {
    return {
      handle: source.handle as DocumentHandle,
      displayName: source.displayName,
    };
  }
  // path → register through dialog:readPdf (fs.readPdf accepts an absolute
  // path and returns the handle + page count). dialog:openPdf would re-pop
  // the OS picker. fs.readPdf is the right entry.
  const res = await api.fs.readPdf({ droppedPath: source.path });
  if (!res.ok) {
    return null;
  }
  return {
    handle: res.value.handle,
    displayName: res.value.displayName,
  };
}

/** Decode a base64 PNG string to a Blob URL. Pure helper — the thunks
 *  that own URL.createObjectURL also own URL.revokeObjectURL. */
function base64PngToBlobUrl(b64: string | null): string | null {
  if (b64 === null || b64.length === 0) return null;
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'image/png' });
  return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// openCompareSessionThunk
// ---------------------------------------------------------------------------

export interface OpenCompareSessionArgs {
  left: CompareFileSource;
  right: CompareFileSource;
}

export const openCompareSessionThunk = createAsyncThunk<
  void,
  OpenCompareSessionArgs,
  { state: RootState; dispatch: AppDispatch }
>('compare/openSession', async (args, thunkApi) => {
  thunkApi.dispatch(setupOpeningStarted());
  const leftResolved = await resolveSourceToHandle(args.left);
  if (!leftResolved) {
    thunkApi.dispatch(setupOpeningFailed('Could not open the left document.'));
    return;
  }
  const rightResolved = await resolveSourceToHandle(args.right);
  if (!rightResolved) {
    thunkApi.dispatch(setupOpeningFailed('Could not open the right document.'));
    return;
  }
  const res = await api.pdf.openComparePair({
    leftHandle: leftResolved.handle,
    rightHandle: rightResolved.handle,
  });
  if (!res.ok) {
    thunkApi.dispatch(setupOpeningFailed(res.message));
    thunkApi.dispatch(pushToast({ kind: 'error', message: `Compare Files: ${res.message}` }));
    return;
  }
  const session: CompareSession = {
    sessionId: res.value.compareSessionId,
    leftDisplayName: leftResolved.displayName,
    rightDisplayName: rightResolved.displayName,
    pageCountLeft: res.value.pageCountLeft,
    pageCountRight: res.value.pageCountRight,
    // Copy from David's readonly array into the slice's mutable shape.
    pagePairs: res.value.pagePairs.map((p) => ({ ...p })),
  };
  thunkApi.dispatch(sessionOpened(session));
});

// ---------------------------------------------------------------------------
// ensureCompareTextLoadedThunk
// ---------------------------------------------------------------------------

export interface EnsurePairLoadedArgs {
  pairIndex: number;
}

export const ensureCompareTextLoadedThunk = createAsyncThunk<
  void,
  EnsurePairLoadedArgs,
  { state: RootState; dispatch: AppDispatch }
>('compare/ensureTextLoaded', async (args, thunkApi) => {
  const state = thunkApi.getState();
  const session = selectCompareSession(state);
  if (!session) return;
  if (selectCompareTextInflight(state, args.pairIndex)) return;
  const existing = selectComparePairEntry(state, args.pairIndex);
  if (existing && existing.text.status === 'ready') return;
  const pair = session.pagePairs[args.pairIndex];
  if (!pair) return;
  thunkApi.dispatch(textRequestStarted(args.pairIndex));
  const res = await api.pdf.compareTextOnPage({
    compareSessionId: session.sessionId,
    leftPageIndex: pair.leftPageIndex,
    rightPageIndex: pair.rightPageIndex,
  });
  if (!res.ok) {
    thunkApi.dispatch(textRequestFailed({ pairIndex: args.pairIndex, message: res.message }));
    return;
  }
  thunkApi.dispatch(
    textRequestSucceeded({
      pairIndex: args.pairIndex,
      value: fromContractTextValue(res.value),
    }),
  );
});

// ---------------------------------------------------------------------------
// ensureCompareVisualLoadedThunk
// ---------------------------------------------------------------------------

export interface EnsureVisualLoadedArgs extends EnsurePairLoadedArgs {
  /** Optional renderWidth override. Defaults to the slice default. */
  renderWidth?: number;
}

export const ensureCompareVisualLoadedThunk = createAsyncThunk<
  void,
  EnsureVisualLoadedArgs,
  { state: RootState; dispatch: AppDispatch }
>('compare/ensureVisualLoaded', async (args, thunkApi) => {
  const state = thunkApi.getState();
  const session = selectCompareSession(state);
  if (!session) return;
  if (selectCompareVisualInflight(state, args.pairIndex)) return;
  const existing = selectComparePairEntry(state, args.pairIndex);
  if (existing && existing.visual.status === 'ready') return;
  const pair = session.pagePairs[args.pairIndex];
  if (!pair) return;
  thunkApi.dispatch(visualRequestStarted(args.pairIndex));
  const res = await api.pdf.compareVisualOnPage({
    compareSessionId: session.sessionId,
    leftPageIndex: pair.leftPageIndex,
    rightPageIndex: pair.rightPageIndex,
    renderWidth: args.renderWidth ?? COMPARE_DEFAULT_RENDER_WIDTH,
  });
  if (!res.ok) {
    thunkApi.dispatch(visualRequestFailed({ pairIndex: args.pairIndex, message: res.message }));
    return;
  }
  // Convert base64 PNGs to blob URLs. The slice will revoke these on close.
  const diffMaskUrl = base64PngToBlobUrl(res.value.diffMaskPng);
  const leftUrl = base64PngToBlobUrl(res.value.leftPagePng);
  const rightUrl = base64PngToBlobUrl(res.value.rightPagePng);
  if (diffMaskUrl === null) {
    // engine guarantees a non-null diff mask; surface as error if it ever
    // is missing so we don't store a broken entry.
    thunkApi.dispatch(
      visualRequestFailed({ pairIndex: args.pairIndex, message: 'rasterize_failed' }),
    );
    return;
  }
  thunkApi.dispatch(
    visualRequestSucceeded({
      pairIndex: args.pairIndex,
      value: fromContractVisualValue(res.value),
      diffMaskUrl,
      leftUrl,
      rightUrl,
    }),
  );
});

// ---------------------------------------------------------------------------
// closeCompareSessionThunk
// ---------------------------------------------------------------------------

/** Revoke every cached blob URL and dispatch sessionClosed + the IPC close.
 *  Always safe to call (no-op if no session). */
export const closeCompareSessionThunk = createAsyncThunk<
  void,
  void,
  { state: RootState; dispatch: AppDispatch }
>('compare/closeSession', async (_unused, thunkApi) => {
  const state = thunkApi.getState();
  const session = selectCompareSession(state);
  if (!session) {
    thunkApi.dispatch(cleared());
    return;
  }
  const evictable = selectCompareEvictableBlobs(state);
  for (const entry of evictable) {
    for (const url of entry.urls) {
      URL.revokeObjectURL(url);
    }
  }
  thunkApi.dispatch(sessionClosed());
  // Fire-and-forget the main-side close so the engine can free the session.
  // Errors here are non-blocking; surface as a toast and continue.
  const res = await api.pdf.closeCompareSession({ compareSessionId: session.sessionId });
  if (!res.ok && res.error !== 'session_not_found') {
    thunkApi.dispatch(
      pushToast({
        kind: 'warning',
        message: `Compare Files: could not close session cleanly (${res.error}).`,
      }),
    );
  }
});
