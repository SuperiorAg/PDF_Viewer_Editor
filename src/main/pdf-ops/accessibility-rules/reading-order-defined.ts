// a11y.reading.order-defined — PDF/UA-1 §7.1; WCAG 1.3.2.
// Severity: error. The doc has a defined reading order.
//
// Honest implementation: a tagged PDF's reading order IS the /K pre-order
// traversal of /StructTreeRoot (PDF 1.7 §14.7). If we have a non-empty
// struct tree, reading order is defined by definition — we return
// `'pass'`. If there is no struct tree at all, we can't assess reading
// order (a content-only walk is not equivalent), so we return
// `'unevaluated'` rather than `'fail'`. The structure-tree-present rule
// already flags missing tree as a fail — we don't double-fail the same
// fact.

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  if (ctx.structElements.length === 0) {
    return {
      status: 'unevaluated',
      message: 'a11y.readingOrderDefined.unevaluatedNoStructTree',
      locations: [],
    };
  }
  return {
    status: 'pass',
    message: 'a11y.readingOrderDefined.pass',
    locations: [],
    quickFix: { kind: 'open-reading-order' },
  };
}

export const ruleReadingOrderDefined: AccessibilityRule = {
  id: 'a11y.reading.order-defined',
  severity: 'error',
  labelKey: 'a11y.readingOrderDefined.label',
  check,
};
