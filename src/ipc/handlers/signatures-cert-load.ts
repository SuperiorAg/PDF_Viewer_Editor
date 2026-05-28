// Handler: signatures:certLoad (Phase 4, api-contracts.md §14.1)
//
// This handler is the CANONICAL example of conventions §15.2: it Buffer-wraps
// the password at the EARLIEST synchronous point (within ≤5 lines of the
// validated payload destructuring), overwrites the parsed-payload field with
// '', and delegates to cert-store.loadCert which zeroes both buffers in a
// finally block.
//
// Wave 17 Julian audits this file via the §15.5 mechanical greps.

import { z } from 'zod';

import { loadCert } from '../../main/pdf-ops/cert-store.js';
import { fail, ok } from '../../shared/result.js';
import type { SignaturesCertLoadError, SignaturesCertLoadResponse } from '../contracts.js';

// zod schema — payload-shape validation only. The discipline is enforced in
// the handler body (Buffer-wrap, overwrite-reference).
const requestSchema = z.object({
  pfxBytes: z.instanceof(Uint8Array),
  password: z.string().min(1).max(256),
});

export async function handleSignaturesCertLoad(req: unknown): Promise<SignaturesCertLoadResponse> {
  // (1) Validate payload.
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<SignaturesCertLoadError>('invalid_payload', parsed.error.message);
  }

  // (2) Buffer-wrap at the EARLIEST synchronous point. We copy the bytes
  //     into a fresh Buffer (Buffer.from(Uint8Array) shares memory; we want
  //     a mutable owned buffer that cert-store will fill(0)).
  const pfxBuf = Buffer.alloc(parsed.data.pfxBytes.byteLength);
  pfxBuf.set(parsed.data.pfxBytes);
  const passwordBuf = Buffer.from(parsed.data.password, 'utf-8');

  // (3) Overwrite the parsed-payload password field so the JS string drops
  //     to the unreachable-but-pending-GC residual state described in
  //     R-W15-A. We CANNOT zero the underlying string-storage from JS, but
  //     we can drop every reachable reference.
  //
  //     NOTE: this is intentionally a destructive mutation of an object that
  //     zod gave us; safe because the parsed object is local to this scope.
  (parsed.data as { password: string }).password = '';

  // (4) Delegate to cert-store; cert-store guarantees finally-block zeroing
  //     of BOTH `pfxBuf` and `passwordBuf` even on every failure path.
  try {
    const result = loadCert(pfxBuf, passwordBuf);
    // pfxBuf / passwordBuf are already zeroed; do not touch them again.
    if (result.ok) {
      return ok(result.value);
    }
    // cert-store returns its own error union; one variant ('parser_not_installed')
    // doesn't appear in the IPC contract — map it to pfx_decode_failed with
    // a clear message so the renderer knows PAdES is unavailable.
    if (result.error === 'parser_not_installed') {
      return fail<SignaturesCertLoadError>(
        'pfx_decode_failed',
        'PAdES signing engine not yet installed; visual signatures only',
      );
    }
    return fail<SignaturesCertLoadError>(result.error, result.message);
  } catch (e) {
    // cert-store wraps every parser exception itself; this catch is a
    // defensive belt-and-braces. We deliberately DO NOT include the error
    // message verbatim — a misbehaving parser could put PFX/password bytes
    // into the exception message.
    return fail<SignaturesCertLoadError>('pfx_decode_failed', 'cert-store threw', {
      reason: (e as Error).name ?? 'unknown',
    });
  }
}
