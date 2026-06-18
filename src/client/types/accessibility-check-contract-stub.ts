// Accessibility-check contract stub — Phase 7.5 C6 (Riley Wave 5d).
//
// David's parallel Wave 5d commit (438d1de) landed `pdf:runAccessibilityCheck`
// in `src/ipc/contracts.ts` plus the canonical types
// (`AccessibilityRuleResult`, `AccessibilityCheckSummary`,
// `PdfRunAccessibilityCheckValue`, etc.). This stub re-exports them and adds
// a renderer-local widening that includes `'bridge_unavailable'` in the
// error union so the service wrapper can return a structurally-correct
// Result when `window.pdfApi.pdf.runAccessibilityCheck` isn't exposed yet
// (Vitest + pre-bridge dev builds). Mirrors the Wave 5a/5b/5c stub pattern.
//
// HONESTY CLAUSE (P7.5-L-10 obligation #2):
//   - The panel surfaces `value.subsetDisclosure` VERBATIM (David's contract
//     carries the disclosure as a string, not a flag). The renderer NEVER
//     paraphrases or hardcodes the wording. Test
//     `accessibility-check-panel.test.tsx` asserts the rendered DOM
//     contains the stub fixture's `subsetDisclosure` substring.
//   - The four-state model (`pass | warn | fail | unevaluated`) is exposed
//     to the user — `unevaluated` is its own bucket, NEVER folded into
//     `pass`. Tells the user the truth that some rules cannot be assessed
//     by pdf-lib alone (color contrast needs a raster).
//   - The panel shows `value.shippedRuleCount` upfront so the user knows
//     "12 rules" rather than guessing.

export type {
  AccessibilityRuleSeverity,
  AccessibilityRuleResult,
  AccessibilityCheckSummary,
  PdfRunAccessibilityCheckRequest,
  PdfRunAccessibilityCheckValue,
} from './ipc-contract';

import type { PdfRunAccessibilityCheckValue } from './ipc-contract';

/** Renderer-side error union — David's canonical `PdfRunAccessibilityCheckError`
 *  widened with `'bridge_unavailable'` so the service wrapper short-circuits
 *  cleanly when the preload bridge method is missing. */
export type PdfRunAccessibilityCheckErrorRenderer =
  | 'invalid_payload'
  | 'handle_not_found'
  | 'engine_failed'
  | 'bridge_unavailable';

export type PdfRunAccessibilityCheckResponseRenderer =
  | { ok: true; value: PdfRunAccessibilityCheckValue }
  | {
      ok: false;
      error: PdfRunAccessibilityCheckErrorRenderer;
      message: string;
    };
