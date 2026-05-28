// Handler: signatures:listAudit (Phase 4, api-contracts.md §14.7)
//
// H-17.2 (Phase 4.1, Julian Wave 17 review): payload validation via zod
// safeParse, matching cert-load / annotations-add-shape discipline.

import { z } from 'zod';

import type { SignatureAuditRepoBridge } from '../../main/db-bridge.js';
import { fail, ok } from '../../shared/result.js';
import type {
  SignaturesListAuditError,
  SignaturesListAuditRequest,
  SignaturesListAuditResponse,
  SignatureAuditItem,
} from '../contracts.js';

export interface SignaturesListAuditDeps {
  repo: SignatureAuditRepoBridge | null;
}

const requestSchema = z.object({
  fileHash: z.string().length(64).optional(),
  signedByFingerprint: z.string().length(64).optional(),
  since: z.number().int().nonnegative().optional(),
  until: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(0).max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export async function handleSignaturesListAudit(
  req: SignaturesListAuditRequest,
  deps: SignaturesListAuditDeps,
): Promise<SignaturesListAuditResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SignaturesListAuditError>('invalid_payload', parsed.error.message);
  }
  if (!deps.repo) {
    return fail<SignaturesListAuditError>('db_unavailable', 'audit repo not wired');
  }
  const limit = parsed.data.limit ?? 100;
  const offset = parsed.data.offset ?? 0;
  try {
    const result = deps.repo.listAll(
      {
        ...(parsed.data.fileHash !== undefined ? { fileHash: parsed.data.fileHash } : {}),
        ...(parsed.data.signedByFingerprint !== undefined
          ? { signedByFingerprint: parsed.data.signedByFingerprint }
          : {}),
        ...(parsed.data.since !== undefined ? { since: parsed.data.since } : {}),
        ...(parsed.data.until !== undefined ? { until: parsed.data.until } : {}),
      },
      limit,
      offset,
    );
    const items: SignatureAuditItem[] = result.items.map((dto) => ({
      id: dto.id,
      docHash: dto.docHash,
      preSignDocHash: dto.preSignDocHash,
      signedAt: dto.signedAt,
      signatureKind: dto.signatureKind,
      signedByFingerprint: dto.signedByFingerprint,
      signedBySubjectCN: dto.signedBySubjectCN,
      signedByIssuerCN: dto.signedByIssuerCN,
      certNotBefore: dto.certNotBefore,
      certNotAfter: dto.certNotAfter,
      tsaUrl: dto.tsaUrl,
      tsaResponseStatus: dto.tsaResponseStatus,
      sigBytesOffset: dto.sigBytesOffset,
      sigBytesLength: dto.sigBytesLength,
      byteRange: dto.byteRange,
      reason: dto.reason,
      location: dto.location,
      fieldName: dto.fieldName,
      createdAt: dto.createdAt,
    }));
    return ok({ items, total: result.total });
  } catch (e) {
    return fail<SignaturesListAuditError>(
      'db_unavailable',
      // M-17.3 polish: do NOT include `(e as Error).message` verbatim — repo
      // may surface SQLite internal paths. Use the error name + a generic
      // user-facing string.
      `audit repo threw: ${(e as Error).name ?? 'unknown'}`,
    );
  }
}
