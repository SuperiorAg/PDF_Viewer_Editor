// Handler: pdf:removeHiddenInfo (Phase 7.5 Wave 5 — B20)
//
// Contract: docs/api-contracts.md §19.4.3.
// Engine:   src/main/pdf-ops/sanitize-engine.ts.

import { z } from 'zod';

import {
  sanitizeDocument,
  type SanitizeCategory as EngineCategory,
  type SanitizeEngineError as EngineErr,
} from '../../main/pdf-ops/sanitize-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfRemoveHiddenInfoError,
  PdfRemoveHiddenInfoResponse,
  PdfRemoveHiddenInfoValue,
  SanitizeCategory,
} from '../contracts.js';

// ============================================================================
// Schema
// ============================================================================

const categorySchema = z.union([
  z.literal('metadata'),
  z.literal('attachments'),
  z.literal('comments'),
  z.literal('form-fields'),
  z.literal('bookmarks'),
  z.literal('js'),
  z.literal('hidden-text'),
  z.literal('hidden-layers'),
  z.literal('deleted-content'),
  z.literal('object-data'),
  z.literal('thumbnails'),
  z.literal('web-capture-info'),
  z.literal('links'),
  z.literal('overlapping-objects'),
  z.literal('cross-reference-data'),
  z.literal('content-not-on-page'),
  z.literal('private-application-data'),
]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  categories: z.array(categorySchema).min(1),
  // Wave 5 carry-over (David, 2026-06-17): signed-PDF confirmation flag.
  // Default false (or absent); the renderer sets `true` on the second call
  // after the user acknowledges Riley's confirmation panel.
  confirmSignedDocOverwrite: z.boolean().optional(),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfRemoveHiddenInfoDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  sanitizeEngine?: typeof sanitizeDocument;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfRemoveHiddenInfo(
  req: unknown,
  deps: PdfRemoveHiddenInfoDeps,
): Promise<PdfRemoveHiddenInfoResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfRemoveHiddenInfoError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfRemoveHiddenInfoError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const engine = deps.sanitizeEngine ?? sanitizeDocument;
  let engineRes;
  try {
    engineRes = await engine({
      pdfBytes: bytes,
      categories: r.categories as ReadonlyArray<EngineCategory>,
      ...(r.confirmSignedDocOverwrite !== undefined
        ? { confirmSignedDocOverwrite: r.confirmSignedDocOverwrite }
        : {}),
    });
  } catch (e) {
    return fail<PdfRemoveHiddenInfoError>('engine_failed', safeMessage(e, 'sanitize engine threw'));
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfRemoveHiddenInfoValue = {
    categoriesApplied: engineRes.value.categoriesApplied as SanitizeCategory[],
    itemsRemoved: engineRes.value.itemsRemoved as Record<SanitizeCategory, number>,
    warnings: engineRes.value.warnings,
  };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfRemoveHiddenInfoResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfRemoveHiddenInfoError>('invalid_payload', message, details);
    case 'signed_pdf_requires_confirm':
      return fail<PdfRemoveHiddenInfoError>('signed_pdf_requires_confirm', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfRemoveHiddenInfoError>('engine_failed', message, details);
  }
}
