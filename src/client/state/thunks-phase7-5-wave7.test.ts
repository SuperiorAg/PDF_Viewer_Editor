// Phase 7.5 Wave 7 thunk tests — post-v0.8.0 LRU follow-up (Riley, 2026-06-18,
// Julian 11.5 + Wave 7 deferral close).
//
// Validates the LRU eviction pipeline:
//   1. `processPendingLruEvictionThunk` revokes blob URLs for every queued
//      pair index AND dispatches `lruEvictionCompleted` to atomically drop
//      the entries + clear the queue.
//   2. The visual-load thunk integrates with the LRU pipe: when overflow
//      happens, the post-success drain revokes the right number of blobs.
//   3. 100 sequential visual loads end with exactly `COMPARE_LRU_WINDOW_SIZE`
//      entries in pageResults (the integration assertion from the brief).
//
// The api proxy is stubbed via `window.pdfApi` per the Wave 7 test pattern
// (see how the Wave 5d test sets up its own stub) — `URL.createObjectURL` /
// `URL.revokeObjectURL` are also stubbed so the test can count revocations.

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import compareReducer, {
  COMPARE_LRU_WINDOW_SIZE,
  selectCompareAccessOrder,
  selectComparePairEntry,
  selectComparePendingLruEviction,
  sessionOpened,
  textRequestSucceeded,
  visualRequestSucceeded,
  type CompareSession,
} from './slices/compare-slice';
import documentReducer from './slices/document-slice';
import uiReducer from './slices/ui-slice';
import {
  ensureCompareVisualLoadedThunk,
  processPendingLruEvictionThunk,
} from './thunks-phase7-5-wave7';

