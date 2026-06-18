// a11y.content.scanned-searchable — WCAG 1.1.1 (Level A).
// Severity: error. Scanned-only pages (image with zero text glyphs) are
// unreachable to a screen reader; they must be OCR'd to become
// searchable text.
//
// Honest implementation:
//   - With a wired extractor: any page where `hasImageXObject && textItemCount === 0`
//     fails.
//   - Without an extractor (`ctx.pageDiagnostics === null`): we cannot
//     tell scanned-only from text-bearing-image pages, so we emit
//     `'unevaluated'` rather than guess.
//
// quickFix is intentionally omitted — the OCR surface lives elsewhere
// (Recognize Text panel) and is not part of the four canonical quickFix
// kinds. Riley's panel surfaces the rule message; the user uses the
// OCR menu separately.

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  if (ctx.pageDiagnostics === null) {
    return {
      status: 'unevaluated',
      message: 'a11y.scannedPagesSearchable.unevaluatedNoExtractor',
      locations: [],
    };
  }
  const failingPages = ctx.pageDiagnostics
    .filter((p) => p.hasImageXObject && p.textItemCount === 0)
    .map((p) => p.pageIndex);
  if (failingPages.length === 0) {
    return {
      status: 'pass',
      message: 'a11y.scannedPagesSearchable.pass',
      locations: [],
    };
  }
  return {
    status: 'fail',
    message: 'a11y.scannedPagesSearchable.fail',
    locations: failingPages.map((pi) => ({ pageIndex: pi })),
  };
}

export const ruleScannedPagesSearchable: AccessibilityRule = {
  id: 'a11y.content.scanned-searchable',
  severity: 'error',
  labelKey: 'a11y.scannedPagesSearchable.label',
  check,
};
