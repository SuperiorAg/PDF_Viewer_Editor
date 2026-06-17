// Handler: pdf:applyHeaderFooter (Phase 7.5 Wave 3 — B4)
//
// Contract: docs/api-contracts.md §19.3.2.
// Engine:   src/main/pdf-ops/header-footer-engine.ts.

import { z } from 'zod';

import {
  applyHeaderFooter,
  type ApplyHeaderFooterError as EngineErr,
  type ApplyHeaderFooterOptions,
  type HeaderFooterTarget,
} from '../../main/pdf-ops/header-footer-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfApplyHeaderFooterError,
  PdfApplyHeaderFooterResponse,
  PdfApplyHeaderFooterValue,
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

const stripSchema = z.object({
  left: z.string(),
  center: z.string(),
  right: z.string(),
  fontSize: z.number().positive(),
});

const requestSchema = z.object({
  handle: z.number().int().positive(),
  target: targetSchema,
  header: stripSchema.optional(),
  footer: stripSchema.optional(),
  marginTop: z.number().nonnegative(),
  marginBottom: z.number().nonnegative(),
  startPageNumber: z.number().int(),
  totalPageCountToken: z.boolean(),
  dateString: z.string().optional(),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfApplyHeaderFooterDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  headerFooterEngine?: typeof applyHeaderFooter;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfApplyHeaderFooter(
  req: unknown,
  deps: PdfApplyHeaderFooterDeps,
): Promise<PdfApplyHeaderFooterResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfApplyHeaderFooterError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  if (!r.header && !r.footer) {
    return fail<PdfApplyHeaderFooterError>(
      'invalid_payload',
      'at least one of header / footer must be provided',
    );
  }

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfApplyHeaderFooterError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const engine = deps.headerFooterEngine ?? applyHeaderFooter;
  let engineRes;
  try {
    const opts: ApplyHeaderFooterOptions = {
      pdfBytes: bytes,
      target: contractTargetToEngine(r.target),
      ...(r.header !== undefined ? { header: r.header } : {}),
      ...(r.footer !== undefined ? { footer: r.footer } : {}),
      marginTop: r.marginTop,
      marginBottom: r.marginBottom,
      startPageNumber: r.startPageNumber,
      totalPageCountToken: r.totalPageCountToken,
      ...(r.dateString !== undefined ? { dateString: r.dateString } : {}),
    };
    engineRes = await engine(opts);
  } catch (e) {
    return fail<PdfApplyHeaderFooterError>(
      'engine_failed',
      safeMessage(e, 'header/footer engine threw'),
    );
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfApplyHeaderFooterValue = {
    pagesAffected: engineRes.value.pagesAffected,
    warnings: engineRes.value.warnings,
  };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function contractTargetToEngine(t: PdfPageDesignTarget): HeaderFooterTarget {
  if (t === 'all') return { kind: 'all' };
  if (Array.isArray(t)) return { kind: 'list', indices: t };
  return { kind: 'range', start: t.start, end: t.end };
}

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfApplyHeaderFooterResponse {
  switch (engineErr) {
    case 'invalid_payload':
    case 'invalid_target':
      return fail<PdfApplyHeaderFooterError>('invalid_payload', message, details);
    case 'page_out_of_range':
      return fail<PdfApplyHeaderFooterError>('page_out_of_range', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfApplyHeaderFooterError>('engine_failed', message, details);
  }
}
