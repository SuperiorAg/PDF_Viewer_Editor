// Handler: pdf:applyWatermark (Phase 7.5 Wave 3 — B4)
//
// Contract: docs/api-contracts.md §19.3.1.
// Engine:   src/main/pdf-ops/watermark-engine.ts.

import { z } from 'zod';

import {
  applyWatermark,
  type ApplyWatermarkError as EngineErr,
  type ApplyWatermarkOptions,
  type WatermarkTarget,
} from '../../main/pdf-ops/watermark-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfApplyWatermarkError,
  PdfApplyWatermarkResponse,
  PdfApplyWatermarkValue,
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
    kind: z.literal('text'),
    text: z.string().min(1),
    fontSize: z.number().positive(),
    fontColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    rotationDegrees: z.number().finite(),
  }),
  z.object({
    kind: z.literal('image'),
    imageBytes: z.instanceof(Uint8Array),
  }),
]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  target: targetSchema,
  source: sourceSchema,
  opacity: z.number().min(0).max(1),
  position: z.enum(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']),
  layer: z.enum(['overlay', 'underlay']).optional(),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfApplyWatermarkDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  watermarkEngine?: typeof applyWatermark;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfApplyWatermark(
  req: unknown,
  deps: PdfApplyWatermarkDeps,
): Promise<PdfApplyWatermarkResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfApplyWatermarkError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfApplyWatermarkError>('handle_not_found', `handle ${r.handle} is not registered`);
  }

  const engine = deps.watermarkEngine ?? applyWatermark;
  let engineRes;
  try {
    const opts: ApplyWatermarkOptions = {
      pdfBytes: bytes,
      target: contractTargetToEngine(r.target),
      source: r.source,
      opacity: r.opacity,
      position: r.position,
      ...(r.layer !== undefined ? { layer: r.layer } : {}),
    };
    engineRes = await engine(opts);
  } catch (e) {
    return fail<PdfApplyWatermarkError>('engine_failed', safeMessage(e, 'watermark engine threw'));
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfApplyWatermarkValue = {
    pagesAffected: engineRes.value.pagesAffected,
    warnings: engineRes.value.warnings,
  };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function contractTargetToEngine(t: PdfPageDesignTarget): WatermarkTarget {
  if (t === 'all') return { kind: 'all' };
  if (Array.isArray(t)) return { kind: 'list', indices: t };
  return { kind: 'range', start: t.start, end: t.end };
}

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfApplyWatermarkResponse {
  switch (engineErr) {
    case 'invalid_payload':
    case 'invalid_target':
      return fail<PdfApplyWatermarkError>('invalid_payload', message, details);
    case 'page_out_of_range':
      return fail<PdfApplyWatermarkError>('page_out_of_range', message, details);
    case 'image_invalid':
      return fail<PdfApplyWatermarkError>('image_invalid', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfApplyWatermarkError>('engine_failed', message, details);
  }
}
