// Handler: pdf:compressDocument (Phase 7.5 Wave 4 — B6)
//
// Contract: docs/api-contracts.md §19.4.1.
// Engine:   src/main/pdf-ops/compress-engine.ts.

import { z } from 'zod';

import {
  compressDocument,
  type CompressDocumentError as EngineErr,
  type CompressDocumentOptions,
} from '../../main/pdf-ops/compress-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfCompressDocumentError,
  PdfCompressDocumentResponse,
  PdfCompressDocumentValue,
} from '../contracts.js';

// ============================================================================
// Schema
// ============================================================================

const requestSchema = z.object({
  handle: z.number().int().positive(),
  imageDownsampleDpi: z.union([z.number().positive(), z.null()]),
  jpegRecompressQuality: z.union([z.number().min(0).max(1), z.null()]),
  fontSubsetting: z.boolean(),
  removeUnusedObjects: z.boolean(),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfCompressDocumentDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  compressEngine?: typeof compressDocument;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfCompressDocument(
  req: unknown,
  deps: PdfCompressDocumentDeps,
): Promise<PdfCompressDocumentResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfCompressDocumentError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfCompressDocumentError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const engine = deps.compressEngine ?? compressDocument;
  let engineRes;
  try {
    const opts: CompressDocumentOptions = {
      pdfBytes: bytes,
      imageDownsampleDpi: r.imageDownsampleDpi,
      jpegRecompressQuality: r.jpegRecompressQuality,
      fontSubsetting: r.fontSubsetting,
      removeUnusedObjects: r.removeUnusedObjects,
    };
    engineRes = await engine(opts);
  } catch (e) {
    return fail<PdfCompressDocumentError>('engine_failed', safeMessage(e, 'compress engine threw'));
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfCompressDocumentValue = {
    originalBytes: engineRes.value.originalBytes,
    compressedBytes: engineRes.value.compressedBytes,
    reductionPercent: engineRes.value.reductionPercent,
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
): PdfCompressDocumentResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfCompressDocumentError>('invalid_payload', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfCompressDocumentError>('engine_failed', message, details);
  }
}
