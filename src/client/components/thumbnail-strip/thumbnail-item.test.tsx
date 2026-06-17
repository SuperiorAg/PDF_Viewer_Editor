// Phase 4.1.1 (Riley) — ThumbnailItem tests. Locks in Marcus's patch #4
// behavior: the thumbnail renders a REAL pdf.js page bitmap into a <canvas>
// (not the old `<span>{props.index + 1}</span>` placeholder), at scale
// `thumbWidth / pageProxy.width`. Blank pages render the "Blank" badge
// instead of a canvas.

import { configureStore, type EnhancedStore } from '@reduxjs/toolkit';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import documentReducer, { setDocument } from '../../state/slices/document-slice';
import { type PageModel } from '../../types/ipc-contract';

import { ThumbnailItem } from './thumbnail-item';

// Mock pdf-loader; capture the render-scale arg.
const renderMock = vi.fn();
const cleanupMock = vi.fn();
let nextPageProxy: {
  width: number;
  height: number;
  render: typeof renderMock;
  cleanup: typeof cleanupMock;
} | null = null;
let nextLoadResult: unknown = { ok: false, error: 'bridge_unavailable', message: 'test' };

vi.mock('../../services/pdf-loader', () => ({
  loadDocumentByHandle: vi.fn(async () => nextLoadResult),
}));

type AnyStore = EnhancedStore<{ document: ReturnType<typeof documentReducer> }>;

function makeStore(): AnyStore {
  return configureStore({ reducer: { document: documentReducer } });
}

function seedDoc(store: AnyStore, pages: PageModel[]): void {
  store.dispatch(
    setDocument({
      handle: 1,
      displayName: 't.pdf',
      fileHash: 'h',
      pageCount: pages.length,
      pages,
      annotations: [],
      dirtyOps: [],
      savedAtHandleVersion: 0,
      pdflibLoadWarnings: [],
    }),
  );
}

function letterPage(index: number, opts: { rotation?: 0 | 90 | 180 | 270 } = {}): PageModel {
  return {
    pageIndex: index,
    sourcePageRef: { kind: 'original', originalIndex: index },
    rotation: opts.rotation ?? 0,
    width: 612,
    height: 792,
  };
}

function blankPage(index: number): PageModel {
  return {
    pageIndex: index,
    sourcePageRef: { kind: 'blank', width: 612, height: 792 },
    rotation: 0,
    width: 612,
    height: 792,
  };
}

const noop = (): void => undefined;
const noopMouse = (_e: React.MouseEvent): void => undefined;
const noopDrag = (_e: React.DragEvent): void => undefined;

const baseProps = {
  isCurrent: false,
  isSelected: false,
  isDragOver: false,
  onClick: noopMouse,
  onDragStart: noopDrag,
  onDragOver: noopDrag,
  onDrop: noopDrag,
};

// IntersectionObserver mock that fires `isIntersecting: true` on observe so
// the visibility-gated render lifecycle actually runs in the lifecycle
// specs below. The vitest.setup.ts global stub is a no-op (it leaves
// `isVisible` false), which is correct for tests that DON'T care about
// the render path — but every spec in this file does. Install in beforeEach
// and restore the original in afterEach so we don't leak to other suites.
let originalIO: typeof globalThis.IntersectionObserver;

