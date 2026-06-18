// a11y.figures.alt-not-placeholder — WCAG 1.1.1 (quality).
// Severity: warning. Flags `/Alt` strings that are placeholder content the
// author probably forgot to replace ("image", "image1", "img_001.jpg",
// "figure", "untitled", file extensions, etc.).
//
// Heuristic: a curated regex set. False positives are acceptable for a
// warning (we tell the user "looks like a placeholder"; they confirm or
// dismiss). False negatives (a placeholder we missed) are also acceptable
// for a warning.

import type {
  AccessibilityCheckContext,
  AccessibilityRule,
  AccessibilityRuleOutcome,
} from './index.js';

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^image(\s*\d+)?$/i,
  /^img(\s*[_-]?\d+)?$/i,
  /^picture(\s*\d+)?$/i,
  /^figure(\s*\d+)?$/i,
  /^photo(\s*\d+)?$/i,
  /^graphic(\s*\d+)?$/i,
  /^untitled$/i,
  /^placeholder$/i,
  /\.(png|jpe?g|gif|bmp|tiff?|webp|svg)$/i,
  /^\w+_\d+$/, // generic "logo_3", "icon_12"
];

function isPlaceholder(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false; // empty = decorative; different rule
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

function check(ctx: AccessibilityCheckContext): AccessibilityRuleOutcome {
  const figures = ctx.structElements.filter((e) => e.type === 'Figure');
  if (figures.length === 0) {
    return {
      status: 'pass',
      message: 'a11y.altNotPlaceholder.passNoFigures',
      locations: [],
    };
  }
  const suspicious = figures.filter(
    (f) => f.altValue !== null && f.altValue.length > 0 && isPlaceholder(f.altValue),
  );
  if (suspicious.length === 0) {
    return {
      status: 'pass',
      message: 'a11y.altNotPlaceholder.pass',
      locations: [],
    };
  }
  return {
    status: 'warn',
    message: 'a11y.altNotPlaceholder.warn',
    locations: suspicious.map((f) => ({
      pageIndex: f.pageIndex >= 0 ? f.pageIndex : 0,
      structNodeId: f.structNodeId,
    })),
    quickFix: {
      kind: 'open-alt-text-inspector',
      ...(suspicious[0] ? { targetNodeId: suspicious[0].structNodeId } : {}),
    },
  };
}

export const ruleAltNotPlaceholder: AccessibilityRule = {
  id: 'a11y.figures.alt-not-placeholder',
  severity: 'warning',
  labelKey: 'a11y.altNotPlaceholder.label',
  check,
};
