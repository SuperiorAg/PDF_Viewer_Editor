// Handlers: pdf:export, pdf:getOutline.
//
// Wave-30 follow-up (H-30.1, David 2026-06-01): `handlePdfCombine` is GONE
// from this file — the real implementation lives in
// `src/ipc/handlers/pdf-combine.ts` (engine in `src/main/pdf-ops/combine.ts`).
// The "Phase 1 stub" / "Wave 2 follow-up" comment that lived here is also
// removed — all references to the stub are deleted (only the live handler
// remains, wired via register.ts).
//
// What's left in this module:
//   - `handlePdfExport` — a thin pre-validation gate retained for the legacy
//     `pdf-ops.test.ts` cases; the Phase-2 LIVE export handler lives in
//     `src/ipc/handlers/pdf-export-pdf.ts` and is what register.ts wires.
//     (Same disposition documented before this wave — unchanged.)
//   - `handlePdfGetOutline` — Wave-30 audit flagged this as dead code (zero
//     renderer call sites — only `api.ts`'s bridge-unavailable fallback
//     references the property). DISPOSITION (M-30.1): leave the stub in
//     place returning the same `not_implemented` Result, but the file-header
//     comment that previously claimed "Wave 2 follow-up" is removed. The
//     contract types remain on the wire because the renderer's `PdfApi`
//     fallback in `src/client/services/api.ts` still references the property
//     (that file is Riley's; an additive Riley-owned change can remove the
//     fallback in a subsequent wave, after which David can delete the
//     contract types). See `docs/build-report.md` Wave-30-followup row.

import { fail } from '../../shared/result.js';
import type {
  PdfExportError,
  PdfExportRequest,
  PdfExportResponse,
  PdfGetOutlineError,
  PdfGetOutlineRequest,
  PdfGetOutlineResponse,
} from '../contracts.js';

const ENGINE_PREFS = new Set(['auto', 'pdf-lib', 'chromium']);

/**
 * Phase 1 stub retained as a thin pre-validation gate. The Phase-2 Live
 * handler lives in `src/ipc/handlers/pdf-export-pdf.ts` and is wired by
 * `register.ts`. This export still exists so the Phase-1 test file
 * `pdf-ops.test.ts` keeps compiling (its expectations are absorbed by the
 * Wave-7 handler test).
 *
 * Returns 'invalid_payload' on bad inputs; otherwise returns a synthetic
 * 'cancelled' Result that the Phase-2 handler overrides at runtime.
 */
export function handlePdfExport(req: PdfExportRequest): PdfExportResponse {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<PdfExportError>('handle_not_found', 'handle must be an integer');
  }
  if (!ENGINE_PREFS.has(req.preference)) {
    return fail<PdfExportError>('invalid_payload', 'preference must be auto|pdf-lib|chromium');
  }
  // Stub: the real implementation lives in handlers/pdf-export-pdf.ts. If
  // this stub is invoked directly (no register-time override), surface as
  // 'cancelled' — better than crashing with an unknown error variant.
  return fail<PdfExportError>('cancelled', 'pdf:export stub — Phase-2 handler not wired');
}

/**
 * Dead-code stub (M-30.1) retained to keep the IPC contract surface stable.
 * Zero renderer call sites; only the `api.ts` bridge-unavailable fallback
 * references the property. When that fallback is removed (Riley-owned
 * follow-up), this handler + the channel registration + the contract types
 * can be deleted in a coordinated cross-process change.
 */
export function handlePdfGetOutline(req: PdfGetOutlineRequest): PdfGetOutlineResponse {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<PdfGetOutlineError>('handle_not_found', 'handle must be an integer');
  }
  return fail<PdfGetOutlineError>(
    'not_implemented',
    'pdf:getOutline has no renderer caller; see M-30.1 disposition.',
  );
}
