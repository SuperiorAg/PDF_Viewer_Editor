// SOLE bytes-fetch path for the renderer-side pdf.js pipeline.
//
// Phase 4.1 (api-contracts.md §15, brief 2026-05-26): the renderer fetches the
// already-validated document bytes from main's documentStore via
// `window.pdfApi.fs.readBytesByHandle({ handle })`, then hands them to
// `pdf-render.ts`'s `loadDocument(bytes)`. Every consumer of pdf.js documents
// in the renderer routes through THIS file — never the raw IPC call.
//
// Why the single-funnel discipline:
//   1. One place to add caching (Phase 5+ may want LRU per handle).
//   2. One place where error variants from the IPC channel get normalized
//      into a renderer-friendly shape that the PdfCanvas component can react
//      to (e.g. show a toast on `document_evicted` rather than blow up).
//   3. One place to instrument timing (Phase 7 perf telemetry).
//
// Bytes lifetime (per Phase 4.1 brief item B point 4):
//   • Bytes are NOT stored in Redux — they'd serialize to JSON badly and
//     bloat the state tree for documents > 10 MB.
//   • A module-scope WeakRef-friendly Map keyed by `DocumentHandle` caches
//     the bytes Uint8Array AND the resulting PdfDocumentProxy so re-renders
//     of PdfCanvas (zoom changes, page scroll) don't re-fetch from IPC and
//     don't re-parse the PDF.
//   • Cache eviction: when a document closes, the consumer calls
//     `releaseLoadedDocument(handle)` to drop the cache entry and destroy
//     the proxy. PdfViewer wires this on unmount of the document container.

import { type DocumentHandle, type FsReadBytesByHandleError } from '../types/ipc-contract';

import { api } from './api';
import { getPdfRenderService, type PdfDocumentProxy } from './pdf-render';

// Result-of-loader type, surfaced to consumers (PdfCanvas, thunks).
export type PdfLoaderError = FsReadBytesByHandleError | 'bridge_unavailable' | 'pdfjs_load_failed';

export type PdfLoaderResult =
  | { ok: true; doc: PdfDocumentProxy }
  | { ok: false; error: PdfLoaderError; message: string };

// ----------------------------------------------------------------------------
// Cache — handle -> { bytes, doc }. Module scope; survives component unmount
// of one consumer if another consumer is also using the same handle, but the
// `releaseLoadedDocument()` call on the LAST consumer's unmount destroys it.
// Reference-counting is NOT implemented in Phase 4.1 — the walking-skeleton
// only has one consumer (PdfCanvas via PdfViewer); add refcount in Phase 5+
// if/when multi-view becomes a thing.
// ----------------------------------------------------------------------------

interface LoadedEntry {
  doc: PdfDocumentProxy;
}

const cache = new Map<DocumentHandle, LoadedEntry>();
// Track in-flight loads so concurrent calls for the same handle reuse the
// same promise rather than racing two parallel pdf.js parses.
const inflight = new Map<DocumentHandle, Promise<PdfLoaderResult>>();

/**
 * Fetch bytes for a handle and load them into pdf.js. Cached per-handle so
 * repeat calls return the same proxy (until `releaseLoadedDocument()` is
 * invoked for that handle).
 */
export async function loadDocumentByHandle(handle: DocumentHandle): Promise<PdfLoaderResult> {
  // Cache hit
  const hit = cache.get(handle);
  if (hit !== undefined) {
    return { ok: true, doc: hit.doc };
  }
  // De-duplicate concurrent loads
  const pending = inflight.get(handle);
  if (pending !== undefined) {
    return pending;
  }
  const p = (async (): Promise<PdfLoaderResult> => {
    try {
      const res = await api.fs.readBytesByHandle({ handle });
      if (!res.ok) {
        return {
          ok: false,
          // 'bridge_unavailable' may surface from the fallback in api.ts.
          error: res.error as PdfLoaderError,
          message: res.message,
        };
      }
      const svc = getPdfRenderService();
      try {
        const doc = await svc.loadDocument(res.value.bytes);
        cache.set(handle, { doc });
        return { ok: true, doc };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'pdf.js failed to parse document';
        return { ok: false, error: 'pdfjs_load_failed', message };
      }
    } finally {
      inflight.delete(handle);
    }
  })();
  inflight.set(handle, p);
  return p;
}

/**
 * Release a cached document: destroy the proxy (which cleans up pdf.js
 * pages + worker references) and drop the cache entry. Idempotent.
 * Consumers MUST call this when the document is closed in the renderer (e.g.
 * PdfViewer effect cleanup when the document handle changes).
 */
export async function releaseLoadedDocument(handle: DocumentHandle): Promise<void> {
  const entry = cache.get(handle);
  if (entry === undefined) return;
  cache.delete(handle);
  await entry.doc.destroy();
}

/** Test-only: clear the cache and destroy any held proxies. */
export async function _resetPdfLoaderForTests(): Promise<void> {
  const handles = Array.from(cache.keys());
  for (const h of handles) {
    await releaseLoadedDocument(h);
  }
  inflight.clear();
}
