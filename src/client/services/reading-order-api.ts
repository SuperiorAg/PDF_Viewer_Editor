// Reading-order API service — Phase 7.5 C4 (Riley Wave 5c).
//
// Thin feature-detected wrappers over the not-yet-canonical David IPC
// methods `pdf:getReadingOrder` and `pdf:setReadingOrder`. Mirrors the
// Wave 5b struct-tree-api pattern so the renderer typechecks + runs green
// BEFORE David's parallel Wave 5c preload bridge lands. When David lands
// the canonical `PdfApi['pdf']` additions, the contract-stub becomes a
// re-export wrapper and this service can shed the
// `Record<string, unknown>` narrowing.
//
// IMPORTANT — no `as any` here. The narrowing goes through
// `window.pdfApi` → optional `pdf` namespace → optional method, with
// `typeof === 'function'` guards at each step. Mirrors Wave 5a/5b's clean
// narrowing — the 2026-06-15 parallel-wave `as any` scar (Phase 7.4 B1
// finding 7.4.B1.1) is exactly what this pattern prevents.

import {
  type PdfGetReadingOrderRequest,
  type PdfGetReadingOrderResponse,
  type PdfSetReadingOrderRequest,
  type PdfSetReadingOrderResponse,
} from '../types/reading-order-contract-stub';

function bridgeOk(): boolean {
  return typeof window !== 'undefined' && window.pdfApi !== undefined;
}

/** Narrow `window.pdfApi.pdf` to a property bag. David's parallel commit
 *  lands `getReadingOrder` + `setReadingOrder` here. Until then each
 *  function is `undefined` and the wrappers below short-circuit with
 *  `bridge_unavailable`. */
function pdfNs(): Record<string, unknown> | null {
  if (!bridgeOk()) return null;
  const ns = (window.pdfApi as unknown as { pdf?: unknown }).pdf;
  if (ns === null || ns === undefined) return null;
  return ns as Record<string, unknown>;
}

export async function callGetReadingOrder(
  req: PdfGetReadingOrderRequest,
): Promise<PdfGetReadingOrderResponse> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['getReadingOrder'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf.getReadingOrder is not exposed (David Wave 5c not yet landed)',
    };
  }
  return (await (fn as (r: PdfGetReadingOrderRequest) => Promise<PdfGetReadingOrderResponse>)(
    req,
  )) as PdfGetReadingOrderResponse;
}

export async function callSetReadingOrder(
  req: PdfSetReadingOrderRequest,
): Promise<PdfSetReadingOrderResponse> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['setReadingOrder'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf.setReadingOrder is not exposed (David Wave 5c not yet landed)',
    };
  }
  return (await (fn as (r: PdfSetReadingOrderRequest) => Promise<PdfSetReadingOrderResponse>)(
    req,
  )) as PdfSetReadingOrderResponse;
}
