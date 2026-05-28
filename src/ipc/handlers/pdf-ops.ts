// Handlers: pdf:combine, pdf:export, pdf:getOutline.
//
// All three are Phase-1 stubs that validate their inputs and return
// 'not_implemented' so the renderer can wire calls now without hitting an
// unknown-channel error. Real combine logic lands in src/main/pdf-ops/combine.ts
// in Wave 2 follow-up after Riley's renderer-side pdf-lib code lands;
// export engines land in Phase 2 (ARCHITECTURE §6).

import { fail } from '../../shared/result.js';
import type {
  PdfCombineError,
  PdfCombineRequest,
  PdfCombineResponse,
  PdfExportError,
  PdfExportRequest,
  PdfExportResponse,
  PdfGetOutlineError,
  PdfGetOutlineRequest,
  PdfGetOutlineResponse,
} from '../contracts.js';

const ENGINE_PREFS = new Set(['auto', 'pdf-lib', 'chromium']);

export function handlePdfCombine(req: PdfCombineRequest): PdfCombineResponse {
  if (!Array.isArray(req.sources) || req.sources.length < 2) {
    return fail<PdfCombineError>('invalid_source', 'sources[] must have ≥ 2 entries');
  }
  for (const s of req.sources) {
    if (s.kind !== 'handle' && s.kind !== 'path') {
      return fail<PdfCombineError>('invalid_source', 'source.kind must be handle | path');
    }
    if (s.pageRange) {
      const { start, end } = s.pageRange;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        return fail<PdfCombineError>('invalid_page_range', 'pageRange invalid');
      }
    }
  }
  return fail<PdfCombineError>(
    'not_implemented',
    'Phase 1 stub: combine engine ships in Wave 2 follow-up',
  );
}

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

export function handlePdfGetOutline(req: PdfGetOutlineRequest): PdfGetOutlineResponse {
  if (typeof req.handle !== 'number' || !Number.isInteger(req.handle)) {
    return fail<PdfGetOutlineError>('handle_not_found', 'handle must be an integer');
  }
  return fail<PdfGetOutlineError>(
    'not_implemented',
    'Phase 1 stub: outline parsing ships in Wave 2 follow-up',
  );
}
