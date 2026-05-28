// Handler: signatures:applyPades (Phase 4, api-contracts.md §14.4)
//
// PAdES sign — long-running with optional TSA hop. The handler:
//   1. Validates payload via zod safeParse (H-17.2 Phase 4.1 cleanup).
//   2. Validates the tsaUrl shape (HTTPS, no userinfo, no fragment) per
//      conventions §15.7 + api-contracts §14.12.
//   3. Delegates to signature-engine.applySignature({ kind: 'pades' }).
//   4. The engine handles cert lookup, visual widget compose, PAdES sign,
//      audit-log insert, autoRelease finally.
//
// The handler does NOT touch cert bytes or the password — those live in
// cert-store, keyed by the handle. (B-17.1 Phase 4.1: cert-store retains
// the PFX bytes + password buffer until releaseHandle zeroes them; the
// engine consumes from `entry.pfxBytes` / `entry.passwordBuffer`.)

import { z } from 'zod';

import { applySignature, type AuditLogSink } from '../../main/pdf-ops/signature-engine.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  SignaturesApplyPadesError,
  SignaturesApplyPadesRequest,
  SignaturesApplyPadesResponse,
} from '../contracts.js';

export interface SignaturesApplyPadesDeps {
  getBytes(h: DocumentHandle): Uint8Array | null;
  setBytes(h: DocumentHandle, b: Uint8Array): void;
  auditLog: AuditLogSink | null;
}

const placementSchema = z.object({
  mode: z.enum(['placeholder', 'freeform']),
  fieldName: z.string().optional(),
  pageIndex: z.number().int().nonnegative().optional(),
  rect: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
});

const padesAppearanceSchema = z
  .object({
    source: z.unknown(),
    showName: z.boolean(),
    showDate: z.boolean(),
    showReason: z.boolean(),
    showSubjectCN: z.boolean(),
    showIssuerCN: z.boolean(),
    showTsaInfo: z.boolean(),
    reason: z.string().optional(),
  })
  .passthrough();

const requestSchema = z.object({
  handle: z.number().int().positive(),
  certHandle: z.string().min(1),
  placement: placementSchema,
  appearance: padesAppearanceSchema,
  tsaUrl: z.string().url().nullable(),
  reason: z.string().optional(),
  location: z.string().optional(),
  // signature-engine.md §3.3: placeholder bounded [4096, 65536] hex chars.
  placeholderSize: z.number().int().min(4096).max(65536).optional(),
  autoRelease: z.boolean().optional(),
});

export async function handleSignaturesApplyPades(
  req: SignaturesApplyPadesRequest,
  deps: SignaturesApplyPadesDeps,
): Promise<SignaturesApplyPadesResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SignaturesApplyPadesError>('invalid_payload', parsed.error.message);
  }
  if (parsed.data.tsaUrl !== null && !isValidTsaUrl(parsed.data.tsaUrl)) {
    return fail<SignaturesApplyPadesError>('invalid_payload', 'tsaUrl invalid');
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<SignaturesApplyPadesError>(
      'handle_not_found',
      `handle ${parsed.data.handle} not found`,
    );
  }
  const r = await applySignature(
    {
      kind: 'pades',
      bytes,
      placement: req.placement,
      certHandle: parsed.data.certHandle,
      appearance: req.appearance,
      tsaUrl: parsed.data.tsaUrl,
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
      ...(parsed.data.location !== undefined ? { location: parsed.data.location } : {}),
      ...(parsed.data.placeholderSize !== undefined
        ? { placeholderSize: parsed.data.placeholderSize }
        : {}),
      ...(parsed.data.autoRelease !== undefined ? { autoRelease: parsed.data.autoRelease } : {}),
    },
    { auditLog: deps.auditLog },
  );
  if (!r.ok) {
    // Map every engine error 1:1 onto the PAdES error union.
    const mapped = mapEngineError(r.error);
    return fail<SignaturesApplyPadesError>(mapped, r.message);
  }
  deps.setBytes(parsed.data.handle, r.value.newBytes);
  return ok({
    op: r.value.op,
    auditLogRowId: r.value.auditLogRowId ?? -1,
    signerSubjectCN: r.value.signerSubjectCN ?? '',
    certFingerprint: r.value.certFingerprint ?? '',
    signedAt: r.value.signedAt,
    tsaResponseStatus: r.value.tsaResponseStatus,
    warnings: r.value.warnings,
  });
}

function mapEngineError(e: string): SignaturesApplyPadesError {
  // The engine union is a strict superset of SignaturesApplyPadesError minus
  // the visual-only variants. Pass through; default to pades_sign_failed.
  const known: ReadonlySet<string> = new Set([
    'handle_not_found',
    'cert_handle_not_found',
    'cert_expired',
    'cert_not_yet_valid',
    'invalid_payload',
    'placeholder_field_not_found',
    'placeholder_field_already_signed',
    'invalid_placement',
    'appearance_compose_failed',
    'pades_sign_failed',
    'pades_byte_range_failed',
    'pades_placeholder_too_small',
    'pades_invalidated_by_subsequent_edit',
    'tsa_http_error',
    'tsa_tls_error',
    'tsa_timeout',
    'tsa_invalid_response',
    'tsa_nonce_mismatch',
    'tsa_genTime_skew',
    'tsa_disabled_but_requested',
    'serialize_failed',
    'audit_log_failed',
    'engine_not_available',
  ]);
  return (known.has(e) ? e : 'pades_sign_failed') as SignaturesApplyPadesError;
}

/**
 * Per conventions §15.7 + api-contracts §14.12: must be https://, no
 * userinfo, no fragment, query allowed but bounded.
 */
function isValidTsaUrl(s: string): boolean {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.hash) return false;
  if (u.search && u.search.length > 256) return false;
  return true;
}
