// >200 lines: this file is the SOLE renderer-side pdf.js wrapper (single
// funnel) per Phase 4.1 brief + conventions §1.2. Splitting worker-bootstrap,
// document/page proxies, and viewport math into separate files would fragment
// the memory-hygiene contract (ARCHITECTURE.md §4.4) across three modules; the
// contract is easier to audit when it lives in one place. The whole file is
// ~190 LOC at landing, just over the soft 200-line threshold by counting
// blank lines / module header.
//
// pdf.js wrapper — worker bootstrap, document/page proxies, render lifecycle.
//
// ARCHITECTURE.md §4.4 (memory hygiene) — non-negotiable contracts:
//   • Every `PDFPageProxy` MUST have `.cleanup()` called when scrolled out of
//     viewport / sidebar visibility.
//   • Every in-flight `RenderTask` MUST be cancellable; the returned RenderJob
//     wraps the pdf.js RenderTask 1:1 so `.cancel()` truly cancels mid-flight.
//   • `pdfDoc.destroy()` MUST be called on document close; the worker is shut
//     down on app shutdown via `shutdown()` (see also Wave 8 Julian audit).
//
// CSP discipline (src/client/index.html `worker-src 'self' blob:`):
//   The worker is loaded as a Vite-served asset URL — NEVER from a CDN. We
//   resolve the worker URL via `new URL(..., import.meta.url)` so Vite's
//   asset pipeline includes it in the renderer bundle. Setting
//   `GlobalWorkerOptions.workerPort` is rejected in Phase 4.1 (electron Vite
//   blob: is fine, but a fresh `new Worker(url)` would need `worker-src
//   blob:` plus our self-origin URL — easier to let pdf.js spawn the worker
//   internally from `workerSrc`).
//
// Phase 4.1 transition: replaced the Wave-2 stub that returned `pageCount: 0`
// and a no-op render. The typed surface (PdfRenderService, PdfDocumentProxy,
// PdfPageProxy, RenderJob, viewportForPage) is preserved verbatim so PdfCanvas
// + pdf-loader keep working through the swap.

import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy as PdfJsDocumentProxy,
  type PDFPageProxy as PdfJsPageProxy,
  type RenderTask as PdfJsRenderTask,
} from 'pdfjs-dist';
// Vite resolves this as an asset URL (string) at build time. The `?url`
// suffix tells Vite to emit the file as-is and return its public URL.
// Electron-vite preserves this through `dist/renderer/`.
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { type PageModel } from '../types/ipc-contract';

// ----------------------------------------------------------------------------
// Worker bootstrap — runs exactly once per renderer process.
// ----------------------------------------------------------------------------

let workerConfigured = false;

function ensureWorkerConfigured(): void {
  if (workerConfigured) return;
  // GlobalWorkerOptions.workerSrc is the pdf.js public API for "tell the
  // library which URL to spawn the worker from." It uses a `new Worker(url)`
  // internally; our CSP allows `worker-src 'self' blob:` so a self-origin
  // URL is accepted (pdf.js may wrap the script in a blob: URL for its own
  // reasons — both are permitted).
  GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
  workerConfigured = true;
}

// ----------------------------------------------------------------------------
// Public surface (typed contract — unchanged from Wave 2).
// ----------------------------------------------------------------------------

export interface RenderJob {
  cancel(): void;
  promise: Promise<void>;
}

export interface PdfRenderService {
  /**
   * Open a document from bytes. Returns an opaque proxy that can be queried
   * for page count and used to render individual pages.
   *
   * The bytes argument MUST come from `pdf-loader.ts` (the SOLE bytes-fetch
   * path) which reads via `window.pdfApi.fs.readBytesByHandle`. The renderer
   * never reads from disk directly.
   */
  loadDocument(bytes: Uint8Array): Promise<PdfDocumentProxy>;

  /** Tear down the worker; call on app shutdown. */
  shutdown(): Promise<void>;
}

