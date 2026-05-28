// Form-commit middleware — Phase 3 HYBRID commit-boundary enforcer.
// Per docs/conventions.md §14.2 + docs/architecture-phase-3.md §5.
//
// This middleware listens for the `formCommit/trigger` action (dispatched by
// commitFormThunk and any other code path that semantically means "commit the
// form values now"). It:
//
//   1. Reads transient `formsSlice.values` and committed `formsSlice.committedValues`
//   2. Computes a diff (only field names whose value differs)
//   3. If the diff is empty, returns silently (no history entry produced)
//   4. Otherwise constructs ONE `form-commit` EditOperation carrying
//      { fieldValues, previousValues } and dispatches it through `applyEdit`,
//      which routes through the existing history-middleware uniformly
//   5. Dispatches `forms/markCommitted` so committedValues moves forward
//
// The middleware exists to keep commit semantics OUT of the components — any
// dispatcher of formCommit/trigger gets the same atomic, idempotent, history-
// captured behavior regardless of trigger path (save, button, close prompt).
//
// Why not co-locate in commitFormThunk? Two reasons:
//   (a) Save flow (saveDocumentThunk) already runs through the dispatch chain;
//       a middleware lets us interpose without a function-call dependency.
//   (b) Phase 3.1's planned "auto-commit on field-blur if more than N seconds
//       elapsed since last keystroke" can be wired here without touching every
//       dispatcher.

import { type Middleware } from '@reduxjs/toolkit';

import { type EditOperation, type FormFieldValue } from '../../types/ipc-contract';
import { applyEdit } from '../slices/document-slice';
import { markCommitted } from '../slices/forms-slice';

// Inlined to avoid a circular import (forms-selectors → store → middleware).
function valuesEqual(a: FormFieldValue | undefined, b: FormFieldValue | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.type !== b.type) return false;
  return a.value === b.value;
}

/** Action type the middleware listens for. */
export const FORM_COMMIT_TRIGGER = 'formCommit/trigger';

/** Dispatch this to request a commit. Idempotent — no-op if nothing changed. */
export function triggerFormCommit(): { type: typeof FORM_COMMIT_TRIGGER } {
  return { type: FORM_COMMIT_TRIGGER };
}

interface RootStateShape {
  forms: {
    values: Record<string, FormFieldValue>;
    committedValues: Record<string, FormFieldValue>;
  };
}

export const formCommitMiddleware: Middleware = (store) => (next) => (action) => {
  if (
    typeof action !== 'object' ||
    action === null ||
    (action as { type?: string }).type !== FORM_COMMIT_TRIGGER
  ) {
    return next(action);
  }
  // Hand off to next() FIRST so any reducer listening for the trigger sees it.
  // (None currently do; future Phase 3.1 may.)
  const result = next(action);

  const state = store.getState() as RootStateShape;
  const pendingValues = state.forms.values;
  const committedValues = state.forms.committedValues;

  const fieldValues: Record<string, FormFieldValue> = {};
  const previousValues: Record<string, FormFieldValue | undefined> = {};

  for (const [name, value] of Object.entries(pendingValues)) {
    const prev = committedValues[name];
    if (!valuesEqual(value, prev)) {
      fieldValues[name] = value;
      previousValues[name] = prev; // may be undefined → "no prior committed value"
    }
  }

  if (Object.keys(fieldValues).length === 0) return result;

  const op: EditOperation = {
    kind: 'form-commit',
    meta: {
      ts: Date.now(),
      undoable: true,
      operationId: `form-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
    fieldValues,
    previousValues,
  };

  // Dispatch through applyEdit so history-middleware captures the inverse.
  store.dispatch(applyEdit(op));
  store.dispatch(markCommitted(fieldValues));
  return result;
};
