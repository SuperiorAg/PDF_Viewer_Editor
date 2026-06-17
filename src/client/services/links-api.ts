// Links API — Phase 7.5 B13 (Riley Wave 4).
//
// Thin wrapper around the canonical `pdf:editLinks` channel David shipped in
// Wave 4. When the preload bridge is absent (Vitest, very early boot), the
// api fallback returns `'bridge_unavailable'` per the standard convention —
// the renderer's link UI tolerates that by keeping the link session-local
// with an honest toast.

import type { PdfEditLinksRequest, PdfEditLinksResponse } from '../types/links-contract-stub';

import { api } from './api';

/** Best-effort hyperlink-edit dispatch through the canonical channel. */
export async function editLinks(req: PdfEditLinksRequest): Promise<PdfEditLinksResponse> {
  return api.pdf.editLinks(req);
}

/**
 * External URL open. Phase 7 ships `app.openExternal` only for
 * `'show_in_explorer'` (the path reveal channel). Until a generic-URL variant
 * lands we best-effort open via `window.open` with `noopener`; Electron's
 * default window-open-handler typically routes that to the system browser.
 * If the call returns `null` we fall back to copying the URL to the system
 * clipboard so the user is never silently stuck.
 */
export async function openUrlBestEffort(url: string): Promise<'opened' | 'copied' | 'failed'> {
  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win !== null) return 'opened';
  } catch {
    // fall through to clipboard
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {
    // fall through
  }
  return 'failed';
}
