// Phase 4.1.1 (Riley) — thunk tests for measurePageDimensionsThunk. This
// thunk is the Option-Y root-cause fix for the hardcoded Letter defaults at
// thunks.ts:82-92 — see docs/build-report.md "Phase 4.1.1 — Riley" + the
// docstring on measurePageDimensionsThunk for the design.
//
// We mock the pdf-loader to short-circuit the IPC+pdf.js stack and feed
// deterministic page-dim values into the thunk. The slice contract was pinned
// separately in document-slice.test.ts; this file pins the THUNK contract
// (single batched dispatch, doc-handle equality bail-out, in-flight dedupe).

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument, setPageDimensions } from './slices/document-slice';
import uiReducer from './slices/ui-slice';
import { _resetMeasureInflightForTests, measurePageDimensionsThunk } from './thunks';

// Mock the pdf-loader module the thunk imports. The path is relative to
// thunks.ts (the importer), so '../services/pdf-loader'.
//
// `vi.hoisted` is required because vi.mock is hoisted to the top of the file
// at compile time — any state referenced by the factory must be declared
// inside `vi.hoisted` to avoid `Cannot access 'X' before initialization`.
// See pdf-render.test.ts:41 for the same pattern.
const hoisted = vi.hoisted(() => ({
  getPageMock: ((): ReturnType<typeof vi.fn> => vi.fn())(),
  loadDocumentByHandleMock: ((): ReturnType<typeof vi.fn> => vi.fn())(),
}));
const { getPageMock, loadDocumentByHandleMock } = hoisted;

vi.mock('../services/pdf-loader', () => ({
  loadDocumentByHandle: hoisted.loadDocumentByHandleMock,
}));

// The thunk is typed against the production `RootState` (17 slices); a
// minimal test store with only 2 slices cannot match that. We dispatch via
// the loose `Dispatch` here and let the thunk run as-is — the slice contract
// is what we're pinning, not the typing.
function makeStore() {
  return configureStore({
    reducer: {
      document: documentReducer,
      ui: uiReducer,
    },
  });
}
type AnyStore = ReturnType<typeof makeStore>;
// Type-loose dispatch helper for the test — bypasses the RootState mismatch
// while preserving runtime behavior.
function dispatchThunk(store: AnyStore, thunk: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (store.dispatch as any)(thunk);
}

function seedDoc(store: AnyStore, pageCount: number, handle = 1): void {
  store.dispatch(
    setDocument({
      handle,
      displayName: 't.pdf',
      fileHash: 'h',
      pageCount,
      pages: Array.from({ length: pageCount }, (_, i) => ({
        pageIndex: i,
        sourcePageRef: { kind: 'original' as const, originalIndex: i },
        rotation: 0 as const,
        width: 612,
        height: 792,
      })),
      annotations: [],
      dirtyOps: [],
      savedAtHandleVersion: 0,
      pdflibLoadWarnings: [],
    }),
  );
}

function fakePage(
  width: number,
  height: number,
): {
  width: number;
  height: number;
  cleanup: () => void;
} {
  return { width, height, cleanup: vi.fn() };
}

