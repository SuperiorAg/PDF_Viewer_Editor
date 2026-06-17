// Handler: pdf:swapEmbeddedFont (Phase 7.5 Wave 5 — B18)
//
// Contract: docs/api-contracts.md §19.16.1 (v0.8.0 standard-font targets).
// Engine:   src/main/pdf-ops/font-swap-engine.ts.

import { z } from 'zod';

import {
  STANDARD_PDF_FONTS,
  swapEmbeddedFont,
  type FontSwapEngineError as EngineErr,
  type StandardPdfFont,
} from '../../main/pdf-ops/font-swap-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfSwapEmbeddedFontError,
  PdfSwapEmbeddedFontResponse,
  PdfSwapEmbeddedFontValue,
} from '../contracts.js';

// ============================================================================
// Schema
// ============================================================================

const requestSchema = z.object({
  handle: z.number().int().positive(),
  fromFontName: z.string().min(1),
  toFontName: z
    .string()
    .min(1)
    .refine(
      (s) => (STANDARD_PDF_FONTS as ReadonlyArray<string>).includes(s),
      'toFontName must be one of the 14 standard PDF fonts',
    ),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfSwapEmbeddedFontDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  fontSwapEngine?: typeof swapEmbeddedFont;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfSwapEmbeddedFont(
  req: unknown,
  deps: PdfSwapEmbeddedFontDeps,
): Promise<PdfSwapEmbeddedFontResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfSwapEmbeddedFontError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfSwapEmbeddedFontError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const engine = deps.fontSwapEngine ?? swapEmbeddedFont;
  let engineRes;
  try {
    engineRes = await engine({
      pdfBytes: bytes,
      fromFontName: r.fromFontName,
      toFontName: r.toFontName as StandardPdfFont,
    });
  } catch (e) {
    return fail<PdfSwapEmbeddedFontError>(
      'engine_failed',
      safeMessage(e, 'font-swap engine threw'),
    );
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfSwapEmbeddedFontValue = {
    fontsRewritten: engineRes.value.fontsRewritten,
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
): PdfSwapEmbeddedFontResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfSwapEmbeddedFontError>('invalid_payload', message, details);
    case 'from_font_not_found':
      return fail<PdfSwapEmbeddedFontError>('from_font_not_found', message, details);
    case 'to_font_invalid':
      return fail<PdfSwapEmbeddedFontError>('to_font_invalid', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfSwapEmbeddedFontError>('engine_failed', message, details);
  }
}
