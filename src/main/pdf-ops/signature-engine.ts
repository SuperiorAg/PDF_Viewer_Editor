// Phase 4 (Wave 16, David) — Signature engine orchestrator.
//
// Contract: docs/signature-engine.md §2.1 + §4 + §7 + §8;
// docs/architecture-phase-4.md §4.1.
//
// Top-level `applySignature(input)` dispatches over a discriminated union:
//   - 'visual' → visual-signature.ts (works end-to-end Wave 16)
//   - 'pades'  → pades-signature.ts (primary, signpdf) OR
//                pades-signature-manual.ts (fallback, forge+pkijs)
//                BOTH return engine_not_available at Wave 16 until Diego
//                ships the deps in Wave 17. The orchestrator's structure +
//                cert-handle integration + audit-log integration are wired
//                end-to-end so the moment the deps land, signing lights up.
//
// **Cert + password lifecycle integration:** the orchestrator wraps the
// PAdES path in `try { ... } finally { if (autoRelease) releaseHandle() }`
// per conventions §15.1 rule 5. The finally fires on EVERY exit path —
// success, failure, exception — so no cert outlives its single intended
// sign call.

import { createHash } from 'node:crypto';

import type {
  EditOperationSerialized,
  PadesAppearanceSpec,
  SignaturePlacement,
  VisualAppearanceSpec,
} from '../../ipc/contracts.js';
import { fail, ok } from '../../shared/result.js';
import type { Result } from '../../shared/result.js';

import { getEntry, releaseHandle, type CertHandle } from './cert-store.js';
import { applyPadesManual } from './pades-signature-manual.js';
import {
  applyPades,
  extractByteRangeAndContents,
  type ApplyPadesError,
} from './pades-signature.js';
import { applyVisualSignature, type ApplyVisualError } from './visual-signature.js';

// ============================================================================
// Public types
// ============================================================================

export type ApplySignatureInput =
  | {
      kind: 'visual';
      bytes: Uint8Array;
      placement: SignaturePlacement;
      appearance: VisualAppearanceSpec;
    }
  | {
      kind: 'pades';
      bytes: Uint8Array;
      placement: SignaturePlacement;
      certHandle: CertHandle;
      appearance: PadesAppearanceSpec;
      tsaUrl: string | null;
      reason?: string;
      location?: string;
      placeholderSize?: number;
      autoRelease?: boolean;
      /** Phase 4.1 toggle — defaults respect `process.env.PADES_ENGINE`. */
      engineChoice?: 'signpdf' | 'manual';
      /** Optional ephemeral PFX bytes passed alongside the handle for node-signpdf. */
      certPfxBytes?: Buffer;
      certPassword?: Buffer;
    };

export type ApplySignatureError =
  | ApplyVisualError
  | ApplyPadesError
  | 'cert_handle_not_found'
  | 'cert_expired'
  | 'cert_not_yet_valid'
  | 'audit_log_failed';

export interface SignatureAuditRowInsertInput {
  doc_hash: string;
  pre_sign_doc_hash: string;
  signed_at: number;
  signature_kind: 'visual' | 'pades' | 'pades-tsa';
  signed_by_fingerprint: string | null;
  signed_by_subject_cn: string | null;
  signed_by_issuer_cn: string | null;
  cert_not_before: number | null;
  cert_not_after: number | null;
  tsa_url: string | null;
  tsa_response_status: 'ok' | 'failed' | null;
  sig_bytes_offset: number | null;
  sig_bytes_length: number | null;
  byte_range_json: string | null;
  reason: string | null;
  location: string | null;
  field_name: string | null;
}

export interface AuditLogSink {
  insert(row: SignatureAuditRowInsertInput): number;
}

export interface ApplySignatureOk {
  newBytes: Uint8Array;
  op: EditOperationSerialized;
  /** PAdES only; null for visual. */
  auditLogRowId: number | null;
  warnings: string[];
  /** PAdES only; null for visual. */
  certFingerprint?: string;
  /** PAdES only. */
  signerSubjectCN?: string;
  signedAt: number;
  tsaResponseStatus: 'ok' | 'failed' | null;
}

export type ApplySignatureResult = Result<ApplySignatureOk, ApplySignatureError>;

// ============================================================================
// Orchestrator
// ============================================================================

export interface ApplySignatureDeps {
  /** Audit-log sink. The orchestrator inserts on PAdES success. */
  auditLog: AuditLogSink | null;
}

/**
 * Apply a signature (visual or PAdES). For PAdES:
 *   - Looks up the cert by handle (returns cert_handle_not_found on miss).
 *   - Validates cert validity window (cert_expired / cert_not_yet_valid).
 *   - Composes the appearance widget onto the bytes.
 *   - Calls the chosen engine (signpdf or manual).
 *   - Inserts an audit-log row.
 *   - Auto-releases the cert handle in the finally block (default true).
 */
export async function applySignature(
  input: ApplySignatureInput,
  deps: ApplySignatureDeps,
): Promise<ApplySignatureResult> {
  if (input.kind === 'visual') {
    return applyVisualPath(input);
  }
  return applyPadesPath(input, deps);
}

