// Auto-bookmark thunks — Phase 7.5 B19 UI (Riley Wave 5).
//
// David's `pdf:autoBookmarkFromHeadings` (Wave 4) is the canonical engine.
// The renderer thunk:
//   1. Detect: dispatches via `api.pdf.autoBookmarkFromHeadings`, normalizes
//      the engine's ProposedBookmark[] into the slice's editable AutoBookmarkRow[].
//   2. Save: walks the user-confirmed rows and dispatches each via the
//      existing `bookmarks:upsert` channel (Phase 2 IPC, already canonical).
//      Replace mode wipes existing bookmarks first via `bookmarks:delete`;
//      Append mode keeps them.

import { createAsyncThunk } from '@reduxjs/toolkit';

import { api } from '../services/api';

import {
  type AutoBookmarkRow,
  closeAutoBookmark,
  setAutoBookmarkLastError,
  setAutoBookmarkProposed,
  setAutoBookmarkStep,
} from './slices/auto-bookmark-slice';
import { pushToast } from './slices/ui-slice';
import { type AppDispatch, type RootState } from './store';
import { refreshBookmarksThunk } from './thunks';

function makeRowId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return `ab-${c.randomUUID()}`;
  return `ab-${Math.random().toString(36).slice(2, 12)}`;
}

export const detectAutoBookmarksThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('autoBookmark/detect', async (_arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) {
    dispatch(setAutoBookmarkLastError('No document open.'));
    return;
  }
  dispatch(setAutoBookmarkStep('detecting'));
  const res = await api.pdf.autoBookmarkFromHeadings({
    handle: doc.handle,
    heuristic: state.autoBookmark.heuristic,
    maxDepth: state.autoBookmark.maxDepth,
  });
  if (!res.ok) {
    // The api.ts fallback (when the preload bridge is absent) casts
    // `'bridge_unavailable'` into the channel's error union at runtime; the
    // canonical TypeScript union does NOT include it, so we compare via a
    // widened string cast (same pattern thunks-phase7-4.ts uses).
    const errStr: string = res.error;
    const msg =
      errStr === 'no_headings_detected'
        ? 'No headings were detected by the font-size heuristic. Try a different document.'
        : errStr === 'bridge_unavailable'
          ? 'Auto-bookmark engine is not available in this build.'
          : res.message;
    dispatch(setAutoBookmarkLastError(msg));
    return;
  }
  const rows: AutoBookmarkRow[] = res.value.proposed.map((p) => ({
    id: makeRowId(),
    title: p.title,
    pageIndex: p.pageIndex,
    depth: p.depth,
    deleted: false,
  }));
  dispatch(setAutoBookmarkProposed({ rows, warnings: res.value.warnings }));
});

export const saveAutoBookmarksThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('autoBookmark/save', async (_arg, { dispatch, getState }) => {
  const state = getState();
  const doc = state.document.current;
  if (!doc) return;
  const ab = state.autoBookmark;
  const accepted = ab.proposed.filter((r) => !r.deleted && r.title.trim().length > 0);
  if (accepted.length === 0) {
    dispatch(setAutoBookmarkLastError('At least one bookmark must be kept.'));
    return;
  }
  dispatch(setAutoBookmarkStep('saving'));

  // Replace mode: delete existing user bookmarks first. We use the canonical
  // bookmarks namespace via `api.bookmarks`. Engine-side cascade-delete of
  // children is implementation-defined; for safety we delete leaves first.
  if (ab.mergeMode === 'replace') {
    const flat: number[] = [];
    const walk = (list: ReadonlyArray<{ id: number; children: readonly unknown[] }>): void => {
      for (const b of list) {
        walk(b.children as ReadonlyArray<{ id: number; children: readonly unknown[] }>);
        flat.push(b.id);
      }
    };
    walk(state.bookmarks.tree);
    for (const id of flat) {
      try {
        await api.bookmarks.delete({ id });
      } catch {
        // best effort — engine may already have cascaded.
      }
    }
  }

  // Build a depth->parent stack so we can resolve parentId for each row.
  // The engine guarantees depth 0 first + no depth skips; we still defend.
  const parentStack: Array<{ depth: number; id: number }> = [];
  let nextSortOrderByParent: Record<string, number> = {};
  const sortKey = (parentId: number | null): string =>
    parentId === null ? '_root' : String(parentId);

  for (const row of accepted) {
    // Pop stack frames at or below this row's depth.
    while (parentStack.length > 0 && parentStack[parentStack.length - 1]!.depth >= row.depth) {
      parentStack.pop();
    }
    const parentId = parentStack.length > 0 ? parentStack[parentStack.length - 1]!.id : null;
    const key = sortKey(parentId);
    const sortOrder = nextSortOrderByParent[key] ?? 0;
    nextSortOrderByParent = {
      ...nextSortOrderByParent,
      [key]: sortOrder + 1,
    };

    const res = await api.bookmarks.upsert({
      fileHash: doc.fileHash,
      pageIndex: row.pageIndex,
      title: row.title.trim(),
      parentId,
      sortOrder,
    });
    if (!res.ok) {
      dispatch(setAutoBookmarkLastError(res.message));
      dispatch(pushToast({ kind: 'error', message: res.message }));
      return;
    }
    parentStack.push({ depth: row.depth, id: res.value.id });
  }

  dispatch(closeAutoBookmark());
  dispatch(
    pushToast({
      kind: 'success',
      message: `Created ${accepted.length} bookmark${accepted.length === 1 ? '' : 's'} from headings.`,
    }),
  );
  // Refresh the bookmarks panel so the newly-created tree appears.
  await dispatch(refreshBookmarksThunk());
});
