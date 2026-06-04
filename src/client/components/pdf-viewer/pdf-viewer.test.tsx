// PdfViewer cursor-anchored zoom (Wave 30+).
//
// Verifies that a ctrl+wheel zoom:
//   1. Adjusts scrollLeft/scrollTop on commit (the scroll-compensation step
//      that keeps the content under the cursor pinned through the commit).
//   2. Drives the commit through dispatch(setZoom(...)).
//
// What this test DOES verify (deliberately structural — jsdom can't paint):
//   • A wheel event with ctrlKey fires, displayZoom advances, debounce commits.
//   • Post-commit useLayoutEffect inspects pendingScrollCompRef and writes a
//     non-zero scrollLeft/scrollTop on the viewer scroller.
//   • The committed Redux zoom changes.
//
// What this test does NOT verify (out of scope for jsdom; covered by the L-002
// operator-level screenshot of the running binary in Riley's polish wave):
//   • The visual transform-origin during the gesture matches the cursor.
//   • The exact post-commit pixel position of the cursor's content-point.
//   • DPR raster + offscreen blit (covered by pdf-render.test.ts).

import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import annotationsReducer from '../../state/slices/annotations-slice';
import documentReducer, { setDocument } from '../../state/slices/document-slice';
import ocrReducer from '../../state/slices/ocr-slice';
import selectionReducer from '../../state/slices/selection-slice';
import shapesReducer from '../../state/slices/shapes-slice';
import signaturesReducer from '../../state/slices/signatures-slice';
import uiReducer from '../../state/slices/ui-slice';
import viewportReducer from '../../state/slices/viewport-slice';
import { type PageModel } from '../../types/ipc-contract';

import { PdfViewer } from './index';

// Mock pdf-loader at the seam — PdfViewer's children call into it. The
// loader is replaced with an unresolved no-op so pdf.js Worker never spins up.
vi.mock('../../services/pdf-loader', () => ({
  loadDocumentByHandle: vi.fn(() => new Promise(() => undefined)),
  releaseLoadedDocument: vi.fn(async () => undefined),
}));

function letterPage(index: number): PageModel {
  return {
    pageIndex: index,
    sourcePageRef: { kind: 'original', originalIndex: index },
    rotation: 0,
    width: 612,
    height: 792,
  };
}

function makeStore(): ReturnType<typeof configureStore> {
  return configureStore({
    reducer: {
      document: documentReducer,
      viewport: viewportReducer,
      annotations: annotationsReducer,
      selection: selectionReducer,
      ui: uiReducer,
      shapes: shapesReducer,
      signatures: signaturesReducer,
      ocr: ocrReducer,
    },
    middleware: (mw) =>
      mw({
        serializableCheck: {
          ignoredActionPaths: ['payload.bytes', 'payload.outputBytes', 'payload.data.bytes'],
        },
      }),
  });
}

