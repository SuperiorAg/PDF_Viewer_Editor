// a11y.tables.scope-set — PDF/UA-1 §7.5; WCAG 1.3.1.
// Severity: warning. Every `/TH` (table-header) structure element should
// declare its `/Scope` attribute (`Row` / `Column` / `Both`) so AT can
// associate header cells with the correct row/column axis.
//
// Acrobat treats missing scope as a WARNING (not error) — readers can
// infer scope heuristically. We mirror that: flag missing scope so the
// author can fix it, but don't fail the whole accessibility report on
// it.

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  const ths = ctx.structElements.filter((e) => e.type === 'TH');
  if (ths.length === 0) {
    // No table headers at all → rule trivially holds. (The
    // headers-identified rule will flag the absence separately when
    // Tables are present without THs.)
    return {
      status: 'pass',
      message: 'a11y.tablesScopeSet.passNoTh',
      locations: [],
    };
  }
  const missing = ths.filter((th) => !th.hasScopeAttribute);
  if (missing.length === 0) {
    return {
      status: 'pass',
      message: 'a11y.tablesScopeSet.pass',
      locations: [],
    };
  }
  const first = missing[0];
  return {
    status: 'warn',
    message: 'a11y.tablesScopeSet.warn',
    locations: missing.map((th) => ({
      pageIndex: th.pageIndex >= 0 ? th.pageIndex : 0,
      structNodeId: th.structNodeId,
    })),
    quickFix: {
      kind: 'open-tag-editor',
      ...(first ? { targetNodeId: first.structNodeId } : {}),
    },
  };
}

export const ruleTablesScopeSet: AccessibilityRule = {
  id: 'a11y.tables.scope-set',
  severity: 'warning',
  labelKey: 'a11y.tablesScopeSet.label',
  check,
};
