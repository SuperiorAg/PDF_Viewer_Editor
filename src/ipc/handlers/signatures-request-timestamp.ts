// Handler: signatures:requestTimestamp (Phase 4, api-contracts.md §14.5)
//
// Standalone TSA request — used by Settings "Test TSA URL" and by
// applyPades internally (when wiring). Validates the URL shape per
// conventions §15.7. P4-L-2: no default service shipped.
//
// H-17.2 (Phase 4.1, Julian Wave 17 review): payload validation via zod
// safeParse, matching cert-load / annotations-add-shape discipline.

import { z } from 'zod';

import { requestTimestamp } from '../../main/pdf-ops/tsa-client.js';
import { fail, ok } from '../../shared/result.js';
import type {
  SignaturesRequestTimestampError,
  SignaturesRequestTimestampRequest,
  SignaturesRequestTimestampResponse,
} from '../contracts.js';

const requestSchema = z.object({
  tsaUrl: z.string().url(),
  hash: z.instanceof(Uint8Array),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export async function handleSignaturesRequestTimestamp(
  req: SignaturesRequestTimestampRequest,
): Promise<SignaturesRequestTimestampResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SignaturesRequestTimestampError>('invalid_payload', parsed.error.message);
  }
  if (!isValidTsaUrl(parsed.data.tsaUrl)) {
    return fail<SignaturesRequestTimestampError>('invalid_payload', 'tsaUrl invalid');
  }
  if (parsed.data.hash.byteLength !== 32) {
    return fail<SignaturesRequestTimestampError>(
      'invalid_payload',
      'hash must be Uint8Array of 32 bytes (SHA-256)',
    );
  }
  const r = await requestTimestamp({
    tsaUrl: parsed.data.tsaUrl,
    hash: parsed.data.hash,
    ...(parsed.data.timeoutMs !== undefined ? { timeoutMs: parsed.data.timeoutMs } : {}),
  });
  if (!r.ok) return fail<SignaturesRequestTimestampError>(r.error, r.message);
  return ok({
    tsrBytes: r.value.tsrBytes,
    tsTokenBytes: r.value.tsTokenBytes,
    genTime: r.value.genTime,
    serialNumber: r.value.serialNumber.toString(),
  });
}

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
