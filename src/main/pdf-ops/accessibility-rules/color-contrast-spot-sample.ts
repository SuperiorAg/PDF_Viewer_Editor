// a11y.appearance.color-contrast-spot-sample — WCAG 1.4.3.
// Severity: warning. Permanently `'unevaluated'` in pure pdf-lib.
//
// Why ship a rule that cannot be assessed?
//   1. Honesty (P7.5-L-10): we tell the user upfront we don't measure
//      contrast, rather than implying our checker is more complete than
//      it is. The four-state model exists precisely for this case — the
//      `unevaluated` status is a feature, not a bug.
//   2. Forward compatibility: shipping the rule slot means the renderer
//      already wires it into the panel. When a future wave adds a
//      pdf.js + canvas rasteriser, the only change is this file —
//      contract, panel, engine boundaries stay identical. No churn.
//   3. Discoverability: users see "we know about color contrast and we
//      know we're not checking it here." That's better feedback than
//      silently omitting the row.
//
// quickFix is intentionally omitted — there is no in-app remediation
// surface for color-contrast issues in v0.8.0.

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(_ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  return {
    status: 'unevaluated',
    message: 'a11y.colorContrast.unevaluated.pdf-lib-cannot-rasterize',
    locations: [],
  };
}

export const ruleColorContrastSpotSample: AccessibilityRule = {
  id: 'a11y.appearance.color-contrast-spot-sample',
  severity: 'warning',
  labelKey: 'a11y.colorContrastSpotSample.label',
  check,
};