beforeEach(() => {
  getPageMock.mockReset();
  loadDocumentByHandleMock.mockReset();
  _resetMeasureInflightForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('measurePageDimensionsThunk (Phase 4.1.1)', () => {
  it('dispatches a single batched setPageDimensions for all measured pages', async () => {
    const store = makeStore();
    seedDoc(store, 3);

    const pages = [fakePage(595, 842), fakePage(842, 595), fakePage(612, 792)];
    getPageMock.mockImplementation(async (i: number) => pages[i]);
    loadDocumentByHandleMock.mockResolvedValueOnce({
      ok: true,
      doc: { pageCount: 3, getPage: getPageMock, destroy: vi.fn() },
    });

    // Subscribe to document slice mutations — we expect exactly ONE post-seed
    // mutation (the batched setPageDimensions). The thunk's pending/fulfilled
    // wrappers do not mutate document state.
    const documentRefs: Array<ReturnType<typeof documentReducer>> = [];
    const lastRef = (): ReturnType<typeof documentReducer> => store.getState().document;
    const initialDoc = lastRef();
    documentRefs.push(initialDoc);
    const unsub = store.subscribe(() => {
      const cur = lastRef();
      if (cur !== documentRefs[documentRefs.length - 1]) {
        documentRefs.push(cur);
      }
    });

    await dispatchThunk(store, measurePageDimensionsThunk());
    unsub();

    // Exactly one document-state mutation: the batched dispatch (every page
    // in one action, not three sequential dispatches that would each bump
    // the slice reference).
    expect(documentRefs.length).toBe(2);

    // Redux now agrees with the measured dims for all three pages.
    expect(store.getState().document.current?.pages[0]?.width).toBe(595);
    expect(store.getState().document.current?.pages[0]?.height).toBe(842);
    expect(store.getState().document.current?.pages[1]?.width).toBe(842);
    expect(store.getState().document.current?.pages[1]?.height).toBe(595);
    expect(store.getState().document.current?.pages[2]?.width).toBe(612);
    expect(store.getState().document.current?.pages[2]?.height).toBe(792);

    // Memory hygiene — each page proxy was cleaned up.
    for (const p of pages) {
      expect(p.cleanup).toHaveBeenCalledTimes(1);
    }
  });

  it('is a no-op when no document is open (silent early-out)', async () => {
    const store = makeStore();
    // No seedDoc() call.
    await dispatchThunk(store, measurePageDimensionsThunk());
    expect(loadDocumentByHandleMock).not.toHaveBeenCalled();
    expect(store.getState().document.current).toBeNull();
  });

  it('does not dispatch setPageDimensions when pdf-loader fails (Letter defaults kept)', async () => {
    const store = makeStore();
    seedDoc(store, 2);
    loadDocumentByHandleMock.mockResolvedValueOnce({
      ok: false,
      error: 'pdfjs_load_failed',
      message: 'unparseable',
    });

    const dispatchSpy = vi.spyOn(store, 'dispatch');
    await dispatchThunk(store, measurePageDimensionsThunk());

    const dimDispatches = dispatchSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0] !== null &&
        'type' in c[0] &&
        c[0].type === setPageDimensions.type,
    );
    expect(dimDispatches.length).toBe(0);
    expect(store.getState().document.current?.pages[0]?.width).toBe(612);
  });

  it('skips pages whose getPage() throws but commits the rest', async () => {
    const store = makeStore();
    seedDoc(store, 3);
    const page0 = fakePage(595, 842);
    const page2 = fakePage(800, 600);
    getPageMock.mockImplementation(async (i: number) => {
      if (i === 0) return page0;
      if (i === 1) throw new Error('corrupt /MediaBox');
      if (i === 2) return page2;
      throw new Error('unexpected index');
    });
    loadDocumentByHandleMock.mockResolvedValueOnce({
      ok: true,
      doc: { pageCount: 3, getPage: getPageMock, destroy: vi.fn() },
    });

    await dispatchThunk(store, measurePageDimensionsThunk());

    // Pages 0 + 2 updated; page 1 keeps Letter defaults.
    expect(store.getState().document.current?.pages[0]?.width).toBe(595);
    expect(store.getState().document.current?.pages[1]?.width).toBe(612);
    expect(store.getState().document.current?.pages[2]?.width).toBe(800);
  });

  it('bails out mid-loop if the document handle changes (e.g. close+reopen)', async () => {
    const store = makeStore();
    seedDoc(store, 3, /* handle */ 7);
    const page0 = fakePage(595, 842);
    // Close the document partway through; page 1 should never be measured.
    let pageCallCount = 0;
    getPageMock.mockImplementation(async (i: number) => {
      pageCallCount += 1;
      if (i === 0) return page0;
      // Before page 1 resolves, swap the open document.
      seedDoc(store, 3, /* handle */ 99);
      return fakePage(0, 0);
    });
    loadDocumentByHandleMock.mockResolvedValueOnce({
      ok: true,
      doc: { pageCount: 3, getPage: getPageMock, destroy: vi.fn() },
    });

    const dispatchSpy = vi.spyOn(store, 'dispatch');
    await dispatchThunk(store, measurePageDimensionsThunk());

    // Bail-out path: no setPageDimensions dispatch (the final equality check fails).
    const dimDispatches = dispatchSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0] !== null &&
        'type' in c[0] &&
        c[0].type === setPageDimensions.type,
    );
    expect(dimDispatches.length).toBe(0);
    // We did start measuring (called getPage at least once).
    expect(pageCallCount).toBeGreaterThanOrEqual(1);
  });

  it('dedupes concurrent invocations for the same handle (no double pdf.js work)', async () => {
    const store = makeStore();
    seedDoc(store, 1, /* handle */ 42);
    // Resolve via an external deferred promise so we can hold both thunk
    // invocations open until BOTH are past their `inflight.has(handle)` check.
    type Resolver = (v: unknown) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deferred: { resolve: Resolver | null } = { resolve: null };
    const docPromise = new Promise<unknown>((resolve) => {
      deferred.resolve = resolve;
    });
    loadDocumentByHandleMock.mockImplementation(() => docPromise);
    getPageMock.mockResolvedValue(fakePage(595, 842));

    const p1 = dispatchThunk(store, measurePageDimensionsThunk());
    const p2 = dispatchThunk(store, measurePageDimensionsThunk());

    // Yield once to let p1's microtask pickup the dynamic import + invoke the
    // loader mock. (The Promise executor runs synchronously at `new Promise`,
    // so `deferred.resolve` is set before either dispatch starts — but the
    // explicit `await Promise.resolve()` lets the dynamic import settle.)
    await Promise.resolve();
    await Promise.resolve();
    const resolver = deferred.resolve;
    if (resolver === null) {
      throw new Error('loader mock was never invoked — test setup is wrong');
    }
    resolver({
      ok: true,
      doc: {
        pageCount: 1,
        getPage: getPageMock,
        destroy: vi.fn(),
      },
    });

    await Promise.all([p1, p2]);

    // The loader was only invoked once (the second dispatch hit the inflight guard).
    expect(loadDocumentByHandleMock).toHaveBeenCalledTimes(1);
  });
});
