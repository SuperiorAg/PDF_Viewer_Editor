// Handler: pdf:closeCompareSession (Phase 7.5 Wave 7 — B2 Compare Files).
//
// Contract: docs/api-contracts.md §19.9.
// Engine:   src/main/compare/compare-session-store.ts.
//
// Drops the session record + every cache it owns (pdf.js docs, extracted
// text, rasterized PNGs). Idempotent semantics live in the store
// (`close` returns false for already-closed sessions); the handler maps
// that to `session_not_found` for honest client-side feedback.

import { z } from 'zod';

import {
  compareSessionStore,
  type CompareSessionStore,
} from '../../main/compare/compare-session-store.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type { PdfCloseCompareSessionError, PdfCloseCompareSessionResponse } from '../contracts.js';

// =====================================================================
// Schema
// =====================================================================

const requestSchema = z.object({
  compareSessionId: z.string().min(1),
});

// =====================================================================
// Deps
// =====================================================================

export interface PdfCompareCloseDeps {
  store?: CompareSessionStore;
}

// =====================================================================
// Handler
// =====================================================================

export async function handlePdfCloseCompareSession(
  req: unknown,
  deps: PdfCompareCloseDeps = {},
): Promise<PdfCloseCompareSessionResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfCloseCompareSessionError>('invalid_payload', parsed.error.message);
  }
  const store = deps.store ?? compareSessionStore;
  try {
    const closed = store.close(parsed.data.compareSessionId);
    if (!closed) {
      return fail<PdfCloseCompareSessionError>(
        'session_not_found',
        `session ${parsed.data.compareSessionId} is not open`,
      );
    }
    return ok({ closed: true });
  } catch (e) {
    return fail<PdfCloseCompareSessionError>(
      'session_not_found',
      safeMessage(e, 'compare session store unavailable'),
    );
  }
}
