// Handler: pdf:setPasswordProtection (Phase 7.5 Wave 5 — B8)
//
// Contract: docs/api-contracts.md §19.4.2.
// Engine:   src/main/pdf-ops/encryption-engine.ts.

import { z } from 'zod';

import {
  setPasswordProtection,
  type EncryptionEngineError as EngineErr,
  type QpdfDiscovery,
} from '../../main/pdf-ops/encryption-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfSetPasswordProtectionError,
  PdfSetPasswordProtectionResponse,
  PdfSetPasswordProtectionValue,
} from '../contracts.js';

// ============================================================================
// Schema
// ============================================================================

const permissionsSchema = z.object({
  print: z.boolean(),
  modify: z.boolean(),
  copy: z.boolean(),
  annotate: z.boolean(),
  fillForms: z.boolean(),
  extract: z.boolean(),
  assemble: z.boolean(),
  printHighRes: z.boolean(),
});

const requestSchema = z.object({
  handle: z.number().int().positive(),
  openPassword: z.union([z.string(), z.null()]),
  permissionsPassword: z.union([z.string(), z.null()]),
  permissions: permissionsSchema,
  encryption: z.union([z.literal('aes-128'), z.literal('aes-256')]),
});

// ============================================================================
// Deps
// ============================================================================

export interface PdfSetPasswordProtectionDeps {
  getBytes: (handle: DocumentHandle) => Uint8Array | null;
  setBytes: (handle: DocumentHandle, bytes: Uint8Array) => void;
  /** Test seam — wire a synthetic QpdfRunner. */
  qpdfDiscovery?: QpdfDiscovery;
  encryptionEngine?: typeof setPasswordProtection;
}

// ============================================================================
// Handler
// ============================================================================

export async function handlePdfSetPasswordProtection(
  req: unknown,
  deps: PdfSetPasswordProtectionDeps,
): Promise<PdfSetPasswordProtectionResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfSetPasswordProtectionError>('invalid_payload', parsed.error.message);
  }
  const r = parsed.data;

  const bytes = deps.getBytes(r.handle);
  if (!bytes) {
    return fail<PdfSetPasswordProtectionError>(
      'handle_not_found',
      `handle ${r.handle} is not registered`,
    );
  }

  const engine = deps.encryptionEngine ?? setPasswordProtection;
  let engineRes;
  try {
    engineRes = await engine(
      {
        pdfBytes: bytes,
        openPassword: r.openPassword,
        permissionsPassword: r.permissionsPassword,
        permissions: r.permissions,
        algorithm: r.encryption,
      },
      deps.qpdfDiscovery ?? {},
    );
  } catch (e) {
    return fail<PdfSetPasswordProtectionError>(
      'engine_failed',
      safeMessage(e, 'encryption engine threw'),
    );
  }

  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message, engineRes.details);
  }

  deps.setBytes(r.handle, engineRes.value.bytes);
  const v: PdfSetPasswordProtectionValue = {
    outputBytes: engineRes.value.bytes.byteLength,
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
): PdfSetPasswordProtectionResponse {
  switch (engineErr) {
    case 'invalid_payload':
      return fail<PdfSetPasswordProtectionError>('invalid_payload', message, details);
    case 'engine_unavailable':
      return fail<PdfSetPasswordProtectionError>('engine_unavailable', message, details);
    case 'password_too_short':
      return fail<PdfSetPasswordProtectionError>('password_too_short', message, details);
    case 'wrong_password':
      return fail<PdfSetPasswordProtectionError>('wrong_password', message, details);
    case 'engine_failed':
    default:
      return fail<PdfSetPasswordProtectionError>('engine_failed', message, details);
  }
}
