// Handler: pdf:compareTextOnPage (Phase 7.5 Wave 7 — B2 Compare Files).
//
// Contract: docs/api-contracts.md §19.9.
// Engine:   src/main/compare/text-compare-engine.ts +
//           src/main/compare/compare-session-store.ts.
//
// Pure engine + INJECTED text extractor seam. Tests inject a
// deterministic stub; production wires the pdf.js text-content walker
// at register.ts (mirrors the accessibility / auto-tag / auto-bookmark
// pattern). L-005 (loadPdfJs polyfills-before-import) lives at the
// production extractor's loader; this handler stays pdf.js-free.
//
// Lazy semantics:
//   The session-store's `textCache` is keyed by 0-based pageIndex per
//   side. If the cache hits we skip the extractor entirely; otherwise
//   we run the extractor once and stash the result. Orphan pages
//   (one side null) skip extraction on the null side and feed `null`
//   directly into the engine.

import { z } from 'zod';

import {
  compareSessionStore,
  type CompareSession,
  type CompareSessionStore,
} from '../../main/compare/compare-session-store.js';
import {
  compareTexts,
  type TextCompareEngineError,
} from '../../main/compare/text-compare-engine.js';
import { fail, ok, safeMessage } from '../../shared/result.js';
import type {
  DocumentHandle,
  PdfCompareTextOnPageError,
  PdfCompareTextOnPageResponse,
} from '../contracts.js';

// =====================================================================
// Schema
// =====================================================================

const requestSchema = z.object({
  compareSessionId: z.string().min(1),
  leftPageIndex: z.number().int().nonnegative().nullable(),
  rightPageIndex: z.number().int().nonnegative().nullable(),
});

// =====================================================================
// Deps
// =====================================================================

/** Extractor seam — given a document handle + 0-based page index, return
 *  the page's text content as a single string. Production wires a pdf.js
 *  getTextContent walker (L-004/L-005 compliance at the loader). Tests
 *  inject deterministic per-side fixtures. */
export type CompareTextExtractor = (handle: DocumentHandle, pageIndex: number) => Promise<string>;

export interface PdfCompareTextDeps {
  store?: CompareSessionStore;
  /** Production wires this to a pdf.js text walker. */
  extractor: CompareTextExtractor;
}

// =====================================================================
// Handler
// =====================================================================

export async function handlePdfCompareTextOnPage(
  req: unknown,
  deps: PdfCompareTextDeps,
): Promise<PdfCompareTextOnPageResponse> {
  const parsed = requestSchema.safeParse(req);
  if (!parsed.success) {
    return fail<PdfCompareTextOnPageError>('invalid_payload', parsed.error.message);
  }
  const { compareSessionId, leftPageIndex, rightPageIndex } = parsed.data;
  if (leftPageIndex === null && rightPageIndex === null) {
    return fail<PdfCompareTextOnPageError>(
      'invalid_payload',
      'at least one of leftPageIndex / rightPageIndex must be non-null',
    );
  }

  const store = deps.store ?? compareSessionStore;
  const session = store.get(compareSessionId);
  if (session === null) {
    return fail<PdfCompareTextOnPageError>(
      'session_not_found',
      `compare session ${compareSessionId} is not open`,
    );
  }
  const rangeErr = checkPageRange(session, leftPageIndex, rightPageIndex);
  if (rangeErr !== null) return rangeErr;

  // Extract text per side; cache hits short-circuit. Orphan sides
  // (null index) skip extraction entirely and pass null to the engine.
  let leftText: string | null = null;
  let rightText: string | null = null;
  try {
    if (leftPageIndex !== null) {
      const cached = session.left.textCache.get(leftPageIndex);
      if (cached !== undefined) {
        leftText = cached;
      } else {
        leftText = await deps.extractor(session.left.handle, leftPageIndex);
        session.left.textCache.set(leftPageIndex, leftText);
      }
    }
    if (rightPageIndex !== null) {
      const cached = session.right.textCache.get(rightPageIndex);
      if (cached !== undefined) {
        rightText = cached;
      } else {
        rightText = await deps.extractor(session.right.handle, rightPageIndex);
        session.right.textCache.set(rightPageIndex, rightText);
      }
    }
  } catch (e) {
    return fail<PdfCompareTextOnPageError>(
      'extraction_failed',
      safeMessage(e, 'text extractor threw'),
    );
  }

  const engineRes = compareTexts({ leftText, rightText });
  if (!engineRes.ok) {
    return mapEngineErr(engineRes.error, engineRes.message);
  }
  const pageNumber = ((leftPageIndex ?? rightPageIndex) as number) + 1;
  return ok({
    pageNumber,
    leftPageIndex,
    rightPageIndex,
    diffs: engineRes.value.diffs,
    summary: engineRes.value.summary,
  });
}

// =====================================================================
// Helpers
// =====================================================================

function checkPageRange(
  session: CompareSession,
  leftPageIndex: number | null,
  rightPageIndex: number | null,
): PdfCompareTextOnPageResponse | null {
  if (leftPageIndex !== null && leftPageIndex >= session.pageCountLeft) {
    return fail<PdfCompareTextOnPageError>(
      'page_out_of_range',
      `leftPageIndex ${leftPageIndex} >= pageCountLeft ${session.pageCountLeft}`,
    );
  }
  if (rightPageIndex !== null && rightPageIndex >= session.pageCountRight) {
    return fail<PdfCompareTextOnPageError>(
      'page_out_of_range',
      `rightPageIndex ${rightPageIndex} >= pageCountRight ${session.pageCountRight}`,
    );
  }
  return null;
}

function mapEngineErr(err: TextCompareEngineError, msg: string): PdfCompareTextOnPageResponse {
  switch (err) {
    case 'invalid_payload':
      return fail<PdfCompareTextOnPageError>('invalid_payload', msg);
    case 'engine_failed':
    default:
      return fail<PdfCompareTextOnPageError>('extraction_failed', msg);
  }
}
