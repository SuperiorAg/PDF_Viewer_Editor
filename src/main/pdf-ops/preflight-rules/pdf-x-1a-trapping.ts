// preflight.trapping.specified — PDF/X-1a, severity warning.
// /Trapped in /Info must be True, False, or absent — NOT /Unknown.

import { infoTrappedRaw } from './_helpers.js';

import type { PreflightContext, PreflightRule, PreflightRuleResult } from './index.js';

function normalize(raw: string | null): string | null {
  if (raw === null) return null;
  return raw.toLowerCase().replace(/^\//, '');
}

export const rulePdfX1aTrappingSpecified: PreflightRule = {
  id: 'preflight.trapping.specified',
  profile: 'pdf-x-1a',
  severity: 'warning',
  labelKey: 'preflight.trapping.specified.label',
  check(ctx: PreflightContext): PreflightRuleResult {
    const raw = infoTrappedRaw(ctx.doc);
    const n = normalize(raw);
    const passed = n === null || n === 'true' || n === 'false';
    return {
      ruleId: 'preflight.trapping.specified',
      profile: 'pdf-x-1a',
      severity: 'warning',
      passed,
      message: passed ? 'preflight.trapping.specified.pass' : 'preflight.trapping.specified.fail',
      locations: [],
      ...(passed ? {} : { details: { trappedRaw: raw } }),
    };
  },
};
