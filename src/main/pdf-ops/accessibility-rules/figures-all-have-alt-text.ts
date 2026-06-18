// a11y.figures.all-have-alt-text — WCAG 1.1.1.
// Severity: error. Every `/Figure` structure element must have `/Alt`.
//
// Honest nuance: an *empty* `/Alt` (the "decorative image" signal) is OK —
// the engine's snapshot tracks `hasAltKey` separately from
// `hasNonEmptyAlt`. A decorative image with `/Alt ()` is treated as
// satisfying the rule. An absent /Alt is the failure mode.

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  const figures = ctx.structElements.filter((e) => e.type === 'Figure');
  if (figures.length === 0) {
    // No figures means the rule trivially holds. The renderer should NOT
    // interpret this as a perfect a11y score — it just means the question
    // doesn't apply.
    return {
      status: 'pass',
      message: 'a11y.figuresAllHaveAltText.passNoFigures',
      locations: [],
    };
  }
  const missing = figures.filter((f) => !f.hasAltKey);
  if (missing.length === 0) {
    return {
      status: 'pass',
      message: 'a11y.figuresAllHaveAltText.pass',
      locations: [],
    };
  }
  return {
    status: 'fail',
    message: 'a11y.figuresAllHaveAltText.fail',
    locations: missing.map((f) => ({
      pageIndex: f.pageIndex >= 0 ? f.pageIndex : 0,
      structNodeId: f.structNodeId,
    })),
    quickFix: {
      kind: 'open-alt-text-inspector',
      ...(missing[0] ? { targetNodeId: missing[0].structNodeId } : {}),
    },
  };
}

export const ruleFiguresAllHaveAltText: AccessibilityRule = {
  id: 'a11y.figures.all-have-alt-text',
  severity: 'error',
  labelKey: 'a11y.figuresAllHaveAltText.label',
  check,
};
