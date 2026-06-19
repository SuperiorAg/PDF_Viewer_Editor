// Handler: pdf:openComparePair (Phase 7.5 Wave 7 — B2 Compare Files).
//
// Contract:  docs/api-contracts.md §19.9.
// Engine:    src/main/compare/page-pairing.ts +
//            src/main/compare/compare-session-store.ts.
//
// Pure registration — no pdf.js work happens here. The handler validates
// both document handles, computes the sequential page-pair list, and
// opens a session record. First text/visual request triggers per-side
// pdf.js parse (L-005 — pdf.js loadPdfJs lives in
// pdf-compare-text.ts + pdf-compare-visual.ts, NOT here).
//
// Performance contract: opening a session on a 1064-page document pair
// MUST NOT eagerly process all pages. Confirmed by the absence of any
// pdf.js call in this handler.

import { z } from 'zod';

import {
  compareSessionStore,
  type CompareSessionStore,
} from '../../main/compare/compare-session-store.js';
import { computeSequentialPagePairs } from '../../main/compare/page-pairing.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfOpenComparePairError,
  PdfOpenComparePairResponse,
} from '../contracts.js';

// =====================================================================
// Schema
// =====================================================================

const requestSchema = z.object({
  leftHandle: z.number().int().positive(),
  rightHandle: z.number().int().positive(),
});

// =====================================================================
// Deps
// =====================================================================

export interface PdfCompareOpenDeps {
  /** Page count + existence probe for the supplied document handle.
   *  Returns `null` if the handle is unknown to documentStore. */
  getPageCount: (handle: DocumentHandle) => number | null;
  /** Engine seam — tests inject. Defaults to the singleton. */
  store?: CompareSessionStore;
}

// =====================================================================
// Handler
// =====================================================================

export async function handlePdfOpenComparePair(
  req: unknown,
  deps: PdfCompareOpenDeps,
): Promise<PdfOpenComparePairResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfOpenComparePairError>('invalid_payload', parsed.error.message);
  }
  const { leftHandle, rightHandle } = parsed.data;
  const leftPageCount = deps.getPageCount(leftHandle);
  if (leftPageCount === null) {
    return fail<PdfOpenComparePairError>(
      'handle_not_found',
      `left handle ${leftHandle} is not registered`,
    );
  }
  const rightPageCount = deps.getPageCount(rightHandle);
  if (rightPageCount === null) {
    return fail<PdfOpenComparePairError>(
      'handle_not_found',
      `right handle ${rightHandle} is not registered`,
    );
  }

  const pairsRes = computeSequentialPagePairs(leftPageCount, rightPageCount);
  if (!pairsRes.ok) {
    // Page-pairing only fails on negative / non-integer counts, which
    // the documentStore should never produce. Treat as engine unavail.
    return fail<PdfOpenComparePairError>(
      'compare_engine_unavailable',
      `page-pairing failed: ${pairsRes.message}`,
    );
  }

  const store = deps.store ?? compareSessionStore;
  try {
    const session = store.open({
      leftHandle,
      rightHandle,
      pageCountLeft: leftPageCount,
      pageCountRight: rightPageCount,
      pagePairs: pairsRes.value,
    });
    return ok({
      compareSessionId: session.id,
      pageCountLeft: leftPageCount,
      pageCountRight: rightPageCount,
      pagePairs: pairsRes.value,
    });
  } catch (e) {
    return fail<PdfOpenComparePairError>(
      'compare_engine_unavailable',
      safeMessage(e, 'compare session store unavailable'),
    );
  }
}