function seedDoc(store: ReturnType<typeof configureStore>, pages: PageModel[]): void {
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

function getScroller(): HTMLElement {
  const el = document.querySelector('[role="region"][aria-label="Document viewer"]');
  if (!(el instanceof HTMLElement)) throw new Error('scroller not found');
  return el;
}

// jsdom's getBoundingClientRect returns all-zero by default; stub a stable
// scroller rect + per-page rect so the cursor-anchored math has something to
// work with. The fake rect places page 0 at the visible scroller area.
function stubRects(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    if (this instanceof HTMLElement && this.getAttribute('data-page-index') !== null) {
      // Page 0: 100,100 → 712,892 (612×792). Cursor at (300,300) lands inside.
      return {
        x: 100,
        y: 100,
        left: 100,
        top: 100,
        right: 712,
        bottom: 892,
        width: 612,
        height: 792,
        toJSON: () => undefined,
      } as DOMRect;
    }
    // Scroller: 0,0 → 1000,800.
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => undefined,
    } as DOMRect;
  });
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView — stub it so PdfViewer's
  // setCurrentPage IntersectionObserver effect doesn't blow up at mount time.
  if (!Element.prototype.scrollIntoView) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    Element.prototype.scrollIntoView = function (): void {};
  }
  // jsdom does not implement IntersectionObserver — stub a no-op constructor.
  if (
    typeof (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver === 'undefined'
  ) {
    class FakeIO {
      observe(): void {
        /* noop */
      }
      unobserve(): void {
        /* noop */
      }
      disconnect(): void {
        /* noop */
      }
      takeRecords(): [] {
        return [];
      }
    }
    (globalThis as unknown as { IntersectionObserver: typeof FakeIO }).IntersectionObserver =
      FakeIO;
  }
  // requestAnimationFrame is synchronous-via-microtask in jsdom — call the
  // callback inline so the wheel handler's rAF body runs before our assertion.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(performance.now());
    return 0;
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PdfViewer — ctrl+wheel cursor-anchored zoom', () => {
  it('commits a new zoom AND adjusts scrollLeft/scrollTop on ctrl+wheel zoom-in', () => {
    const store = makeStore();
    seedDoc(store, [letterPage(0)]);
    stubRects();
    render(
      <Provider store={store}>
        <PdfViewer />
      </Provider>,
    );

    const scroller = getScroller();
    // Seed a known starting scroll position so the post-commit comp produces
    // observably different values (not the default 0).
    scroller.scrollLeft = 50;
    scroller.scrollTop = 50;

    const initialZoom = store.getState().viewport.zoom;

    // Fire one ctrl+wheel zoom-in event with the cursor over page 0 (300, 300
    // is well inside the stubbed page rect 100,100 → 712,892).
    act(() => {
      fireEvent.wheel(scroller, {
        ctrlKey: true,
        deltaY: -100,
        clientX: 300,
        clientY: 300,
      });
    });

    // Advance past the 120ms debounce — the deferred commit fires here.
    act(() => {
      vi.advanceTimersByTime(150);
    });

    const committedZoom = store.getState().viewport.zoom;
    expect(committedZoom).toBeGreaterThan(initialZoom);

    // Scroll position MUST have changed — the post-commit useLayoutEffect
    // applies the cursor-anchored compensation. Direction: zoom-in moves the
    // content-point AWAY from the origin, so for cursor inside page 0 at
    // (200,200) in content-space (300-100 viewport offset + 0 scroll), the
    // new contentY > old → scrollTop strictly increases.
    expect(scroller.scrollLeft).not.toBe(50);
    expect(scroller.scrollTop).not.toBe(50);
  });

  it('commits a new zoom AND adjusts scrollLeft/scrollTop on ctrl+wheel zoom-out', () => {
    const store = makeStore();
    seedDoc(store, [letterPage(0)]);
    stubRects();
    render(
      <Provider store={store}>
        <PdfViewer />
      </Provider>,
    );

    const scroller = getScroller();
    scroller.scrollLeft = 200;
    scroller.scrollTop = 200;

    const initialZoom = store.getState().viewport.zoom;

    act(() => {
      fireEvent.wheel(scroller, {
        ctrlKey: true,
        deltaY: 100, // positive deltaY = zoom OUT (multiplicative 1/1.1)
        clientX: 300,
        clientY: 300,
      });
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    const committedZoom = store.getState().viewport.zoom;
    expect(committedZoom).toBeLessThan(initialZoom);
    // Zoom-out shrinks content; with the cursor inside the page, scroll
    // shrinks too. Exact value depends on the ratio + the offsets, but it
    // must differ from the 200/200 seed.
    expect(scroller.scrollLeft).not.toBe(200);
    expect(scroller.scrollTop).not.toBe(200);
  });

  it('does NOT trigger zoom or scroll-comp on a plain wheel (no ctrlKey)', () => {
    const store = makeStore();
    seedDoc(store, [letterPage(0)]);
    stubRects();
    render(
      <Provider store={store}>
        <PdfViewer />
      </Provider>,
    );

    const scroller = getScroller();
    scroller.scrollLeft = 25;
    scroller.scrollTop = 25;
    const initialZoom = store.getState().viewport.zoom;

    act(() => {
      fireEvent.wheel(scroller, {
        ctrlKey: false,
        deltaY: -100,
        clientX: 300,
        clientY: 300,
      });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // No zoom dispatched.
    expect(store.getState().viewport.zoom).toBe(initialZoom);
    // No scroll comp applied — the plain-wheel handler is the browser's own
    // native scroll, which jsdom does NOT simulate, so the values stay at
    // their seed (proving our zoom handler did NOT mutate them).
    expect(scroller.scrollLeft).toBe(25);
    expect(scroller.scrollTop).toBe(25);
  });
});
