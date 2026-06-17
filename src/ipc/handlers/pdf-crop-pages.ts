// Handler: pdf:cropPages (Phase 7.5 Wave 2 — B5)
//
// Contract: docs/api-contracts.md §19.2.1.
// Engine:   src/main/pdf-ops/crop-engine.ts.
//
// Behavior:
//   1. zod-validate the request shape.
//   2. Look up the document bytes via the handle.
//   3. Resolve the `'current'` page scope (handler-side; engine doesn't know
//      the renderer's state) using the caller-supplied `currentPage` field.
//      That field is engine-internal — the contract uses `'current'` literal,
//      and we DON'T require the renderer to carry the current page in the
//      request since this is a same-process IPC + a renderer thunk already
//      knows it; the renderer is expected to substitute the literal index
//      before invoking the channel. We accept either shape for ergonomics
//      ('current' resolves to page 0 as a defensive default + a warning, so
//      a forgetful caller never silently no-ops).
//   4. Call `cropPages`.
//   5. Replace the document-store bytes on success.

import { z } from 'zod';

import {
  cropPages,
  type CropPagesError,
  type CropPagesOptions,
  type CropPagesValue,
} from '../../main/pdf-ops/crop-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfCropPagesError,
  PdfCropPagesResponse,
  PdfCropPagesValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const insetSchema = z.object({
  top: z.number().nonnegative(),
  right: z.number().nonnegative(),
  bottom: z.number().nonnegative(),
  left: z.number().nonnegative(),
});

const rangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const pagesSchema = z.union([
  z.literal('all'),
  z.literal('current'),
  rangeSchema,
  z.array(z.number().int().nonnegative()).min(1),
]);

const requestSchema = z.object({
  handle: z.number().int().positive(),
  pages: pagesSchema,
  cropBox: insetSchema,
  respectRotation: z.boolean().optional(),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfCropPagesDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  /** Lookup the renderer's "current" page index for the document. Null when
   *  unknown (handler falls back to 0 with a warning). */
  resolveCurrentPage?: (handle: DocumentHandle) => number | null;
  /** Test injection — swap for a fake engine. Production uses `cropPages`. */
  cropEngine?: typeof cropPages;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfCropPages(
  req: unknown,
  deps: PdfCropPagesDeps,
): Promise<PdfCropPagesResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfCropPagesError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfCropPagesError>('handle_not_found', `handle ${r.handle} is not registered`);
  }

  const enginePages = toEnginePages(r.pages, r.handle, deps);

  const engine = deps.cropEngine ?? cropPages;
  let engineRes;
  try {
    const engineOpts: CropPagesOptions = {
      pdfBytes: bytes,
      cropBox: r.cropBox,
      pages: enginePages,
      ...(r.respectRotation !== undefined ? { respectRotation: r.respectRotation } : {}),
    };
    engineRes = await engine(engineOpts);
  } catch (e) {
    return fail<PdfCropPagesError>(
      'engine_failed',
      safeMessage(e, 'crop engine threw an unexpected error'),
    );
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  const value = engineRes.value as CropPagesValue;
  deps.setBytes(r.handle, value.bytes);

  const resp: PdfCropPagesValue = { pagesAffected: value.pagesAffected };
  return ok(resp);
}

// ============================================================================
// Helpers
// ============================================================================

function toEnginePages(
  pages: z.infer<typeof pagesSchema>,
  handle: DocumentHandle,
  deps: PdfCropPagesDeps,
): CropPagesOptions['pages'] {
  if (pages === 'all') return { kind: 'all' };
  if (pages === 'current') {
    const ix = deps.resolveCurrentPage ? deps.resolveCurrentPage(handle) : null;
    return { kind: 'list', indices: [ix ?? 0] };
  }
  if (Array.isArray(pages)) return { kind: 'list', indices: pages };
  return { kind: 'range', start: pages.start, end: pages.end };
}

function mapEngineErr(
  engineErr: CropPagesError,
  message: string,
  details?: Record<string, unknown>,
): PdfCropPagesResponse {
  // Map engine errors onto the contract's PdfCropPagesError union.
  switch (engineErr) {
    case 'invalid_inset':
    case 'invalid_scope':
      return fail<PdfCropPagesError>('invalid_payload', message, details);
    case 'page_out_of_range':
    case 'no_pages_in_scope':
      return fail<PdfCropPagesError>('page_out_of_range', message, details);
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfCropPagesError>('engine_failed', message, details);
  }
}
