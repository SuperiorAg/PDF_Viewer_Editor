// a11y.content.non-text-tagged — PDF/UA-1 §7.18.6.2; WCAG 1.1.1.
// Severity: error. Every page that contains image content MUST have at
// least one `/Figure` structure element scoping that content.
//
// We use the per-page extractor diagnostic to know whether a page
// has at least one image XObject. When the extractor is unwired
// (`ctx.pageDiagnostics === null`), this rule emits `'unevaluated'`
// honestly rather than guessing.

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  if (ctx.pageDiagnostics === null) {
    return {
      status: 'unevaluated',
      message: 'a11y.contentNonTextTagged.unevaluatedNoExtractor',
      locations: [],
    };
  }
  // Map pageIndex → bool: has a Figure tag on that page?
  const figurePages = new Set<number>();
  for (const e of ctx.structElements) {
    if (e.type === 'Figure' && e.pageIndex >= 0) {
      figurePages.add(e.pageIndex);
    }
  }
  const failingPages = ctx.pageDiagnostics
    .filter((p) => p.hasImageXObject && !figurePages.has(p.pageIndex))
    .map((p) => p.pageIndex);
  if (failingPages.length === 0) {
    return {
      status: 'pass',
      message: 'a11y.contentNonTextTagged.pass',
      locations: [],
    };
  }
  return {
    status: 'fail',
    message: 'a11y.contentNonTextTagged.fail',
    locations: failingPages.map((pi) => ({ pageIndex: pi })),
    quickFix: { kind: 'open-tag-editor' },
  };
}

export const ruleContentNonTextTagged: AccessibilityRule = {
  id: 'a11y.content.non-text-tagged',
  severity: 'error',
  labelKey: 'a11y.contentNonTextTagged.label',
  check,
};