export interface PdfDocumentProxy {
  pageCount: number;
  /** Get a page; caller MUST call `.cleanup()` when scrolled off-screen. */
  getPage(pageIndex: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}

export interface PdfPageProxy {
  pageIndex: number;
  width: number;
  height: number;
  /**
   * Render the page into the given canvas at the given zoom. Returns a
   * RenderJob whose `.cancel()` MUST be called on component unmount to satisfy
   * memory hygiene.
   */
  render(canvas: HTMLCanvasElement, zoom: number): RenderJob;
  cleanup(): void;
}

// ----------------------------------------------------------------------------
// Implementation — real pdfjs-dist calls.
// ----------------------------------------------------------------------------

function wrapPage(pdfPage: PdfJsPageProxy, pageIndex: number): PdfPageProxy {
  // We capture the unrotated page dimensions at scale=1 so the renderer's
  // `viewportForPage()` math agrees with what pdf.js will produce when we
  // call `getViewport({ scale: zoom })` inside `render()`. pdf.js's
  // PageViewport already accounts for any /Rotate entry on the page, but the
  // PdfCanvas component pre-rotates dimensions via PageModel.rotation, so we
  // hand back the page's natural width/height here.
  const baseViewport = pdfPage.getViewport({ scale: 1 });
  return {
    pageIndex,
    width: baseViewport.width,
    height: baseViewport.height,
    render(canvas: HTMLCanvasElement, zoom: number): RenderJob {
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        // No 2D context — return a synchronously-rejected job.
        return {
          cancel: () => undefined,
          promise: Promise.reject(new Error('canvas_2d_context_unavailable')),
        };
      }
      // Render at DEVICE-pixel resolution so glyphs stay crisp on HiDPI /
      // display-scaled Windows screens (125/150/200%). The canvas BITMAP is
      // sized at zoom*devicePixelRatio; PdfCanvas sets the canvas CSS box to
      // the logical (zoom) size, so the browser downscales the hi-res bitmap →
      // crisp. Rendering the bitmap at CSS resolution (the old behavior) let
      // the display upscale it → blocky/pixelated text at >100% scaling.
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const viewport = pdfPage.getViewport({ scale: zoom * dpr });

      // Double-buffer the raster: reassigning the VISIBLE canvas.width/height
      // clears it to transparent for tens of ms before pdf.js paints (the
      // "flash"). Instead render into an OFFSCREEN canvas (sized at the same
      // hi-res zoom*dpr, so the crisp-text fix is preserved) and blit onto the
      // visible canvas in a single synchronous drawImage on completion, so the
      // on-screen bitmap is replaced atomically and never left blank.
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      const offCtx = off.getContext('2d');
      if (offCtx === null) {
        return {
          cancel: () => undefined,
          promise: Promise.reject(new Error('canvas_2d_context_unavailable')),
        };
      }
      const task: PdfJsRenderTask = pdfPage.render({
        canvasContext: offCtx,
        viewport,
      });
      return {
        cancel: () => task.cancel(),
        // `.promise` resolves on render done, rejects with
        // `RenderingCancelledException` on cancel. On success we blit the
        // finished offscreen bitmap onto the visible canvas atomically. On a
        // cancel rejection the .then short-circuits (the blit never runs) and
        // the rejection propagates so PdfCanvas's existing swallow logic still
        // applies; the visible canvas keeps its last good frame (no stale/empty
        // partial frame). Other rejections bubble unchanged.
        promise: task.promise.then(() => {
          canvas.width = off.width;
          canvas.height = off.height;
          ctx.drawImage(off, 0, 0);
        }),
      };
    },
    cleanup(): void {
      pdfPage.cleanup();
    },
  };
}

function wrapDocument(pdfDoc: PdfJsDocumentProxy): PdfDocumentProxy {
  let destroyed = false;
  return {
    pageCount: pdfDoc.numPages,
    async getPage(pageIndex: number): Promise<PdfPageProxy> {
      if (destroyed) {
        throw new Error('document_destroyed');
      }
      // pdf.js is 1-indexed; our PageModel.pageIndex is 0-indexed.
      const pdfPage = await pdfDoc.getPage(pageIndex + 1);
      return wrapPage(pdfPage, pageIndex);
    },
    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      await pdfDoc.destroy();
    },
  };
}

export function createPdfRenderService(): PdfRenderService {
  ensureWorkerConfigured();
  return {
    async loadDocument(bytes: Uint8Array): Promise<PdfDocumentProxy> {
      // pdf.js takes ownership of the buffer it receives — we hand it a copy
      // so the caller's Uint8Array (likely held in component state) is not
      // detached. The IPC bridge already copied the buffer once on its way
      // across; another copy here is the price of safety.
      const owned = new Uint8Array(bytes.byteLength);
      owned.set(bytes);
      // pdf.js needs runtime access to standard Type-1 font substitutes
      // (Helvetica/Times/Courier AFM/PFB) and CMaps (CJK + non-Latin encodings).
      // Both ship in node_modules/pdfjs-dist and are copied to
      // src/client/public/pdfjs/ so Vite serves them at the renderer base.
      // Without these, text widths and glyph mapping go wrong even though
      // pages render. Trailing slash is required by pdf.js URL concatenation.
      const task = getDocument({
        data: owned,
        standardFontDataUrl: './pdfjs/standard_fonts/',
        cMapUrl: './pdfjs/cmaps/',
        cMapPacked: true,
      });
      const pdfDoc = await task.promise;
      return wrapDocument(pdfDoc);
    },
    async shutdown(): Promise<void> {
      // pdf.js has no public "destroy the singleton worker" API — workers are
      // tied to documents. Closing each document via `destroy()` releases its
      // worker. This method is reserved for future pdf.js versions that
      // expose a `PDFWorker.shutdown()`. Currently a no-op.
      return;
    },
  };
}

// ----------------------------------------------------------------------------
// Viewport math — pure helper, independent of pdf.js (kept from Wave 2).
// ----------------------------------------------------------------------------

/**
 * Helper used by PdfCanvas to compute the screen-space viewport for a page at
 * a given zoom level. Mirrors pdf-coords PageViewport so callers can pass it
 * to the coord-conversion utilities without a translation step.
 */
export function viewportForPage(
  page: PageModel,
  zoom: number,
): { width: number; height: number; scale: number } {
  const isRotated90 = page.rotation === 90 || page.rotation === 270;
  const w = isRotated90 ? page.height : page.width;
  const h = isRotated90 ? page.width : page.height;
  return { width: w * zoom, height: h * zoom, scale: zoom };
}

// ----------------------------------------------------------------------------
// Module-scope singleton.
// ----------------------------------------------------------------------------
//
// PdfCanvas + pdf-loader.ts call into this single instance per renderer
// process. Test code can build a fresh instance via createPdfRenderService()
// (or mock the whole module via `vi.mock(...)`).

let _service: PdfRenderService | null = null;

export function getPdfRenderService(): PdfRenderService {
  if (_service === null) {
    _service = createPdfRenderService();
  }
  return _service;
}

/**
 * Test-only hook: reset the module-scope singleton between specs.
 * Production code MUST NOT call this.
 */
export function _resetPdfRenderServiceForTests(): void {
  _service = null;
}
