// Phase 4.1 (Riley) — pdf-render unit tests. The Wave-2 stub returned
// `pageCount: 0` and a no-op render; the live wiring uses pdf.js via
// `pdfjs-dist`. We mock `pdfjs-dist` at the module level so the tests run
// in jsdom WITHOUT spinning up a real Web Worker (jsdom's Worker is broken
// for cross-origin blob URLs and the pdf.js worker bootstrap fights it).
//
// The mocks faithfully model the three lifecycle contracts that
// ARCHITECTURE §4.4 calls out:
//   • RenderTask.cancel() → promise rejects with RenderingCancelledException
//   • PDFPageProxy.cleanup() — called by our wrapper on cleanup
//   • PDFDocumentProxy.destroy() — called by our wrapper on destroy
//
// Each test asserts the wrapper behavior, not the mock behavior.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'mock-pdf-worker.js',
}));

interface RenderTaskMock {
  promise: Promise<void>;
  cancel: () => void;
}

interface PageProxyMock {
  getViewport: (args: { scale: number }) => { width: number; height: number };
  render: (args: { canvasContext: unknown; viewport: unknown }) => RenderTaskMock;
  cleanup: () => void;
}

interface DocumentProxyMock {
  numPages: number;
  getPage: (n: number) => Promise<PageProxyMock>;
  destroy: () => Promise<void>;
}

// `vi.hoisted` is the only safe place to declare top-level state that a
// `vi.mock` factory can reference. The factory is hoisted to the top of the
// file by Vitest; regular `const` declarations are accessed before init.
const mockState = vi.hoisted(() => ({
  workerOptions: { workerSrc: '' },
  nextDocumentMock: null as DocumentProxyMockHoisted | null,
  lastGetDocumentArgs: null as unknown,
  getDocumentShouldReject: null as Error | null,
}));

// Hoisted-mock callers can't reference type aliases declared at the top of
// the file, so we re-state the shape inline in the hoisted closure above.
type DocumentProxyMockHoisted = DocumentProxyMock;

vi.mock('pdfjs-dist', () => {
  return {
    GlobalWorkerOptions: mockState.workerOptions,
    getDocument: (args: unknown) => {
      mockState.lastGetDocumentArgs = args;
      if (mockState.getDocumentShouldReject !== null) {
        const err = mockState.getDocumentShouldReject;
        return { promise: Promise.reject(err) };
      }
      return {
        promise: Promise.resolve(mockState.nextDocumentMock),
      };
    },
  };
});

import {
  _resetPdfRenderServiceForTests,
  createPdfRenderService,
  viewportForPage,
} from './pdf-render';

function makePageMock(opts: {
  width: number;
  height: number;
  renderResolves?: boolean;
}): PageProxyMock {
  let cancelCalled = false;
  return {
    getViewport: ({ scale }) => ({
      width: opts.width * scale,
      height: opts.height * scale,
    }),
    render: ({ canvasContext, viewport }) => {
      const ctx = canvasContext as CanvasRenderingContext2D | null;
      const vp = viewport as { width: number; height: number };
      if (ctx !== null) {
        ctx.fillStyle = '#abcdef';
        ctx.fillRect(0, 0, vp.width, vp.height);
      }
      let rejecter: ((e: Error) => void) | null = null;
      const promise = new Promise<void>((resolve, reject) => {
        rejecter = reject;
        if (opts.renderResolves !== false) {
          queueMicrotask(() => {
            if (!cancelCalled) resolve();
          });
        }
      });
      return {
        promise,
        cancel: () => {
          cancelCalled = true;
          const err = new Error('cancelled');
          err.name = 'RenderingCancelledException';
          if (rejecter !== null) rejecter(err);
        },
      };
    },
    cleanup: vi.fn(),
  };
}

function makeDocumentMock(pageCount: number, pages: PageProxyMock[]): DocumentProxyMock {
  return {
    numPages: pageCount,
    getPage: async (n: number) => {
      const p = pages[n - 1];
      if (p === undefined) throw new Error(`no mock page for ${n}`);
      return p;
    },
    destroy: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  mockState.nextDocumentMock = null;
  mockState.lastGetDocumentArgs = null;
  mockState.getDocumentShouldReject = null;
  mockState.workerOptions.workerSrc = '';
  _resetPdfRenderServiceForTests();
});

