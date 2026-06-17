// Handler: pdf:replacePages (Phase 7.5 Wave 2 — B10)
//
// Contract: docs/api-contracts.md §19.2.4.
// Engine:   src/main/pdf-ops/replace-pages.ts.
//
// Behavior:
//   1. zod-validate the request shape.
//   2. Resolve target bytes via handle, source bytes via sanitized path read.
//   3. Call `replacePages`.
//   4. Replace document-store bytes on success.

import { z } from 'zod';

import {
  replacePages,
  type ReplacePagesError as EngineErr,
} from '../../main/pdf-ops/replace-pages.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfReplacePagesError,
  PdfReplacePagesResponse,
  PdfReplacePagesValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const rangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const requestSchema = z.object({
  handle: z.number().int().positive(),
  targetPages: rangeSchema,
  sourcePath: z.string().min(1),
  sourcePages: rangeSchema,
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfReplacePagesDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  readFile: (path: string) => Promise<Uint8Array>;
  sanitizePath: (raw: unknown) => string | null;
  replaceEngine?: typeof replacePages;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfReplacePages(
  req: unknown,
  deps: PdfReplacePagesDeps,
): Promise<PdfReplacePagesResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfReplacePagesError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const targetBytes = deps.getBytes(r.handle);
  if (!targetBytes) {
    return fail<PdfReplacePagesError>('handle_not_found', `handle ${r.handle} is not registered`);
  }

  const safe = deps.sanitizePath(r.sourcePath);
  if (!safe) {
    return fail<PdfReplacePagesError>('source_invalid_pdf', 'sourcePath failed sanitization');
  }

  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await deps.readFile(safe);
  } catch (e) {
    return fail<PdfReplacePagesError>(
      'source_invalid_pdf',
      safeMessage(e, 'could not read source file'),
    );
  }

  const engine = deps.replaceEngine ?? replacePages;
  let engineRes;
  try {
    engineRes = await engine({
      targetBytes,
      sourceBytes,
      targetRange: r.targetPages,
      sourceRange: r.sourcePages,
    });
  } catch (e) {
    return fail<PdfReplacePagesError>('engine_failed', safeMessage(e, 'replace engine threw'));
  }
  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfReplacePagesValue = { pagesReplaced: engineRes.value.pagesReplaced };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfReplacePagesResponse {
  switch (engineErr) {
    case 'invalid_target_range':
      return fail<PdfReplacePagesError>('invalid_payload', message, details);
    case 'invalid_source_range':
      return fail<PdfReplacePagesError>('invalid_payload', message, details);
    case 'target_page_out_of_range':
      return fail<PdfReplacePagesError>('page_out_of_range', message, details);
    case 'source_page_out_of_range':
      return fail<PdfReplacePagesError>('source_page_out_of_range', message, details);
    case 'target_load_failed':
      return fail<PdfReplacePagesError>('engine_failed', message, details);
    case 'source_load_failed':
      return fail<PdfReplacePagesError>('source_invalid_pdf', message, details);
    case 'engine_failed':
    default:
      return fail<PdfReplacePagesError>('engine_failed', message, details);
  }
}
