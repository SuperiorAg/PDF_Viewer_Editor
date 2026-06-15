// Handler: pdf:applyRedactions (Phase 7.4 B1 — Riley design §3.1)
//
// R1 rasterize-redact + full sanitize matrix + PAdES backref.
//
// DISCIPLINE (conventions §16):
//   - zod safeParse at the boundary
//   - PAdES pre-flight via detectPriorPadesSignatures — non-skippable
//   - `invalidatesSignaturesConfirmed` discipline (same shape as
//     ocr-run-on-document.ts:179)
//   - Audit-log update on completion (when invalidating signatures)

import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import { detectPriorPadesSignatures } from '../../main/pdf-ops/pades-detect.js';
import {
  applyRedactions,
  type ApplyRedactionsOptions,
  type ApplyRedactionsResult,
  type RedactionRectEngine,
} from '../../main/pdf-ops/redact-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfApplyRedactionsError,
  PdfApplyRedactionsResponse,
  PdfApplyRedactionsValue,
} from '../contracts.js';

// ============================================================================
// Bridge contract for the signature_audit_log redaction-invalidation backref
// (Riley design §5.3).
//
// Same shape as `SignatureAuditOcrInvalidationRepoBridge` in
// ocr-run-on-document.ts:118 — `(docHash, fieldNames, atMs) -> rowsUpdated`.
// The db-bridge adapter resolves rowIds from (docHash, fieldNames) via
// `listByDocHash + filter by fieldName`, matching Ravi's repo signature.
// ============================================================================

export interface SignatureAuditRedactionInvalidationRepoBridge {
  /**
   * Mark every signature_audit_log row matching `docHash` whose `field_name`
   * is in `fieldNames` as invalidated by a redaction operation. Ravi's SQL
   * stamps the timestamp internally via `unixepoch() * 1000` (no `atMs`
   * argument — the SQL is the single source of truth). Returns rows updated.
   *
   * Matches Ravi's repo method signature exactly
   * (src/db/repositories/signature-audit-repo.ts:228).
   */
  markInvalidatedByRedaction(docHash: string, fieldNames: string[]): number;
}

// ============================================================================
// Handler deps
// ============================================================================

export interface PdfApplyRedactionsDeps {
  /** Read original bytes by handle. Null when the handle is unknown. */
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  /** Update document-store bytes after a successful Apply. */
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  /** Doc hash for the signature-audit backref. Null when unknown. */
  getDocHash: (handle: DocumentHandle) => string | null;
  /**
   * Production rasterizer — handle-keyed. Production wiring at register.ts
   * forwards to `ocr.rasterizePage({handle, pageIndex, dpi})` (the same
   * pipeline OCR uses, which is L-004 / L-005 compliant). Tests inject a
   * stub. The handler binds the `handle` from the validated request into a
   * closure before calling the engine.
   */
  rasterizePageByHandle: (
    handle: DocumentHandle,
    opts: { pageIndex: number; dpi: number },
  ) => Promise<Uint8Array>;
  /**
   * Production canvas adapter — paints opaque black rects on a PNG via
   * `@napi-rs/canvas`. Tests inject a stub.
   */
  drawBlackRectsOnPng: ApplyRedactionsOptions['drawBlackRectsOnPng'];
  /**
   * Engine pass-through for test injection. Production passes
   * `applyRedactions` from redact-engine.ts. Tests can inject a stub to
   * exercise the handler's error mapping without standing up the engine.
   */
  engine?: (opts: ApplyRedactionsOptions) => Promise<ApplyRedactionsResult>;
  /**
   * Signature-audit backref bridge. Null when Ravi's repo / the bridge isn't
   * wired (parallel-wave skew). When null, the handler still completes the
   * redaction successfully but skips the audit-log mark.
   */
  signatureAuditRedaction: SignatureAuditRedactionInvalidationRepoBridge | null;
  /**
   * Default DPI for rasterize calls when the request omits one. Production
   * passes 200 (Riley §1.2 default). Tests override.
   */
  defaultRasterDpi: number;
  /** Injected clock — defaults to Date.now. */
  now?: () => number;
}

// ============================================================================
// Payload schema
// ============================================================================