/**
 * jsdom doesn't ship a real Canvas2D backend — `canvas.getContext('2d')`
 * throws "Not implemented" by default, which trips our wrapper's null-context
 * guard (and the wrapper also creates an OFFSCREEN canvas internally that a
 * per-instance stub can't reach). The shared vitest.setup.ts installs a
 * complete no-op 2D context on `HTMLCanvasElement.prototype` so both the
 * visible canvas and the wrapper's offscreen canvas — including the
 * `ctx.drawImage(off, 0, 0)` blit on completion — resolve against the same
 * stub. We just return a plain canvas here and let the prototype stub apply.
 */
function makeCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

describe('pdf-render — worker bootstrap', () => {
  it('configures GlobalWorkerOptions.workerSrc on service creation', () => {
    expect(mockState.workerOptions.workerSrc).toBe('');
    createPdfRenderService();
    // The worker URL is resolved via Vite ?url at build time; in tests we
    // mocked it to a fixed string. The assertion is "we did set the URL"
    // — the production CSP check is `worker-src 'self' blob:` and a self-
    // origin URL satisfies it (we never reach for a CDN).
    expect(mockState.workerOptions.workerSrc).toBe('mock-pdf-worker.js');
  });

  it('does not re-bootstrap the worker on a second createPdfRenderService call', () => {
    createPdfRenderService();
    mockState.workerOptions.workerSrc = 'tampered';
    createPdfRenderService();
    // The guarded `workerConfigured` flag means we DON'T overwrite the URL
    // on subsequent service creations within the same renderer process.
    expect(mockState.workerOptions.workerSrc).toBe('tampered');
  });
});

describe('pdf-render — loadDocument', () => {
  it('resolves with a proxy that reports the real page count', async () => {
    const pages = [makePageMock({ width: 612, height: 792 })];
    mockState.nextDocumentMock = makeDocumentMock(1, pages);
    const svc = createPdfRenderService();
    const doc = await svc.loadDocument(new Uint8Array([1, 2, 3, 4]));
    expect(doc.pageCount).toBe(1);
  });

  it('passes a COPIED buffer to pdf.js so caller bytes are not detached', async () => {
    const pages = [makePageMock({ width: 612, height: 792 })];
    mockState.nextDocumentMock = makeDocumentMock(1, pages);
    const svc = createPdfRenderService();
    const callerBytes = new Uint8Array([9, 8, 7, 6]);
    await svc.loadDocument(callerBytes);
    const args = mockState.lastGetDocumentArgs as { data: Uint8Array };
    expect(args.data).not.toBe(callerBytes);
    expect(Array.from(args.data)).toEqual([9, 8, 7, 6]);
    // Caller bytes still readable — not detached.
    expect(callerBytes.byteLength).toBe(4);
  });

  it('propagates a pdf.js load failure as a rejection', async () => {
    mockState.getDocumentShouldReject = new Error('invalid PDF');
    const svc = createPdfRenderService();
    await expect(svc.loadDocument(new Uint8Array([0]))).rejects.toThrow('invalid PDF');
  });

  // Phase 4.1.1 — pin the standard-fonts + cmaps wiring. Marcus's hot-patch
  // added these three keys to getDocument() because without them pdf.js
  // substitutes system fonts and CJK / non-Latin encodings break. The viteStaticCopy
  // plugin in electron.vite.config.ts copies the assets at build time;
  // pdf.js then fetches `./pdfjs/standard_fonts/Helvetica.pfb` etc. relative
  // to the renderer base. If a future refactor drops any of these three keys,
  // text rendering silently regresses — pin it here.
  it("passes standardFontDataUrl + cMapUrl + cMapPacked to pdf.js's getDocument", async () => {
    const pages = [makePageMock({ width: 612, height: 792 })];
    mockState.nextDocumentMock = makeDocumentMock(1, pages);
    const svc = createPdfRenderService();
    await svc.loadDocument(new Uint8Array([1, 2]));
    const args = mockState.lastGetDocumentArgs as {
      data: Uint8Array;
      standardFontDataUrl: string;
      cMapUrl: string;
      cMapPacked: boolean;
    };
    // Trailing slash is REQUIRED by pdf.js URL concatenation; without it
    // pdf.js fetches `.../pdfjsHelvetica.pfb` (no separator) and 404s.
    expect(args.standardFontDataUrl).toBe('./pdfjs/standard_fonts/');
    expect(args.cMapUrl).toBe('./pdfjs/cmaps/');
    expect(args.cMapPacked).toBe(true);
  });
});

