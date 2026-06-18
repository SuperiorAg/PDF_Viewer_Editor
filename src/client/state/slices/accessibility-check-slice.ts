// Accessibility-check slice — Phase 7.5 C6 (Riley Wave 5d).
//
// Drives the Accessibility Checker panel that lives inside the 8th sidebar
// tab (Accessibility) alongside the Wave 5b Tag PDF tree editor. State:
//   - status: 'idle' | 'running' | 'ready' | 'error' — gates the panel UI
//   - lastResult: PdfRunAccessibilityCheckValue | null — last successful run
//   - lastError: PdfRunAccessibilityCheckError | null — last failure code
//     (renderer surfaces the human-readable message from `lastErrorMessage`)
//   - lastErrorMessage: human-readable failure surface
//   - expandedGroups: per-status open/closed state (initial: fail=true,
//     warn=true, unevaluated=true, pass=false)
//
// HONESTY CLAUSE (P7.5-L-10):
//   - `lastResult.subsetDisclosure` is surfaced VERBATIM in the panel —
//     never paraphrased, never hardcoded. The contract carries the words.
//   - The four-state model (`pass | warn | fail | unevaluated`) is exposed.
//     `unevaluated` is its own bucket so users see "Not assessed" rather
//     than a false `pass`.
//   - The slice does NOT eager-run on tab open (mirrors Preflight Wave 5a).
//     `status: 'idle'` until the user clicks Run.
//
// Pure reducer + selectors. Async dispatcher lives in
// `state/thunks-phase7-5-wave5d.ts`.

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type {
  PdfRunAccessibilityCheckErrorRenderer,
  PdfRunAccessibilityCheckValue,
} from '../../types/accessibility-check-contract-stub';

export type AccessibilityCheckStatus = 'idle' | 'running' | 'ready' | 'error';
export type AccessibilityCheckGroup = 'pass' | 'warn' | 'fail' | 'unevaluated';

export interface AccessibilityCheckState {
  status: AccessibilityCheckStatus;
  lastResult: PdfRunAccessibilityCheckValue | null;
  lastError: PdfRunAccessibilityCheckErrorRenderer | null;
  lastErrorMessage: string | null;
  expandedGroups: Record<AccessibilityCheckGroup, boolean>;
}

const initialState: AccessibilityCheckState = {
  status: 'idle',
  lastResult: null,
  lastError: null,
  lastErrorMessage: null,
  // Default: errors + warnings + unevaluated visible; pass collapsed so
  // the user's eye lands on what needs attention first.
  expandedGroups: {
    fail: true,
    warn: true,
    unevaluated: true,
    pass: false,
  },
};

export const accessibilityCheckSlice = createSlice({
  name: 'accessibilityCheck',
  initialState,
  reducers: {
    runStarted(state) {
      state.status = 'running';
      // Keep the previous `lastResult` visible while the new run is in
      // flight — the panel renders the subsetDisclosure permanently so
      // the user can re-read it during the run. lastError clears only
      // when a fresh result comes back successfully.
      state.lastError = null;
      state.lastErrorMessage = null;
    },
    runSucceeded(state, action: PayloadAction<PdfRunAccessibilityCheckValue>) {
      state.status = 'ready';
      state.lastResult = action.payload;
      state.lastError = null;
      state.lastErrorMessage = null;
    },
    runFailed(
      state,
      action: PayloadAction<{
        error: PdfRunAccessibilityCheckErrorRenderer;
        message: string;
      }>,
    ) {
      state.status = 'error';
      state.lastError = action.payload.error;
      state.lastErrorMessage = action.payload.message;
    },
    toggleGroup(state, action: PayloadAction<AccessibilityCheckGroup>) {
      const g = action.payload;
      state.expandedGroups[g] = !state.expandedGroups[g];
    },
    /** Called on document close — wipes results so the next doc starts
     *  with a clean idle state. Mirrors the preflight slice's reset. */
    cleared() {
      return initialState;
    },
  },
});

export const { runStarted, runSucceeded, runFailed, toggleGroup, cleared } =
  accessibilityCheckSlice.actions;

export default accessibilityCheckSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectA11yStatus(state: {
  accessibilityCheck: AccessibilityCheckState;
}): AccessibilityCheckStatus {
  return state.accessibilityCheck.status;
}

export function selectA11yResults(state: {
  accessibilityCheck: AccessibilityCheckState;
}): PdfRunAccessibilityCheckValue | null {
  return state.accessibilityCheck.lastResult;
}

export function selectA11ySummary(state: {
  accessibilityCheck: AccessibilityCheckState;
}): PdfRunAccessibilityCheckValue['summary'] | null {
  return state.accessibilityCheck.lastResult?.summary ?? null;
}

export function selectA11ySubsetDisclosure(state: {
  accessibilityCheck: AccessibilityCheckState;
}): string | null {
  return state.accessibilityCheck.lastResult?.subsetDisclosure ?? null;
}

export function selectA11yExpandedGroups(state: {
  accessibilityCheck: AccessibilityCheckState;
}): Record<AccessibilityCheckGroup, boolean> {
  return state.accessibilityCheck.expandedGroups;
}

export function selectA11yLastErrorMessage(state: {
  accessibilityCheck: AccessibilityCheckState;
}): string | null {
  return state.accessibilityCheck.lastErrorMessage;
}
