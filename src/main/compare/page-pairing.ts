// Phase 7.5 Wave 7 — B2 Compare Files page-pairing helper.
//
// Canonical spec:
//   - docs/project-plan.md §"Wave 7 — Compare Files (parallel)".
//   - docs/ui-spec-phase-7.5.md §2 (B2 Compare Files).
//
// What this module does:
//   Given the page counts of two PDFs (left = baseline; right = modified),
//   produces a sequential pair-list. When one document is shorter, the
//   trailing pages get `null` on the missing side ("orphan pages") — these
//   render as full-insert (modified-only) or full-delete (baseline-only)
//   in the downstream text + visual compare engines.
//
// Honest deferral (v0.8.0):
//   - Pairing is sequential only: leftPageIndex N pairs with rightPageIndex
//     N. This is honest for the typical "two revisions of the same
//     document" workflow (the spec's primary case) but is suboptimal when
//     pages are inserted / deleted in the middle.
//   - A future v0.9.0 wave can wire content-hash-based pairing (Hungarian
//     algorithm against per-page text hashes) without changing the engine
//     surface — the `PagePairing` shape is the contract; the function
//     producing it is what evolves.
//
// Engine purity: pure, no I/O. Trivially unit-testable.

import { fail, ok, type Result } from '../../shared/result.js';

export type PagePairingError = 'invalid_payload';

/** One page-pair record. Mirrors the IPC `pagePairs` array shape. */
export interface PagePairing {
  /** 0-based index into the LEFT (baseline) document, or `null` if this
   *  position has no baseline page (a modified-only "orphan"). */
  leftPageIndex: number | null;
  /** 0-based index into the RIGHT (modified) document, or `null` if this
   *  position has no modified page (a baseline-only "orphan"). */
  rightPageIndex: number | null;
}

/** Compute the sequential page-pair list.
 *
 *  Inputs are non-negative integer page counts. Zero-page docs are
 *  honoured (the result is the other side's pages as orphans).
 *
 *  Output length equals `max(leftPageCount, rightPageCount)`.
 */
export function computeSequentialPagePairs(
  leftPageCount: number,
  rightPageCount: number,
): Result<PagePairing[], PagePairingError> {
  if (
    !Number.isInteger(leftPageCount) ||
    leftPageCount < 0 ||
    !Number.isInteger(rightPageCount) ||
    rightPageCount < 0
  ) {
    return fail<PagePairingError>(
      'invalid_payload',
      `page counts must be non-negative integers (got left=${String(leftPageCount)}, right=${String(rightPageCount)})`,
    );
  }
  const maxPages = Math.max(leftPageCount, rightPageCount);
  const out: PagePairing[] = [];
  for (let i = 0; i < maxPages; i += 1) {
    out.push({
      leftPageIndex: i < leftPageCount ? i : null,
      rightPageIndex: i < rightPageCount ? i : null,
    });
  }
  return ok(out);
}