describe('pdf-render — page lifecycle', () => {
  it('returns a page proxy with width/height from the page viewport', async () => {
    const pages = [makePageMock({ width: 800, height: 600 })];
    mockState.nextDocumentMock = makeDocumentMock(1, pages);
    const svc = createPdfRenderService();
    const doc = await svc.loadDocument(new Uint8Array([0]));
    const page = await doc.getPage(0);
    expect(page.width).toBe(800);
    expect(page.height).toBe(600);
  });

  it('translates 0-indexed getPage to pdf.js 1-indexed getPage', async () => {
    const pages = [
      makePageMock({ width: 612, height: 792 }),
      makePageMock({ width: 612, height: 792 }),
    ];
    const docMock = makeDocumentMock(2, pages);
    mockState.nextDocumentMock = docMock;
    const getPageSpy = vi.spyOn(docMock, 'getPage');
    const svc = createPdfRenderService();
    const doc = await svc.loadDocument(new Uint8Array([0]));
    await doc.getPage(0);
    await doc.getPage(1);
    expect(getPageSpy).toHaveBeenNthCalledWith(1, 1);
    expect(getPageSpy).toHaveBeenNthCalledWith(2, 2);
  });

  it('renders the page onto a canvas and resolves the job promise', async () => {
    const pages = [makePageMock({ width: 200, height: 100 })];
    mockState.nextDocumentMock = makeDocumentMock(1, pages);
    const svc = createPdfRenderService();
    const doc = await svc.loadDocument(new Uint8Array([0]));
    const page = await doc.getPage(0);
    const canvas = makeCanvas();
    const job = page.render(canvas, 1);
    await expect(job.promise).resolves.toBeUndefined();
    // Backing-store dimensions match the requested viewport.
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
  });

  it('cancels a render job mid-flight (promise rejects with RenderingCancelledException)', async () => {
    const pages = [makePageMock({ width: 200, height: 100, renderResolves: false })];
    mockState.nextDocumentMock = makeDocumentMock(1, pages);
    const svc = createPdfRenderService();
    const doc = await svc.loadDocument(new Uint8Array([0]));
    const page = await doc.getPage(0);
    const canvas = makeCanvas();
    const job = page.render(canvas, 1);
    job.cancel();
    await expect(job.promise).rejects.toMatchObject({
      name: 'RenderingCancelledException',
    });
  });

  it('proxies .cleanup() through to the underlying pdf.js page', async () => {
    const pages = [makePageMock({ width: 612, height: 792 })];
    mockState.nextDocumentMock = makeDocumentMock(1, pages);
    const svc = createPdfRenderService();
    const doc = await svc.loadDocument(new Uint8Array([0]));
    const page = await doc.getPage(0);
    page.cleanup();
    expect(pages[0]!.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('pdf-render — document destroy', () => {
  it('proxies .destroy() through to pdf.js and is idempotent', async () => {
    const pages = [makePageMock({ width: 612, height: 792 })];
    const docMock = makeDocumentMock(1, pages);
    mockState.nextDocumentMock = docMock;
    const svc = createPdfRenderService();
    const doc = await svc.loadDocument(new Uint8Array([0]));
    await doc.destroy();
    await doc.destroy(); // second call is a no-op
    expect(docMock.destroy).toHaveBeenCalledTimes(1);
  });

  it('refuses getPage after destroy', async () => {
    const pages = [makePageMock({ width: 612, height: 792 })];
    mockState.nextDocumentMock = makeDocumentMock(1, pages);
    const svc = createPdfRenderService();
    const doc = await svc.loadDocument(new Uint8Array([0]));
    await doc.destroy();
    await expect(doc.getPage(0)).rejects.toThrow(/document_destroyed/);
  });
});

describe('pdf-render — viewportForPage helper (preserved from Wave 2)', () => {
  it('returns un-rotated dimensions scaled by zoom for rotation=0', () => {
    const result = viewportForPage(
      {
        pageIndex: 0,
        sourcePageRef: { kind: 'original', originalIndex: 0 },
        rotation: 0,
        width: 612,
        height: 792,
      },
      1.5,
    );
    expect(result).toEqual({ width: 918, height: 1188, scale: 1.5 });
  });

  it('swaps width/height for 90-deg rotation', () => {
    const result = viewportForPage(
      {
        pageIndex: 0,
        sourcePageRef: { kind: 'original', originalIndex: 0 },
        rotation: 90,
        width: 612,
        height: 792,
      },
      1,
    );
    expect(result).toEqual({ width: 792, height: 612, scale: 1 });
  });
});