function makeStore() {
  return configureStore({
    reducer: {
      compare: compareReducer,
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

function fakeSession(pageCount: number): CompareSession {
  return {
    sessionId: 'session-lru',
    leftDisplayName: 'baseline.pdf',
    rightDisplayName: 'modified.pdf',
    pageCountLeft: pageCount,
    pageCountRight: pageCount,
    pagePairs: Array.from({ length: pageCount }, (_, i) => ({
      leftPageIndex: i,
      rightPageIndex: i,
    })),
  };
}

function fakeVisualPayload(pairIndex: number) {
  return {
    pairIndex,
    value: {
      pageNumber: pairIndex + 1,
      leftPageIndex: pairIndex,
      rightPageIndex: pairIndex,
      width: 800,
      height: 1000,
      diffPixelCount: 0,
      totalPixelCount: 800000,
      diffPercent: 0,
    },
    diffMaskUrl: `blob:diff-${pairIndex}`,
    leftUrl: `blob:left-${pairIndex}`,
    rightUrl: `blob:right-${pairIndex}`,
  };
}

describe('processPendingLruEvictionThunk', () => {
  let revokeSpy: ReturnType<typeof vi.fn>;
  let originalRevoke: typeof URL.revokeObjectURL;

  beforeEach(() => {
    revokeSpy = vi.fn();
    originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevoke;
  });

  it('is a no-op when pendingLruEviction is empty', async () => {
    const store = makeStore();
    store.dispatch(sessionOpened(fakeSession(5)));
    await dispatchThunk(store, processPendingLruEvictionThunk());
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(selectComparePendingLruEviction(store.getState())).toEqual([]);
  });

  it('revokes every blob URL for every queued pair AND clears the queue', async () => {
    const store = makeStore();
    store.dispatch(sessionOpened(fakeSession(COMPARE_LRU_WINDOW_SIZE + 3)));
    // Direct slice dispatches to set up the LRU overflow without the thunk
    // path (which would itself drain).
    for (let i = 0; i < COMPARE_LRU_WINDOW_SIZE + 3; i++) {
      store.dispatch(visualRequestSucceeded(fakeVisualPayload(i)));
    }
    expect(selectComparePendingLruEviction(store.getState()).length).toBe(3);

    await dispatchThunk(store, processPendingLruEvictionThunk());

    // Each of the 3 evicted pairs held 3 blob URLs (diff + left + right).
    expect(revokeSpy).toHaveBeenCalledTimes(3 * 3);
    expect(selectComparePendingLruEviction(store.getState())).toEqual([]);
    // The actual cache entries are gone too.
    expect(selectComparePairEntry(store.getState(), 0)).toBeUndefined();
    expect(selectComparePairEntry(store.getState(), 1)).toBeUndefined();
    expect(selectComparePairEntry(store.getState(), 2)).toBeUndefined();
    // Survivors remain.
    expect(selectComparePairEntry(store.getState(), 3)).toBeDefined();
  });

  it('text-only pairs do not contribute revoke calls (no blob URLs)', async () => {
    const store = makeStore();
    store.dispatch(sessionOpened(fakeSession(COMPARE_LRU_WINDOW_SIZE + 2)));
    for (let i = 0; i < COMPARE_LRU_WINDOW_SIZE + 2; i++) {
      store.dispatch(
        textRequestSucceeded({
          pairIndex: i,
          value: {
            pageNumber: i + 1,
            leftPageIndex: i,
            rightPageIndex: i,
            diffs: [{ kind: 'equal', text: 'unchanged' }],
            summary: { equalChars: 9, insertChars: 0, deleteChars: 0, changed: false },
          },
        }),
      );
    }
    expect(selectComparePendingLruEviction(store.getState()).length).toBe(2);
    await dispatchThunk(store, processPendingLruEvictionThunk());
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(selectComparePendingLruEviction(store.getState())).toEqual([]);
  });
});

describe('LRU integration — sequential visual loads', () => {
  let revokeSpy: ReturnType<typeof vi.fn>;
  let createSpy: ReturnType<typeof vi.fn>;
  let originalRevoke: typeof URL.revokeObjectURL;
  let originalCreate: typeof URL.createObjectURL;
  let originalPdfApi: unknown;

  beforeEach(() => {
    revokeSpy = vi.fn();
    createSpy = vi.fn((_blob: unknown) => `blob:created-${createSpy.mock.calls.length}`);
    originalRevoke = URL.revokeObjectURL;
    originalCreate = URL.createObjectURL;
    URL.revokeObjectURL = revokeSpy;
    URL.createObjectURL = createSpy as unknown as typeof URL.createObjectURL;
    // Stash the original pdfApi (if any) and inject a stub.
    originalPdfApi = (globalThis as { pdfApi?: unknown }).pdfApi;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevoke;
    URL.createObjectURL = originalCreate;
    (globalThis as { pdfApi?: unknown }).pdfApi = originalPdfApi;
  });

  it('100 sequential visual loads results in exactly LRU_WINDOW_SIZE live entries', async () => {
    const PAGE_COUNT = 100;
    const store = makeStore();
    store.dispatch(sessionOpened(fakeSession(PAGE_COUNT)));

    // Wire a stub api proxy that returns deterministic visual responses.
    const compareVisualOnPage = vi.fn(
      async (req: { leftPageIndex: number; rightPageIndex: number }) => ({
        ok: true as const,
        value: {
          pageNumber: req.leftPageIndex + 1,
          leftPageIndex: req.leftPageIndex,
          rightPageIndex: req.rightPageIndex,
          width: 800,
          height: 1000,
          diffPixelCount: 0,
          totalPixelCount: 800000,
          diffPercent: 0,
          // Minimal 1-byte PNG payload (the base64 decoder + blob creation
          // is tested separately; here we just need a non-empty string).
          diffMaskPng: 'AA==',
          leftPagePng: 'AA==',
          rightPagePng: 'AA==',
        },
      }),
    );
    (globalThis as { pdfApi?: unknown }).pdfApi = {
      pdf: { compareVisualOnPage },
      fs: {},
      dialog: {},
      export: {},
    };

    for (let i = 0; i < PAGE_COUNT; i++) {
      await dispatchThunk(store, ensureCompareVisualLoadedThunk({ pairIndex: i }));
    }

    // After 100 loads:
    //  - pageAccessOrder is capped at COMPARE_LRU_WINDOW_SIZE.
    expect(selectCompareAccessOrder(store.getState()).length).toBe(COMPARE_LRU_WINDOW_SIZE);
    //  - pendingLruEviction is empty (every overflow was drained by the thunk).
    expect(selectComparePendingLruEviction(store.getState())).toEqual([]);
    //  - Exactly COMPARE_LRU_WINDOW_SIZE entries remain in pageResults.
    const liveCount = Array.from({ length: PAGE_COUNT }).filter(
      (_, i) => selectComparePairEntry(store.getState(), i) !== undefined,
    ).length;
    expect(liveCount).toBe(COMPARE_LRU_WINDOW_SIZE);
    //  - Of the (PAGE_COUNT - LRU_WINDOW_SIZE) evictions, each carried 3
    //    blob URLs to revoke. The IPC stub returned 3 base64 PNGs per
    //    response, so createObjectURL was called 3 * PAGE_COUNT times.
    //    Revocations = 3 * (PAGE_COUNT - LRU_WINDOW_SIZE).
    expect(createSpy.mock.calls.length).toBe(3 * PAGE_COUNT);
    expect(revokeSpy.mock.calls.length).toBe(3 * (PAGE_COUNT - COMPARE_LRU_WINDOW_SIZE));
  });
});
