// Handler: signatures:certRelease (Phase 4, api-contracts.md §14.2)
//
// Explicit zero+release of a cert handle. Renderer fires this on modal close
// (the useEffect cleanup) so a cert never outlives the dismiss path.
// Idempotent: releasing a missing handle returns `released: false`.

import { z } from 'zod';

import { releaseHandle } from '../../main/pdf-ops/cert-store.js';
import { fail, ok } from '../../shared/result.js';
import type { SignaturesCertReleaseError, SignaturesCertReleaseResponse } from '../contracts.js';

const requestSchema = z.object({ handle: z.string().min(1).max(64) });

export async function handleSignaturesCertRelease(
  req: unknown,
): Promise<SignaturesCertReleaseResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SignaturesCertReleaseError>('invalid_payload', parsed.error.message);
  }
  const released = releaseHandle(parsed.data.handle);
  return ok({ released });
}
