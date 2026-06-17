// Handler: pdf:applyBackground (Phase 7.5 Wave 3 — B4)
//
// Contract: docs/api-contracts.md §19.3.3.
// Engine:   src/main/pdf-ops/background-engine.ts.

import { z } from 'zod';

import {
  applyBackground,
  type ApplyBackgroundError as EngineErr,
  type ApplyBackgroundOptions,
  type BackgroundTarget,
} from '../../main/pdf-ops/background-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfApplyBackgroundError,
  PdfApplyBackgroundResponse,
  PdfApplyBackgroundValue,
  PdfPageDesignTarget,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const rangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const targetSchema = z.union([
  z.literal('all'),
  rangeSchema,
  z.array(z.number().int().nonnegative()).min(1),
]);

const sourceSchema = z.union([
  z.object({
    kind: z.literal('color'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  z.object({
    kind: z.literal('image'),
    imageBytes: z.instanceof(Uint8Array),
    opacity: z.number().min(0).max(1),
  }),
]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  target: targetSchema,
  source: sourceSchema,
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfApplyBackgroundDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  backgroundEngine?: typeof applyBackground;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfApplyBackground(
  req: unknown,
  deps: PdfApplyBackgroundDeps,
): Promise<PdfApplyBackgroundResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfApplyBackgroundError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfApplyBackgroundError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const engine = deps.backgroundEngine ?? applyBackground;
  let engineRes;
  try {
    const opts: ApplyBackgroundOptions = {
      pdfBytes: bytes,
      target: contractTargetToEngine(r.target),
      source: r.source,
    };
    engineRes = await engine(opts);
  } catch (e) {
    return fail<PdfApplyBackgroundError>(
      'engine_failed',
      safeMessage(e, 'background engine threw'),
    );
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfApplyBackgroundValue = {
    pagesAffected: engineRes.value.pagesAffected,
    warnings: engineRes.value.warnings,
  };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function contractTargetToEngine(t: PdfPageDesignTarget): BackgroundTarget {
  if (t === 'all') return { kind: 'all' };
  if (Array.isArray(t)) return { kind: 'list', indices: t };
  return { kind: 'range', start: t.start, end: t.end };
}

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfApplyBackgroundResponse {
  switch (engineErr) {
    case 'invalid_payload':
    case 'invalid_target':
      return fail<PdfApplyBackgroundError>('invalid_payload', message, details);
    case 'page_out_of_range':
      return fail<PdfApplyBackgroundError>('page_out_of_range', message, details);
    case 'image_invalid':
      return fail<PdfApplyBackgroundError>('image_invalid', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfApplyBackgroundError>('engine_failed', message, details);
  }
}
