// Action recorder middleware — Phase 7.5 B9 (Riley Wave 6).
//
// Intercepts dispatched edit ops when `actionWizard.recording.active` (and
// not paused). Each captured op is checked against the renderer mirror of
// David's `ALLOWED_OP_KINDS` allowlist; banned ops are silently dropped
// (with `recordBannedOp` so the dialog shows a count + a toast).
//
// The middleware listens to `document/applyEdit` actions (the canonical
// renderer-side op dispatcher) and reads `action.payload` as the serialized
// op shape. Any non-edit action is passed straight through.
//
// Pattern reference: history-middleware.ts which already wraps applyEdit for
// the undo/redo stack. Recorder runs alongside (no ordering coupling — both
// are pure observers).

import { type Middleware } from '@reduxjs/toolkit';

import { ALLOWED_OP_KINDS } from '../../constants/actions';
import { type EditOperationSerialized } from '../../types/ipc-contract';
import { recordBannedOp, recordOp, selectRecordingActive } from '../slices/action-wizard-slice';
import { applyEdit } from '../slices/document-slice';

/** True when the action looks like a serialized edit-op carrying a `.kind`
 *  string field. We do not type-narrow to `EditOperation` here because the
 *  recorder is a pure observer — even shapes we don't recognize get a
 *  best-effort banned-count when active. */
function looksLikeOpPayload(payload: unknown): payload is EditOperationSerialized {
  if (payload === null || typeof payload !== 'object') return false;
  const kind = (payload as { kind?: unknown }).kind;
  return typeof kind === 'string';
}

export const actionRecorderMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  // Only intercept the canonical edit-op dispatcher.
  if (typeof action !== 'object' || action === null) return result;
  const a = action as { type?: unknown; payload?: unknown };
  if (a.type !== applyEdit.type) return result;

  // Recording must be both `active` and not paused — selectRecordingActive
  // collapses both checks.
  const state = store.getState() as Parameters<typeof selectRecordingActive>[0];
  if (!selectRecordingActive(state)) return result;

  if (!looksLikeOpPayload(a.payload)) {
    // Unknown shape — count as banned so the dialog stays honest.
    store.dispatch(recordBannedOp('<unknown-shape>'));
    return result;
  }
  const op = a.payload;
  if (!ALLOWED_OP_KINDS.has(op.kind)) {
    store.dispatch(recordBannedOp(op.kind));
    return result;
  }
  store.dispatch(recordOp(op));
  return result;
};
