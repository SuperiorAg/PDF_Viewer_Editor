// Alt-text API service — Phase 7.5 C5 (Riley Wave 5c).
//
// Thin feature-detected wrappers over David's not-yet-canonical IPC
// methods `pdf:setAltText` and `pdf:listFiguresWithoutAltText`. Mirrors
// the Wave 5b struct-tree-api pattern so the renderer typechecks + runs
// green BEFORE David's parallel Wave 5c preload bridge lands.
//
// IMPORTANT — no `as any` here. The narrowing goes through
// `window.pdfApi` → optional `pdf` namespace → optional method, with
// `typeof === 'function'` guards at each step.

import {
  type PdfListFiguresWithoutAltTextRequest,
  type PdfListFiguresWithoutAltTextResponse,
  type PdfSetAltTextRequest,
  type PdfSetAltTextResponse,
} from '../types/alt-text-contract-stub';

function bridgeOk(): boolean {
  return typeof window !== 'undefined' && window.pdfApi !== undefined;
}

function pdfNs(): Record<string, unknown> | null {
  if (!bridgeOk()) return null;
  const ns = (window.pdfApi as unknown as { pdf?: unknown }).pdf;
  if (ns === null || ns === undefined) return null;
  return ns as Record<string, unknown>;
}

export async function callListFiguresWithoutAltText(
  req: PdfListFiguresWithoutAltTextRequest,
): Promise<PdfListFiguresWithoutAltTextResponse> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['listFiguresWithoutAltText'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message:
        'window.pdfApi.pdf.listFiguresWithoutAltText is not exposed (David Wave 5c not yet landed)',
    };
  }
  return (await (
    fn as (r: PdfListFiguresWithoutAltTextRequest) => Promise<PdfListFiguresWithoutAltTextResponse>
  )(req)) as PdfListFiguresWithoutAltTextResponse;
}

export async function callSetAltText(req: PdfSetAltTextRequest): Promise<PdfSetAltTextResponse> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['setAltText'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf.setAltText is not exposed (David Wave 5c not yet landed)',
    };
  }
  return (await (fn as (r: PdfSetAltTextRequest) => Promise<PdfSetAltTextResponse>)(
    req,
  )) as PdfSetAltTextResponse;
}
