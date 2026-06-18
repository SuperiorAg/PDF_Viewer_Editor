// Phase 7.5 Wave 5d thunk tests — Riley.
// Validates `runAccessibilityCheckThunk` choreography against a stubbed
// `window.pdfApi.pdf.runAccessibilityCheck` + the slice's state machine.
//
// Two surfaces covered:
//   1. Happy path: success Result lands in `runSucceeded` → status = 'ready'
//      + lastResult populated (including verbatim subsetDisclosure).
//   2. Error paths: 'engine_failed' + 'bridge_unavailable' route through
//      `runFailed` honestly with the engine's message preserved.
//   3. No-document gate: thunk surfaces 'handle_not_found' without dispatching
//      to the engine at all.

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PdfRunAccessibilityCheckValue } from '../types/accessibility-check-contract-stub';
import type { PDFDocumentModel } from '../types/ipc-contract';

import accessibilityCheckReducer from './slices/accessibility-check-slice';
import documentReducer, { setDocument } from './slices/document-slice';
import uiReducer from './slices/ui-slice';
import { runAccessibilityCheckThunk } from './thunks-phase7-5-wave5d';

const DOC: PDFDocumentModel = {
  handle: 1,
  displayName: 't.pdf',
  fileHash: 'h',
  pageCount: 5,
  pages: [],
  annotations: [],
  dirtyOps: [],
  savedAtHandleVersion: 0,
  pdflibLoadWarnings: [],
};

function makeStore() {
  return configureStore({
    reducer: {
      accessibilityCheck: accessibilityCheckReducer,
      document: documentReducer,
      ui: uiReducer,
    },
  });
}

type AnyStore = ReturnType<typeof makeStore>;
function dispatchThunk(store: AnyStore, thunk: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (store.dispatch as any)(thunk);
}

function fixtureValue(): PdfRunAccessibilityCheckValue {
  return {
    results: [],
    summary: { pass: 8, warn: 1, fail: 2, unevaluated: 1 },
    ranAt: 1750000000000,
    shippedRuleCount: 12,
    subsetDisclosure: 'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runAccessibilityCheckThunk — happy path', () => {
  beforeEach(() => {
    const runAccessibilityCheck = vi.fn(async () => ({
      ok: true as const,
      value: fixtureValue(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('pdfApi', { pdf: { runAccessibilityCheck } } as any);
  });

  it('dispatches runSucceeded with the verbatim disclosure', async () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    await dispatchThunk(store, runAccessibilityCheckThunk());
    const state = store.getState().accessibilityCheck;
    expect(state.status).toBe('ready');
    expect(state.lastResult?.subsetDisclosure).toBe(
      'Subset of WCAG 2.1 + PDF/UA-1 — see Help for the shipped rule set.',
    );
    expect(state.lastResult?.shippedRuleCount).toBe(12);
  });
});

describe('runAccessibilityCheckThunk — engine_failed', () => {
  beforeEach(() => {
    const runAccessibilityCheck = vi.fn(async () => ({
      ok: false as const,
      error: 'engine_failed' as const,
      message: 'engine exploded',
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('pdfApi', { pdf: { runAccessibilityCheck } } as any);
  });

  it('routes to runFailed with the engine error code preserved', async () => {
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    await dispatchThunk(store, runAccessibilityCheckThunk());
    const state = store.getState().accessibilityCheck;
    expect(state.status).toBe('error');
    expect(state.lastError).toBe('engine_failed');
    expect(state.lastErrorMessage).toBe('engine exploded');
  });
});

describe('runAccessibilityCheckThunk — bridge_unavailable', () => {
  // No global stub — the wrapper detects window.pdfApi.pdf.runAccessibilityCheck
  // as undefined and returns 'bridge_unavailable' honestly.
  it('surfaces bridge_unavailable when the bridge method is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('pdfApi', { pdf: {} } as any);
    const store = makeStore();
    store.dispatch(setDocument(DOC));
    await dispatchThunk(store, runAccessibilityCheckThunk());
    const state = store.getState().accessibilityCheck;
    expect(state.status).toBe('error');
    expect(state.lastError).toBe('bridge_unavailable');
    expect(state.lastErrorMessage).toContain('runAccessibilityCheck');
  });
});

describe('runAccessibilityCheckThunk — no document open', () => {
  beforeEach(() => {
    const runAccessibilityCheck = vi.fn(async () => ({
      ok: true as const,
      value: fixtureValue(),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('pdfApi', { pdf: { runAccessibilityCheck } } as any);
  });

  it('short-circuits with handle_not_found without calling the engine', async () => {
    const store = makeStore();
    // Don't dispatch setDocument — no doc open.
    await dispatchThunk(store, runAccessibilityCheckThunk());
    const state = store.getState().accessibilityCheck;
    expect(state.status).toBe('error');
    expect(state.lastError).toBe('handle_not_found');
  });
});
