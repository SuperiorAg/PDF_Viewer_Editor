// Structure-tree API service — Phase 7.5 C3 (Riley Wave 5b).
//
// Thin feature-detected wrappers over the not-yet-canonical David IPC
// methods `pdf:getStructTree`, `pdf:setStructTree`, `pdf:autoTagPages`.
// Mirrors the Wave 5a tts/preflight feature-detect pattern in
// `state/thunks-phase7-5-wave5a.ts` so the renderer typechecks + runs
// green BEFORE David's parallel Wave 5b preload bridge lands. When David
// lands the canonical `PdfApi['pdf']` additions, the contract-stub becomes
// a re-export wrapper and this service can shed the `Record<string, unknown>`
// narrowing — same migration path the earlier waves used.
//
// IMPORTANT — no `as any` here. The narrowing goes through
// `window.pdfApi` → optional `pdf` namespace → optional method, with
// `typeof === 'function'` guards at each step. The 2026-06-15 parallel-wave
// `as any` scar (`Phase 7.4 B1 finding 7.4.B1.1`) called out exactly this
// trap; mirror Wave 5a's clean narrowing instead.

import {
  type PdfAutoTagPagesRequest,
  type PdfAutoTagPagesResponse,
  type PdfGetStructTreeRequest,
  type PdfGetStructTreeResponse,
  type PdfSetStructTreeRequest,
  type PdfSetStructTreeResponse,
} from '../types/struct-tree-contract-stub';

function bridgeOk(): boolean {
  return typeof window !== 'undefined' && window.pdfApi !== undefined;
}

/** Narrow `window.pdfApi.pdf` to a property bag. David's parallel commit
 *  lands `getStructTree`, `setStructTree`, `autoTagPages` here. Until
 *  then each function is `undefined` and the wrappers below short-circuit
 *  with `bridge_unavailable`. */
function pdfNs(): Record<string, unknown> | null {
  if (!bridgeOk()) return null;
  const ns = (window.pdfApi as unknown as { pdf?: unknown }).pdf;
  if (ns === null || ns === undefined) return null;
  return ns as Record<string, unknown>;
}

export async function callGetStructTree(
  req: PdfGetStructTreeRequest,
): Promise<PdfGetStructTreeResponse> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['getStructTree'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf.getStructTree is not exposed (David Wave 5b not yet landed)',
    };
  }
  return (await (fn as (r: PdfGetStructTreeRequest) => Promise<PdfGetStructTreeResponse>)(
    req,
  )) as PdfGetStructTreeResponse;
}

export async function callSetStructTree(
  req: PdfSetStructTreeRequest,
): Promise<PdfSetStructTreeResponse> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['setStructTree'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf.setStructTree is not exposed (David Wave 5b not yet landed)',
    };
  }
  return (await (fn as (r: PdfSetStructTreeRequest) => Promise<PdfSetStructTreeResponse>)(
    req,
  )) as PdfSetStructTreeResponse;
}

export async function callAutoTagPages(
  req: PdfAutoTagPagesRequest,
): Promise<PdfAutoTagPagesResponse> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['autoTagPages'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf.autoTagPages is not exposed (David Wave 5b not yet landed)',
    };
  }
  return (await (fn as (r: PdfAutoTagPagesRequest) => Promise<PdfAutoTagPagesResponse>)(
    req,
  )) as PdfAutoTagPagesResponse;
}
