// Phase 7.5 Wave 5d thunks — C6 Accessibility Checker.
//
// Mirrors the Wave 5a/5b/5c parallel-wave coordination pattern: feature-
// detect David's bridge method via the
// `services/accessibility-check-api.ts` wrapper (NO `as any`). When the
// preload bridge exposes `window.pdfApi.pdf.runAccessibilityCheck`, the
// thunk routes through cleanly; until then it short-circuits with
// `'bridge_unavailable'` and the panel surfaces an honest error.
//
// HONESTY CLAUSE:
//   - On engine failure the panel surfaces the actual error code +
//     message — NEVER paraphrased as "succeeded with 0 results" (per
//     P7.5-L-10 obligation #2).
//   - The thunk does NOT eager-run on tab open. It dispatches only when
//     the Run button (or the tool registry entry) fires it explicitly.

import { createAsyncThunk } from '@reduxjs/toolkit';

import { callRunAccessibilityCheck } from '../services/accessibility-check-api';

import { runFailed, runStarted, runSucceeded } from './slices/accessibility-check-slice';
import { pushToast } from './slices/ui-slice';
import type { AppDispatch, RootState } from './store';

/** Run the Accessibility Checker against the active document. Dispatches
 *  `runStarted` → `runSucceeded` | `runFailed`. */
export const runAccessibilityCheckThunk = createAsyncThunk<
  void,
  void,
  { dispatch: AppDispatch; state: RootState }
>('accessibilityCheck/run', async (_arg, { dispatch, getState }) => {
  const doc = getState().document.current;
  if (!doc) {
    dispatch(
      runFailed({
        error: 'handle_not_found',
        message: 'Open a document before running the Accessibility Checker.',
      }),
    );
    return;
  }
  dispatch(runStarted());
  const res = await callRunAccessibilityCheck({ handle: doc.handle });
  if (!res.ok) {
    dispatch(runFailed({ error: res.error, message: res.message }));
    // Don't toast on bridge_unavailable — the panel banner is sufficient
    // (the bridge hasn't been wired yet; toast would be noise).
    if (res.error !== 'bridge_unavailable') {
      dispatch(pushToast({ kind: 'error', message: res.message }));
    }
    return;
  }
  dispatch(runSucceeded(res.value));
});
