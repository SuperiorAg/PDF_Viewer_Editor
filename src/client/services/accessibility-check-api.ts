// Accessibility-check API service — Phase 7.5 C6 (Riley Wave 5d).
//
// Thin feature-detected wrapper over David's `pdf:runAccessibilityCheck`
// IPC method. Mirrors the Wave 5b/5c struct-tree-api + reading-order-api
// pattern so the renderer typechecks + runs green BEFORE Diego's preload
// bridge exposes the new method. David's canonical `PdfApi['pdf']` already
// declares the method in `src/ipc/contracts.ts`, so the fallback in
// `services/api.ts` stubs it as `unavailable`. This wrapper feature-detects
// the bridge property at runtime and returns a structurally-correct
// `'bridge_unavailable'` Result when missing.
//
// IMPORTANT — no `as any` here. The narrowing goes through
// `window.pdfApi` → optional `pdf` namespace → optional method, with
// `typeof === 'function'` guards at each step. Mirrors Wave 5a/5b/5c's
// clean narrowing — the 2026-06-15 parallel-wave `as any` scar (Phase 7.4
// B1 finding 7.4.B1.1) is exactly what this pattern prevents.

import type {
  PdfRunAccessibilityCheckRequest,
  PdfRunAccessibilityCheckResponseRenderer,
} from '../types/accessibility-check-contract-stub';

function bridgeOk(): boolean {
  return typeof window !== 'undefined' && window.pdfApi !== undefined;
}

/** Narrow `window.pdfApi.pdf` to a property bag. David's canonical commit
 *  declares `runAccessibilityCheck` here; the preload exposure lands in
 *  a follow-up step. Until then this returns `bridge_unavailable`. */
function pdfNs(): Record<string, unknown> | null {
  if (!bridgeOk()) return null;
  const ns = (window.pdfApi as unknown as { pdf?: unknown }).pdf;
  if (ns === null || ns === undefined) return null;
  return ns as Record<string, unknown>;
}

export async function callRunAccessibilityCheck(
  req: PdfRunAccessibilityCheckRequest,
): Promise<PdfRunAccessibilityCheckResponseRenderer> {
  const ns = pdfNs();
  if (ns === null) {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message: 'window.pdfApi.pdf is not exposed',
    };
  }
  const fn = ns['runAccessibilityCheck'];
  if (typeof fn !== 'function') {
    return {
      ok: false,
      error: 'bridge_unavailable',
      message:
        'window.pdfApi.pdf.runAccessibilityCheck is not exposed (David Wave 5d preload not yet wired)',
    };
  }
  return (await (
    fn as (r: PdfRunAccessibilityCheckRequest) => Promise<PdfRunAccessibilityCheckResponseRenderer>
  )(req)) as PdfRunAccessibilityCheckResponseRenderer;
}
