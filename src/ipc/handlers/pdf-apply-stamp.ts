// Handler: pdf:applyStamp (Phase 7.5 Wave 3 — B7)
//
// Contract: docs/api-contracts.md §19.10.1.
// Engine:   src/main/pdf-ops/stamp-engine.ts.
//
// Stamp lookup:
//   The handler resolves `stampId` against TWO sources:
//     1. `'builtin:<key>'` strings -> the bundled-builtins map (this module
//        owns no bundled image bytes today; all builtins are TEXT so the
//        bundled map just mirrors the seeded stamps_library rows).
//     2. Numeric ids serialized as strings -> Ravi's stamps_library repo via
//        the injected `lookupUserStamp` dep.
//
// The handler also records the stamp's use via the repo so the renderer's
// "Recently used" section reflects the latest call. recordUse failure does
// NOT fail the apply — the stamp drew successfully, the bump is best-effort.

import { z } from 'zod';

import {
  applyStamp,
  type ApplyStampError as EngineErr,
  type StampEntry,
} from '../../main/pdf-ops/stamp-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfApplyStampError,
  PdfApplyStampResponse,
  PdfApplyStampValue,
} from '../contracts.js';

// ============================================================================
// Schemas
// ============================================================================

const requestSchema = z.object({
  handle: z.number().int().positive(),
  stampId: z.string().min(1),
  pageIndex: z.number().int().nonnegative(),
  position: z.object({
    xPt: z.number().finite(),
    yPt: z.number().finite(),
    rotationDegrees: z.number().finite(),
    opacity: z.number().min(0).max(1),
  }),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfApplyStampDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  /** Look up a built-in stamp by `'builtin:<key>'`. Null when unknown. */
  lookupBuiltinStamp: (builtinKey: string) => StampEntry | null;
  /** Look up a user stamp by numeric id. Null when unknown. */
  lookupUserStamp: (id: number) => StampEntry | null;
  /** Best-effort use-count bump. Errors swallowed. */
  recordUse?: (id: number) => void;
  stampEngine?: typeof applyStamp;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfApplyStamp(
  req: unknown,
  deps: PdfApplyStampDeps,
): Promise<PdfApplyStampResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfApplyStampError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfApplyStampError>('handle_not_found', `handle ${r.handle} is not registered`);
  }

  const stamp = resolveStamp(r.stampId, deps);
  if (!stamp) {
    return fail<PdfApplyStampError>('stamp_not_found', `unknown stamp: ${r.stampId}`);
  }

  const engine = deps.stampEngine ?? applyStamp;
  let engineRes;
  try {
    engineRes = await engine({
      pdfBytes: bytes,
      stamp,
      placement: {
        pageIndex: r.pageIndex,
        xPt: r.position.xPt,
        yPt: r.position.yPt,
        rotationDegrees: r.position.rotationDegrees,
        opacity: r.position.opacity,
      },
    });
  } catch (e) {
    return fail<PdfApplyStampError>('engine_failed', safeMessage(e, 'stamp engine threw'));
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  // Best-effort: bump the stamp's recentness (only for known DB rows; builtin
  // stamps live as rows too, but recordUse is keyed by numeric id and we want
  // it for both).
  if (deps.recordUse) {
    try {
      deps.recordUse(stamp.id);
    } catch {
      // swallow — apply already succeeded
    }
  }

  const v: PdfApplyStampValue = { annotationId: engineRes.value.annotationId };
  return ok(v);
}

// ============================================================================
// Helpers
// ============================================================================

function resolveStamp(stampId: string, deps: PdfApplyStampDeps): StampEntry | null {
  if (stampId.startsWith('builtin:')) {
    return deps.lookupBuiltinStamp(stampId);
  }
  const id = Number(stampId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return deps.lookupUserStamp(id);
}

function mapEngineErr(
  engineErr: EngineErr,
  message: string,
  details?: Record<string, unknown>,
): PdfApplyStampResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfApplyStampError>('invalid_payload', message, details);
    case 'page_out_of_range':
      return fail<PdfApplyStampError>('page_out_of_range', message, details);
    case 'image_invalid':
    case 'pdf_load_failed':
    case 'engine_failed':
    default:
      return fail<PdfApplyStampError>('engine_failed', message, details);
  }
}
