// Phase 7.5 Wave 7 — B2 Compare Files text-compare engine.
//
// Canonical spec:
//   - docs/project-plan.md §"Wave 7 — Compare Files (parallel)".
//   - docs/ui-spec-phase-7.5.md §2.2 (text diff rendering).
//
// What this module does:
//   Given two already-extracted text strings (left/baseline + right/
//   modified), returns the diff segments + a character-count summary
//   suitable for the per-page badge in the renderer's two-column results
//   panel.
//
//   Uses Google's diff-match-patch (Apache-2.0, deps: none) for the
//   diff. `diff_cleanupSemantic` is invoked post-`diff_main` so the
//   segment boundaries are human-friendly (whole words preserved where
//   possible) rather than the raw character-level Myers output.
//
// Orphan-page handling:
//   When one side is `null` (the document is shorter than the other),
//   the diff degenerates to a single insert (modified-only) or delete
//   (baseline-only) entry covering the entire present-side text. This is
//   the canonical "full insert / full delete" treatment described in the
//   handler brief.
//
// Engine purity:
//   - No pdf.js, no pdf-lib, no I/O.
//   - Text extraction lives at the wiring boundary (L-005 — pdf.js
//     loadPdfJs lives ONLY in src/ipc/handlers/pdf-compare-*.ts). This
//     engine takes already-extracted strings as input.
//   - L-004 (buffer-copy-before-pdf.js) — n/a here; pure text.

import DiffMatchPatch from 'diff-match-patch';

import { fail, ok, type Result } from '../../shared/result.js';

export type TextCompareEngineError = 'invalid_payload' | 'engine_failed';

/** One diff segment. Mirrors the IPC contract. */
export interface TextDiffSegment {
  kind: 'equal' | 'insert' | 'delete';
  text: string;
}

/** Char-count summary used for the per-page badge in the renderer. */
export interface TextDiffSummary {
  equalChars: number;
  insertChars: number;
  deleteChars: number;
  /** True when at least one insert OR delete segment is present. */
  changed: boolean;
}

/** Engine result. */
export interface TextCompareResult {
  diffs: TextDiffSegment[];
  summary: TextDiffSummary;
}

export interface TextCompareInput {
  /** Left/baseline page text. `null` ⇒ orphan page (modified-only). */
  leftText: string | null;
  /** Right/modified page text. `null` ⇒ orphan page (baseline-only). */
  rightText: string | null;
}

/** diff-match-patch tuple kind constants. The library exports these as
 *  static numeric constants but the @types declaration carries them as
 *  literal types (-1 | 0 | 1) — we mirror them here for type safety. */
const DMP_DELETE = -1;
const DMP_EQUAL = 0;
const DMP_INSERT = 1;

/** Compute the text-compare result for a single page pair.
 *
 *  Both inputs `null` is treated as an empty diff (no orphan, no
 *  content); not an error.
 *
 *  Errors:
 *    - `invalid_payload` if either input is not `string | null`.
 *    - `engine_failed`   if diff-match-patch throws (defensive — the
 *                        library does not throw on string inputs in
 *                        practice, but we catch-around so a single bad
 *                        page doesn't kill a session).
 */
export function compareTexts(
  input: TextCompareInput,
): Result<TextCompareResult, TextCompareEngineError> {
  if (!isStringOrNull(input.leftText) || !isStringOrNull(input.rightText)) {
    return fail<TextCompareEngineError>(
      'invalid_payload',
      'leftText and rightText must be string | null',
    );
  }

  // Orphan-page shortcuts. Single insert/delete segment covering the
  // whole present-side text. When both sides are null we return an
  // empty diff.
  if (input.leftText === null && input.rightText === null) {
    return ok(emptyResult());
  }
  if (input.leftText === null) {
    return ok(buildOrphanResult('insert', input.rightText!));
  }
  if (input.rightText === null) {
    return ok(buildOrphanResult('delete', input.leftText));
  }

  // Both sides present — real diff. Catch around the library call so a
  // single page failure doesn't take down the whole compare session.
  let rawDiffs: ReadonlyArray<readonly [number, string]>;
  try {
    const dmp = new DiffMatchPatch();
    // Diff_Timeout: 0 ⇒ run to completion (no early-cutoff). For
    // typical per-page text (a few KB at most) this is fast; large
    // pages may take milliseconds. We don't currently expose this as
    // configurable.
    dmp.Diff_Timeout = 1.0; // 1 second per-page ceiling (library default)
    const diffs = dmp.diff_main(input.leftText, input.rightText);
    // Cleanup for human-readable segment boundaries.
    dmp.diff_cleanupSemantic(diffs);
    rawDiffs = diffs;
  } catch (e) {
    return fail<TextCompareEngineError>(
      'engine_failed',
      e instanceof Error && e.message ? `diff_main threw: ${e.message}` : 'diff_main threw',
    );
  }

  const segments: TextDiffSegment[] = [];
  let equalChars = 0;
  let insertChars = 0;
  let deleteChars = 0;
  for (const [op, text] of rawDiffs) {
    if (text.length === 0) continue;
    let kind: TextDiffSegment['kind'];
    switch (op) {
      case DMP_EQUAL:
        kind = 'equal';
        equalChars += text.length;
        break;
      case DMP_INSERT:
        kind = 'insert';
        insertChars += text.length;
        break;
      case DMP_DELETE:
        kind = 'delete';
        deleteChars += text.length;
        break;
      default:
        // diff-match-patch only emits -1/0/1; defensive skip.
        continue;
    }
    segments.push({ kind, text });
  }
  return ok({
    diffs: segments,
    summary: {
      equalChars,
      insertChars,
      deleteChars,
      changed: insertChars > 0 || deleteChars > 0,
    },
  });
}

// =====================================================================
// Helpers
// =====================================================================

function isStringOrNull(v: unknown): v is string | null {
  return typeof v === 'string' || v === null;
}

function emptyResult(): TextCompareResult {
  return {
    diffs: [],
    summary: { equalChars: 0, insertChars: 0, deleteChars: 0, changed: false },
  };
}

function buildOrphanResult(kind: 'insert' | 'delete', text: string): TextCompareResult {
  if (text.length === 0) {
    // Empty present side is honest but boring: no diff, no change.
    // (The orphan page may still warrant the badge — that's the
    // handler's responsibility via the leftPageIndex/rightPageIndex
    // null sentinel; see pdf-compare-text.ts.)
    return emptyResult();
  }
  return {
    diffs: [{ kind, text }],
    summary: {
      equalChars: 0,
      insertChars: kind === 'insert' ? text.length : 0,
      deleteChars: kind === 'delete' ? text.length : 0,
      changed: true,
    },
  };
}
