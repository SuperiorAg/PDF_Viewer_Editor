// History middleware — Phase 2 ACTIVE form. Per conventions §6.5 + §13.3 and
// ARCHITECTURE.md §5.3.
//
// Lifecycle:
//   1. Any action with `meta.undoable: true` is intercepted BEFORE next().
//   2. We snapshot the pre-action state (for inverse computation that depends
//      on prior state — `delete`'s `preservedSource`, etc.).
//   3. After next(action) commits the forward op, we compute `inverseOf(op,
//      beforeState)` and dispatch `historySlice/pushEntry` with FOUR fields:
//      { fwd: compacted, inv: compacted-inv, rawFwd: raw-fwd, rawInv: raw-inv }.
//      Compacted forms zero image bytes (conventions §13.3) for storage
//      footprint; raw forms preserve full bytes for on-the-wire dispatch.
//   4. Undo/Redo actions (history/undo, history/redo) replay against the doc:
//      - undo: pop past → dispatch `rawInv` → push onto future
//      - redo: pop future → dispatch `rawFwd` → push onto past
//
// Why dispatch raw and store compacted (Wave 8.6 N-1 fix):
//   The dispatched op flows into `dirtyOps` (document-slice-apply.ts:62) which
//   is sent verbatim via IPC `fs:applyEditOps` to the main-process replay
//   engine. The engine's `embedImage()` rejects empty bytes BEFORE consulting
//   the image-cache (image-embed.ts:69-71). If the dispatched op were the
//   compacted form, an undo-of-delete-image-page followed by save would fail
//   with `invalid_image`. The two-state model resolves this: history storage
//   stays compact; the wire stays byte-bearing. See `docs/code-review.md` Wave
//   8.5 re-audit N-1 finding for the full trace.
//
// The middleware tags its own dispatch path with `meta.__history: true` so the
// re-entrant `applyEdit` dispatched during undo/redo doesn't push a new entry
// (which would create an infinite loop / corrupted stack).
//
// -----------------------------------------------------------------------------
// Memory model for image-op history entries (Wave 10 R-10.2)
// -----------------------------------------------------------------------------
// HistoryEntry is { fwd, inv, rawFwd, rawInv } — four EditOperation refs. For
// image-bearing ops the COMPACTED forms (fwd, inv) hold a fresh empty
// Uint8Array per call (negligible — 0 bytes payload). The RAW forms (rawFwd,
// rawInv) hold the byte-bearing references the wire requires.
//
// Buffer-sharing reality (verified via `document-inverses.ts` `inverseOf`):
//   * For `image-insert` → inverse `delete{preservedSource:image}`:
//       rawFwd.image            === rawInv.preservedSource.image   (same ImageEmbedPayload ref)
//       rawFwd.image.bytes      === rawInv.preservedSource.image.bytes (same Uint8Array)
//   * For `delete{preservedSource:image}` → inverse `image-insert`:
//       rawFwd.preservedSource.image       === rawInv.image
//       rawFwd.preservedSource.image.bytes === rawInv.image.bytes
//
// `inverseOf` constructs the partner op by aliasing `op.image` /
// `op.preservedSource.image` directly (no structuredClone, no Uint8Array
// copy) — so the dedup is automatic by JS reference semantics. Per
// image-op history entry the engine holds exactly ONE copy of the bytes,
// not two. The architectural ceiling (architecture-phase-2.md §6 "main keeps
// bytes; renderer-side history bytes are short-lived because they're
// dispatched to main on save") therefore translates to ~25 MB per ~50
// image-op entries at the maxHistory=100 cap, not the doubled ~50 MB
// originally feared. Renderer-side history bytes remain short-lived in
// practice because saves drain dirtyOps and the bytes flow to main's
// long-lived image-cache anyway.
//
// Invariant maintenance: any future change to `inverseOf` that introduces
// a fresh Uint8Array (e.g. structuredClone of `op.image`, slice/copy of
// bytes) BREAKS this dedup and doubles the per-entry footprint. A defensive
// regression test belongs in `document-inverses.test.ts` if/when that
// change is contemplated — pin `rawFwd.image.bytes === rawInv.preservedSource.image.bytes`
// for the image-insert case and the symmetric delete-image case.

import { type Middleware } from '@reduxjs/toolkit';

import { type EditOperation, type PDFDocumentModel } from '../../types/ipc-contract';
import { compactImageOpForHistory, inverseOf } from '../slices/document-inverses';
import { applyEdit } from '../slices/document-slice';
import { popFutureToPast, popPastToFuture, pushEntry } from '../slices/history-slice';

