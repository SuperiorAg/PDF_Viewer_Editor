// Handler: pdf:runAccessibilityCheck (Phase 7.5 Wave 5d — C6 Accessibility Checker).
//
// Contract: docs/api-contracts.md §19.8.
// Engine:   src/main/pdf-ops/accessibility-engine.ts.
//
// Pure pdf-lib (the engine is pure). The text-extractor seam is
// intentionally NOT wired in v0.8.0 production — extractor-dependent
// rules emit `'unevaluated'` honestly per the four-state model.
// Riley's panel surfaces the disclosure verbatim.

import { z } from 'zod';

import {
  runAccessibilityCheck,
  type AccessibilityEngineError,
  type AccessibilityPageExtractor,
} from '../../main/pdf-ops/accessibility-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfRunAccessibilityCheckError,
  PdfRunAccessibilityCheckResponse,
} from '../contracts.js';

// =====================================================================
// Schema
// =====================================================================

const requestSchema = z.object({
  handle: z.number().int().positive(),
});

// =====================================================================
// Deps
// =====================================================================

export interface PdfAccessibilityCheckDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  /** Engine seam — tests inject. */
  engineRun?: typeof runAccessibilityCheck;
  /** Production extractor wiring; omitted in v0.8.0 so dependent rules
   *  emit `'unevaluated'` honestly. */
  extractor?: AccessibilityPageExtractor;
}

// =====================================================================
// Handler
// =====================================================================

export async function handlePdfRunAccessibilityCheck(
  req: unknown,
  deps: PdfAccessibilityCheckDeps,
): Promise<PdfRunAccessibilityCheckResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfRunAccessibilityCheckError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<PdfRunAccessibilityCheckError>(
      'handle_not_found',
      `handle ${parsed.data.handle} is not registered`,
    );
  }
  const engine = deps.engineRun ?? runAccessibilityCheck;
  try {
    const res = await engine(bytes, deps.extractor ? { extractor: deps.extractor } : {});
    if (!res.ok) {
      return mapEngineErr(res.error, res.message);
    }
    return ok(res.value);
  } catch (e) {
    return fail<PdfRunAccessibilityCheckError>(
      'engine_failed',
      safeMessage(e, 'runAccessibilityCheck engine threw'),
    );
  }
}

// =====================================================================
// Engine-error → IPC-error mapping
// =====================================================================

function mapEngineErr(
  err: AccessibilityEngineError,
  msg: string,
): PdfRunAccessibilityCheckResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfRunAccessibilityCheckError>('invalid_payload', msg);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfRunAccessibilityCheckError>('engine_failed', msg);
  }
}