const redactionRectSchema = z
  .object({
    pageIndex: z.number().int().nonnegative(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  })
  .strict();

const requestSchema = z
  .object({
    handle: z.number().int().positive(),
    redactions: z.array(redactionRectSchema),
    invalidatesSignaturesConfirmed: z.boolean().optional(),
    rasterDpi: z.number().positive().optional(),
  })
  .strict();

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfApplyRedactions(
  req: unknown,
  deps: PdfApplyRedactionsDeps,
): Promise<PdfApplyRedactionsResponse> {
  // 1. Validate payload.
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfApplyRedactionsError>('invalid_payload', parsed.error.message);
  }
  const data = parsed.data;
  const engine = deps.engine ?? applyRedactions;

  // 2. Empty redactions short-circuit (defensive — UI should disable Apply).
  if (data.redactions.length === 0) {
    return fail<PdfApplyRedactionsError>('no_redactions', 'redactions[] is empty');
  }

  // 3. Resolve bytes.
  const bytes = deps.getBytes(data.handle);
  if (!bytes) {
    return fail<PdfApplyRedactionsError>('handle_not_found', `handle ${data.handle} not found`);
  }

  // 4. PAdES pre-flight (Riley design §5.2 + conventions §16.5). MUST run
  //    BEFORE any engine work so the modal-confirm path doesn't waste a
  //    rasterize round-trip.
  let signedFields: string[];
  try {
    const probeDoc = await PDFDocument.load(bytes, { updateMetadata: false });
    signedFields = detectPriorPadesSignatures(probeDoc);
  } catch (e) {
    return fail<PdfApplyRedactionsError>(
      'pdf_load_failed',
      `pdf-lib load threw: ${safeMessage(e, 'unknown error')}`,
    );
  }

  if (signedFields.length > 0 && !data.invalidatesSignaturesConfirmed) {
    return fail<PdfApplyRedactionsError>(
      'signed_pdf_requires_confirm',
      `doc has ${signedFields.length} prior PAdES signature(s); confirm required`,
      { fields: signedFields },
    );
  }
  const invalidatesSignatures = signedFields.length > 0;

  // 5. Call the engine.
  const rasterDpi = typeof data.rasterDpi === 'number' ? data.rasterDpi : deps.defaultRasterDpi;
  const rects: RedactionRectEngine[] = data.redactions.map((r) => ({
    pageIndex: r.pageIndex,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  }));

  let engineRes: ApplyRedactionsResult;
  try {
    engineRes = await engine({
      pdfBytes: bytes,
      redactions: rects,
      rasterDpi,
      rasterizePage: async ({ pageIndex, dpi }) =>
        deps.rasterizePageByHandle(data.handle, { pageIndex, dpi }),
      drawBlackRectsOnPng: deps.drawBlackRectsOnPng,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    });
  } catch (e) {
    return fail<PdfApplyRedactionsError>(
      'engine_failed',
      `engine call threw: ${safeMessage(e, 'unknown error')}`,
    );
  }

  if (!engineRes.ok) {
    // Engine errors map 1:1 to PdfApplyRedactionsError (excluding `cancelled`
    // and `signed_pdf_requires_confirm` which are handler-layer concerns).
    const passThrough = new Set<string>([
      'no_redactions',
      'page_out_of_range',
      'rect_invalid',
      'pdf_load_failed',
      'rasterize_failed',
      'engine_failed',
      'output_too_large',
    ]);
    if (passThrough.has(engineRes.error)) {
      return fail<PdfApplyRedactionsError>(
        engineRes.error as PdfApplyRedactionsError,
        engineRes.message,
        engineRes.details,
      );
    }
    return fail<PdfApplyRedactionsError>('engine_failed', engineRes.message);
  }

  // 6. Update document-store with the new bytes.
  deps.setBytes(data.handle, engineRes.value.bytes);

  // 7. Signature-audit invalidation backref (Riley §5.3).
  if (invalidatesSignatures && deps.signatureAuditRedaction) {
    const docHash = deps.getDocHash(data.handle) ?? '';
    try {
      deps.signatureAuditRedaction.markInvalidatedByRedaction(docHash, signedFields);
    } catch {
      // Best-effort; don't fail the entire redact apply for an audit-log
      // hiccup. Mirrors the OCR handler's discipline (ocr-run-on-document.ts:374).
    }
  }

  const value: PdfApplyRedactionsValue = {
    bytes: engineRes.value.bytes,
    pagesRedacted: engineRes.value.pagesRedacted,
    rectsApplied: engineRes.value.rectsApplied,
    invalidatedSignatures: invalidatesSignatures,
    invalidatedSignatureFields: invalidatesSignatures ? signedFields : [],
    warnings: engineRes.value.warnings,
  };
  return ok(value);
}
