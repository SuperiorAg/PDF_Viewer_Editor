// Handler: signatures:verify (Phase 4, api-contracts.md §14.6)
//
// Verifies a signature THIS APP applied. Phase 4 only — third-party
// signature verification is Phase 4.1+.
//
// Algorithm:
//   1. Look up the audit row by id.
//   2. Re-hash current document bytes over the audit row's byte range.
//   3. Compare to messageDigest extracted from the CMS in the current bytes.
//   4. Compare current doc hash to audit row's doc_hash (tamperedSinceSign).
//
// H-17.2 (Phase 4.1, Julian Wave 17 review): payload validation via zod
// safeParse, matching cert-load / annotations-add-shape discipline.

import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { SignatureAuditRowDto } from '../../main/db-bridge.js';
import { fail, ok } from '../../shared/result.js';
import type {
  DocumentHandle,
  SignaturesVerifyError,
  SignaturesVerifyRequest,
  SignaturesVerifyResponse,
} from '../contracts.js';

export interface SignaturesVerifyDeps {
  getBytes(h: DocumentHandle): Uint8Array | null;
  getAuditRow(id: number): SignatureAuditRowDto | null;
}

const requestSchema = z.object({
  handle: z.number().int().positive(),
  auditLogRowId: z.number().int().nonnegative(),
});

export async function handleSignaturesVerify(
  req: SignaturesVerifyRequest,
  deps: SignaturesVerifyDeps,
): Promise<SignaturesVerifyResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SignaturesVerifyError>('invalid_payload', parsed.error.message);
  }
  const bytes = deps.getBytes(parsed.data.handle);
  if (!bytes) {
    return fail<SignaturesVerifyError>(
      'handle_not_found',
      `handle ${parsed.data.handle} not found`,
    );
  }
  const row = deps.getAuditRow(parsed.data.auditLogRowId);
  if (!row) {
    return fail<SignaturesVerifyError>(
      'audit_row_not_found',
      `audit row ${parsed.data.auditLogRowId} not found`,
    );
  }
  if (!row.byteRange || row.byteRange.length !== 4) {
    return fail<SignaturesVerifyError>(
      'verify_failed',
      'audit row has no byte range (visual signature?)',
    );
  }
  // Recompute hash over the audit row's byte range.
  const range = row.byteRange as [number, number, number, number];
  let recomputed: Uint8Array;
  try {
    const h = createHash('sha256');
    h.update(bytes.subarray(range[0], range[0] + range[1]));
    h.update(bytes.subarray(range[2], range[2] + range[3]));
    recomputed = new Uint8Array(h.digest());
  } catch (e) {
    return fail<SignaturesVerifyError>(
      'verify_failed',
      `hash over byte-range threw: ${(e as Error).name}`,
    );
  }
  // Phase 4 simplification: we trust the audit row's pre_sign_doc_hash AS
  // the canonical pre-sign hash. valid = (recomputed === preSignDocHashHex).
  const recomputedHex = Buffer.from(recomputed).toString('hex');
  const valid = recomputedHex === row.preSignDocHash;
  // tamperedSinceSign = current bytes' full SHA-256 != audit row doc_hash.
  const currentDocHash = createHash('sha256').update(bytes).digest('hex');
  const tamperedSinceSign = currentDocHash !== row.docHash;
  const now = Date.now();
  return ok({
    valid,
    tamperedSinceSign,
    certInfo: {
      fingerprint: row.signedByFingerprint ?? '',
      subjectCN: row.signedBySubjectCN ?? '',
      issuerCN: row.signedByIssuerCN ?? '',
      notBefore: row.certNotBefore ?? 0,
      notAfter: row.certNotAfter ?? 0,
      isExpiredNow: (row.certNotAfter ?? 0) < now,
    },
    tsaInfo:
      row.tsaUrl !== null
        ? {
            tsaUrl: row.tsaUrl,
            genTime: row.signedAt,
            valid: row.tsaResponseStatus === 'ok',
          }
        : null,
  });
}