async function applyVisualPath(
  input: Extract<ApplySignatureInput, { kind: 'visual' }>,
): Promise<ApplySignatureResult> {
  const r = await applyVisualSignature({
    bytes: input.bytes,
    placement: input.placement,
    appearance: input.appearance,
  });
  if (!r.ok) {
    return fail<ApplySignatureError>(r.error, r.message);
  }
  const signedAt = Date.now();
  const op: EditOperationSerialized = {
    kind: 'signature-visual-place',
    meta: { ts: signedAt, undoable: true, operationId: cryptoRandomId() },
    placement: input.placement,
    appearance: input.appearance,
    placeholderFieldName:
      input.placement.mode === 'placeholder' ? (input.placement.fieldName ?? null) : null,
  };
  return ok({
    newBytes: r.value.newBytes,
    op,
    auditLogRowId: null,
    warnings: r.value.warnings,
    signedAt,
    tsaResponseStatus: null,
  });
}

async function applyPadesPath(
  input: Extract<ApplySignatureInput, { kind: 'pades' }>,
  deps: ApplySignatureDeps,
): Promise<ApplySignatureResult> {
  const autoRelease = input.autoRelease !== false;
  try {
    const entry = getEntry(input.certHandle);
    if (!entry) {
      return fail<ApplySignatureError>(
        'cert_handle_not_found',
        'certHandle not present in cert-store (released or never loaded)',
      );
    }
    const now = Date.now();
    if (now > entry.notAfter) {
      return fail<ApplySignatureError>('cert_expired', 'certificate expired');
    }
    if (now < entry.notBefore) {
      return fail<ApplySignatureError>('cert_not_yet_valid', 'certificate not yet valid');
    }

    // Step 1: compose the visual appearance widget onto the bytes BEFORE
    // signing (the widget is part of the to-be-hashed content).
    const visual = await applyVisualSignature({
      bytes: input.bytes,
      placement: input.placement,
      appearance: input.appearance,
    });
    if (!visual.ok) {
      return fail<ApplySignatureError>(visual.error, visual.message);
    }

    // Step 2: choose engine.
    const engineChoice =
      input.engineChoice ?? (process.env.PADES_ENGINE === 'manual' ? 'manual' : 'signpdf');
    const engine = engineChoice === 'manual' ? applyPadesManual : applyPades;

    // Step 3: sign.
    //
    // Phase 4.1 (B-17.1): the PFX bytes + password buffer are sourced from
    // the cert-store entry, not the input. The entry retains both buffers
    // from `loadCert`; `releaseHandle` (in this function's `finally`) is
    // the canonical zeroer. The optional `input.certPfxBytes` /
    // `input.certPassword` are honored when present (test path uses
    // synthetic buffers via the orchestrator's direct call) but the
    // production IPC path reads from the entry. See
    // `docs/code-review.md §B-17.1` for the audit + remediation rationale.
    const preSignBytes = visual.value.newBytes;
    const preSignHash = sha256Hex(preSignBytes);
    const padesResult = await engine({
      bytesWithWidget: preSignBytes,
      placement: input.placement,
      certEntry: entry,
      certPfxBytes: input.certPfxBytes ?? entry.pfxBytes,
      certPassword: input.certPassword ?? entry.passwordBuffer,
      ...(input.placeholderSize !== undefined ? { placeholderSize: input.placeholderSize } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
    });
    if (!padesResult.ok) {
      return fail<ApplySignatureError>(padesResult.error, padesResult.message);
    }

    // Step 4: insert audit-log row.
    const signedAt = Date.now();
    const docHash = sha256Hex(padesResult.value.signedBytes);
    let auditLogRowId = -1;
    if (deps.auditLog) {
      try {
        auditLogRowId = deps.auditLog.insert({
          doc_hash: docHash,
          pre_sign_doc_hash: preSignHash,
          signed_at: signedAt,
          signature_kind: input.tsaUrl ? 'pades-tsa' : 'pades',
          signed_by_fingerprint: entry.fingerprint,
          signed_by_subject_cn: entry.subjectCN,
          signed_by_issuer_cn: entry.issuerCN,
          cert_not_before: entry.notBefore,
          cert_not_after: entry.notAfter,
          tsa_url: input.tsaUrl,
          tsa_response_status: input.tsaUrl ? 'ok' : null,
          sig_bytes_offset: padesResult.value.sigBytesOffset,
          sig_bytes_length: padesResult.value.sigBytesLength,
          byte_range_json: JSON.stringify(padesResult.value.byteRange),
          reason: input.reason ?? null,
          location: input.location ?? null,
          field_name:
            input.placement.mode === 'placeholder' ? (input.placement.fieldName ?? null) : null,
        });
      } catch (e) {
        return fail<ApplySignatureError>(
          'audit_log_failed',
          `audit-log insert threw: ${(e as Error).message}`,
        );
      }
    }

    const op: EditOperationSerialized = {
      kind: 'signature-pades-applied',
      meta: { ts: signedAt, undoable: true, operationId: cryptoRandomId() },
      placement: input.placement,
      certFingerprint: entry.fingerprint,
      signerSubjectCN: entry.subjectCN,
      signerIssuerCN: entry.issuerCN,
      signedAt,
      tsaUrl: input.tsaUrl,
      auditLogRowId,
      placeholderFieldName:
        input.placement.mode === 'placeholder' ? (input.placement.fieldName ?? null) : null,
    };

    return ok({
      newBytes: padesResult.value.signedBytes,
      op,
      auditLogRowId,
      warnings: visual.value.warnings,
      certFingerprint: entry.fingerprint,
      signerSubjectCN: entry.subjectCN,
      signedAt,
      tsaResponseStatus: input.tsaUrl ? 'ok' : null,
    });
  } finally {
    if (autoRelease) {
      releaseHandle(input.certHandle);
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function cryptoRandomId(): string {
  // Avoid importing randomUUID twice; small inline.
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Re-exported helper for the verify handler. */
export { extractByteRangeAndContents };