interface UndoableActionShape {
  type: string;
  payload: EditOperation;
  meta?: { undoable?: boolean; __history?: boolean };
}

function isUndoableEditAction(action: unknown): action is UndoableActionShape {
  if (typeof action !== 'object' || action === null) return false;
  const a = action as { type?: unknown; meta?: unknown; payload?: unknown };
  if (typeof a.type !== 'string') return false;
  if (a.type !== 'document/applyEdit') return false;
  const meta = a.meta as { undoable?: boolean; __history?: boolean } | undefined;
  if (!meta?.undoable) return false;
  if (meta.__history === true) return false;
  return true;
}

interface RootStateShape {
  document: { current: PDFDocumentModel | null };
  history: {
    past: Array<{
      fwd: EditOperation;
      inv: EditOperation;
      rawFwd: EditOperation;
      rawInv: EditOperation;
    }>;
    future: Array<{
      fwd: EditOperation;
      inv: EditOperation;
      rawFwd: EditOperation;
      rawInv: EditOperation;
    }>;
  };
}

export const historyMiddleware: Middleware = (store) => (next) => (action) => {
  // Undo: pop most recent past entry, apply inverse, archive into future stack.
  // Dispatch entry.rawInv (NOT entry.inv) so dirtyOps receives the full-bytes
  // form the main-process replay engine consumes. See module header for the
  // Wave 8.6 N-1 rationale.
  if (
    typeof action === 'object' &&
    action !== null &&
    (action as { type?: string }).type === 'history/undo'
  ) {
    const state = store.getState() as RootStateShape;
    const entry = state.history.past[state.history.past.length - 1];
    if (entry) {
      store.dispatch({
        type: 'document/applyEdit',
        payload: entry.rawInv,
        meta: { undoable: true, __history: true, operationId: entry.rawInv.meta.operationId },
      });
      store.dispatch(popPastToFuture());
    }
    return undefined;
  }
  // Redo: symmetric — dispatch entry.rawFwd (NOT entry.fwd) for the same reason.
  if (
    typeof action === 'object' &&
    action !== null &&
    (action as { type?: string }).type === 'history/redo'
  ) {
    const state = store.getState() as RootStateShape;
    const entry = state.history.future[state.history.future.length - 1];
    if (entry) {
      store.dispatch({
        type: 'document/applyEdit',
        payload: entry.rawFwd,
        meta: { undoable: true, __history: true, operationId: entry.rawFwd.meta.operationId },
      });
      store.dispatch(popFutureToPast());
    }
    return undefined;
  }

  if (!isUndoableEditAction(action)) {
    return next(action);
  }

  // Snapshot the BEFORE state for inverse computation.
  const before = (store.getState() as RootStateShape).document.current;
  if (!before) return next(action);

  // Run the forward op through the reducer.
  const result = next(action);

  // Compute + push inverse. Each entry carries TWO representations:
  //   - fwd / inv     → compacted (image bytes zeroed; conventions §13.3) for
  //                     storage footprint of the history stack.
  //   - rawFwd/rawInv → raw (image bytes intact) for dispatch on undo/redo so
  //                     the op reaching dirtyOps → IPC → main carries the bytes
  //                     the replay engine's embedImage() requires (Wave 8.6 N-1).
  try {
    const rawFwd = action.payload;
    const rawInv = inverseOf(rawFwd, before);
    const fwdCompact = compactImageOpForHistory(rawFwd);
    const invCompact = compactImageOpForHistory(rawInv);
    store.dispatch(pushEntry({ fwd: fwdCompact, inv: invCompact, rawFwd, rawInv }));
  } catch (e) {
    // Inverse computation failed (e.g. unknown op variant). Don't crash the
    // store; surface a console warning. The action already committed; user
    // loses undo for THAT specific op only.
    // eslint-disable-next-line no-console
    console.warn('[historyMiddleware] inverse failed for', action.payload.kind, e);
  }

  return result;
};

// Convenience action-creators for `history/undo` and `history/redo`. The
// historySlice defines the slice; these are the matching action types the
// middleware listens for. (Pure dispatch — no payload.)
export const undoAction = (): { type: string } => ({ type: 'history/undo' });
export const redoAction = (): { type: string } => ({ type: 'history/redo' });

// Re-export of types kept verbose so consumers don't have to deep-import.
export { applyEdit };