class IntersectingMock {
  private cb: IntersectionObserverCallback;
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    // Microtask so React has finished commit before we trigger the state
    // update (matches real browser behavior — callback fires async).
    queueMicrotask(() => {
      this.cb(
        [
          {
            isIntersecting: true,
            target,
            intersectionRatio: 1,
            time: 0,
            boundingClientRect: target.getBoundingClientRect(),
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
          } as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      );
    });
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeEach(() => {
  renderMock.mockReset();
  cleanupMock.mockReset();
  // Default: render-task resolves immediately.
  renderMock.mockImplementation(() => ({
    cancel: noop,
    promise: Promise.resolve(),
  }));
  nextPageProxy = null;
  nextLoadResult = { ok: false, error: 'bridge_unavailable', message: 'test' };
  originalIO = globalThis.IntersectionObserver;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = IntersectingMock;
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.IntersectionObserver = originalIO;
});

describe('ThumbnailItem — Phase 4.1.1 render lifecycle', () => {
  it('renders a <canvas> (not the old placeholder span) for a non-blank page', () => {
    const store = makeStore();
    const page = letterPage(0);
    seedDoc(store, [page]);
    render(
      <Provider store={store}>
        <ThumbnailItem page={page} index={0} {...baseProps} />
      </Provider>,
    );
    const canvas = document.querySelector('canvas');
    expect(canvas).not.toBeNull();
  });

  it('renders the "Blank" badge for blank pages (no canvas, no pdf-loader call)', () => {
    const store = makeStore();
    const page = blankPage(0);
    seedDoc(store, [page]);
    render(
      <Provider store={store}>
        <ThumbnailItem page={page} index={0} {...baseProps} />
      </Provider>,
    );
    expect(screen.getByText(/Blank/)).toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('renders the page at scale = thumbWidth (110) / pageProxy.width', async () => {
    const store = makeStore();
    const page = letterPage(0);
    seedDoc(store, [page]);

    nextPageProxy = {
      width: 612,
      height: 792,
      render: renderMock,
      cleanup: cleanupMock,
    };
    nextLoadResult = {
      ok: true,
      doc: {
        pageCount: 1,
        getPage: vi.fn(async () => nextPageProxy),
        destroy: vi.fn(),
      },
    };

    render(
      <Provider store={store}>
        <ThumbnailItem page={page} index={0} {...baseProps} />
      </Provider>,
    );

    // Wait for the async lifecycle (loadDocumentByHandle → getPage → render).
    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    const renderArgs = renderMock.mock.calls[0]!;
    // render(canvas, scale)
    expect(renderArgs[1]).toBeCloseTo(110 / 612, 5);
    // The canvas passed in is the same canvas the component refs.
    expect(renderArgs[0]).toBe(document.querySelector('canvas'));
  });

  it('renders even when the page rotation is 90 (the natural pageProxy width drives scale)', async () => {
    const store = makeStore();
    const page = letterPage(0, { rotation: 90 });
    seedDoc(store, [page]);

    nextPageProxy = {
      width: 612,
      height: 792,
      render: renderMock,
      cleanup: cleanupMock,
    };
    nextLoadResult = {
      ok: true,
      doc: {
        pageCount: 1,
        getPage: vi.fn(async () => nextPageProxy),
        destroy: vi.fn(),
      },
    };

    render(
      <Provider store={store}>
        <ThumbnailItem page={page} index={0} {...baseProps} />
      </Provider>,
    );
    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    // Scale is derived from the unrotated natural width (pdfProxy.width), not
    // the rotated CSS-box width — pdf.js handles the rotation internally.
    expect(renderMock.mock.calls[0]![1]).toBeCloseTo(110 / 612, 5);
  });

  it('cleans up the pageProxy after render resolves (memory hygiene)', async () => {
    const store = makeStore();
    const page = letterPage(0);
    seedDoc(store, [page]);

    nextPageProxy = {
      width: 612,
      height: 792,
      render: renderMock,
      cleanup: cleanupMock,
    };
    nextLoadResult = {
      ok: true,
      doc: {
        pageCount: 1,
        getPage: vi.fn(async () => nextPageProxy),
        destroy: vi.fn(),
      },
    };

    render(
      <Provider store={store}>
        <ThumbnailItem page={page} index={0} {...baseProps} />
      </Provider>,
    );
    await waitFor(() => expect(cleanupMock).toHaveBeenCalledTimes(1));
  });

  it('cancels the in-flight render job on unmount', async () => {
    const store = makeStore();
    const page = letterPage(0);
    seedDoc(store, [page]);

    const cancelMock = vi.fn();
    // Never-resolving promise so unmount happens mid-render.
    renderMock.mockImplementation(() => ({
      cancel: cancelMock,
      promise: new Promise<void>(() => {
        /* hangs */
      }),
    }));
    nextPageProxy = {
      width: 612,
      height: 792,
      render: renderMock,
      cleanup: cleanupMock,
    };
    nextLoadResult = {
      ok: true,
      doc: {
        pageCount: 1,
        getPage: vi.fn(async () => nextPageProxy),
        destroy: vi.fn(),
      },
    };

    const { unmount } = render(
      <Provider store={store}>
        <ThumbnailItem page={page} index={0} {...baseProps} />
      </Provider>,
    );
    await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      unmount();
    });
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});
