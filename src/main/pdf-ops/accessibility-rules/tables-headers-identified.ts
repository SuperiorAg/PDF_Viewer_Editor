// a11y.tables.headers-identified — PDF/UA-1 §7.5; WCAG 1.3.1.
// Severity: error. Every `/Table` structure element should have at least
// one descendant `/TH` (table-header) element.
//
// Honest implementation note: the snapshot we receive is FLAT (no parent
// link). A pedantic per-table check would require a recursive DFS over
// each table's subtree. Since the snapshot already enumerates EVERY
// structure element in pre-order, we use a doc-level signal: if any
// Tables are present AND no THs exist anywhere in the doc, every Table
// gets flagged. This is conservative — a doc-wide "no headers" failure
// is a legitimate accessibility finding, and a doc-mixed case (one well-
// tagged table among others) gets a false negative we accept for v0.8.0.
// A future iteration can add per-Table descendant tracking once the
// snapshot grows a parent-link.

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  const tables = ctx.structElements.filter((e) => e.type === 'Table');
  if (tables.length === 0) {
    return {
      status: 'pass',
      message: 'a11y.tablesHeadersIdentified.passNoTables',
      locations: [],
    };
  }
  const anyTh = ctx.structElements.some((e) => e.type === 'TH');
  if (anyTh) {
    return {
      status: 'pass',
      message: 'a11y.tablesHeadersIdentified.pass',
      locations: [],
    };
  }
  // No TH anywhere — every Table is implicated.
  const first = tables[0];
  return {
    status: 'fail',
    message: 'a11y.tablesHeadersIdentified.fail',
    locations: tables.map((t) => ({
      pageIndex: t.pageIndex >= 0 ? t.pageIndex : 0,
      structNodeId: t.structNodeId,
    })),
    quickFix: {
      kind: 'open-tag-editor',
      ...(first ? { targetNodeId: first.structNodeId } : {}),
    },
  };
}

export const ruleTablesHeadersIdentified: AccessibilityRule = {
  id: 'a11y.tables.headers-identified',
  severity: 'error',
  labelKey: 'a11y.tablesHeadersIdentified.label',
  check,
};
